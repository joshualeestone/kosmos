'use strict';
/**
 * kosmos#7746 item 1: the backup state's async read and write give the event loop a turn every 50,000 rows and answer
 * as the sync ones do, and a write skips its full re-read of the old file only when that file is exactly the one this
 * process last read or wrote.
 *
 *   node --test engine/backupstate-7746.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-backupstate-7746-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const bs = require('./backupstate');
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const name = (i) => crypto.createHash('sha256').update(String(i)).digest('hex');
const entry = (i, label) => [name(i), { key: `o1/acct1/1/${label}/k${i}`, lockedUntilMs: 1800000000000 + i, memberKeyId: 'ab'.repeat(16) }];
let n = 0;
const ids = () => { n += 1; return [`o${n}`, `m${n}`]; };
const stateOf = (rows) => ({ job: { waits: 2 }, periods: [{ label: '2026-W41', namingKey: crypto.randomBytes(32), bucket: 'bucket/',
  index: new Map(Array.from({ length: rows }, (_, i) => entry(i, '2026-W41'))) }] });

/* How many times fs.readFileSync reads `file` while f runs. */
async function readsOf(file, f) {
  const real = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (p, ...rest) { if (String(p) === file) reads++; return real.call(fs, p, ...rest); };
  try { await f(); } finally { fs.readFileSync = real; }
  return reads;
}

test('#7746: the async read and write answer exactly as the sync ones do', async () => {
  const [org, member] = ids();
  const state = stateOf(120000);
  await bs.writeStateAsync(org, member, state);
  const a = await bs.readStateAsync(org, member);
  const s = bs.readState(org, member);
  assert.equal(a.ok, true);
  assert.deepEqual(a, s);
  assert.equal(a.state.periods[0].index.size, 120000);
  assert.ok(a.state.periods[0].namingKey.equals(state.periods[0].namingKey));
  // And a malformed file is refused by both, with the same sentence.
  fs.writeFileSync(bs.fileFor(org, member), '{ not ours');
  assert.deepEqual(await bs.readStateAsync(org, member), bs.readState(org, member));
  assert.equal(bs.readState(org, member).ok, false);
});

test('#7746: the async write refuses what the sync one refuses, and a file that is not ours', async () => {
  const [org, member] = ids();
  const bad = stateOf(3);
  bad.periods[0].index.set(name(99), { key: 'not/a/key', lockedUntilMs: 1, memberKeyId: 'ab'.repeat(16) });
  await assert.rejects(() => bs.writeStateAsync(org, member, bad), /would not read back/);
  fs.mkdirSync(path.dirname(bs.fileFor(org, member)), { recursive: true });
  fs.writeFileSync(bs.fileFor(org, member), '{ not ours');
  await assert.rejects(() => bs.writeStateAsync(org, member, stateOf(3)), (err) => /discardState it first/.test(err.message) && err.code === 'refused');
  assert.equal(fs.readFileSync(bs.fileFor(org, member), 'utf8'), '{ not ours');
});

test('#7746: a write re-reads the old file only when it is not exactly the one this process last read or wrote', async () => {
  const [org, member] = ids();
  const f = bs.fileFor(org, member);
  bs.writeState(org, member, stateOf(5));
  assert.equal(await readsOf(f, () => bs.writeState(org, member, stateOf(5))), 0, 'unchanged since our own write: no re-read');
  // Moved first, so only the read below can be what lets the write skip (our own write's fingerprint no longer matches).
  fs.utimesSync(f, new Date(), new Date(Date.now() + 3000));
  bs.readState(org, member);
  assert.equal(await readsOf(f, () => bs.writeStateAsync(org, member, stateOf(5))), 0, 'unchanged since our own read: no re-read');
  // Control: the same file touched by anyone else (its mtime moved) is read in full again, and still written.
  fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
  assert.equal(await readsOf(f, () => bs.writeState(org, member, stateOf(5))), 1, 'changed: read in full');
  // A foreign file written over ours is refused, even right after our own write.
  bs.writeState(org, member, stateOf(5));
  fs.writeFileSync(f, JSON.stringify({ v: 1, org, member: 'someone else', job: {}, periods: [] }));
  assert.throws(() => bs.writeState(org, member, stateOf(5)), /discardState it first/);
});

test('#7746: the async read and write give the event loop a turn while they work', async () => {
  const [org, member] = ids();
  const state = stateOf(200000);
  for (const [what, f] of [['write', () => bs.writeStateAsync(org, member, state)], ['read', () => bs.readStateAsync(org, member)]]) {
    let turns = 0, done = false;
    const spin = () => { if (done) return; turns++; setImmediate(spin); };
    setImmediate(spin);
    await f();
    done = true;
    assert.ok(turns >= 3, `${what}: ${turns} turns while it ran`);
  }
  // Control: the sync write gives none (the spinner only runs after it).
  let turns = 0, done = false;
  const spin = () => { if (done) return; turns++; setImmediate(spin); };
  setImmediate(spin);
  bs.writeState(org, member, state);
  done = true;
  assert.equal(turns, 0);
});
