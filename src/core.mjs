import { readFileSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";

const SOURCE_FILE_TOOLS = ["Read", "Write", "Edit"];

/**
 * Recursively merge source into target. Objects are deep-merged;
 * arrays and primitives are replaced by the source value.
 */
export function deepMerge(target, source) {
  if (!source || typeof source !== "object") return target ?? source;
  if (!target || typeof target !== "object") return structuredClone(source);
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (srcVal === undefined) continue;
    if (
      srcVal !== null &&
      typeof srcVal === "object" && !Array.isArray(srcVal) &&
      tgtVal !== null && typeof tgtVal === "object" && !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = structuredClone(srcVal);
    }
  }
  return result;
}

/**
 * Minimal JSON5 parser: strips single-line (//) and block comments,
 * removes trailing commas, quotes unquoted keys, then delegates to JSON.parse.
 */
export function parseJson5(text) {
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inBlockComment) {
      if (ch === "*" && text[i + 1] === "/") { inBlockComment = false; i++; }
      continue;
    }
    if (inLineComment) {
      if (ch === "\n" || ch === "\r") { inLineComment = false; result += ch; }
      continue;
    }
    if (!inString) {
      if (ch === "/" && text[i + 1] === "/") { inLineComment = true; i++; continue; }
      if (ch === "/" && text[i + 1] === "*") { inBlockComment = true; i++; continue; }
    }
    if (ch === '"' && !escaped) inString = !inString;
    escaped = ch === "\\" && !escaped && inString;
    if (!inString && ch !== '"') {
      const rest = text.slice(i);
      const keyMatch = rest.match(/^([a-zA-Z_$][a-zA-Z0-9_$.-]*)\s*:/);
      if (keyMatch && keyMatch.index === 0) { result += '"' + keyMatch[1] + '"'; i += keyMatch[1].length - 1; continue; }
    }
    if (!inString && ch === ",") {
      const ahead = text.slice(i + 1).replace(/\/\/[^\n\r]*/g, "").trimStart();
      if (ahead[0] === "}" || ahead[0] === "]") continue;
    }
    result += ch;
  }
  return JSON.parse(result);
}

/**
 * Convert a glob pattern to a RegExp.
 * Supports * (single segment), ** (multi-segment), ? (single char), {a,b} (alternation), ! prefix (exclusion).
 * Path separators / are normalized to match both / and \.
 */
export function globToRegex(glob) {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    if (glob[i] === "*" && glob[i + 1] === "*") {
      re += ".*";
      i += 2;
      if (glob[i] === "/") i++;
    } else if (glob[i] === "*") {
      re += "[^/\\\\]*";
      i++;
    } else if (glob[i] === "?") {
      re += "[^/\\\\]";
      i++;
    } else if (glob[i] === "{") {
      const end = glob.indexOf("}", i);
      if (end !== -1) {
        const alts = glob.slice(i + 1, end).split(",").map(s => s.trim());
        re += "(" + alts.map(a => globToRegexBody(a)).join("|") + ")";
        i = end + 1;
      } else {
        re += "\\{";
        i++;
      }
    } else if (glob[i] === "/") {
      re += "[/\\\\]";
      i++;
    } else {
      re += glob[i].replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp("^" + re + "$");
}

function globToRegexBody(glob) {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    if (glob[i] === "*" && glob[i + 1] === "*") { re += ".*"; i += 2; if (glob[i] === "/") i++; }
    else if (glob[i] === "*") { re += "[^/\\\\]*"; i++; }
    else if (glob[i] === "?") { re += "[^/\\\\]"; i++; }
    else if (glob[i] === "/") { re += "[/\\\\]"; i++; }
    else { re += glob[i].replace(/[.+^${}()|[\]\\]/g, "\\$&"); i++; }
  }
  return re;
}

/**
 * Normalize a file path to use forward slashes and make it relative to projectPath if possible.
 */
export function normalizePath(filePath, projectPath) {
  let normalized = filePath.replace(/\\/g, "/");
  if (projectPath) {
    const normProject = projectPath.replace(/\\/g, "/");
    if (normalized.startsWith(normProject)) {
      normalized = normalized.slice(normProject.length).replace(/^\//, "");
    }
  }
  return normalized;
}

/**
 * Check if a file path matches any of the given glob patterns.
 * Normalizes path separators and converts to relative path if projectPath is set.
 */
export function matchesAny(filePath, patterns, projectPath) {
  if (!filePath || !Array.isArray(patterns)) return false;
  const normalized = normalizePath(filePath, projectPath);
  return patterns.some((p) => globToRegex(p).test(normalized));
}

/**
 * Check if a specific MCP prefix is online.
 * mcpStatus keys and prefix both use "mcp__" prefix (e.g., "mcp__JetBrains-IDEA").
 * If prefix is not in the map, falls back to checking if ANY JetBrains MCP is online.
 */
export function isMcpOnline(prefix, mcpStatus) {
  if (!mcpStatus || typeof mcpStatus !== "object") return false;
  const entries = Object.entries(mcpStatus);
  if (entries.length === 0) return false;
  // 有具体前缀：直接检查（prefix 已含 mcp__ 前缀）
  if (prefix) return mcpStatus[prefix] === true;
  // 无具体前缀（Bash 命令）：检查是否有任何 JetBrains MCP 在线
  return entries.some(([, v]) => v === true);
}

/**
 * Check if a file path is within the project scope.
 * If projectPath is not set, all paths are considered in scope.
 */
export function isInProject(filePath, projectPath) {
  if (!projectPath) return true;
  if (!filePath) return true;
  const normFile = filePath.replace(/\\/g, "/");
  const normProject = projectPath.replace(/\\/g, "/");
  return normFile.startsWith(normProject);
}

/**
 * Evaluate a tool invocation against the bridge config.
 * Pure function — no side effects, never calls process.exit().
 *
 * @param {object} config - bridge config
 * @param {string} toolName - Claude Code tool name
 * @param {object} toolInput - tool input parameters
 * @param {string} filePath - resolved file path
 * @param {function} [logger] - optional logger callback (msg: string) => void, receives [EVAL] prefixed messages
 * @returns {{ action: "pass" } | { action: "block", reason: string, suggest: string, prefix?: string }}
 */
export function evaluate(config, toolName, toolInput, filePath, logger) {
  const log = typeof logger === "function" ? (msg) => logger(`[EVAL] ${msg}`) : () => {};

  if (config.enabled === false) {
    log(`PASS: config.enabled=false`);
    return { action: "pass" };
  }

  // 0a. excludePatterns — hard exclude, always pass
  if (filePath && matchesAny(filePath, config.excludePatterns, config.projectPath)) {
    log(`PASS: excluded by excludePatterns, file=${filePath}`);
    return { action: "pass" };
  }

  // 0b. projectPath 范围检查
  const effectiveProjectPath = config.projectPath || config._cwd || "";
  if (filePath && effectiveProjectPath && !isInProject(filePath, effectiveProjectPath)) {
    log(`PASS: outside projectPath, file=${filePath}, projectPath=${effectiveProjectPath}`);
    return { action: "pass" };
  }

  const mcpStatus = config._mcpStatus || {};
  log(`Evaluating tool=${toolName}, file=${filePath || '-'}, mcpStatus=${JSON.stringify(mcpStatus)}`);

  // 1. bashPatterns — only applies to Bash tool
  if (toolName === "Bash" && Array.isArray(config.bashPatterns)) {
    const cmd = toolInput?.command;
    if (typeof cmd === "string") {
      for (const entry of config.bashPatterns) {
        const regex = new RegExp(entry.pattern, "i");
        if (regex.test(cmd)) {
          // 尝试从命令中提取路径，精确匹配 MCP 前缀
          const extractedPath = extractPathFromCommand(cmd);
          let prefix;
          if (extractedPath) {
            prefix = resolvePrefix(extractedPath, config.mcpMapping, config.defaultPrefix);
          }
          // 检查 MCP 在线状态
          const online = (prefix && prefix in mcpStatus)
            ? isMcpOnline(prefix, mcpStatus)
            : hasAnyMappingMcpOnline(config.mcpMapping, mcpStatus);
          if (!online) {
            log(`PASS: bashPattern matched but MCP offline, pattern=${entry.pattern}, prefix=${prefix || '-'}`);
            return { action: "pass" };
          }
          const result = buildBlock(entry);
          result.prefix = prefix;
          log(`BLOCK: bashPattern matched, pattern=${entry.pattern}, prefix=${prefix || '-'}`);
          return result;
        }
      }
      log(`PASS: Bash command matched no bashPatterns`);
    }
  }

  // 2. toolMap — direct tool-name match
  if (config.toolMap && toolName in config.toolMap) {
    const prefix = resolvePrefix(filePath, config.mcpMapping, config.defaultPrefix);
    // 有具体前缀且在 map 中 → 检查该前缀；否则检查是否有任何 MCP 在线
    const online = (prefix && prefix in mcpStatus)
      ? isMcpOnline(prefix, mcpStatus)
      : isMcpOnline(undefined, mcpStatus);
    if (!online) {
      log(`PASS: toolMap[${toolName}] found but MCP offline, prefix=${prefix || '-'}`);
      return { action: "pass" };
    }
    const result = buildBlock(config.toolMap[toolName]);
    result.prefix = prefix;
    log(`BLOCK: toolMap[${toolName}] matched, prefix=${prefix || '-'}`);
    return result;
  }

  // 3. fileTypeMap + sourceExtensions — file-type filtering for Read/Write/Edit
  if (
    SOURCE_FILE_TOOLS.includes(toolName) && filePath &&
    config.fileTypeMap && Array.isArray(config.sourceExtensions)
  ) {
    const ext = extractExtension(filePath);
    if (ext && config.sourceExtensions.includes(ext)) {
      const mapped = config.fileTypeMap[ext];
      if (mapped) {
        // mapped 是 MCP 前缀，检查该前缀是否在线
        if (!isMcpOnline(mapped, mcpStatus)) {
          log(`PASS: fileTypeMap[${ext}]=${mapped} but MCP offline`);
          return { action: "pass" };
        }
        const result = buildBlock(mapped);
        result.prefix = mapped;
        log(`BLOCK: fileTypeMap[${ext}] matched, prefix=${mapped}`);
        return result;
      }
      log(`PASS: ext=${ext} in sourceExtensions but no fileTypeMap entry`);
    } else {
      log(`PASS: tool=${toolName}, ext=${ext || '-'}, not in sourceExtensions or no ext`);
    }
  }

  log(`PASS: no matching rule for tool=${toolName}, file=${filePath || '-'}`);
  return { action: "pass" };
}

/**
 * Load and merge the three-layer config:
 *   pluginRoot/config/default-global.json5  (lowest)
 *   ~/.claude/jetbrains-mcp-bridge.json5    (user)
 *   projectDir/.claude/jetbrains-mcp-bridge.json5  (project, highest)
 */
export function loadConfig(projectDir, pluginRoot) {
  const layers = [
    pluginRoot ? { path: join(pluginRoot, "config", "default-global.json5"), tag: "plugin-default", level: "low" } : null,
    { path: join(homedir(), ".claude", "jetbrains-mcp-bridge.json5"), tag: "user-global", level: "mid" },
    projectDir ? { path: join(projectDir, ".claude", "jetbrains-mcp-bridge.json5"), tag: "project", level: "high" } : null,
  ].filter(Boolean);

  const debug = process.env.JETBRAINS_MCP_DEBUG === "1";
  let merged = {};
  for (const layer of layers) {
    try {
      const raw = readFileSync(layer.path, "utf-8");
      const parsed = parseJson5(raw);
      merged = deepMerge(merged, parsed);
      if (debug) process.stderr.write(`[JetBrains MCP Bridge DEBUG] Config layer [${layer.level}]: ${layer.tag} from ${layer.path}\n`);
    } catch (err) {
      if (err.code !== "ENOENT") {
        if (debug) process.stderr.write(`[JetBrains MCP Bridge DEBUG] Error reading ${layer.path}: ${err.message}\n`);
      }
    }
  }
  if (debug && layers.length > 0) {
    const order = layers.map(l => l.tag).reverse().join(" -> ");
    process.stderr.write(`[JetBrains MCP Bridge DEBUG] Merge order: ${order}\n`);
  }
  return merged;
}

// -- private helpers --

function buildBlock(entry) {
  let suggest = "";
  if (typeof entry.suggest === "string") {
    suggest = entry.suggest;
  } else if (entry.suggest && typeof entry.suggest === "object") {
    suggest = entry.suggest._default || Object.values(entry.suggest)[0] || "";
  }
  return { action: "block", reason: entry.reason ?? "", suggest, prefix: entry.prefix };
}

function extractExtension(filePath) {
  const match = filePath.match(/(\.\w[\w.]*)$/);
  return match ? match[1] : null;
}

/**
 * Resolve the MCP server prefix for a file path by matching against mcpMapping.
 * mcpMapping values can be:
 *   - A single glob string: "src/**"
 *   - An array of globs with optional exclusion: ["src/**", "!test/**"]
 * Returns the matched prefix, or defaultPrefix if no match.
 */
export function resolvePrefix(filePath, mcpMapping, defaultPrefix) {
  if (!filePath || !mcpMapping || typeof mcpMapping !== "object") return defaultPrefix;
  const normalized = filePath.replace(/\\/g, "/");
  for (const [prefix, pattern] of Object.entries(mcpMapping)) {
    if (Array.isArray(pattern)) {
      if (matchGlobArray(normalized, pattern)) return prefix;
    } else {
      if (globToRegex(pattern).test(normalized)) return prefix;
    }
  }
  return defaultPrefix;
}

function matchGlobArray(filePath, patterns) {
  const includes = [];
  const excludes = [];
  for (const p of patterns) {
    if (p.startsWith("!")) excludes.push(p.slice(1));
    else includes.push(p);
  }
  if (includes.length > 0) {
    if (!includes.some((p) => globToRegex(p).test(filePath))) return false;
  }
  for (const p of excludes) {
    if (globToRegex(p).test(filePath)) return false;
  }
  return true;
}

/**
 * Extract a file or directory path from a Bash command string.
 * Tries to find arguments that look like paths (contain path separators,
 * have source file extensions, or start with common source directories).
 * @returns {string|null} extracted path or null
 */
export function extractPathFromCommand(cmd) {
  // 常见源码目录前缀
  const srcDirPattern = "(?:src|lib|app|test|tests|spec|pkg|cmd|internal|api|pages|components|views|models|routes|controllers|services|utils|helpers|hooks|middleware|config|public|static|assets|styles|fonts|images|modules|plugins|features|domains)";
  // 优先匹配：带源码扩展名的路径
  const extMatch = cmd.match(new RegExp(
    "(?:(?:[A-Za-z]:)?[./\\\\]?" + srcDirPattern + "[/\\\\][^\\s\"']+|[^\\s\"'`]+)\\." +
    "(?:java|kt|kts|py|go|rs|ts|tsx|js|jsx|vue|php|rb|cs|vb|c|cpp|h|hpp|swift|m|scala|clj|ex|exs|lua|r|pl|pm|sh|bash|zsh|sql|xml|json5?|ya?ml|toml|ini|cfg|conf|gradle|sbt|cmake|make|mk|dockerfile|graphql|gql|proto|md|html|css|scss|less|sass)",
    "gi"
  ));
  if (extMatch) {
    // 返回最长的匹配（更可能是完整路径）
    return extMatch.reduce((a, b) => a.length >= b.length ? a : b);
  }
  // 次优先：以常见源码目录开头的路径
  const dirMatch = cmd.match(new RegExp(
    "(?<![\\w./-])((?:[A-Za-z]:)?[./\\\\]?" + srcDirPattern + "(?:[/\\\\][^\\s\"'`]+)*)",
    "g"
  ));
  if (dirMatch) {
    return dirMatch.reduce((a, b) => a.length >= b.length ? a : b);
  }
  // 最后：包含路径分隔符的非 flag 参数
  const pathMatch = cmd.match(/(?<![A-Za-z]:)(?:(?:[A-Za-z]:)?\.?[\/\\][^\s"'`-][^\s"'`]*)/g);
  if (pathMatch && pathMatch.length > 0) {
    return pathMatch.reduce((a, b) => a.length >= b.length ? a : b);
  }
  return null;
}

/**
 * Check if any MCP listed in mcpMapping keys is online.
 * More precise than isMcpOnline(undefined, ...) which checks ANY MCP.
 * Falls back to checking any JetBrains MCP if mcpMapping is empty.
 */
function hasAnyMappingMcpOnline(mcpMapping, mcpStatus) {
  if (!mcpStatus || typeof mcpStatus !== "object") return false;
  const entries = Object.entries(mcpStatus);
  if (entries.length === 0) return false;
  if (mcpMapping && typeof mcpMapping === "object" && Object.keys(mcpMapping).length > 0) {
    // 只检查 mcpMapping 中列出的前缀
    return Object.keys(mcpMapping).some((prefix) => mcpStatus[prefix] === true);
  }
  // mcpMapping 为空，回退到检查任何 JetBrains MCP
  return entries.some(([, v]) => v === true);
}