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
  assert.deepEqual(r.replaced, { fingerprint: A, by: 'mona', at: sentAt, filePath: FILE_A, checkedBy: ['zed'], checkedByPerson: true });
  const t = get(n);
  assert.equal(t.builtFingerprint, B);
  assert.equal(t.builtFilePath, FILE_B);
  assert.deepEqual(t.builtReplaces, r.replaced);
  assert.deepEqual(t.builtCheckedBy, [], 'the new file inherited the old file\'s checks');
  assert.equal(t.builtCheckedByPerson, undefined);
  // Sent again: not a second replacement, and the replaced file stays named.
  const again = mark(n, { by: 'mona', fingerprint: B, filePath: FILE_B, note: 'resent' });
  assert.equal(again.replaced, undefined, 'the same file again was called a replacement');
  assert.deepEqual(get(n).builtReplaces, r.replaced);
  // A different agent sending a third file replaces B, not A.
  const third = mark(n, { by: 'ivy', fingerprint: 'sha256:' + 'c'.repeat(64), filePath: FILE_A });
  assert.equal(third.replaced.fingerprint, B);
  assert.equal(third.replaced.by, 'mona');
});

test('#8307: dropping the file or clearing the mark drops what it replaced', () => {
  const n = freshTask();
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  mark(n, { by: 'mona', fingerprint: B, filePath: FILE_B });
  assert.ok(get(n).builtReplaces, 'CONTROL: it was kept');
  mark(n, { by: 'mona', note: 'no file now' });
  assert.equal('builtReplaces' in get(n), false, 'a mark that dropped the file kept what it replaced');
  mark(n, { by: 'mona', fingerprint: A, filePath: FILE_A });
  mark(n, { by: 'mona', fingerprint: B, filePath: FILE_B });
  tasks.clearBuilt(pid, n, { by: 'mona' });
  const t = get(n);
  for (const k of ['builtReplaces', 'builtCheckedBy', 'builtCheckedByPerson', 'builtFingerprintAt']) assert.equal(k in t, false, k + ' survived a clear');
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
  mark(n, { by: 'ivy' });
  const after = tasklist.showLines({ tasks: [get(n)] }, n, pid).lines.join('\n');
  assert.match(after, /^Checked: this file, by ivy$/m, 'a check of the new file is not said: ' + after);
});
