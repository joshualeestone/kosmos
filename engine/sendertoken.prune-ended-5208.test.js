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
  const r = sendertoken.compactEnded({ force: true });
  assert.equal(r.compacted, true, 'nothing was compacted, so the arm below proves nothing');
  assert.equal(fs.readFileSync(LIVE(), 'utf8'), fs.readFileSync(COMPACT(), 'utf8'), 'the live file was not re-started from compact.jsonl');
  assert.deepEqual(answers(names, times), before, 'a compaction changed an answer');
  assert.equal(fs.readFileSync(COMPACT(), 'utf8').split('\n').filter(Boolean).length, 3, 'compact.jsonl is not one line per slug (mom, kid, dad)');
});

test('kosmos#5208: a stale compaction overwriting compact.jsonl cannot drop an end (its sealed file is still read)', () => {
  reset();
  writeLive([line('creator', T0 + 50)]);
  assert.equal(sendertoken.compactEnded({ force: true }).compacted, true);
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
  sendertoken.compactEnded({ force: true });
  assert.equal(sealed().length, 1);
  writeLive([line('x', T0)]);
  sendertoken.compactEnded({ force: true });
  assert.equal(sealed().length, 2, 'a new sealed file was deleted');
  writeLive([line('y', T0)]);
  const r = sendertoken.compactEnded({ force: true, now: Date.now() + sendertoken.SEALED_KEEP_MS + 60000 });
  // The two sealed before this run are deleted; the one this run sealed was not read in it, so it waits for the next.
  assert.equal(r.removed, 2, 'old sealed files were not deleted');
  assert.equal(sealed().length, 1);
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
    stuck = sendertoken.compactEnded({ force: true });
    fs.appendFileSync(LIVE(), line('b', T0) + '\n');   // a second try: the torn line is still in the live file (nothing was sealed)
    assert.equal(sendertoken.compactEnded({ force: true }).stuck, true, 'the second try did not reach the stuck path');
  } finally { console.error = realErr; }
  assert.equal(stuck.compacted, false, 'compacted past a torn line');
  assert.equal(stuck.stuck, true);
  assert.equal(said.filter((m) => /no longer compacted/.test(m)).length, 1, 'a stuck compaction was not said, or said on every try');
  assert.match(said.find((m) => /no longer compacted/.test(m)), /ended-agents\.jsonl\)/, 'the note does not name the file holding the bad line');
  assert.deepEqual(sealed(), [], 'a stuck compaction sealed the live file anyway');
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

test('kosmos#5208: a sealed file changed since it was read is not deleted, however old', () => {
  reset();
  writeLive([line('kept', T0)]);
  sendertoken.compactEnded({ force: true });
  const [name] = sealed();
  const f = path.join(sendertoken.endedDir(), name);
  const realRead = fs.readFileSync;
  // Append to the sealed file right after the compaction reads it: its mtime then differs from the one it measured.
  fs.readFileSync = function (p, ...rest) { const out = realRead.call(this, p, ...rest); if (p === f) { fs.appendFileSync(f, line('straggler', T0 + 1) + '\n'); fs.readFileSync = realRead; } return out; };
  try {
    writeLive([line('y', T0)]);
    sendertoken.compactEnded({ force: true, now: Date.now() + sendertoken.SEALED_KEEP_MS + 60000 });
  } finally { fs.readFileSync = realRead; }
  assert.ok(fs.existsSync(f), 'a sealed file written to after it was read was deleted: its new line is lost');
  assert.equal(sendertoken.endedSince(['straggler'], iso(T0)), true, 'the straggler line is not read');
});

test('kosmos#5208: endedSince refuses (null) when a sealed file or compact.jsonl cannot be read', () => {
  reset();
  fs.mkdirSync(path.join(sendertoken.endedDir(), 'sealed.1.1.ab.jsonl'), { recursive: true });   // a directory: unreadable
  assert.equal(sendertoken.endedSince(['anyone'], iso(T0)), null, 'an unreadable sealed file read as "nothing ended"');
  reset();
  fs.mkdirSync(sendertoken.endedCompactFile(), { recursive: true });
  assert.equal(sendertoken.endedSince(['anyone'], iso(T0)), null, 'an unreadable compact.jsonl read as "nothing ended"');
  reset();
  assert.equal(sendertoken.endedSince(['anyone'], iso(T0)), false, 'CONTROL: an empty history answers false');
});

test('kosmos#5208: a sealed file deleted between the listing and its read is answered from compact.jsonl', () => {
  reset();
  writeLive([line('moved', T0 + 5)]);
  sendertoken.compactEnded({ force: true });   // compact.jsonl now holds it, and so does a sealed file
  const [name] = sealed();
  const f = path.join(sendertoken.endedDir(), name);
  const realRead = fs.readFileSync;
  let deleted = false;
  fs.readFileSync = function (p, ...rest) { if (p === f && !deleted) { deleted = true; fs.unlinkSync(f); } return realRead.call(this, p, ...rest); };
  let answer;
  try { answer = sendertoken.endedSince(['moved'], iso(T0)); } finally { fs.readFileSync = realRead; }
  assert.equal(deleted, true, 'fixture: the sealed file was never read, so the race was not staged');
  assert.equal(answer, true, 'an end in a sealed file deleted mid-read was lost');
});

test('kosmos#5208: the read order (live, sealed, then compact.jsonl) keeps an end that a compaction folds in and deletes mid-read', () => {
  reset();
  // An old sealed file whose end is not yet in compact.jsonl, as after a compaction that stopped before writing it.
  fs.mkdirSync(sendertoken.endedDir(), { recursive: true });
  const s = path.join(sendertoken.endedDir(), 'sealed.1.1.ab.jsonl');
  fs.writeFileSync(s, '\n' + line('folded', T0 + 5) + '\n');
  const old = (Date.now() - sendertoken.SEALED_KEEP_MS - 60000) / 1000;
  fs.utimesSync(s, old, old);
  fs.writeFileSync(sendertoken.endedCompactFile(), '');
  writeLive([line('other', T0)]);
  // The compaction runs just AFTER the reader has read compact.jsonl: it folds the sealed file in and deletes it.
  const realRead = fs.readFileSync;
  let ran = false;
  fs.readFileSync = function (p, ...rest) {
    const out = realRead.call(this, p, ...rest);
    if (p === sendertoken.endedCompactFile() && !ran) { ran = true; fs.readFileSync = realRead; sendertoken.compactEnded({ force: true }); }
    return out;
  };
  let answer;
  try { answer = sendertoken.endedSince(['folded'], iso(T0)); } finally { fs.readFileSync = realRead; }
  assert.equal(ran, true, 'fixture: the compaction never ran mid-read');
  assert.equal(fs.existsSync(s), false, 'fixture: the sealed file was not deleted, so the race was not staged');
  assert.equal(answer, true, 'an end folded in and deleted mid-read was lost: compact.jsonl was read before the sealed file');
});

// How a build from before kosmos#5208 answers: it reads the live file only (main's endedSince before this change).
function oldEndedSince(name, sinceIso, inclusive) {
  let raw; try { raw = fs.readFileSync(LIVE(), 'utf8'); } catch { return false; }
  for (const l of raw.split('\n')) {
    if (!l) continue;
    let r; try { r = JSON.parse(l); } catch { return null; }   // main's endedSince refuses on a line it cannot read
    if (!r || typeof r.name !== 'string') return null;
    if (r.name.toLowerCase() !== name.toLowerCase()) continue;
    if (r.at > sinceIso || (inclusive && r.at === sinceIso)) return true;
  }
  return false;
}

test('kosmos#5208: after a compaction, a build from before this change (it reads the live file only) answers the same', () => {
  reset();
  const lines = [];
  for (let i = 0; i < 120; i++) lines.push(line(['mom', 'kid', 'dad'][i % 3], T0 + i * 1000));
  writeLive(lines);
  const probe = [];
  for (const n of ['mom', 'kid', 'dad', 'never']) for (const t of [T0 - 1, T0 + 50000, T0 + 119000, T0 + 200000]) probe.push([n, iso(t)]);
  const before = probe.map(([n, t]) => [oldEndedSince(n, t, false), oldEndedSince(n, t, true)]);
  assert.ok(before.some((a) => a[0]) && before.some((a) => !a[0]), 'fixture: both answers must occur');
  assert.equal(sendertoken.compactEnded({ force: true }).compacted, true);
  assert.deepEqual(probe.map(([n, t]) => [oldEndedSince(n, t, false), oldEndedSince(n, t, true)]), before, 'a rolled-back build answers differently after a compaction');
});

test('kosmos#5208: a compaction does not write over a compact.jsonl that changed after it read it (one that slept)', () => {
  reset();
  writeLive([line('first', T0)]);
  sendertoken.compactEnded({ force: true });
  writeLive([line('second', T0 + 1)]);
  const realRead = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) {
    const out = realRead.call(this, p, ...rest);
    if (p === COMPACT()) { fs.readFileSync = realRead; fs.writeFileSync(COMPACT(), '\n' + line('newer', T0 + 9) + '\n'); }   // another compaction landed
    return out;
  };
  let r;
  try { r = sendertoken.compactEnded({ force: true }); } finally { fs.readFileSync = realRead; }
  assert.equal(r.compacted, false, 'it wrote over a compact.jsonl that changed under it');
  assert.match(fs.readFileSync(COMPACT(), 'utf8'), /"newer"/, 'the newer compact.jsonl was overwritten');
  assert.equal(sendertoken.endedSince(['second'], iso(T0)), true, 'CONTROL: the end it was folding is still read from its sealed file');
});

// An older build's view, before and after, for names in a fixture: the live file alone (oldEndedSince above).
function oldView(names) { return names.map((n) => [oldEndedSince(n, iso(T0 - 1), false), oldEndedSince(n, iso(T0 + 3), true)]); }

test('kosmos#5208: a rolled-back build answers the same on every way a compaction can stop', () => {
  const names = ['a', 'b', 'late', 'never'];
  const realRename = fs.renameSync;
  const cases = {
    'a torn line': () => { writeLive([line('a', T0), line('b', T0 + 5), '{"name":"torn"']); return () => sendertoken.compactEnded({ force: true }); },
    'compact.jsonl changed under it': () => {
      writeLive([line('a', T0), line('b', T0 + 5)]);
      return () => {
        const realRead = fs.readFileSync;
        fs.readFileSync = function (p, ...rest) { const out = realRead.call(this, p, ...rest); if (p === COMPACT()) { fs.readFileSync = realRead; fs.writeFileSync(COMPACT(), '\n' + line('zz', T0) + '\n'); } return out; };
        try { return sendertoken.compactEnded({ force: true }); } finally { fs.readFileSync = realRead; }
      };
    },
    'compact.jsonl cannot be renamed into place': () => {
      writeLive([line('a', T0), line('b', T0 + 5)]);
      return () => {
        fs.renameSync = function (from, to) { if (to === COMPACT()) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); return realRename.call(this, from, to); };
        try { return sendertoken.compactEnded({ force: true }); } finally { fs.renameSync = realRename; }
      };
    },
    'an unlocked append between the read and the seal': () => {
      writeLive([line('a', T0), line('b', T0 + 5)]);
      return () => {
        fs.renameSync = function (from, to) { if (from === LIVE()) { fs.renameSync = realRename; fs.appendFileSync(LIVE(), line('late', T0 + 7) + '\n'); } return realRename.call(this, from, to); };
        try { return sendertoken.compactEnded({ force: true }); } finally { fs.renameSync = realRename; }
      };
    },
  };
  for (const [label, arm] of Object.entries(cases)) {
    reset();
    const go = arm();
    const before = label === 'an unlocked append between the read and the seal'
      ? names.map((n) => (n === 'late' ? [true, true] : [oldEndedSince(n, iso(T0 - 1), false), oldEndedSince(n, iso(T0 + 3), true)]))   // the late line counts once it lands
      : oldView(names);
    const r = go();
    assert.deepEqual(oldView(names), before, label + ': a rolled-back build answers differently (' + JSON.stringify(r) + ')');
    assert.equal(sendertoken.endedSince(['b'], iso(T0)), label === 'a torn line' ? true : true, label + ': this build lost an end');
  }
});
