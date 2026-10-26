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
  if (!other) { t.skip('no free drive letter'); return; }
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
  if (!other) { t.skip('no free drive letter'); return; }
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
  if (!mapped) { t.skip('no free drive letter'); return; }
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
  if (!projUnc) { t.skip('this machine\'s admin share is not reachable'); return; }
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
  if (!projUnc) { t.skip('this machine\'s admin share is not reachable'); return; }
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
  if (!letter) { t.skip('no free drive letter'); return; }
  try { execFileSync('subst', [letter + ':', ddrive], { stdio: 'ignore' }); } catch { t.skip('subst is not available here'); return; }
  /* A subst drive outlives the process that made it, so it is removed on exit too, should the arm be cut off. */
  const unsubst = () => { try { execFileSync('subst', [letter + ':', '/D'], { stdio: 'ignore' }); } catch { /* already gone */ } };
  process.once('exit', unsubst);
  const view = path.join(SANDBOX, 'cview');
  try {
    fs.symlinkSync(letter + ':\\', view, 'dir');
    const proj = path.join(view, 'proj');
    PROJECTS = [{ id: 'p-other-drive', name: 'Other drive', folder: proj, agents: [WHO] }];
    const r = replyfile.attach(WHO, path.join(proj, 'f.txt'), { platform: 'win32' });
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
  if (!outerUnc) { t.skip('this machine\'s admin share is not reachable'); return; }
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
  if (!volume) { t.skip('mountvol gave no volume name here'); return; }
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
  if (!mklinkRootRelative(link, path.join(FILES, 'report.txt').slice(2), false)) { t.skip('mklink could not make a root-relative link here'); return; }
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
  if (!volume) { t.skip('mountvol gave no volume name here'); return; }
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
  if (!mklinkRootRelative(nested, data.slice(2), true)) { t.skip('mklink could not make a root-relative link here'); return; }
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
  if (!targetUnc) { t.skip('this machine\'s admin share is not reachable'); return; }
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
  if (!targetUnc) { t.skip('this machine\'s admin share is not reachable'); return; }
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
  if (!projUnc) { t.skip('this machine\'s admin share is not reachable'); return; }
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
  if (!outerUnc) { t.skip('this machine\'s admin share is not reachable'); return; }
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
  if (!cfilesUnc) { t.skip('this machine\'s admin share is not reachable'); return; }
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
  if (!volume) { t.skip('mountvol gave no volume name here'); return; }
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
  const file = path.join(dir, 'f.txt');
  fs.writeFileSync(file, 'x');
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
