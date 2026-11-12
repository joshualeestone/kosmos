'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#8464: the owner's own copy of a file-owner notice says how big the change was. The notice is made before the
 * edit (the PreToolUse hook), so the file is fingerprinted then and again at the hand-over, when the edit has landed.
 *   node --test engine/filenotices-scale-8464.test.js */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-filescale-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');

const test = require('node:test');
const assert = require('node:assert/strict');
const fn = require('./filenotices');
const fw = require('./filewriters');
const projects = require('./projects');

const real = fs.realpathSync(SB);
let seq = 0;
const lines = (n, tag = 'line') => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n') + '\n';
function fileWith(text) {
  const f = path.join(real, 'f' + (++seq) + '.md');
  if (text !== null) fs.writeFileSync(f, text);
  return f;
}
function owner() { return 'own' + (++seq); }
const handed = (who) => fn.handOver(who);

test('kosmos#8464 a change after the notice is counted at the hand-over: lines added and removed, of how many', () => {
  const f = fileWith(lines(10));
  const who = owner();
  assert.equal(fn.queue(who, 'mona was about to change "f.md"', { file: f }), true);
  // The edit lands after the notice: line 3 changed, three lines appended.
  const now = fs.readFileSync(f, 'utf8').split('\n');
  now[2] = 'line 3, changed';
  fs.writeFileSync(f, now.join('\n').replace(/\n$/, '') + '\nmore 1\nmore 2\nmore 3\n');
  const got = handed(who);
  assert.deepStrictEqual(got.notices[0].scale, { added: 4, removed: 1, before: 10, created: false, same: false });
  assert.match(fn.contextText(got), /So far: 4 lines added and 1 line removed, of 10 before\./);
  assert.equal('fp' in got.notices[0], false, 'the fingerprint left the module');
});

test('kosmos#8464 an unchanged file, a deleted one and a new one each say so', () => {
  const same = fileWith(lines(5)); const a = owner();
  fn.queue(a, 'x', { file: same });
  assert.match(fn.contextText(handed(a)), /So far: Kosmos found no difference in the file since this notice \(it may have changed just before\)\./);
  const gone = fileWith(lines(5)); const b = owner();
  fn.queue(b, 'x', { file: gone });
  fs.rmSync(gone);
  assert.match(fn.contextText(handed(b)), /So far: the file is gone\./);
  const fresh = fileWith(null); const c = owner();
  fn.queue(c, 'x', { file: fresh });
  fs.writeFileSync(fresh, lines(2));
  assert.match(fn.contextText(handed(c)), /So far: 2 lines added and 0 lines removed \(it was new\)\./);
});

test('kosmos#8464 no scale is said for a link, a file over the bounds, or a notice made without a file', () => {
  const target = fileWith(lines(3));
  const link = path.join(real, 'link' + (++seq) + '.md');
  fs.symlinkSync(target, link);
  const a = owner(); fn.queue(a, 'x', { file: link });
  assert.doesNotMatch(fn.contextText(handed(a)), /So far/, 'a link was measured');
  const big = fileWith('y'.repeat(fn.SCALE_MAX_BYTES + 1)); const b = owner();
  fn.queue(b, 'x', { file: big });
  assert.doesNotMatch(fn.contextText(handed(b)), /So far/, 'a file over the byte bound was measured');
  const long = fileWith(lines(fn.SCALE_MAX_LINES + 1)); const c = owner();
  fn.queue(c, 'x', { file: long });
  assert.doesNotMatch(fn.contextText(handed(c)), /So far/, 'a file over the line bound was measured');
  const d = owner(); fn.queue(d, 'x');
  const plain = handed(d);
  assert.equal(plain.notices.length, 1, 'CONTROL: the notice itself is still handed over');
  assert.doesNotMatch(fn.contextText(plain), /So far/);
});

test('kosmos#8464 a file that becomes a link after the notice gets no scale (nothing is read through it)', () => {
  const f = fileWith(lines(3)); const who = owner();
  fn.queue(who, 'x', { file: f });
  const secret = fileWith(lines(40, 'secret'));
  fs.rmSync(f); fs.symlinkSync(secret, f);
  assert.doesNotMatch(fn.contextText(handed(who)), /So far: \d+ line/, 'a link swapped in was measured');
});

test('kosmos#8464 take (kosmos file-notices by hand) carries the scale too', () => {
  const f = fileWith(lines(4)); const who = owner();
  fn.queue(who, 'x', { file: f });
  fs.appendFileSync(f, 'one more\n');
  assert.match(fn.contextText(fn.take(who)), /So far: 1 line added and 0 lines removed, of 4 before\./);
});

test('kosmos#8464 end to end: another agent about to change an owned file queues the owner a notice that measures the change', () => {
  const id = 'scale' + (++seq);
  const folder = path.join(real, 'projects', id);
  fs.mkdirSync(folder, { recursive: true });
  projects.writeAll([...projects.readAll(), { id, name: 'Scale', folder, agents: ['mona', 'kitty'], createdAt: '2026-01-01T00:00:00.000Z' }]);
  const roots = [{ id, folder }];
  const f = path.join(folder, 'plan.md');
  fs.writeFileSync(f, lines(6));
  const t0 = Date.parse('2026-11-12T10:00:00Z');
  assert.equal(fw.noteWrite(f, 'kitty', { now: t0, projects: roots }), true, 'CONTROL: kitty is the first seen changing it');
  assert.equal(fw.noteWrite(f, 'mona', { now: t0 + 60e3, projects: roots }), true);
  fs.writeFileSync(f, lines(6).replace('line 6\n', '') + 'new a\nnew b\n');   // mona's edit lands
  const text = fn.contextText(fn.handOver('kitty'));
  assert.match(text, /mona was about to change "plan\.md"/, 'CONTROL: the owner was queued the notice');
  assert.match(text, /So far: 2 lines added and 1 line removed, of 6 before\./);
});

/* Review 2, the blocker: path.resolve drops '..' before the kernel follows a link, so P/l/../x.md (l a link to outside)
   is placed inside the project but would be read outside. The notice must measure the in-project file it names. */
test('kosmos#8464 review 2: a path through a link and ".." is measured as the in-project file, never the outside one', () => {
  const id = 'dots' + (++seq);
  const folder = path.join(real, 'projects', id); fs.mkdirSync(folder, { recursive: true });
  const own = 'dotown' + seq;   // its own owner: notices not acknowledged stay queued, so a shared name would mix tests
  projects.writeAll([...projects.readAll(), { id, name: 'Dots', folder, agents: ['mona', own], createdAt: '2026-01-01T00:00:00.000Z' }]);
  const roots = [{ id, folder }];
  const deep = path.join(real, 'outside' + seq, 'deep'); fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(real, 'outside' + seq, 'x.md'), 'o1\no2\no3\n');
  fs.symlinkSync(deep, path.join(folder, 'l'));
  fs.writeFileSync(path.join(folder, 'x.md'), 'i1\n');
  const raw = folder + '/l/../x.md';   // NOT path.join, which would drop the '..' and never test the escape
  assert.ok(raw.includes('/../'), 'CONTROL: the path really goes through the link and up');
  const t0 = Date.parse('2026-11-12T11:00:00Z');
  assert.equal(fw.noteWrite(raw, own, { now: t0, projects: roots }), true);
  assert.equal(fw.noteWrite(raw, 'mona', { now: t0 + 60e3, projects: roots }), true);
  fs.appendFileSync(path.join(real, 'outside' + seq, 'x.md'), 'o4\no5\n');   // the outside file changes
  const text = fn.contextText(fn.handOver(own));
  assert.match(text, /about to change/, 'CONTROL: the notice was queued');
  assert.doesNotMatch(text, /So far: 2 lines added/, 'the outside file was measured');
  assert.match(text, /So far: Kosmos found no difference/, 'the in-project file it names was measured (unchanged)');
});

/* Review 1 and 2: an agent controls the project folder. The notice keeps the real path of the file's folder; a folder
   replaced by a link to somewhere else afterwards gets no scale, so nothing outside is read. */
test('kosmos#8464 review 1: a folder replaced by a link to outside after the notice gets no scale, and nothing outside is read', () => {
  const inside = path.join(real, 'in' + (++seq)); fs.mkdirSync(inside);
  const outside = path.join(real, 'out' + seq); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(inside, 'id'), 'guess1\nguess2\nguess3\n');
  fs.writeFileSync(path.join(outside, 'id'), 'secretline\nguess2\n');
  const who = owner();
  fn.queue(who, 'x', { file: path.join(inside, 'id') });
  fs.renameSync(inside, inside + '.moved'); fs.symlinkSync(outside, inside);
  assert.doesNotMatch(fn.contextText(handed(who)), /So far/, 'the outside file was measured through a replaced folder');
  // CONTROL: the same kind of path, its folder left alone, is measured.
  const keep = path.join(real, 'keep' + seq); fs.mkdirSync(keep);
  fs.writeFileSync(path.join(keep, 'id'), 'a\nb\n');
  const w2 = owner(); fn.queue(w2, 'x', { file: path.join(keep, 'id') });
  fs.appendFileSync(path.join(keep, 'id'), 'c\n');
  assert.match(fn.contextText(handed(w2)), /So far: 1 line added/, 'CONTROL: an unmoved folder is measured');
});

test('kosmos#8464 review 2: a path through a link is not measured by queue (the caller passes the resolved path)', () => {
  const inside = path.join(real, 'li' + (++seq)); fs.mkdirSync(inside);
  fs.writeFileSync(path.join(inside, 'f'), 'a\n');
  const ln = path.join(real, 'lk' + seq); fs.symlinkSync(inside, ln);
  const who = owner(); fn.queue(who, 'x', { file: path.join(ln, 'f') });
  fs.appendFileSync(path.join(inside, 'f'), 'b\n');
  assert.doesNotMatch(fn.contextText(handed(who)), /So far/, 'a path whose folder is a link was measured');
});

test('kosmos#8464 review 2: a hard link (which may name a file outside the project) is not measured', () => {
  const outsideFile = fileWith('secret1\nsecret2\n');
  const hard = path.join(real, 'hard' + (++seq) + '.md'); fs.linkSync(outsideFile, hard);
  const who = owner(); fn.queue(who, 'x', { file: hard });
  fs.appendFileSync(hard, 'more\n');
  assert.doesNotMatch(fn.contextText(handed(who)), /So far/, 'a hard link was measured');
});

test('kosmos#8464 review 2: a file that grows past the bounds says so; one never made says it was not made', () => {
  const grow = fileWith(lines(3)); const a = owner();
  fn.queue(a, 'x', { file: grow });
  fs.writeFileSync(grow, 'z'.repeat(fn.SCALE_MAX_BYTES + 10));
  assert.match(fn.contextText(handed(a)), /So far: the file is now too large for Kosmos to count the change/);
  const never = fileWith(null); const b = owner();
  fn.queue(b, 'x', { file: never });
  assert.match(fn.contextText(handed(b)), /So far: the file has not been made yet\./);
});

test('kosmos#8464 review 1: a FIFO swapped in for the file neither hangs the board nor gets a scale', () => {
  const f = fileWith(lines(3)); const who = owner();
  fn.queue(who, 'x', { file: f });
  fs.rmSync(f);
  require('node:child_process').execFileSync('mkfifo', [f]);
  /* In a child with a hard limit and SIGKILL: a blocking open of a FIFO cannot be interrupted from inside node (no
     signal handler runs while the thread is stuck), so a regression must fail here, not hang the suite. */
  const child = require('node:child_process').spawnSync(process.execPath, ['-e',
    "const fn = require(" + JSON.stringify(require.resolve('./filenotices')) + "); process.stdout.write(fn.contextText(fn.handOver(" + JSON.stringify(who) + ")));"],
    { env: process.env, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });
  fs.rmSync(f, { force: true });
  assert.equal(child.signal, null, 'the hand-over hung on a FIFO and was killed');
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /file-owner notice/, 'CONTROL: the notice itself was handed over');
  assert.doesNotMatch(child.stdout, /So far: \d+ line/, 'a FIFO was measured');
});

test('kosmos#8464 review 1: a newline-only change, an empty new file and a change of line endings say what happened', () => {
  const nl = fileWith('a\nb'); const a = owner();
  fn.queue(a, 'x', { file: nl });
  fs.writeFileSync(nl, 'a\nb\n');
  assert.match(fn.contextText(handed(a)), /So far: the file changed, but no lines were added or removed/);
  const empty = fileWith(null); const b = owner();
  fn.queue(b, 'x', { file: empty });
  fs.writeFileSync(empty, '');
  assert.match(fn.contextText(handed(b)), /So far: the file was made, empty\./);
  const crlf = fileWith('one\ntwo\n'); const c = owner();
  fn.queue(c, 'x', { file: crlf });
  fs.writeFileSync(crlf, 'one\r\ntwo\r\n');
  assert.match(fn.contextText(handed(c)), /So far: the file changed, but no lines were added or removed/, 'line endings read as a rewrite');
});

/* Review 3, the blocker: the path was resolved twice in noteWrite and only the first was checked. A link flipped between
   the two (here inside who(), the window the reviewer used) sent an outside folder through. Resolved once now. */
test('kosmos#8464 review 3: a link flipped while the write is being noted does not send an outside file through', () => {
  const id = 'flip' + (++seq);
  const folder = path.join(real, 'projects', id); fs.mkdirSync(path.join(folder, 'realsub'), { recursive: true });
  const own = 'flipown' + seq;
  projects.writeAll([...projects.readAll(), { id, name: 'Flip', folder, agents: ['mona', own], createdAt: '2026-01-01T00:00:00.000Z' }]);
  const roots = [{ id, folder }];
  fs.writeFileSync(path.join(folder, 'realsub', 'x.md'), 'in1\nin2\nin3\n');
  const outside = path.join(real, 'flipout' + seq); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'x.md'), 'o1\no2\no3\n');
  const l = path.join(folder, 'l'); fs.symlinkSync(path.join(folder, 'realsub'), l);
  const t0 = Date.parse('2026-11-12T12:00:00Z');
  assert.equal(fw.noteWrite(path.join(l, 'x.md'), own, { now: t0, projects: roots }), true);
  assert.equal(fw.noteWrite(path.join(l, 'x.md'), () => { fs.rmSync(l); fs.symlinkSync(outside, l); return 'mona'; }, { now: t0 + 60e3, projects: roots }), true);
  fs.appendFileSync(path.join(outside, 'x.md'), 'o4\no5\n');   // the outside file changes
  const text = fn.contextText(fn.handOver(own));
  assert.match(text, /about to change/, 'CONTROL: the notice was queued');
  assert.doesNotMatch(text, /So far: 2 lines added/, 'the outside file was measured');
});

/* Review 3: a folder swapped to a link for the moment of the open and back passes both folder checks. Simulated by an
   open that lands on an outside file for the inside name; the name's device and inode then differ, so no scale. */
test('kosmos#8464 review 3: a file opened through a swap that is undone before the check is not measured', () => {
  const f = fileWith(lines(3)); const who = owner();
  fn.queue(who, 'x', { file: f });
  const outsideFile = fileWith(lines(9, 'secret'));
  const realOpen = fs.openSync;
  fs.openSync = (p, ...rest) => realOpen(p === f ? outsideFile : p, ...rest);
  let text;
  try { text = fn.contextText(handed(who)); } finally { fs.openSync = realOpen; }
  assert.doesNotMatch(text, /So far: \d+ line/, 'a swapped-in file was measured');
  // CONTROL: the same notice handed over again, with the real open, is measured.
  assert.match(fn.contextText(handed(who)), /So far: Kosmos found no difference/, 'CONTROL: the real file is measured');
});

/* Review 4: a folder flipped to a link before the open and kept until after the name check, then flipped back, passes
   every path check: the open and the name both land on the outside file. Forced here by an open and an lstat that both
   go outside. The file's identity, kept from the notice, is what stops it: an outside file cannot share the inode. */
test('kosmos#8464 review 4: an outside file reached through every path check is not counted (its identity differs)', () => {
  const f = fileWith('guess1\nguess2\nguess3\n'); const who = owner();
  fn.queue(who, 'x', { file: f });
  const outsideFile = fileWith('guess2\nsecretX\nsecretY\nsecretZ\n');
  const realOpen = fs.openSync; const realLstat = fs.lstatSync;
  fs.openSync = (p, ...rest) => realOpen(p === f ? outsideFile : p, ...rest);
  fs.lstatSync = (p, ...rest) => realLstat(p === f ? outsideFile : p, ...rest);
  let text;
  try { text = fn.contextText(handed(who)); } finally { fs.openSync = realOpen; fs.lstatSync = realLstat; }
  assert.doesNotMatch(text, /So far: \d+ line/, 'the outside file was counted');
  assert.match(text, /So far: the file was replaced by a new one/, 'CONTROL: it reads as another file, not counted');
});

test('kosmos#8464 review 4: an edit that writes a new file and renames it over the old one is "replaced", not counted', () => {
  const f = fileWith(lines(4)); const who = owner();
  fn.queue(who, 'x', { file: f });
  fs.writeFileSync(f + '.tmp', lines(6)); fs.renameSync(f + '.tmp', f);
  assert.match(fn.contextText(handed(who)), /So far: the file was replaced by a new one \(written and renamed over it\), so Kosmos did not count the change\./);
  // CONTROL: an edit in place keeps the file, and is counted.
  const g = fileWith(lines(4)); const w2 = owner();
  fn.queue(w2, 'x', { file: g });
  fs.appendFileSync(g, 'line 5\n');
  assert.match(fn.contextText(handed(w2)), /So far: 1 line added/);
});
