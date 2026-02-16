const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapTranspose, transposeWholeDocument } = require("../dist/sync/transposition.js");

test("wrapTranspose wraps selection with transpose block", () => {
  const wrapped = wrapTranspose("c4 d e f", "c", "d");
  assert.equal(wrapped, "\\transpose c d {\n  c4 d e f\n}");
});

test("transposeWholeDocument keeps prelude lines outside transpose", () => {
  const input = [
    "\\version \"2.24.4\"",
    "\\include \"common.ily\"",
    "",
    "{ c4 d e f }"
  ].join("\n");

  const output = transposeWholeDocument(input, "c", "d");

  assert.match(output, /^\\version \"2\.24\.4\"\n\\include \"common\.ily\"\n\n\\transpose c d \{/);
  assert.match(output, /\n  \{ c4 d e f \}\n\}\n$/);
});

test("transposeWholeDocument leaves empty body unchanged", () => {
  const input = "\\version \"2.24.4\"\n";
  assert.equal(transposeWholeDocument(input, "c", "d"), input);
});

test("transposeWholeDocument wraps top-level score blocks and preserves non-score sections", () => {
  const input = [
    "\\version \"2.24.4\"",
    "\\header { title = \"Demo\" }",
    "",
    "\\score {",
    "  \\new Staff { c4 d e f }",
    "}",
    "",
    "\\paper { indent = 0 }",
    ""
  ].join("\n");

  const output = transposeWholeDocument(input, "c", "d");

  assert.match(output, /\\header \{ title = "Demo" \}/);
  assert.match(output, /\\paper \{ indent = 0 \}/);
  assert.match(output, /\\score \{\n  \\transpose c d \{/);
  assert.match(output, /\\new Staff \{ c4 d e f \}/);
});

test("transposeWholeDocument skips score blocks already wrapped in transpose", () => {
  const input = [
    "\\score {",
    "  \\transpose c d {",
    "    c4 d e f",
    "  }",
    "}",
    ""
  ].join("\n");

  const output = transposeWholeDocument(input, "c", "d");
  assert.equal(output, input);
});
