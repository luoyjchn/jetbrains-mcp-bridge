import { loadConfig, evaluate, extractPathFromCommand } from '../src/core.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, appendFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
  || resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PROBE_TIMEOUT_MS = 200;
const CACHE_TTL_MS = 60000;

const pluginData = process.env.CLAUDE_PLUGIN_DATA
  || resolve(homedir(), '.cache', 'jetbrains-mcp-bridge');
const CACHE_FILE = resolve(pluginData, 'session.json');
const LOG_FILE = resolve(pluginData, 'hook.log');
const LOG_MAX_SIZE = 1024 * 1024; // 1MB
const PLUGIN_NAME = 'jetbrains-mcp-bridge';

/**
 * Build the full MCP tool namespace prefix for a server name.
 * e.g. "IDEA" → "mcp__plugin_jetbrains-mcp-bridge_IDEA__"
 */
function buildFullPrefix(serverName) {
  const name = serverName.endsWith('__') ? serverName.slice(0, -2) : serverName;
  return `mcp__plugin_${PLUGIN_NAME}_${name}__`;
}

/**
 * Local timestamp in sv-SE format (same as writeLog entries).
 */
function ts() {
  return new Date().toLocaleString('sv-SE', { hour12: false });
}

/**
 * Append a JSONL log entry. Auto-rotates when file exceeds LOG_MAX_SIZE.
 * @param {object} entry
 * @param {boolean} enabled - from config.debug
 */
function writeLog(entry, enabled) {
  if (!enabled) return;
  try {
    mkdirSync(pluginData, { recursive: true });
    if (existsSync(LOG_FILE)) {
      try {
        const { size } = statSync(LOG_FILE);
        if (size > LOG_MAX_SIZE) {
          renameSync(LOG_FILE, LOG_FILE + '.bak');
        }
      } catch { /* non-fatal */ }
    }
    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch {
    // non-fatal
  }
}

/**
 * Probe a single port via TCP connect.
 */
function probePort(port) {
  return new Promise((resolve) => {
    try {
      const socket = createConnection({ port, host: '127.0.0.1' });
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, PROBE_TIMEOUT_MS);
      socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
      socket.on('error', () => { clearTimeout(timer); resolve(false); });
    } catch {
      resolve(false);
    }
  });
}

/**
 * Read cache file. Returns null if missing, expired, or .mcp.json has changed.
 */
function readCache(mcpMtime) {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    if (!data.timestamp || Date.now() - data.timestamp > CACHE_TTL_MS) return null;
    // mtime check: if .mcp.json changed since cache was written, invalidate
    if (mcpMtime && data.mcpMtime && mcpMtime !== data.mcpMtime) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Write probe result to cache file.
 * @param {Object} status - { "IDEA": true, "WebStorm": false, ... }
 * @param {number} mcpMtime - .mcp.json mtime for invalidation
 */
function writeCache(status, mcpMtime) {
  try {
    mkdirSync(pluginData, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({
      timestamp: Date.now(),
      status,
      mcpMtime: mcpMtime || null,
    }));
  } catch {
    // non-fatal
  }
}

/**
 * Read .mcp.json from the first available location.
 * Search order: projectDir > pluginRoot.
 * @returns {{ path: string, data: object, mtime: number } | null}
 */
function readMcpJson() {
  const mcpPath = pluginRoot ? resolve(pluginRoot, '.mcp.json') : null;
  if (!mcpPath) return null;

  try {
    if (!existsSync(mcpPath)) return null;
    const stat = statSync(mcpPath);
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    if (mcp.mcpServers) return { path: mcpPath, data: mcp, mtime: stat.mtimeMs };
  } catch {
    // fall through
  }
  return null;
}

/**
 * Probe all JetBrains MCP ports from .mcp.json.
 * @param {object} mcp - readMcpJson() result (already loaded)
 * @returns {Object} { "IDEA": true, "WebStorm": false, ... }
 */
async function probeMcp(mcp) {
  if (!mcp) return {};

  const entries = {};
  for (const [name, server] of Object.entries(mcp.data.mcpServers)) {
    if (server.url) {
      const match = server.url.match(/(?:localhost|127\.0\.0\.1):(\d+)/);
      if (match) {
        entries[name] = { port: parseInt(match[1], 10), url: server.url };
      }
    }
  }

  const names = Object.keys(entries);
  if (names.length === 0) return {};

  const ports = names.map((n) => entries[n].port);
  const results = await Promise.all(ports.map(probePort));

  const status = {};
  names.forEach((name, i) => {
    // 使用短名称作为 status key（如 "IDEA"）
    const shortName = name.endsWith('__') ? name.slice(0, -2) : name;
    status[shortName] = results[i];
  });
  writeCache(status, mcp.mtime);
  return status;
}

/**
 * Read all of stdin.
 */
function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', reject);
  });
}

/**
 * Claude Code PreToolUse hook entry point.
 */
async function main() {
  const hookStart = Date.now();

  // ① 入口：接收事件
  let raw;
  try { raw = await readStdin(); } catch (e) {
    // 无法读取 stdin，直接退出（不写日志，因为无法获取 debug 状态）
    process.exit(0);
  }

  let payload;
  try { payload = JSON.parse(raw); } catch {
    process.exit(0);
  }

  const { tool_name, tool_input = {}, file_path, cwd } = payload;
  const inputKeys = Object.keys(tool_input);

  // 提前加载配置以获取 debug 开关
  const projectDir = process.env.CLAUDE_PROJECT_DIR || cwd || null;
  const config = loadConfig(projectDir, pluginRoot);
  config._cwd = cwd || '';

  // 所有后续日志均受 config.debug 控制
  writeLog({ ts: ts(), step: 'HOOK-START', tool: tool_name || '(null)', inputKeys }, config.debug);

  // ② 路径解析
  const rawPath = file_path || tool_input?.file_path || tool_input?.path || '';
  let pathSource = 'none';
  if (file_path) pathSource = 'file_path';
  else if (tool_input?.file_path) pathSource = 'tool_input.file_path';
  else if (tool_input?.path) pathSource = 'tool_input.path';

  // Bash 命令中的路径提取
  let extractedPath = '';
  if (tool_name === 'Bash' && tool_input?.command) {
    extractedPath = extractPathFromCommand(tool_input.command) || '';
    if (extractedPath) pathSource = 'bash_command';
  }

  const filePath = rawPath || extractedPath || '';
  writeLog({ ts: ts(), step: 'HOOK-PATH', source: pathSource, rawPath: rawPath || '-', extractedPath: extractedPath || '-', resolved: filePath || '-' }, config.debug);

  // ③ 配置加载
  const configSource = [];
  try { if (existsSync(resolve(pluginRoot, 'config', 'default-global.json5'))) configSource.push('plugin-default'); } catch {}
  try { if (existsSync(resolve(homedir(), '.claude', 'jetbrains-mcp-bridge.json5'))) configSource.push('user-global'); } catch {}
  if (projectDir) {
    try { if (existsSync(resolve(projectDir, '.claude', 'jetbrains-mcp-bridge.json5'))) configSource.push('project'); } catch {}
  }
  writeLog({
    ts: ts(), step: 'HOOK-CONFIG',
    sources: configSource,
    enabled: config.enabled,
    debug: config.debug,
    projectPath: config.projectPath || '-',
    hasBashPatterns: Array.isArray(config.bashPatterns),
    bashPatternCount: config.bashPatterns?.length ?? 0,
    toolMapKeys: config.toolMap ? Object.keys(config.toolMap) : [],
    hasMcpMapping: !!(config.mcpMapping && Object.keys(config.mcpMapping).length > 0),
  }, config.debug);

  // 获取 .mcp.json 的 mtime 用于缓存失效判断
  const mcpJson = readMcpJson();
  const mcpMtime = mcpJson?.mtime || null;

  // ④ MCP 探测 / 缓存
  let cache = readCache(mcpMtime);
  let cacheSource = 'probe';
  if (!cache) {
    const status = await probeMcp(mcpJson);
    config._mcpStatus = status;
    writeLog({ ts: ts(), step: 'HOOK-MCP', source: 'probe', serverCount: Object.keys(status).length, servers: Object.entries(status).map(([k, v]) => `${k}=${v}`) }, config.debug);
  } else {
    config._mcpStatus = cache.status || {};
    cacheSource = 'cache';
    writeLog({ ts: ts(), step: 'HOOK-MCP', source: 'cache', serverCount: Object.keys(cache.status || {}).length }, config.debug);
  }

  // ⑤ 拦截判断（传入 logger 回调，evaluate 内部日志也写入 hook.log）
  const evalLogger = config.debug
    ? (msg) => writeLog({ ts: ts(), step: 'EVAL', msg }, true)
    : undefined;
  const result = evaluate(config, tool_name, tool_input, filePath, evalLogger);
  writeLog({
    ts: ts(), step: 'HOOK-DECISION',
    action: result?.action || 'pass',
    reason: result?.reason || '-',
    prefix: result?.prefix || '-',
    suggest: result?.suggest ? (typeof result.suggest === 'string' ? result.suggest : JSON.stringify(result.suggest)) : '-',
  }, config.debug);

  // ⑥ 最终结果日志（兼容原有格式，prefix 使用短名称）
  const logEntry = {
    ts: ts(),
    tool: tool_name,
    file: filePath || '-',
    action: result?.action || 'pass',
    prefix: result?.prefix || '-',
    fullPrefix: result?.prefix ? buildFullPrefix(result.prefix) : '-',
    reason: result?.reason || '-',
  };
  writeLog(logEntry, config.debug);

  if (!result || result.action === 'pass') {
    writeLog({ ts: ts(), step: 'HOOK-END', result: 'pass', durationMs: Date.now() - hookStart }, config.debug);
    process.exit(0);
  }

  if (result.action === 'block') {
    // 使用完整 MCP 前缀（mcp__plugin_jetbrains-mcp-bridge_XXX__）用于 suggest 消息
    const fullPrefix = result.prefix ? buildFullPrefix(result.prefix) : '';
    let message = `[JetBrains MCP Bridge] ${result.reason}。建议使用 ${result.suggest}。`;
    if (fullPrefix) {
      message += ` (MCP: ${fullPrefix})`;
    }
    writeLog({ ts: ts(), step: 'HOOK-OUTPUT', type: 'additionalContext', message }, config.debug);
    // 软提示：exit 0 + additionalContext，Claude 自行决定是否使用 MCP 工具
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: message,
      },
    }) + '\n');
    writeLog({ ts: ts(), step: 'HOOK-END', result: 'block', durationMs: Date.now() - hookStart }, config.debug);
    process.exit(0);
  }

  writeLog({ ts: ts(), step: 'HOOK-END', result: 'exit', durationMs: Date.now() - hookStart }, config.debug);
  process.exit(0);
}

main();
