/**
 * #2935: soft-delete = HIDE a Kosmos. Josh ruled soft-only: the world drops off the Kosmoses list
 * but the on-disk store stays accessible, so the registry ROW is flagged hidden (never dropped) and
 * `listWorlds` filters it while `readRegistry` keeps it (the store pointer must survive). The default
 * is never hideable and the active world must be switched away from first.
 */
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const worlds = require('./engine/worlds.js');

function freshBase() { return fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-hide-')); }

test('hiding a world drops it from listWorlds but keeps the registry row (store pointer survives)', () => {
  const base = freshBase();
  try {
    const a = worlds.createWorld(base, 'Alpha');
    worlds.createWorld(base, 'Beta');
    assert.deepEqual(worlds.listWorlds(base).map((w) => w.id).sort(), ['alpha', 'beta', 'default'].sort());

    const hidden = worlds.hideWorld(base, a.id);
    assert.equal(hidden.id, a.id);
    assert.ok(typeof hidden.hiddenAt === 'string' && hidden.hiddenAt, 'the row carries a hiddenAt timestamp');

    // Dropped from the user-facing list...
    assert.ok(!worlds.listWorlds(base).some((w) => w.id === a.id), 'listWorlds still shows the hidden world');
    // ...but the row (and thus the store pointer) survives in the registry.
    const keptRow = worlds.readRegistry(base).worlds.find((w) => w.id === a.id);
    assert.ok(keptRow && keptRow.hiddenAt,
      'readRegistry dropped the hidden row, so the promised file pointer is lost');
    // The kept row still carries the base/id that resolve to the on-disk store the copy promises.
    assert.equal(keptRow.id, a.id, 'the hidden row lost its id, so its store can no longer be found');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('the default Kosmos cannot be hidden', () => {
  const base = freshBase();
  try {
    assert.throws(() => worlds.hideWorld(base, worlds.DEFAULT_ID), (e) => e.code === 'ERESERVED');
    assert.ok(worlds.listWorlds(base).some((w) => w.id === worlds.DEFAULT_ID), 'the default is still listed');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('the active world cannot be hidden -- you must switch away first', () => {
  const base = freshBase();
  try {
    const a = worlds.createWorld(base, 'Alpha');
    worlds.setActiveWorld(base, a.id);
    assert.throws(() => worlds.hideWorld(base, a.id), (e) => e.code === 'EACTIVE');
    // After switching away, it hides.
    worlds.setActiveWorld(base, worlds.DEFAULT_ID);
    assert.doesNotThrow(() => worlds.hideWorld(base, a.id));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('hiding a world that does not exist is ENOWORLD', () => {
  const base = freshBase();
  try {
    assert.throws(() => worlds.hideWorld(base, 'nope'), (e) => e.code === 'ENOWORLD');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
