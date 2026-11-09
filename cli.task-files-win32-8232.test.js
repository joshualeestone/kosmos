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
 * a link, readlink gives the target without a \\?\ prefix, and a junction cannot target UNC.
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
function scripted(links = {}, missing = []) {
  const key = (p) => p.toLowerCase();
  const L = new Map(Object.entries(links).map(([k, v]) => [key(k), v]));
  const gone = new Set(missing.map(key));
  const seen = [];
  return {
    seen,
    lstatSync(p) {
      seen.push(p);
      if (gone.has(key(p))) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
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
  // A volume mount point or other device path is not a drive path this can check: not opened, and not called network.
  for (const to of ['\\\\?\\Volume{0b1c2d3e-0000-0000-0000-000000000000}\\', '\\\\.\\PhysicalDrive0']) {
    const why = walk('C:\\work\\link\\f.txt', scripted({ 'C:\\work\\link': to }));
    assert.match(why || '', /could not follow \(a device or volume path\)/, to);
  }
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

test('#8232: relative and rooted targets resolve against the link\'s own folder and drive', () => {
  // ..\..\x from C:\w\d\link is C:\x; the walk then finds C:\x is a link to UNC.
  assert.match(walk('C:\\w\\d\\link\\f', scripted({ 'C:\\w\\d\\link': '..\\..\\x', 'C:\\x': '\\\\h\\s' })) || '', /network location/);
  // \x is the root of the link's drive (D:), not C:.
  const fsx = scripted({ 'C:\\l': 'D:\\m', 'D:\\m\\r': '\\x' });
  assert.equal(walk('C:\\l\\r\\f', fsx, { C: LOCAL, D: LOCAL }), null);
  assert.ok(fsx.seen.includes('D:\\x\\f'), JSON.stringify(fsx.seen));
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
});

test('#8232 Windows: a real symlink to \\\\localhost\\ is refused without being opened', { skip: NEEDS_WINDOWS }, (t) => {
  const { dir } = sandbox(t);
  const u = path.join(dir, 'unc');
  if (!symlinkOrSkip(t, '\\\\localhost\\C$\\Windows', u)) return;
  assert.match(tasklist.reachesNetworkWin(path.join(u, 'win.ini'), here(dir)) || '', /network location/);
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
