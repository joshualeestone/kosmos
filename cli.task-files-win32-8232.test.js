'use strict';

/**
 * kosmos#8232, the follow-up to #8227 item 1: on Windows, `kosmos task files` checked only a path's own drive letter,
 * so a link inside a local path (a directory symlink to \\host\share, or a link to a mapped network letter) still
 * opened a network location a marker chose. engine/tasklist.js reachesNetworkWin walks the path one name at a time
 * with lstat and follows each link by reading it, refusing a UNC or device target and checking a drive-letter target's
 * kind before anything on that drive is looked up.
 *
 * The walk's rules run on any host against a scripted filesystem. The real-link arms need Windows (a junction needs
 * nothing; a symlink needs Developer Mode or an elevated runner, and the CI runner is elevated; an arm that cannot make
 * one says so and skips). "win32" in this file's name is what puts it in tools/windows-tests.js.
 *
 * Measured by hand on a Windows 11 box (11-09, node 24.19): lstat reports a junction and a directory symlink alike as
 * a link; readlink strips \??\ only from a drive or UNC target, so other device targets (\??\GLOBALROOT\..., \??\Global\...)
 * come back raw; and a junction cannot target UNC.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const tasklist = require('./engine/tasklist');

const NEEDS_WINDOWS = process.platform !== 'win32' && 'needs a real Windows host (real junctions and symlinks)';
const LOCAL = { kind: 'local', share: null };
const REMOTE = { kind: 'remote', share: '\\\\srv\\share' };
const kinds = (byLetter) => (letter) => (Object.prototype.hasOwnProperty.call(byLetter, letter.toUpperCase()) ? byLetter[letter.toUpperCase()] : null);
const sha = (text) => 'sha256:' + crypto.createHash('sha256').update(text).digest('hex');

/* A scripted filesystem: `links` maps a full path (case-blind) to its target; `missing` paths fail lstat; everything
   else is a plain folder or file. Every lstat and readlink is recorded, so a test can say what was looked up. */
function scripted(links = {}, missing = [], failing = {}) {
  const key = (p) => p.toLowerCase();
  const L = new Map(Object.entries(links).map(([k, v]) => [key(k), v]));
  const gone = new Set(missing.map(key));
  const F = new Map(Object.entries(failing).map(([k, v]) => [key(k), v]));
  const seen = [];
  return {
    seen,
    lstatSync(p) {
      seen.push(p);
      if (gone.has(key(p))) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      if (F.has(key(p))) throw F.get(key(p));
      return { isSymbolicLink: () => L.has(key(p)) };
    },
    readlinkSync(p) {
      const to = L.get(key(p));
      if (to instanceof Error) throw to;
      return to;
    },
  };
}
const walk = (p, fsx, drives = { C: LOCAL }) => tasklist.reachesNetworkWin(p, kinds(drives), fsx);

test('#8232: a path with no links on a local drive is opened', () => {
  const fsx = scripted();
  assert.equal(walk('C:\\work\\out\\report.pdf', fsx), null);
  assert.deepEqual(fsx.seen, ['C:\\work', 'C:\\work\\out', 'C:\\work\\out\\report.pdf']);
});

test('#8232: a link to a local folder is followed and opened', () => {
  const fsx = scripted({ 'C:\\work\\link': 'C:\\real' });
  assert.equal(walk('C:\\work\\link\\f.txt', fsx), null);
  assert.ok(fsx.seen.includes('C:\\real\\f.txt'), 'the walk went on at the target: ' + JSON.stringify(fsx.seen));
});

test('#8232: a link to a UNC share is refused, and nothing past the link is looked up', () => {
  for (const to of ['\\\\host\\share\\x', '//host/share', '\\\\?\\UNC\\host\\share', '\\\\.\\UNC\\host\\share', '\\\\?\\unc\\host\\share']) {
    const fsx = scripted({ 'C:\\work\\link': to });
    const why = walk('C:\\work\\link\\f.txt', fsx);
    assert.match(why || '', /network location/, to);
    assert.ok(!fsx.seen.some((p) => /link\\f\.txt$/i.test(p) || /host/i.test(p)), to + ': looked up past the link: ' + JSON.stringify(fsx.seen));
  }
  // Every device form other than a drive or UNC one is refused. These are the shapes node 24's readlink really returns
  // on Windows (measured 11-09): it strips \??\ only from a drive or UNC target, so the rest arrive raw, \??\ and all.
  // \??\GLOBALROOT\Device\Mup\ is a network share by another name; \??\Global\Z:\ is a mapped letter by another name.
  for (const to of ['\\??\\GLOBALROOT\\Device\\Mup\\host\\share', '\\??\\Global\\Z:\\', '\\??\\Volume{0b1c2d3e-0000-0000-0000-000000000000}\\',
    '\\\\?\\Volume{0b1c2d3e-0000-0000-0000-000000000000}\\', '\\\\?\\GLOBALROOT\\Device\\Mup\\host', '\\\\.\\PhysicalDrive0', '/??/Global/C:/x']) {
    const fsx = scripted({ 'C:\\work\\link': to });
    assert.match(walk('C:\\work\\link\\f.txt', fsx) || '', /could not follow \(a mounted volume or device path\)/, to);
    assert.deepEqual(fsx.seen, ['C:\\work', 'C:\\work\\link'], to + ': looked up past the link');
  }
  // The \??\ drive and UNC forms, in case a runtime leaves them raw.
  assert.equal(walk('C:\\work\\link\\f.txt', scripted({ 'C:\\work\\link': '\\??\\C:\\real' })), null);
  assert.match(walk('C:\\work\\link\\f.txt', scripted({ 'C:\\work\\link': '\\??\\Z:\\s' }), { C: LOCAL, Z: REMOTE }) || '', /drive Z:, a network drive/);
  assert.match(walk('C:\\work\\link\\f.txt', scripted({ 'C:\\work\\link': '\\??\\UNC\\host\\share' })) || '', /network location/);
});

test('#8232: a rooted target is refused, even when a folder of that name exists on the link\'s drive', () => {
  // readlink gives \Device\Mup\host\share for an absolute NT symlink (Windows opens it through the share) and for a
  // relative-flag \x alike; anyone may create C:\Device\Mup\..., so finding it there proves nothing.
  for (const to of ['\\Device\\Mup\\host\\share', '\\x', '/x']) {
    const fsx = scripted({ 'C:\\work\\link': to });
    assert.match(walk('C:\\work\\link\\f.txt', fsx) || '', /could not follow \(a target with no drive\)/, to);
    assert.deepEqual(fsx.seen, ['C:\\work', 'C:\\work\\link'], to + ': looked up past the link');
  }
});

test('#8232: a name that is not there after a link to a drive path is reported missing, as without a link', () => {
  // Every accepted target is resolved as Windows resolves it, so compare() opens the same path and says MISSING.
  assert.equal(walk('C:\\work\\junc\\gone.txt', scripted({ 'C:\\work\\junc': 'C:\\real' }, ['C:\\real\\gone.txt'])), null);
  assert.equal(walk('C:\\work\\rel\\gone.txt', scripted({ 'C:\\work\\rel': '..\\real' }, ['C:\\real\\gone.txt'])), null);
  assert.equal(walk('C:\\work\\plain\\f.txt', scripted({}, ['C:\\work\\plain'])), null, 'CONTROL: with no link on the way too');
});

test('#8232: any other lookup error is not opened, link or not (the walk cannot tell whether that name is a link)', () => {
  // A junction whose own ACL denies reading it fails lstat with EPERM, yet Windows still opens through it (the real arm
  // below measures it); so an unreadable name is refused, never handed to compare().
  for (const code of ['EPERM', 'EACCES', 'EBUSY', 'UNKNOWN']) {
    const e = new Error(code); e.code = code;
    assert.match(walk('C:\\work\\j\\f.txt', scripted({}, [], { 'C:\\work\\j': e })) || '', /a folder or link Kosmos could not look at/, code + ', no link before it');
    assert.match(walk('C:\\work\\junc\\f.txt', scripted({ 'C:\\work\\junc': 'C:\\real' }, [], { 'C:\\real\\f.txt': e })) || '', /could not look at/, code + ', after a link');
  }
  const notDir = new Error('ENOTDIR'); notDir.code = 'ENOTDIR';
  assert.equal(walk('C:\\work\\file.txt\\x', scripted({}, [], { 'C:\\work\\file.txt\\x': notDir })), null, 'CONTROL: ENOTDIR is not there, as ENOENT is');
});

test('#8232: \\\\?\\C:\\ is a drive path and is checked as one', () => {
  assert.equal(walk('C:\\work\\link\\f.txt', scripted({ 'C:\\work\\link': '\\\\?\\C:\\real' })), null);
  const fsx = scripted({ 'C:\\work\\link': '\\\\?\\Z:\\share' });
  assert.match(walk('C:\\work\\link\\f.txt', fsx, { C: LOCAL, Z: REMOTE }) || '', /drive Z:, a network drive/);
});

test('#8232: a link to a network letter, an unknown letter, or a letter no table names is refused before that drive is touched', () => {
  const fsx = scripted({ 'C:\\work\\link': 'Z:\\share' });
  assert.match(walk('C:\\work\\link\\f.txt', fsx, { C: LOCAL, Z: REMOTE }) || '', /link to drive Z:, a network drive/);
  assert.ok(!fsx.seen.some((p) => /^Z:/i.test(p)), 'looked up on Z: ' + JSON.stringify(fsx.seen));
  assert.match(walk('C:\\work\\link\\f.txt', scripted({ 'C:\\work\\link': 'Z:\\share' }), { C: LOCAL }) || '', /could not tell what kind of drive that is/);
  assert.match(walk('C:\\work\\link\\f.txt', scripted({ 'C:\\work\\link': 'z:\\share' }), { C: LOCAL, Z: { kind: 'absent', share: null } }) || '', /no drive Z:/);
  assert.equal(walk('C:\\work\\link\\f.txt', scripted({ 'C:\\work\\link': 'D:\\data' }), { C: LOCAL, D: LOCAL }), null, 'CONTROL: a link to another local drive is opened');
});

test('#8232: a chain of links is followed hop by hop, and a network hop anywhere in it is refused', () => {
  const chain = { 'C:\\a': 'C:\\b', 'C:\\b': 'D:\\c', 'D:\\c': '\\\\host\\share' };
  assert.match(walk('C:\\a\\f.txt', scripted(chain), { C: LOCAL, D: LOCAL }) || '', /network location/);
  assert.equal(walk('C:\\a\\f.txt', scripted({ 'C:\\a': 'C:\\b', 'C:\\b': 'D:\\c' }), { C: LOCAL, D: LOCAL }), null, 'CONTROL: the same chain ending local is opened');
});

test('#8232: a relative target resolves against the link\'s own folder', () => {
  // ..\..\x from C:\w\d\link is C:\x; the walk then finds C:\x is a link to UNC.
  assert.match(walk('C:\\w\\d\\link\\f', scripted({ 'C:\\w\\d\\link': '..\\..\\x', 'C:\\x': '\\\\h\\s' })) || '', /network location/);
  // On another drive: r on D:\m is D:\m\s, never C:.
  const fsx = scripted({ 'C:\\l': 'D:\\m', 'D:\\m\\r': 's' });
  assert.equal(walk('C:\\l\\r\\f', fsx, { C: LOCAL, D: LOCAL }), null);
  assert.ok(fsx.seen.includes('D:\\m\\s\\f'), JSON.stringify(fsx.seen));
});

test('#8232: .. is collapsed by text first, as Windows does, so C:\\link\\..\\x never follows link', () => {
  const fsx = scripted({ 'C:\\w\\link': '\\\\host\\share' });
  assert.equal(walk('C:\\w\\link\\..\\x.txt', fsx), null);
  assert.deepEqual(fsx.seen, ['C:\\w', 'C:\\w\\x.txt']);
});

test('#8232: a loop, an unreadable link, and a drive-relative target are not opened; a missing name ends the walk', () => {
  assert.match(walk('C:\\a\\f', scripted({ 'C:\\a': 'C:\\b', 'C:\\b': 'C:\\a' })) || '', /loops through links/);
  const unreadable = new Error('EPERM'); unreadable.code = 'EPERM';
  assert.match(walk('C:\\a\\f', scripted({ 'C:\\a': unreadable })) || '', /could not read/);
  assert.match(walk('C:\\a\\f', scripted({ 'C:\\a': 'D:x' }), { C: LOCAL, D: LOCAL }) || '', /could not follow/);
  const fsx = scripted({}, ['C:\\gone']);
  assert.equal(walk('C:\\gone\\f', fsx), null, 'a name that is not there: compare() reports it missing');
  assert.deepEqual(fsx.seen, ['C:\\gone']);
});

test('#8232: task files says NOT CHECKED for a path through a network link, and never fingerprints it', () => {
  const opened = [];
  const row = (n, at) => ({ number: n, sentence: 'Deliverable ' + n, builtAt: 'x', builtFingerprint: sha('x'), builtFilePath: at });
  const { lines } = tasklist.filesLines({ listState: 'built', tasks: [row(1, 'C:\\work\\link\\f.txt'), row(2, 'C:\\work\\plain.txt')] }, {
    project: 'p', platform: 'win32', driveInfo: kinds({ C: LOCAL }),
    fs: scripted({ 'C:\\work\\link': '\\\\host\\share' }),
    compare: (at) => { opened.push(at); return { ok: true, match: true }; },
  });
  const text = lines.join('\n');
  assert.match(text, /NOT CHECKED C:\\work\\link\\f\.txt: it goes through a link to a network location/);
  assert.deepEqual(opened, ['C:\\work\\plain.txt'], 'CONTROL included: the plain path was opened, the linked one was not');
});

/* Real links on a real Windows host. */
function sandbox(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-linkwalk-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const real = path.join(dir, 'real');
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, 'f.txt'), 'x');
  return { dir, real };
}
const symlinkOrSkip = (t, target, at) => {
  try { fs.symlinkSync(target, at, 'dir'); return true; } catch (e) {
    if (e.code === 'EPERM') { t.skip('this host cannot make a symlink (needs Developer Mode or an elevated runner)'); return false; }
    throw e;
  }
};
const here = (p) => kinds({ [p.charAt(0).toUpperCase()]: LOCAL });

test('#8232 Windows: a junction to a local folder is opened', { skip: NEEDS_WINDOWS }, (t) => {
  const { dir, real } = sandbox(t);
  const j = path.join(dir, 'junc');
  fs.symlinkSync(real, j, 'junction');
  assert.equal(tasklist.reachesNetworkWin(path.join(j, 'f.txt'), here(dir)), null);
  assert.equal(fs.readFileSync(path.join(j, 'f.txt'), 'utf8'), 'x', 'CONTROL: the junction really reaches the file');
  // A file gone from behind a junction is left to compare(), which reports it MISSING.
  assert.equal(tasklist.reachesNetworkWin(path.join(j, 'gone.txt'), here(dir)), null);
});

test('#8232 Windows: a real symlink to \\\\localhost\\ is refused without being opened', { skip: NEEDS_WINDOWS }, (t) => {
  const { dir } = sandbox(t);
  const u = path.join(dir, 'unc');
  if (!symlinkOrSkip(t, '\\\\localhost\\C$\\Windows', u)) return;
  assert.match(tasklist.reachesNetworkWin(path.join(u, 'win.ini'), here(dir)) || '', /network location/);
});

test('#8232 Windows: a junction whose ACL hides it from lstat is refused, though Windows reads through it', { skip: NEEDS_WINDOWS }, (t) => {
  const { dir, real } = sandbox(t);
  const box = path.join(dir, 'box');
  fs.mkdirSync(box);
  const j = path.join(box, 'j');
  fs.symlinkSync(real, j, 'junction');
  const { execFileSync } = require('node:child_process');
  const who = (process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : '') + process.env.USERNAME;
  const icacls = (...args) => execFileSync('icacls', args, { stdio: 'pipe', windowsHide: true });
  // Taken off again in the finally, inside the test (even if only the first was set): the sandbox's own after-hook runs
  // first and cannot list a denied folder.
  try {
    try {
      icacls(j, '/L', '/deny', who + ':(RA,REA,RC)');
      icacls(box, '/deny', who + ':(RD)');
    } catch (e) { t.skip('icacls could not set the deny entries here: ' + String(e.message).split('\n')[0]); return; }
    let lstatCode = null;
    try { fs.lstatSync(j); } catch (e) { lstatCode = e.code; }
    if (!lstatCode) { t.skip('lstat still reads the junction under the deny entries on this host'); return; }
    assert.equal(fs.readFileSync(path.join(j, 'f.txt'), 'utf8'), 'x', 'CONTROL: Windows really reads through the junction lstat cannot see (' + lstatCode + ')');
    assert.match(tasklist.reachesNetworkWin(path.join(j, 'f.txt'), here(dir)) || '', /a folder or link Kosmos could not look at/);
  } finally {
    try { icacls(box, '/remove:d', who); } catch {}
    try { icacls(j, '/L', '/remove:d', who); } catch {}
  }
});

test('#8232 Windows: real symlinks to \\\\?\\GLOBALROOT\\Device\\Mup\\ and \\\\?\\Global\\<letter>:\\ are refused, though Windows reads through them', { skip: NEEDS_WINDOWS }, (t) => {
  const { dir, real } = sandbox(t);
  const own = dir.charAt(0).toUpperCase();
  const viaRoot = path.join(dir, 'globalroot');
  if (!symlinkOrSkip(t, '\\\\?\\GLOBALROOT\\Device\\Mup\\localhost\\' + own + '$\\' + real.slice(3), viaRoot)) return;
  const viaGlobal = path.join(dir, 'global');
  if (!symlinkOrSkip(t, '\\\\?\\Global\\' + real, viaGlobal)) return;
  // The shape this host's readlink gives, which the scripted arms above assume.
  assert.match(fs.readlinkSync(viaGlobal), /^\\\?\?\\Global\\/, 'readlink shape changed; update the scripted fixtures');
  assert.match(tasklist.reachesNetworkWin(path.join(viaGlobal, 'f.txt'), here(dir)) || '', /mounted volume or device path/);
  assert.equal(fs.readFileSync(path.join(viaGlobal, 'f.txt'), 'utf8'), 'x', 'CONTROL: Windows really reads through \\\\?\\Global\\');
  assert.match(tasklist.reachesNetworkWin(path.join(viaRoot, 'f.txt'), here(dir)) || '', /mounted volume or device path/);
});

test('#8232 Windows: a real symlink to a network letter is refused, and to a local one opened', { skip: NEEDS_WINDOWS }, (t) => {
  const { dir, real } = sandbox(t);
  const z = path.join(dir, 'tonet');
  if (!symlinkOrSkip(t, 'Q:\\share', z)) return;   // dangling: Q: is only ever named, never looked up
  const own = dir.charAt(0).toUpperCase();
  assert.match(tasklist.reachesNetworkWin(path.join(z, 'f.txt'), kinds({ [own]: LOCAL, Q: REMOTE })) || '', /link to drive Q:, a network drive/);
  const ok = path.join(dir, 'tolocal');
  if (!symlinkOrSkip(t, real, ok)) return;
  assert.equal(tasklist.reachesNetworkWin(path.join(ok, 'f.txt'), here(dir)), null, 'CONTROL: a symlink to a local folder is opened');
});
