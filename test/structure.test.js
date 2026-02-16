const test = require("node:test");
const assert = require("node:assert/strict");
const { parseStructureNodes } = require("../dist/sync/structure.js");

test("parseStructureNodes finds assignments and blocks", () => {
  const source = [
    "theme = \\relative c' { c4 d e f }",
    "",
    "\\score {",
    "  \\new Staff { c1 }",
    "}"
  ].join("\n");

  const nodes = parseStructureNodes(source);
  assert.ok(nodes.some((n) => n.label === "theme ="));
  assert.ok(nodes.some((n) => n.label === "\\score"));
  assert.ok(nodes.some((n) => n.label === "\\new"));
});

test("parseStructureNodes ignores commented commands", () => {
  const source = [
    "% \\score { ignored }",
    "\\header { title = \"A\" }"
  ].join("\n");

  const nodes = parseStructureNodes(source);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].label, "\\header");
});

test("parseStructureNodes computes block range end", () => {
  const source = [
    "\\score {",
    "  \\layout {",
    "    indent = 0\\mm",
    "  }",
    "}"
  ].join("\n");

  const nodes = parseStructureNodes(source);
  const score = nodes.find((n) => n.label === "\\score");
  assert.ok(score);
  assert.equal(score.startLine, 0);
  assert.equal(score.endLine, 4);
});
