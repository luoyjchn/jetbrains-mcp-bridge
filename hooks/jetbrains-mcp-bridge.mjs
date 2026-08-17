import { loadConfig, evaluate } from '../src/core.mjs';
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
 * @param {Object} status - { "JetBrains-IDEA": true, "JetBrains-WebStorm": false, ... }
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
 * @returns {Object} { "JetBrains-IDEA": true, "JetBrains-WebStorm": false, ... }
 */
async function probeMcp(mcp) {
  if (!mcp) return {};

  const entries = {};
  for (const [name, server] of Object.entries(mcp.data.mcpServers)) {
    if (name.startsWith('JetBrains') && server.url) {
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
    // 标准化为 mcp__JetBrains-XXX__ 格式（双尾下划线）
    const suffix = name.endsWith('__') ? '' : '__';
    status[`mcp__${name}${suffix}`] = results[i];
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
  let raw;
  try { raw = await readStdin(); } catch { process.exit(0); }

  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }

  const { tool_name, tool_input = {}, file_path, cwd } = payload;
  const filePath = file_path || tool_input?.file_path || '';

  const projectDir = process.env.CLAUDE_PROJECT_DIR || cwd || null;
  const config = loadConfig(projectDir, pluginRoot);
  config._cwd = cwd || '';

  // 获取 .mcp.json 的 mtime 用于缓存失效判断
  const mcpJson = readMcpJson();
  const mcpMtime = mcpJson?.mtime || null;

  // 读取缓存（mtime 感知：.mcp.json 变化时自动失效）
  let cache = readCache(mcpMtime);
  if (!cache) {
    // 无缓存或已失效，重新探测
    const status = await probeMcp(mcpJson);
    config._mcpStatus = status;
  } else {
    config._mcpStatus = cache.status || {};
  }

  const result = evaluate(config, tool_name, tool_input, filePath);

  // 日志记录
  const logEntry = {
    ts: new Date().toLocaleString('sv-SE', { hour12: false }),
    tool: tool_name,
    file: filePath || '-',
    action: result?.action || 'pass',
    prefix: result?.prefix || '-',
    reason: result?.reason || '-',
  };
  writeLog(logEntry, config.debug);

  if (!result || result.action === 'pass') {
    process.exit(0);
  }

  if (result.action === 'block') {
    let message = `[JetBrains MCP Bridge] ${result.reason}。建议使用 ${result.suggest}。`;
    if (result.prefix) {
      message += ` (MCP: ${result.prefix})`;
    }
    // 软提示：exit 0 + additionalContext，Claude 自行决定是否使用 MCP 工具
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: message,
      },
    }) + '\n');
    process.exit(0);
  }

  process.exit(0);
}

main();
