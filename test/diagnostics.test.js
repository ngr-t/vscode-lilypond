const test = require("node:test");
const assert = require("node:assert/strict");
const { parseLilypondDiagnostics } = require("../dist/sync/diagnostics.js");

test("parseLilypondDiagnostics parses warning and error lines", () => {
  const output = [
    "/Users/a/example.ly:12:4: warning: missing bar check",
    "/Users/a/example.ly:40:9: error: unknown escaped string"
  ].join("\n");

  const diagnostics = parseLilypondDiagnostics(output);

  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics[0], {
    filePath: "/Users/a/example.ly",
    line: 12,
    column: 4,
    severity: "warning",
    message: "missing bar check"
  });
  assert.deepEqual(diagnostics[1], {
    filePath: "/Users/a/example.ly",
    line: 40,
    column: 9,
    severity: "error",
    message: "unknown escaped string"
  });
});

test("parseLilypondDiagnostics defaults column to 1 when omitted", () => {
  const output = "/Users/a/example.ly:5: warning: no \\version statement found";
  const diagnostics = parseLilypondDiagnostics(output);

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].column, 1);
});

test("parseLilypondDiagnostics ignores non-diagnostic lines", () => {
  const output = [
    "Processing '/Users/a/example.ly'",
    "Interpreting music...",
    "/Users/a/example.ly:7:3: warning: sample warning"
  ].join("\n");

  const diagnostics = parseLilypondDiagnostics(output);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].line, 7);
});
