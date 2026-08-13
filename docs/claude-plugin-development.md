# Claude Code 插件开发参考文档

> 基于 Anthropic 官方文档整理，适用于 JetBrains MCP Bridge 插件开发。
> 文档来源：`docs.anthropic.com/en/docs/claude-code/*`

---

## 1. 插件环境变量

Claude Code 为每个 hook、monitor、MCP server 进程注入以下环境变量：

| 环境变量 | 描述 | 生命周期 |
|---|---|---|
| `CLAUDE_PROJECT_DIR` | 项目根目录（稳定，会话内不变） | 会话级 |
| `CLAUDE_PLUGIN_ROOT` | 插件安装目录（含 `.claude-plugin/`） | **临时** — 插件更新后改变 |
| `CLAUDE_PLUGIN_DATA` | 插件持久数据目录 | **持久** — 仅卸载时删除 |
| `CLAUDE_PLUGIN_OPTION_<KEY>` | 用户配置选项值（KEY 大写） | 会话级 |

### 1.1 路径占位符 vs 环境变量

在 hooks.json、MCP 服务器配置、skill 内容中，可以使用路径占位符：

| 占位符 | 说明 |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | 在 hook 命令、MCP command/args/env、skill 内容中自动解析 |
| `${CLAUDE_PLUGIN_DATA}` | 同上 |
| `${CLAUDE_PROJECT_DIR}` | 同上 |

**区别：**
- `${CLAUDE_PLUGIN_ROOT}` — **路径占位符**，由 Claude Code 在启动进程前自动替换为实际路径
- `$CLAUDE_PLUGIN_ROOT` — **Shell 环境变量**，由 shell 进程在运行时展开
- `process.env.CLAUDE_PLUGIN_ROOT` — **Node.js 读取**，在 hook 脚本中使用

**最佳实践：** hooks.json 中用 `${...}` 占位符，hook 脚本中用 `process.env.CLAUDE_*`

### 1.2 安装路径说明

| 来源 | 路径 |
|---|---|
| 插件安装目录 | `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` |
| 插件持久数据 | `~/.claude/plugins/data/<plugin-name>/` |
| 已注册插件清单 | `~/.claude/plugins/installed_plugins.json` |

---

## 2. 插件清单（plugin.json）

**位置：** `.claude-plugin/plugin.json`（位于插件根目录）

### 2.1 完整 Schema

```json
{
  "$schema": "https://json.schemastore.org/claude-plugin.json",
  "name": "plugin-name",
  "displayName": "Plugin Name",
  "version": "1.2.0",
  "description": "Brief plugin description",
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://github.com/author"
  },
  "homepage": "https://docs.example.com/plugin",
  "repository": "https://github.com/author/plugin",
  "license": "MIT",
  "keywords": ["keyword1", "keyword2"],
  "metadata": { "catalogId": "cat-123", "tier": "pro" },
  "defaultEnabled": true,

  "skills": ["./custom/skills/"],
  "commands": ["./commands/deploy.md"],
  "agents": ["./custom/agents/reviewer.md"],
  "workflows": ["./custom/workflows/"],
  "hooks": "./config/hooks.json",
  "mcpServers": "./mcp-config.json",
  "outputStyles": "./styles/",
  "lspServers": "./.lsp.json",

  "experimental": {
    "monitors": ["./monitors/monitors.json"],
    "themes": ["./themes/"]
  },

  "userConfig": {
    "option_name": {
      "type": "string",
      "description": "Description of the option",
      "sensitive": false,
      "required": false,
      "default": ""
    }
  }
}
```

### 2.2 核心字段

| 字段 | 类型 | 必填 | 描述 |
|---|---|---|---|
| `name` | string | **是** | 插件标识符，必须唯一 |
| `displayName` | string | 否 | UI 显示名称 |
| `version` | string | 否 | 语义版本号，用于更新检测 |
| `description` | string | 否 | 简短描述 |
| `author` | object/string | 否 | 作者信息 |
| `homepage` | string | 否 | 文档 URL |
| `repository` | string | 否 | 源码仓库 URL |
| `license` | string | 否 | 许可证标识符 |
| `keywords` | string[] | 否 | 搜索关键词 |
| `defaultEnabled` | boolean | 否 | 是否默认启用（用户可覆盖） |

### 2.3 组件路径字段

| 字段 | 默认目录 | 行为 |
|---|---|---|
| `skills` | `skills/` | **追加**到默认路径（始终扫描 `skills/` + 自定义路径） |
| `commands` | `commands/` | **替换**默认路径 |
| `agents` | `agents/` | **替换**默认路径 |
| `workflows` | `workflows/` | **替换**默认路径 |
| `hooks` | `hooks/hooks.json` | 与默认 hooks 合并 |
| `mcpServers` | `.mcp.json` | 与默认 MCP 配置合并 |
| `outputStyles` | `output-styles/` | **替换**默认路径 |
| `lspServers` | `.lsp.json` | 与默认 LSP 配置合并 |

**路径规则：** 所有路径必须相对于插件根目录，以 `./` 开头。`skills` 额外接受 `"."` 表示插件根目录本身。

### 2.4 userConfig 用户配置

在 `plugin.json` 中定义 `userConfig` 后，每个选项的值通过 `CLAUDE_PLUGIN_OPTION_<KEY>` 环境变量注入 hook 进程（KEY 为大写）。

```json
{
  "userConfig": {
    "debug": {
      "type": "boolean",
      "default": false,
      "description": "Enable debug logging"
    },
    "api_key": {
      "type": "string",
      "sensitive": true,
      "required": true
    }
  }
}
```

对应环境变量：`CLAUDE_PLUGIN_OPTION_DEBUG`、`CLAUDE_PLUGIN_OPTION_API_KEY`

---

## 3. Hook 系统

### 3.1 支持的 Hook 事件

| 事件 | 触发时机 | 可阻止？ |
|---|---|---|
| `Setup` | `--init-only` 或 `--init`/`--maintenance` | 否 |
| `SessionStart` | 会话启动 | 是（exit 2） |
| `UserPromptSubmit` | 用户提交 prompt | 是（exit 2） |
| `PreToolUse` | **工具调用前** | **是（exit 2）** |
| `PostToolUse` | 工具调用成功后 | 是（通过 JSON） |
| `PostToolUseFailure` | 工具调用失败后 | 是（通过 JSON） |
| `PostToolBatch` | 并行工具调用批次完成后 | 是（通过 JSON） |
| `PreCompact` | 上下文压缩前 | 是（exit 2） |
| `PostCompact` | 上下文压缩后 | 否 |
| `InstructionsLoaded` | CLAUDE.md / rules 文件加载时 | 否 |
| `Cd` | Claude 执行 cd 命令时 | 否 |
| `DirectoryAdded` | 会话中添加工作目录 | 否 |
| `FileChanged` | 监视的文件在磁盘上变更 | 否 |
| `SessionEnd` | 会话终止 | 否 |

### 3.2 PreToolUse 输入（stdin JSON）

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../<session-id>.jsonl",
  "cwd": "/Users/me/my-project",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_use_id": "toolu_abc123",
  "tool_input": {
    "command": "ls -la",
    "description": "List files in current directory"
  }
}
```

**通用字段（所有事件）：**
- `session_id` — 唯一会话标识符
- `transcript_path` — 会话 transcript JSONL 文件路径
- `cwd` — 当前工作目录
- `permission_mode` — 当前权限模式（`"default"`、`"bypassPermissions"` 等）
- `hook_event_name` — 触发事件名

**PreToolUse 专属字段：**
- `tool_name` — 工具名（`"Bash"`、`"Read"`、`"Write"`、`"Edit"`、`"Glob"`、`"Grep"` 等）
- `tool_use_id` — 唯一工具调用 ID
- `tool_input` — 完整的工具输入对象（因工具而异）

### 3.3 Hook 退出码

| 退出码 | 含义 |
|---|---|
| `0` | 允许/继续。无决定 = 正常权限流程 |
| `1` | 非阻塞错误。Claude Code 继续执行 |
| `2` | **阻塞错误**。阻止工具调用（PreToolUse）或拒绝 prompt（UserPromptSubmit） |

### 3.4 Hook 输出（stdout JSON）

**PreToolUse 输出：**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Auto-approved by policy",
    "updatedInput": { "command": "ls -la" },
    "additionalContext": "Some extra context for Claude"
  }
}
```

| 字段 | 可选值 | 描述 |
|---|---|---|
| `permissionDecision` | `"allow"`, `"deny"`, `"ask"`, `"defer"` | 控制工具调用是否继续 |
| `permissionDecisionReason` | string | allow/ask: 展示给用户；deny: 展示给 Claude |
| `updatedInput` | object | 替换工具的输入参数 |
| `additionalContext` | string | 附加到 Claude 上下文中 |

**决策优先级（多 hook 返回不同决策时）：** `deny` > `defer` > `ask` > `allow`

### 3.5 hooks.json 配置格式

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Read|Write|Edit|Glob|Grep",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/my-hook.mjs"],
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

**Hook 条目字段：**

| 字段 | 必填 | 描述 |
|---|---|---|
| `matcher` | 否 | 正则匹配工具名（空字符串或省略 = 匹配全部） |
| `hooks` | 是 | Hook 定义数组 |

**Hook 定义字段（command 类型）：**

| 字段 | 必填 | 描述 |
|---|---|---|
| `type` | 是 | `"command"` |
| `command` | 是 | 可执行文件路径或命令 |
| `args` | 否 | 参数数组。有 `args` 时 command 直接 spawn（exec form）；无 args 时通过 shell 执行（shell form） |
| `timeout` | 否 | 超时秒数。PreToolUse 超时不阻止工具调用 |
| `async` | 否 | `true` = 后台运行不阻塞 |
| `asyncRewake` | 否 | `true` = 后台运行，exit 2 时唤醒 Claude（隐含 async） |
| `shell` | 否 | `"bash"` 或 `"powershell"`。有 `args` 时忽略 |

**关键约束：**
- **超时**：PreToolUse hook 超时不阻止工具调用，调用继续正常权限流程
- **Exit 2 始终阻止**：即使 JSON 输出 `"allow"`，exit 2 仍会阻止
- **exec-form vs shell-form**：引用路径占位符时用 exec-form（`command` + `args`）；需要管道、重定向时用 shell-form
- **Shell 注入防护**：shell-form 拒绝 `${user_config.*}` 替换。用 exec-form 或 `CLAUDE_PLUGIN_OPTION_<KEY>` 环境变量代替

---

## 4. Skill 系统

### 4.1 目录结构

```
skills/
  my-skill/
    SKILL.md          # 必需 — 技能定义
    reference.md      # 可选 — 补充参考
    scripts/          # 可选 — 辅助脚本
```

### 4.2 SKILL.md Frontmatter

```yaml
---
name: my-skill-name
description: What this skill does
disable-model-invocation: false
user-invocable: true
context: inline
allowed-tools: [Bash, Read, Write]
model: sonnet
---
```

| 字段 | 类型 | 默认值 | 描述 |
|---|---|---|---|
| `name` | string | 目录名 | 技能调用名，控制 `/name` 斜杠命令 |
| `description` | string | — | 简短描述，显示在技能菜单中 |
| `disable-model-invocation` | boolean | `false` | `true` = 仅用户可通过 `/name` 调用，Claude 不能自动调用 |
| `user-invocable` | boolean | `true` | 控制菜单可见性（不影响 Skill 工具访问） |
| `context` | string | `"inline"` | `"inline"` = 当前上下文运行；`"fork"` = 子代理运行 |
| `allowed-tools` | string[] | — | 技能期间免审批的工具列表 |
| `model` | string | — | 模型覆盖（如 `"haiku"`、`"sonnet"`、`"opus"`） |

### 4.3 Skill 调用方式

- **用户调用：** `/skill-name` 或 `/plugin-name:skill-name`（插件 skill 带命名空间）
- **模型调用：** Claude 使用 `Skill` 工具。由 `disable-model-invocation` 控制
- **Frontmatter name：** 替换目录名的最后一段。如 `skills/setup/SKILL.md` 中 `name: my-setup` 成为 `/plugin-name:my-setup`

### 4.4 内容生命周期

Skill 内容加载后会跨轮次保留在上下文中（每轮有 token 成本）。保持正文简洁。

---

## 5. MCP 服务器配置

### 5.1 .mcp.json 格式

```json
{
  "mcpServers": {
    "stdio-server": {
      "type": "stdio",
      "command": "node",
      "args": ["./server.mjs"],
      "env": { "API_KEY": "..." }
    },
    "http-server": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer token" }
    },
    "sse-server": {
      "type": "sse",
      "url": "http://localhost:63342/sse"
    },
    "ws-server": {
      "type": "ws",
      "url": "ws://localhost:8080/ws"
    }
  }
}
```

### 5.2 服务器类型

**stdio（本地进程）：**

| 字段 | 必填 | 描述 |
|---|---|---|
| `type` | 否 | 默认 `"stdio"` |
| `command` | 是 | 可执行文件名或路径 |
| `args` | 否 | 参数数组 |
| `env` | 否 | 进程环境变量 |

**http（远程，推荐云服务）：**

| 字段 | 必填 | 描述 |
|---|---|---|
| `type` | 是 | `"http"` 或 `"streamable-http"` |
| `url` | 是 | 服务器 URL |
| `headers` | 否 | 静态 headers |
| `headersHelper` | 否 | 生成动态 headers 的命令 |

**sse（Server-Sent Events）：**

| 字段 | 必填 | 描述 |
|---|---|---|
| `type` | 是 | `"sse"` |
| `url` | 是 | SSE 端点 |
| `headers` | 否 | 静态 headers |

**ws（WebSocket）：**

| 字段 | 必填 | 描述 |
|---|---|---|
| `type` | 是 | `"ws"` |
| `url` | 是 | WebSocket 端点 |

### 5.3 .mcp.json 查找位置

- 项目级：`<project-root>/.mcp.json`
- 插件级：`<plugin-root>/.mcp.json`
- 用户级：`~/.claude.json` 中的 MCP 配置
- 管理设置

### 5.4 关键规则

- 有 `url` 字段但无 `type` 是**配置错误**
- `CLAUDE_PROJECT_DIR` 在 stdio 服务器的环境中设置
- 插件 MCP 服务器在 `command`、`args`、`env` 中使用 `${CLAUDE_PLUGIN_ROOT}`

---

## 6. 插件结构最佳实践

1. **目录位于插件根目录，不在 `.claude-plugin/` 内**：`skills/`、`commands/`、`hooks/`、`agents/` 必须与 `.claude-plugin/` 同级
2. **使用 `./` 前缀的相对路径**：plugin.json 中所有路径字段必须相对于插件根目录
3. **在 SKILL.md 中设置 `name`**：不设置时技能名回退到安装目录名（marketplace 插件是版本字符串，每次更新改变）
4. **所有插件路径使用 `${CLAUDE_PLUGIN_ROOT}`**：hook 命令、MCP 服务器、skill 内容中。不要硬编码绝对路径
5. **`${CLAUDE_PLUGIN_ROOT}` 是临时的**：插件更新后改变。不要在那里写持久状态。用 `${CLAUDE_PLUGIN_DATA}` 存储持久数据
6. **运行时零外部依赖**：优先用 esbuild/rollup 打包。Claude Code 会自动从 `package.json` + lockfile 安装 npm 依赖
7. **验证插件**：`claude plugin validate ./my-plugin` 或 `/plugin validate ./my-plugin`
8. **CI 中用 `--strict`**：将未识别字段警告视为错误

### 6.1 安全约束

- 项目级插件需要工作区信任批准
- 项目级 MCP 服务器需要逐服务器批准
- 项目级 monitors 不加载（仅个人级）
- Shell-form hooks 拒绝 `${user_config.*}` 替换（防止 shell 注入）
- 路径遍历保护：`${CLAUDE_PLUGIN_ROOT}/../` 路径被拒绝

### 6.2 更新行为

- 旧插件版本在磁盘上保留约 14 天（并发会话宽限期）
- 运行 `/reload-plugins` 切换 hooks、MCP 服务器、LSP 服务器到新路径
- Monitors 需要重启会话才能使用新路径

---

## 7. 验证命令

```bash
# 验证插件结构
claude plugin validate ./my-plugin

# 严格模式（CI 用）
claude plugin validate --strict ./my-plugin
```
