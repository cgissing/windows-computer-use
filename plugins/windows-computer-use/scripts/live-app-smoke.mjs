#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");
const serverPath = path.join(pluginRoot, "mcp", "server.mjs");
const runId = String(Date.now());
const tempRoot = path.join(os.tmpdir(), `windows-cu-live-${runId}`);

const zh = {
  notepad: "\\u8bb0\\u4e8b\\u672c",
  calculator: "\\u8ba1\\u7b97\\u5668",
  paint: "\\u753b\\u56fe"
};

function re(pattern) {
  return new RegExp(pattern, "i");
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function launch(command, args = [], options = {}) {
  if (options.viaStartProcess) {
    const psArgs = `@(${args.map(psQuote).join(",")})`;
    const code = `$p=Start-Process -FilePath ${psQuote(command)} -ArgumentList ${psArgs} -PassThru; $p.Id`;
    const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", code], {
      encoding: "utf8",
      windowsHide: true
    });
    const id = Number(String(result.stdout || "").trim().split(/\s+/).pop());
    return Number.isFinite(id) && id > 0 ? id : null;
  }
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
  return child.pid;
}

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
        reject(new Error(`Could not parse MCP output: ${error.message}\\nstdout=${stdout.slice(0, 2000)}\\nstderr=${stderr}`));
      }
    });
    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
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
        clientInfo: { name: "windows-cu-live-app-smoke", version: "0.1.0" }
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

function imageResult(lines, id) {
  const message = lines.find((line) => line.id === id);
  return message?.result?.content?.find((item) => item.type === "image") || null;
}

async function listWindows() {
  const run = await runMcp([
    ...baseRequests(),
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "windows_computer_use_list_windows",
        arguments: { includeInvisible: true, maxWindows: 250 }
      }
    }
  ]);
  const result = textResult(run.lines, 2);
  return {
    windows: Array.isArray(result?.windows) ? result.windows : [],
    diagnostics: {
      mcpExit: run.code,
      responseIds: run.lines.map((line) => line.id).filter((id) => id !== undefined),
      stderr: run.stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 3),
      hasResult: Boolean(result),
      ok: result?.ok,
      windowCount: Array.isArray(result?.windows) ? result.windows.length : 0
    }
  };
}

function summarizeWindow(window) {
  return {
    name: redact(window.name),
    className: window.className,
    controlType: window.controlType,
    processId: window.processId,
    nativeWindowHandle: window.nativeWindowHandle,
    isOffscreen: window.isOffscreen,
    boundingBox: window.boundingBox
  };
}

async function waitForWindow(app) {
  let lastWindows = [];
  let lastDiagnostics = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const listed = await listWindows();
    const windows = listed.windows;
    lastWindows = windows;
    lastDiagnostics = listed.diagnostics;
    const matched = windows.find((window) => app.match(window));
    if (matched) return { window: matched, candidates: windows, diagnostics: lastDiagnostics };
    await sleep(500);
  }
  return { window: null, candidates: lastWindows, diagnostics: lastDiagnostics };
}

async function closeWindow(target) {
  try {
    const run = await runMcp([
      ...baseRequests(),
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "windows_computer_use_activate_window", arguments: { ...target, activate: true } }
      },
      {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: { name: "windows_computer_use_keypress", arguments: { ...target, activate: true, keys: ["Alt", "F4"] } }
      }
    ]);
    const activated = textResult(run.lines, 12);
    const keypress = textResult(run.lines, 13);
    await sleep(350);
    return {
      ok: Boolean(activated?.ok && keypress?.ok),
      activated: activated?.ok,
      keypress: keypress?.ok,
      mcpExit: run.code,
      mcpStderr: run.stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 3)
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function testApp(app) {
  const launchedPid = launch(app.command, app.args, app.launchOptions);
  await sleep(app.initialDelayMs || 1000);
  const { window, candidates, diagnostics } = await waitForWindow(app);
  if (!window?.nativeWindowHandle) {
    if (launchedPid) {
      spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", `Stop-Process -Id ${Number(launchedPid)} -Force -ErrorAction SilentlyContinue`], {
        windowsHide: true
      });
    }
    return {
      app: app.name,
      ok: false,
      launchedPid,
      error: "No matching top-level window found.",
      listWindowsDiagnostics: diagnostics,
      candidateWindows: candidates.slice(0, 30).map(summarizeWindow)
    };
  }

  const target = { nativeWindowHandle: window.nativeWindowHandle };
  const targetActive = { ...target, activate: true };
  const controlTreeArgs = {
    scope: "active_window",
    ...target,
    viewMode: "control",
    includeOffscreen: false,
    detailLevel: "compact"
  };
  const run = await runMcp([
    ...baseRequests(),
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "windows_computer_use_activate_window", arguments: target }
    },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "windows_computer_use_snapshot",
        arguments: { ...controlTreeArgs, activate: true, includeScreenshot: true, maxDepth: 5, maxNodes: 900 }
      }
    },
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "windows_computer_use_find",
        arguments: { ...controlTreeArgs, query: app.query, maxDepth: 8, maxNodes: 2500, maxResults: 40 }
      }
    },
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "windows_computer_use_find",
        arguments: { ...controlTreeArgs, query: window.className || "Window", maxDepth: 8, maxNodes: 2500, maxResults: 40 }
      }
    },
    {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "windows_computer_use_element_info", arguments: { ...target, viewMode: "control", elementId: "uia:active" } }
    },
    {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "windows_computer_use_move", arguments: { ...target, viewMode: "control", elementId: "uia:active" } }
    },
    {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "windows_computer_use_accessibility_tree",
        arguments: { scope: "active_window", ...target, viewMode: "content", includeOffscreen: false, detailLevel: "compact", maxDepth: 5, maxNodes: 900 }
      }
    },
    {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "windows_computer_use_accessibility_tree",
        arguments: { scope: "active_window", ...target, viewMode: "raw", includeOffscreen: true, detailLevel: "compact", maxDepth: 5, maxNodes: 1500 }
      }
    }
  ]);

  const activated = textResult(run.lines, 3);
  const snapshot = textResult(run.lines, 4);
  const image = imageResult(run.lines, 4);
  const primaryFind = textResult(run.lines, 5);
  const classFind = textResult(run.lines, 6);
  const info = textResult(run.lines, 7);
  const move = textResult(run.lines, 8);
  const contentTree = textResult(run.lines, 9);
  const rawTree = textResult(run.lines, 10);
  const imageBytes = Buffer.byteLength(image?.data || "", "base64");
  const primaryCount = primaryFind?.results?.length || 0;
  const classCount = classFind?.results?.length || 0;
  const descendantCandidate = [...(primaryFind?.results || []), ...(classFind?.results || [])].find(
    (item) => item?.id && item.id !== "uia:active" && item.boundingBox
  );
  let descendantInfo = null;
  if (descendantCandidate) {
    const descendantRun = await runMcp([
      ...baseRequests(),
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "windows_computer_use_element_info",
          arguments: { ...target, viewMode: "control", includeOffscreen: false, elementId: descendantCandidate.id }
        }
      }
    ]);
    const descendant = textResult(descendantRun.lines, 11);
    descendantInfo = {
      ok: descendant?.ok,
      id: descendantCandidate.id,
      name: redact(descendant?.element?.name),
      controlType: descendant?.element?.controlType,
      mcpExit: descendantRun.code,
      mcpStderr: descendantRun.stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 3)
    };
  }

  const cleanup = await closeWindow(target);

  return {
    app: app.name,
    technology: app.technology,
    ok: Boolean(
      activated?.ok &&
        snapshot?.ok &&
        snapshot?.tree?.controlType === "Window" &&
        snapshot.nodeCount > 0 &&
        image?.mimeType === "image/png" &&
        imageBytes > 1000 &&
        primaryFind?.ok &&
        classFind?.ok &&
        (primaryCount > 0 || classCount > 0) &&
        info?.ok &&
        move?.ok &&
        contentTree?.ok &&
        rawTree?.ok &&
        (!descendantCandidate || descendantInfo?.ok)
    ),
    launchedPid,
    window: summarizeWindow(window),
    activated: { ok: activated?.ok, action: activated?.action, windowName: redact(activated?.window?.name) },
    snapshot: {
      ok: snapshot?.ok,
      rootName: redact(snapshot?.tree?.name),
      rootClassName: snapshot?.tree?.className,
      rootControlType: snapshot?.tree?.controlType,
      nodeCount: snapshot?.nodeCount,
      truncated: snapshot?.truncated,
      imageMimeType: image?.mimeType,
      imageBytes,
      screenshotPath: snapshot?.screenshot?.path
    },
    viewProfiles: {
      control: {
        nodeCount: snapshot?.nodeCount,
        durationMs: snapshot?.durationMs,
        truncated: snapshot?.truncated,
        includeOffscreen: snapshot?.includeOffscreen,
        detailLevel: snapshot?.detailLevel
      },
      content: {
        nodeCount: contentTree?.nodeCount,
        durationMs: contentTree?.durationMs,
        truncated: contentTree?.truncated,
        includeOffscreen: contentTree?.includeOffscreen,
        detailLevel: contentTree?.detailLevel
      },
      raw: {
        nodeCount: rawTree?.nodeCount,
        durationMs: rawTree?.durationMs,
        truncated: rawTree?.truncated,
        includeOffscreen: rawTree?.includeOffscreen,
        detailLevel: rawTree?.detailLevel
      },
      rawToControlRatio:
        rawTree?.nodeCount && snapshot?.nodeCount ? Number((rawTree.nodeCount / snapshot.nodeCount).toFixed(2)) : null
    },
    find: {
      primary: { query: app.query, ok: primaryFind?.ok, count: primaryCount, scannedNodes: primaryFind?.scannedNodes, truncated: primaryFind?.truncated },
      className: { query: window.className || "Window", ok: classFind?.ok, count: classCount, scannedNodes: classFind?.scannedNodes, truncated: classFind?.truncated }
    },
    elementInfo: {
      ok: info?.ok,
      elementName: redact(info?.element?.name),
      controlType: info?.element?.controlType,
      className: info?.element?.className,
      nativeWindowHandle: info?.element?.nativeWindowHandle
    },
    safeMove: move,
    descendantInfo,
    cleanup,
    mcpExit: run.code,
    mcpStderr: run.stderr.trim().split(/\r?\n/).filter(Boolean).slice(0, 3)
  };
}

await mkdir(tempRoot, { recursive: true });
const notepadFile = path.join(tempRoot, `notepad-smoke-${runId}.txt`);
const explorerDir = path.join(tempRoot, `explorer-smoke-${runId}`);
const winformsScript = path.join(tempRoot, `winforms-smoke-${runId}.ps1`);
const wpfScript = path.join(tempRoot, `wpf-smoke-${runId}.ps1`);
await mkdir(explorerDir, { recursive: true });
await writeFile(notepadFile, `Windows Computer Use live smoke ${runId}\r\n`, "utf8");
await writeFile(
  winformsScript,
  `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = "Windows CU WinForms Fixture ${runId}"
$form.Name = "WindowsCUWinFormsFixture"
$form.Width = 620
$form.Height = 360
$form.StartPosition = "CenterScreen"
$label = New-Object System.Windows.Forms.Label
$label.Text = "Customer"
$label.AutoSize = $true
$label.Location = New-Object System.Drawing.Point(24, 28)
$text = New-Object System.Windows.Forms.TextBox
$text.Name = "CustomerName"
$text.Text = "Ada Lovelace"
$text.Width = 220
$text.Location = New-Object System.Drawing.Point(24, 56)
$check = New-Object System.Windows.Forms.CheckBox
$check.Name = "PriorityOrder"
$check.Text = "Priority order"
$check.AutoSize = $true
$check.Location = New-Object System.Drawing.Point(24, 94)
$list = New-Object System.Windows.Forms.ListBox
$list.Name = "StatusList"
$list.Items.AddRange(@("Draft", "Ready", "Sent"))
$list.Location = New-Object System.Drawing.Point(280, 56)
$button = New-Object System.Windows.Forms.Button
$button.Name = "SubmitOrder"
$button.Text = "Submit"
$button.Location = New-Object System.Drawing.Point(24, 140)
$form.Controls.AddRange(@($label, $text, $check, $list, $button))
$form.Add_Shown({ $form.Activate() })
[System.Windows.Forms.Application]::Run($form)
`.trimStart(),
  "utf8"
);
await writeFile(
  wpfScript,
  `
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
$window = New-Object System.Windows.Window
$window.Title = "Windows CU WPF Fixture ${runId}"
$window.Width = 640
$window.Height = 380
$window.WindowStartupLocation = "CenterScreen"
$panel = New-Object System.Windows.Controls.StackPanel
$panel.Margin = New-Object System.Windows.Thickness(24)
$label = New-Object System.Windows.Controls.TextBlock
$label.Text = "Filter"
$box = New-Object System.Windows.Controls.TextBox
$box.Name = "FilterBox"
$box.Text = "Invoices"
$box.Margin = New-Object System.Windows.Thickness(0, 8, 0, 12)
$button = New-Object System.Windows.Controls.Button
$button.Name = "ApplyFilter"
$button.Content = "Apply filter"
$button.Width = 120
$button.HorizontalAlignment = "Left"
$check = New-Object System.Windows.Controls.CheckBox
$check.Name = "IncludeArchived"
$check.Content = "Include archived"
$check.Margin = New-Object System.Windows.Thickness(0, 12, 0, 0)
$panel.Children.Add($label) | Out-Null
$panel.Children.Add($box) | Out-Null
$panel.Children.Add($button) | Out-Null
$panel.Children.Add($check) | Out-Null
$window.Content = $panel
$window.Add_ContentRendered({ $window.Activate() })
$window.ShowDialog() | Out-Null
`.trimStart(),
  "utf8"
);

const basename = {
  notepad: path.basename(notepadFile),
  explorer: path.basename(explorerDir)
};

const apps = [
  {
    name: "Notepad",
    technology: "Win32/classic text editor",
    command: "notepad.exe",
    args: [notepadFile],
    query: "Notepad",
    match: (window) => {
      const name = window.name || "";
      return (window.className === "Notepad" && name.includes(basename.notepad)) || name.includes(basename.notepad);
    }
  },
  {
    name: "Calculator",
    technology: "UWP/WinUI packaged app",
    command: "calc.exe",
    args: [],
    query: "Calculator",
    initialDelayMs: 1500,
    match: (window) => window.className === "ApplicationFrameWindow" && re(`Calculator|${zh.calculator}`).test(window.name || "")
  },
  {
    name: "Paint",
    technology: "Native Windows drawing app",
    command: "mspaint.exe",
    args: [],
    query: "Paint",
    initialDelayMs: 1500,
    match: (window) => window.className === "MSPaintApp" && re(`Paint|${zh.paint}`).test(window.name || "")
  },
  {
    name: "File Explorer",
    technology: "Win32 shell window",
    command: "explorer.exe",
    args: [explorerDir],
    query: basename.explorer,
    initialDelayMs: 1500,
    match: (window) => window.className === "CabinetWClass" && (window.name || "").includes(basename.explorer)
  },
  {
    name: "WinForms Fixture",
    technology: ".NET WinForms local fixture",
    command: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-File", winformsScript],
    launchOptions: { viaStartProcess: true },
    query: "Ada Lovelace",
    initialDelayMs: 1200,
    match: (window) => (window.name || "").includes(`Windows CU WinForms Fixture ${runId}`)
  },
  {
    name: "WPF Fixture",
    technology: ".NET WPF local fixture",
    command: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-File", wpfScript],
    launchOptions: { viaStartProcess: true },
    query: "Apply filter",
    initialDelayMs: 1200,
    match: (window) => (window.name || "").includes(`Windows CU WPF Fixture ${runId}`)
  }
];

const results = [];
for (const app of apps) {
  results.push(await testApp(app));
}

const summary = {
  ok: results.every((result) => result.ok),
  pluginRoot,
  tempRoot,
  policy: {
    allowlist: apps.map((app) => app.name),
    avoided: ["dandanplay", "Steam Community", "network/proxy/VPN tools", "BT/download/resource apps"],
    actions: ["list_windows", "activate_window", "snapshot", "accessibility_tree", "find", "element_info", "move", "keypress for closing test windows"]
  },
  results
};

console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.ok ? 0 : 1;
