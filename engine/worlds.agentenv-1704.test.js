'use strict';
/**
 * #1704 / #2827: how an AGENT process enters its Kosmos. `applyAgentWorldEnv`
 * turns `KOSMOS_WORLD` into that world's roots, once; `preWorldEnv` undoes it for
 * the paths that must be the same in every world; and the board records the same
 * variable when it boots into a named world.
 *
 *   node --test engine/worlds.agentenv-1704.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const worlds = require('./worlds');

const sandboxes = [];
function sandbox() {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-agentenv-'));
  sandboxes.push(dir);
  return dir;
}
test.after(() => { for (const d of sandboxes) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

test('#1704 the root variables are exactly the ones a world overrides', () => {
  const keys = Object.keys(worlds.envOverridesFor(sandbox(), { id: 'test' })).sort();
  assert.deepEqual(keys, [...worlds.WORLD_ROOT_ENV_VARS].sort());
});

test('#1704 a DEFAULT-world agent is left exactly as it is', () => {
  const env = { AGENT_WORKFORCE_DATA: sandbox() };
  const before = { ...env };
  assert.deepEqual(worlds.applyAgentWorldEnv(env), {});
  assert.deepEqual(env, before);
  const explicit = { KOSMOS_WORLD: 'default' };
  assert.deepEqual(worlds.applyAgentWorldEnv(explicit), {});
  assert.deepEqual(explicit, { KOSMOS_WORLD: 'default' });
});

test('#1704 a NAMED-world agent gets that world\'s roots, derived from the id alone', () => {
  const base = sandbox();
  const env = { AGENT_WORKFORCE_DATA: base, KOSMOS_WORLD: 'test' };
  const expected = worlds.envOverridesFor(worlds.baseRoot({ ...env }), { id: 'test' });
  const applied = worlds.applyAgentWorldEnv(env);
  assert.deepEqual(applied, expected);
  for (const k of Object.keys(expected)) assert.equal(env[k], expected[k], k);
  assert.deepEqual(JSON.parse(env[worlds.PRE_WORLD_ROOTS_ENV_VAR]),
    { AGENT_WORKFORCE_DATA: base, AGENT_WORKFORCE_PROJECTS: null, AGENT_WORKFORCE_WORKERS: null },
    'the originals are recorded, unset ones as null');
});

test('#1704 applying is IDEMPOTENT: an inherited, already-applied environment is not moved twice', () => {
  /* A hook or a `kosmos` command inherits the supervisor's environment, roots and
     marker included. Re-applying from those roots would nest the world inside
     itself (<world>/worlds/<id>), so the marker must stop it. */
  const env = { AGENT_WORKFORCE_DATA: sandbox(), KOSMOS_WORLD: 'test' };
  worlds.applyAgentWorldEnv(env);
  const once = { ...env };
  assert.deepEqual(worlds.applyAgentWorldEnv(env), {});
  assert.deepEqual(env, once);
});

test('#1704 an UNSAFE world id is refused, never joined into a path', () => {
  assert.throws(() => worlds.applyAgentWorldEnv({ AGENT_WORKFORCE_DATA: sandbox(), KOSMOS_WORLD: '../escape' }), /unsafe world id/);
});

test('#1704 preWorldEnv puts back exactly what the world moved, and drops the world', () => {
  const original = { AGENT_WORKFORCE_DATA: sandbox(), AGENT_WORKFORCE_WORKERS: '/mine', OTHER: 'kept', KOSMOS_WORLD: 'test' };
  const env = { ...original };
  worlds.applyAgentWorldEnv(env);
  const { KOSMOS_WORLD, ...withoutWorld } = original; // eslint-disable-line no-unused-vars
  assert.deepEqual(worlds.preWorldEnv(env), withoutWorld);
});

test('#1704 preWorldEnv leaves an UNMARKED root alone: a sandbox is not a world', () => {
  const env = { AGENT_WORKFORCE_DATA: '/sandbox', KOSMOS_WORLD: 'stray' };
  assert.deepEqual(worlds.preWorldEnv(env), { AGENT_WORKFORCE_DATA: '/sandbox' });
});

test('#1704 the BOARD records its world the same way when it boots into a named one', () => {
  const home = sandbox();
  const env = { AGENT_WORKFORCE_DATA: home };
  const base = worlds.baseRoot({ ...env });
  worlds.writeRegistry(base, {
    version: 1, activeWorldId: 'test',
    worlds: [{ id: 'default', name: 'Kosmos 1', createdAt: null, base: null }, { id: 'test', name: 'Test', createdAt: null }],
  });
  const applied = worlds.applyActiveWorldEnv(env, base);
  assert.deepEqual(applied, worlds.envOverridesFor(base, { id: 'test' }));
  assert.equal(env.KOSMOS_WORLD, 'test', 'the board carries the id its agents will be given');
  assert.ok(env[worlds.PRE_WORLD_ROOTS_ENV_VAR], 'and the marker, so its anchor stays machine-level');
});

test('#1704 a board on the DEFAULT world sets no world variable at all', () => {
  const env = { AGENT_WORKFORCE_DATA: sandbox() };
  const before = { ...env };
  assert.deepEqual(worlds.applyActiveWorldEnv(env, worlds.baseRoot({ ...env })), {});
  assert.deepEqual(env, before);
});
