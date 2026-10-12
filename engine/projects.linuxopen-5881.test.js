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
// A listed file's target as openFile resolves it (resolveListedFile, realpathSync.native): on a Windows runner the native
// call expands the temp folder's 8.3 short name (RUNNER~1), which the JS realpathSync keeps, so the two are not the same.
const REAL = fs.realpathSync.native(DIR);
// The folder xdg-open is given: resolved with the JS fs.realpathSync (links followed, a short name kept), exactly as
// linuxOpenFolder resolves it, so the two match on every host.
const FOLDER = fs.realpathSync(DIR);

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
  assert.deepEqual(calls, [['xdg-open', FOLDER], ['xdg-open', FOLDER]], 'the file reached the opener');
  // A link to a folder is resolved first: xdg-open gets the folder's real path, never the link (review 10).
  const toDir = path.join(SANDBOX, 'link-to-docs');
  try { fs.symlinkSync(DIR, toDir); } catch { /* no symlinks here */ }
  if (fs.existsSync(toDir)) {
    calls.length = 0;
    assert.deepEqual(projects.revealFolder(toDir), { ok: true });
    assert.deepEqual(calls, [['xdg-open', FOLDER]], 'the link, not its folder, reached the opener');
  }
  // Wayland names its display in its own variable.
  const w = on(t, 'linux', { WAYLAND_DISPLAY: 'wayland-0' });
  assert.deepEqual(projects.revealFolder(DIR), { ok: true });
  assert.deepEqual(w, [['xdg-open', FOLDER]]);
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
  /* It records its argument, a variable outside the allowlist (KOSMOS_BOARD_TOKEN, a name made up here: any variable not
     on the list stands in for the board's own secrets), the display and the X cookie it was given. It writes a temp file
     and moves it into place (/bin/mv: its PATH is only this folder), so the test never reads a half-written record. */
  fs.writeFileSync(path.join(bin, 'xdg-open'), '#!/bin/sh\nprintf "%s|%s|%s|%s" "$1" "$KOSMOS_BOARD_TOKEN" "$DISPLAY" "$XAUTHORITY" > "' + log + '.tmp" && /bin/mv "' + log + '.tmp" "' + log + '"\n', { mode: 0o755 });
  projects.setRevealPlatform('linux');
  projects.setRevealRunner(null);
  t.after(() => { projects.setRevealPlatform(null); projects.setRevealEnv(null); });
  projects.setRevealEnv({ DISPLAY: ':0', XAUTHORITY: '/run/user/1000/gdm/Xauthority', PATH: bin, KOSMOS_BOARD_TOKEN: 'secret-5881' });
  assert.deepEqual(projects.revealFolder(DIR), { ok: true });
  for (let i = 0; i < 250 && !fs.existsSync(log); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(fs.existsSync(log), 'the stand-in xdg-open left no record within 5 s: it was not started');
  assert.equal(fs.readFileSync(log, 'utf8'), FOLDER + '||:0|/run/user/1000/gdm/Xauthority',
    'xdg-open was not started with the folder, the display and its X cookie, and never the board\'s token (reviews 2, 3)');
  // A path that is not absolute never reaches xdg-open (an argument starting with "-" would be read as an option).
  assert.deepEqual(projects.revealFolder('-x'), { ok: false, because: 'the folder did not open' });
  // Review 7: neither does a file, or a link to one, given as a folder (a .desktop file would run).
  const launcher = path.join(SANDBOX, 'evil.desktop');
  fs.writeFileSync(launcher, '[Desktop Entry]\nExec=true\n');
  assert.deepEqual(projects.revealFolder(launcher), { ok: false, because: 'that is not a folder' });
  const link = path.join(SANDBOX, 'looks-like-a-folder');
  try { fs.symlinkSync(launcher, link); } catch { /* no symlinks here */ }
  if (fs.existsSync(link)) assert.deepEqual(projects.revealFolder(link), { ok: false, because: 'that is not a folder' });
  assert.deepEqual(projects.revealFolder(path.join(SANDBOX, 'gone')), { ok: false, because: 'that folder is not there any more' });
  // CONTROL: the same call with no xdg-open on PATH says so, rather than claiming it opened.
  projects.setRevealEnv({ DISPLAY: ':0', PATH: path.join(SANDBOX, 'no-such-bin') });
  assert.deepEqual(projects.revealFolder(DIR), { ok: false, because: 'this computer has no program installed for opening folders' });
  // A relative PATH entry is never searched (it would name a folder relative to where the board runs).
  projects.setRevealEnv({ DISPLAY: ':0', PATH: path.relative(process.cwd(), bin) || '.' });
  assert.deepEqual(projects.revealFolder(DIR), { ok: false, because: 'this computer has no program installed for opening folders' });
});

test('#5881 CONTROL: the Mac opener and the Windows arm are unchanged, whatever the environment says', (t) => {
  const mac = on(t, 'darwin', {});
  assert.deepEqual(projects.revealFolder(DIR), { ok: true });
  assert.deepEqual(projects.revealFile(path.join(DIR, 'notes.txt')), { ok: true });
  assert.deepEqual(projects.openFile(DIR, 'notes.txt'), { ok: true });
  assert.deepEqual(mac, [['/usr/bin/open', DIR], ['/usr/bin/open', '-R', path.join(DIR, 'notes.txt')], ['/usr/bin/open', path.join(REAL, 'notes.txt')]]);
  /* Review 7: the Windows arm has its own runner (win32explorer), and on a Windows host a real folder would reach
     Explorer itself, which the live-execution gate refuses under node --test. So the arm gets a Windows path, a stat
     that says it is a folder, and a spy for Explorer: on every host it then reaches the spy, never xdg-open. */
  const win = on(t, 'win32', { DISPLAY: ':0' });
  const win32explorer = require('./win32explorer');
  const explorer = [];
  win32explorer.setRunner((exe, args) => { explorer.push(args); return { ok: true }; });
  win32explorer.setStatForTests(() => ({ isDirectory: () => true, isFile: () => false }));
  t.after(() => { win32explorer.setRunner(null); win32explorer.setStatForTests(null); });
  assert.deepEqual(projects.revealFolder('C:\\Users\\kosmos\\docs'), { ok: true });
  assert.equal(explorer.length, 1, 'the Windows arm did not reach Explorer');
  assert.deepEqual(win, [], 'Windows reached xdg-open');
});
