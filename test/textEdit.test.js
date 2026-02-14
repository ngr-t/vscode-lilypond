const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTextEditHref, rewriteTexteditTargets } = require("../dist/sync/textEdit.js");

test("parseTextEditHref parses with end column", () => {
  const href = "textedit:///Users/a/Documents/example.ly:78:9:10";
  const parsed = parseTextEditHref(href);

  assert.deepEqual(parsed, {
    filePath: "/Users/a/Documents/example.ly",
    line: 78,
    column: 9,
    endColumn: 10
  });
});

test("parseTextEditHref parses without end column", () => {
  const href = "textedit:///Users/a/Documents/example.ly:12:4";
  const parsed = parseTextEditHref(href);

  assert.deepEqual(parsed, {
    filePath: "/Users/a/Documents/example.ly",
    line: 12,
    column: 4,
    endColumn: undefined
  });
});

test("parseTextEditHref handles encoded spaces", () => {
  const href = "textedit:///Users/a/My%20Scores/demo.ly:1:1:2";
  const parsed = parseTextEditHref(href);

  assert.equal(parsed.filePath, "/Users/a/My Scores/demo.ly");
  assert.equal(parsed.line, 1);
  assert.equal(parsed.column, 1);
  assert.equal(parsed.endColumn, 2);
});

test("rewriteTexteditTargets rewrites cache input path to source path", () => {
  const originalPath = "/Users/a/Library/Application Support/Code/User/globalStorage/preview/input.ly";
  const sourcePath = "/Users/a/Documents/example.ly";
  const svg = '<a xlink:href="textedit:///Users/a/Library/Application%20Support/Code/User/globalStorage/preview/input.ly:78:9:10"></a>';

  const rewritten = rewriteTexteditTargets(svg, originalPath, sourcePath);

  assert.match(rewritten, /textedit:\/\/\/Users\/a\/Documents\/example\.ly:78:9:10/);
  assert.doesNotMatch(rewritten, /input\.ly:78:9:10/);
});

test("rewriteTexteditTargets leaves unrelated files untouched", () => {
  const originalPath = "/Users/a/cache/input.ly";
  const sourcePath = "/Users/a/Documents/example.ly";
  const svg = '<a xlink:href="textedit:///Users/a/other.ly:4:2:3"></a>';

  const rewritten = rewriteTexteditTargets(svg, originalPath, sourcePath);

  assert.equal(rewritten, svg);
});
