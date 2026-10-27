'use strict';

/**
 * #7221: on a Windows board a reply attachment's path is refused by its spelling and by where its links point
 * BEFORE the first realpath, because resolving a link to a share is itself the SMB contact (measured on the Windows
 * box 2026-10-26: realpathSync.native on a symlink to an unroutable \\host\share stalled 21 s; lstat and readlink on
 * the same link answered in 0 ms).
 *
 * Every refusal arm also counts the realpath calls through replyfile's own test seam and asserts there were none,
 * so an arm that refused with the right words AFTER resolving the path (after the contact) is red. The share used is
 * 10.255.255.1, unroutable, so a regression stalls the arm (and its timing assertion) rather than reaching anyone.
 *
 * The pure arms (the spelling and device-name rules) run everywhere; the arms that make links and attach run only on
 * win32, where the rule applies and where the links mean what they mean on a board.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-7221-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');

const replyfile = require('./replyfile');
const winpath = require('./winpath');
const dmfiles = require('./dmfiles');
const projects = require('./projects');

const WIN = process.platform === 'win32';
const SHARE = '\\\\10.255.255.1\\share\\x';
const WHO = 'win7221';
/* Under this, an answer came without a network attempt: the one measured on the Windows box stalled 21 s, and a slow
   CI runner needs room (review 6 NIT). The realpath count is the exact guard; this one catches a stall. */
const SOON_MS = 10000;
/* A drive letter no drive here uses, picked in random order so two runs at once rarely want the same one; null when
   Q to Z are all taken, and the arm that needs one skips (review 5 finding 3). */
function freeDriveLetter() {
  const letters = 'QRSTUVWXYZ'.split('').sort(() => Math.random() - 0.5);
  return letters.find((d) => !fs.existsSync(d + ':' + path.sep)) || null;
}

const realFilesDir = dmfiles.filesDir;
const realReadAll = projects.readAll;
test.after(() => {
  dmfiles.filesDir = realFilesDir;   // put back what before() replaced, in case a runner ever shares the process
  projects.readAll = realReadAll;
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* ---------- the rules by spelling: every platform ---------- */

test('#7221: DOS device names are recognised with an extension, trailing dots and spaces, and the superscript digits', () => {
  for (const n of ['NUL', 'nul', 'Con', 'PRN', 'aux', 'COM1', 'com9', 'LPT1', 'lpt9', 'COM1.txt', 'nul.tar.gz', 'NUL.', 'NUL ', 'nul .txt', 'CONIN$', 'conout$', 'COM\u00b9', 'LPT\u00b3']) {
    assert.equal(winpath.isDevicePart(n), true, n + ' is a device name');
  }
  for (const n of ['null.txt', 'console.log', 'nulls', 'COM10', 'lpt', 'com', 'aux_notes.md', 'report.pdf', 'x.nul']) {
    assert.equal(winpath.isDevicePart(n), false, n + ' is an ordinary name');
  }
  /* Review 7 finding 2: the shared rule is exactly what backuprestore refused before. Only literal spaces before the
     extension (what Windows trims), so a Mac backup's name with a no-break space stays a name; CLOCK$ is win32zip's
     own extra, not in the shared rule. */
  assert.equal(winpath.WINDOWS_DEVICE_NAME.test('con\u00a0.txt'), false, 'a no-break space before the extension');
  assert.equal(winpath.WINDOWS_DEVICE_NAME.test('nul\u3000.txt'), false, 'an ideographic space before the extension');
  assert.equal(winpath.WINDOWS_DEVICE_NAME.test('CLOCK$'), false, 'CLOCK$ is not in the shared rule');
  assert.equal(winpath.WINDOWS_DEVICE_NAME.test('con  .txt'), true, 'literal spaces before the extension');
});

test('#7221 review 7: a drive letter is read from every spelling of a drive path', () => {
  assert.equal(winpath.driveOf('c:\\x'), 'C');
  assert.equal(winpath.driveOf('\\\\?\\D:\\x'), 'D', 'the long spelling');
  assert.equal(winpath.driveOf('\\??\\E:\\x'), 'E', 'the NT spelling');
  assert.equal(winpath.driveOf('\\\\host\\share\\x'), null);
});

test('#7221: the spelling rules refuse shares, device namespaces, streams, device names and drives outside the roots', () => {
  const drives = { drives: new Set(['C']), folders: [] };   // the agent's roots: Files on C:, no projects
  const net = replyfile.ON_NETWORK;
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\host\\share\\f.txt', drives), net);
  assert.equal(replyfile.winSpellingRefusalForTests('//host/share/f.txt', drives), net);
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\?\\UNC\\host\\share\\f.txt', drives), net);
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\.\\NUL', drives), net);
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\?\\C:\\Users\\a\\Files\\f.txt', drives), replyfile.LONG_FORM, 'a local file in the \\\\?\\ form is refused, said as what it is (review 13)');
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\.\\C:\\Users\\a\\Files\\f.txt', drives), replyfile.LONG_FORM);
  assert.equal(replyfile.winSpellingRefusalForTests('\\??\\C:\\Users\\a\\Files\\f.txt', drives), replyfile.LONG_FORM, 'the NT spelling too, not a stream (review 18)');
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\?\\Volume{8567e582-9e23-4c72-a97e-1fbdfc2f255f}\\Users\\a\\f.txt', drives), replyfile.LONG_FORM, 'a local volume: asked for its drive letter, not called a network path (review 24)');
  assert.equal(replyfile.winSpellingRefusalForTests('C:\\Users\\a\\Files\\f.txt:hidden', drives), replyfile.STREAM, 'an alternate data stream');
  assert.equal(replyfile.winSpellingRefusalForTests('C:\\Users\\a\\Files\\COM1:', drives), replyfile.STREAM);
  assert.equal(replyfile.winSpellingRefusalForTests('C:\\Users\\a\\Files\\NUL', drives), replyfile.DEVICE_NAME);
  assert.equal(replyfile.winSpellingRefusalForTests('C:\\Users\\a\\Files\\com1.txt', drives), replyfile.DEVICE_NAME);
  assert.equal(replyfile.winSpellingRefusalForTests('Z:\\Files\\f.txt', drives), replyfile.NOT_YOURS, 'a drive no root is on (a mapped drive is a share)');
  assert.equal(replyfile.winSpellingRefusalForTests('\\Users\\a\\Files\\f.txt', drives), replyfile.NOT_YOURS, 'a path with no drive');
  // CONTROL: an ordinary file on the roots' drive passes the spelling rules, in either case of the letter
  assert.equal(replyfile.winSpellingRefusalForTests('C:\\Users\\a\\Files\\report.pdf', drives), null);
  assert.equal(replyfile.winSpellingRefusalForTests('c:/Users/a/Files/null.txt', drives), null);
});

/* ---------- attach on a Windows board ---------- */

let FILES;
let OUTSIDE;
let realpathCalls = 0;
function counting() {
  realpathCalls = 0;
  replyfile.setRealpathForTests((p) => { realpathCalls++; return fs.realpathSync.native(p); });
}
function attachTimed(p) {
  const t = Date.now();
  const r = replyfile.attach(WHO, p, { platform: 'win32' });
  return { r, ms: Date.now() - t };
}
function refusedUnresolved(p, because, label) {
  counting();
  const { r, ms } = attachTimed(p);
  assert.equal(r.ok, false, label + ': must be refused, got ' + JSON.stringify(r));
  assert.equal(r.because, because, label);
  assert.equal(realpathCalls, 0, label + ': refused before the path was resolved');
  assert.ok(ms < SOON_MS, label + ': refused at once, not after a network attempt (' + ms + ' ms)');
}

test.before(() => {
  if (!WIN) return;
  FILES = path.join(SANDBOX, 'workers', WHO, 'Files');
  OUTSIDE = path.join(SANDBOX, 'outside');
  fs.mkdirSync(FILES, { recursive: true });
  fs.mkdirSync(OUTSIDE, { recursive: true });
  fs.writeFileSync(path.join(FILES, 'report.txt'), 'the report\n');
  // The agent's Files folder and its projects (none unless an arm sets PROJECTS), as the board would answer them.
  dmfiles.filesDir = (name) => (name === WHO ? FILES : null);
  projects.readAll = () => PROJECTS;
});
let PROJECTS = [];
const realFolderState = projects.folderState;
test.afterEach(() => {
  if (!WIN) return;
  replyfile.setRealpathForTests(null);
  PROJECTS = [];
  projects.folderState = realFolderState;
});

const winOnly = { skip: !WIN && 'the Windows board rule; links and device names mean this only on win32' };
/* Arms that make a symbolic link need Developer Mode or an elevated process on Windows (review 8 NIT); where neither
   holds, they skip with that reason instead of failing on EPERM. A junction needs neither, so its arm is winOnly. */
function canMakeSymlinks() {
  if (!WIN) return false;
  const probe = path.join(SANDBOX, 'symlink-probe');
  try { fs.symlinkSync(path.join(SANDBOX, 'nowhere'), probe, 'file'); fs.rmSync(probe, { force: true }); return true; } catch { return false; }
}
const linkOnly = { skip: !WIN ? 'the Windows board rule' : (!canMakeSymlinks() && 'this account cannot make symbolic links (no Developer Mode, not elevated)') };
/* The arms that reproduce the fail-opens need the machine's admin share, a free drive letter, mountvol, subst and
   mklink. Where one is missing an arm skips, and a skip exits zero; on Windows CI, the one place every arm is meant
   to run, a missing one fails instead, so a runner change cannot quietly turn those arms off (review 27 finding 2). */
const ON_WINDOWS_CI = WIN && !!process.env.CI;
function setupSkip(t, why) {
  if (ON_WINDOWS_CI) assert.fail('on Windows CI this arm must run, but: ' + why);
  t.skip(why);
}
test('#7221: on Windows CI, this account can make symbolic links, so no link arm skips', { skip: !ON_WINDOWS_CI && 'only on Windows CI' }, () => {
  assert.equal(canMakeSymlinks(), true);
});

test('#7221 CONTROL: an ordinary file in Files attaches on a Windows board, resolved once on the way in', winOnly, () => {
  counting();
  const r = replyfile.attach(WHO, path.join(FILES, 'report.txt'), { platform: 'win32' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.rec.name, 'report.txt');
  assert.ok(realpathCalls >= 1, 'the control does reach the realpath the refusal arms must not');
  replyfile.discard(r.rec);
});

test('#7221: a share, a device namespace and a long-path spelling are refused before anything is resolved', winOnly, () => {
  refusedUnresolved(SHARE, replyfile.ON_NETWORK, 'a \\\\host\\share path');
  refusedUnresolved('//10.255.255.1/share/x', replyfile.ON_NETWORK, 'a //host/share path');
  refusedUnresolved('\\\\?\\UNC\\10.255.255.1\\share\\x', replyfile.ON_NETWORK, 'a \\\\?\\UNC path');
  refusedUnresolved('\\\\.\\NUL', replyfile.ON_NETWORK, 'the \\\\.\\ device namespace');
  refusedUnresolved('\\\\?\\' + path.join(FILES, 'report.txt'), replyfile.LONG_FORM, 'the \\\\?\\ spelling of a local file');
});

test('#7221: a symbolic link in Files that points at a share is refused without resolving it (no SMB contact)', linkOnly, () => {
  const link = path.join(FILES, 'share-link.txt');
  fs.symlinkSync(SHARE, link, 'file');
  try { refusedUnresolved(link, replyfile.ON_NETWORK, 'a file link to a share'); } finally { fs.rmSync(link, { force: true }); }
  const dirLink = path.join(FILES, 'share-dir');
  fs.symlinkSync('\\\\10.255.255.1\\share', dirLink, 'dir');
  try { refusedUnresolved(path.join(dirLink, 'f.txt'), replyfile.ON_NETWORK, 'a file under a folder link to a share'); } finally { fs.rmSync(dirLink, { force: true }); }
});

test('#7221: a junction in Files out to a share is refused without resolving it', winOnly, () => {
  const j = path.join(FILES, 'share-junction');
  fs.symlinkSync('\\\\10.255.255.1\\share', j, 'junction');
  try {
    refusedUnresolved(path.join(j, 'f.txt'), replyfile.DEAD_LINK, 'a junction to a share');
    // review 7 finding 1: the same junction typed in another case lstats ENOENT too, and is refused the same way
    refusedUnresolved(path.join(FILES, 'SHARE-JUNCTION', 'f.txt'), replyfile.DEAD_LINK, 'the junction typed in upper case');
  } finally { fs.rmSync(j, { recursive: true, force: true }); }
});

test('#7221: a chain of links that ends at a share is followed link by link and refused', linkOnly, () => {
  const last = path.join(OUTSIDE, 'to-share.txt');
  const first = path.join(FILES, 'chain.txt');
  fs.symlinkSync(SHARE, last, 'file');
  fs.symlinkSync(last, first, 'file');
  try { refusedUnresolved(first, replyfile.ON_NETWORK, 'a link to a link to a share'); } finally { fs.rmSync(first, { force: true }); fs.rmSync(last, { force: true }); }
});

test('#7221: a link that points at another drive no root is on is refused without resolving it', linkOnly, (t) => {
  const other = freeDriveLetter();
  if (!other) { setupSkip(t, 'no free drive letter'); return; }
  const link = path.join(FILES, 'to-other-drive.txt');
  fs.symlinkSync(other + ':\\f.txt', link, 'file');
  try { refusedUnresolved(link, replyfile.NOT_YOURS, 'a link to drive ' + other); } finally { fs.rmSync(link, { force: true }); }
});

test('#7221: a DOS device name in Files is refused before it is opened or resolved', winOnly, () => {
  for (const n of ['NUL', 'nul.txt', 'COM1', 'com1.log', 'LPT1', 'CON', 'AUX.md', 'NUL. ']) {
    refusedUnresolved(path.join(FILES, n), replyfile.DEVICE_NAME, n);
  }
});

test('#7221: an alternate data stream on a file in Files is refused before it is resolved', winOnly, () => {
  refusedUnresolved(path.join(FILES, 'report.txt') + ':secret', replyfile.STREAM, 'a stream');
});

test('#7221: a drive no root is on (a mapped drive is a share under a letter) is refused before it is touched', winOnly, (t) => {
  const other = freeDriveLetter();
  if (!other) { setupSkip(t, 'no free drive letter'); return; }
  refusedUnresolved(other + ':\\Files\\report.txt', replyfile.NOT_YOURS, 'drive ' + other);
});

test('#7221: a real path that turns out to be a share, or a device, is refused before the open (the second guard)', winOnly, () => {
  replyfile.setRealpathForTests(() => '\\\\10.255.255.1\\share\\report.txt');
  let r = replyfile.attach(WHO, path.join(FILES, 'report.txt'), { platform: 'win32' });
  assert.deepEqual([r.ok, r.because], [false, replyfile.ON_NETWORK]);
  replyfile.setRealpathForTests(() => path.join(FILES, 'COM1'));
  r = replyfile.attach(WHO, path.join(FILES, 'report.txt'), { platform: 'win32' });
  assert.deepEqual([r.ok, r.because], [false, replyfile.DEVICE_NAME]);
  // CONTROL: the local long-path spelling realpath can return is a local file, not a share
  replyfile.setRealpathForTests((p) => '\\\\?\\' + fs.realpathSync.native(p));
  r = replyfile.attach(WHO, path.join(FILES, 'report.txt'), { platform: 'win32' });
  assert.notEqual(r.because, replyfile.ON_NETWORK, 'a \\\\?\\C:\\ real path is not refused as a network path: ' + JSON.stringify(r));
  if (r.ok) replyfile.discard(r.rec);
});

test('#7221 review 1-2: a file named on one of the agent\'s project drives may resolve to a share (a mapped drive); one named on its Files drive may not', winOnly, (t) => {
  /* The project's drive is one no real folder here is on, and the walk finds nothing on it to follow; the seam then
     answers the share path a mapped drive resolves to. 127.0.0.1 with no such share fails fast, so the read after the
     guard refuses for its own reason, and the arm asserts only that the NETWORK guard let the project file through. */
  const mapped = freeDriveLetter();
  if (!mapped) { setupSkip(t, 'no free drive letter'); return; }
  PROJECTS = [{ id: 'p-7221', name: 'Mapped', folder: mapped + ':\\proj', agents: [WHO] }];
  const shareReal = '\\\\127.0.0.1\\nosuchshare7221\\proj\\f.txt';
  replyfile.setRealpathForTests(() => shareReal);
  const onProject = replyfile.attach(WHO, mapped + ':\\proj\\f.txt', { platform: 'win32' });
  assert.equal(onProject.ok, false);
  assert.notEqual(onProject.because, replyfile.ON_NETWORK, 'a mapped-drive project file is not refused as a network path: ' + JSON.stringify(onProject));
  // CONTROL: the same share real path for a file named in Files (Kosmos's own folder, never on a share) is refused
  const inFiles = replyfile.attach(WHO, path.join(FILES, 'report.txt'), { platform: 'win32' });
  assert.deepEqual([inFiles.ok, inFiles.because], [false, replyfile.ON_NETWORK]);
});

test('#7221 review 1-3: a project folder written as a share is never resolved to judge a local file', winOnly, () => {
  const proj = path.join(SANDBOX, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'notes.txt'), 'project notes\n');
  PROJECTS = [
    { id: 'p-share', name: 'Share', folder: '\\\\10.255.255.1\\share\\proj', agents: ['someone-else'] },
    { id: 'p-local', name: 'Local', folder: proj, agents: [WHO] },
  ];
  const resolved = [];
  projects.folderState = (folder) => { resolved.push(folder); return realFolderState(folder); };
  const t = Date.now();
  const r = replyfile.attach(WHO, path.join(proj, 'notes.txt'), { platform: 'win32' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(resolved, [proj], 'only the local project folder was resolved');
  assert.ok(Date.now() - t < SOON_MS, 'no network attempt on the way');
  replyfile.discard(r.rec);
});

/* ---------- review 2 ---------- */

test('#7221 review 2-1: a link target is followed only when it is a drive path or a relative one', () => {
  const follow = winpath.followableLinkTarget;
  assert.equal(follow('C:\\Users\\a\\f.txt'), 'C:\\Users\\a\\f.txt');
  assert.equal(follow('\\\\?\\C:\\Users\\a\\f.txt'), 'C:\\Users\\a\\f.txt', 'the long spelling of a local drive');
  assert.equal(follow('\\??\\C:\\Users\\a\\f.txt'), 'C:\\Users\\a\\f.txt', 'the NT spelling of a local drive');
  assert.equal(follow('..\\other\\f.txt'), '..\\other\\f.txt', 'a relative target');
  assert.equal(follow('f.txt'), 'f.txt');
  for (const t of ['\\??\\GLOBALROOT\\Device\\Mup\\10.255.255.1\\share\\x', '\\\\?\\GLOBALROOT\\Device\\Mup\\h\\s',
    '\\\\host\\share\\x', '//host/share/x', '\\\\?\\UNC\\host\\share', '\\\\.\\NUL', '\\??\\UNC\\host\\share',
    '\\Device\\Mup\\host\\share', 'C:f.txt', 'f.txt:stream', 'C:\\a\\f.txt:stream',
    '\\\\?\\Volume{0b1c2d3e-0000-0000-0000-100000000000}\\x']) {
    assert.equal(follow(t), null, t + ' is not followed');
  }
});

test('#7221 review 2-1: a link in Files aimed at a share through \\\\?\\GLOBALROOT\\Device\\Mup is refused without resolving it', linkOnly, () => {
  const link = path.join(FILES, 'mup-link.txt');
  fs.symlinkSync('\\\\?\\GLOBALROOT\\Device\\Mup\\10.255.255.1\\share\\x', link, 'file');
  try { refusedUnresolved(link, replyfile.ON_NETWORK, 'a GLOBALROOT link to a share'); } finally { fs.rmSync(link, { force: true }); }
});

test('#7221 review 10: a link in Files to a local volume path is refused unresolved, and not as a network path', linkOnly, () => {
  const volume = '\\\\?\\Volume{0b1c2d3e-0000-0000-0000-100000000000}\\x';
  assert.equal(winpath.isNetworkSpelling(volume), false, 'a local volume is not another computer');
  assert.equal(winpath.isNetworkSpelling('\\\\.\\pipe\\x'), true, 'a namespace that cannot be placed is still not local');
  const link = path.join(FILES, 'volume-link.txt');
  fs.symlinkSync(volume, link, 'file');
  try { refusedUnresolved(link, replyfile.UNREADABLE_LINK, 'a link to a local volume'); } finally { fs.rmSync(link, { force: true }); }
});

test('#7221 review 2-2: with Files and a project on the same drive, a Files file that resolves to a share is still refused; a project file is not', winOnly, () => {
  const proj = path.join(SANDBOX, 'sameproj');
  fs.mkdirSync(proj, { recursive: true });
  assert.equal(path.parse(proj).root, path.parse(FILES).root, 'the project and Files share a drive, the usual setup');
  PROJECTS = [{ id: 'p-same', name: 'Same', folder: proj, agents: [WHO] }];
  replyfile.setRealpathForTests(() => '\\\\127.0.0.1\\nosuchshare7221\\x\\f.txt');
  const inFiles = replyfile.attach(WHO, path.join(FILES, 'report.txt'), { platform: 'win32' });
  assert.deepEqual([inFiles.ok, inFiles.because], [false, replyfile.ON_NETWORK], 'the second guard holds on the same drive');
  const inProject = replyfile.attach(WHO, path.join(proj, 'f.txt'), { platform: 'win32' });
  assert.equal(inProject.ok, false);
  assert.notEqual(inProject.because, replyfile.ON_NETWORK, 'a file written inside the project may be on a share: ' + JSON.stringify(inProject));
});

/* This box's own admin share (\\127.0.0.1\C$) gives a real share path to a real file, so the share-file branch of
   allowedRoot runs for real. Skipped where the admin share is not reachable. */
function adminShareOf(p) {
  const unc = '\\\\127.0.0.1\\' + p[0] + '$' + p.slice(2);
  try { fs.statSync(unc); return unc; } catch { return null; }
}
test('#7221 review 2-3: a file on a share resolves only the share-written project folders on that same share', winOnly, (t) => {
  const proj = path.join(SANDBOX, 'shareproj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'f.txt'), 'on the share\n');
  const projUnc = adminShareOf(proj);
  if (!projUnc) { setupSkip(t, 'this machine\'s admin share is not reachable'); return; }
  const sameShare = adminShareOf(SANDBOX);
  PROJECTS = [
    { id: 'p-mine', name: 'Mine', folder: proj, agents: [WHO] },
    { id: 'p-other-share', name: 'Elsewhere', folder: '\\\\10.255.255.1\\share\\proj', agents: ['someone-else'] },
    { id: 'p-same-share', name: 'Same share', folder: sameShare, agents: ['someone-else'] },
  ];
  replyfile.setRealpathForTests((p) => (p === path.join(proj, 'f.txt') ? path.join(projUnc, 'f.txt') : fs.realpathSync.native(p)));
  const resolved = [];
  projects.folderState = (folder) => { resolved.push(folder); return realFolderState(folder); };
  const started = Date.now();
  replyfile.attach(WHO, path.join(proj, 'f.txt'), { platform: 'win32' });
  assert.ok(!resolved.includes('\\\\10.255.255.1\\share\\proj'), 'a project on another share is never resolved: ' + JSON.stringify(resolved));
  assert.ok(resolved.includes(sameShare), 'a project on the file\'s own share still is (it may hold the file): ' + JSON.stringify(resolved));
  assert.ok(Date.now() - started < SOON_MS, 'no network attempt to another share');
});

/* ---------- review 3 ---------- */

test('#7221 review 3-2: a plain share path passes the spelling rule only inside one of the agent\'s own share-written project folders', () => {
  const roots = { drives: new Set(['C']), folders: ['\\\\host\\share\\proj', 'C:\\work\\local'] };
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\host\\share\\proj\\f.txt', roots), null);
  assert.equal(replyfile.winSpellingRefusalForTests('//HOST/Share/proj/sub/f.txt', roots), null, 'either slash, any case');
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\host\\share\\other\\f.txt', roots), replyfile.ON_NETWORK, 'outside the project');
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\host\\share\\projx\\f.txt', roots), replyfile.ON_NETWORK, 'a sibling whose name starts the same');
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\elsewhere\\share\\proj\\f.txt', roots), replyfile.ON_NETWORK, 'another host');
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\?\\UNC\\host\\share\\proj\\f.txt', roots), replyfile.ON_NETWORK, 'the \\\\?\\ namespace stays refused');
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\host\\share\\proj\\NUL', roots), replyfile.DEVICE_NAME, 'a device name stays refused inside');
  assert.equal(replyfile.winSpellingRefusalForTests('\\\\host\\share\\proj\\f.txt', { drives: new Set(['C']), folders: ['C:\\work\\local'] }), replyfile.ON_NETWORK, 'no share project: refused');
});

test('#7221 review 3-2: a file in one of the agent\'s own share-written projects attaches by its share path; one beside it is refused unresolved', winOnly, (t) => {
  const proj = path.join(SANDBOX, 'uncproj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'f.txt'), 'on the share project\n');
  const projUnc = adminShareOf(proj);
  if (!projUnc) { setupSkip(t, 'this machine\'s admin share is not reachable'); return; }
  PROJECTS = [{ id: 'p-unc', name: 'Unc', folder: projUnc, agents: [WHO] }];
  const r = replyfile.attach(WHO, path.join(projUnc, 'f.txt'), { platform: 'win32' });
  assert.equal(r.ok, true, 'attaches as on main: ' + JSON.stringify(r));
  replyfile.discard(r.rec);
  refusedUnresolved(path.join(adminShareOf(SANDBOX), 'outside', 'f.txt'), replyfile.ON_NETWORK, 'a share path outside the project');
});

test('#7221 review 3-1: a project folder that is a link out to a share is never resolved to judge a local file', linkOnly, () => {
  const linked = path.join(SANDBOX, 'linkedproj');
  fs.symlinkSync('\\\\10.255.255.1\\share\\proj', linked, 'dir');
  const proj = path.join(SANDBOX, 'localproj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'notes.txt'), 'local notes\n');
  PROJECTS = [
    { id: 'p-linked', name: 'Linked', folder: linked, agents: ['someone-else'] },
    { id: 'p-under', name: 'Under', folder: path.join(linked, 'sub'), agents: ['someone-else'] },
    { id: 'p-local', name: 'Local', folder: proj, agents: [WHO] },
  ];
  const resolved = [];
  projects.folderState = (folder) => { resolved.push(folder); return realFolderState(folder); };
  const started = Date.now();
  try {
    const r = replyfile.attach(WHO, path.join(proj, 'notes.txt'), { platform: 'win32' });
    assert.equal(r.ok, true, JSON.stringify(r));
    replyfile.discard(r.rec);
    assert.deepEqual(resolved, [proj], 'neither the link to a share nor a folder under it was resolved');
    assert.ok(Date.now() - started < SOON_MS, 'no network attempt on the way');
  } finally { fs.rmSync(linked, { force: true }); }
});

/* ---------- review 4 ---------- */

test('#7221 review 4-1: a project written on C: that lives on another local drive through a link attaches its files', linkOnly, (t) => {
  /* A second local drive made for the arm with subst (no admin needed): `<letter>:` is the folder `ddrive`. The project
     is written under a C: folder that is a link onto that drive, the C:\Users\me\work -> D:\work layout. */
  const { execFileSync } = require('node:child_process');
  const ddrive = path.join(SANDBOX, 'ddrive');
  fs.mkdirSync(path.join(ddrive, 'proj'), { recursive: true });
  fs.writeFileSync(path.join(ddrive, 'proj', 'f.txt'), 'on the other drive\n');
  const letter = freeDriveLetter();
  if (!letter) { setupSkip(t, 'no free drive letter'); return; }
  try { execFileSync('subst', [letter + ':', ddrive], { stdio: 'ignore' }); } catch { setupSkip(t, 'subst is not available here'); return; }
  /* A subst drive outlives the process that made it, so it is removed on exit too, should the arm be cut off. */
  const unsubst = () => { try { execFileSync('subst', [letter + ':', '/D'], { stdio: 'ignore' }); } catch { /* already gone */ } };
  process.once('exit', unsubst);
  const view = path.join(SANDBOX, 'cview');
  try {
    fs.symlinkSync(letter + ':\\', view, 'dir');
    const proj = path.join(view, 'proj');
    PROJECTS = [{ id: 'p-other-drive', name: 'Other drive', folder: proj, agents: [WHO] }];
    /* Review 24: the roots' links are walked once per attach, readOwn's recheck included: the Files folder (a root,
       walked to learn the drives it reaches) is lstat'd once by that walk, plus once by filesRoot's own check: 2 in
       all, where walking the roots again in the recheck made it 3. */
    const realLstat = fs.lstatSync;
    let filesLstats = 0;
    fs.lstatSync = (p, ...rest) => { if (String(p).toLowerCase() === FILES.toLowerCase()) filesLstats++; return realLstat(p, ...rest); };
    let r;
    try { r = replyfile.attach(WHO, path.join(proj, 'f.txt'), { platform: 'win32' }); } finally { fs.lstatSync = realLstat; }
    assert.equal(filesLstats, 2, 'the roots were walked once (plus the lstat of filesRoot)');
    assert.equal(r.ok, true, 'attaches as on main: ' + JSON.stringify(r));
    replyfile.discard(r.rec);
    // CONTROL: once no root reaches that drive (the project gone), a link from Files onto it is refused unresolved
    PROJECTS = [];
    const out = path.join(FILES, 'to-other-drive-file.txt');
    fs.symlinkSync(letter + ':\\proj\\f.txt', out, 'file');
    try { refusedUnresolved(out, replyfile.NOT_YOURS, 'a Files link onto a drive no root reaches'); } finally { fs.rmSync(out, { force: true }); }
  } finally {
    fs.rmSync(view, { force: true });
    unsubst();
  }
});

/* ---------- review 5 ---------- */

test('#7221 review 5-1: a nested project of another agent that is left unresolved still keeps its files from the outer project', winOnly, () => {
  const outer = path.join(SANDBOX, 'outer');
  const nested = path.join(outer, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'secret.txt'), 'not for the outer project\n');
  fs.writeFileSync(path.join(outer, 'open.txt'), 'for the outer project\n');
  // the nested project written in the long \\?\ form, which a project record accepts as absolute
  PROJECTS = [
    { id: 'p-outer', name: 'Outer', folder: outer, agents: [WHO] },
    { id: 'p-nested', name: 'Nested', folder: '\\\\?\\' + nested, agents: ['someone-else'] },
  ];
  const r = replyfile.attach(WHO, path.join(nested, 'secret.txt'), { platform: 'win32' });
  assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], 'refused, as on main: ' + JSON.stringify(r));
  // CONTROL: a file of the outer project outside the nested one still attaches
  const ok = replyfile.attach(WHO, path.join(outer, 'open.txt'), { platform: 'win32' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  replyfile.discard(ok.rec);
});

test('#7221 review 5-1: a nested share project written with another name for the server still keeps its files from the outer one', winOnly, (t) => {
  const outer = path.join(SANDBOX, 'souter');
  const nested = path.join(outer, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'secret.txt'), 'not for the outer project\n');
  const outerUnc = adminShareOf(outer);
  if (!outerUnc) { setupSkip(t, 'this machine\'s admin share is not reachable'); return; }
  // the outer project on \\127.0.0.1, the nested one written on \\localhost: one server, two spellings
  PROJECTS = [
    { id: 'p-souter', name: 'Outer', folder: outerUnc, agents: [WHO] },
    { id: 'p-snested', name: 'Nested', folder: path.join(outerUnc.replace('\\\\127.0.0.1\\', '\\\\localhost\\'), 'nested'), agents: ['someone-else'] },
  ];
  const r = replyfile.attach(WHO, path.join(outerUnc, 'nested', 'secret.txt'), { platform: 'win32' });
  assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], 'refused, as main refused it by identity: ' + JSON.stringify(r));
});

test('#7221 review 5-2: a file directly in Files touches no project folder, even one the agent is on', winOnly, () => {
  const proj = path.join(SANDBOX, 'untouched-proj');
  fs.mkdirSync(proj, { recursive: true });
  PROJECTS = [{ id: 'p-untouched', name: 'Untouched', folder: proj, agents: [WHO] }];
  const touched = [];
  const realLstat = fs.lstatSync;
  fs.lstatSync = (p, ...rest) => { touched.push(String(p)); return realLstat(p, ...rest); };
  try {
    const r = replyfile.attach(WHO, path.join(FILES, 'report.txt'), { platform: 'win32' });
    assert.equal(r.ok, true, JSON.stringify(r));
    replyfile.discard(r.rec);
  } finally { fs.lstatSync = realLstat; }
  const lower = proj.toLowerCase();
  assert.deepEqual(touched.filter((p) => p.toLowerCase().startsWith(lower)), [], 'no lstat under the project folder');
});

/* ---------- review 9: file ids past 2^53 ---------- */

/* Two different folders whose number ids are equal: NTFS file ids are 64-bit, and a number ino keeps 53 bits. On the
   Windows box 19 pairs of 2000 fresh files collided. Up to 4000 folders are made to find a pair; null if none did. */
function collidingFolders(where) {
  fs.mkdirSync(where, { recursive: true });
  const byNumber = new Map();
  for (let i = 0; i < 4000; i++) {
    const dir = path.join(where, 'd' + i);
    fs.mkdirSync(dir);
    const big = fs.statSync(dir, { bigint: true });
    const key = Number(big.dev) + ':' + Number(big.ino);
    const prior = byNumber.get(key);
    if (prior && prior.ino !== big.ino) return [prior.dir, dir];
    byNumber.set(key, { dir, ino: big.ino });
  }
  return null;
}
test('#7221 review 9: a folder whose number id equals a project folder\'s is not taken for that project (BigInt ids)', winOnly, (t) => {
  const pair = collidingFolders(path.join(SANDBOX, 'ids'));
  if (!pair) { t.skip('no two folders here had equal number ids'); return; }
  const [projectFolder, elsewhere] = pair;
  fs.writeFileSync(path.join(elsewhere, 'f.txt'), 'not in any project\n');
  PROJECTS = [{ id: 'p-ids', name: 'Ids', folder: projectFolder, agents: [WHO] }];
  const r = replyfile.attach(WHO, path.join(elsewhere, 'f.txt'), { platform: 'win32' });
  assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], 'a file outside every project is refused: ' + JSON.stringify(r));
});

/* ---------- review 8 ---------- */

test('#7221 review 8-1: the namespace spellings of a drive, a share and a local volume are read for what they are', () => {
  assert.equal(winpath.driveOf('\\\\.\\C:\\work\\inner'), 'C', '\\\\.\\C:\\ is drive C');
  assert.equal(winpath.isNetworkSpelling('\\\\.\\C:\\work'), false, 'and is not a network path');
  assert.equal(winpath.shareOf('\\\\?\\GLOBALROOT\\Device\\Mup\\Host\\Share\\x'), 'host\\share', 'the Mup device names a share');
  assert.equal(winpath.shareOf('\\??\\UNC\\host\\share\\x'), 'host\\share');
  assert.equal(winpath.isLocalVolumeSpelling('\\\\?\\Volume{8567e582-9e23-4c72-a97e-1fbdfc2f255f}\\work'), true);
  assert.equal(winpath.isLocalVolumeSpelling('\\\\?\\GLOBALROOT\\Device\\HarddiskVolume3\\work'), true);
  assert.equal(winpath.isLocalVolumeSpelling('\\\\host\\share\\x'), false);
  // a folder in a namespace mayHold cannot place answers "may hold", so a skip of it refuses rather than lets through
  // review 12 finding 2: a pipe or device namespace holds no files, so it answers no; the object manager's root can
  // name any drive's files, so it answers yes
  assert.equal(winpath.mayHold('\\\\.\\pipe\\x', 'C:\\work\\f.txt', 'C:\\work\\f.txt'), false);
  assert.equal(winpath.mayHold('\\\\?\\GLOBALROOT\\GLOBAL??\\C:\\work', 'C:\\work\\f.txt', 'C:\\work\\f.txt'), true);
  assert.equal(winpath.mayHold('\\\\.\\C:\\work\\inner', 'C:\\work\\inner\\f.txt', 'C:\\work\\inner\\f.txt'), true, 'read as C:\\work\\inner');
  assert.equal(winpath.mayHold('\\\\.\\C:\\work\\inner', 'C:\\work\\other\\f.txt', 'C:\\work\\other\\f.txt'), false);
});

test('#7221 review 8-1: a nested project of another agent written \\\\.\\C:\\ keeps its files from the outer project', winOnly, () => {
  const outer = path.join(SANDBOX, 'douter');
  const nested = path.join(outer, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'secret.txt'), 'not for the outer project\n');
  PROJECTS = [
    { id: 'p-douter', name: 'Outer', folder: outer, agents: [WHO] },
    { id: 'p-dnested', name: 'Nested', folder: '\\\\.\\' + nested, agents: ['someone-else'] },
  ];
  const r = replyfile.attach(WHO, path.join(nested, 'secret.txt'), { platform: 'win32' });
  assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], 'refused, as on main: ' + JSON.stringify(r));
});

test('#7221 review 8-1: a nested project of another agent written by its volume GUID keeps its files from the outer project', winOnly, (t) => {
  const { execFileSync } = require('node:child_process');
  let volume = null;
  try {
    const out = execFileSync('mountvol', [path.parse(SANDBOX).root.slice(0, 2), '/L'], { encoding: 'utf8' });
    volume = (/\\\\\?\\Volume\{[0-9a-f-]+\}\\/i.exec(out) || [null])[0];
  } catch { volume = null; }
  if (!volume) { setupSkip(t, 'mountvol gave no volume name here'); return; }
  const outer = path.join(SANDBOX, 'vouter');
  const nested = path.join(outer, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'secret.txt'), 'not for the outer project\n');
  PROJECTS = [
    { id: 'p-vouter', name: 'Outer', folder: outer, agents: [WHO] },
    { id: 'p-vnested', name: 'Nested', folder: volume + nested.slice(3), agents: ['someone-else'] },
  ];
  const r = replyfile.attach(WHO, path.join(nested, 'secret.txt'), { platform: 'win32' });
  assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], 'refused, as main refused it by identity: ' + JSON.stringify(r));
});

/* ---------- review 11 ---------- */

/* A link with a ROOT-RELATIVE target (\dir\x, no drive), made the way a person makes one: cmd's mklink. Node's
   symlinkSync fills the drive in (measured: it stores C:\dir\x), so it cannot make this link. False if mklink failed. */
function mklinkRootRelative(link, target, isDir) {
  const { execFileSync } = require('node:child_process');
  const args = ['/c', 'mklink'].concat(isDir ? ['/D'] : [], [link, target]);
  try { execFileSync('cmd', args, { stdio: 'ignore' }); } catch { return false; }
  try { return !/^[A-Za-z]:/.test(fs.readlinkSync(link)); } catch { return false; }
}

test('#7221 review 11-3: a root-relative link target is a path on the link\'s own drive, and is followed', () => {
  assert.equal(winpath.followableLinkTarget('\\Users\\a\\f.txt'), '\\Users\\a\\f.txt');
  assert.equal(winpath.followableLinkTarget('/Users/a/f.txt'), '/Users/a/f.txt');
  for (const t of ['\\Device\\Mup\\host\\share', '\\device\\HarddiskVolume3\\x', '\\GLOBAL??\\C:\\x', '\\??\\GLOBALROOT\\x', '\\Users\\a:b']) {
    assert.equal(winpath.followableLinkTarget(t), null, t + ' is not followed');
  }
});

test('#7221 review 11-3: a root-relative link in Files to a file in Files attaches', linkOnly, (t) => {
  const link = path.join(FILES, 'rootrel.txt');
  if (!mklinkRootRelative(link, path.join(FILES, 'report.txt').slice(2), false)) { setupSkip(t, 'mklink could not make a root-relative link here'); return; }
  try {
    const r = replyfile.attach(WHO, link, { platform: 'win32' });
    assert.equal(r.ok, true, JSON.stringify(r));
    replyfile.discard(r.rec);
  } finally { fs.rmSync(link, { force: true }); }
});

test('#7221 review 11-1: a nested project of another agent that is a link the walk will not follow is resolved, and keeps its files', linkOnly, (t) => {
  /* The repro from review 11: agent B's project `outer\nested` is a link whose target the walk does not follow (a
     volume GUID path); skipped, it was judged by spelling only and the file at its physical target attached for the
     agent on `outer`. Now it is resolved, as on main, and identity decides. */
  const { execFileSync } = require('node:child_process');
  let volume = null;
  try { volume = (/\\\\\?\\Volume\{[0-9a-f-]+\}\\/i.exec(execFileSync('mountvol', [path.parse(SANDBOX).root.slice(0, 2), '/L'], { encoding: 'utf8' })) || [null])[0]; } catch { volume = null; }
  if (!volume) { setupSkip(t, 'mountvol gave no volume name here'); return; }
  const outer = path.join(SANDBOX, 'router');
  const data = path.join(outer, 'deep', 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'secret.txt'), 'B\'s project file\n');
  const nested = path.join(outer, 'nested');
  fs.symlinkSync(volume + data.slice(3), nested, 'dir');
  try {
    PROJECTS = [
      { id: 'p-router', name: 'Outer', folder: outer, agents: [WHO] },
      { id: 'p-rnested', name: 'Nested', folder: nested, agents: ['someone-else'] },
    ];
    const r = replyfile.attach(WHO, path.join(data, 'secret.txt'), { platform: 'win32' });
    assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], 'refused, as main refused it: ' + JSON.stringify(r));
  } finally { fs.rmSync(nested, { force: true }); }
});

test('#7221 review 11-1: the same with a root-relative link (the reviewer\'s exact repro)', linkOnly, (t) => {
  const outer = path.join(SANDBOX, 'rrouter');
  const data = path.join(outer, 'deep', 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'secret.txt'), 'B\'s project file\n');
  const nested = path.join(outer, 'nested');
  if (!mklinkRootRelative(nested, data.slice(2), true)) { setupSkip(t, 'mklink could not make a root-relative link here'); return; }
  try {
    PROJECTS = [
      { id: 'p-rrouter', name: 'Outer', folder: outer, agents: [WHO] },
      { id: 'p-rrnested', name: 'Nested', folder: nested, agents: ['someone-else'] },
    ];
    const r = replyfile.attach(WHO, path.join(data, 'secret.txt'), { platform: 'win32' });
    assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], 'refused, as main refused it: ' + JSON.stringify(r));
  } finally { fs.rmSync(nested, { force: true }); }
});

test('#7221 review 11-2: the agent\'s own project folder that is a link to a share attaches its files, as on main', linkOnly, (t) => {
  const target = path.join(SANDBOX, 'own-share-target');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'f.txt'), 'on the share\n');
  const targetUnc = adminShareOf(target);
  if (!targetUnc) { setupSkip(t, 'this machine\'s admin share is not reachable'); return; }
  const proj = path.join(SANDBOX, 'own-share-link');
  fs.symlinkSync(targetUnc, proj, 'dir');
  try {
    PROJECTS = [{ id: 'p-own-share', name: 'Own share', folder: proj, agents: [WHO] }];
    const r = replyfile.attach(WHO, path.join(proj, 'f.txt'), { platform: 'win32' });
    assert.equal(r.ok, true, 'attaches as on main: ' + JSON.stringify(r));
    replyfile.discard(r.rec);
    // CONTROL: the same link registered as ANOTHER agent's project keeps it from this one, unresolved
    PROJECTS = [{ id: 'p-other-share', name: 'Other share', folder: proj, agents: ['someone-else'] }];
    refusedUnresolved(path.join(proj, 'f.txt'), replyfile.ON_NETWORK, 'another agent\'s link to a share');
  } finally { fs.rmSync(proj, { force: true }); }
});

/* ---------- review 12 ---------- */

test('#7221 review 12-1: past the agent\'s own project link to a share, a link further down to another share is refused unresolved', linkOnly, (t) => {
  const target = path.join(SANDBOX, 'own-share-target2');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'f.txt'), 'on the share\n');
  const targetUnc = adminShareOf(target);
  if (!targetUnc) { setupSkip(t, 'this machine\'s admin share is not reachable'); return; }
  fs.symlinkSync('\\\\10.255.255.1\\share2', path.join(target, 'elsewhere'), 'dir');   // on the share, a link out
  const proj = path.join(SANDBOX, 'own-share-link2');
  fs.symlinkSync(targetUnc, proj, 'dir');
  try {
    PROJECTS = [{ id: 'p-own-share2', name: 'Own share', folder: proj, agents: [WHO] }];
    refusedUnresolved(path.join(proj, 'elsewhere', 'f.txt'), replyfile.ON_NETWORK, 'a link on the share to another server');
    // CONTROL: the project's own file, beside that link, still attaches
    const r = replyfile.attach(WHO, path.join(proj, 'f.txt'), { platform: 'win32' });
    assert.equal(r.ok, true, JSON.stringify(r));
    replyfile.discard(r.rec);
  } finally { fs.rmSync(proj, { force: true }); fs.rmSync(path.join(target, 'elsewhere'), { force: true }); }
});

test('#7221 review 12-2: another agent\'s project written in a pipe namespace does not make this agent\'s project files refuse', winOnly, () => {
  const proj = path.join(SANDBOX, 'mine-beside-pipe');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'notes.txt'), 'mine\n');
  PROJECTS = [
    { id: 'p-pipe', name: 'Pipe', folder: '\\\\.\\pipe\\kosmos-7221', agents: ['someone-else'] },
    { id: 'p-mine-pipe', name: 'Mine', folder: proj, agents: [WHO] },
  ];
  const r = replyfile.attach(WHO, path.join(proj, 'notes.txt'), { platform: 'win32' });
  assert.equal(r.ok, true, JSON.stringify(r));
  replyfile.discard(r.rec);
});

test('#7221 review 12 NIT: the agent\'s own project written \\\\?\\UNC\\host\\share attaches a file named by its plain share path', winOnly, (t) => {
  const proj = path.join(SANDBOX, 'uncproj-long');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'f.txt'), 'on the share project\n');
  const projUnc = adminShareOf(proj);
  if (!projUnc) { setupSkip(t, 'this machine\'s admin share is not reachable'); return; }
  PROJECTS = [{ id: 'p-unc-long', name: 'Unc long', folder: '\\\\?\\UNC\\' + projUnc.slice(2), agents: [WHO] }];
  const r = replyfile.attach(WHO, path.join(projUnc, 'f.txt'), { platform: 'win32' });
  assert.equal(r.ok, true, 'attaches as on main: ' + JSON.stringify(r));
  replyfile.discard(r.rec);
});

/* ---------- review 13 ---------- */

test('#7221 review 13-1: another agent\'s project folder behind more links than the walk follows is never resolved', linkOnly, () => {
  /* A chain of 34 directory links ending at an unroutable share: Windows would follow it (up to 63), the walk gives
     up at 32, and that folder must be left unresolved, not handed to folderState's realpath. */
  const chain = path.join(SANDBOX, 'longchain');
  fs.mkdirSync(chain, { recursive: true });
  let prev = '\\\\10.255.255.1\\share\\proj';
  for (let i = 0; i < 34; i++) {
    const link = path.join(chain, 'l' + i);
    fs.symlinkSync(prev, link, 'dir');
    prev = link;
  }
  const proj = path.join(SANDBOX, 'mine-beside-chain');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'notes.txt'), 'mine\n');
  PROJECTS = [
    { id: 'p-chain', name: 'Chain', folder: prev, agents: ['someone-else'] },
    { id: 'p-mine-chain', name: 'Mine', folder: proj, agents: [WHO] },
  ];
  const resolved = [];
  projects.folderState = (folder) => { resolved.push(folder); return realFolderState(folder); };
  const started = Date.now();
  try {
    const r = replyfile.attach(WHO, path.join(proj, 'notes.txt'), { platform: 'win32' });
    assert.equal(r.ok, true, JSON.stringify(r));
    replyfile.discard(r.rec);
    assert.deepEqual(resolved, [proj], 'the long chain was not resolved');
    assert.ok(Date.now() - started < SOON_MS, 'no network attempt on the way');
  } finally { fs.rmSync(chain, { recursive: true, force: true }); }
});

/* ---------- review 14 ---------- */

test('#7221 review 14-1: a link in Files to the share redirector through \\??\\Global\\UNC is refused unresolved as a network path', linkOnly, () => {
  const globalUnc = '\\\\?\\Global\\UNC\\10.255.255.1\\share\\proj';   // read back as \??\Global\UNC\...
  // in Files: refused before anything is resolved, as a network path
  const link = path.join(FILES, 'global-unc.txt');
  fs.symlinkSync(globalUnc + '\\f.txt', link, 'file');
  try { refusedUnresolved(link, replyfile.ON_NETWORK, 'a \\??\\Global\\UNC link'); } finally { fs.rmSync(link, { force: true }); }
});

test('#7221 review 14-1: another agent\'s project folder linked through \\??\\Global\\UNC is never resolved', linkOnly, () => {
  const globalUnc = '\\\\?\\Global\\UNC\\10.255.255.1\\share\\proj';
  const theirs = path.join(SANDBOX, 'global-unc-project');
  fs.symlinkSync(globalUnc, theirs, 'dir');
  const mine = path.join(SANDBOX, 'mine-beside-global');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'notes.txt'), 'mine\n');
  PROJECTS = [
    { id: 'p-global', name: 'Global', folder: theirs, agents: ['someone-else'] },
    { id: 'p-mine-global', name: 'Mine', folder: mine, agents: [WHO] },
  ];
  const resolved = [];
  projects.folderState = (folder) => { resolved.push(folder); return realFolderState(folder); };
  const started = Date.now();
  try {
    const r = replyfile.attach(WHO, path.join(mine, 'notes.txt'), { platform: 'win32' });
    assert.equal(r.ok, true, JSON.stringify(r));
    replyfile.discard(r.rec);
    assert.deepEqual(resolved, [mine], 'the Global\\UNC project folder was not resolved');
    assert.ok(Date.now() - started < SOON_MS, 'no network attempt on the way');
  } finally { fs.rmSync(theirs, { force: true }); }
});

/* ---------- review 15 ---------- */

test('#7221 review 15-1: another agent\'s project folder that is a junction aimed at a share is never resolved', winOnly, () => {
  const theirs = path.join(SANDBOX, 'their-dead-junction');
  fs.symlinkSync('\\\\10.255.255.1\\share', theirs, 'junction');
  const mine = path.join(SANDBOX, 'mine-beside-junction');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'notes.txt'), 'mine\n');
  PROJECTS = [
    { id: 'p-dead-junction', name: 'Dead junction', folder: theirs, agents: ['someone-else'] },
    { id: 'p-mine-junction', name: 'Mine', folder: mine, agents: [WHO] },
  ];
  const resolved = [];
  projects.folderState = (folder) => { resolved.push(folder); return realFolderState(folder); };
  const started = Date.now();
  try {
    const r = replyfile.attach(WHO, path.join(mine, 'notes.txt'), { platform: 'win32' });
    assert.equal(r.ok, true, JSON.stringify(r));
    replyfile.discard(r.rec);
    assert.deepEqual(resolved, [mine], 'the junction aimed at a share was not resolved');
    assert.ok(Date.now() - started < SOON_MS, 'no network attempt on the way');
  } finally { fs.rmSync(theirs, { recursive: true, force: true }); }
});

/* ---------- review 16 ---------- */

test('#7221 review 16-1: a nested project of another agent that is a local link into this agent\'s share project keeps its files', linkOnly, (t) => {
  /* The repro from review 16: this agent's project is a share (here the box's own admin share); another agent's
     nested project is a LOCAL link into that share. Skipped as "leads to a share", it was judged by its local spelling,
     which says nothing about where it leads, and its file attached. Now it is judged by the share it leads to. */
  const outer = path.join(SANDBOX, 's16outer');
  const nested = path.join(outer, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'secret.txt'), 'theirs\n');
  fs.writeFileSync(path.join(outer, 'mine.txt'), 'mine\n');
  const outerUnc = adminShareOf(outer);
  if (!outerUnc) { setupSkip(t, 'this machine\'s admin share is not reachable'); return; }
  const theirLink = path.join(SANDBOX, 's16-their-link');
  fs.symlinkSync(path.join(outerUnc, 'nested'), theirLink, 'dir');
  try {
    PROJECTS = [
      { id: 'p-s16-outer', name: 'Outer', folder: outerUnc, agents: [WHO] },
      { id: 'p-s16-nested', name: 'Nested', folder: theirLink, agents: ['someone-else'] },
    ];
    const r = replyfile.attach(WHO, path.join(outerUnc, 'nested', 'secret.txt'), { platform: 'win32' });
    assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], 'refused, as main refused it: ' + JSON.stringify(r));
    // CONTROL: this agent's own file in the share project still attaches
    const ok = replyfile.attach(WHO, path.join(outerUnc, 'mine.txt'), { platform: 'win32' });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    replyfile.discard(ok.rec);
  } finally { fs.rmSync(theirLink, { force: true }); }
});

test('#7221 review 16: another agent\'s folder behind more links than Windows follows is never resolved and does not block this agent', linkOnly, () => {
  const chain = path.join(SANDBOX, 'verylongchain');
  fs.mkdirSync(chain, { recursive: true });
  let prev = '\\\\10.255.255.1\\share\\proj';
  for (let i = 0; i < 70; i++) {
    const link = path.join(chain, 'l' + i);
    fs.symlinkSync(prev, link, 'dir');
    prev = link;
  }
  const mine = path.join(SANDBOX, 'mine-beside-verylong');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'notes.txt'), 'mine\n');
  PROJECTS = [
    { id: 'p-verylong', name: 'Very long', folder: prev, agents: ['someone-else'] },
    { id: 'p-mine-verylong', name: 'Mine', folder: mine, agents: [WHO] },
  ];
  const resolved = [];
  projects.folderState = (folder) => { resolved.push(folder); return realFolderState(folder); };
  const started = Date.now();
  try {
    const r = replyfile.attach(WHO, path.join(mine, 'notes.txt'), { platform: 'win32' });
    assert.equal(r.ok, true, JSON.stringify(r));
    replyfile.discard(r.rec);
    assert.deepEqual(resolved, [mine], 'the 70-link chain was not resolved');
    assert.ok(Date.now() - started < SOON_MS, 'no network attempt on the way');
  } finally { fs.rmSync(chain, { recursive: true, force: true }); }
});

/* ---------- review 17 ---------- */

test('#7221 review 17-1: a connected agent whose Files folder is on a share attaches a file from it, as on main', winOnly, (t) => {
  const cfiles = path.join(SANDBOX, 'connected', 'Files');
  fs.mkdirSync(cfiles, { recursive: true });
  fs.writeFileSync(path.join(cfiles, 'r.txt'), 'from a Files folder on a share\n');
  const cfilesUnc = adminShareOf(cfiles);
  if (!cfilesUnc) { setupSkip(t, 'this machine\'s admin share is not reachable'); return; }
  const realFiles = dmfiles.filesDir;
  dmfiles.filesDir = (name) => (name === WHO ? cfilesUnc : null);
  try {
    const r = replyfile.attach(WHO, path.join(cfilesUnc, 'r.txt'), { platform: 'win32' });
    assert.equal(r.ok, true, 'attaches as on main: ' + JSON.stringify(r));
    replyfile.discard(r.rec);
    // CONTROL: another share path, outside the Files folder, is still refused before it is resolved
    refusedUnresolved(path.join(adminShareOf(SANDBOX), 'connected', 'r.txt'), replyfile.ON_NETWORK, 'a share path beside Files');
  } finally { dmfiles.filesDir = realFiles; }
});

/* ---------- review 19 ---------- */

test('#7221 review 19-2: the NT \\??\\ spellings of a share are network spellings; a local drive or volume in that form is not', () => {
  assert.equal(winpath.isNetworkSpelling('\\??\\UNC\\host\\share\\x'), true);
  assert.equal(winpath.isNetworkSpelling('\\??\\GLOBALROOT\\Device\\Mup\\host\\share'), true);
  assert.equal(winpath.isNetworkSpelling('\\??\\GLOBALROOT\\Device\\LanmanRedirector\\host\\share'), true);
  assert.equal(winpath.isNetworkSpelling('\\??\\C:\\x'), false, 'a local drive in the NT spelling');
  assert.equal(winpath.isNetworkSpelling('\\??\\Volume{8567e582-9e23-4c72-a97e-1fbdfc2f255f}\\x'), false, 'a local volume in the NT spelling');
  assert.equal(winpath.isNetworkSpelling('C:\\x'), false);
  assert.equal(winpath.mayHold('\\??\\GLOBALROOT\\GLOBAL??\\C:\\work', 'C:\\work\\f.txt', 'C:\\work\\f.txt'), true, 'the object manager root, NT spelling');
});

test('#7221 review 19-2: another agent\'s project folder written \\??\\UNC\\... is never resolved', winOnly, () => {
  const mine = path.join(SANDBOX, 'mine-beside-ntunc');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'notes.txt'), 'mine\n');
  const ntUnc = '\\??\\UNC\\10.255.255.1\\share\\proj';
  PROJECTS = [
    { id: 'p-ntunc', name: 'NT UNC', folder: ntUnc, agents: ['someone-else'] },
    { id: 'p-mine-ntunc', name: 'Mine', folder: mine, agents: [WHO] },
  ];
  const resolved = [];
  projects.folderState = (folder) => { resolved.push(folder); return realFolderState(folder); };
  const started = Date.now();
  const r = replyfile.attach(WHO, path.join(mine, 'notes.txt'), { platform: 'win32' });
  assert.equal(r.ok, true, JSON.stringify(r));
  replyfile.discard(r.rec);
  assert.deepEqual(resolved, [mine], 'the \\??\\UNC folder was not resolved');
  assert.ok(Date.now() - started < SOON_MS, 'no network attempt on the way');
});

test('#7221 review 19-1: another agent\'s folder written as a local volume, with a link below it to a share, is never resolved', linkOnly, (t) => {
  const { execFileSync } = require('node:child_process');
  let volume = null;
  try { volume = (/\\\\\?\\Volume\{[0-9a-f-]+\}\\/i.exec(execFileSync('mountvol', [path.parse(SANDBOX).root.slice(0, 2), '/L'], { encoding: 'utf8' })) || [null])[0]; } catch { volume = null; }
  if (!volume) { setupSkip(t, 'mountvol gave no volume name here'); return; }
  const under = path.join(SANDBOX, 'vol-under');
  fs.mkdirSync(under, { recursive: true });
  fs.symlinkSync('\\\\10.255.255.1\\share\\proj', path.join(under, 'lnk'), 'dir');
  const mine = path.join(SANDBOX, 'mine-beside-vol');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'notes.txt'), 'mine\n');
  const theirs = volume + path.join(under, 'lnk').slice(3);
  PROJECTS = [
    { id: 'p-vol-link', name: 'Volume link', folder: theirs, agents: ['someone-else'] },
    { id: 'p-mine-vol', name: 'Mine', folder: mine, agents: [WHO] },
  ];
  const resolved = [];
  projects.folderState = (folder) => { resolved.push(folder); return realFolderState(folder); };
  const started = Date.now();
  try {
    const r = replyfile.attach(WHO, path.join(mine, 'notes.txt'), { platform: 'win32' });
    assert.equal(r.ok, true, JSON.stringify(r));
    replyfile.discard(r.rec);
    assert.deepEqual(resolved, [mine], 'the volume folder whose link leads to a share was not resolved');
    assert.ok(Date.now() - started < SOON_MS, 'no network attempt on the way');
  } finally { fs.rmSync(path.join(under, 'lnk'), { force: true }); }
});

/* ---------- review 21 ---------- */

test('#7221 review 21-2: readOwn walks the links again before it resolves the given path a second time', () => {
  /* A recheck that refuses (as the walk does when a link has been swapped onto a share since the first one) stops the
     read before that second realpath: no resolution is attempted, and the read says the file changed. */
  const dir = path.join(SANDBOX, 'readown-recheck');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
  /* As attach passes it: the path its own realpath gives, long names and all (a temp folder may be written with 8.3
     short names, which realpath would not give back). */
  const file = fs.realpathSync.native(path.join(dir, 'f.txt'));
  counting();
  let rechecked = 0;
  const out = fs.openSync(path.join(dir, 'out.bin'), 'w');
  let got;
  try { got = replyfile.readOwn(file, fs.statSync(file, { bigint: true }), file, out, { recheck: () => { rechecked++; return replyfile.ON_NETWORK; } }); }
  finally { fs.closeSync(out); replyfile.setRealpathForTests(null); }
  assert.equal(rechecked, 1);
  assert.equal(got.ok, false);
  assert.equal(realpathCalls, 0, 'the second realpath was not reached');
  // CONTROL: a recheck that passes lets the read go on
  const out2 = fs.openSync(path.join(dir, 'out2.bin'), 'w');
  try { got = replyfile.readOwn(file, fs.statSync(file, { bigint: true }), file, out2, { recheck: () => null }); } finally { fs.closeSync(out2); }
  assert.deepEqual(got, { ok: true, size: 1 });
});

test('#7221 review 21 NIT: an NT \\??\\UNC\\ path given to attach is refused as a network path; it is not a plain share', () => {
  const roots = { drives: new Set(['C']), folders: ['\\\\host\\share\\proj'], projectFolders: ['\\\\host\\share\\proj'], filesFolder: null };
  assert.equal(replyfile.winSpellingRefusalForTests('\\??\\UNC\\host\\share\\proj\\f.txt', roots), replyfile.ON_NETWORK);
  assert.equal(winpath.isPlainShare('\\??\\UNC\\host\\share\\x'), false);
  assert.equal(winpath.isPlainShare('\\\\host\\share\\x'), true);
});

/* ---------- review 22 ---------- */

test('#7221 review 22-1: the object manager\'s DosDevices aliases of a drive are drive paths; of UNC, shares', () => {
  assert.equal(winpath.followableLinkTarget('\\??\\Global\\C:\\data'), 'C:\\data');
  assert.equal(winpath.followableLinkTarget('\\??\\GLOBALROOT\\GLOBAL??\\D:\\x'), 'D:\\x');
  assert.equal(winpath.followableLinkTarget('\\\\?\\Global\\C:\\data'), 'C:\\data');
  assert.equal(winpath.asDrivePath('\\\\?\\GLOBALROOT\\??\\E:\\x'), 'E:\\x');
  assert.equal(winpath.shareOf('\\??\\Global\\UNC\\Host\\Share\\x'), 'host\\share');
  assert.equal(winpath.shareOf('\\\\?\\GLOBALROOT\\GLOBAL??\\UNC\\host\\share'), 'host\\share');
  assert.equal(winpath.followableLinkTarget('\\??\\GLOBALROOT\\Weird\\x'), null, 'any other object manager path is not followed');
});

test('#7221 review 22-1: a nested project of another agent linked through \\??\\Global\\C:\\ keeps its files from the outer project', linkOnly, () => {
  const outer = path.join(SANDBOX, 'gouter');
  const data = path.join(outer, 'deep', 'secret');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'f.txt'), 'theirs\n');
  const nested = path.join(SANDBOX, 'g-their-link');
  fs.symlinkSync('\\\\?\\Global\\' + data, nested, 'dir');
  try {
    PROJECTS = [
      { id: 'p-gouter', name: 'Outer', folder: outer, agents: [WHO] },
      { id: 'p-gnested', name: 'Nested', folder: nested, agents: ['someone-else'] },
    ];
    const r = replyfile.attach(WHO, path.join(data, 'f.txt'), { platform: 'win32' });
    assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], 'refused, as main refused it: ' + JSON.stringify(r));
  } finally { fs.rmSync(nested, { force: true }); }
});

/* ---------- review 23 ---------- */

test('#7221 review 23-1: "holds no files" is an allow-list; any other unplaceable namespace may hold, and chained aliases are drive paths', () => {
  for (const p of ['\\\\.\\pipe\\x', '\\\\.\\mailslot\\m', '\\\\.\\COM1', '\\\\.\\LPT2\\', '\\\\.\\NUL', '\\??\\pipe\\x']) {
    assert.equal(winpath.isNoFileNamespace(p), true, p + ' holds no files');
  }
  for (const p of ['\\\\?\\Global\\Global\\C:\\work', '\\\\?\\GLOBALROOT\\Device\\Something', '\\\\.\\Weird\\x', '\\\\?\\Global\\GLOBALROOT\\x']) {
    assert.equal(winpath.isNoFileNamespace(p), false, p + ' is not known to hold nothing');
  }
  assert.equal(winpath.asDrivePath('\\\\?\\Global\\Global\\C:\\work\\nested'), 'C:\\work\\nested', 'a chained alias reads as the drive path');
  assert.equal(winpath.mayHold('\\\\?\\Global\\Global\\Global\\C:\\work\\nested', 'C:\\work\\nested\\x', 'C:\\work\\nested\\x'), true);
  assert.equal(winpath.mayHold('\\\\.\\Weird\\x', 'C:\\work\\f.txt', 'C:\\work\\f.txt'), true, 'an unplaceable namespace may hold');
  assert.equal(winpath.mayHold('\\\\.\\pipe\\x', 'C:\\work\\f.txt', 'C:\\work\\f.txt'), false, 'a pipe holds nothing');
});

test('#7221 review 23-1: a nested project of another agent written with a chained alias keeps its files from the outer project', winOnly, () => {
  const outer = path.join(SANDBOX, 'chouter');
  const nested = path.join(outer, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'secret.txt'), 'theirs\n');
  PROJECTS = [
    { id: 'p-chouter', name: 'Outer', folder: outer, agents: [WHO] },
    { id: 'p-chnested', name: 'Nested', folder: '\\\\?\\Global\\Global\\' + nested, agents: ['someone-else'] },
  ];
  const r = replyfile.attach(WHO, path.join(nested, 'secret.txt'), { platform: 'win32' });
  assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], 'refused, as main refused it: ' + JSON.stringify(r));
});

/* ---------- review 26 ---------- */

test('#7221 review 26-1: another agent\'s folder that leads somewhere unplaceable refuses project files with its own sentence; Files still attach', linkOnly, () => {
  /* Fail closed, as review 22 decided: a destination that cannot be placed may hold any file. But the agent is told
     why, not that its own file is outside its projects, so the row can be found and fixed. */
  const mine = path.join(SANDBOX, 'mine-beside-unplaced');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'notes.txt'), 'mine\n');
  const theirs = path.join(SANDBOX, 'their-unplaced-link');
  fs.symlinkSync('\\\\?\\GLOBALROOT\\Device\\NoSuchDevice7221\\x', theirs, 'dir');
  try {
    PROJECTS = [
      { id: 'p-mine-unplaced', name: 'Mine', folder: mine, agents: [WHO] },
      { id: 'p-their-unplaced', name: 'Theirs', folder: theirs, agents: ['someone-else'] },
    ];
    const r = replyfile.attach(WHO, path.join(mine, 'notes.txt'), { platform: 'win32' });
    assert.deepEqual([r.ok, r.because], [false, replyfile.OTHER_FOLDER_UNPLACED], JSON.stringify(r));
    // CONTROL: a file directly in the agent's Files folder still attaches
    fs.writeFileSync(path.join(FILES, 'unplaced-control.txt'), 'files\n');
    const ok = replyfile.attach(WHO, path.join(FILES, 'unplaced-control.txt'), { platform: 'win32' });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    replyfile.discard(ok.rec);
    // CONTROL: with that row gone, the same project file attaches
    PROJECTS = [{ id: 'p-mine-unplaced', name: 'Mine', folder: mine, agents: [WHO] }];
    const back = replyfile.attach(WHO, path.join(mine, 'notes.txt'), { platform: 'win32' });
    assert.equal(back.ok, true, JSON.stringify(back));
    replyfile.discard(back.rec);
  } finally { fs.rmSync(theirs, { force: true }); }
});

/* ---------- review 27 ---------- */

test('#7221 review 27-1: a Volume Shadow Copy is a local volume, so another agent\'s folder on one does not refuse every project file', () => {
  const shadow = '\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy1\\x';
  assert.equal(winpath.isLocalVolumeSpelling(shadow), true);
  assert.equal(winpath.isLocalVolumeSpelling('\\??\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy12\\x'), true);
  assert.equal(winpath.isNetworkSpelling(shadow), false, 'local, not a network path');
  // CONTROLS: any other device under GLOBALROOT stays unplaced
  assert.equal(winpath.isLocalVolumeSpelling('\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy\\x'), false, 'no number, no volume');
  assert.equal(winpath.isLocalVolumeSpelling('\\\\?\\GLOBALROOT\\Device\\SomethingElse1\\x'), false);
});

/* ---------- #7250 ---------- */

test('#7250: a Files folder that is ITSELF a link to a share is refused without a realpath contact (reviews 25, 26, 28)', linkOnly, () => {
  /* winLinkRefusal followed a drive-written link onto a share whenever the link was ANY of the agent's folders, the
     Files folder included; realOf then contacted the share before filesRoot refused the linked Files folder. A
     share-backed PROJECT is the person's own choice, but the Files folder is one Kosmos always makes as a real folder,
     so a Files folder that is a link to a share is never legitimate. ownShareProject now gates on projectFolders, so
     this is refused by spelling, unresolved. Before #7250 the walk followed onto the unroutable share and contacted
     it, so this arm failed one of its assertions (the ON_NETWORK sentence, the zero-realpath count, or the timing)
     instead of the clean unresolved refusal. The positive counterpart is the review 11-2 arm above (a drive-written
     PROJECT folder that is a link to a share still attaches, because projectFolders still includes it): together they
     pin that the narrowing refuses only the Files link, not a legitimate project link. */
  const filesLink = path.join(SANDBOX, 'files-as-share-link');
  fs.symlinkSync('\\\\10.255.255.1\\share', filesLink, 'dir');
  const filesDirOverride = dmfiles.filesDir;
  dmfiles.filesDir = (name) => (name === WHO ? filesLink : null);
  try {
    refusedUnresolved(path.join(filesLink, 'f.txt'), replyfile.ON_NETWORK, 'the Files folder is a link to a share');
  } finally {
    dmfiles.filesDir = filesDirOverride;
    fs.rmSync(filesLink, { force: true });
  }
});

/* ---------- #7232: the drive table (engine/windrives.js) ---------- */

/* Z: is a mapped drive of another computer, \\10.255.255.1\zshare, in a drive table the test fixes
   (windrives.setTableForTests). The disk is stood in for by wrapping fs (and projects.folderState): every Z:\ path and
   every path on that share is counted, and is either refused at once as a dead server would after its stall
   ("touched"; with stallMs, after busy-waiting that long, so a regression is slow as well as counted), or, for a live
   server, served from a sandbox folder, with real paths read back on the share as Windows reads a mapped drive. Each
   arm's control is that, without #7232, Z: is touched (and, for the scale arm, the attach then takes the stall). */
const windrives = require('./windrives');
const store = require('./store');
const ZSHARE = '\\\\10.255.255.1\\zshare';
const HERE = WIN ? winpath.driveOf(SANDBOX) : 'C';
const zTable = (z) => ({ [HERE]: { kind: 'local', share: null }, ...(z ? { Z: z } : {}) });
const Z_REMOTE = { kind: 'remote', share: ZSHARE };
const DSHARE = '\\\\10.255.255.1\\data';
const isDshare = (s) => s.toLowerCase() === DSHARE.toLowerCase() || s.toLowerCase().startsWith(DSHARE.toLowerCase() + '\\');
let zWorld = null;
function zMap(p) {
  if (!zWorld || (typeof p !== 'string' && !(p instanceof Buffer))) return null;
  const s = String(p);
  let rest = null;
  /* A local folder that is a link onto the dead Z: (review 3 finding 3): anything read BELOW it follows the link. */
  if (zWorld.deadUnder && s.toLowerCase().startsWith(zWorld.deadUnder)) {
    zWorld.touches.z++;
    throw Object.assign(new Error('touched through a link ' + s), { code: 'EHOSTUNREACH' });
  }
  if (/^(?:\\\\\?\\)?[Zz]:/.test(s)) { zWorld.touches.z++; rest = s.replace(/^(?:\\\\\?\\)?[Zz]:/, ''); }
  else if (s.toLowerCase().startsWith(ZSHARE.toLowerCase())) { zWorld.touches.share++; rest = s.slice(ZSHARE.length); }
  else if (isDshare(s)) {
    /* Review 2 finding 1: a second share of the same server, \\10.255.255.1\data, whose \team folder IS zshare's root
       (one server folder reached through two shares). Its other folders are a sandbox folder of their own. */
    zWorld.touches.share++;
    const below = s.slice(DSHARE.length);
    if (/^\\team(?:\\|$)/i.test(below)) rest = below.slice('\\team'.length);
    else return path.join(path.dirname(zWorld.backing), 'ddata', below || '\\');
  }
  else return null;
  if (!zWorld.alive) {
    const until = Date.now() + zWorld.stallMs;
    while (Date.now() < until) { /* a dead server's stall */ }
    throw Object.assign(new Error('touched ' + s), { code: 'EHOSTUNREACH' });
  }
  return path.join(zWorld.backing, rest || '\\');
}
function zWorldOn({ alive = false, stallMs = 0, deadUnder = null } = {}) {
  const backing = path.join(SANDBOX, 'zbacking');
  fs.mkdirSync(backing, { recursive: true });
  zWorld = { alive, stallMs, touches: { z: 0, share: 0 }, calls: 0, backing: fs.realpathSync.native(backing), deadUnder: deadUnder ? deadUnder.toLowerCase() + '\\' : null };
  const saved = {};
  for (const name of ['lstatSync', 'statSync', 'readlinkSync', 'readdirSync', 'openSync', 'accessSync']) {
    saved[name] = fs[name];
    fs[name] = function (p, ...rest) { zWorld.calls++; const m = zMap(p); return saved[name].call(fs, m === null ? p : m, ...rest); };
  }
  const realNative = fs.realpathSync.native;
  const toShare = (r) => (r.toLowerCase().startsWith(zWorld.backing.toLowerCase()) ? ZSHARE + r.slice(zWorld.backing.length) : r);
  fs.realpathSync.native = (p, ...rest) => {
    zWorld.calls++;
    const m = zMap(p);
    if (m === null) return realNative(p, ...rest);
    const r = realNative(m, ...rest);
    // a path on the data share resolves on the server, so it reads back as written there (one level of names only)
    return isDshare(String(p)) ? path.win32.normalize(String(p)).replace(/\\$/, '') : toShare(r);
  };
  const folderState = projects.folderState;
  projects.folderState = (folder) => (zMap(folder) === null ? folderState(folder) : { real: fs.realpathSync.native(folder) });
  return () => {
    for (const name of Object.keys(saved)) fs[name] = saved[name];
    fs.realpathSync.native = realNative;
    projects.folderState = folderState;
    zWorld = null;
  };
}
test.afterEach(() => { if (WIN) windrives.setTableForTests(null); });

/* A project of WHO's with one file, on this computer. */
function ownProject(name) {
  const dir = path.join(SANDBOX, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a project file\n');
  return dir;
}
function attachIn(world, p, roster) {
  const off = zWorldOn(world);
  const t = process.hrtime.bigint();
  let r;
  let touches;
  let calls;
  try { r = replyfile.attach(WHO, p, { platform: 'win32', roster }); } finally { touches = zWorld.touches; calls = zWorld.calls; off(); }
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  if (r && r.ok) replyfile.discard(r.rec);
  return { r, touches, calls, ms };
}

test('#7232: the drive table is read from numbers and paths; a network drive the redirector did not name has no share', () => {
  const t = windrives.parseForTests('C\t3\t\r\nZ\t4\t\\\\srv\\s\r\nY\t4\t\r\nQ\t1\t\r\nR\t5\t\r\n');
  assert.deepEqual(t.get('C'), { kind: 'local', share: null });
  assert.deepEqual(t.get('Z'), { kind: 'remote', share: '\\\\srv\\s' });
  assert.deepEqual(t.get('Y'), { kind: 'remote', share: null }, 'EnumNetworkDrives omitted it: no share, so callers fail closed');
  assert.deepEqual(t.get('Q'), { kind: 'absent', share: null });
  assert.deepEqual(t.get('R'), { kind: 'local', share: null }, 'a CD drive is on this computer');
  assert.equal(windrives.parseForTests(''), null, 'nothing read: unknown, never an empty table');
});

test('#7232: a share whose server may be this computer is never "another computer"', () => {
  for (const h of ['localhost', 'LOCALHOST', 'localhost.localdomain', '127.0.0.1', '127.0.0.2', '127.1', '2130706433', '0177.0.0.1', '0x7f.1',
    '0.0.0.0', '::1', '[::1]', '0--1.ipv6-literal.net', '::ffff:127.0.0.1', os.hostname(), os.hostname().toUpperCase(), os.hostname() + '.corp.example',
    'localhost@SSL@8443', '']) {
    assert.equal(windrives.isThisComputer(h), true, h + ' may be this computer');
  }
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) assert.equal(windrives.isThisComputer(a.address), true, a.address + ' is one of this computer\'s addresses');
  // CONTROL: another computer is another computer
  for (const h of ['10.255.255.1', 'fileserver', 'nas.corp.example', '[2001:db8::7]']) assert.equal(windrives.isThisComputer(h), false, h);
  assert.equal(windrives.hostOf('\\\\srv\\s\\x'), 'srv');
});

test('#7232 B1: another agent\'s project on a dead mapped drive is never touched; a local project file attaches', winOnly, () => {
  const own = ownProject('own7232-b1');
  PROJECTS = [
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
    { id: 'p-z', name: 'Far', folder: 'Z:\\far', agents: ['someone-else'] },
  ];
  windrives.setTableForTests(zTable(Z_REMOTE));
  const { r, touches } = attachIn({}, path.join(own, 'f.txt'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(touches.z + touches.share, 0, 'nothing on Z: or its share was touched');
  // the long spelling of the same folder is the same drive
  PROJECTS[1].folder = '\\\\?\\Z:\\far';
  const again = attachIn({}, path.join(own, 'f.txt'));
  assert.equal(again.r.ok, true, JSON.stringify(again.r));
  assert.equal(again.touches.z, 0);
});

test('#7232 B1: a mapped drive whose share the redirector did not name fails closed (OTHER_FOLDER_UNPLACED), untouched', winOnly, () => {
  const own = ownProject('own7232-unplaced');
  PROJECTS = [
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
    { id: 'p-z', name: 'Far', folder: 'Z:\\far', agents: ['someone-else'] },
  ];
  windrives.setTableForTests(zTable({ kind: 'remote', share: null }));
  const { r, touches } = attachIn({}, path.join(own, 'f.txt'));
  assert.deepEqual([r.ok, r.because], [false, replyfile.OTHER_FOLDER_UNPLACED], JSON.stringify(r));
  assert.equal(touches.z, 0);
});

test('#7232 B1: a link in another agent\'s folder onto a dead mapped drive is not followed', linkOnly, () => {
  const own = ownProject('own7232-link');
  const theirs = path.join(SANDBOX, 'theirs7232');
  fs.mkdirSync(theirs, { recursive: true });
  const link = path.join(theirs, 'onz');
  fs.symlinkSync('Z:\\deep', link, 'dir');
  PROJECTS = [
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
    { id: 'p-t', name: 'Theirs', folder: link, agents: ['someone-else'] },
  ];
  windrives.setTableForTests(zTable(Z_REMOTE));
  try {
    const { r, touches } = attachIn({}, path.join(own, 'f.txt'));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(touches.z, 0, 'the link onto Z: was not followed');
  } finally { fs.rmSync(link, { force: true }); }
});

test('#7232 B1: a mapped drive whose server is THIS computer, under any name, is walked and resolved as before', winOnly, () => {
  const own = ownProject('own7232-loop');
  PROJECTS = [
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
    { id: 'p-z', name: 'Near', folder: 'Z:\\near', agents: ['someone-else'] },
  ];
  for (const share of ['\\\\127.0.0.2\\c$', '\\\\localhost\\c$', '\\\\[::1]\\c$', '\\\\0--1.ipv6-literal.net\\c$', '\\\\' + os.hostname() + '\\x', '\\\\' + os.hostname() + '.corp.example\\x']) {
    windrives.setTableForTests(zTable({ kind: 'remote', share }));
    const { r, touches } = attachIn({ alive: true }, path.join(own, 'f.txt'));
    assert.equal(r.ok, true, share + ': ' + JSON.stringify(r));
    assert.ok(touches.z > 0, share + ': a folder on this computer behind a share is resolved, as before');
  }
});

test('#7232: with the drive table unknown, every folder is walked and resolved exactly as before', winOnly, () => {
  const own = ownProject('own7232-unknown');
  store.writeProfile('zagent', { dir: 'Z:\\agentdir' });
  PROJECTS = [
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
    { id: 'p-z', name: 'Far', folder: 'Z:\\far', agents: ['someone-else'] },
  ];
  windrives.setTableForTests(false);
  const { r, touches } = attachIn({ alive: true }, path.join(own, 'f.txt'), [{ sessionName: 'zagent' }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(touches.z >= 2, 'the other agent\'s Z: folder and the agent folder on Z: were both read, as before: ' + touches.z);
});

test('#7232 B1: a file on the mapped drive\'s share, inside another agent\'s folder there, is refused', winOnly, () => {
  const backing = path.join(SANDBOX, 'zbacking');
  fs.mkdirSync(path.join(backing, 'other'), { recursive: true });
  fs.mkdirSync(path.join(backing, 'mine'), { recursive: true });
  fs.writeFileSync(path.join(backing, 'other', 'f.txt'), 'theirs\n');
  fs.writeFileSync(path.join(backing, 'mine', 'f.txt'), 'mine\n');
  PROJECTS = [
    { id: 'p-share', name: 'Whole share', folder: ZSHARE, agents: [WHO] },
    { id: 'p-z', name: 'Theirs', folder: 'Z:\\other', agents: ['someone-else'] },
  ];
  windrives.setTableForTests(zTable(Z_REMOTE));
  const { r } = attachIn({ alive: true }, ZSHARE + '\\other\\f.txt');
  assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], JSON.stringify(r));
  // CONTROL: beside it, on the same share, the agent's own file attaches
  const mine = attachIn({ alive: true }, ZSHARE + '\\mine\\f.txt');
  assert.equal(mine.r.ok, true, JSON.stringify(mine.r));
});

test('#7232 review 1-4: another agent\'s folder on a letter the table calls absent is still resolved, and keeps its files', winOnly, () => {
  /* The table is a minute old: Z: was made since (subst), so the drive table says absent while Z:\secret is the folder
     C:\...\zbacking\secret. Skipped as absent, the nested project stopped protecting its files. */
  const backing = path.join(SANDBOX, 'zbacking');
  fs.mkdirSync(path.join(backing, 'secret'), { recursive: true });
  fs.writeFileSync(path.join(backing, 'secret', 'x.txt'), 'not for the outer project\n');
  PROJECTS = [
    { id: 'p-own', name: 'Outer', folder: fs.realpathSync.native(backing), agents: [WHO] },
    { id: 'p-z', name: 'Secret', folder: 'Z:\\secret', agents: ['someone-else'] },
  ];
  windrives.setTableForTests(zTable(null));
  const { r, touches } = attachIn({ alive: true }, path.join(fs.realpathSync.native(backing), 'secret', 'x.txt'));
  assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], JSON.stringify(r));
  assert.ok(touches.z > 0, 'the folder on Z: was resolved, as before #7232');
});

test('#7232 B3: a file in no project of the agent\'s touches no other agent\'s folder', winOnly, () => {
  const own = ownProject('own7232-b3');
  const theirs = path.join(SANDBOX, 'theirs7232-b3');
  fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(path.join(theirs, 'f.txt'), 'theirs\n');
  PROJECTS = [
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
    { id: 'p-t', name: 'Theirs', folder: theirs, agents: ['someone-else'] },
  ];
  windrives.setTableForTests(zTable(Z_REMOTE));
  const resolved = [];
  const realFS = projects.folderState;
  projects.folderState = (folder) => { resolved.push(folder); return realFS(folder); };
  const realLstat = fs.lstatSync;
  const lstatted = [];
  fs.lstatSync = (p, ...rest) => { lstatted.push(String(p)); return realLstat(p, ...rest); };
  let r;
  try { r = replyfile.attach(WHO, path.join(theirs, 'f.txt'), { platform: 'win32' }); } finally { fs.lstatSync = realLstat; projects.folderState = realFS; }
  assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], JSON.stringify(r));
  assert.deepEqual(resolved, [own], 'only the agent\'s own project folder was resolved');
  // the given path's own walk lstats it; nothing else under that folder is read to judge it as a project
  assert.equal(lstatted.filter((p) => p.toLowerCase() === theirs.toLowerCase()).length, 1, 'their folder was walked once, as part of the given path only');
});

test('#7232 B3: own projects first keeps the deepest-folder rule (a nested project of another agent; the same folder listed twice)', winOnly, () => {
  const outer = ownProject('own7232-outer');
  const nested = path.join(outer, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'secret.txt'), 'not for the outer project\n');
  windrives.setTableForTests(zTable(Z_REMOTE));
  PROJECTS = [
    { id: 'p-outer', name: 'Outer', folder: outer, agents: [WHO] },
    { id: 'p-nested', name: 'Nested', folder: nested, agents: ['someone-else'] },
  ];
  let r = replyfile.attach(WHO, path.join(nested, 'secret.txt'), { platform: 'win32' });
  assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], 'a deeper project of another agent refuses: ' + JSON.stringify(r));
  // the same deepest folder listed by another agent's project first and the agent's second: the agent is on it
  PROJECTS = [
    { id: 'p-nested', name: 'Nested', folder: nested, agents: ['someone-else'] },
    { id: 'p-nested-mine', name: 'Nested too', folder: nested, agents: [WHO] },
  ];
  r = replyfile.attach(WHO, path.join(nested, 'secret.txt'), { platform: 'win32' });
  assert.equal(r.ok, true, JSON.stringify(r));
  replyfile.discard(r.rec);
});

test('#7232 B3: the agent\'s own project on a dead mapped drive is not resolved for a local file', winOnly, () => {
  const own = ownProject('own7232-ownz');
  PROJECTS = [
    { id: 'p-own-z', name: 'Own far', folder: 'Z:\\mine', agents: [WHO] },
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
  ];
  windrives.setTableForTests(zTable(Z_REMOTE));
  const { r, touches } = attachIn({}, path.join(own, 'f.txt'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(touches.z, 0);
});

test('#7232 B4: an agent folder on a mapped drive is passed over for a local file, and still keeps Kosmos\'s files on its share', winOnly, () => {
  const own = ownProject('own7232-b4');
  store.writeProfile('zagent', { dir: 'Z:\\agentdir' });
  const roster = [{ sessionName: 'zagent' }];
  PROJECTS = [{ id: 'p-own', name: 'Own', folder: own, agents: [WHO] }];
  windrives.setTableForTests(zTable(Z_REMOTE));
  const local = attachIn({}, path.join(own, 'f.txt'), roster);
  assert.equal(local.r.ok, true, JSON.stringify(local.r));
  assert.equal(local.touches.z, 0, 'the agent folder on Z: was not read for a local file');
  // a file in that agent's Files, on the share, from a project of WHO's on the whole share: kept for Kosmos
  const backing = path.join(SANDBOX, 'zbacking');
  fs.mkdirSync(path.join(backing, 'agentdir', 'Files'), { recursive: true });
  fs.writeFileSync(path.join(backing, 'agentdir', 'Files', 'f.txt'), 'kept\n');
  PROJECTS = [{ id: 'p-share', name: 'Whole share', folder: ZSHARE, agents: [WHO] }];
  const kept = attachIn({ alive: true }, ZSHARE + '\\agentdir\\Files\\f.txt', roster);
  assert.deepEqual([kept.r.ok, kept.r.because], [false, replyfile.KEPT_FOR_KOSMOS], JSON.stringify(kept.r));
  assert.ok(kept.touches.z > 0, 'a file on the network: the agent folder is read by identity, as before (review 2 finding 1)');
});

test('#7232 B5: an own project on a dead mapped drive is not walked to learn which drives the roots reach', winOnly, (t) => {
  const own = ownProject('own7232-b5');
  const other = 'QRSTUVWXY'.split('').find((d) => !fs.existsSync(d + ':' + path.sep));
  if (!other) { setupSkip(t, 'no free drive letter from Q to Y'); return; }
  PROJECTS = [
    { id: 'p-own-z', name: 'Own far', folder: 'Z:\\mine\\deep', agents: [WHO] },
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
  ];
  windrives.setTableForTests(zTable(Z_REMOTE));
  const { r, touches } = attachIn({}, other + ':\\x\\f.txt');
  assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], JSON.stringify(r));
  assert.equal(touches.z, 0);
});

test('#7232 scale: 200 projects, one on a dead mapped drive, answers in under a second with a bounded number of reads', winOnly, (t) => {
  const scale = path.join(SANDBOX, 'scale7232');
  const own = path.join(scale, 'own');
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'f.txt'), 'the file\n');
  PROJECTS = [{ id: 'p-own', name: 'Own', folder: own, agents: [WHO] }];
  for (let i = 0; i < 198; i++) {
    const dir = i % 3 === 0 ? path.join(scale, 'o' + (i - 1 < 0 ? 0 : i - 1), 'nested' + i) : path.join(scale, 'o' + i);
    fs.mkdirSync(dir, { recursive: true });
    PROJECTS.push({ id: 'p-o' + i, name: 'Other ' + i, folder: dir, agents: ['agent-' + i] });
  }
  PROJECTS.push({ id: 'p-dead', name: 'Dead', folder: 'Z:\\dead\\proj', agents: ['agent-dead'] });
  assert.equal(PROJECTS.length, 200);
  windrives.setTableForTests(zTable(Z_REMOTE));
  /* Review 2 finding 5: a bound that walking every folder twice breaks. `base` is measured: an attach with the agent's
     own project alone. A single walk of another agent's folder is one lstat per part of its path, then its resolve
     and its id, a few reads more (6 allowed); so the full attach stays under base + the sum of (parts + 6). Measured
     on the Windows box: about 13 reads for a folder of 9 parts, where a second walk of each made it 21 and failed. */
  const all = PROJECTS;
  PROJECTS = [all[0]];
  attachIn({}, path.join(own, 'f.txt'));   // the first attach of a run reads a few things once (the ledger)
  const base = attachIn({}, path.join(own, 'f.txt')).calls;
  PROJECTS = all;
  const { r, touches, calls, ms } = attachIn({ stallMs: 2000 }, path.join(own, 'f.txt'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(touches.z + touches.share, 0, 'the dead drive was never touched');
  const bound = base + all.slice(1, 199).reduce((n, p) => n + p.folder.split(/[\\/]+/).filter(Boolean).length + 6, 0);
  t.diagnostic('reads ' + calls + ' (base ' + base + ', bound ' + bound + '), ' + ms.toFixed(0) + ' ms');
  assert.ok(calls < bound, 'reads: ' + calls + ', more than the ' + bound + ' one walk of each folder costs');
  assert.ok(ms < 1000, 'answered in ' + ms.toFixed(0) + ' ms');
});

/* ---------- #7232 review 1 ---------- */

test('#7232 review 1-1: a share name that was mis-decoded (U+FFFD) or is not \\\\host\\share is a share this cannot name', () => {
  const t = windrives.parseForTests('Z\t4\t\\\\srv\\Donn\uFFFDes\r\nY\t4\t\\\\srv\\s\\..\\x\r\nX\t4\tsrv\r\nW\t4\t\\\\srv\\Données\r\n');
  assert.equal(t.get('Z').share, null, 'a U+FFFD in it');
  assert.equal(t.get('Y').share, null, 'a .. below a share (review 4: a plain folder below one is a share it can name)');
  assert.equal(t.get('X').share, null, 'no \\\\ start');
  assert.equal(t.get('W').share, '\\\\srv\\Données', 'CONTROL: an accented name read right is kept');
});

test('#7232 review 1-1: a mapped drive whose share holds U+FFFD fails closed (OTHER_FOLDER_UNPLACED), untouched', winOnly, () => {
  const own = ownProject('own7232-fffd');
  PROJECTS = [
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
    { id: 'p-z', name: 'Far', folder: 'Z:\\far', agents: ['someone-else'] },
  ];
  windrives.setTableForTests(zTable({ kind: 'remote', share: '\\\\10.255.255.1\\Donn\uFFFDes' }));
  const { r, touches } = attachIn({}, path.join(own, 'f.txt'));
  assert.deepEqual([r.ok, r.because], [false, replyfile.OTHER_FOLDER_UNPLACED], JSON.stringify(r));
  assert.equal(touches.z, 0);
});

test('#7232 review 1-1: the drive table script prints an accented share name as UTF-8', winOnly, () => {
  /* The real script, with one line of its own shape appended naming a share \\srv\Données: what Windows PowerShell
     prints for it must read back as that name, not Donn\uFFFDes. */
  const { execFileSync } = require('node:child_process');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    windrives.scriptForTests + '; "Y`t4`t\\\\srv\\Donn$([char]0xE9)es"'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(windrives.parseForTests(out).get('Y').share, '\\\\srv\\Donn\u00e9es', JSON.stringify(out.split(/\r?\n/).filter((l) => l.startsWith('Y'))));
});

test('#7232 review 1-2: an agent folder on a mapped drive whose share is not named is read as before, and keeps its files', winOnly, () => {
  /* Z: is a network drive the redirector named no share for, so it may be this computer: here it is (Z:\victim is
     C:\...\zbacking\victim). A local path into that agent's Files is Kosmos's own, and must be refused. */
  const backing = fs.realpathSync.native(path.join(SANDBOX, 'zbacking'));
  fs.mkdirSync(path.join(backing, 'victim', 'Files'), { recursive: true });
  fs.writeFileSync(path.join(backing, 'victim', 'Files', 'f.txt'), 'kept\n');
  store.writeProfile('zvictim', { dir: 'Z:\\victim' });
  PROJECTS = [{ id: 'p-own', name: 'Outer', folder: backing, agents: [WHO] }];
  windrives.setTableForTests(zTable({ kind: 'remote', share: null }));
  const { r, touches } = attachIn({ alive: true }, path.join(backing, 'victim', 'Files', 'f.txt'), [{ sessionName: 'zvictim' }]);
  assert.deepEqual([r.ok, r.because], [false, replyfile.KEPT_FOR_KOSMOS], JSON.stringify(r));
  assert.ok(touches.z > 0, 'the agent folder on Z: was read');
});

test('#7232 review 1-3: a table whose refreshes keep failing is dropped after two refreshes; review 1-6: one re-learn per refresh', (t) => {
  let clock = 1000000;
  let fail = false;
  let runs = 0;
  const C_ONLY = 'C\t3\t\r\n';
  windrives.setLearnForTests({ now: () => clock, run: () => { runs++; if (fail) throw new Error('powershell failed'); return C_ONLY; } });
  t.after(() => windrives.setLearnForTests(null));
  assert.equal(windrives.known(), true, 'learned');
  // finding 6: letters the table does not list cost ONE blocking re-learn between refreshes, not one each
  const before = runs;
  for (const L of ['Q', 'R', 'S', 'T']) assert.deepEqual(windrives.placeOf(L), { absent: true });
  assert.equal(runs - before, 1, 'one re-learn for four unlisted letters');
  // finding 3: every refresh fails from now on
  fail = true;
  clock += 61 * 1000;
  assert.equal(windrives.known(), true, 'one failed refresh: the table is still used, inside the plan\'s one window');
  clock += 60 * 1000;
  assert.equal(windrives.known(), false, 'past two refreshes with none succeeding: unknown, as before #7232');
  // CONTROL: a refresh that succeeds again brings it back
  fail = false;
  clock += 61 * 1000;
  assert.equal(windrives.known(), true);
});

test('#7232 review 1-5: WSL, the NetBIOS name and IPv4-mapped spellings of this computer\'s addresses are this computer', () => {
  assert.equal(windrives.isThisComputer('wsl$'), true);
  assert.equal(windrives.isThisComputer('wsl.localhost'), true);
  assert.equal(windrives.isThisComputer('WSL.LOCALHOST'), true);
  const saved = process.env.COMPUTERNAME;
  process.env.COMPUTERNAME = 'KOSMOSNETBIOS7232';
  try {
    assert.equal(windrives.isThisComputer('kosmosnetbios7232'), true, 'the NetBIOS name');
    assert.equal(windrives.isThisComputer('KOSMOSNETBIOS7232.corp.example'), true);
  } finally { if (saved === undefined) delete process.env.COMPUTERNAME; else process.env.COMPUTERNAME = saved; }
  const v4 = [].concat(...Object.values(os.networkInterfaces()).map((l) => l || [])).filter((a) => a.family === 'IPv4' || a.family === 4).map((a) => a.address);
  assert.ok(v4.length > 0, 'this computer has an IPv4 address');
  for (const a of v4) {
    assert.equal(windrives.isThisComputer('::ffff:' + a), true, '::ffff:' + a);
    const [p, q, r, s] = a.split('.').map(Number);
    const literal = '--ffff-' + ((p << 8) | q).toString(16) + '-' + ((r << 8) | s).toString(16) + '.ipv6-literal.net';
    assert.equal(windrives.isThisComputer(literal), true, literal);
  }
  // CONTROL: another computer's mapped address is not this one
  assert.equal(windrives.isThisComputer('::ffff:10.255.255.1'), false);
});

/* ---------- #7232 review 2 ---------- */

test('#7232 review 2-1: a file on one share is judged by identity against a folder on a mapped drive of another share of the same server', winOnly, () => {
  /* \\10.255.255.1\data\team is the same server folder as \\10.255.255.1\zshare (Z:). Agent B's project Z:\b and agent
     B's own folder Z:\b; WHO's project is the whole data share. By spelling the two shares never meet, so B's files
     went through; main refused them by identity, and so must this. */
  const backing = fs.realpathSync.native(path.join(SANDBOX, 'zbacking'));
  fs.mkdirSync(path.join(SANDBOX, 'ddata'), { recursive: true });
  fs.mkdirSync(path.join(backing, 'b'), { recursive: true });
  fs.writeFileSync(path.join(backing, 'b', 'x.txt'), 'agent B\'s project file\n');
  fs.writeFileSync(path.join(backing, 'b', 'CLAUDE.md'), 'agent B\'s brief\n');
  windrives.setTableForTests(zTable(Z_REMOTE));
  // B's nested project
  PROJECTS = [
    { id: 'p-data', name: 'Data', folder: DSHARE, agents: [WHO] },
    { id: 'p-b', name: 'B', folder: 'Z:\\b', agents: ['agent-b'] },
  ];
  const nested = attachIn({ alive: true }, DSHARE + '\\team\\b\\x.txt');
  assert.deepEqual([nested.r.ok, nested.r.because], [false, replyfile.NOT_YOURS], JSON.stringify(nested.r));
  // B's own folder, kept for Kosmos
  store.writeProfile('agent-b', { dir: 'Z:\\b' });
  PROJECTS = [{ id: 'p-data', name: 'Data', folder: DSHARE, agents: [WHO] }];
  const kept = attachIn({ alive: true }, DSHARE + '\\team\\b\\CLAUDE.md', [{ sessionName: 'agent-b' }]);
  assert.deepEqual([kept.r.ok, kept.r.because], [false, replyfile.KEPT_FOR_KOSMOS], JSON.stringify(kept.r));
  // CONTROL: for a LOCAL file the same folder and agent folder on Z: are still passed over untouched
  const own = ownProject('own7232-r2');
  PROJECTS = [
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
    { id: 'p-b', name: 'B', folder: 'Z:\\b', agents: ['agent-b'] },
  ];
  const local = attachIn({}, path.join(own, 'f.txt'), [{ sessionName: 'agent-b' }]);
  assert.equal(local.r.ok, true, JSON.stringify(local.r));
  assert.equal(local.touches.z, 0);
});

test('#7232 review 2-2: a mapping the redirector names is a network drive whatever GetDrives says of it', () => {
  const t = windrives.parseForTests('C\t3\t\r\nY\t1\t\\\\10.255.255.1\\gone\r\nX\t1\t\\\\10.255.255.1\\only\r\nW\t0\t\\\\srv\\s\r\nV\t1\t\r\n');
  assert.deepEqual(t.get('Y'), { kind: 'remote', share: '\\\\10.255.255.1\\gone' }, 'DriveType 1 with a share');
  assert.deepEqual(t.get('X'), { kind: 'remote', share: '\\\\10.255.255.1\\only' }, 'a share-only line (missing from GetDrives)');
  assert.deepEqual(t.get('W'), { kind: 'remote', share: '\\\\srv\\s' });
  assert.deepEqual(t.get('V'), { kind: 'absent', share: null }, 'CONTROL: no share named is still absent');
  // the script prints the redirector's letters GetDrives missed
  assert.ok(windrives.scriptForTests.includes('$net.Keys'), 'the script lists EnumNetworkDrives letters GetDrives did not');
});

test('#7232 review 2-2: a remembered mapping GetDrives does not list is not touched for a local file', winOnly, (t) => {
  /* What the script prints for a remembered mapping whose server is unavailable: Z missing from GetDrives, printed by
     the EnumNetworkDrives pass with DriveType 1 and its share. */
  windrives.setTableForTests(null);
  windrives.setLearnForTests({ run: () => HERE + '\t3\t\r\nZ\t1\t' + ZSHARE + '\r\n' });
  t.after(() => windrives.setLearnForTests(null));
  const own = ownProject('own7232-remembered');
  PROJECTS = [
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
    { id: 'p-z', name: 'Far', folder: 'Z:\\far', agents: ['someone-else'] },
  ];
  const { r, touches } = attachIn({ stallMs: 2000 }, path.join(own, 'f.txt'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(touches.z, 0, 'the remembered mapping was not walked');
});

test('#7232 review 2-3: a slow background learn that started before a newer one does not overwrite its table', (t) => {
  let clock = 1000;
  let table = 'C\t3\t\r\n';
  let runs = 0;
  const later = [];
  windrives.setLearnForTests({ now: () => clock, run: () => { runs++; return table; }, runLater: (done) => later.push(done) });
  t.after(() => windrives.setLearnForTests(null));
  assert.equal(windrives.known(), true, 'learned in the foreground');
  clock += 61 * 1000;
  assert.equal(windrives.placeOf('C'), null, 'C is local; the table is due a refresh, so a background learn starts');
  assert.equal(later.length, 1, 'one background learn in flight');
  /* The background learn hangs. Past two refreshes the table is dropped and learned again in the foreground, newer,
     after Q was mapped (review 3 finding 4 made the unlisted-letter re-learn a background one, so this is the path a
     newer foreground learn takes now). */
  clock += 60 * 1000;
  table = 'C\t3\t\r\nQ\t4\t\\\\srv\\q\r\n';
  assert.deepEqual(windrives.placeOf('Q'), { remote: true, share: '\\\\srv\\q' });
  later[0](null, 'C\t3\t\r\n');   // the slow background learn finishes now, with what it read BEFORE Q was mapped
  const before = runs;
  assert.deepEqual(windrives.placeOf('Q'), { remote: true, share: '\\\\srv\\q' }, 'the older result was dropped');
  assert.equal(runs, before, 'Q answered from the newer table, not from a re-learn after the older one overwrote it');
});

test('#7232 review 2-4: the refresh clock is monotonic: a wall-clock jump neither drops nor re-learns the table', (t) => {
  let runs = 0;
  windrives.setLearnForTests({ run: () => { runs++; return 'C\t3\t\r\n'; } });   // no `now`: the module's own clock
  const realNow = Date.now;
  t.after(() => { Date.now = realNow; windrives.setLearnForTests(null); });
  assert.equal(windrives.known(), true);
  const after = runs;
  Date.now = () => realNow() + 10 * 60 * 1000;   // the wall clock jumps ten minutes (a time sync, a resume)
  assert.equal(windrives.known(), true, 'the table is still in use');
  assert.equal(runs, after, 'and was not learned again');
});

/* ---------- #7232 review 3 ---------- */

test('#7232 review 3-1: a share the redirector remembers for a letter GetDrives calls a drive of this computer is stale: local', () => {
  const t = windrives.parseForTests('Z\t3\t\\\\nas\\x\r\nU\t2\t\\\\nas\\u\r\nR\t5\t\\\\nas\\r\r\nM\t6\t\\\\nas\\m\r\nY\t1\t\\\\nas\\y\r\nW\t0\t\\\\nas\\w\r\n');
  for (const L of ['Z', 'U', 'R', 'M']) assert.deepEqual(t.get(L), { kind: 'local', share: null }, L + ': a fixed, removable, CD or RAM drive holds the letter now');
  // CONTROL: review 2-2's cases stay network drives
  assert.deepEqual(t.get('Y'), { kind: 'remote', share: '\\\\nas\\y' });
  assert.deepEqual(t.get('W'), { kind: 'remote', share: '\\\\nas\\w' });
});

test('#7232 review 3-1: a local drive holding a stale mapping\'s letter is still walked, and its nested project refuses', winOnly, (t) => {
  /* A subst drive (a local drive, no admin) whose letter the redirector still remembers for \\nas\x: the other
     agent's nested project is written on that letter, the file by its C: path. Read as remote it was skipped by
     spelling, and the nested project's file attached. */
  const { execFileSync } = require('node:child_process');
  const outer = ownProject('own7232-r3-outer');
  fs.mkdirSync(path.join(outer, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(outer, 'nested', 'secret.txt'), 'not for the outer project\n');
  const letter = 'QRSTUVWXY'.split('').find((d) => !fs.existsSync(d + ':' + path.sep));
  if (!letter) { setupSkip(t, 'no free drive letter from Q to Y'); return; }
  try { execFileSync('subst', [letter + ':', outer], { stdio: 'ignore' }); } catch { setupSkip(t, 'subst is not available here'); return; }
  const unsubst = () => { try { execFileSync('subst', [letter + ':', '/D'], { stdio: 'ignore' }); } catch { /* already gone */ } };
  process.once('exit', unsubst);
  try {
    windrives.setTableForTests(windrives.parseForTests(HERE + '\t3\t\r\n' + letter + '\t3\t\\\\10.255.255.1\\x\r\n'));
    PROJECTS = [
      { id: 'p-outer', name: 'Outer', folder: outer, agents: [WHO] },
      { id: 'p-nested', name: 'Nested', folder: letter + ':\\nested', agents: ['someone-else'] },
    ];
    const r = replyfile.attach(WHO, path.join(outer, 'nested', 'secret.txt'), { platform: 'win32' });
    assert.deepEqual([r.ok, r.because], [false, replyfile.NOT_YOURS], JSON.stringify(r));
  } finally { unsubst(); }
});

test('#7232 review 3-2: the redirector not answering makes the whole table unknown, and attach behaves as before', (t) => {
  assert.equal(windrives.parseForTests('!ENUM_FAILED\r\nC\t3\t\r\nZ\t4\t\r\n'), null, 'the marker: unknown');
  assert.ok(windrives.scriptForTests.includes('!ENUM_FAILED'), 'the script prints the marker when the COM call fails');
  windrives.setLearnForTests({ run: () => '!ENUM_FAILED\r\n' + HERE + '\t3\t\r\nZ\t4\t\r\n' });
  t.after(() => windrives.setLearnForTests(null));
  assert.equal(windrives.known(), false);
  if (!WIN) return;
  windrives.setTableForTests(null);
  const own = ownProject('own7232-enumfail');
  PROJECTS = [
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
    { id: 'p-z', name: 'Far', folder: 'Z:\\far', agents: ['someone-else'] },
  ];
  const { r, touches } = attachIn({ alive: true }, path.join(own, 'f.txt'));
  assert.equal(r.ok, true, 'attaches as main does, not refused OTHER_FOLDER_UNPLACED: ' + JSON.stringify(r));
  assert.ok(touches.z > 0, 'the Z: folder was resolved, as main resolves it');
});

test('#7232 review 3-3: an agent folder written locally under a link onto a dead mapped drive is not read for a local file', linkOnly, () => {
  const via = path.join(SANDBOX, 'via7232');
  fs.symlinkSync('Z:\\', via, 'dir');
  try {
    store.writeProfile('zlinked', { dir: path.join(via, 'agentdir') });
    const own = ownProject('own7232-r3-link');
    PROJECTS = [{ id: 'p-own', name: 'Own', folder: own, agents: [WHO] }];
    windrives.setTableForTests(zTable(Z_REMOTE));
    const { r, touches } = attachIn({ deadUnder: via }, path.join(own, 'f.txt'), [{ sessionName: 'zlinked' }]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(touches.z, 0, 'nothing below the link onto Z: was read');
  } finally { fs.rmSync(via, { force: true }); }
});

test('#7232 review 3-4: a letter the table does not list is re-learned in the background, never blocking the attach', (t) => {
  let runs = 0;
  const later = [];
  windrives.setLearnForTests({ run: () => { runs++; return 'C\t3\t\r\n'; }, runLater: (done) => later.push(done) });
  t.after(() => windrives.setLearnForTests(null));
  assert.equal(windrives.known(), true);
  const before = runs;
  assert.deepEqual(windrives.placeOf('Q'), { absent: true }, 'absent for now');
  assert.equal(runs, before, 'no blocking learn');
  assert.equal(later.length, 1, 'one background learn instead');
  assert.deepEqual(windrives.placeOf('R'), { absent: true });
  assert.equal(later.length, 1, 'and only one');
  later[0](null, 'C\t3\t\r\nQ\t4\t\\\\srv\\q\r\n');
  assert.deepEqual(windrives.placeOf('Q'), { remote: true, share: '\\\\srv\\q' }, 'the next attach has the new table');
});

/* ---------- #7232 review 4 ---------- */

test('#7232 review 4-1: a drive mapped to a folder below a share names that folder; dot, dot-dot and empty parts do not', () => {
  const t = windrives.parseForTests('Z\t4\t\\\\srv\\share\\sub\r\nY\t4\t\\\\srv\\share\\a\\b\r\nX\t4\t\\\\srv\\share\\..\\x\r\nW\t4\t\\\\srv\\share\\.\\x\r\nV\t4\t\\\\srv\\share\\\\x\r\nU\t4\t\\\\srv\\share\\sub\\\r\n');
  assert.equal(t.get('Z').share, '\\\\srv\\share\\sub');
  assert.equal(t.get('Y').share, '\\\\srv\\share\\a\\b');
  for (const L of ['X', 'W', 'V', 'U']) assert.equal(t.get(L).share, null, L);
});

test('#7232 review 4-1: another agent\'s project on a drive mapped below a share is passed over for a local file, and judged by that folder', winOnly, () => {
  const own = ownProject('own7232-r4');
  PROJECTS = [
    { id: 'p-own', name: 'Own', folder: own, agents: [WHO] },
    { id: 'p-z', name: 'Far', folder: 'Z:\\far', agents: ['someone-else'] },
  ];
  const sub = '\\\\10.255.255.1\\zshare\\sub';
  windrives.setTableForTests(windrives.parseForTests(HERE + '\t3\t\r\nZ\t4\t' + sub + '\r\n'));
  const { r, touches } = attachIn({}, path.join(own, 'f.txt'));
  assert.equal(r.ok, true, 'attaches, not refused as unplaced: ' + JSON.stringify(r));
  assert.equal(touches.z, 0);
  // where it leads includes the \sub below the share
  assert.deepEqual(windrives.placeOf('Z'), { remote: true, share: sub });
});

test('#7232 review 4-2: a host name made of hex letters and digits is a name; a number in another form is still this computer', () => {
  for (const h of ['dc', 'dc1', 'db01', 'cafe', 'fab', 'deadbeef', 'a1.b2']) assert.equal(windrives.isThisComputer(h), false, h + ' is a name');
  for (const h of ['0x7f.1', '0x7f000001', '2130706433', '127.1', '0177.0.0.1', '017700000001']) assert.equal(windrives.isThisComputer(h), true, h + ' may be 127.0.0.1');
});

test('#7232 review 4-3: asking whether the table is known spends no re-learn, even with no C:', (t) => {
  const later = [];
  windrives.setLearnForTests({ run: () => 'D\t3\t\r\n', runLater: (done) => later.push(done) });
  t.after(() => windrives.setLearnForTests(null));
  assert.equal(windrives.known(), true);
  assert.equal(windrives.known(), true);
  assert.equal(later.length, 0, 'no background re-learn for a C: this computer does not have');
  // CONTROL: the one re-learn is still there for a letter an attach meets
  assert.deepEqual(windrives.placeOf('Q'), { absent: true });
  assert.equal(later.length, 1);
});
