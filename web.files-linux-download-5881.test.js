'use strict';
/* #5881: on a Linux board a file row offers Download, as it does through Kosmos+ (#5165) and as #5865 makes the preview do:
   the board may have no desktop to open the file on (the engine then refuses, engine/projects.linuxopen-5881.test.js).
   The four file-row click handlers are anonymous listeners, so they are held by their source, in order: the download
   branch comes before the request that would open the file on the computer. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);
const BRANCH = 'if (kplusRemote() || onLinux()) {   // #5165: download it to this device; #5881';

test('#5881: every file row that would open a file on the computer downloads it on a Linux board instead', () => {
  const at = [];
  for (let i = SCRIPT.indexOf(BRANCH); i !== -1; i = SCRIPT.indexOf(BRANCH, i + 1)) at.push(i);
  assert.equal(at.length, 4, 'the four file-row handlers (an agent\'s Files, and the project lists) each carry the branch');
  // No handler is left on the Kosmos+-only test.
  assert.equal(SCRIPT.indexOf('if (kplusRemote()) {   // #5165: download it to this device'), -1, 'a file row still downloads only through Kosmos+');
  for (const i of at) {
    const next = SCRIPT.slice(i, i + 1600);
    const dl = next.indexOf('kplusDownload(');
    const open = Math.min(...['/files/open', '/open-file'].map((r) => { const k = next.indexOf(r); return k === -1 ? Infinity : k; }));
    assert.ok(dl > -1 && open < Infinity && dl < open, 'the download does not come before the open request: ' + next.slice(0, 200));
  }
});

test('#5881: the branch keys on the platform the board stamped on the page (CONTROL: a Mac and an unstamped page do not)', () => {
  const run = (platform) => new Function('document', page.liftAll(SCRIPT, page.PLATFORM_COPY_FNS) + '\nreturn onLinux();')({
    querySelector: (sel) => (sel === 'meta[name="kosmos-platform"]' && platform !== undefined ? { getAttribute: () => platform } : null),
    getElementById: () => null,
  });
  assert.equal(run('linux'), true);
  assert.equal(run('darwin'), false);
  assert.equal(run('win32'), false);
  assert.equal(run(undefined), false);
});
