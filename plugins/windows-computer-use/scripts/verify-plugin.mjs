#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, "..");

const requiredFiles = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "mcp/server.mjs",
  "scripts/browser-complex-smoke.mjs",
  "scripts/live-app-smoke.mjs",
  "scripts/windows-uia.ps1",
  "skills/windows-computer-use/SKILL.md",
  "skills/windows-computer-use/agents/openai.yaml",
  "docs/wiki/Home.md",
  "docs/wiki/architecture.md",
  "docs/wiki/app-technology-matrix.md",
  "docs/wiki/mac-codex-computer-use.md",
  "docs/wiki/mcp-tools.md",
  "docs/wiki/safety.md"
];

async function mustExist(rel) {
  const file = path.join(pluginRoot, rel);
  await access(file);
  return file;
}

async function readJson(rel) {
  return JSON.parse(await readFile(path.join(pluginRoot, rel), "utf8"));
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: pluginRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      ...options
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function mcpSmoke() {
  const child = spawn("node", ["mcp/server.mjs"], {
    cwd: pluginRoot,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));

  const request = (id, method, params = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  child.stdin.write(request(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "verify-plugin", version: "0.1.0" } }));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
  child.stdin.write(request(2, "tools/list"));
  child.stdin.write(request(3, "resources/list"));
  child.stdin.write(request(4, "resources/read", { uri: "windows-computer-use://wiki/architecture" }));
  child.stdin.write(request(5, "tools/call", { name: "windows_computer_use_health", arguments: {} }));
  child.stdin.write(request(6, "tools/call", { name: "windows_computer_use_snapshot", arguments: { scope: "active_window", includeScreenshot: false, maxDepth: 2, maxNodes: 40 } }));
  child.stdin.write(request(7, "tools/call", { name: "windows_computer_use_find", arguments: { scope: "active_window", query: "Codex", maxDepth: 3, maxNodes: 80, maxResults: 10 } }));
  child.stdin.end();

  await new Promise((resolve) => child.on("close", resolve));
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const init = lines.find((line) => line.id === 1);
  const listed = lines.find((line) => line.id === 2);
  const resources = lines.find((line) => line.id === 3);
  const resourceRead = lines.find((line) => line.id === 4);
  const health = lines.find((line) => line.id === 5);
  const snapshot = lines.find((line) => line.id === 6);
  const find = lines.find((line) => line.id === 7);
  if (!init?.result?.serverInfo || !Array.isArray(listed?.result?.tools) || listed.result.tools.length < 18) {
    throw new Error(`MCP smoke test failed. stdout=${stdout} stderr=${stderr}`);
  }
  if (!Array.isArray(resources?.result?.resources) || resources.result.resources.length < 5) {
    throw new Error(`MCP resources/list failed. stdout=${stdout} stderr=${stderr}`);
  }
  if (!resourceRead?.result?.contents?.[0]?.text?.includes("# Architecture")) {
    throw new Error(`MCP resources/read failed. stdout=${stdout} stderr=${stderr}`);
  }
  const healthText = health?.result?.content?.[0]?.text || "";
  const snapshotText = snapshot?.result?.content?.[0]?.text || "";
  if (!healthText.includes('"uiAutomation": true') || !snapshotText.includes('"tree"')) {
    throw new Error(`MCP tool call failed. stdout=${stdout} stderr=${stderr}`);
  }
  const findText = find?.result?.content?.[0]?.text || "";
  if (!findText.includes('"results"') || find?.result?.isError) {
    throw new Error(`MCP find tool call failed. stdout=${stdout} stderr=${stderr}`);
  }
  return {
    serverInfo: init.result.serverInfo,
    tools: listed.result.tools.length,
    resources: resources.result.resources.length,
    health: "ok",
    snapshot: "ok",
    find: "ok"
  };
}

const checks = [];
try {
  for (const rel of requiredFiles) {
    await mustExist(rel);
    checks.push({ ok: true, check: "file", target: rel });
  }

  const manifest = await readJson(".codex-plugin/plugin.json");
  if (manifest.name !== "windows-computer-use") throw new Error("plugin.json name must be windows-computer-use");
  if (manifest.mcpServers !== "./.mcp.json") throw new Error("plugin.json must reference ./.mcp.json");
  if (manifest.skills !== "./skills/") throw new Error("plugin.json must reference ./skills/");
  checks.push({ ok: true, check: "manifest" });

  const mcp = await readJson(".mcp.json");
  const serverConfig = mcp["windows-computer-use"] || mcp.mcp_servers?.["windows-computer-use"] || mcp.mcpServers?.["windows-computer-use"];
  if (!serverConfig) throw new Error(".mcp.json must define windows-computer-use server config");
  if (serverConfig.command !== "node") throw new Error("windows-computer-use MCP command must be node");
  if (!Array.isArray(serverConfig.args) || !serverConfig.args.includes("./mcp/server.mjs")) {
    throw new Error("windows-computer-use MCP args must include ./mcp/server.mjs");
  }
  checks.push({ ok: true, check: "mcp-config" });

  const self = await run("node", ["mcp/server.mjs", "--self-test"]);
  if (self.code !== 0) throw new Error(`self-test failed: ${self.stderr || self.stdout}`);
  checks.push({ ok: true, check: "backend-self-test", result: JSON.parse(self.stdout) });

  checks.push({ ok: true, check: "mcp-smoke", result: await mcpSmoke() });

  console.log(JSON.stringify({ ok: true, pluginRoot, checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, pluginRoot, checks, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
}
