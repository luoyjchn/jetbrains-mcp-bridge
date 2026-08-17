# JetBrains MCP Bridge

将 JetBrains IDE 的强大功能桥接到 Claude Code — 拦截原生工具并建议使用 IDE 的 MCP 工具替代。

## 功能特性

- **工具拦截** — 检测 Read/Write/Edit/Grep/Glob 调用，建议使用 IDE 原生 MCP 工具
- **Bash 命令检测** — 识别 `grep`、`find`、`mvn`、`gradle`、`npm run` 等命令并建议 IDE 替代方案
- **多 IDE 支持** — IntelliJ IDEA、WebStorm、PyCharm、GoLand、RustRover、CLion、PhpStorm、RubyMine、Rider
- **智能路由** — 通过 `mcpMapping`（路径 glob）和 `fileTypeMap`（文件扩展名）将文件路由到正确的 IDE
- **软提示** — 非阻断式：Claude 看到建议后自行决定是否使用 MCP 工具
- **MCP 健康检查** — 仅在 IDE 实际运行且可达时才建议 MCP 工具
- **JSONL 日志** — 可选的 hook 决策日志，支持自动轮转

## 安装

```bash
claude plugin install github:luoyjchn/jetbrains-mcp-bridge
```

安装后重启 Claude Code 会话，然后运行：

```
/jetbrains-mcp-bridge-setup
```

此交互式命令会：
1. 复制默认配置到 `~/.claude/jetbrains-mcp-bridge.json5`
2. 复制项目配置到 `.claude/jetbrains-mcp-bridge.json5` 并设置项目路径
3. 询问你使用哪些 JetBrains IDE 及其 MCP 端口
4. 生成包含 MCP 服务器条目的 `.mcp.json`

## 前置条件

1. **JetBrains IDE** 已启动且 MCP 插件已启用
2. **MCP 端口** — IDE 内置 MCP 服务器（默认端口：63342–63348）
3. **Claude Code** CLI 或桌面应用

## 配置

配置文件使用 **JSON5** 格式（支持注释和尾逗号）。

### 配置层级

三层配置，高优先级覆盖低优先级：

| 优先级 | 位置 | 用途 |
|--------|------|------|
| 低 | `<插件目录>/config/default-global.json5` | 插件内置默认值 |
| 中 | `~/.claude/jetbrains-mcp-bridge.json5` | 用户全局配置 |
| 高 | `<项目>/.claude/jetbrains-mcp-bridge.json5` | 项目级配置 |

### 最小项目配置

```json5
{
  enabled: true,
  debug: false,
  projectPath: "/path/to/your/project",
  mcpMapping: {
    "mcp__JetBrains-WebStorm__": ["src/**"],
  },
}
```

### 完整配置参考

```json5
{
  // 是否启用 hook 拦截
  enabled: true,

  // 是否启用日志记录（写入 {CLAUDE_PLUGIN_DATA}/hook.log）
  debug: false,

  // 项目根目录的绝对路径（由 /jetbrains-mcp-bridge-setup 自动设置）
  projectPath: "/path/to/project",

  // MCP 前缀 → 路径 glob 映射
  // Glob 语法：*（单层）、**（任意层）、?（单字符）、{a,b}（或）、!（排除）
  mcpMapping: {
    // 除前端外的所有文件 → IntelliJ IDEA
    "mcp__JetBrains-IDEA__": ["src/main/**", "!src/main/frontend/**"],
    // 前端文件 → WebStorm
    "mcp__JetBrains-WebStorm__": "src/main/frontend/**",
  },

  // 路径排除模式（匹配的文件不会被拦截）
  excludePatterns: [
    ".claude/**",
    "node_modules/**",
    ".git/**",
  ],

  // 当 mcpMapping 无匹配时的兜底 MCP 前缀
  defaultPrefix: "mcp__JetBrains-IDEA__",

  // Bash 命令检测规则
  bashPatterns: [
    {
      pattern: "grep|rg|findstr|Select-String",
      reason: "代码搜索",
      suggest: {
        idea: "search_regex（正则搜索）或 search_symbol（符号查找）",
        webstorm: "search_regex（正则搜索）或 search_symbol（符号查找）",
        _default: "search_regex",
      },
    },
    // ... 更多规则见 config/default-global.json5
  ],

  // Claude Code 工具 → MCP 工具映射
  toolMap: {
    Read:  { reason: "读取项目文件", suggest: { _default: "read_file" } },
    Write: { reason: "写入项目文件", suggest: { _default: "create_new_file" } },
    Edit:  { reason: "编辑项目文件", suggest: { _default: "apply_patch" } },
    Glob:  { reason: "查找项目文件", suggest: { _default: "search_file" } },
    Grep:  { reason: "搜索项目代码", suggest: { _default: "search_regex" } },
  },

  // 文件扩展名 → MCP 前缀（用于 Read/Write/Edit 工具）
  fileTypeMap: {
    ".java": "mcp__JetBrains-IDEA__",
    ".kt":   "mcp__JetBrains-IDEA__",
    ".vue":  "mcp__JetBrains-WebStorm__",
    ".ts":   "mcp__JetBrains-WebStorm__",
    ".js":   "mcp__JetBrains-WebStorm__",
    ".py":   "mcp__JetBrains-PyCharm__",
    ".go":   "mcp__JetBrains-GoLand__",
    ".rs":   "mcp__JetBrains-RustRover__",
    ".c":    "mcp__JetBrains-CLion__",
    ".cpp":  "mcp__JetBrains-CLion__",
    ".php":  "mcp__JetBrains-PhpStorm__",
    ".rb":   "mcp__JetBrains-RubyMine__",
    ".cs":   "mcp__JetBrains-Rider__",
  },

  // 源码扩展名白名单（空数组 = 不限制扩展名）
  sourceExtensions: [],

  // 配置 schema 版本号
  configVersion: 1,
}
```

### MCP 服务器命名规范

`.mcp.json` 中的服务器名使用 `JetBrains-XXX` 格式（如 `JetBrains-WebStorm`）。
配置文件中的 key 使用 `mcp__JetBrains-XXX__` 格式（带 `mcp__` 前缀和 `__` 后缀）。
Hook 会自动标准化名称进行匹配。

## 工作原理

```
Claude Code 调用工具（Read/Grep/Bash/...）
        │
        ▼
PreToolUse hook 执行
        │
        ├── 1. enabled 检查 → false? → 放行
        ├── 2. excludePatterns 匹配? → 放行
        ├── 3. projectPath 范围检查 → 范围外? → 放行
        ├── 4. Bash: bashPatterns 正则匹配
        │   └── 从命令中提取路径 → resolvePrefix → 检查 MCP 在线状态
        ├── 5. toolMap: 直接工具名匹配
        │   └── resolvePrefix(filePath) → 检查 MCP 在线状态
        └── 6. fileTypeMap: 扩展名匹配（Read/Write/Edit）
            └── 检查对应 MCP 在线状态
        │
        ▼
  exit 0 + additionalContext（软提示）
  Claude 自行决定是否使用 MCP 工具
```

### 软提示模式

Hook 使用 **exit 0** + `additionalContext` — 它建议使用 MCP 工具，但**不会阻止** Claude 使用原生工具。Claude 看到建议后自行决定是否切换到 MCP 工具。

## 日志

在配置文件中启用日志：

```json5
{
  debug: true,
}
```

日志文件：`{CLAUDE_PLUGIN_DATA}/hook.log`（JSONL 格式，超过 1MB 自动轮转）

```json
{"ts":"2026-08-14 20:30:45","tool":"Read","file":"src/app.ts","action":"suggest","prefix":"mcp__JetBrains-WebStorm__","reason":"读取项目文件"}
{"ts":"2026-08-14 20:30:46","tool":"Bash","file":"-","action":"suggest","prefix":"mcp__JetBrains-IDEA__","reason":"代码搜索"}
{"ts":"2026-08-14 20:30:47","tool":"Terminal","file":"-","action":"pass","prefix":"-","reason":"-"}
```

## 多 IDE 示例

对于 Java 后端 + Vue 前端的 monorepo：

```json5
{
  enabled: true,
  projectPath: "/path/to/monorepo",
  mcpMapping: {
    "mcp__JetBrains-IDEA__": [
      "!frontend/**",
      "**",
    ],
    "mcp__JetBrains-WebStorm__": [
      "frontend/**",
    ],
  },
  excludePatterns: [
    ".claude/**",
    "node_modules/**",
    ".git/**",
  ],
}
```

- `backend/src/...` → IntelliJ IDEA
- `frontend/src/...` → WebStorm
- `.claude/`、`node_modules/`、`.git/` → 不拦截

## 支持的 JetBrains IDE

| IDE | MCP 前缀 | 默认端口 |
|-----|---------|---------|
| IntelliJ IDEA | `mcp__JetBrains-IDEA__` | 63342 |
| WebStorm | `mcp__JetBrains-WebStorm__` | 63343 |
| PyCharm | `mcp__JetBrains-PyCharm__` | 63344 |
| GoLand | `mcp__JetBrains-GoLand__` | 63345 |
| RustRover | `mcp__JetBrains-RustRover__` | 63346 |
| CLion | `mcp__JetBrains-CLion__` | 63347 |
| PhpStorm | `mcp__JetBrains-PhpStorm__` | 63348 |
| RubyMine | `mcp__JetBrains-RubyMine__` | 63349 |
| Rider | `mcp__JetBrains-Rider__` | 63350 |

## 开发

```bash
npm install              # 安装开发依赖
npm run build            # 打包 hook → hooks/jetbrains-mcp-bridge.bundle.mjs
npm test                 # 运行所有测试 (node --test tests/*.test.mjs)

# 运行单个测试文件
node --test tests/core.test.mjs

# 按名称运行单个测试
node --test --test-name-pattern "resolvePrefix" tests/core.test.mjs
```

## 许可证

MIT
