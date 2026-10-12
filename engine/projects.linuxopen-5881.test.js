'use strict';
/* #5881: on a Linux board the engine opens a FOLDER with xdg-open when the board's own environment has a desktop, and
   refuses with a sentence when it has none; a FILE is never opened there (download it). The Mac and Windows openers are
   unchanged. The runner seam for the routes; the production xdg-open line through a stand-in xdg-open on PATH. */
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

test('#5881: a Linux board with a desktop opens the folder and the file\'s folder with xdg-open, and never a file', (t) => {
  const calls = on(t, 'linux', { DISPLAY: ':0' });
  assert.deepEqual(projects.revealFolder(DIR), { ok: true });
  assert.deepEqual(projects.revealFile(path.join(DIR, 'notes.txt')), { ok: true });
  // Review 1: a file is not opened on the computer (an agent-written .desktop file or script could run); download it.
  assert.deepEqual(projects.openFile(DIR, 'notes.txt'), { ok: false, because: 'on this computer Kosmos does not open files, so download it instead' });
  assert.deepEqual(calls, [['xdg-open', DIR], ['xdg-open', DIR]], 'the file reached the opener');
  // Wayland names its display in its own variable.
  const w = on(t, 'linux', { WAYLAND_DISPLAY: 'wayland-0' });
  assert.deepEqual(projects.revealFolder(DIR), { ok: true });
  assert.deepEqual(w, [['xdg-open', DIR]]);
});

test('#5881: a Linux board with no desktop opens nothing and says why; a file says to download it', (t) => {
  const calls = on(t, 'linux', {});
  assert.deepEqual(projects.revealFolder(DIR), { ok: false, because: 'Kosmos cannot open it on this computer: it is not running in a desktop session' });
  assert.deepEqual(projects.revealFile(path.join(DIR, 'notes.txt')), { ok: false, because: 'Kosmos cannot open it on this computer: it is not running in a desktop session' });
  assert.deepEqual(projects.openFile(DIR, 'notes.txt'), { ok: false, because: 'on this computer Kosmos does not open files, so download it instead' });
  assert.deepEqual(calls, [], 'a board with no desktop reached the opener');
  // The gates still come first: a name the list would not show is refused as before, never a desktop question.
  assert.equal(projects.openFile(DIR, '../escape').ok, false);
  assert.doesNotMatch(projects.openFile(DIR, '../escape').because, /download/);
});

/* The production line (review 1: the runner seam once hid a broken one): a stand-in xdg-open on PATH records what it was
   given, so nothing opens for real. It is started, not waited on, so the record is read when it appears. */
test('#5881: the real xdg-open line is started with the folder, and a missing xdg-open is said', { skip: process.platform === 'win32' && 'a shell script stands in for xdg-open' }, async (t) => {
  const bin = fs.mkdtempSync(path.join(SANDBOX, 'bin-'));
  const log = path.join(SANDBOX, 'xdg-args.txt');
  // It records its argument, whether the board's token reached it, and the display it was given.
  fs.writeFileSync(path.join(bin, 'xdg-open'), '#!/bin/sh\nprintf "%s|%s|%s" "$1" "$KOSMOS_BOARD_TOKEN" "$DISPLAY" > "' + log + '"\n', { mode: 0o755 });
  projects.setRevealPlatform('linux');
  projects.setRevealRunner(null);
  t.after(() => { projects.setRevealPlatform(null); projects.setRevealEnv(null); });
  projects.setRevealEnv({ DISPLAY: ':0', PATH: bin, KOSMOS_BOARD_TOKEN: 'secret-5881' });
  assert.deepEqual(projects.revealFolder(DIR), { ok: true });
  for (let i = 0; i < 100 && !fs.existsSync(log); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(fs.readFileSync(log, 'utf8'), DIR + '||:0', 'xdg-open was not started with the folder and the display alone (review 2: never the board\'s token)');
  // CONTROL: the same call with no xdg-open on PATH says so, rather than claiming it opened.
  projects.setRevealEnv({ DISPLAY: ':0', PATH: path.join(SANDBOX, 'no-such-bin') });
  assert.deepEqual(projects.revealFolder(DIR), { ok: false, because: 'this computer has no xdg-open to open it with (it comes with xdg-utils)' });
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
