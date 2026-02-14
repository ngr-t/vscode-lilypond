const test = require("node:test");
const assert = require("node:assert/strict");
const { chooseBestAnchor, scoreAnchorCandidate } = require("../dist/sync/anchorMatch.js");

function candidate(anchor, line, column, endColumn = column) {
  return {
    anchor,
    target: { line, column, endColumn }
  };
}

test("scoreAnchorCandidate prefers in-range over out-of-range", () => {
  const inRange = scoreAnchorCandidate(candidate("a", 10, 5, 8), 10, 6, false);
  const outRange = scoreAnchorCandidate(candidate("b", 10, 12, 14), 10, 6, false);
  assert.ok(inRange < outRange);
});

test("chooseBestAnchor selects closest candidate by score", () => {
  const items = [candidate("a", 10, 1), candidate("b", 10, 8), candidate("c", 12, 3)];
  const picked = chooseBestAnchor(items, 10, 8, null, 0);
  assert.equal(picked.anchor, "b");
});

test("chooseBestAnchor keeps current selection when improvement is small", () => {
  const current = candidate("current", 10, 8, 9);
  const other = candidate("other", 10, 9, 10);
  const picked = chooseBestAnchor([current, other], 10, 9, "current", 5);
  assert.equal(picked.anchor, "current");
});

test("chooseBestAnchor switches when improvement exceeds hysteresis", () => {
  const current = candidate("current", 10, 1, 1);
  const better = candidate("better", 10, 20, 20);
  const picked = chooseBestAnchor([current, better], 10, 20, "current", 10);
  assert.equal(picked.anchor, "better");
});
