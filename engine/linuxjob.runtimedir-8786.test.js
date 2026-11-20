'use strict';
/**
 * kosmos#8786: engine/linuxjob.js ensureRuntimeDir keeps an inherited XDG_RUNTIME_DIR only when it is this user's own
 * folder, as setup.sh's _kosmos_own_runtime_dir does (tools/test-setup-xdg-own-8786.sh). Measured on a Cloud box: a root
 * login's /run/user/0 through `runuser` sent `systemctl --user` to root's bus, so units were written and none enabled.
 *
 *   node --test engine/linuxjob.runtimedir-8786.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureRuntimeDir } = require('./linuxjob');

const UID = 1000;
/* A stand-in filesystem: path -> { dir, uid }. */
const fsWith = (entries) => (p) => {
  const e = entries[p];
  if (!e) { const err = new Error('ENOENT'); err.code = 'ENOENT'; throw err; }
  return { isDirectory: () => e.dir, uid: e.uid };
};
const run = (inherited, entries, platform = 'linux') => {
  const env = inherited === undefined ? {} : { XDG_RUNTIME_DIR: inherited };
  ensureRuntimeDir({ platform, env, uid: UID, statSync: fsWith(entries) });
  return env.XDG_RUNTIME_DIR;
};
const OWN = { '/run/user/1000': { dir: true, uid: UID } };

test('unset: this user\'s /run/user/<uid> when it exists, and nothing when it does not', () => {
  assert.equal(run(undefined, OWN), '/run/user/1000');
  assert.equal(run(undefined, {}), undefined);
});

test('CONTROL: this user\'s own folder is kept, wherever it is', () => {
  assert.equal(run('/home/me/rt', { ...OWN, '/home/me/rt': { dir: true, uid: UID } }), '/home/me/rt');
});

test('another user\'s folder (a root login\'s /run/user/0) is replaced by this user\'s own', () => {
  assert.equal(run('/run/user/0', { ...OWN, '/run/user/0': { dir: true, uid: 0 } }), '/run/user/1000');
});

test('a folder that does not exist, or is not a folder, is replaced', () => {
  assert.equal(run('/gone', OWN), '/run/user/1000');
  assert.equal(run('/a-file', { ...OWN, '/a-file': { dir: false, uid: UID } }), '/run/user/1000');
});

test('not Linux: nothing changes', () => {
  assert.equal(run('/run/user/0', { ...OWN, '/run/user/0': { dir: true, uid: 0 } }, 'darwin'), '/run/user/0');
});
