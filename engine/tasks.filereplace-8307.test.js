'use strict';
/**
 * kosmos#8307: a built task's file sent again with a DIFFERENT fingerprint replaces the one kept. The old file and who
 * had checked it are kept as builtReplaces, so those checks read as out of date; the new file starts with nobody
 * having checked it. engine/tasks.js setBuilt. The notice is in server.filereplace-8307.test.js.
 *
 *   node --test engine/tasks.filereplace-8307.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-filereplace-8307-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const projects = require('./projects');
const tasks = require('./tasks');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);
const FILE_A = path.join(SANDBOX, 'deck-v1.pdf');
const FILE_B = path.join(SANDBOX, 'deck-v2.pdf');
let pid;
let num = 0;
function freshTask() {
  if (!pid) pid = projects.create({ name: 'Replace' }).id;
  const r = tasks.create(pid, { sentence: 'Make the deck ' + (num += 1) });
  assert.ok(r && r.ok !== false, JSON.stringify(r));
  return (r.task || r).number;
}
const get = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === pid), n);   // as stored, paths included
const mark = (n, opts) => { const r = tasks.setBuilt(pid, n, opts); assert.equal(r.ok, true, r.because); return r; };

test('#8307: the first file is not a replacement (control), and a check of it is recorded', () => {
  const n = freshTask();
  const first = mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  assert.equal(first.replaced, undefined, 'the first file was called a replacement');
  assert.equal('builtReplaces' in get(n), false);
  assert.deepEqual(get(n).builtCheckedBy, []);
  mark(n, { by: 'mona', note: 'again' });   // the sender's own mark without a file drops it, as before #8307
  assert.equal(get(n).builtFingerprint, undefined, 'CONTROL: the sender dropping the file still drops it');
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  mark(n, { by: 'zed', note: 'checked it' });
  assert.deepEqual(get(n).builtCheckedBy, ['zed'], 'a checker\'s mark was not counted as a check of this file');
  mark(n, { person: true });
  assert.equal(get(n).builtCheckedByPerson, true, 'the person\'s mark was not counted as a check');
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A, note: 'same file' });
  assert.deepEqual(get(n).builtCheckedBy, ['zed'], 'sending the same file again forgot its checks');
  assert.equal(get(n).builtCheckedByPerson, true);
});

test('#8307: a different file replaces it, keeps the old one with its checks, and starts unchecked', () => {
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  const sentAt = get(n).builtFingerprintAt;
  assert.ok(sentAt, 'when the file was sent is not kept');
  mark(n, { by: 'zed' });
  mark(n, { person: true });
  assert.equal(get(n).builtFingerprintAt, sentAt, 'a check moved when the file was sent');
  const r = mark(n, { by: 'mona', fingerprint: B, filePath: FILE_B, note: 'rebuilt with the new figures' });
  assert.deepEqual(r.replaced, { fingerprint: A, by: 'mona', at: sentAt, filePath: FILE_A, checkedBy: ['zed'], checkedByPerson: true, kind: 'replaced' });
  const t = get(n);
  assert.equal(t.builtFingerprint, B);
  assert.equal(t.builtFilePath, FILE_B);
  const { kind, ...stored } = r.replaced;   // eslint-disable-line no-unused-vars
  assert.deepEqual(t.builtReplaces, stored);
  assert.deepEqual(t.builtCheckedBy, [], 'the new file inherited the old file\'s checks');
  assert.equal(t.builtCheckedByPerson, undefined);
  // Sent again: not a second replacement, and the replaced file stays named.
  const again = mark(n, { by: 'mona', fingerprint: B, filePath: FILE_B, note: 'resent' });
  assert.equal(again.replaced, undefined, 'the same file again was called a replacement');
  assert.deepEqual(get(n).builtReplaces, stored);
  // A different agent sending a third file replaces B, not A.
  const third = mark(n, { by: 'ivy', fingerprint: 'sha256:' + 'c'.repeat(64), filePath: FILE_A });
  assert.equal(third.replaced.fingerprint, B);
  assert.equal(third.replaced.by, 'mona');
});

test('#8307: a mark that drops the file withdraws it, a later file replaces the withdrawn one, and a clear drops it all', () => {
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  mark(n, { by: 'zed' });
  const dropped = mark(n, { by: 'mona', note: 'no file now' });
  assert.equal(dropped.replaced.kind, 'withdrawn', 'dropping the file was not said as a withdrawal');
  assert.deepEqual(dropped.replaced.checkedBy, ['zed']);
  assert.equal(get(n).builtFingerprint, undefined, 'CONTROL: the file is dropped, as before #8307');
  assert.equal(get(n).builtReplaces.fingerprint, A, 'the withdrawn file was not kept');
  const quiet = mark(n, { by: 'mona', note: 'still no file' });
  assert.equal(quiet.replaced, undefined, 'a second mark without a file withdrew it again');
  assert.equal(get(n).builtReplaces.fingerprint, A, 'a second mark without a file forgot the withdrawn one');
  const next = mark(n, { by: 'mona', fingerprint: B, filePath: FILE_B });
  assert.equal(next.replaced.kind, 'replaced', 'a file after a withdrawal did not replace the withdrawn one');
  assert.equal(next.replaced.fingerprint, A);
  assert.deepEqual(next.replaced.checkedBy, ['zed'], 'the withdrawn file\'s checker was lost');
  tasks.clearBuilt(pid, n, { by: 'mona' });
  const t = get(n);
  for (const k of ['builtReplaces', 'builtCheckedBy', 'builtCheckedByPerson', 'builtFingerprintAt']) assert.equal(k in t, false, k + ' survived a clear');
});

test('#8307: the same file sent back after a withdrawal is no replacement, and keeps its checks', () => {
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  const at = get(n).builtFingerprintAt;
  mark(n, { by: 'zed' });
  mark(n, { by: 'mona', note: 'oops, no file' });
  const back = mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  assert.equal(back.replaced, undefined, 'the same file sent back was called a replacement');
  assert.deepEqual(get(n).builtCheckedBy, ['zed'], 'the file sent back lost its checks');
  assert.equal(get(n).builtFingerprintAt, at, 'the file sent back got a new sent time');
  assert.equal('builtReplaces' in get(n), false, 'the file sent back still names itself as withdrawn');
});

test('#8307: a checker who sends the same file itself is no longer its checker (the sender never is)', () => {
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  mark(n, { by: 'zed' });
  mark(n, { by: 'ivy' });
  mark(n, { by: 'zed', fingerprint: A, filePath: FILE_A });
  assert.equal(get(n).builtFingerprintBy, 'zed');
  assert.deepEqual(get(n).builtCheckedBy, ['ivy'], 'the sender is listed as its own checker');
});

test('#8307: a fingerprint from before #8307 sent again gets no made-up sent time', () => {
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  // As a board before #8307 left it: no sent time.
  projects.mutate(pid, (p) => ({ ...p, tasks: p.tasks.map((x) => { if (x.number !== n) return x; const y = { ...x }; delete y.builtFingerprintAt; return y; }) }));
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A, note: 'same file, new note' });
  assert.equal('builtFingerprintAt' in get(n), false, 'a resend of an old fingerprint was stamped as sent now');
  const r = mark(n, { by: 'mona', fingerprint: B, filePath: FILE_B });
  assert.equal(r.replaced.at, null, 'the replaced file was given a time it was never sent at');
});

test('#8307: a looping checker records nothing new, and the list of checkers is bounded', () => {
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  mark(n, { by: 'zed' });
  const again = tasks.setBuilt(pid, n, { by: 'zed' });
  assert.equal(again.changed, false, 'the same check again was written');
  for (let i = 0; i < 30; i += 1) mark(n, { by: 'c' + i });
  assert.equal(get(n).builtCheckedBy.length, 20);
});

test('#8307: no view the page reads carries the replaced file\'s path either', () => {
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  mark(n, { by: 'mona', fingerprint: B, filePath: FILE_B });
  assert.equal(get(n).builtReplaces.filePath, FILE_A, 'CONTROL: the store keeps it, for task show');
  const row = tasks.byNumber(projects.get(pid), n);
  assert.equal(row.builtReplaces.fingerprint, A, 'CONTROL: the page view still names what it replaced');
  assert.equal('filePath' in row.builtReplaces, false, 'the page view carried the replaced file\'s path');
  assert.equal('builtFilePath' in row, false);
  const bare = tasks.withoutFilePaths(get(n));
  assert.equal('builtFilePath' in bare, false);
  assert.equal('filePath' in bare.builtReplaces, false);
  assert.equal(get(n).builtReplaces.filePath, FILE_A, 'stripping a view changed the stored task');
});

test('#8307: task show names the current file, who checked it, and the file it replaces with its out-of-date checks', () => {
  const tasklist = require('./tasklist');
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  mark(n, { by: 'zed' });
  mark(n, { person: true });
  const before = tasklist.showLines({ tasks: [get(n)] }, n, pid).lines.join('\n');
  assert.match(before, /^Checked: this file, by zed, the person$/m, before);
  assert.doesNotMatch(before, /^Replaces:/m, 'CONTROL: nothing replaced yet');
  mark(n, { by: 'mona', fingerprint: B, filePath: FILE_B });
  const out = tasklist.showLines({ tasks: [get(n)] }, n, pid).lines.join('\n');
  assert.match(out, new RegExp('^Delivered file: ' + B + ', sent by mona', 'm'), out);
  assert.match(out, /^Checked: not yet: nobody has checked this file since it replaced the one below$/m, out);
  assert.match(out, new RegExp('^Replaces: ' + A + ', sent by mona, ', 'm'), out);
  assert.match(out, /^Out of date: the checks of that file, by zed, the person: they are not checks of this one$/m, out);
  assert.ok(out.includes('Replaced file path, on the computer that marked it:') && out.includes(FILE_A), out);
  // Rebuilt in place: the same path is not printed twice.
  mark(n, { by: 'mona', fingerprint: 'sha256:' + 'd'.repeat(64), filePath: FILE_B });
  const inPlace = tasklist.showLines({ tasks: [get(n)] }, n, pid).lines.join('\n');
  assert.match(inPlace, /^Replaced file path: the same path as the delivered file \(rebuilt in place\)$/m, inPlace);
  mark(n, { by: 'mona', fingerprint: B, filePath: FILE_B });
  mark(n, { by: 'ivy' });
  const after = tasklist.showLines({ tasks: [get(n)] }, n, pid).lines.join('\n');
  assert.match(after, /^Checked: this file, by ivy$/m, 'a check of the new file is not said: ' + after);
});

test('#8307: task show says a withdrawn file, and that its checks are out of date', () => {
  const tasklist = require('./tasklist');
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  mark(n, { by: 'zed' });
  mark(n, { by: 'mona', note: 'pulled the file' });
  const out = tasklist.showLines({ tasks: [get(n)] }, n, pid).lines.join('\n');
  assert.doesNotMatch(out, /^Delivered file:/m, 'CONTROL: no current file');
  assert.match(out, new RegExp('^Withdrawn file: ' + A + ', sent by mona, .*\\(the last mark sent no file\\)$', 'm'), out);
  assert.match(out, /^Out of date: the checks of that file, by zed$/m, out);
  assert.doesNotMatch(out, /^Checked:/m, out);
});
