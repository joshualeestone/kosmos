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

test('#5881 review 1: run as the page runs them, the project file rows download on a Linux board and never ask to open', async () => {
  for (const [listId, msgId] of [['docs-list', 'docs-msg'], ['pj-docs', 'pj-docs-msg'], ['pj-room', 'pj-room-msg']]) {
    const anchor = "document.getElementById('" + listId + "').addEventListener('click', ";
    const at = SCRIPT.indexOf(anchor);
    assert.ok(at > -1, `the ${listId} handler moved`);
    const body = SCRIPT.slice(at + anchor.length, SCRIPT.indexOf('\n});', at) + 2);
    const make = (linux, seen) => new Function('document', 'fetch', 'PJ_CURRENT', 'pjSentence', 'asSentence',
      'PJ_DOCS_VIEW_PARTIAL', 'PJ_DOCS_PARTIAL', 'PJ_DOCS_RAIL_PARTIAL', 'kplusRemote', 'filesPvOpen', 'onLinux',
      'kplusDownload', 'kplusSayer', 'return ' + body)(
      { getElementById: () => ({ textContent: '' }) },
      async (url) => { seen.fetched.push(url); return { ok: true, json: async () => ({ ok: true }) }; },
      'proj', (s) => s, (s) => s, false, 'PARTIAL NOTE', false,
      () => false, () => false, () => linux,
      (...args) => { seen.downloaded.push(args.slice(0, 3)); },
      () => () => {},
    );
    const click = { target: { closest: () => ({ dataset: { doc: 'notes.pdf', ref: 'notes.pdf' } }) } };
    const lx = { fetched: [], downloaded: [] };
    await make(true, lx)(click);
    assert.deepEqual(lx.downloaded, [['project', 'proj', 'notes.pdf']], `${listId}: a Linux board did not download`);
    assert.ok(!lx.fetched.some((u) => /open-file/.test(String(u))), `${listId}: a Linux board asked to open the file`);
    // CONTROL: the same handler at a Mac asks the board to open it, and downloads nothing.
    const mac = { fetched: [], downloaded: [] };
    await make(false, mac)(click);
    assert.deepEqual(mac.downloaded, []);
    assert.ok(mac.fetched.some((u) => /open-file/.test(String(u))), `${listId}: the Mac control did not ask to open`);
  }
});
