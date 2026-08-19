import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluate, deepMerge, parseJson5, globToRegex, resolvePrefix, matchesAny, isMcpOnline, isInProject, normalizePath } from "../src/core.mjs";

// 统一使用短名称（如 "JetBrains-IDEA"）作为 status key
const mcpOnline = { _mcpStatus: { "JetBrains-IDEA": true, "JetBrains-WebStorm": true } };
const mcpOffline = { _mcpStatus: {} };

describe("evaluate()", () => {
  it("returns pass when enabled is false", () => {
    assert.deepStrictEqual(evaluate({ enabled: false, ...mcpOnline }, "Bash", { command: "grep foo" }), { action: "pass" });
  });

  it("passes all when MCP offline", () => {
    const config = { enabled: true, ...mcpOffline, bashPatterns: [{ pattern: "grep\\s+", reason: "搜索", suggest: { _default: "search_regex" } }], toolMap: { Grep: { reason: "搜索", suggest: { _default: "search_regex" } } } };
    assert.deepStrictEqual(evaluate(config, "Bash", { command: "grep -r foo ." }), { action: "pass" });
    assert.deepStrictEqual(evaluate(config, "Grep", {}), { action: "pass" });
  });

  it("blocks Bash command when MCP online", () => {
    const config = { ...mcpOnline, bashPatterns: [{ pattern: "grep|rg|findstr|Select-String", reason: "代码搜索", suggest: { _default: "search_regex" } }] };
    const result = evaluate(config, "Bash", { command: "grep -r foo ." });
    assert.equal(result.action, "block");
    assert.equal(result.reason, "代码搜索");
  });

  it("bashPattern matching is case insensitive", () => {
    const config = { ...mcpOnline, bashPatterns: [{ pattern: "grep\\s+", reason: "搜索", suggest: { _default: "search_regex" } }] };
    assert.equal(evaluate(config, "Bash", { command: "GREP -r foo ." }).action, "block");
  });

  it("blocks tool in toolMap when MCP online", () => {
    const config = { ...mcpOnline, toolMap: { Grep: { reason: "搜索", suggest: { _default: "search_regex" } } } };
    assert.equal(evaluate(config, "Grep", { pattern: "foo" }).action, "block");
  });

  it("passes tool when specific MCP offline", () => {
    const config = { _mcpStatus: { "JetBrains-IDEA": false }, toolMap: { Grep: { reason: "搜索", suggest: { _default: "search_regex" } } }, defaultPrefix: "JetBrains-IDEA" };
    assert.deepStrictEqual(evaluate(config, "Grep", {}), { action: "pass" });
  });

  it("blocks tool when specific MCP online", () => {
    const config = { _mcpStatus: { "JetBrains-IDEA": true, "JetBrains-WebStorm": false }, toolMap: { Grep: { reason: "搜索", suggest: { _default: "search_regex" } } }, defaultPrefix: "JetBrains-IDEA" };
    assert.equal(evaluate(config, "Grep", {}).action, "block");
  });

  it("returns pass for empty config", () => {
    assert.deepStrictEqual(evaluate({}, "Bash", { command: "ls" }), { action: "pass" });
  });

  it("Write tool blocks when MCP online", () => {
    const config = { ...mcpOnline, sourceExtensions: [".java"], fileTypeMap: { ".java": "JetBrains-IDEA" } };
    assert.equal(evaluate(config, "Write", {}, "/src/Foo.java").action, "block");
  });

  it("Write tool passes when specific MCP offline", () => {
    const config = { _mcpStatus: { "JetBrains-IDEA": false }, sourceExtensions: [".java"], fileTypeMap: { ".java": "JetBrains-IDEA" } };
    assert.deepStrictEqual(evaluate(config, "Write", {}, "/src/Foo.java"), { action: "pass" });
  });

  it("passes when filePath outside projectPath", () => {
    const config = { ...mcpOnline, projectPath: "/home/user/project", toolMap: { Read: { reason: "读取", suggest: { _default: "read_file" } } } };
    assert.deepStrictEqual(evaluate(config, "Read", {}, "/other/path/file.java"), { action: "pass" });
  });

  it("blocks when filePath inside projectPath", () => {
    const config = { ...mcpOnline, projectPath: "/home/user/project", toolMap: { Read: { reason: "读取", suggest: { _default: "read_file" } } } };
    assert.equal(evaluate(config, "Read", {}, "/home/user/project/src/Main.java").action, "block");
  });

  it("uses _cwd as fallback when projectPath empty", () => {
    const config = { ...mcpOnline, projectPath: "", _cwd: "/home/user/project", toolMap: { Read: { reason: "读取", suggest: { _default: "read_file" } } } };
    assert.equal(evaluate(config, "Read", {}, "/home/user/project/src/Main.java").action, "block");
    assert.deepStrictEqual(evaluate(config, "Read", {}, "/other/path/file.java"), { action: "pass" });
  });

  it("excludePatterns: hard exclude always passes", () => {
    const config = { ...mcpOnline, excludePatterns: [".claude/**"], toolMap: { Write: { reason: "写入", suggest: { _default: "apply_patch" } } } };
    assert.deepStrictEqual(evaluate(config, "Write", {}, ".claude/config.json5"), { action: "pass" });
  });

  it("excludePatterns: matches Windows backslash paths", () => {
    const config = { ...mcpOnline, excludePatterns: [".claude/**"], toolMap: { Write: { reason: "写入", suggest: { _default: "apply_patch" } } } };
    assert.deepStrictEqual(evaluate(config, "Write", {}, ".claude\\.mcp.json"), { action: "pass" });
  });

  it("excludePatterns: matches absolute paths with projectPath", () => {
    const config = { ...mcpOnline, projectPath: "/home/user/project", excludePatterns: [".claude/**", "node_modules/**"], toolMap: { Read: { reason: "读取", suggest: { _default: "read_file" } } } };
    assert.deepStrictEqual(evaluate(config, "Read", {}, "/home/user/project/.claude/config.json5"), { action: "pass" });
    assert.deepStrictEqual(evaluate(config, "Read", {}, "/home/user/project/node_modules/pkg/index.js"), { action: "pass" });
    assert.equal(evaluate(config, "Read", {}, "/home/user/project/src/Main.java").action, "block");
  });
});

describe("isMcpOnline()", () => {
  it("returns false for empty mcpStatus", () => { assert.equal(isMcpOnline(undefined, {}), false); });
  it("returns false for null mcpStatus", () => { assert.equal(isMcpOnline(undefined, null), false); });
  it("returns true when prefix is online", () => { assert.equal(isMcpOnline("JetBrains-IDEA", { "JetBrains-IDEA": true }), true); });
  it("returns false when prefix is offline", () => { assert.equal(isMcpOnline("JetBrains-IDEA", { "JetBrains-IDEA": false }), false); });
  it("returns false when prefix not in map", () => { assert.equal(isMcpOnline("JetBrains-IDEA", { "JetBrains-WebStorm": true }), false); });
  it("returns true when any MCP online (no prefix)", () => { assert.equal(isMcpOnline(undefined, { "JetBrains-IDEA": true, "JetBrains-WebStorm": false }), true); });
  it("returns false when all MCP offline (no prefix)", () => { assert.equal(isMcpOnline(undefined, { "JetBrains-IDEA": false, "JetBrains-WebStorm": false }), false); });
});

describe("isInProject()", () => {
  it("returns true when projectPath empty", () => { assert.equal(isInProject("/any/path", ""), true); });
  it("returns true when under projectPath", () => { assert.equal(isInProject("/home/user/project/src/Main.java", "/home/user/project"), true); });
  it("returns false when outside projectPath", () => { assert.equal(isInProject("/other/path/file.java", "/home/user/project"), false); });
});

describe("normalizePath()", () => {
  it("normalizes backslashes", () => { assert.equal(normalizePath("C:\\Users\\test\\file.java", ""), "C:/Users/test/file.java"); });
  it("converts to relative when under projectPath", () => { assert.equal(normalizePath("/home/user/project/src/Main.java", "/home/user/project"), "src/Main.java"); });
});

describe("globToRegex()", () => {
  it("converts * wildcard", () => { const re = globToRegex("*.java"); assert.ok(re.test("Main.java")); assert.ok(!re.test("src/Main.java")); });
  it("converts ** wildcard", () => { const re = globToRegex("**/*.java"); assert.ok(re.test("src/main/Main.java")); assert.ok(re.test("Main.java")); });
  it("converts ? wildcard", () => { const re = globToRegex("file?.txt"); assert.ok(re.test("file1.txt")); assert.ok(!re.test("file12.txt")); });
  it("converts {a,b} alternation", () => { const re = globToRegex("*.{java,kt}"); assert.ok(re.test("Main.java")); assert.ok(re.test("App.kt")); assert.ok(!re.test("index.js")); });
  it("matches backslash paths", () => { const re = globToRegex(".claude/**"); assert.ok(re.test(".claude\\config.json5")); });
});

describe("resolvePrefix()", () => {
  const mcpMapping = { "JetBrains-IDEA": "src/main/**/*.java", "JetBrains-WebStorm": "src/frontend/**" };
  it("matches file path to correct prefix", () => { assert.equal(resolvePrefix("src/main/com/App.java", mcpMapping, "default"), "JetBrains-IDEA"); });
  it("returns defaultPrefix when no match", () => { assert.equal(resolvePrefix("docs/README.md", mcpMapping, "JetBrains-IDE"), "JetBrains-IDE"); });
  it("supports array patterns with exclusion", () => {
    const mapping = { "JetBrains-IDEA": ["src/**", "!test/**"] };
    assert.equal(resolvePrefix("src/main/App.java", mapping, "default"), "JetBrains-IDEA");
    assert.equal(resolvePrefix("test/AppTest.java", mapping, "default"), "default");
  });
});

describe("deepMerge()", () => {
  it("deep merges objects", () => { assert.deepStrictEqual(deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3, d: 4 } }), { a: { b: 1, c: 3, d: 4 } }); });
  it("replaces arrays", () => { assert.deepStrictEqual(deepMerge({ a: [1, 2] }, { a: [3] }), { a: [3] }); });
  it("skips undefined", () => { assert.deepStrictEqual(deepMerge({ a: 1 }, { a: undefined }), { a: 1 }); });
});

describe("parseJson5()", () => {
  it("strips comments", () => { assert.deepStrictEqual(parseJson5('{ "a": 1 // comment\n}'), { a: 1 }); });
  it("removes trailing commas", () => { assert.deepStrictEqual(parseJson5('{ "a": 1, }'), { a: 1 }); });
  it("throws on invalid", () => { assert.throws(() => parseJson5('{ "a": }')); });
});
