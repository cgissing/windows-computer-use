# Windows Computer Use

Windows Computer Use is a local Codex plugin that exposes Windows desktop
automation through an MCP server. It lets Codex inspect and operate scoped
Windows GUI workflows by combining screenshots, Windows UI Automation, and
keyboard/mouse input.

This is a Windows implementation built on public Windows APIs. It is inspired
by the practical action model of Computer Use, but it is not a claim about
OpenAI's private implementation details.

## What It Provides

- A Codex plugin manifest.
- A plugin-local MCP server.
- A Codex skill with operating and safety guidance.
- A Windows PowerShell backend for UI Automation, screenshots, and input.
- Wiki-style documentation for architecture, MCP tools, app behavior, and
  safety rules.

The plugin implementation lives in
[`plugins/windows-computer-use`](./plugins/windows-computer-use).

## How It Works

```text
Codex
  -> plugins/windows-computer-use/.mcp.json
  -> node ./mcp/server.mjs
  -> powershell.exe -Sta ./scripts/windows-uia.ps1
  -> Windows UI Automation / screenshots / user32 input
```

The backend uses:

- `System.Windows.Automation` for accessibility trees and control patterns.
- `System.Drawing` and `System.Windows.Forms` for screenshot capture.
- Win32 `user32.dll` and `SendKeys` for pointer, keyboard, scroll, and drag
  actions.

The default tree view is optimized for agent use:

```text
viewMode = "control"
includeOffscreen = false
detailLevel = "compact"
```

Use `raw`, `includeOffscreen=true`, or `detailLevel="full"` only when debugging
missing controls or unusual custom UI providers.

## Requirements

- Windows desktop session.
- Node.js 18 or newer.
- Windows PowerShell 5.1.
- Standard Windows UI Automation, Windows Forms, and Drawing assemblies.

No npm install is required for the MCP server itself.

## Use With Codex

This repository includes a local marketplace file:

```text
.agents/plugins/marketplace.json
```

Add this repository's marketplace file to Codex, or install the plugin from the
`plugins/windows-computer-use` directory if your Codex build supports local
plugin installation.

The plugin registers the MCP server through:

```text
plugins/windows-computer-use/.mcp.json
```

Codex will start the MCP server when it needs the tools.

## Manual Use

You can run the MCP server directly:

```powershell
node .\plugins\windows-computer-use\mcp\server.mjs
```

You can also call the backend helper path for local debugging:

```powershell
'{"includeInvisible":true,"maxWindows":50}' |
  node .\plugins\windows-computer-use\mcp\server.mjs --backend list_windows
```

## Validation

Run the static and MCP smoke checks from the repository root:

```powershell
node .\plugins\windows-computer-use\scripts\verify-plugin.mjs
node .\plugins\windows-computer-use\mcp\server.mjs --self-test
```

Optional live smoke tests launch and inspect safe local apps:

```powershell
node .\plugins\windows-computer-use\scripts\live-app-smoke.mjs
node .\plugins\windows-computer-use\scripts\browser-complex-smoke.mjs
```

The live smoke suite uses safe targets such as Notepad, Calculator, Paint, File
Explorer, local WinForms/WPF fixtures, and an isolated local browser fixture. It
intentionally avoids network/proxy/VPN tools, download clients, and apps that
could change machine state outside the test.

Local validation notes can include machine-specific paths or window details and
are intentionally ignored by Git:

```text
plugins/windows-computer-use/docs/wiki/validation.md
```

## MCP Tools

The MCP server exposes observation, pointer, keyboard, and structured UI
Automation actions, including:

- `windows_computer_use_health`
- `windows_computer_use_snapshot`
- `windows_computer_use_accessibility_tree`
- `windows_computer_use_list_windows`
- `windows_computer_use_find`
- `windows_computer_use_click`
- `windows_computer_use_double_click`
- `windows_computer_use_scroll`
- `windows_computer_use_type_text`
- `windows_computer_use_keypress`
- `windows_computer_use_drag`
- `windows_computer_use_focus`
- `windows_computer_use_invoke`
- `windows_computer_use_set_value`
- `windows_computer_use_activate_window`

See [`docs/wiki/mcp-tools.md`](./plugins/windows-computer-use/docs/wiki/mcp-tools.md)
for the tool contract.

## Safety

Computer use can affect applications and system state outside the repository.
Use it only for scoped workflows in user-approved windows.

Default safety rules:

- Observe before acting.
- Re-observe after state-changing actions.
- Prefer UI Automation element actions over coordinates when stable elements
  are available.
- Target sensitive or multi-window workflows by HWND, process id, or window
  title.
- Ask before account, privacy, credential, payment, destructive, sending,
  publishing, or hard-to-reverse actions.
- Do not automate Codex itself, terminal approval prompts, administrator
  authentication, UAC prompts, password managers, or secret reveal dialogs.

See [`docs/wiki/safety.md`](./plugins/windows-computer-use/docs/wiki/safety.md)
for the detailed safety guide.

## Known Limits

- Some applications expose sparse or misleading UI Automation trees.
- Java/Swing, game, canvas, PDF, and custom-rendered views may require
  screenshot plus coordinate actions.
- Element path ids can become stale after UI changes.
- Coordinate actions depend on the active desktop session and display geometry.
- Secure desktop prompts, administrator prompts, and lock screens are not
  supported.
- Clipboard-backed text input restores prior text content by default, but
  non-text clipboard formats may not be preserved.
