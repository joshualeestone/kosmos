'use strict';

/**
 * #1704 item 14.2 (Josh, 2026-09-05 fresh-install feedback): the default/first
 * world is called "Kosmos 1" so a person understands it is the first one, sitting
 * alongside "Add a new Kosmos".
 *
 * The name is a display constant, not user data: the default world keeps id
 * 'default' and base:null (legacy roots in place), so the label moves nothing.
 * These tests pin the things a presence-only check would miss:
 *   - a fresh install (no registry) synthesizes the default as "Kosmos 1";
 *   - a registry PERSISTED with the old name is normalized on read, so two
 *     installs never disagree about what the same default world is called;
 *   - activeWorld() and the malformed-registry fail-safe both report "Kosmos 1"
 *     (the paths that do NOT run the name-force loop);
 *   - a NAMED world's name is left exactly as written -- normalization touches
 *     only the default entry.
 *
 * Each test drives readRegistry against its OWN temp base, so a wrong-name arm
 * can genuinely fail rather than reading some other test's state.
 *
 *   node --test engine.worlds-default-name-1704.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const worlds = require('./engine/worlds');

function freshBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-worlds-name-'));
}

test('#1704 14.2: a fresh install (no registry) synthesizes the default as "Kosmos 1"', () => {
  const base = freshBase();
  // Positive control: prove the base really is registry-less, so the name we read
  // comes from the synthesized default and not from a leftover file.
  assert.equal(fs.existsSync(worlds.registryPath(base)), false, 'no registry file yet');

  const reg = worlds.readRegistry(base);
  const def = reg.worlds.find((w) => w.id === worlds.DEFAULT_ID);
  assert.ok(def, 'the default world is present');
  assert.equal(def.name, 'Kosmos 1', 'the synthesized default is named "Kosmos 1"');
  // defaultWorld() is the same source the board and activeWorld() fall back to.
  assert.equal(worlds.defaultWorld().name, 'Kosmos 1', 'defaultWorld() agrees');
});

test('#1704 14.2: a registry persisted with the OLD name is normalized to "Kosmos 1" on read', () => {
  const base = freshBase();
  // Simulate a pre-14.2 install: the default entry was frozen into worlds.json with
  // the old display name when a second world was created.
  worlds.writeRegistry(base, {
    version: 1,
    activeWorldId: 'default',
    worlds: [
      { id: 'default', name: 'Kosmos', createdAt: null, base: null },
      { id: 'sidewrld', name: 'Side World', createdAt: '2026-01-01T00:00:00.000Z', base: 'worlds/sidewrld' },
    ],
  });
  // Control: the file on disk really does carry the OLD name, so the assertion
  // below is measuring normalization and not a file that was already correct.
  assert.match(fs.readFileSync(worlds.registryPath(base), 'utf8'), /"name": "Kosmos"/,
    'the persisted file carries the pre-14.2 name');

  const reg = worlds.readRegistry(base);
  const def = reg.worlds.find((w) => w.id === 'default');
  assert.equal(def.name, 'Kosmos 1', 'the persisted default name is normalized on read');

  const side = reg.worlds.find((w) => w.id === 'sidewrld');
  assert.ok(side, 'the named world survives');
  assert.equal(side.name, 'Side World', 'a NAMED world name is left untouched by normalization');
});

test('#1704 14.2: activeWorld() on a fresh install returns the default named "Kosmos 1"', () => {
  const base = freshBase();
  assert.equal(fs.existsSync(worlds.registryPath(base)), false, 'no registry file yet');
  const active = worlds.activeWorld(base);
  assert.equal(active.id, worlds.DEFAULT_ID, 'the active world is the default');
  assert.equal(active.name, 'Kosmos 1', 'activeWorld() reports the default as "Kosmos 1"');
});

test('#1704 14.2: a malformed registry fail-safes to the default named "Kosmos 1"', () => {
  const base = freshBase();
  // A hand-corrupted worlds.json (not valid JSON) must fail SAFE to the default world,
  // and that default must carry the new name -- not leave the fallback showing the old one.
  fs.writeFileSync(worlds.registryPath(base), '{ this is not json');
  // Control: prove the file is genuinely unparseable, so we are exercising the
  // fail-safe path and not a happy read.
  assert.throws(() => JSON.parse(fs.readFileSync(worlds.registryPath(base), 'utf8')),
    'the on-disk registry is genuinely malformed');

  const reg = worlds.readRegistry(base);
  const def = reg.worlds.find((w) => w.id === worlds.DEFAULT_ID);
  assert.ok(def, 'the fail-safe still yields the default world');
  assert.equal(def.name, 'Kosmos 1', 'the fail-safe default is named "Kosmos 1"');
});

test('#1704 14.2: a freshly created world keeps its own name; the default it persists alongside is "Kosmos 1"', () => {
  const base = freshBase();
  const made = worlds.createWorld(base, 'My Second Kosmos');
  assert.equal(made.name, 'My Second Kosmos', 'createWorld returns the world under its given name');

  // createWorld writes the WHOLE registry (default entry included). On the next read
  // the default is "Kosmos 1" and the created world keeps its name.
  const reg = worlds.readRegistry(base);
  const def = reg.worlds.find((w) => w.id === 'default');
  assert.equal(def.name, 'Kosmos 1', 'the default persisted alongside a new world reads as "Kosmos 1"');
  const mine = reg.worlds.find((w) => w.id === made.id);
  assert.equal(mine.name, 'My Second Kosmos', 'the created world keeps its own name');
});
