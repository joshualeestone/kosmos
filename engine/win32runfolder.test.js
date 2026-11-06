'use strict';
/**
 * kosmos#1765: engine/win32runfolder.js, the board's half of "this board runs from a folder other people on this PC may
 * be able to change". Every outside thing is a seam (platform, bundle root, profile, the Kosmos.exe call), so this
 * runs on any computer. The launcher's half (--check-run-folder) is tools.win-inplace-acl-1765.test.js; the page's is
 * docs/browser-checks/render-run-folder-1765.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const rf = require('./win32runfolder');

const ROOT = 'C:\\Kosmos';
const PROFILE = 'C:\\Users\\sam';
const UNSAFE = JSON.stringify({ safe: false, folder: ROOT, reason: 'NT AUTHORITY\\Authenticated Users can change C:\\Kosmos', message: 'Kosmos is running from C:\\Kosmos, and other people who use this computer may be able to change the files in that folder.' });

function seams(over) {
  const calls = [];
  const logs = [];
  const o = Object.assign({
    platform: 'win32',
    bundleRoot: () => ROOT,
    profile: PROFILE,
    exists: () => true,
    log: (s) => logs.push(s),
    run: (file, args, opt, cb) => { calls.push({ file, args, opt }); setImmediate(() => cb(null, UNSAFE)); },
  }, over || {});
  return { o, calls, logs };
}

test('#1765: an unsafe run folder is asked of its own Kosmos.exe once, and becomes the notice', async () => {
  const { o, calls, logs } = seams();
  const got = await rf.atStart(o);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'C:\\Kosmos\\Kosmos.exe');
  assert.deepEqual(calls[0].args, ['--check-run-folder']);
  assert.equal(calls[0].opt.timeout, rf.CHECK_TIMEOUT_MS, 'the answer has a time bound');
  assert.equal(calls[0].opt.windowsHide, true);
  assert.deepEqual(got, { asked: true, notice: { folder: ROOT, message: JSON.parse(UNSAFE).message } });
  assert.deepEqual(rf.current(), { folder: ROOT, message: JSON.parse(UNSAFE).message });
  assert.ok(logs.some((l) => l.includes('Authenticated Users can change')), 'the reason goes to board.log: ' + logs.join(' | '));
});

test('#1765: dismiss hides it until the next start', async () => {
  const { o } = seams();
  await rf.atStart(o);
  assert.ok(rf.current());
  assert.equal(rf.dismiss(), true);
  assert.equal(rf.current(), null);
  await rf.atStart(o);
  assert.ok(rf.current(), 'a new start asks again');
});

test('#1765: nothing is started off Windows, for a source checkout, or for a folder inside the profile', async () => {
  for (const [label, over] of [
    ['a Mac or Linux board', { platform: 'darwin' }],
    ['a source checkout (no bundle root)', { bundleRoot: () => null }],
    ['the normal install, inside the profile', { bundleRoot: () => 'C:\\Users\\sam\\AppData\\Local\\Programs\\Kosmos' }],
    ['the profile itself, any case', { bundleRoot: () => 'c:\\users\\SAM' }],
    ['a bundle root that cannot be read', { bundleRoot: () => { throw new Error('no'); } }],
  ]) {
    const { o, calls } = seams(over);
    const got = await rf.atStart(o);
    assert.equal(calls.length, 0, label + ': Kosmos.exe was started');
    assert.deepEqual(got, { asked: false, notice: null }, label);
    assert.equal(rf.current(), null, label);
  }
});

test('#1765: a folder whose name starts like the profile is not inside it', async () => {
  const { o, calls } = seams({ bundleRoot: () => 'C:\\Users\\samantha\\Kosmos' });
  await rf.atStart(o);
  assert.equal(calls.length, 1, 'C:\\Users\\samantha is not inside C:\\Users\\sam');
});

test('#1765: a check that cannot run, or answers nonsense, says nothing on the board and tells board.log', async () => {
  for (const [label, over, logged] of [
    ['no Kosmos.exe in the folder', { exists: () => false }, /there is no Kosmos\.exe/],
    ['Kosmos.exe fails', { run: (f, a, o, cb) => setImmediate(() => cb(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), '')) }, /ETIMEDOUT/],
    ['Kosmos.exe answers nonsense', { run: (f, a, o, cb) => setImmediate(() => cb(null, 'Kosmos will not start from')) }, /could not read the answer/],
    ['unsafe without words to show', { run: (f, a, o, cb) => setImmediate(() => cb(null, '{"safe":false,"folder":"C:\\\\Kosmos"}')) }, /could not read the answer/],
    ['the call throws', { run: () => { throw new Error('spawn EPERM'); } }, /spawn EPERM/],
  ]) {
    const { o, logs } = seams(over);
    const got = await rf.atStart(o);
    assert.equal(got.notice, null, label);
    assert.equal(rf.current(), null, label);
    assert.ok(logs.some((l) => logged.test(l)), label + ': ' + logs.join(' | '));
  }
});

test('#1765: a safe folder shows nothing', async () => {
  const { o } = seams({ run: (f, a, opt, cb) => setImmediate(() => cb(null, '{"safe":true}')) });
  const got = await rf.atStart(o);
  assert.deepEqual(got, { asked: true, notice: null });
  assert.equal(rf.current(), null);
});

test('#1765: readAnswer takes only the launcher\'s shape', () => {
  assert.deepEqual(rf.readAnswer('{"safe":true}'), { safe: true });
  assert.equal(rf.readAnswer(''), null);
  assert.equal(rf.readAnswer('{"safe":"no"}'), null);
  assert.equal(rf.readAnswer('[true]'), null);
  assert.deepEqual(rf.readAnswer(UNSAFE + '\r\n'), { safe: false, folder: ROOT, reason: JSON.parse(UNSAFE).reason, message: JSON.parse(UNSAFE).message });
});
