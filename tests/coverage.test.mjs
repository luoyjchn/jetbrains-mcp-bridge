import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate, parseJson5 } from "../src/core.mjs";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const configRaw = readFileSync(resolve(projectRoot, "config", "default-global.json5"), "utf-8");
const config = parseJson5(configRaw);
config._mcpStatus = { "mcp__JetBrains-IDEA": true, "mcp__JetBrains-WebStorm": true, "mcp__JetBrains-PyCharm": true, "mcp__JetBrains-GoLand": true, "mcp__JetBrains-RustRover": true, "mcp__JetBrains-CLion": true, "mcp__JetBrains-PhpStorm": true, "mcp__JetBrains-RubyMine": true, "mcp__JetBrains-Rider": true };

describe("Feature coverage: bashPatterns", () => {
  const bashTests = [
    { cmd: 'grep -r "foo" .', desc: "grep" },
    { cmd: "rg -r foo .", desc: "rg" },
    { cmd: 'find . -name "*.java"', desc: "find" },
    { cmd: "Get-ChildItem -Recurse *.java", desc: "Get-ChildItem" },
    { cmd: "Select-String -Path *.log error", desc: "Select-String" },
    { cmd: "git log --oneline", desc: "git log" },
    { cmd: "git diff HEAD", desc: "git diff" },
    { cmd: "mvn clean install", desc: "mvn" },
    { cmd: "gradle build", desc: "gradle" },
    { cmd: "npm run build", desc: "npm run" },
    { cmd: "pnpm test", desc: "pnpm test" },
    { cmd: "yarn dev", desc: "yarn dev" },
    { cmd: "cat src/Main.java", desc: "cat source file" },
    { cmd: "head src/Main.java", desc: "head source file" },
    { cmd: "tail src/Main.ts", desc: "tail source file" },
    { cmd: "type src\\Main.java", desc: "type source file" },
    { cmd: "less src/Main.vue", desc: "less source file" },
    { cmd: "more src/App.py", desc: "more source file" },
    { cmd: "Get-Content src/Main.java", desc: "Get-Content source file" },
    { cmd: "gc src/Main.java", desc: "gc source file" },
  ];
  for (const { cmd, desc } of bashTests) {
    it(`blocks: ${desc}`, () => { assert.equal(evaluate(config, "Bash", { command: cmd }).action, "block"); });
  }
});

describe("Feature coverage: toolMap", () => {
  for (const tool of ["Grep", "Read", "Write", "Edit", "Glob"]) {
    it(`blocks: ${tool}`, () => { assert.equal(evaluate(config, tool, {}).action, "block"); });
  }
});

describe("Feature coverage: enabled switch", () => {
  it("passes when enabled is false", () => {
    const c = { ...config, enabled: false };
    assert.deepStrictEqual(evaluate(c, "Bash", { command: "grep foo" }), { action: "pass" });
    assert.deepStrictEqual(evaluate(c, "Grep", {}), { action: "pass" });
  });
});

describe("Feature coverage: MCP offline", () => {
  it("passes when all MCP offline", () => {
    const c = { ...config, _mcpStatus: {} };
    assert.deepStrictEqual(evaluate(c, "Bash", { command: "grep foo" }), { action: "pass" });
    assert.deepStrictEqual(evaluate(c, "Grep", {}), { action: "pass" });
  });
});

describe("Feature coverage: fileTypeMap + sourceExtensions", () => {
  const fileTests = [
    { file: "/src/Main.java", desc: "Java" }, { file: "/src/App.kt", desc: "Kotlin" },
    { file: "/src/build.gradle", desc: "Gradle" }, { file: "/src/App.vue", desc: "Vue" },
    { file: "/src/index.ts", desc: "TypeScript" }, { file: "/src/index.js", desc: "JavaScript" },
    { file: "/src/main.py", desc: "Python" }, { file: "/src/main.go", desc: "Go" },
    { file: "/src/main.rs", desc: "Rust" }, { file: "/src/main.c", desc: "C" },
    { file: "/src/main.cpp", desc: "C++" }, { file: "/src/main.h", desc: "Header" },
    { file: "/src/index.php", desc: "PHP" }, { file: "/src/app.rb", desc: "Ruby" },
  ];
  for (const { file, desc } of fileTests) {
    it(`blocks Read for ${desc}`, () => { assert.equal(evaluate(config, "Read", { file_path: file }, file).action, "block"); });
  }
});

describe("Feature coverage: passthrough for unlisted tools", () => {
  for (const tool of ["Terminal", "Agent", "WebFetch", "TodoWrite"]) {
    it(`passes: ${tool}`, () => { assert.equal(evaluate(config, tool, {}).action, "pass"); });
  }
});
