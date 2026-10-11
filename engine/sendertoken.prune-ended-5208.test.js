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
const temps = () => [path.dirname(LIVE()), DIR()].flatMap((d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith('.tmp')); } catch { return []; } });
function reset() {
  fs.rmSync(LIVE(), { force: true });
  fs.rmSync(DIR(), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(LIVE()), { recursive: true });
  for (const t of temps()) fs.rmSync(path.join(path.dirname(LIVE()), t), { force: true });   // strays in the store root; the folder went above
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
  // The file that becomes the live one is made only inside the folder token-only agents are denied.
  const realOpen = fs.openSync;
  const opened = [];
  fs.openSync = function (f, ...rest) { if (String(f).endsWith('.tmp')) opened.push(String(f)); return realOpen.call(this, f, ...rest); };
  let r;
  try { r = sendertoken.compactEnded({ force: true }); } finally { fs.openSync = realOpen; }
  assert.ok(opened.length >= 1, 'fixture: no temp file was seen being made');
  for (const f of opened) assert.equal(path.dirname(f), DIR(), 'the temp that becomes the live file was made outside ended-agents.d: ' + f);
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
    'a short write (the disk filled partway)': () => {
      writeLive([line('a', T0), line('b', T0 + 5)]);
      return () => {
        const realWFS = fs.writeFileSync;
        fs.writeFileSync = function (f, data, ...rest) { if (typeof f === 'number') { fs.writeFileSync = realWFS; return fs.writeSync(f, String(data).slice(0, 9)); } return realWFS.call(this, f, data, ...rest); };
        try { return sendertoken.compactEnded({ force: true }); } finally { fs.writeFileSync = realWFS; }
      };
    },
    'no hard link here (EXDEV)': () => {
      writeLive([line('a', T0), line('b', T0 + 5)]);
      return () => { const realLink = fs.linkSync; fs.linkSync = () => { throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }); }; try { return sendertoken.compactEnded({ force: true }); } finally { fs.linkSync = realLink; } };
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
  sendertoken.resetCompactNotesForTests();
  const allSaid = [];
  for (const [label, arm] of Object.entries(cases)) {
    reset();
    const go = arm();
    const before = views(names, times);
    const said = [];
    const realErr = console.error;
    console.error = (m) => said.push(String(m));
    let r; let inoBefore;
    try { inoBefore = label.startsWith('the live file was replaced') ? null : ino(); r = go(); } finally { console.error = realErr; }
    allSaid.push(...said);
    assert.equal(r.compacted, false, label + ': it compacted');
    if (inoBefore !== null) assert.equal(ino(), inoBefore, label + ': the live file was replaced');
    assert.deepEqual(sealed(), [], label + ': a sealed name was left for a file it did not replace');
    assert.deepEqual(temps(), [], label + ': a temp file was left behind');
    assert.deepEqual(views(names, times), before, label + ': an answer changed');
  }
  // The ways that would stop every compaction from then on are said, once each, so a history that keeps growing can be traced.
  for (const re of [/no longer compacted/, /could not be replaced/, /no hard link: EXDEV/, /could not be written to disk/]) {   // a failed flush and a short write share one note
    assert.equal(allSaid.filter((m) => re.test(m)).length, 1, 'not said exactly once: ' + re);
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

test('kosmos#5208: if the replaced file no longer starts with what was read, all of it is put back (both builds keep it)', () => {
  reset();
  writeLive([line('a', T0)]);
  const realLink = fs.linkSync;
  // Rewritten in place (same file) between the read and the link: the sealed text does not start with what was read.
  fs.linkSync = function (from, to) { fs.linkSync = realLink; fs.writeFileSync(LIVE(), '\n' + line('rewritten', T0 + 9) + '\n'); return realLink.call(this, from, to); };
  let r;
  try { r = sendertoken.compactEnded({ force: true }); } finally { fs.linkSync = realLink; }
  assert.equal(r.compacted, true);
  assert.equal(oldEndedSince('rewritten', iso(T0), false), true, 'a rolled-back build lost a line of the replaced file');
  assert.equal(sendertoken.endedSince(['rewritten'], iso(T0)), true);
  assert.equal(sendertoken.endedSince(['nobody'], iso(T0)), false, 'a torn fragment was put back (it would refuse forever)');
});

test('kosmos#5208: a reader in flight sees a line that reached the replaced file, even before it is put back', () => {
  reset();
  writeLive([line('a', T0)]);
  fs.mkdirSync(DIR(), { recursive: true });
  const realReaddir = fs.readdirSync;
  const realLink = fs.linkSync;
  const realAppend = fs.appendFileSync;
  let ran = false;
  // The compaction runs just after the reader's first look at the sealed files. Inside it, an unlocked append lands in
  // the file being replaced, and the put-back into the new live file fails: the line is then only in the sealed file.
  fs.readdirSync = function (d, ...rest) {
    const out = realReaddir.call(this, d, ...rest);
    if (d === DIR() && !ran) {
      ran = true;
      fs.readdirSync = realReaddir;
      fs.linkSync = function (from, to) { fs.linkSync = realLink; realAppend(LIVE(), line('late', T0 + 7) + '\n'); return realLink.call(this, from, to); };
      fs.appendFileSync = function (f, ...r) { if (f === LIVE()) { fs.appendFileSync = realAppend; throw Object.assign(new Error('EIO'), { code: 'EIO' }); } return realAppend.call(this, f, ...r); };
      try { sendertoken.compactEnded({ force: true }); } finally { fs.linkSync = realLink; fs.appendFileSync = realAppend; }
    }
    return out;
  };
  let answer;
  try { answer = sendertoken.endedSince(['late'], iso(T0)); } finally { fs.readdirSync = realReaddir; fs.linkSync = realLink; fs.appendFileSync = realAppend; }
  assert.equal(ran, true, 'fixture: no compaction ran mid-read');
  assert.equal(fs.readFileSync(LIVE(), 'utf8').includes('"late"'), false, 'fixture: the late line was put back, so the race was not staged');
  assert.equal(answer, true, 'a reader in flight missed a line that is only in a sealed file made during its read');
});

test('kosmos#5208: a failed try waits for more growth before it tries again', () => {
  reset();
  const big = [];
  for (let i = 0; big.join('\n').length <= sendertoken.ENDED_COMPACT_AT_BYTES; i++) big.push(line('n' + i, T0 + i));
  writeLive(big);
  const realRename = fs.renameSync;
  fs.renameSync = function (from, to) { if (to === LIVE()) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); return realRename.call(this, from, to); };
  const realErr = console.error;
  console.error = () => {};
  try { assert.equal(sendertoken.compactEnded({}).compacted, false); } finally { fs.renameSync = realRename; console.error = realErr; }
  const realOpen = fs.openSync;
  let tried = 0;
  fs.openSync = function (f, ...rest) { if (String(f).endsWith('.tmp')) tried++; return realOpen.call(this, f, ...rest); };
  try { sendertoken.compactEnded({}); } finally { fs.openSync = realOpen; }
  assert.equal(tried, 0, 'it folded and wrote the whole history again with no new growth');
  fs.appendFileSync(LIVE(), big.join('\n') + '\n');   // CONTROL: past another bound, it tries (and now succeeds)
  assert.equal(sendertoken.compactEnded({}).compacted, true);
});

test('kosmos#5208: a torn tail (an append still being written) is not put back, and the line counts once whole', () => {
  reset();
  writeLive([line('a', T0)]);
  const realLink = fs.linkSync;
  const half = line('slow', T0 + 8);
  fs.linkSync = function (from, to) { fs.linkSync = realLink; fs.appendFileSync(LIVE(), half.slice(0, 10)); return realLink.call(this, from, to); };
  let sealedPath;
  try { sendertoken.compactEnded({ force: true }); } finally { fs.linkSync = realLink; }
  assert.equal(oldEndedSince('nobody', iso(T0), false), false, 'a torn tail was put into the live file: every removal would refuse for good');
  [sealedPath] = sealed().map((n) => path.join(DIR(), n));
  fs.appendFileSync(sealedPath, half.slice(10) + '\n');   // the writer finishes, into the file it opened
  assert.equal(sendertoken.endedSince(['slow'], iso(T0)), true, 'the line, once whole, is not read');
});

test('kosmos#5208: a failed flush backs off too, and is said once', () => {
  reset();
  const big = [];
  for (let i = 0; big.join('\n').length <= sendertoken.ENDED_COMPACT_AT_BYTES; i++) big.push(line('n' + i, T0 + i));
  writeLive(big);
  sendertoken.resetCompactNotesForTests();
  const realFlush = securewrite.flushOrThrow;
  const said = [];
  const realErr = console.error;
  console.error = (m) => said.push(String(m));
  securewrite.flushOrThrow = () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); };
  try {
    assert.equal(sendertoken.compactEnded({}).compacted, false);
    const realOpen = fs.openSync;
    let tried = 0;
    fs.openSync = function (f, ...rest) { if (String(f).endsWith('.tmp')) tried++; return realOpen.call(this, f, ...rest); };
    try { sendertoken.compactEnded({}); } finally { fs.openSync = realOpen; }
    assert.equal(tried, 0, 'a failed flush did not back off');
  } finally { securewrite.flushOrThrow = realFlush; console.error = realErr; }
  assert.equal(said.filter((m) => /could not be written to disk \(ENOSPC\)/.test(m)).length, 1, 'a failed flush was not said once');
});

test('kosmos#5208: a torn read that heals at once does not spend the stuck note', () => {
  reset();
  writeLive([line('a', T0)]);
  sendertoken.resetCompactNotesForTests();
  const realRead = fs.readFileSync;
  let first = true;
  fs.readFileSync = function (p, ...rest) { const out = realRead.call(this, p, ...rest); if (p === LIVE() && first) { first = false; return out + '{"name":"mid-wri'; } return out; };
  const said = [];
  const realErr = console.error;
  console.error = (m) => said.push(String(m));
  let r;
  try { r = sendertoken.compactEnded({ force: true }); } finally { fs.readFileSync = realRead; console.error = realErr; }
  assert.equal(r.stuck, true, 'fixture: the torn read did not reach the stuck path');
  assert.deepEqual(said.filter((m) => /no longer compacted/.test(m)), [], 'a transient torn read was said as stuck');
});

test('kosmos#5208: a compaction that stole the lock and put a newer file in place between the check and the link loses nothing', () => {
  reset();
  writeLive([line('a', T0)]);
  const realLink = fs.linkSync;
  fs.linkSync = function (from, to) {
    fs.linkSync = realLink;
    const t = LIVE() + '.other';
    fs.writeFileSync(t, '\n' + line('a', T0) + '\n' + line('newer', T0 + 20) + '\n');   // its fold carries what it read
    fs.renameSync(t, LIVE());   // another compaction's file, a different inode
    return realLink.call(this, from, to);
  };
  let r;
  try { r = sendertoken.compactEnded({ force: true }); } finally { fs.linkSync = realLink; }
  assert.equal(r.compacted, false, 'it went on over a file it did not read');
  assert.deepEqual(sealed(), [], 'its link to a file it did not read was left');
  assert.equal(sendertoken.endedSince(['newer'], iso(T0)), true, 'this build lost the newer file\'s line');
  assert.equal(oldEndedSince('newer', iso(T0), false), true, 'a rolled-back build lost the newer file\'s line');
  assert.equal(sendertoken.endedSince(['a'], iso(T0 - 1)), true, 'the line this compaction folded was lost');
});

test('kosmos#5208: a sealed file that grew with its mtime unchanged is not deleted (size is compared too)', () => {
  reset();
  writeLive([line('gone', T0 + 10)]);
  sendertoken.compactEnded({ force: true });
  const [first] = sealed();
  const f = path.join(DIR(), first);
  const old = (Date.now() - sendertoken.SEALED_KEEP_MS - 60000) / 1000;
  fs.utimesSync(f, old, old);
  const realRead = fs.readFileSync;
  // An append right after the read whose mtime does not move (coarse clock): put the old mtime back.
  fs.readFileSync = function (p, ...rest) { const out = realRead.call(this, p, ...rest); if (p === f) { fs.readFileSync = realRead; fs.appendFileSync(f, line('same-ms', T0 + 2) + '\n'); fs.utimesSync(f, old, old); } return out; };
  try { sendertoken.compactEnded({ force: true }); } finally { fs.readFileSync = realRead; }
  assert.ok(fs.existsSync(f), 'a sealed file that grew after it was read was deleted (its mtime did not move)');
  assert.equal(sendertoken.endedSince(['same-ms'], iso(T0)), true);
});

test('kosmos#5208: a sealed name that is not a regular file (a pipe, a link to a device) refuses at once, never hangs', { skip: process.platform === 'win32' ? 'no mkfifo or /dev/zero on Windows' : false }, () => {
  for (const make of [
    (f) => require('node:child_process').execFileSync('mkfifo', [f]),
    (f) => fs.symlinkSync('/dev/zero', f),
  ]) {
    reset();
    fs.mkdirSync(DIR(), { recursive: true });
    make(path.join(DIR(), 'sealed.1.1.ab.jsonl'));
    assert.equal(sendertoken.endedSince(['anyone'], iso(T0)), null, 'a non-regular sealed file was read (or answered)');
    writeLive([line('a', T0)]);
    assert.equal(sendertoken.compactEnded({ force: true }).compacted, false, 'a compaction read a non-regular sealed file');
  }
});

test('kosmos#5208: revokeIfUnchanged records the end without compacting under its session lock', () => {
  reset();
  const big = [];
  for (let i = 0; big.join('\n').length <= sendertoken.ENDED_COMPACT_AT_BYTES; i++) big.push(line('n' + (i % 7), T0 + i));   // few names, so a compaction shrinks it
  writeLive(big);
  const key = 'cleanup-me';
  fs.mkdirSync(sendertoken.DIR, { recursive: true });
  const file = path.join(sendertoken.DIR, key + '.json');
  const OLD = Date.parse('2026-08-28T00:00:00Z');
  fs.writeFileSync(file, JSON.stringify({ tokens: [{ token: 'x', instance: 'i', mintedAt: new Date(OLD).toISOString() }] }));
  fs.utimesSync(file, OLD / 1000, OLD / 1000);
  const r = sendertoken.revokeIfUnchanged(key, fs.lstatSync(file).mtimeMs, OLD);
  assert.deepEqual(r, { ok: true }, 'fixture: the cleanup did not revoke');
  assert.match(fs.readFileSync(LIVE(), 'utf8'), /"name":"cleanup-me"/, 'the end was not recorded');
  assert.ok(fs.statSync(LIVE()).size > sendertoken.ENDED_COMPACT_AT_BYTES, 'it compacted under the session lock');
  sendertoken.revoke('next-end');   // CONTROL: the next ordinary end compacts
  assert.ok(fs.statSync(LIVE()).size < sendertoken.ENDED_COMPACT_AT_BYTES, 'CONTROL: the next end did not compact');
});

test('kosmos#5208: a compaction that stole the lock and replaced the live file between the link and the rename is not overwritten', () => {
  reset();
  writeLive([line('a', T0)]);
  const realLink = fs.linkSync;
  // Another compaction's fold (what it read, plus a line that reached its file) lands right after this one's link.
  fs.linkSync = function (from, to) {
    fs.linkSync = realLink;
    const out = realLink.call(this, from, to);
    const t = LIVE() + '.other';
    fs.writeFileSync(t, '\n' + line('a', T0) + '\n' + line('newer', T0 + 20) + '\n');
    fs.renameSync(t, LIVE());
    return out;
  };
  let r;
  try { r = sendertoken.compactEnded({ force: true }); } finally { fs.linkSync = realLink; }
  assert.equal(r.compacted, false, 'it renamed over a live file another compaction had just put in place');
  assert.deepEqual(sealed(), [], 'its link to a file it did not read was left');
  assert.deepEqual(temps(), [], 'a temp file was left behind');
  for (const n of ['a', 'newer']) {
    assert.equal(sendertoken.endedSince([n], iso(T0 - 1)), true, 'this build lost ' + n);
    assert.equal(oldEndedSince(n, iso(T0 - 1), false), true, 'a rolled-back build lost ' + n);
  }
});

test('kosmos#5208: a compaction whose write and flush ran past the total budget stops before linking or replacing', () => {
  reset();
  writeLive([line('a', T0)]);
  sendertoken.resetCompactNotesForTests();
  const realFlush = securewrite.flushOrThrow;
  const realNow = Date.now;
  const inoBefore = ino();
  securewrite.flushOrThrow = function (fd) { const skew = realNow() + 7000; Date.now = () => skew; return realFlush.call(this, fd); };
  const said = [];
  const realErr = console.error;
  console.error = (m) => said.push(String(m));
  let r;
  try { r = sendertoken.compactEnded({ force: true }); } finally { securewrite.flushOrThrow = realFlush; Date.now = realNow; console.error = realErr; }
  assert.equal(r.compacted, false, 'it went on past the budget');
  assert.equal(ino(), inoBefore, 'the live file was replaced');
  assert.deepEqual(sealed(), [], 'a link was made');
  assert.deepEqual(temps(), [], 'a temp file was left behind');
  assert.equal(said.filter((m) => /took over 6000 ms/.test(m)).length, 1, 'the slow compaction was not said');
});
