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
const dmfiles = require('./dmfiles');
const projects = require('./projects');

const WIN = process.platform === 'win32';
const SHARE = '\\\\10.255.255.1\\share\\x';
const WHO = 'win7221';

test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* ---------- the rules by spelling: every platform ---------- */

test('#7221: DOS device names are recognised with an extension, trailing dots and spaces, and the superscript digits', () => {
  for (const n of ['NUL', 'nul', 'Con', 'PRN', 'aux', 'COM1', 'com9', 'LPT1', 'lpt9', 'COM1.txt', 'nul.tar.gz', 'NUL.', 'NUL ', 'nul .txt', 'CONIN$', 'conout$', 'COM\u00b9', 'LPT\u00b3']) {
    assert.equal(replyfile.isDevicePart(n), true, n + ' is a device name');
  }
  for (const n of ['null.txt', 'console.log', 'nulls', 'COM10', 'lpt', 'com', 'aux_notes.md', 'report.pdf', 'x.nul']) {
    assert.equal(replyfile.isDevicePart(n), false, n + ' is an ordinary name');
  }
});

test('#7221: the spelling rules refuse shares, device namespaces, streams, device names and drives outside the roots', () => {
  const drives = new Set(['C']);
  const net = replyfile.ON_NETWORK;
  assert.equal(replyfile.winSpellingRefusal('\\\\host\\share\\f.txt', drives), net);
  assert.equal(replyfile.winSpellingRefusal('//host/share/f.txt', drives), net);
  assert.equal(replyfile.winSpellingRefusal('\\\\?\\UNC\\host\\share\\f.txt', drives), net);
  assert.equal(replyfile.winSpellingRefusal('\\\\.\\NUL', drives), net);
  assert.equal(replyfile.winSpellingRefusal('\\\\?\\C:\\Users\\a\\Files\\f.txt', drives), net, 'the \\\\?\\ namespace is refused as typed, local or not');
  assert.equal(replyfile.winSpellingRefusal('C:\\Users\\a\\Files\\f.txt:hidden', drives), net, 'an alternate data stream');
  assert.equal(replyfile.winSpellingRefusal('C:\\Users\\a\\Files\\COM1:', drives), net);
  assert.equal(replyfile.winSpellingRefusal('C:\\Users\\a\\Files\\NUL', drives), replyfile.DEVICE_NAME);
  assert.equal(replyfile.winSpellingRefusal('C:\\Users\\a\\Files\\com1.txt', drives), replyfile.DEVICE_NAME);
  assert.equal(replyfile.winSpellingRefusal('Z:\\Files\\f.txt', drives), replyfile.NOT_YOURS, 'a drive no root is on (a mapped drive is a share)');
  assert.equal(replyfile.winSpellingRefusal('\\Users\\a\\Files\\f.txt', drives), replyfile.NOT_YOURS, 'a path with no drive');
  // CONTROL: an ordinary file on the roots' drive passes the spelling rules, in either case of the letter
  assert.equal(replyfile.winSpellingRefusal('C:\\Users\\a\\Files\\report.pdf', drives), null);
  assert.equal(replyfile.winSpellingRefusal('c:/Users/a/Files/null.txt', drives), null);
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
  assert.ok(ms < 2000, label + ': refused at once, not after a network attempt (' + ms + ' ms)');
}

test.before(() => {
  if (!WIN) return;
  FILES = path.join(SANDBOX, 'workers', WHO, 'Files');
  OUTSIDE = path.join(SANDBOX, 'outside');
  fs.mkdirSync(FILES, { recursive: true });
  fs.mkdirSync(OUTSIDE, { recursive: true });
  fs.writeFileSync(path.join(FILES, 'report.txt'), 'the report\n');
  // The agent's Files folder and its (empty) projects, as the board would answer them for this agent.
  dmfiles.filesDir = (name) => (name === WHO ? FILES : null);
  projects.readAll = () => [];
});
test.afterEach(() => { if (WIN) replyfile.setRealpathForTests(null); });

const winOnly = { skip: !WIN && 'the Windows board rule; links and device names mean this only on win32' };

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
  refusedUnresolved('\\\\?\\' + path.join(FILES, 'report.txt'), replyfile.ON_NETWORK, 'the \\\\?\\ spelling of a local file');
});

test('#7221: a symbolic link in Files that points at a share is refused without resolving it (no SMB contact)', winOnly, () => {
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
  try { refusedUnresolved(path.join(j, 'f.txt'), replyfile.UNREADABLE_LINK, 'a junction to a share'); } finally { fs.rmSync(j, { recursive: true, force: true }); }
});

test('#7221: a chain of links that ends at a share is followed link by link and refused', winOnly, () => {
  const last = path.join(OUTSIDE, 'to-share.txt');
  const first = path.join(FILES, 'chain.txt');
  fs.symlinkSync(SHARE, last, 'file');
  fs.symlinkSync(last, first, 'file');
  try { refusedUnresolved(first, replyfile.ON_NETWORK, 'a link to a link to a share'); } finally { fs.rmSync(first, { force: true }); fs.rmSync(last, { force: true }); }
});

test('#7221: a link that points at another drive no root is on is refused without resolving it', winOnly, () => {
  const here = path.parse(FILES).root[0].toUpperCase();
  const other = 'QRSTUVWXYZ'.split('').find((d) => d !== here);
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
  refusedUnresolved(path.join(FILES, 'report.txt') + ':secret', replyfile.ON_NETWORK, 'a stream');
});

test('#7221: a drive no root is on (a mapped drive is a share under a letter) is refused before it is touched', winOnly, () => {
  const here = path.parse(FILES).root[0].toUpperCase();
  const other = 'QRSTUVWXYZ'.split('').find((d) => d !== here);
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
