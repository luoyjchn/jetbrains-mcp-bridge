/**
 * JetBrains IDE MCP port scanner and identifier.
 *
 * Probes default ports for supported IDEs (63342-63348).
 * If a port times out or returns an unrecognized IDE, prompts user for manual input.
 *
 * Usage: node scripts/init.mjs [--json]
 */

import { createInterface } from 'node:readline';

const REQUEST_TIMEOUT_MS = 2000;

/**
 * Supported IDE series with their known name patterns.
 */
const SUPPORTED_IDES = [
  { series: 'idea',      patterns: ['intellij', 'idea'] },
  { series: 'webstorm',  patterns: ['webstorm'] },
  { series: 'pycharm',   patterns: ['pycharm'] },
  { series: 'goland',    patterns: ['goland'] },
  { series: 'rustrover', patterns: ['rustrover'] },
  { series: 'clion',     patterns: ['clion'] },
  { series: 'phpstorm',  patterns: ['phpstorm'] },
];

/**
 * JetBrains IDEs start at port 63342 by default.
 * Each subsequent IDE occupies the next port.
 */
const BASE_PORT = 63342;
const MAX_PROBE_PORTS = SUPPORTED_IDES.length;

/**
 * Probe a single port for JetBrains MCP presence.
 * Returns IDE info if detected, null otherwise.
 */
async function probePort(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`http://localhost:${port}/info`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    let ideName = '';

    if (contentType.includes('application/json')) {
      const body = await res.json();
      ideName = body.name || body.ideName || '';
    } else {
      const text = await res.text();
      ideName = text.slice(0, 200);
    }

    if (!ideName) ideName = 'JetBrains IDE';

    const series = identifySeries(ideName);

    return { port, ideName, series, transport: 'sse', url: `http://localhost:${port}/sse` };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Identify IDE series from name string.
 */
function identifySeries(name) {
  const lower = name.toLowerCase();
  for (const { series, patterns } of SUPPORTED_IDES) {
    if (patterns.some((p) => lower.includes(p))) return series;
  }
  return 'unknown';
}

/**
 * Scan default ports for supported IDEs in parallel.
 */
async function scanDefaultPorts() {
  const ports = [];
  for (let i = 0; i < MAX_PROBE_PORTS; i++) {
    ports.push(BASE_PORT + i);
  }

  const results = await Promise.all(ports.map(probePort));
  return results.filter(Boolean);
}

/**
 * Prompt user to enter a port number manually.
 * Returns port number or null if cancelled.
 */
async function promptPort(ideName) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  return new Promise((resolve) => {
    rl.question(`\n请输入 ${ideName || 'IDE'} 的 MCP 端口号（直接回车跳过）: `, (answer) => {
      rl.close();
      const port = parseInt(answer.trim(), 10);
      resolve(Number.isFinite(port) && port > 0 ? port : null);
    });
  });
}

/**
 * Main entry point.
 */
async function main() {
  const asJson = process.argv.includes('--json');

  if (!asJson) {
    console.log(`探测 JetBrains IDE 默认端口 ${BASE_PORT}-${BASE_PORT + MAX_PROBE_PORTS - 1}...`);
  }

  const ides = await scanDefaultPorts();

  if (asJson) {
    console.log(JSON.stringify(ides, null, 2));
    return;
  }

  if (ides.length === 0) {
    console.log('未检测到 JetBrains IDE。请确认 IDE 已启动且 MCP 插件已启用。');

    const port = await promptPort('');
    if (port) {
      const ide = await probePort(port);
      if (ide) {
        console.log(`\n发现 ${ide.ideName} @ localhost:${ide.port} (${ide.transport} → ${ide.url})`);
      } else {
        console.log(`端口 ${port} 无响应，请检查 IDE 配置。`);
      }
    }
    return;
  }

  console.log(`\n发现 ${ides.length} 个 JetBrains IDE:\n`);
  for (const ide of ides) {
    console.log(`  ${ide.ideName} @ localhost:${ide.port} (${ide.transport} → ${ide.url})`);
  }

  // 检查是否有未识别的端口占用（IDE 数量超出预期时提示）
  const nextPort = BASE_PORT + ides.length;
  const extra = await probePort(nextPort);
  if (extra) {
    console.log(`\n检测到额外 IDE: ${extra.ideName} @ localhost:${nextPort}`);
    console.log('建议手动确认端口映射。');
  }
}

main().catch((err) => {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ error: err.message }));
  } else {
    console.error('Error:', err.message);
  }
  process.exit(1);
});
