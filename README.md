# Windows Computer Use

Language: English | [简体中文](./README.zh-CN.md)

Control Windows desktop apps with Codex and other MCP agents via UI Automation,
screenshots, and keyboard/mouse input.

Windows Computer Use is a local Windows desktop automation plugin for Codex and
other MCP-capable agent clients. It exposes a stdio MCP server that can inspect
and operate Windows GUI applications.

Use it when an agent needs to work with a real Windows desktop app, such as a
settings dialog, installer, legacy Win32 app, WPF/WinForms app, or another GUI
workflow that does not have a better structured API.

## Requirements

- Windows desktop session.
- Node.js 18 or newer.
- Windows PowerShell 5.1.

The MCP server has no npm install step.

## Installation

### 1. Agent Prompt (Recommended)

If you are already using an agent on a Windows machine, give it this prompt and
let it install and verify the plugin for you:

```text
Install Windows Computer Use from https://github.com/cgissing/windows-computer-use on this Windows machine.

If Codex CLI is available, install it as a Codex plugin:
1. Clone the repository.
2. From the repository root, run:
   codex plugin marketplace add .
   codex plugin add windows-computer-use@computeruse-workspace
3. Verify:
   codex plugin list --marketplace computeruse-workspace
   codex mcp list

If this is not a Codex environment, configure it as a stdio MCP server with:
node <repo>\plugins\windows-computer-use\mcp\server.mjs

Run:
node <repo>\plugins\windows-computer-use\scripts\verify-plugin.mjs

Report the exact files or client settings you changed, and include the final
verification output.
```

### 2. Codex Plugin

Clone this repository, then add the repository root as a Codex plugin
marketplace:

```powershell
git clone https://github.com/cgissing/windows-computer-use.git
cd windows-computer-use
codex plugin marketplace add .
codex plugin add windows-computer-use@computeruse-workspace
```

Check that Codex sees the plugin and its MCP server:

```powershell
codex plugin list --marketplace computeruse-workspace
codex mcp list
```

The plugin entry is defined by:

```text
.agents/plugins/marketplace.json
plugins/windows-computer-use/.codex-plugin/plugin.json
plugins/windows-computer-use/.mcp.json
```

Depending on the Codex app version, start a new thread or restart Codex after
installing so the MCP tools are loaded into new sessions.

### 3. MCP Server

This is the most widely compatible option. Any MCP-capable agent client can run
the same server as a stdio MCP server. Use an absolute path to `mcp/server.mjs`
in the plugin directory:

```json
{
  "mcpServers": {
    "windows-computer-use": {
      "command": "node",
      "args": [
        "D:\\path\\to\\windows-computer-use\\plugins\\windows-computer-use\\mcp\\server.mjs"
      ],
      "env": {
        "WINDOWS_COMPUTER_USE_SCOPE": "active_window"
      }
    }
  }
}
```

If your MCP client supports a working-directory field, this equivalent form is
also valid:

```json
{
  "mcpServers": {
    "windows-computer-use": {
      "command": "node",
      "args": [
        ".\\mcp\\server.mjs"
      ],
      "cwd": "D:\\path\\to\\windows-computer-use\\plugins\\windows-computer-use",
      "env": {
        "WINDOWS_COMPUTER_USE_SCOPE": "active_window"
      }
    }
  }
}
```

You can smoke-test the server from the repository root:

```powershell
node .\plugins\windows-computer-use\scripts\verify-plugin.mjs
node .\plugins\windows-computer-use\mcp\server.mjs --self-test
```

## Exposed MCP Tools

Observation:

- `windows_computer_use_health`
- `windows_computer_use_snapshot`
- `windows_computer_use_accessibility_tree`
- `windows_computer_use_list_windows`
- `windows_computer_use_find`
- `windows_computer_use_element_info`
- `windows_computer_use_activate_window`

Pointer actions:

- `windows_computer_use_move`
- `windows_computer_use_click`
- `windows_computer_use_double_click`
- `windows_computer_use_drag`
- `windows_computer_use_scroll`

Keyboard and text:

- `windows_computer_use_type_text`
- `windows_computer_use_keypress`

Structured UI Automation actions:

- `windows_computer_use_focus`
- `windows_computer_use_invoke`
- `windows_computer_use_set_value`

Timing:

- `windows_computer_use_wait`

Full tool details are in
[`plugins/windows-computer-use/docs/wiki/mcp-tools.md`](./plugins/windows-computer-use/docs/wiki/mcp-tools.md).

## Friendly Links

- [linux.do](https://linux.do/)
