'use strict';

/**
 * kosmos#7593 (the win32 half of #5536 4c-1): an agent in a world a restore made starts with git's hooks and fsmonitor
 * off. childEnv is pure and runs on any host; restoredLaunch and the real-git arm read Windows paths, so they run on
 * win32 only (the Mac half is tested by the supervisor's own tests).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

// Every root this process could reach is a sandbox, and no world is inherited (an agent on this box runs inside one;
// preWorldEnv would then put its real roots back and the checks would read outside this sandbox).
for (const k of Object.keys(process.env)) if (/^(KOSMOS_WORLD|KOSMOS_PRE_WORLD_ROOTS)$/i.test(k)) delete process.env[k];
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-restoreguard-7593-'));
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const launcher = require('./win32launch');
const worlds = require('./worlds');
const rw = require('./restoreworld');

const WIN = process.platform === 'win32';
const GUARD = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: 'NUL', GIT_CONFIG_KEY_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false' };
const pick = (env) => Object.fromEntries(Object.keys(env).filter((k) => /^GIT_CONFIG_/i.test(k)).map((k) => [k, env[k]]));
const NOW = new Date(2026, 10, 11, 13, 0).getTime();

test('a restored launch gets the five keys, hooksPath NUL, replacing any inherited spelling', () => {
  const env = launcher.childEnv({ git_config_count: '5', Git_Config_Key_0: 'x' }, 't', null, null, 'claude', { restoredGit: true });
  assert.deepEqual(pick(env), GUARD);
});

test('an ordinary launch gets none of the five, whatever was inherited, in any spelling', () => {
  const inherited = { GIT_CONFIG_COUNT: '2', git_config_key_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: 'NUL', Git_Config_Key_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false', KEEP: 'y' };
  for (const opts of [undefined, {}, { restoredGit: false }]) {
    const env = launcher.childEnv(inherited, 't', null, null, 'codex', opts);
    assert.deepEqual(pick(env), {}, JSON.stringify(opts));
    assert.equal(env.KEEP, 'y');
  }
  assert.deepEqual(launcher.GIT_GUARD_KEYS, Object.keys(GUARD));
});

test('the mark name the launch looks for is restoreworld\'s', () => {
  assert.equal(launcher.RESTORED_MARK_NAME, rw.RESTORED_MARK, 'the launch copy of the mark name drifted');
  assert.equal(rw.RESTORED_MARK, 'restored-world.json');
});

/* A real Restored world, made by prepareRestoreWorld under this process's sandbox base. */
function restoredWorld() {
  const base = worlds.baseRoot(process.env);
  const p = rw.prepareRestoreWorld(base, { member: 'Ann Lee', now: NOW });
  assert.equal(p.ok, true, JSON.stringify(p));
  const dir = worlds.worldBaseDir(base, p.world);
  return { base, id: p.world.id, dir };
}

test('restoredLaunch: a world prepareRestoreWorld made reads restored; the default world and an ordinary world do not', () => {
  const r = restoredWorld();
  const env = { ...process.env, KOSMOS_WORLD: r.id };
  assert.equal(launcher.restoredLaunch(env, null), true, 'the restored world');
  assert.equal(launcher.restoredLaunch({ ...process.env, kosmos_world: r.id }, null), true, 'KOSMOS_WORLD in another spelling');
  const plain = worlds.createWorld(r.base, 'Plain One');
  assert.equal(launcher.restoredLaunch({ ...process.env, KOSMOS_WORLD: plain.id }, null), false, 'an ordinary world');
  const noWorld = { ...process.env };
  delete noWorld.KOSMOS_WORLD;
  assert.equal(launcher.restoredLaunch(noWorld, null), false, 'the default world');
  assert.equal(launcher.restoredLaunch({ ...noWorld, KOSMOS_WORLD: 'default' }, null), false, 'the default world by name');
});

test('restoredLaunch: with the world ALREADY applied (as in a real launch), the real base is read back; ordinary stays ordinary', () => {
  /* A launch runs inside a process whose roots are the world's own, with the originals recorded in
     KOSMOS_PRE_WORLD_ROOTS (applyAgentWorldEnv). Read naively, the world folder would be taken for the base, no world
     found there, and "not restored" answered: the Mac half's first version did exactly that. */
  const r = restoredWorld();
  const applied = (id) => { const e = { ...process.env, KOSMOS_WORLD: id }; worlds.applyAgentWorldEnv(e); return e; };
  const inRestored = applied(r.id);
  assert.ok(inRestored.KOSMOS_PRE_WORLD_ROOTS, 'the world was applied (the roots moved, the originals recorded)');
  assert.notEqual(worlds.baseRoot(inRestored), r.base, 'the applied roots are the world\'s, not the base');
  assert.equal(launcher.restoredLaunch(inRestored, null), true, 'the restored world, read through the applied roots');
  const plain = worlds.createWorld(r.base, 'Plain Applied');
  assert.equal(launcher.restoredLaunch(applied(plain.id), null), false, 'CONTROL: an ordinary world, applied');
});

test('restoredLaunch: a world id it cannot place reads restored (fails closed)', () => {
  assert.equal(launcher.restoredLaunch({ ...process.env, KOSMOS_WORLD: '..\\..\\x' }, null), true);
});

test('restoredLaunch: the mark two folders above the agent\'s folder counts with no world named; a relative folder is not read', { skip: !WIN && 'Windows paths' }, () => {
  const world = fs.mkdtempSync(path.join(SANDBOX, 'w-'));
  const agent = path.join(world, 'workers', 'ann');
  fs.mkdirSync(agent, { recursive: true });
  const noWorld = { ...process.env };
  delete noWorld.KOSMOS_WORLD;
  assert.equal(launcher.restoredLaunch(noWorld, agent), false, 'CONTROL: no mark yet');
  fs.writeFileSync(path.join(world, 'restored-world.json'), '{}');
  assert.equal(launcher.restoredLaunch(noWorld, agent), true, 'the mark beside the agent');
  assert.equal(launcher.restoredLaunch(noWorld, path.join('workers', 'ann')), false, 'a relative folder');
});

/* Step 4 of the card: a hook-bearing repo in a Restored world, real git. The hook and the fsmonitor command each
   write a file when they run; with the guard neither runs, without it (the control) both do. */
const gitVersion = (() => { try { return cp.execFileSync('git', ['--version'], { encoding: 'utf8' }); } catch { return ''; } })();
const gitOk = (() => { const m = /(\d+)\.(\d+)/.exec(gitVersion); return !!m && (Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 31)); })();

test('real git in a Restored world: the hook and the fsmonitor command do not run with the guard, and do without it', { skip: (!WIN && 'Windows paths') || (!gitOk && 'git 2.31 or later is not on this machine') }, () => {
  const r = restoredWorld();
  const repo = path.join(r.dir, 'workers', 'ann');
  fs.mkdirSync(repo, { recursive: true });
  const git = (args, env) => cp.execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (/^GIT_/i.test(k)) delete clean[k];
  git(['init', '-q'], clean);
  git(['config', 'user.email', 'test@example.invalid'], clean);
  git(['config', 'user.name', 'Test'], clean);
  // The backup's own .git/config: a hooks folder and an fsmonitor command, both writing a file when run.
  const hooks = path.join(repo, 'evil-hooks');
  fs.mkdirSync(hooks);
  const hookRan = path.join(SANDBOX, 'hook-ran-' + Date.now());
  const fsmonRan = path.join(SANDBOX, 'fsmon-ran-' + Date.now());
  const sh = (p) => p.replace(/\\/g, '/');
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho x >> "' + sh(hookRan) + '"\nexit 0\n');
  const fsmon = path.join(repo, 'fsmon.sh');
  fs.writeFileSync(fsmon, '#!/bin/sh\necho x >> "' + sh(fsmonRan) + '"\nexit 1\n');
  git(['config', 'core.hooksPath', sh(hooks)], clean);
  git(['config', 'core.fsmonitor', sh(fsmon)], clean);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  git(['add', 'a.txt'], clean);
  // The setup's own git ran the fsmonitor already (no guard yet): start the arms from nothing.
  for (const f of [hookRan, fsmonRan]) fs.rmSync(f, { force: true });

  // The launch's own answer for this agent: restored, so the guard is on.
  const restored = launcher.restoredLaunch({ ...clean, KOSMOS_WORLD: r.id }, repo);
  assert.equal(restored, true);
  const guarded = launcher.childEnv(clean, 't', null, null, 'claude', { restoredGit: restored });
  git(['status', '--porcelain'], guarded);
  git(['commit', '-q', '-m', 'one'], guarded);
  assert.equal(fs.existsSync(hookRan), false, 'the restored hook ran under the guard');
  assert.equal(fs.existsSync(fsmonRan), false, 'the restored fsmonitor ran under the guard');

  // CONTROL: the same repo with no guard runs both, so the arm above can fail.
  const bare = launcher.childEnv(clean, 't', null, null, 'claude', { restoredGit: false });
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b');
  git(['add', 'b.txt'], bare);
  git(['status', '--porcelain'], bare);
  git(['commit', '-q', '-m', 'two'], bare);
  assert.equal(fs.existsSync(hookRan), true, 'CONTROL: the hook did not run without the guard');
  assert.equal(fs.existsSync(fsmonRan), true, 'CONTROL: fsmonitor did not run without the guard');
});
