'use strict';
/**
 * #1704 / #2827: the anchored boot shim is where a Windows agent enters its
 * Kosmos, and the anchor itself must stay ONE machine-level directory for every
 * world.
 *
 * The shim is run for real, as the task runs it, against a stand-in engine made of
 * the REAL worlds.js / store.js / launchidentity.js / win32argv.js and a stub
 * supervisor that reports the environment it was loaded under. That is the
 * property that matters: the world's roots must be in place BEFORE the supervisor
 * (and everything it requires) is loaded.
 *
 *   node --test engine/win32anchor.world-1704.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const anchor = require('./win32anchor');
const worlds = require('./worlds');
const store = require('./store');

const sandboxes = [];
function sandbox() {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-anchorworld-'));
  sandboxes.push(dir);
  return dir;
}
test.after(() => { for (const d of sandboxes) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

test('#1704 a board serving a NAMED world still anchors at the machine-level runtime', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\jo\\AppData\\Local',
    AGENT_WORKFORCE_DATA: 'C:\\Users\\jo\\AppData\\Roaming\\Kosmos\\worlds\\test',
    KOSMOS_WORLD: 'test',
    [worlds.PRE_WORLD_ROOTS_ENV_VAR]: JSON.stringify({ world: 'test', roots: { AGENT_WORKFORCE_DATA: null, AGENT_WORKFORCE_PROJECTS: null, AGENT_WORKFORCE_WORKERS: null } }),
  };
  assert.equal(anchor.anchorDir('win32', 'C:\\Users\\jo', env),
    'C:\\Users\\jo\\AppData\\Local\\' + store.APP + '\\runtime',
    'one interpreter and one pointer for every world, never one per world');
});

test('#1704 a world applied OVER a sandbox anchors in the sandbox, not the world', () => {
  const env = {
    AGENT_WORKFORCE_DATA: 'C:\\sand\\Kosmos\\worlds\\test',
    KOSMOS_WORLD: 'test',
    [worlds.PRE_WORLD_ROOTS_ENV_VAR]: JSON.stringify({ world: 'test', roots: { AGENT_WORKFORCE_DATA: 'C:\\sand', AGENT_WORKFORCE_PROJECTS: null, AGENT_WORKFORCE_WORKERS: null } }),
  };
  assert.equal(anchor.anchorDir('win32', 'C:\\Users\\jo', env), 'C:\\sand\\' + store.APP + '\\runtime');
});

/* A stand-in engine: the real world-entry modules, and a supervisor that prints
   what it was loaded under. */
function standInEngine(opts) {
  const o = opts || {};
  const engine = nodePath.join(sandbox(), 'engine');
  fs.mkdirSync(engine, { recursive: true });
  /* `old: true` is an engine from before worlds reached agents: no parser, no
     agent bootstrap. */
  const files = o.old ? ['store.js'] : ['worlds.js', 'store.js', 'launchidentity.js', 'win32argv.js'];
  for (const f of files) fs.copyFileSync(nodePath.join(__dirname, f), nodePath.join(engine, f));
  /* The stub reports the environment AND the store root the supervisor would
     resolve: the store's own answer is what the ordering exists to get right, so
     a future load-time freeze in store.js or worlds.js would show here (review
     round 1). */
  fs.writeFileSync(nodePath.join(engine, 'win32supervisor.js'),
    'let root = null; try { root = require("./store").ROOT; } catch (e) { root = "ERR " + e.message; }\n'
    + 'const seen = { world: process.env.KOSMOS_WORLD || null, data: process.env.AGENT_WORKFORCE_DATA || null, workers: process.env.AGENT_WORKFORCE_WORKERS || null, root };\n'
    + 'exports.main = (argv) => { process.stdout.write(JSON.stringify(Object.assign(seen, { argv }))); };\n', 'utf8');
  const runtime = sandbox();
  fs.writeFileSync(nodePath.join(runtime, 'supervisor-boot.js'), anchor.BOOT_JS, 'utf8');
  fs.writeFileSync(nodePath.join(runtime, 'engine-path'), engine, 'utf8');
  return nodePath.join(runtime, 'supervisor-boot.js');
}

/* The environment a task starts with: the logon env, with no world in it. */
function logonEnv(extra) {
  const env = worlds.preWorldEnv(process.env);
  for (const k of worlds.WORLD_ROOT_ENV_VARS) delete env[k];
  return Object.assign(env, extra || {});
}

test('#1704 THE SHIM ENTERS A NAMED WORLD BEFORE THE SUPERVISOR LOADS', () => {
  const boot = standInEngine();
  const data = sandbox();
  const env = logonEnv({ AGENT_WORKFORCE_DATA: data });
  const out = cp.spawnSync(process.execPath, [boot, 'ava', 'C:\\work\\ava', '-', '-', 'claude', '-', 'test'], { encoding: 'utf8', env });
  assert.equal(out.status, 0, out.stderr);
  const seen = JSON.parse(out.stdout);
  const expected = worlds.envOverridesFor(worlds.baseRoot(env), { id: 'test' });
  assert.equal(seen.world, 'test');
  assert.equal(seen.data, expected.AGENT_WORKFORCE_DATA, 'the supervisor was loaded under the WORLD\'s store root');
  assert.equal(seen.workers, expected.AGENT_WORKFORCE_WORKERS);
  assert.equal(seen.root, nodePath.join(expected.AGENT_WORKFORCE_DATA, store.APP),
    'and the STORE itself resolves the world\'s root, not the default one');
  assert.deepEqual(seen.argv, ['ava', 'C:\\work\\ava', '-', '-', 'claude', '-', 'test'], 'and still gets its argv untouched');
});

test('#1704 a NAMED-world task on an engine too old for worlds REFUSES instead of running in the default world', () => {
  /* The rollback case: a by-hand unzip of an older build puts the pointer on an
     engine that ignores field 7, so the agent would quietly read the default
     world's store and serve the bare pipe (review round 1). */
  const boot = standInEngine({ old: true });
  const out = cp.spawnSync(process.execPath, [boot, 'ava', 'C:\\work\\ava', '-', '-', 'claude', '-', 'test'],
    { encoding: 'utf8', env: logonEnv({ AGENT_WORKFORCE_DATA: sandbox() }) });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /too old to run it there/);
  assert.equal(out.stdout, '', 'the supervisor never loaded');
});

test('#1704 a DEFAULT-world task on an engine too old for worlds still runs, as it always did', () => {
  const boot = standInEngine({ old: true });
  const data = sandbox();
  const out = cp.spawnSync(process.execPath, [boot, 'ava', 'C:\\work\\ava', '-', '-', 'claude', '-'],
    { encoding: 'utf8', env: logonEnv({ AGENT_WORKFORCE_DATA: data }) });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).data, data);
});

test('#1704 a DEFAULT-world task (six arguments) is run exactly as before', () => {
  const boot = standInEngine();
  const data = sandbox();
  const out = cp.spawnSync(process.execPath, [boot, 'ava', 'C:\\work\\ava', '-', '-', 'claude', '-'],
    { encoding: 'utf8', env: logonEnv({ AGENT_WORKFORCE_DATA: data }) });
  assert.equal(out.status, 0, out.stderr);
  const seen = JSON.parse(out.stdout);
  assert.equal(seen.world, null);
  assert.equal(seen.data, data, 'no world, no override');
});

test('#1704 an agent that cannot enter its Kosmos STOPS, loudly and non-zero', () => {
  /* Running on against the default world's store would be the silent failure
     #2827 describes, so an unenterable world must look like a failed start. */
  const boot = standInEngine();
  const out = cp.spawnSync(process.execPath, [boot, 'ava', 'C:\\work\\ava', '-', '-', 'claude', '-', '../escape'],
    { encoding: 'utf8', env: logonEnv({ AGENT_WORKFORCE_DATA: sandbox() }) });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /could not enter its Kosmos/);
  assert.equal(out.stdout, '', 'the supervisor never loaded');
});
