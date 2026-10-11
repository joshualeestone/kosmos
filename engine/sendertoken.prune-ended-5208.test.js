'use strict';
/**
 * kosmos#5208: bound the history of ended agents. Only the newest line per name can decide an endedSince answer, so a
 * compaction keeps that and changes no answer, for this build and for an older one that reads only the live file; and
 * no end is lost to a compaction (concurrent appends, a stolen lock, a failed flush or rename). Throwaway store.
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
const securewrite = require('./securewrite');

const T0 = Date.parse('2026-09-01T00:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const LIVE = () => sendertoken.endedLogFile();
const DIR = () => sendertoken.endedDir();
const sealed = () => { try { return fs.readdirSync(DIR()).filter((f) => f.startsWith('sealed.')); } catch { return []; } };
const temps = () => fs.readdirSync(path.dirname(LIVE())).filter((f) => f.endsWith('.tmp'));
function reset() {
  fs.rmSync(LIVE(), { force: true });
  fs.rmSync(DIR(), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(LIVE()), { recursive: true });
  for (const t of temps()) fs.rmSync(path.join(path.dirname(LIVE()), t), { force: true });
}
const line = (name, ms) => JSON.stringify({ name, at: iso(ms) });
function writeLive(lines) { fs.writeFileSync(LIVE(), '\n' + lines.join('\n') + '\n'); }
const ino = () => fs.statSync(LIVE()).ino;

// How a build from before kosmos#5208 answers: the live file only, refusing (null) on a line it cannot read.
function oldEndedSince(name, sinceIso, inclusive) {
  let raw; try { raw = fs.readFileSync(LIVE(), 'utf8'); } catch { return false; }
  for (const l of raw.split('\n')) {
    if (!l) continue;
    let r; try { r = JSON.parse(l); } catch { return null; }
    if (!r || typeof r.name !== 'string') return null;
    if (r.name.toLowerCase() !== name.toLowerCase()) continue;
    if (r.at > sinceIso || (inclusive && r.at === sinceIso)) return true;
  }
  return false;
}
// Both builds' answers for every name at every time, strict and inclusive.
function views(names, times) {
  const out = [];
  for (const n of names) for (const t of times) {
    out.push([n, t, sendertoken.endedSince([n], iso(t)), sendertoken.endedSince([n], iso(t), { inclusive: true }), oldEndedSince(n, iso(t), false), oldEndedSince(n, iso(t), true)]);
  }
  return out;
}

test('kosmos#5208 newestPerName: the newest line per exact name, and null on any line it cannot read', () => {
  const out = sendertoken.newestPerName(['\n' + [line('Mara', T0 + 5), line('mara', T0 + 9), line('mara', T0 + 1), line('bo', T0)].join('\n') + '\n']);
  const kept = out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(kept.map((r) => [r.name, r.at]), [['Mara', iso(T0 + 5)], ['mara', iso(T0 + 9)], ['bo', iso(T0)]], 'not the newest per exact name');
  for (const bad of ['{"name":"t","at":"2026-01-01"}', '{"name":"t"', '{"at":"' + iso(T0) + '"}']) {
    assert.equal(sendertoken.newestPerName([line('a', T0), bad]), null, 'compacted past an unreadable line: ' + bad);
  }
});

test('kosmos#5208: a compaction changes no answer, for this build or a rolled-back one, and replaces the live file whole', () => {
  reset();
  const names = ['mom', 'kid', 'Kid', 'dad', 'never'];
  const times = [];
  const lines = [];
  for (let i = 0; i < 300; i++) { const at = T0 + i * 1000; lines.push(line(['mom', 'kid', 'Kid', 'dad'][i % 4], at)); times.push(at - 1, at, at + 1); }
  writeLive(lines);
  const before = views(names, times);
  assert.ok(before.some((a) => a[2] === true) && before.some((a) => a[2] === false), 'fixture: both answers must occur');
  const oldIno = ino();
  const r = sendertoken.compactEnded({ force: true });
  assert.equal(r.compacted, true, 'nothing was compacted, so the arm below proves nothing');
  assert.notEqual(ino(), oldIno, 'the live file was rewritten in place, not replaced by a rename');
  assert.equal(fs.readFileSync(LIVE(), 'utf8').split('\n').filter(Boolean).length, 4, 'the live file is not one line per exact name');
  assert.deepEqual(views(names, times), before, 'a compaction changed an answer');
  assert.equal(sealed().length, 1, 'the replaced file was not kept as a sealed link');
  assert.deepEqual(temps(), [], 'a temp file was left behind');
});

test('kosmos#5208: every way to stop leaves the live file as it was, and both builds answer the same', () => {
  const names = ['a', 'b', 'never'];
  const times = [T0 - 1, T0 + 3, T0 + 10];
  const realRename = fs.renameSync;
  const realFlush = securewrite.flushOrThrow;
  const cases = {
    'a torn line': () => { writeLive([line('a', T0), line('b', T0 + 5), '{"name":"torn"']); return () => sendertoken.compactEnded({ force: true }); },
    'the flush fails': () => {
      writeLive([line('a', T0), line('b', T0 + 5)]);
      return () => { securewrite.flushOrThrow = () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); }; try { return sendertoken.compactEnded({ force: true }); } finally { securewrite.flushOrThrow = realFlush; } };
    },
    'the rename fails': () => {
      writeLive([line('a', T0), line('b', T0 + 5)]);
      return () => { fs.renameSync = function (from, to) { if (to === LIVE()) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); return realRename.call(this, from, to); }; try { return sendertoken.compactEnded({ force: true }); } finally { fs.renameSync = realRename; } };
    },
    'the live file was replaced meanwhile (a compaction that slept)': () => {
      writeLive([line('a', T0), line('b', T0 + 5)]);
      return () => {
        const realRead = fs.readFileSync;
        fs.readFileSync = function (p, ...rest) { const out = realRead.call(this, p, ...rest); if (p === LIVE()) { fs.readFileSync = realRead; const t = LIVE() + '.x'; fs.writeFileSync(t, realRead(LIVE(), 'utf8')); realRename(t, LIVE()); } return out; };
        try { return sendertoken.compactEnded({ force: true }); } finally { fs.readFileSync = realRead; }
      };
    },
  };
  for (const [label, arm] of Object.entries(cases)) {
    reset();
    const go = arm();
    const before = views(names, times);
    const said = [];
    const realErr = console.error;
    console.error = (m) => said.push(String(m));
    let r; let inoBefore;
    try { inoBefore = label.startsWith('the live file was replaced') ? null : ino(); r = go(); } finally { console.error = realErr; }
    assert.equal(r.compacted, false, label + ': it compacted');
    if (inoBefore !== null) assert.equal(ino(), inoBefore, label + ': the live file was replaced');
    assert.deepEqual(sealed(), [], label + ': a sealed name was left for a file it did not replace');
    assert.deepEqual(temps(), [], label + ': a temp file was left behind');
    assert.deepEqual(views(names, times), before, label + ': an answer changed');
  }
});

test('kosmos#5208: a line appended between the read and the rename is kept, in the live file too', () => {
  reset();
  writeLive([line('a', T0)]);
  const realLink = fs.linkSync;
  fs.linkSync = function (from, to) { fs.linkSync = realLink; fs.appendFileSync(LIVE(), line('late', T0 + 7) + '\n'); return realLink.call(this, from, to); };
  let r;
  try { r = sendertoken.compactEnded({ force: true }); } finally { fs.linkSync = realLink; }
  assert.equal(r.compacted, true);
  assert.equal(sendertoken.endedSince(['late'], iso(T0)), true, 'this build lost the late line');
  assert.equal(oldEndedSince('late', iso(T0), false), true, 'a rolled-back build lost the late line');
});

test('kosmos#5208: a sealed file is deleted only when old and unchanged since read, and its ends stay answered', () => {
  reset();
  writeLive([line('gone', T0 + 10)]);
  sendertoken.compactEnded({ force: true });
  const [first] = sealed();
  const later = Date.now() + sendertoken.SEALED_KEEP_MS + 60000;
  const f = path.join(DIR(), first);
  // Young: not deleted (a straggler in a just-replaced file is read from it).
  sendertoken.compactEnded({ force: true });
  assert.ok(fs.existsSync(f), 'a sealed file under an hour old was deleted');
  // Changed since read: not deleted.
  const realRead = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) { const out = realRead.call(this, p, ...rest); if (p === f) { fs.readFileSync = realRead; fs.appendFileSync(f, line('straggler', T0 + 1) + '\n'); } return out; };
  try { sendertoken.compactEnded({ force: true, now: later }); } finally { fs.readFileSync = realRead; }
  assert.ok(fs.existsSync(f), 'a sealed file written to after it was read was deleted');
  assert.equal(sendertoken.endedSince(['straggler'], iso(T0)), true);
  // Unchanged and old: deleted, and its ends still answered from the live file.
  const r = sendertoken.compactEnded({ force: true, now: later });
  assert.ok(r.removed >= 1, 'an old unchanged sealed file was not deleted');
  assert.equal(fs.existsSync(f), false);
  assert.equal(sendertoken.endedSince(['gone'], iso(T0)), true, 'an end was lost with its sealed file');
  assert.equal(sendertoken.endedSince(['gone'], iso(T0 + 10)), false, 'CONTROL: strictly after its end it is not ended');
  assert.equal(oldEndedSince('gone', iso(T0), false), true, 'a rolled-back build lost it');
  assert.equal(oldEndedSince('straggler', iso(T0), false), true, 'a rolled-back build lost the straggler');
});

test('kosmos#5208: the read order (live, sealed, live again) keeps an end a compaction folds in and deletes mid-read', () => {
  reset();
  fs.mkdirSync(DIR(), { recursive: true });
  const s = path.join(DIR(), 'sealed.1.1.ab.jsonl');   // an old straggler: its end is not in the live file yet
  fs.writeFileSync(s, '\n' + line('folded', T0 + 5) + '\n');
  const old = (Date.now() - sendertoken.SEALED_KEEP_MS - 60000) / 1000;
  fs.utimesSync(s, old, old);
  writeLive([line('other', T0)]);
  const realRead = fs.readFileSync;
  let ran = false;
  fs.readFileSync = function (p, ...rest) {
    const out = realRead.call(this, p, ...rest);
    if (p === LIVE() && !ran) { ran = true; fs.readFileSync = realRead; sendertoken.compactEnded({ force: true }); }
    return out;
  };
  let answer;
  try { answer = sendertoken.endedSince(['folded'], iso(T0)); } finally { fs.readFileSync = realRead; }
  assert.equal(ran, true, 'fixture: no compaction ran mid-read');
  assert.equal(fs.existsSync(s), false, 'fixture: the sealed file was not deleted, so the race was not staged');
  assert.equal(answer, true, 'an end folded in and deleted mid-read was lost');
});

test('kosmos#5208: endedSince refuses (null) when a sealed file cannot be read, and a missing one reads on', () => {
  reset();
  fs.mkdirSync(path.join(DIR(), 'sealed.1.1.ab.jsonl'), { recursive: true });   // a directory: unreadable
  assert.equal(sendertoken.endedSince(['anyone'], iso(T0)), null, 'an unreadable sealed file read as "nothing ended"');
  reset();
  assert.equal(sendertoken.endedSince(['anyone'], iso(T0)), false, 'CONTROL: an empty history answers false');
});

test('kosmos#5208: the size bound, measured from the last compaction; a torn line stops it once, named', () => {
  reset();
  writeLive([line('a', T0)]);
  assert.equal(sendertoken.compactEnded({}).compacted, false, 'compacted a small file');
  const big = [];
  for (let i = 0; big.join('\n').length <= sendertoken.ENDED_COMPACT_AT_BYTES; i++) big.push(line('n' + i, T0 + i));
  writeLive(big);
  assert.equal(sendertoken.compactEnded({}).compacted, true, 'did not compact past the bound');
  assert.equal(sendertoken.compactEnded({}).compacted, false, 'compacted again with nothing new: the bound is not measured from the last compaction');
  reset();
  writeLive([line('a', T0), '{"name":"torn"']);
  sendertoken.resetCompactNotesForTests();   // an earlier test may have said it already in this process
  const said = [];
  const realErr = console.error;
  console.error = (m) => said.push(String(m));
  try {
    assert.equal(sendertoken.compactEnded({ force: true }).stuck, true);
    fs.appendFileSync(LIVE(), line('b', T0) + '\n');
    assert.equal(sendertoken.compactEnded({ force: true }).stuck, true);
  } finally { console.error = realErr; }
  const notes = said.filter((m) => /no longer compacted/.test(m));
  assert.equal(notes.length, 1, 'a stuck compaction was not said, or said on every try');
  assert.match(notes[0], /ended-agents\.jsonl\)/, 'the note does not name the file holding the bad line');
  assert.equal(sendertoken.endedSince(['nobody'], iso(T0 - 1)), null, 'the torn line no longer refuses');
});

test('kosmos#5208: noteEnded compacts once the live file passes the bound', () => {
  reset();
  const filler = [];
  for (let i = 0; filler.join('\n').length <= sendertoken.ENDED_COMPACT_AT_BYTES; i++) filler.push(line('f' + (i % 7), T0 + i));
  writeLive(filler);
  sendertoken.revoke('the-trigger');
  assert.ok(fs.readFileSync(LIVE(), 'utf8').length < 2000, 'noteEnded did not compact');
  assert.equal(sendertoken.endedSince(['the-trigger'], iso(T0)), true, 'the end that triggered it was lost');
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
