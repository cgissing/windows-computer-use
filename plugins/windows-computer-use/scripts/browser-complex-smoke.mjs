#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
const serverPath = path.join(pluginRoot, "mcp", "server.mjs");
const runId = String(Date.now());
const tempRoot = path.join(os.tmpdir(), `windows-cu-browser-${runId}`);
const profileDir = path.join(tempRoot, "profile");
const pagePath = path.join(tempRoot, "browser-fixture.html");
const title = `Windows CU Browser Fixture ${runId}`;

const chromiumCandidates = [
  process.env.WINDOWS_CU_BROWSER,
  "C:\\Software\\ungoogled-chromium\\App\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(value) {
  return String(value || "").replace(/[\\w.+-]+@[\\w.-]+/g, "[email]");
}

function runMcp(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [serverPath], {
      cwd: pluginRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
        resolve({ code, lines, stderr });
      } catch (error) {
        reject(new Error(`Could not parse MCP output: ${error.message}\nstdout=${stdout.slice(0, 2000)}\nstderr=${stderr}`));
      }
    });
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();
  });
}

function baseRequests() {
  return [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "windows-cu-browser-complex-smoke", version: "0.1.0" }
      }
    },
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} }
  ];
}

function textResult(lines, id) {
  const message = lines.find((line) => line.id === id);
  const text = message?.result?.content?.find((item) => item.type === "text")?.text;
  return text ? JSON.parse(text) : null;
}

async function tool(name, args = {}, id = 2) {
  const run = await runMcp([
    ...baseRequests(),
    { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }
  ]);
  return { run, result: textResult(run.lines, id) };
}

async function listWindows() {
  const { result } = await tool("windows_computer_use_list_windows", { includeInvisible: true, maxWindows: 250 });
  return Array.isArray(result?.windows) ? result.windows : [];
}

async function waitForWindow() {
  let last = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const windows = await listWindows();
    last = windows;
    const match = windows.find((window) => (window.name || "").includes(title) && window.className === "Chrome_WidgetWin_1");
    if (match?.nativeWindowHandle) return { window: match, candidates: windows };
    await sleep(500);
  }
  return { window: null, candidates: last };
}

async function findOne(target, query, options = {}) {
  const { result } = await tool("windows_computer_use_find", {
    scope: "active_window",
    ...target,
    query,
    controlType: options.controlType,
    viewMode: options.viewMode || "control",
    includeOffscreen: false,
    maxDepth: options.maxDepth || 12,
    maxNodes: options.maxNodes || 4000,
    maxResults: options.maxResults || 20
  });
  const items = result?.results || [];
  const chosen = options.pick ? items.find(options.pick) : items[0];
  if (!chosen?.id) {
    throw new Error(`Could not find ${query}. Matches=${JSON.stringify(items.slice(0, 5))}`);
  }
  return { result, element: chosen };
}

async function setValue(target, query, value) {
  const { element } = await findOne(target, query, {
    maxDepth: 12,
    maxNodes: 4000,
    pick: (item) => item.controlType === "Edit" || item.controlType === "Document" || item.name === query
  });
  const { result } = await tool("windows_computer_use_set_value", {
    ...target,
    viewMode: "control",
    elementId: element.id,
    value,
    fallbackType: true,
    restoreClipboard: true
  });
  if (!result?.ok) throw new Error(`set_value failed for ${query}: ${JSON.stringify(result)}`);
  return { element, action: result };
}

async function invoke(target, query, options = {}) {
  const { element } = await findOne(target, query, {
    controlType: options.controlType,
    maxDepth: options.maxDepth || 12,
    maxNodes: options.maxNodes || 4000,
    pick: options.pick || ((item) => item.name === query || item.controlType === "Button" || item.controlType === "CheckBox")
  });
  const { result } = await tool("windows_computer_use_invoke", {
    ...target,
    viewMode: "control",
    elementId: element.id,
    fallbackClick: true
  });
  if (!result?.ok) throw new Error(`invoke failed for ${query}: ${JSON.stringify(result)}`);
  await sleep(options.afterMs || 250);
  return { element, action: result };
}

async function snapshot(target) {
  const { result } = await tool("windows_computer_use_snapshot", {
    scope: "active_window",
    ...target,
    activate: true,
    includeScreenshot: false,
    viewMode: "control",
    includeOffscreen: false,
    detailLevel: "compact",
    maxDepth: 6,
    maxNodes: 1200
  });
  return result;
}

async function closeWindow(target) {
  try {
    await tool("windows_computer_use_keypress", { ...target, activate: true, keys: ["Alt", "F4"] });
  } catch {}
}

async function withCleanup(target, fn) {
  try {
    return await fn();
  } catch (error) {
    if (target?.nativeWindowHandle) await closeWindow(target);
    throw error;
  }
}

function fixtureHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 28px; color: #1f2937; }
    main { max-width: 980px; margin: 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    section { border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; }
    label { display: grid; gap: 4px; margin: 10px 0; }
    input, select, textarea, button { font: inherit; padding: 8px 10px; }
    button { cursor: pointer; }
    .product { display: flex; align-items: center; justify-content: space-between; margin: 8px 0; padding: 8px; background: #f8fafc; }
    .summary { grid-column: 1 / -1; min-height: 72px; background: #f0fdf4; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>Windows CU Browser Fixture</h1>
  <main>
    <section aria-label="Catalog panel">
      <h2>Catalog</h2>
      <label>Search catalog
        <input id="catalog-search" aria-label="Search catalog input" type="search" autocomplete="off">
      </label>
      <div id="products">
        <div class="product" data-name="atlas notebook"><span>Atlas Notebook</span><button type="button" aria-label="Add Atlas Notebook">Add</button></div>
        <div class="product" data-name="ember pen"><span>Ember Pen</span><button type="button" aria-label="Add Ember Pen">Add</button></div>
        <div class="product" data-name="matrix ruler"><span>Matrix Ruler</span><button type="button" aria-label="Add Matrix Ruler">Add</button></div>
      </div>
      <p aria-live="polite" id="cart-status">Cart is empty</p>
    </section>

    <section aria-label="Checkout panel">
      <h2>Checkout</h2>
      <label>Full name
        <input id="full-name" aria-label="Full name input" autocomplete="name">
      </label>
      <label>Email
        <input id="email" aria-label="Email input" autocomplete="email">
      </label>
      <label>Delivery note
        <textarea id="note" aria-label="Delivery note input"></textarea>
      </label>
      <label>
        <input id="priority" aria-label="Priority handling checkbox" type="checkbox">
        Priority handling
      </label>
      <label>
        <input id="terms" aria-label="Accept terms checkbox" type="checkbox">
        Accept terms
      </label>
      <button type="button" aria-label="Review order">Review order</button>
    </section>

    <section class="summary" aria-label="Result panel">
      <h2>Result</h2>
      <p id="result" role="status">Waiting for order.</p>
    </section>
  </main>
  <script>
    const cart = [];
    const products = [...document.querySelectorAll('.product')];
    const status = document.querySelector('#cart-status');
    const result = document.querySelector('#result');

    document.querySelector('#catalog-search').addEventListener('input', (event) => {
      const q = event.target.value.trim().toLowerCase();
      products.forEach((product) => product.classList.toggle('hidden', q && !product.dataset.name.includes(q)));
    });

    document.querySelector('#products').addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const product = button.parentElement.querySelector('span').textContent;
      if (!cart.includes(product)) cart.push(product);
      status.textContent = 'Cart: ' + cart.join(', ');
    });

    document.querySelector('[aria-label="Review order"]').addEventListener('click', () => {
      const name = document.querySelector('#full-name').value.trim();
      const email = document.querySelector('#email').value.trim();
      const note = document.querySelector('#note').value.trim();
      const priority = document.querySelector('#priority').checked ? 'priority' : 'standard';
      const terms = document.querySelector('#terms').checked;
      if (!cart.length || !name || !email || !terms) {
        result.textContent = 'Order incomplete';
        return;
      }
      const code = 'CU-' + cart.length + '-' + name.split(/\\s+/).map((part) => part[0]).join('').toUpperCase();
      result.textContent = 'Order ready: ' + code + ' for ' + name + ' using ' + priority + ' handling. Items: ' + cart.join(', ') + '. Note: ' + note;
    });
  </script>
</body>
</html>`;
}

async function main() {
  await mkdir(profileDir, { recursive: true });
  await writeFile(pagePath, fixtureHtml(), "utf8");

  const browserPath = chromiumCandidates.find((candidate) => existsSync(candidate));
  if (!browserPath) throw new Error(`No supported Chromium browser found. Tried: ${chromiumCandidates.join(", ")}`);

  const pageUrl = pathToFileURL(pagePath).href;
  const browser = spawn(
    browserPath,
    [
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--disable-default-apps",
      "--force-renderer-accessibility",
      "--window-size=1280,900",
      "--window-position=120,80",
      "--new-window",
      pageUrl
    ],
    { detached: true, stdio: "ignore", windowsHide: false }
  );
  browser.unref();

  const { window, candidates } = await waitForWindow();
  if (!window) {
    throw new Error(`Browser fixture window not found. Candidates=${JSON.stringify(candidates.slice(0, 20).map((item) => ({ name: redact(item.name), className: item.className })))}`);
  }

  const target = { nativeWindowHandle: window.nativeWindowHandle };
  const activated = await tool("windows_computer_use_activate_window", { ...target, activate: true });
  if (!activated.result?.ok) throw new Error(`activate_window failed: ${JSON.stringify(activated.result)}`);

  return await withCleanup(target, async () => {
    const before = await snapshot(target);
    await setValue(target, "Search catalog input", "atlas");
    await invoke(target, "Add Atlas Notebook");
    await setValue(target, "Full name input", "Ada Browser");
    await setValue(target, "Email input", "ada.browser@example.test");
    await setValue(target, "Delivery note input", "Leave at reception");
    await invoke(target, "Priority handling checkbox", { controlType: "CheckBox" });
    await invoke(target, "Accept terms checkbox", { controlType: "CheckBox" });
    await invoke(target, "Review order");

    const finalFind = await findOne(target, "Order ready: CU-1-AB", {
      maxDepth: 12,
      maxNodes: 4000,
      pick: (item) => (item.name || "").includes("Order ready: CU-1-AB")
    });
    const after = await snapshot(target);
    await closeWindow(target);

    return {
      ok: true,
      browserPath,
      pagePath,
      window: {
        name: redact(window.name),
        className: window.className,
        nativeWindowHandle: window.nativeWindowHandle,
        processId: window.processId
      },
      before: {
        nodeCount: before?.nodeCount,
        durationMs: before?.durationMs,
        rootControlType: before?.tree?.controlType
      },
      operations: [
        "activate browser window by HWND",
        "snapshot control tree",
        "set search field",
        "invoke filtered product add button",
        "set three checkout fields",
        "invoke priority checkbox",
        "invoke terms checkbox",
        "invoke review button",
        "find final order result text"
      ],
      finalResult: {
        id: finalFind.element.id,
        name: redact(finalFind.element.name),
        controlType: finalFind.element.controlType
      },
      after: {
        nodeCount: after?.nodeCount,
        durationMs: after?.durationMs,
        rootControlType: after?.tree?.controlType
      }
    };
  });
}

main()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), stack: error?.stack }, null, 2));
    process.exit(1);
  });
