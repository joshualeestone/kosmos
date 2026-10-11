'use strict';
/**
 * kosmos#5208: bound the history of ended agents. Only the newest line per name can decide an endedSince answer, so a
 * compaction keeps that and changes no answer; and nothing that is appended to is rewritten or deleted promptly, so no
 * end is lost to a compaction. This test process's store is a throwaway.
 *
 *   node --test engine/sendertoken.prune-ended-5208.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-ended-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');
test.after(() => fs.rmSync(SB, { recursive: true, force: true }));
const sendertoken = require('./sendertoken');

const T0 = Date.parse('2026-09-01T00:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const LIVE = () => sendertoken.endedLogFile();
const COMPACT = () => sendertoken.endedCompactFile();
const sealed = () => { try { return fs.readdirSync(sendertoken.endedDir()).filter((f) => f.startsWith('sealed.')); } catch { return []; } };
function reset() {
  fs.rmSync(LIVE(), { force: true });
  fs.rmSync(sendertoken.endedDir(), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(LIVE()), { recursive: true });
}
const line = (name, ms) => JSON.stringify({ name, at: iso(ms) });
function writeLive(lines) { fs.writeFileSync(LIVE(), '\n' + lines.join('\n') + '\n'); }

// Every answer endedSince can give for these names, at every time in `times`, strict and inclusive.
function answers(names, times) {
  const out = [];
  for (const n of names) for (const t of times) out.push([n, t, sendertoken.endedSince([n], iso(t)), sendertoken.endedSince([n], iso(t), { inclusive: true })]);
  return out;
}

test('kosmos#5208 newestPerName: the newest line per name (by slug), and null on any line it cannot read', () => {
  const out = sendertoken.newestPerName(['\n' + [line('Mara', T0 + 5), line('mara', T0 + 9), line('mara', T0 + 1), line('bo', T0)].join('\n') + '\n']);
  const kept = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(kept.map((r) => [r.name, r.at]), [['mara', iso(T0 + 9)], ['bo', iso(T0)]], 'not the newest per slug');
  for (const bad of ['{"name":"t","at":"2026-01-01"}', '{"name":"t"', '{"at":"' + iso(T0) + '"}']) {
    assert.equal(sendertoken.newestPerName([line('a', T0), bad]), null, 'compacted past an unreadable line: ' + bad);
  }
});

test('kosmos#5208: a compaction changes no answer of endedSince (strict and inclusive, at every boundary)', () => {
  reset();
  const names = ['mom', 'kid', 'Kid', 'dad', 'never'];
  const times = [];
  const lines = [];
  for (let i = 0; i < 300; i++) {
    const n = ['mom', 'kid', 'Kid', 'dad'][i % 4];
    const at = T0 + i * 1000;
    lines.push(line(n, at));
    times.push(at - 1, at, at + 1);
  }
  writeLive(lines);
  const before = answers(names, times);
  assert.ok(before.some((a) => a[2] === true) && before.some((a) => a[2] === false), 'fixture: both answers must occur');
  const r = sendertoken.compactEnded({ atBytes: 0 });
  assert.equal(r.compacted, true, 'nothing was compacted, so the arm below proves nothing');
  assert.equal(fs.existsSync(LIVE()), false, 'the live file was not sealed');
  assert.deepEqual(answers(names, times), before, 'a compaction changed an answer');
  assert.equal(fs.readFileSync(COMPACT(), 'utf8').split('\n').filter(Boolean).length, 3, 'compact.jsonl is not one line per slug (mom, kid, dad)');
});

test('kosmos#5208: a stale compaction overwriting compact.jsonl cannot drop an end (its sealed file is still read)', () => {
  reset();
  writeLive([line('creator', T0 + 50)]);
  assert.equal(sendertoken.compactEnded({ atBytes: 0 }).compacted, true);
  assert.equal(sealed().length, 1, 'the sealed file was deleted while it was new');
  fs.writeFileSync(COMPACT(), '');   // a compaction that woke late, after its lock was stolen, writes older content
  assert.equal(sendertoken.endedSince(['creator'], iso(T0)), true, 'the end was lost: only compact.jsonl was read');
  // A line appended to a live file that was then sealed is read from the sealed file.
  writeLive([line('late', T0 + 70)]);
  fs.renameSync(LIVE(), path.join(sendertoken.endedDir(), 'sealed.1.1.ab.jsonl'));
  assert.equal(sendertoken.endedSince(['late'], iso(T0)), true, 'a sealed file was not read');
});

test('kosmos#5208: a sealed file is deleted only once old and unchanged, and its ends stay answered from compact.jsonl', () => {
  reset();
  writeLive([line('gone', T0 + 10)]);
  sendertoken.compactEnded({ atBytes: 0 });
  assert.equal(sealed().length, 1);
  writeLive([line('x', T0)]);
  sendertoken.compactEnded({ atBytes: 0 });
  assert.equal(sealed().length, 2, 'a new sealed file was deleted');
  writeLive([line('y', T0)]);
  const r = sendertoken.compactEnded({ atBytes: 0, now: Date.now() + sendertoken.SEALED_KEEP_MS + 60000 });
  assert.equal(r.removed, 3, 'old sealed files were not deleted');
  assert.deepEqual(sealed(), []);
  assert.equal(sendertoken.endedSince(['gone'], iso(T0)), true, 'an end was lost with its sealed file');
  assert.equal(sendertoken.endedSince(['gone'], iso(T0 + 10)), false, 'CONTROL: strictly after its end it is not ended');
});

test('kosmos#5208: nothing is compacted under the size bound, and a torn line stops it with every line still read', () => {
  reset();
  writeLive([line('a', T0)]);
  assert.equal(sendertoken.compactEnded({}).compacted, false, 'compacted a small file');
  assert.equal(fs.existsSync(LIVE()), true);
  writeLive([line('a', T0), '{"name":"torn"']);
  const said = [];
  const realErr = console.error;
  console.error = (m) => said.push(String(m));
  let stuck;
  try {
    stuck = sendertoken.compactEnded({ atBytes: 0 });
    writeLive([line('b', T0)]);   // a second try that reaches the torn line again
    assert.equal(sendertoken.compactEnded({ atBytes: 0 }).stuck, true, 'the second try did not reach the stuck path');
  } finally { console.error = realErr; }
  assert.equal(stuck.compacted, false, 'compacted past a torn line');
  assert.equal(stuck.stuck, true);
  assert.equal(said.filter((m) => /no longer compacted/.test(m)).length, 1, 'a stuck compaction was not said, or said on every try');
  assert.equal(fs.existsSync(COMPACT()), false, 'compact.jsonl was written past a torn line');
  // A name with no line of its own reads every line, so it meets the torn one: still a refusal (null), as on main.
  assert.equal(sendertoken.endedSince(['nobody'], iso(T0 - 1)), null, 'the torn line no longer refuses (it was dropped)');
  assert.equal(sendertoken.endedSince(['a'], iso(T0 - 1)), true, 'CONTROL: a match ahead of the torn line still answers');
});

test('kosmos#5208: noteEnded compacts once the live file passes the bound', () => {
  reset();
  const filler = [];
  for (let i = 0; filler.join('\n').length <= sendertoken.ENDED_COMPACT_AT_BYTES; i++) filler.push(line('f' + (i % 7), T0 + i));
  writeLive(filler);
  sendertoken.revoke('the-trigger');
  assert.ok(fs.existsSync(COMPACT()), 'noteEnded did not compact');
  assert.ok(sendertoken.endedSince(['the-trigger'], iso(T0)), 'the end that triggered it was lost');
  assert.ok(fs.readFileSync(COMPACT(), 'utf8').length < 2000, 'compact.jsonl is not one line per name');
});

test('kosmos#5208: an end is appended even when the lock cannot be had', () => {
  reset();
  const lock = LIVE() + '.lock';
  fs.mkdirSync(lock);   // a live holder
  const prev = process.env.AGENT_WORKFORCE_LOCK_MS;
  process.env.AGENT_WORKFORCE_LOCK_MS = '30';
  try {
    sendertoken.revoke('locked-out-agent');
    assert.match(fs.readFileSync(LIVE(), 'utf8'), /"name":"locked-out-agent"/, 'an end was lost while the lock was held');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_LOCK_MS; else process.env.AGENT_WORKFORCE_LOCK_MS = prev;
    fs.rmSync(lock, { recursive: true, force: true });
  }
  sendertoken.revoke('free-agent');   // CONTROL: with the lock free it goes in too, and the lock is released
  assert.match(fs.readFileSync(LIVE(), 'utf8'), /"name":"free-agent"/);
  assert.equal(fs.existsSync(lock), false, 'the lock was left held');
});
