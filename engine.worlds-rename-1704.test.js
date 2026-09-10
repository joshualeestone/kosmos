'use strict';

/**
 * #1704 item 14.1 (Josh, 2026-09-05): rename a Kosmos via the switcher, WITHOUT
 * breaking its file/folder/project/document structure. These tests pin the engine
 * guarantee that makes the rename safe: it changes ONLY the display name; the id and
 * base are immutable, so a world's data location (worldBaseDir) is unchanged by a
 * rename. Plus the typed refusals (default reserved, empty name, unknown id).
 *
 *   node --test engine.worlds-rename-1704.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const worlds = require('./engine/worlds');

function freshBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-worlds-rename-'));
}

test('#1704 14.1: renaming a world changes ONLY its display name; id and base (its data location) are unchanged', () => {
  const base = freshBase();
  const made = worlds.createWorld(base, 'My First Draft');
  const idBefore = made.id;
  const baseBefore = made.base;
  const dirBefore = worlds.worldBaseDir(base, made);   // where the world's data lives

  const renamed = worlds.renameWorld(base, made.id, 'Client Work');
  assert.equal(renamed.name, 'Client Work', 'the display name is updated');
  assert.equal(renamed.id, idBefore, 'the id is immutable across a rename');
  assert.equal(renamed.base, baseBefore, 'the stored base is unchanged');

  // Read it back fresh: the rename persisted, and the data location did not move.
  const reg = worlds.readRegistry(base);
  const w = reg.worlds.find((x) => x.id === idBefore);
  assert.ok(w, 'the world is still present under its original id');
  assert.equal(w.name, 'Client Work', 'the rename persisted to the registry');
  assert.equal(worlds.worldBaseDir(base, w), dirBefore, 'the world resolves to the SAME data dir after the rename');
});

test('#1704 14.1: the default world cannot be renamed (ERESERVED); its name stays "Kosmos 1"', () => {
  const base = freshBase();
  assert.throws(() => worlds.renameWorld(base, worlds.DEFAULT_ID, 'My Home'),
    (e) => e && e.code === 'ERESERVED', 'renaming the default is refused with a typed error');
  const def = worlds.readRegistry(base).worlds.find((w) => w.id === worlds.DEFAULT_ID);
  assert.equal(def.name, 'Kosmos 1', 'the default keeps its constant name');
});

test('#1704 14.1: an empty or whitespace name is refused (EBADNAME)', () => {
  const base = freshBase();
  const made = worlds.createWorld(base, 'Keeps Its Name');
  for (const bad of ['', '   ', '\t\n', null, undefined]) {
    assert.throws(() => worlds.renameWorld(base, made.id, bad),
      (e) => e && e.code === 'EBADNAME', `an empty name (${JSON.stringify(bad)}) is refused`);
  }
  // Control: the name did not change on any of the refused attempts.
  assert.equal(worlds.readRegistry(base).worlds.find((w) => w.id === made.id).name, 'Keeps Its Name');
});

test('#1704 14.1: renaming an unknown world is refused (ENOWORLD)', () => {
  const base = freshBase();
  assert.throws(() => worlds.renameWorld(base, 'no-such-world', 'Whatever'),
    (e) => e && e.code === 'ENOWORLD', 'an unknown id is refused with a typed error');
});

test('#1704 14.1: the name is trimmed', () => {
  const base = freshBase();
  const made = worlds.createWorld(base, 'Before');
  const renamed = worlds.renameWorld(base, made.id, '  Spaced Out  ');
  assert.equal(renamed.name, 'Spaced Out', 'leading/trailing whitespace is trimmed');
});
