# JetBrains MCP Bridge

[English](README.md) | [中文](README.zh-CN.md)

Claude Code plugin that intercepts native tools (Read, Write, Edit, Grep, Glob, Bash) and suggests JetBrains IDE MCP alternatives — leveraging IDE indexing, refactoring, and build capabilities directly from Claude Code.

## Features

- **Tool Interception** — Detects Read/Write/Edit/Grep/Glob calls and suggests IDE-native MCP tools
- **Bash Pattern Detection** — Recognizes `grep`, `find`, `mvn`, `gradle`, `npm run` etc. and suggests IDE alternatives
- **Multi-IDE Support** — IntelliJ IDEA, WebStorm, PyCharm, GoLand, RustRover, CLion, PhpStorm, RubyMine, Rider
- **Smart Routing** — Routes files to the correct IDE via `mcpMapping` (path globs) and `fileTypeMap` (extensions)
- **Soft Suggest** — Non-blocking: Claude sees the suggestion and decides whether to use MCP tools
- **MCP Health Check** — Only suggests MCP tools when the IDE is actually running and reachable
- **JSONL Logging** — Optional hook decision logging with auto-rotation

## Installation

```bash
claude plugin install github:luoyjchn/jetbrains-mcp-bridge
```

After installation, restart your Claude Code session, then run:

```
/jetbrains-mcp-bridge-setup
```

This interactive command will:
1. Copy the default config to `~/.claude/jetbrains-mcp-bridge.json5`
2. Copy the project config to `.claude/jetbrains-mcp-bridge.json5` with your project path
3. Ask which JetBrains IDEs you use and their MCP ports
4. Generate `.mcp.json` with your MCP server entries

## Prerequisites

1. **JetBrains IDE** running with the MCP plugin enabled
2. **MCP port** — IDE's built-in MCP server (default ports: 63342–63348)
3. **Claude Code** CLI or desktop app

## Configuration

Config files use **JSON5** format (comments and trailing commas allowed).

### Config Layers

Three layers, higher priority overrides lower:

| Priority | Location | Purpose |
|----------|----------|---------|
| Low | `<plugin>/config/default-global.json5` | Bundled defaults |
| Mid | `~/.claude/jetbrains-mcp-bridge.json5` | User global |
| High | `<project>/.claude/jetbrains-mcp-bridge.json5` | Project specific |

### Minimal Project Config

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

### Full Config Reference

```json5
{
  // Enable/disable the hook
  enabled: true,

  // Enable logging to {CLAUDE_PLUGIN_DATA}/hook.log
  debug: false,

  // Absolute path to project root (set by /jetbrains-mcp-bridge-setup)
  projectPath: "/path/to/project",

  // MCP prefix → glob path mapping
  // Glob: * (single segment), ** (multi), ? (single char), {a,b} (alternation), ! (exclusion)
  mcpMapping: {
    // All files except frontend → IntelliJ IDEA
    "mcp__JetBrains-IDEA__": ["src/main/**", "!src/main/frontend/**"],
    // Frontend files → WebStorm
    "mcp__JetBrains-WebStorm__": "src/main/frontend/**",
  },

  // Hard exclude patterns (never intercepted)
  excludePatterns: [
    ".claude/**",
    "node_modules/**",
    ".git/**",
  ],

  // Fallback MCP prefix when no mcpMapping matches
  defaultPrefix: "mcp__JetBrains-IDEA__",

  // Bash command detection rules
  bashPatterns: [
    {
      pattern: "grep|rg|findstr|Select-String",
      reason: "Code search",
      suggest: {
        idea: "search_regex or search_symbol",
        webstorm: "search_regex or search_symbol",
        _default: "search_regex",
      },
    },
    // ... more patterns (see config/default-global.json5 for full list)
  ],

  // Claude Code tool → MCP tool mapping
  toolMap: {
    Read:  { reason: "Read file",  suggest: { _default: "read_file" } },
    Write: { reason: "Write file", suggest: { _default: "create_new_file" } },
    Edit:  { reason: "Edit file",  suggest: { _default: "apply_patch" } },
    Glob:  { reason: "Find files", suggest: { _default: "search_file" } },
    Grep:  { reason: "Search code", suggest: { _default: "search_regex" } },
  },

  // File extension → MCP prefix (for Read/Write/Edit tools)
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

  // Source extension whitelist (empty = all extensions)
  sourceExtensions: [],

  // Config schema version
  configVersion: 1,
}
```

### MCP Server Name Convention

MCP server names in `.mcp.json` use `JetBrains-XXX` format (e.g., `JetBrains-WebStorm`).
Config keys use `mcp__JetBrains-XXX__` format (with `mcp__` prefix and `__` suffix).
The hook automatically normalizes names for matching.

## How It Works

```
Claude Code calls tool (Read/Grep/Bash/...)
        │
        ▼
PreToolUse hook runs
        │
        ├── 1. enabled check → false? → pass
        ├── 2. excludePatterns match? → pass
        ├── 3. projectPath scope check → outside? → pass
        ├── 4. Bash: bashPatterns regex match
        │   └── extract path from command → resolvePrefix → check MCP online
        ├── 5. toolMap: direct tool match
        │   └── resolvePrefix(filePath) → check MCP online
        └── 6. fileTypeMap: extension match (Read/Write/Edit)
            └── check specific MCP online
        │
        ▼
  exit 0 + additionalContext (soft suggest)
  Claude decides whether to use MCP tool
```

### Soft Suggest Mode

The hook uses **exit 0** with `additionalContext` — it suggests MCP tools but does NOT block Claude from using native tools. Claude sees the suggestion and decides whether to switch to the MCP tool.

## Logging

Enable logging in your config file:

```json5
{
  debug: true,
}
```

Log file: `{CLAUDE_PLUGIN_DATA}/hook.log` (JSONL format, auto-rotates at 1MB)

```json
{"ts":"2026-08-14 20:30:45","tool":"Read","file":"src/app.ts","action":"suggest","prefix":"mcp__JetBrains-WebStorm__","reason":"Read file"}
{"ts":"2026-08-14 20:30:46","tool":"Bash","file":"-","action":"suggest","prefix":"mcp__JetBrains-IDEA__","reason":"Code search"}
{"ts":"2026-08-14 20:30:47","tool":"Terminal","file":"-","action":"pass","prefix":"-","reason":"-"}
```

## Multi-IDE Example

For a monorepo with Java backend + Vue frontend:

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
- `.claude/`, `node_modules/`, `.git/` → not intercepted

## Supported JetBrains IDEs

| IDE | MCP Prefix | Default Port |
|-----|-----------|-------------|
| IntelliJ IDEA | `mcp__JetBrains-IDEA__` | 63342 |
| WebStorm | `mcp__JetBrains-WebStorm__` | 63343 |
| PyCharm | `mcp__JetBrains-PyCharm__` | 63344 |
| GoLand | `mcp__JetBrains-GoLand__` | 63345 |
| RustRover | `mcp__JetBrains-RustRover__` | 63346 |
| CLion | `mcp__JetBrains-CLion__` | 63347 |
| PhpStorm | `mcp__JetBrains-PhpStorm__` | 63348 |
| RubyMine | `mcp__JetBrains-RubyMine__` | 63349 |
| Rider | `mcp__JetBrains-Rider__` | 63350 |

## Development

```bash
npm install              # Install devDependencies
npm run build            # Bundle hook → hooks/jetbrains-mcp-bridge.bundle.mjs
npm test                 # Run all tests (node --test tests/*.test.mjs)

# Run single test file
node --test tests/core.test.mjs

# Run single test by name
node --test --test-name-pattern "resolvePrefix" tests/core.test.mjs
```

## License

MIT
