const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { analyzeIncludeGraph, extractIncludeStatements } = require("../dist/sync/includeGraph.js");

test("extractIncludeStatements ignores commented include lines", () => {
  const content = [
    '% \\include "ignored.ily"',
    '\\include "a.ily"',
    '  \\include "b.ily" % trailing comment'
  ].join("\n");

  const includes = extractIncludeStatements(content);
  assert.deepEqual(includes, [
    { line: 2, includePath: "a.ily" },
    { line: 3, includePath: "b.ily" }
  ]);
});

test("analyzeIncludeGraph finds missing includes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lilypond-inc-test-"));
  const root = path.join(dir, "root.ly");
  await fs.writeFile(root, '\\include "missing.ily"\n{ c4 d e f }\n', "utf8");

  const result = await analyzeIncludeGraph(root);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0].message, /Missing include/);
});

test("analyzeIncludeGraph detects recursive includes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lilypond-inc-cycle-"));
  const root = path.join(dir, "root.ly");
  const a = path.join(dir, "a.ily");

  await fs.writeFile(root, '\\include "a.ily"\n{ c4 }\n', "utf8");
  await fs.writeFile(a, '\\include "root.ly"\n', "utf8");

  const result = await analyzeIncludeGraph(root);
  assert.ok(result.issues.some((issue) => issue.message.includes("Recursive include")));
});
