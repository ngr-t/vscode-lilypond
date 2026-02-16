const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { collectArtifacts } = require('../dist/output/artifacts.js');

test('collectArtifacts returns known score artifacts sorted by latest first', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lilypond-artifacts-'));
  const scorePath = path.join(tempDir, 'piece.ly');

  await fs.writeFile(scorePath, '\\version "2.24.0"\n', 'utf8');
  await fs.writeFile(path.join(tempDir, 'piece.pdf'), 'pdf', 'utf8');
  await fs.writeFile(path.join(tempDir, 'piece.midi'), 'midi', 'utf8');
  await fs.writeFile(path.join(tempDir, 'piece-1.svg'), 'svg', 'utf8');
  await fs.writeFile(path.join(tempDir, 'other.pdf'), 'ignore', 'utf8');

  await new Promise((resolve) => setTimeout(resolve, 10));
  await fs.writeFile(path.join(tempDir, 'piece-2.svg'), 'svg2', 'utf8');

  const artifacts = await collectArtifacts(scorePath);
  const names = artifacts.map((entry) => path.basename(entry.path));

  assert.deepEqual(names, ['piece-2.svg', 'piece-1.svg', 'piece.midi', 'piece.pdf']);

  await fs.rm(tempDir, { recursive: true, force: true });
});
