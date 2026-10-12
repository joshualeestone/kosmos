'use strict';
/* #5881: on a Linux board the engine opens things with xdg-open when the board's own environment has a desktop, and
   refuses with a sentence when it has none; the Mac and Windows openers are unchanged. Every route through the runner
   seam, so nothing is opened for real. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linuxopen-5881-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const projects = require('./projects');
const DIR = path.join(SANDBOX, 'docs');
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'notes.txt'), 'x');
const REAL = fs.realpathSync(DIR);

function on(t, platform, env) {
  const calls = [];
  projects.setRevealPlatform(platform);
  projects.setRevealEnv(env);
  projects.setRevealRunner((cmd, args) => { calls.push([cmd, ...args]); return { ok: true }; });
  t.after(() => { projects.setRevealPlatform(null); projects.setRevealEnv(null); projects.setRevealRunner(null); });
  return calls;
}

test('#5881: a Linux board with a desktop opens the folder, the file\'s folder and the file with xdg-open', (t) => {
  const calls = on(t, 'linux', { DISPLAY: ':0' });
  assert.deepEqual(projects.revealFolder(DIR), { ok: true });
  assert.deepEqual(projects.revealFile(path.join(DIR, 'notes.txt')), { ok: true });
  assert.deepEqual(projects.openFile(DIR, 'notes.txt'), { ok: true });
  assert.deepEqual(calls, [['xdg-open', DIR], ['xdg-open', DIR], ['xdg-open', path.join(REAL, 'notes.txt')]]);
  // Wayland names its display in its own variable.
  const w = on(t, 'linux', { WAYLAND_DISPLAY: 'wayland-0' });
  assert.deepEqual(projects.revealFolder(DIR), { ok: true });
  assert.deepEqual(w, [['xdg-open', DIR]]);
});

test('#5881: a Linux board with no desktop opens nothing and says why; a file says to download it', (t) => {
  const calls = on(t, 'linux', {});
  assert.deepEqual(projects.revealFolder(DIR), { ok: false, because: 'this computer has no desktop to open it on' });
  assert.deepEqual(projects.revealFile(path.join(DIR, 'notes.txt')), { ok: false, because: 'this computer has no desktop to open it on' });
  assert.deepEqual(projects.openFile(DIR, 'notes.txt'), { ok: false, because: 'this computer has no desktop to open it on, so download it instead' });
  assert.deepEqual(calls, [], 'a board with no desktop reached the opener');
  // The gates still come first: a name the list would not show is refused as before, never a desktop question.
  assert.equal(projects.openFile(DIR, '../escape').ok, false);
  assert.doesNotMatch(projects.openFile(DIR, '../escape').because, /desktop/);
});

test('#5881: an opener that fails on a Linux desktop is said, not passed off as opened', (t) => {
  on(t, 'linux', { DISPLAY: ':1' });
  projects.setRevealRunner(() => { const e = new Error('xdg-open: no method available'); throw e; });
  assert.deepEqual(projects.revealFolder(DIR), { ok: false, because: 'the folder did not open' });
  assert.deepEqual(projects.openFile(DIR, 'notes.txt'), { ok: false, because: 'that file did not open' });
});

test('#5881 CONTROL: the Mac opener and the Windows arm are unchanged, whatever the environment says', (t) => {
  const mac = on(t, 'darwin', {});
  assert.deepEqual(projects.revealFolder(DIR), { ok: true });
  assert.deepEqual(projects.revealFile(path.join(DIR, 'notes.txt')), { ok: true });
  assert.deepEqual(projects.openFile(DIR, 'notes.txt'), { ok: true });
  assert.deepEqual(mac, [['/usr/bin/open', DIR], ['/usr/bin/open', '-R', path.join(DIR, 'notes.txt')], ['/usr/bin/open', path.join(REAL, 'notes.txt')]]);
  const win = on(t, 'win32', { DISPLAY: ':0' });
  projects.revealFolder(DIR);
  assert.ok(!win.some((c) => c[0] === 'xdg-open'), 'Windows reached xdg-open');
});
