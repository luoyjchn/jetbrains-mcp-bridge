import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adapterPath = resolve(__dirname, "..", "hooks", "jetbrains-mcp-bridge.mjs");

// 临时目录（无 .mcp.json），确保 hook 不会因 cwd 或 pluginRoot 中的配置而拦截
const emptyDir = mkdtempSync(resolve(tmpdir(), "jmb-test-"));

function runAdapter(stdinData) {
  return new Promise((res) => {
    const child = spawn("node", [adapterPath], {
      timeout: 5000,
      cwd: emptyDir,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: emptyDir, CLAUDE_PLUGIN_DATA: emptyDir },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => { res({ exitCode: code ?? 0, stdout, stderr }); });
    child.on("error", () => { res({ exitCode: 1, stdout, stderr }); });
    if (typeof stdinData === "string") { child.stdin.write(stdinData); }
    else { child.stdin.write(JSON.stringify(stdinData)); }
    child.stdin.end();
  });
}

describe("Claude Code adapter integration (no .mcp.json → always pass)", () => {
  it("returns exit 0 for non-matching tool", async () => {
    assert.equal((await runAdapter({ tool_name: "Terminal", tool_input: {} })).exitCode, 0);
  });

  it("returns exit 0 for Bash command (no .mcp.json → pass through)", async () => {
    assert.equal((await runAdapter({ tool_name: "Bash", tool_input: { command: "grep -r foo ." } })).exitCode, 0);
  });

  it("returns exit 0 for Grep tool (no .mcp.json → pass through)", async () => {
    assert.equal((await runAdapter({ tool_name: "Grep", tool_input: { pattern: "foo" } })).exitCode, 0);
  });

  it("returns exit 0 for invalid JSON input", async () => {
    assert.equal((await runAdapter("not json")).exitCode, 0);
  });

  it("returns exit 0 for Read tool (no .mcp.json → pass through)", async () => {
    assert.equal((await runAdapter({ tool_name: "Read", tool_input: { file_path: "/foo" } })).exitCode, 0);
  });

  it("returns exit 0 for empty stdin", async () => {
    assert.equal((await runAdapter("")).exitCode, 0);
  });
});
