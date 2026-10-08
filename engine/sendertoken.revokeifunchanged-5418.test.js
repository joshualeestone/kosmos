'use strict';
/**
 * #5418 ask 2: sendertoken.revokeIfUnchanged, the last guard before the one-time cleanup tool removes a token file.
 * It removes the file only if, under the store's lock, it is still the file a plan looked at (same mtime, no newer
 * mintedAt). This test process's store is a throwaway (#5418 ask 1).
 *
 *   node --test engine/sendertoken.revokeifunchanged-5418.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'revokeif-')), 'data');
const sendertoken = require('./sendertoken');

const OLD = Date.parse('2026-08-28T00:00:00Z');
function fileOf(key) { return path.join(sendertoken.DIR, key + '.json'); }
function seed(key) {
  fs.mkdirSync(sendertoken.DIR, { recursive: true });
  fs.writeFileSync(fileOf(key), JSON.stringify({ tokens: [{ token: 'x', instance: 'i', mintedAt: new Date(OLD).toISOString() }] }));
  fs.utimesSync(fileOf(key), OLD / 1000, OLD / 1000);
  return fs.lstatSync(fileOf(key)).mtimeMs;
}

test('#5418: an unchanged file is removed', () => {
  const m = seed('unchanged');
  assert.deepEqual(sendertoken.revokeIfUnchanged('unchanged', m, OLD), { ok: true });
  assert.equal(fs.existsSync(fileOf('unchanged')), false);
});

test('#5418: a token minted after the plan keeps the file', () => {
  const m = seed('minted');
  assert.equal(sendertoken.mint('minted').ok, true);
  const r = sendertoken.revokeIfUnchanged('minted', m, OLD);
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(fileOf('minted')), true);
});

test('#5418: a file already gone is reported as such, not as removed', () => {
  assert.deepEqual(sendertoken.revokeIfUnchanged('never-was', OLD, null), { ok: true, already: true });
});

test('#5418: a link where the file was is not followed or removed', { skip: process.platform === 'win32' && 'symlinks need privilege on Windows' }, () => {
  fs.mkdirSync(sendertoken.DIR, { recursive: true });
  const target = path.join(os.tmpdir(), 'revokeif-target-' + process.pid);
  fs.writeFileSync(target, 'keep me');
  fs.symlinkSync(target, fileOf('linked'));
  const r = sendertoken.revokeIfUnchanged('linked', fs.lstatSync(fileOf('linked')).mtimeMs, null);
  assert.equal(r.ok, false);
  assert.equal(fs.lstatSync(fileOf('linked')).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep me');
  fs.unlinkSync(fileOf('linked')); fs.unlinkSync(target);
});

test('#5418: a rewrite with NO new mint (a retire leaving an empty list) keeps the file: the mtime check alone', () => {
  const m = seed('retired');
  // the same agent's file rewritten with fewer tokens and no newer mintedAt, a little later
  fs.writeFileSync(fileOf('retired'), JSON.stringify({ tokens: [] }));
  fs.utimesSync(fileOf('retired'), (OLD + 5000) / 1000, (OLD + 5000) / 1000);
  const r = sendertoken.revokeIfUnchanged('retired', m, OLD);
  assert.equal(r.ok, false);
  assert.match(r.because, /written since the plan/);
  assert.equal(fs.existsSync(fileOf('retired')), true);
});
