'use strict';
// #2698: the org-chart view kept showing an agent's OLD profile image after an
// update, because its avatar URL was bare and its repaint was skipped as
// unchanged. store.avatarVersion gives the URL a value that MOVES when the
// picture changes, so the markup differs and the view refreshes. These pin that
// the version tracks the avatar file: 0 with none, the file mtime with one, a
// different value after a change, and back to 0 once removed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'avatarver-'));
const store = require('./store');

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

test('no avatar reads as version 0', () => {
  assert.equal(store.avatarVersion('nopic'), 0);
});

test('a stored avatar versions to its file mtime, and it is non-zero', () => {
  const file = store.saveAvatar('picagent', 'image/png', PNG);
  const ver = store.avatarVersion('picagent');
  assert.ok(ver > 0, 'a stored avatar must have a non-zero version');
  assert.equal(ver, Math.round(fs.statSync(file).mtimeMs), 'the version must be the avatar file mtime');
});

test('changing the avatar changes the version (the whole point of #2698)', () => {
  store.saveAvatar('changer', 'image/png', PNG);
  const before = store.avatarVersion('changer');
  // Push the file's mtime forward the way a real re-save would move it, then
  // re-read: a new picture must not read as the same version as the old one.
  const file = store.avatarPath('changer');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  const after = store.avatarVersion('changer');
  assert.notEqual(after, before, 'a changed avatar must produce a different version');
  assert.equal(after, Math.round(later.getTime()));
});

test('removing the avatar returns to version 0', () => {
  store.saveAvatar('goner', 'image/png', PNG);
  assert.ok(store.avatarVersion('goner') > 0);
  store.removeAvatar('goner');
  assert.equal(store.avatarVersion('goner'), 0);
});
