'use strict';
// test-support/remove-tree.js (#5010, #5074). These run everywhere: they drive removeTree with a
// stand-in rm, so a Mac can show the retry is reached, and one real folder shows the plain path
// still removes. Moved from tools.windows-kosmos-shims-570.test.js with the function.
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { removeTree } = require('./test-support/remove-tree');

function failingRm(codes) {
  const calls = [];
  const rm = (dir) => { calls.push(dir); const code = codes.shift(); if (code) { const e = new Error(code + ': busy'); e.code = code; throw e; } };
  return { rm, calls };
}

test('#5010: cleanup retries EPERM and EBUSY with a growing pause, then removes', () => {
  const { rm, calls } = failingRm(['EPERM', 'EBUSY']);
  const pauses = [];
  const attempts = removeTree('X', { rm, pause: (ms) => pauses.push(ms), quiet: true });
  assert.equal(attempts, 3);
  assert.deepEqual(calls, ['X', 'X', 'X']);
  assert.deepEqual(pauses, [250, 500]);
});

test('#5010: cleanup gives up after its tries and throws the last error', () => {
  const { rm, calls } = failingRm(['EPERM', 'EPERM', 'EPERM', 'EPERM']);
  assert.throws(() => removeTree('X', { rm, pause: () => {}, tries: 3 }), { code: 'EPERM', message: /^cleanup could not remove X after 3 tries \(still busy or denied, EPERM\)/ });
  assert.equal(calls.length, 3);
});

test('#5010: the default pause really waits before the next try', () => {
  const { rm, calls } = failingRm(['EBUSY']);
  const started = Date.now();
  assert.equal(removeTree('X', { rm, quiet: true }), 2);
  assert.ok(Date.now() - started >= 200, 'the second try came without the first pause');
  assert.equal(calls.length, 2);
});

test('#5010: cleanup does not retry an error that waiting cannot fix', () => {
  const { rm, calls } = failingRm(['EINVAL']);
  assert.throws(() => removeTree('X', { rm, pause: () => { throw new Error('paused'); } }), { code: 'EINVAL' });
  assert.equal(calls.length, 1);
});

test('#5010: a real folder is removed on the first try', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-remove-tree-'));
  fs.writeFileSync(path.join(dir, 'f'), 'x');
  assert.equal(removeTree(dir), 1);
  assert.equal(fs.existsSync(dir), false);
});
