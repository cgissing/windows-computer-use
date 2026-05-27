---
name: windows-computer-use
description: "Use when Codex needs to inspect or operate Windows desktop applications through a Computer Use style interface. Provides guidance for the windows-computer-use MCP tools that capture screenshots, read UI Automation accessibility trees, click, type, scroll, drag, invoke controls, set values, and validate GUI workflows on Windows."
---

# Windows Computer Use

Use this skill when the task requires a Windows graphical user interface and a structured integration, CLI command, file inspection, or browser-specific tool is not enough.

Prefer a structured app plugin or API when one exists. Use Windows Computer Use for scoped visual workflows, native desktop apps, settings dialogs, installers, legacy apps, and bugs that only reproduce in the GUI.

## Workflow

1. Start with `windows_computer_use_health` if this is the first desktop action in the thread.
2. Observe before acting:
   - Use `windows_computer_use_snapshot` when visual layout matters.
   - Use `windows_computer_use_accessibility_tree` when names, roles, values, and element ids matter.
   - Use `windows_computer_use_find` to narrow large trees.
3. Start with the default tree options: `viewMode="control"`, `includeOffscreen=false`, and `detailLevel="compact"`. Use `content` for reading visible content. Use `raw` and `includeOffscreen=true` only when a control is missing or the app has a custom/sparse provider.
4. When focus may move or multiple windows are open, call `windows_computer_use_list_windows` and pass `nativeWindowHandle`, `processId`, or `windowTitle` to subsequent tools. Use `activate=true` when the target window must be foregrounded.
5. Prefer element actions over raw coordinates:
   - Use `windows_computer_use_invoke` for buttons, menu items, checkboxes, radio buttons, list items, and expanders.
   - Use `windows_computer_use_set_value` for editable controls.
   - Use `windows_computer_use_focus` before keyboard-only flows.
6. Use coordinate actions when the UI Automation tree is empty, stale, canvas-based, or visually clearer than the tree.
7. Re-observe after each click, invocation, typing action, drag, navigation, dialog open, or state-changing keypress.

## Safety

Keep the task narrow and stay inside the user-approved app or window. Ask before account, security, privacy, payment, credential, destructive, irreversible, or cross-account actions. Stop if the active window is not the intended target.

Do not automate Codex itself, terminal approval prompts, system security prompts, administrator authentication, or any action that would bypass Codex approvals.

## Tool Notes

Element ids look like `uia:active.0.2` or `uia:root.4.1`. They are path ids from the latest accessibility snapshot. If an element id becomes stale, take a new tree and select the new id.

Element ids are relative to the tree view that produced them. If you observed with `viewMode="raw"` or `includeOffscreen=true`, pass the same values when resolving that id in `element_info`, `move`, `click`, `focus`, `invoke`, or `set_value`.

When a target window is supplied, `uia:active` resolves against that target for the current call. Prefer `nativeWindowHandle` from `windows_computer_use_list_windows` for repeatable app testing.

Positive `deltaY` in `windows_computer_use_scroll` scrolls down. Text input uses clipboard paste for Unicode reliability and restores the previous text clipboard content by default.

Use `windows_computer_use_list_windows` when the wrong app is active or when you need to understand which top-level windows are visible.

## Useful References

Read `docs/wiki/mcp-tools.md` for the full tool contract, `docs/wiki/app-technology-matrix.md` for app-stack behavior, `docs/wiki/architecture.md` for implementation details, and `docs/wiki/safety.md` before high-impact workflows.
