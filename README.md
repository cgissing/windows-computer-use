# Windows Computer Use for Codex

This workspace contains a complete Codex plugin that brings a Computer Use style control surface to Windows through:

- a Codex plugin manifest
- a plugin-managed MCP server
- a Codex skill with operating guidance
- a Windows backend based on .NET UI Automation, screenshots, and input injection
- wiki-style architecture and safety docs

The implementation lives in [plugins/windows-computer-use](./plugins/windows-computer-use).

## What was verified about Codex Computer Use

OpenAI's Codex app documentation says Computer Use is available on macOS at launch, asks for Screen Recording and Accessibility permissions, and uses those permissions so Codex can see, click, type, and navigate apps. The public docs do not name the private implementation class names or confirm `AXUIElement` directly. On macOS, Accessibility permission is the OS gate for assistive UI control, and the engineering-equivalent structured API is the Accessibility API. This project documents that as a strong engineering inference, not as a private-source claim.

## Windows equivalent

The Windows equivalent implemented here uses:

- `System.Windows.Automation` for the accessibility tree and control patterns.
- `System.Drawing` and `System.Windows.Forms` for screenshots.
- Win32 `user32.dll` calls and `SendKeys` for pointer, keyboard, scroll, and drag actions.
- MCP tools that expose the same practical action families as Computer Use: snapshot, click, double click, scroll, type, keypress, drag, move, wait, and structured element actions.

The default accessibility tree is now optimized for agent use: `viewMode="control"`, `includeOffscreen=false`, and `detailLevel="compact"`. This avoids returning hidden provider internals and heavyweight per-node metadata unless a caller explicitly asks for `raw`, offscreen, or full detail.

## Quick validation

From the workspace root:

```powershell
node .\plugins\windows-computer-use\scripts\verify-plugin.mjs
node .\plugins\windows-computer-use\mcp\server.mjs --self-test
node .\plugins\windows-computer-use\scripts\live-app-smoke.mjs
```

`live-app-smoke.mjs` uses only safe targets: Notepad, Calculator, Paint, File Explorer, and local WinForms/WPF fixtures. It avoids dandanplay, Steam Community, BT/resource apps, and network/proxy/VPN tools.

To run the MCP server manually:

```powershell
node .\plugins\windows-computer-use\mcp\server.mjs
```

## Codex app handoff

The repo includes a local marketplace file at [.agents/plugins/marketplace.json](./.agents/plugins/marketplace.json). Open the plugin via the Codex deeplink in the final response or add that marketplace path in the Codex app.
