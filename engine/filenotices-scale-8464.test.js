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
  assert.deepStrictEqual(got.notices[0].scale, { added: 4, removed: 1, before: 10, created: false });
  assert.match(fn.contextText(got), /So far: 4 lines added and 1 line removed, of 10 before\./);
  assert.equal('fp' in got.notices[0], false, 'the fingerprint left the module');
});

test('kosmos#8464 an unchanged file, a deleted one and a new one each say so', () => {
  const same = fileWith(lines(5)); const a = owner();
  fn.queue(a, 'x', { file: same });
  assert.match(fn.contextText(handed(a)), /So far: the file is unchanged since this notice\./);
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
