---
name: jetbrains-mcp-bridge-setup
description: Interactive setup for JetBrains MCP Bridge configuration
---

# JetBrains MCP Bridge - Interactive Setup

引导用户完成 JetBrains MCP Bridge 的初始化配置。

**说明：** 以下命令使用 POSIX/bash 语法，通过 Claude Code 的 Bash 工具（Git Bash）执行。
在 Windows 上需确保 Git for Windows 已安装（提供 Git Bash）。

## 执行步骤

### Step 0: 确认插件目录

插件根目录已在加载时解析，直接使用：`${CLAUDE_PLUGIN_ROOT}`

确认目录存在：

```bash
test -d "${CLAUDE_PLUGIN_ROOT}" && echo "插件目录: ${CLAUDE_PLUGIN_ROOT}" || echo "插件目录不存在"
```

### Step 1: 复制全局配置

检查用户级配置是否已存在：

```bash
test -f ~/.claude/jetbrains-mcp-bridge.json5 && echo "已存在" || echo "不存在"
```

如果已存在，使用 AskUserQuestion 询问：**覆盖** 或 **跳过**。

复制默认配置到用户级：

```bash
cp "${CLAUDE_PLUGIN_ROOT}/config/default-global.json5" ~/.claude/jetbrains-mcp-bridge.json5
```

### Step 2: 复制项目级配置

检查项目级配置是否已存在：

```bash
test -f .claude/jetbrains-mcp-bridge.json5 && echo "已存在" || echo "不存在"
```

如果不存在，复制示例项目配置并设置 projectPath 为当前目录：

```bash
mkdir -p .claude
cp "${CLAUDE_PLUGIN_ROOT}/config/example-project.json5" .claude/jetbrains-mcp-bridge.json5
```

然后使用 Read + Edit 工具将 `.claude/jetbrains-mcp-bridge.json5` 中的 `projectPath: ""` 替换为 `projectPath: "${CLAUDE_PROJECT_DIR}"`。

如果已存在，使用 AskUserQuestion 询问：**覆盖** 或 **跳过**。

### Step 3: 选择需要配置的 IDE

使用 AskUserQuestion（multiSelect: true）让用户选择需要配置 MCP 端口的 IDE：

```
支持的 JetBrains IDE：
  1. IntelliJ IDEA
  2. WebStorm
  3. PyCharm
  4. GoLand
  5. RustRover
  6. CLion
  7. PhpStorm
  8. RubyMine
  9. Rider
```

用户可多选。记录选中的 IDE 列表。

### Step 4: 配置选中 IDE 的端口

对 Step 3 中每个选中的 IDE，使用 AskUserQuestion 询问端口号：
- **填写端口** — 用户输入端口号（如 63342）
- **跳过** — 不配置此 IDE

### Step 5: 生成 .mcp.json

根据 Step 4 用户填写的端口，生成 `.mcp.json`。写入插件根目录（`${CLAUDE_PLUGIN_ROOT}`），Claude Code MCP 加载器从此路径发现服务器。

使用 Write 工具将生成的 JSON 写入 `${CLAUDE_PLUGIN_ROOT}/.mcp.json`。

规则：
- 仅包含用户填写了端口的 IDE
- 跳过的 IDE 不写入
- MCP 服务器名使用短名称（如 `IDEA`、`WebStorm`、`PyCharm`）
- 如果 `.mcp.json` 已存在，直接覆盖

生成的格式示例：
```json
{
  "mcpServers": {
    "IDEA": {
      "type": "sse",
      "url": "http://127.0.0.1:63342/sse"
    }
  }
}
```

### Step 6: 完成

提示用户：
- 全局配置：`~/.claude/jetbrains-mcp-bridge.json5`
- 项目配置：`.claude/jetbrains-mcp-bridge.json5`（projectPath 已设置）
- MCP 服务器：`${CLAUDE_PLUGIN_ROOT}/.mcp.json`
- **重启 Claude Code 会话**以加载 MCP 服务器并启用拦截功能

## 注意事项

- 端口默认从 63342 开始，先启动的 IDE 占用更小的端口
- 配置文件使用 JSON5 格式，支持注释和尾逗号
- `.mcp.json` 使用标准 JSON 格式
- 可随时编辑配置文件自定义拦截规则
