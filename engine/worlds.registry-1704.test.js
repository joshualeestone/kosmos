'use strict';
/*
 * Test for engine/worlds.js (#1704): the multiple-Kosmos registry + create +
 * switch, and the migration guarantee that an install with no registry is the
 * single default world with the legacy roots UNCHANGED.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const worlds = require('./worlds');
const store = require('./store');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-1704-'));
  return dir;
}

// ---- MIGRATION / RELEASE GATE: no registry => single default, roots UNCHANGED ----
test('an install with NO registry is the single default world, active', () => {
  const base = sandbox();
  const reg = worlds.readRegistry(base);
  assert.equal(reg.activeWorldId, worlds.DEFAULT_ID);
  assert.equal(reg.worlds.length, 1);
  assert.equal(reg.worlds[0].id, worlds.DEFAULT_ID);
  assert.equal(reg.worlds[0].base, null, 'the default world has no base -> legacy roots in place');
  assert.equal(worlds.activeWorld(base).id, worlds.DEFAULT_ID);
});

test('RELEASE GATE: the default world sets NO env overrides, so roots resolve exactly as legacy', () => {
  const base = sandbox(); // no worlds.json
  // The env a real board would carry (no world overrides yet).
  const env = { HOME: '/Users/x', AGENT_WORKFORCE_HOME: '/Users/x' };
  const before = JSON.stringify(env);
  const applied = worlds.applyActiveWorldEnv(env, base);
  assert.deepEqual(applied, {}, 'default world applies no overrides');
  assert.equal(JSON.stringify(env), before, 'env is byte-for-byte unchanged (nothing moves)');
  // And the resolved store root equals the legacy resolution.
  const legacy = store.dataRootFor('darwin', '/Users/x', {});
  const afterSwitch = store.dataRootFor('darwin', '/Users/x', env);
  assert.equal(afterSwitch, legacy, 'store root is the legacy path, unchanged by the default world');
});

test('RELEASE GATE (file present): a persisted registry still applies NO overrides for the default', () => {
  const base = sandbox();
  worlds.createWorld(base, 'Acme'); // writes worlds.json with the default entry (base:null) to disk
  assert.ok(fs.existsSync(path.join(base, 'worlds.json')), 'registry now on disk');
  const env = { HOME: '/Users/x', AGENT_WORKFORCE_HOME: '/Users/x' };
  const before = JSON.stringify(env);
  const applied = worlds.applyActiveWorldEnv(env, base); // active is still default
  assert.deepEqual(applied, {}, 'default applies no overrides even with a persisted registry');
  assert.equal(JSON.stringify(env), before, 'env unchanged with the file present (the file-present half of the gate)');
});

test('envOverridesFor is empty for the default world and populated for a named world', () => {
  const base = sandbox();
  assert.deepEqual(worlds.envOverridesFor(base, worlds.defaultWorld()), {});
  const named = { id: 'acme', name: 'Acme', createdAt: null, base: 'worlds/acme' };
  const ov = worlds.envOverridesFor(base, named);
  assert.equal(ov.AGENT_WORKFORCE_DATA, path.join(base, 'worlds', 'acme'));
  assert.equal(ov.AGENT_WORKFORCE_PROJECTS, path.join(base, 'worlds', 'acme', 'projects'));
  assert.equal(ov.AGENT_WORKFORCE_WORKERS, path.join(base, 'worlds', 'acme', 'workers'));
  assert.ok(!('AGENT_WORKFORCE_LAUNCH' in ov), 'launchd path is NOT overridden in v1 (shared system resource)');
});

// ---- create ----
test('createWorld makes the subtrees, appends to the registry, does not switch', () => {
  const base = sandbox();
  const w = worlds.createWorld(base, 'Acme Corp');
  assert.equal(w.id, 'acmecorp', 'safeKey lowercases + strips spaces');
  assert.equal(w.name, 'Acme Corp');
  assert.ok(w.createdAt, 'createdAt is stamped');
  assert.ok(fs.existsSync(path.join(base, 'worlds', 'acmecorp', 'AgentWorkforce')));
  assert.ok(fs.existsSync(path.join(base, 'worlds', 'acmecorp', 'projects')));
  assert.ok(fs.existsSync(path.join(base, 'worlds', 'acmecorp', 'workers')));
  const reg = worlds.readRegistry(base);
  assert.ok(reg.worlds.some((x) => x.id === 'acmecorp'), 'registered');
  assert.equal(reg.activeWorldId, worlds.DEFAULT_ID, 'create does NOT switch active');
});

test('createWorld refuses a duplicate and the reserved default id', () => {
  const base = sandbox();
  worlds.createWorld(base, 'Acme');
  assert.throws(() => worlds.createWorld(base, 'Acme'), /already exists/);
  assert.throws(() => worlds.createWorld(base, 'default'), /reserved/);
  assert.throws(() => worlds.createWorld(base, '  '), /invalid/, 'an empty-after-sanitize name is refused (store.safeKey)');
});

test('CONTROL: a traversal name cannot escape the worlds base', () => {
  const base = sandbox();
  // safeKey strips everything but [a-z0-9_-], so "../../etc" -> "etc": no separators survive.
  const w = worlds.createWorld(base, '../../etc/passwd');
  assert.equal(w.id.indexOf('/'), -1, 'no path separator in the id');
  assert.equal(w.id.indexOf('.'), -1, 'no dot in the id');
  assert.ok(fs.existsSync(path.join(base, 'worlds', w.id)), 'the world dir is inside the base');
  assert.ok(!fs.existsSync('/etc/worlds'), 'nothing was written outside the base');
});

// ---- switch ----
test('setActiveWorld switches the pointer and refuses an unknown id', () => {
  const base = sandbox();
  worlds.createWorld(base, 'Acme');
  const active = worlds.setActiveWorld(base, 'acme');
  assert.equal(active.id, 'acme');
  assert.equal(worlds.readRegistry(base).activeWorldId, 'acme', 'persisted');
  assert.throws(() => worlds.setActiveWorld(base, 'nope'), /no such world/);
});

test('applyActiveWorldEnv sets the named world env after a switch', () => {
  const base = sandbox();
  worlds.createWorld(base, 'Acme');
  worlds.setActiveWorld(base, 'acme');
  const env = {};
  const applied = worlds.applyActiveWorldEnv(env, base);
  assert.equal(env.AGENT_WORKFORCE_DATA, path.join(base, 'worlds', 'acme'));
  assert.equal(env.AGENT_WORKFORCE_PROJECTS, path.join(base, 'worlds', 'acme', 'projects'));
  assert.equal(applied.AGENT_WORKFORCE_DATA, env.AGENT_WORKFORCE_DATA);
  // And the store root for the switched world nests under its base (APP appended).
  assert.equal(store.dataRootFor('darwin', '/Users/x', env), path.join(base, 'worlds', 'acme', 'AgentWorkforce'));
});

// ---- registry lock (#1704 slice 2): serialize the read-modify-write ----
const LOCK = '.worlds.json.lock';
test('a HELD lock makes a write fail fast (retryable), and releasing it lets the op proceed', () => {
  const base = sandbox();
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(path.join(base, LOCK)); // another board holds it (fresh mtime)
  assert.throws(() => worlds.createWorld(base, 'Acme'), /in progress/, 'fail fast, not a hang');
  assert.throws(() => worlds.setActiveWorld(base, 'default'), /in progress/, 'switch is locked too');
  fs.rmdirSync(path.join(base, LOCK)); // the other board finished
  assert.equal(worlds.createWorld(base, 'Acme').id, 'acme', 'proceeds once released');
});

test('a STALE lock (crashed holder, mtime > 10s) is broken and the op proceeds', () => {
  const base = sandbox();
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(path.join(base, LOCK));
  const old = (Date.now() - 20000) / 1000; // 20s ago
  fs.utimesSync(path.join(base, LOCK), old, old);
  assert.equal(worlds.createWorld(base, 'Acme').id, 'acme', 'breaks the stale lock and proceeds');
});

test('the lock is RELEASED after each write (no leak), so consecutive writes both land', () => {
  const base = sandbox();
  worlds.createWorld(base, 'One');
  worlds.createWorld(base, 'Two'); // would fail fast if the first leaked the lock
  assert.deepEqual(worlds.listWorlds(base).map((w) => w.id).sort(), ['default', 'one', 'two']);
  assert.ok(!fs.existsSync(path.join(base, LOCK)), 'lock dir cleaned up');
});

// ---- fail-safe registry ----
test('a malformed registry FAILS SAFE to the default world', () => {
  const base = sandbox();
  fs.writeFileSync(path.join(base, 'worlds.json'), 'not json{{{');
  const reg = worlds.readRegistry(base);
  assert.equal(reg.activeWorldId, worlds.DEFAULT_ID);
  assert.equal(reg.worlds[0].id, worlds.DEFAULT_ID);
});

test('a registry missing the default world re-adds it, and an unknown active pointer resets to default', () => {
  const base = sandbox();
  fs.writeFileSync(path.join(base, 'worlds.json'), JSON.stringify({
    version: 1, activeWorldId: 'ghost', worlds: [{ id: 'acme', name: 'Acme', createdAt: null, base: 'worlds/acme' }],
  }));
  const reg = worlds.readRegistry(base);
  assert.ok(reg.worlds.some((w) => w.id === worlds.DEFAULT_ID), 'default re-added (legacy data never orphaned)');
  assert.equal(reg.activeWorldId, worlds.DEFAULT_ID, 'unknown active pointer reset to default');
});

test('CONTROL: a traversing id in a hand-edited registry is DROPPED on read, never honored', () => {
  const base = sandbox();
  fs.writeFileSync(path.join(base, 'worlds.json'), JSON.stringify({
    version: 1, activeWorldId: 'default',
    worlds: [{ id: '../../evil', name: 'evil', createdAt: null, base: 'worlds/../../evil' }],
  }));
  const reg = worlds.readRegistry(base);
  assert.ok(!reg.worlds.some((w) => w.id === '../../evil'), 'the traversing id is dropped, not trusted');
  assert.ok(reg.worlds.some((w) => w.id === worlds.DEFAULT_ID), 'default re-added');
  // No surviving world resolves to a path outside <base>/worlds.
  for (const w of reg.worlds) {
    const dir = worlds.worldBaseDir(base, w);
    if (dir) assert.ok(dir.startsWith(path.join(base, 'worlds') + path.sep), `${w.id} stays under base/worlds`);
  }
});

test('worldBaseDir THROWS on a non-clean id passed directly (the guard travels with the join)', () => {
  const base = sandbox();
  // A world object obtained from a source other than readRegistry (e.g. a request body).
  assert.throws(() => worlds.worldBaseDir(base, { id: '../../evil' }), /unsafe world id/);
  assert.throws(() => worlds.envOverridesFor(base, { id: 'has space' }), /unsafe world id/);
  assert.equal(worlds.worldBaseDir(base, worlds.defaultWorld()), null, 'default still returns null, no throw');
  assert.ok(worlds.worldBaseDir(base, { id: 'acme' }).endsWith(path.join('worlds', 'acme')), 'a clean id joins normally');
});

test('writeRegistry is atomic (round-trips through a rename)', () => {
  const base = sandbox();
  const reg = worlds.readRegistry(base); // synthesized default (no file yet)
  worlds.writeRegistry(base, reg);
  assert.ok(fs.existsSync(path.join(base, 'worlds.json')));
  const back = JSON.parse(fs.readFileSync(path.join(base, 'worlds.json'), 'utf8'));
  assert.equal(back.activeWorldId, worlds.DEFAULT_ID);
});
