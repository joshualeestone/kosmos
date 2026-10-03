'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #5158 slice 3: Antigravity usage counted once per model call, on the day of the call, in the four buckets, against the
 * conversation's folder. Conversations are SYNTHESIZED (test-support/agyfixture.js) in the layout measured on 25 real
 * conversations on this fleet 2026-10-03; no real conversation is committed.
 *   node --test engine/usageagy-5158.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

/* Every root sandboxed before any require: the scanner loads agysession.js, which loads status.js. */
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'ua5158-'));
process.env.AGENT_WORKFORCE_AGY_HOME = path.join(SB, 'antigravity-cli');
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'LaunchAgents');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, '.claude');
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });

const { scanProviders, _agyCache } = require('./usageproviders');
const { generation, writeConversation } = require('../test-support/agyfixture');

let n = 0;
/** A fresh agy home holding one conversation; returns { home, file, dir }. */
function agyConversation(gens, opts) {
  n += 1;
  const home = path.join(SB, 'agy-' + n);
  const dir = fs.mkdtempSync(path.join(SB, 'work-'));
  const { file } = writeConversation(home, dir, gens, opts);
  return { home, file, dir: fs.realpathSync(dir) };
}
const only = (home, extra = {}) => scanProviders({ homes: { codex: [], gemini: [], grok: [], antigravity: [home] }, ...extra });
const secs = (iso) => Date.parse(iso) / 1000;

test('each call is dated by its OWN step, not the user turn before it, and lands in the four buckets', async () => {
  const c = agyConversation([
    generation({ prompt: 12421, reply: 325, thoughts: 60 }),
    generation({ prompt: 2000, cached: 18000, reply: 478, thoughts: 119 }),
  ], {
    workspace: '/w/agyagent',
    steps: [
      { type: 14, secs: secs('2026-10-01T23:59:58Z') },             // the user's turn, the evening before
      { type: 15, secs: secs('2026-10-02T00:00:03Z') },             // call 0's step (idx 0 is left off the wire)
      { type: 132, secs: secs('2026-10-02T00:00:05Z') },            // a tool result, no idx
      { type: 15, secs: secs('2026-10-02T00:00:09Z'), idx: 1 },     // call 1's step
    ],
  });
  const r = await only(c.home);
  assert.equal(r.complete, true);
  assert.deepEqual(Object.keys(r.days), ['2026-10-02'], 'call 0 is dated by its type-15 step, not the earlier user turn');
  const b = r.days['2026-10-02']['gemini-3.8-flash'];
  assert.equal(b.input_tokens, 12421 + 2000, 'input is the uncached prompt');
  assert.equal(b.cache_read_input_tokens, 18000, 'the cached prompt is a cache read');
  assert.equal(b.output_tokens, 325 + 60 + 478 + 119, 'thoughts are output');
  assert.equal(b.cache_creation_input_tokens, 0);
  assert.equal(b.rows, 2);
  assert.equal(r.folders['2026-10-02']['/w/agyagent'].rows, 2, 'kept against the conversation\'s folder');
});

test('calls either side of UTC midnight land on their own days', async () => {
  const c = agyConversation([generation({ prompt: 100, reply: 10 }), generation({ prompt: 200, reply: 20 })], {
    steps: [{ type: 15, secs: secs('2026-10-01T23:59:59Z') }, { type: 15, secs: secs('2026-10-02T00:00:01Z'), idx: 1 }],
  });
  const r = await only(c.home);
  assert.equal(r.days['2026-10-01']['gemini-3.8-flash'].input_tokens, 100);
  assert.equal(r.days['2026-10-02']['gemini-3.8-flash'].input_tokens, 200);
});

/* The scanner skips a call with no usage message; the tally would also drop its all-zero row, so this pins the outcome,
   not which of the two does it. */
test('a failed call with no usage adds nothing; a call with tokens is counted once', async () => {
  const c = agyConversation([generation({ prompt: 500, reply: 5 }), generation({})], {
    steps: [{ type: 15, secs: secs('2026-10-02T10:00:00Z') }, { type: 17, secs: secs('2026-10-02T10:00:01Z'), idx: 1 }],
  });
  const r = await only(c.home);
  assert.equal(r.days['2026-10-02']['gemini-3.8-flash'].rows, 1);
});

test('a conversation with no steps or folder still counts every call, under "elsewhere", on a day that never moves', async () => {
  const c = agyConversation([generation({ prompt: 700, reply: 7 })]);
  const st = fs.statSync(c.file);
  const day = new Date(st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs).toISOString().slice(0, 10);
  const r = await only(c.home);
  assert.equal(r.days[day]['gemini-3.8-flash'].input_tokens, 700, 'the day the conversation file was created');
  assert.equal(r.folders[day][''].rows, 1);
  /* agy writes again much later, and the cache is cold: the call must stay on its day, or a frozen day loses it. */
  fs.writeFileSync(c.file + '-wal', 'written later');
  const later = new Date(Date.parse(day + 'T00:00:00Z') + 3 * 86400000);
  fs.utimesSync(c.file + '-wal', later, later);
  _agyCache.clear();
  assert.deepEqual(Object.keys((await only(c.home)).days), [day]);
});

test('a conversation untouched since the first wanted day is not read, unless its -wal was written since', async () => {
  const c = agyConversation([generation({ prompt: 900, reply: 9 })], { steps: [{ type: 15, secs: secs('2026-10-02T10:00:00Z') }] });
  const old = new Date('2026-09-01T00:00:00Z');
  fs.utimesSync(c.file, old, old);
  assert.deepEqual((await only(c.home, { sinceDay: '2026-10-02' })).days, {}, 'skipped: last written a month before');
  assert.equal((await only(c.home)).days['2026-10-02']['gemini-3.8-flash'].rows, 1, 'control: read with no day limit');
  fs.writeFileSync(c.file + '-wal', '');   // an EMPTY -wal is what any reader leaves behind: not a write
  assert.deepEqual((await only(c.home, { sinceDay: '2026-10-02' })).days, {}, 'an empty -wal is not a write');
  fs.writeFileSync(c.file + '-wal', 'wal frames');   // agy commits into the -wal while running; the db's mtime stays old
  assert.equal((await only(c.home, { sinceDay: '2026-10-02' })).days['2026-10-02']['gemini-3.8-flash'].rows, 1);
});

test('a conversation that cannot be opened blocks freezing while fresh; once it stayed broken it is skipped', async (t) => {
  const home = path.join(SB, 'agy-broken');
  fs.mkdirSync(path.join(home, 'conversations'), { recursive: true });
  const file = path.join(home, 'conversations', 'deadbeef-0000-0000-0000-000000000000.db');
  fs.writeFileSync(file, 'not a sqlite file at all, just text long enough to be read as a header');
  assert.equal((await only(home)).complete, false, 'fresh: it may be mid-write');
  const old = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(file, old, old);
  t.mock.method(console, 'error', () => {});
  assert.equal((await only(home)).complete, true, 'stale: skipped and said once, not holding every day open');
});

test('the conversation is only read: its bytes are unchanged', async () => {
  const c = agyConversation([generation({ prompt: 300, reply: 3 })], { wal: true, steps: [{ type: 15, secs: secs('2026-10-02T10:00:00Z') }] });
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(c.file)).digest('hex');
  const before = hash();
  await only(c.home);
  assert.equal(hash(), before);
});

test('a conversation read again counts each call once: new calls are added, read calls are not repeated', async () => {
  const c = agyConversation([generation({ prompt: 100, reply: 1 })], { steps: [{ type: 15, secs: secs('2026-10-02T10:00:00Z') }] });
  assert.equal((await only(c.home)).days['2026-10-02']['gemini-3.8-flash'].rows, 1);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(c.file);
  const g = generation({ prompt: 200, reply: 2 });
  db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (1, ?, ?)').run(g, g.length);
  const meta = Buffer.from([0x0a, 0x06, 0x08, ...varintOf(secs('2026-10-02T11:00:00Z')), 0xa2, 0x01, 0x02, 0x18, 0x01]);
  db.prepare('INSERT INTO steps (idx, step_type, metadata) VALUES (1, 15, ?)').run(meta);
  db.close();
  const b = (await only(c.home)).days['2026-10-02']['gemini-3.8-flash'];
  assert.equal(b.rows, 2, 'the cached call is not counted twice');
  assert.equal(b.input_tokens, 300);
  _agyCache.clear();
  assert.deepEqual((await only(c.home)).days['2026-10-02']['gemini-3.8-flash'], b, 'a cold read agrees with the cached one');
});

test('an error reading the steps that is not a missing table keeps the scan from being frozen', async () => {
  const c = agyConversation([generation({ prompt: 100, reply: 1 })]);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(c.file);
  db.exec('CREATE VIEW steps AS SELECT idx, 15 AS step_type, nosuchfunction(data) AS metadata FROM gen_metadata');
  db.close();
  const r = await only(c.home);
  assert.equal(r.complete, false, 'a day filed under the fallback over a read error must not be frozen');
});

function varintOf(n) {
  const out = [];
  let v = n;
  do { let b = v % 128; v = Math.floor(v / 128); if (v > 0) b |= 0x80; out.push(b); } while (v > 0);
  return out;
}
