# Windows Computer Use

语言：[English](./README.md) | 简体中文

Windows Computer Use 是一个面向 Windows 桌面的本地自动化插件，可用于 Codex
以及其他支持 MCP 的 agent 客户端。它通过 stdio MCP server 暴露能力，让 agent
可以结合截图、Windows UI Automation 以及键盘和鼠标输入，检查并操作 Windows
GUI 应用。

当 agent 需要处理真实 Windows 桌面程序时，可以使用这个项目。例如设置窗口、
安装器、旧式 Win32 应用、WPF/WinForms 应用，或者其他没有更好结构化 API 的
GUI 工作流。

## 环境要求

- Windows 桌面会话。
- Node.js 18 或更新版本。
- Windows PowerShell 5.1。

MCP server 本身不需要执行 `npm install`。

## 安装方式

### 1. 给 Agent 的安装 Prompt（推荐）

如果你已经在 Windows 机器上使用 agent，可以直接把下面这段 prompt 交给它，
让它自动安装并验证：

```text
在这台 Windows 机器上安装 Windows Computer Use：
https://github.com/cgissing/windows-computer-use

如果当前环境有 Codex CLI，把它安装为 Codex 插件：
1. 克隆仓库。
2. 在仓库根目录运行：
   codex plugin marketplace add .
   codex plugin add windows-computer-use@computeruse-workspace
3. 验证：
   codex plugin list --marketplace computeruse-workspace
   codex mcp list

如果当前环境不是 Codex，把它配置为 stdio MCP server：
node <repo>\plugins\windows-computer-use\mcp\server.mjs

运行：
node <repo>\plugins\windows-computer-use\scripts\verify-plugin.mjs

最后报告你修改了哪些文件或客户端配置，并贴出最终验证结果。
```

### 2. Codex 插件安装

克隆仓库，然后把仓库根目录加入 Codex 插件 marketplace：

```powershell
git clone https://github.com/cgissing/windows-computer-use.git
cd windows-computer-use
codex plugin marketplace add .
codex plugin add windows-computer-use@computeruse-workspace
```

检查 Codex 是否已经识别插件和 MCP server：

```powershell
codex plugin list --marketplace computeruse-workspace
codex mcp list
```

插件入口由这些文件定义：

```text
.agents/plugins/marketplace.json
plugins/windows-computer-use/.codex-plugin/plugin.json
plugins/windows-computer-use/.mcp.json
```

根据 Codex app 版本不同，安装后可能需要新开一个会话或重启 Codex，新的会话才会
加载 MCP 工具。

### 3. MCP Server 安装

这是适用范围最广的方式。任何支持 MCP 的 agent 客户端，都可以把同一个服务作为
stdio MCP server 启动。请在配置中使用插件目录下 `mcp/server.mjs` 的绝对路径：

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

如果你的 MCP 客户端支持工作目录字段，也可以使用下面这种等价配置：

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

可以在仓库根目录运行 smoke test：

```powershell
node .\plugins\windows-computer-use\scripts\verify-plugin.mjs
node .\plugins\windows-computer-use\mcp\server.mjs --self-test
```

## 暴露的 MCP 工具

观察类：

- `windows_computer_use_health`
- `windows_computer_use_snapshot`
- `windows_computer_use_accessibility_tree`
- `windows_computer_use_list_windows`
- `windows_computer_use_find`
- `windows_computer_use_element_info`
- `windows_computer_use_activate_window`

鼠标指针操作：

- `windows_computer_use_move`
- `windows_computer_use_click`
- `windows_computer_use_double_click`
- `windows_computer_use_drag`
- `windows_computer_use_scroll`

键盘和文本：

- `windows_computer_use_type_text`
- `windows_computer_use_keypress`

结构化 UI Automation 操作：

- `windows_computer_use_focus`
- `windows_computer_use_invoke`
- `windows_computer_use_set_value`

等待：

- `windows_computer_use_wait`

完整工具说明见
[`plugins/windows-computer-use/docs/wiki/mcp-tools.md`](./plugins/windows-computer-use/docs/wiki/mcp-tools.md)。

## 友情链接

- [linux.do](https://linux.do/)
