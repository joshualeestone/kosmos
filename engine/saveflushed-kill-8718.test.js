'use strict';
/**
 * kosmos#8718: a writer killed mid-save leaves the old file or the new one, never a torn one. store.saveFlushed
 * (#5434) writes a temp, flushes it, and renames; this kills a child with SIGKILL while it saves in a loop and reads
 * the file after each kill. The damage a crash leaves is NAMED at start-up by engine/storecheck.js (#7248), which never
 * changes a store by itself; this pins the write side that keeps it from happening on the flushed path.
 *
 *   node --test engine/saveflushed-kill-8718.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'saveflushed-kill-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));
function freshRoot(name) {
  const r = path.join(SB, name);
  fs.mkdirSync(r, { recursive: true });
  return r;
}

/* A writer killed mid-save leaves the old file or the new one, never a torn one: store.saveFlushed (#5434) writes a
   temp, flushes it, and renames. A child is killed with SIGKILL while saving in a loop; the file must always parse.
   What this can and cannot see: a SIGKILL ends the process, not the machine, so the page cache survives and this proves
   the temp-then-rename half (no reader ever sees a half-written file). The flush half, which is what a power loss
   needs, is pinned by the order of fsync and rename in engine/*fsync-5434.test.js; no test here can cut the power. */
test('a kill during a flushed save leaves a whole file', { skip: process.platform === 'win32' && 'checked on a Mac only so far' }, () => {
  const dir = freshRoot('kill');
  const f = path.join(dir, 'state.json');
  fs.writeFileSync(f, JSON.stringify({ n: 0, pad: 'x'.repeat(20000) }));
  const child = `
    process.env.AGENT_WORKFORCE_DATA = ${JSON.stringify(path.join(SB, 'killdata'))};
    const store = require(${JSON.stringify(path.join(__dirname, 'store.js'))});
    const f = ${JSON.stringify(f)};
    for (let n = 1; ; n++) store.saveFlushed(f, JSON.stringify({ n, pad: 'x'.repeat(20000 + (n % 997)) }));
  `;
  let saved = 0;
  for (let i = 0; i < 5; i++) {
    const r = spawnSync(process.execPath, ['-e', child], { timeout: 600 + i * 97, killSignal: 'SIGKILL' });
    assert.equal(r.signal, 'SIGKILL', 'the writer was killed mid-loop, not finished');
    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.equal(typeof parsed.n, 'number');
    if (parsed.n > 0) saved++;
  }
  assert.ok(saved > 0, 'at least one round saved before its kill, so the kill landed while saves were happening');
});
