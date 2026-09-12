'use strict';
/*
 * #2563 / #1704 PR4: the per-world path helpers the import reads and writes through --
 * worldProfileNames (a Kosmos's agents), and the profiles / avatars / workers folders of a
 * Kosmos this process is not serving.
 *
 * The whole-world, first-wins worlds.importAgents this file used to test is gone: agents
 * are now copied one at a time, completely, by engine/worldimport.js, whose suite
 * (engine/worldimport.test.js) carries the copy, collision and refusal cases.
 *
 *   node --test engine.worlds-import-2563.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-import-2563-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const worlds = require('./engine/worlds');
const store = require('./engine/store');

function sandbox() { return fs.mkdtempSync(path.join(SANDBOX, 'base-')); }
function seedAgent(base, world, name) {
  const dir = worlds.worldProfilesDir(base, world);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ displayName: name }));
}

test('worldProfileNames: none for a fresh Kosmos, the sorted names after seeding, and a .tmp is not an agent', () => {
  const base = sandbox();
  const a = worlds.createWorld(base, 'Acme');
  assert.deepEqual(worlds.worldProfileNames(base, a), [], 'a fresh world holds no agents (no profiles dir yet)');
  seedAgent(base, a, 'bob');
  seedAgent(base, a, 'alice');
  fs.writeFileSync(path.join(worlds.worldProfilesDir(base, a), 'carol.json.tmp'), '{}');
  assert.deepEqual(worlds.worldProfileNames(base, a), ['alice', 'bob']);
  seedAgent(base, worlds.defaultWorld(), 'dave');
  assert.deepEqual(worlds.worldProfileNames(base, worlds.defaultWorld()), ['dave'], 'the default world lists its own profiles');
});

test('a Kosmos\'s profiles and avatars folders are the store\'s own folder names under that Kosmos\'s store', () => {
  const base = sandbox();
  const a = worlds.createWorld(base, 'Acme');
  const storeRoot = worlds.worldStoreRoot(base, a);
  assert.equal(worlds.worldProfilesDir(base, a), path.join(storeRoot, store.PROFILES_DIRNAME));
  assert.equal(worlds.worldAvatarsDir(base, a), path.join(storeRoot, store.AVATARS_DIRNAME));
  assert.equal(worlds.worldStoreRoot(base, worlds.defaultWorld()), base, 'the default world\'s store is the base itself');
});

test('worldWorkersDir: a named Kosmos\'s under its base, the default one\'s where the person keeps it', () => {
  const base = sandbox();
  const a = worlds.createWorld(base, 'Acme');
  assert.equal(worlds.worldWorkersDir(base, a, {}), path.join(worlds.worldBaseDir(base, a), 'workers'));
  assert.equal(worlds.worldWorkersDir(base, worlds.defaultWorld(), { AGENT_WORKFORCE_WORKERS: '/mine/workers' }), '/mine/workers');
  // A process serving a NAMED world still finds the default world's workers from the recorded originals.
  const insideNamed = {
    AGENT_WORKFORCE_WORKERS: '/named/workers',
    KOSMOS_WORLD: 'acme',
    [worlds.PRE_WORLD_ROOTS_ENV_VAR]: JSON.stringify({ world: 'acme', roots: { AGENT_WORKFORCE_WORKERS: '/mine/workers', AGENT_WORKFORCE_DATA: null, AGENT_WORKFORCE_PROJECTS: null } }),
  };
  assert.equal(worlds.worldWorkersDir(base, worlds.defaultWorld(), insideNamed), '/mine/workers',
    'the default Kosmos\'s workers were taken from the named world this process serves');
});

test('one derivation: the workers folder this process uses IS the default world\'s worldWorkersDir', () => {
  const create = require('./engine/create');
  const base = sandbox();
  assert.equal(worlds.worldWorkersDir(base, worlds.defaultWorld()), create.WORKERS_DIR,
    'create.workersDir and worlds.worldWorkersDir disagree about where agents\' folders live');
});
