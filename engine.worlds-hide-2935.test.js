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

test('the on-disk store survives a hide -- the "your files stay" promise, pinned by a real file', () => {
  const base = freshBase();
  try {
    const a = worlds.createWorld(base, 'Alpha');
    // Drop a real file into the world's store, so we test the promise (files stay) rather than
    // only the registry mechanism. The store dir is where the hint copy says the files remain.
    const storeRoot = worlds.worldStoreRoot(base, a);
    fs.mkdirSync(storeRoot, { recursive: true });
    const marker = path.join(storeRoot, 'kept.txt');
    fs.writeFileSync(marker, 'the user\'s data');

    worlds.hideWorld(base, a.id);

    assert.ok(fs.existsSync(marker), 'hiding deleted a file in the store; the "your files stay" promise is broken');
    assert.equal(fs.readFileSync(marker, 'utf8'), 'the user\'s data', 'the store file survived but its contents did not');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('a hidden world cannot be switched to -- it is not-found (ENOWORLD), never "active but invisible"', () => {
  const base = freshBase();
  try {
    const a = worlds.createWorld(base, 'Alpha');
    worlds.hideWorld(base, a.id);
    // readRegistry keeps the row, but setActiveWorld must treat a hidden world as gone: without
    // this, POST /api/worlds/active {hiddenId} would boot into a world filtered out of the list.
    assert.throws(() => worlds.setActiveWorld(base, a.id), (e) => e.code === 'ENOWORLD');
    assert.equal(worlds.activeWorld(base).id, worlds.DEFAULT_ID, 'a refused switch still moved the active world');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('hiding an already-hidden world is a harmless no-op: the original hiddenAt is kept, not re-stamped', () => {
  const base = freshBase();
  try {
    const a = worlds.createWorld(base, 'Alpha');
    const first = worlds.hideWorld(base, a.id);
    const second = worlds.hideWorld(base, a.id);
    assert.equal(second.hiddenAt, first.hiddenAt, 'a second hide re-stamped hiddenAt instead of being a no-op');
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

test('creating a Kosmos whose name matches a HIDDEN one says so plainly, not "already exists"', () => {
  const base = freshBase();
  try {
    const a = worlds.createWorld(base, 'Client Work');
    worlds.hideWorld(base, a.id);
    // The hidden row keeps the id taken, so a re-create collides -- but the message must name the
    // hidden Kosmos and point at a different name, not read as an internal "a world X already exists".
    assert.throws(() => worlds.createWorld(base, 'Client Work'), (e) => /you hid a Kosmos named "Client Work"/.test(e.message) && /pick a different name/.test(e.message));
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('hiding a world that does not exist is ENOWORLD', () => {
  const base = freshBase();
  try {
    assert.throws(() => worlds.hideWorld(base, 'nope'), (e) => e.code === 'ENOWORLD');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
