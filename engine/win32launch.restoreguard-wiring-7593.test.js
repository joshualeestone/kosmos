'use strict';

/**
 * kosmos#7593: the guard reaches every place a Windows agent's environment is built, through the real code: launch(),
 * launchStreaming() and the per-turn supervisor (codex, gemini, grok, antigravity). Each agent's folder sits at
 * <world>\workers\<name>; a restore mark at <world>\restored-world.json makes the world a Restored one (the rule that
 * needs no base), and the same folder without the mark is the control. Windows paths, so win32 only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// No inherited world: an agent on this box runs inside one, and these arms must read only this sandbox.
for (const k of Object.keys(process.env)) if (/^(KOSMOS_WORLD|KOSMOS_PRE_WORLD_ROOTS)$/i.test(k)) delete process.env[k];
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'restoreguard-wiring-7593-')));
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));
process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS = path.join(SANDBOX, 'settings.json');

const launcher = require('./win32launch');
const { superviseCodexStreaming } = require('./win32codexsup');

const WIN = process.platform === 'win32';
const SKIP = !WIN && 'Windows paths';
test.after(() => {
  launcher.setSpawn(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

let n = 0;
/* An agent folder at <world>\workers\<name>, the world marked restored or not. */
function agentFolder(restored) {
  const world = path.join(SANDBOX, 'world-' + (n += 1));
  const cwd = path.join(world, 'workers', 'ann');
  fs.mkdirSync(cwd, { recursive: true });
  if (restored) fs.writeFileSync(path.join(world, 'restored-world.json'), '{}');
  return fs.realpathSync(cwd);
}
const guarded = (env) => env.GIT_CONFIG_COUNT === '2' && env.GIT_CONFIG_KEY_0 === 'core.hooksPath' && env.GIT_CONFIG_VALUE_0 === 'NUL'
  && env.GIT_CONFIG_KEY_1 === 'core.fsmonitor' && env.GIT_CONFIG_VALUE_1 === 'false';
const none = (env) => !Object.keys(env).some((k) => /^GIT_CONFIG_(COUNT|KEY_[01]|VALUE_[01])$/i.test(k));

test('launch(): a Restored agent spawns with the guard; the same folder unmarked spawns without it', { skip: SKIP }, () => {
  for (const restored of [true, false]) {
    const calls = [];
    launcher.setSpawn((cmd, argv, opts) => { calls.push(opts); return { pid: 4242, unref() {} }; });
    const r = launcher.launch({ name: 'rg-launch-' + restored, runner: 'claude', cwd: agentFolder(restored), platform: 'win32' });
    assert.equal(r.ok, true, r.because || '');
    assert.equal(calls.length, 1);
    assert.ok(restored ? guarded(calls[0].env) : none(calls[0].env), (restored ? 'restored' : 'CONTROL') + ': ' + JSON.stringify(Object.keys(calls[0].env).filter((k) => /^GIT_/i.test(k))));
  }
});

test('launchStreaming(): the same', { skip: SKIP }, () => {
  for (const restored of [true, false]) {
    const calls = [];
    launcher.setSpawn((cmd, argv, opts) => { calls.push(opts); return { pid: 4243, stdin: {}, unref() {} }; });
    const r = launcher.launchStreaming({ name: 'rg-stream-' + restored, cwd: agentFolder(restored), claudeBin: process.execPath, platform: 'win32' });
    assert.equal(r.ok, true, r.because || '');
    assert.equal(calls.length, 1);
    assert.ok(restored ? guarded(calls[0].env) : none(calls[0].env), restored ? 'restored' : 'CONTROL');
  }
});

/* The per-turn supervisor, through its own env build (no `env` seam), with the turn captured by the runTurn seam. */
async function turnEnvFor(runner, restored) {
  const seen = [];
  const events = [];
  const h = superviseCodexStreaming({ name: 'rg-' + runner + '-' + restored, cwd: agentFolder(restored), runner }, {
    bin: 'C:\\K\\' + runner + '.exe',
    prepare: () => ({ ok: true, sessionId: '11111111-1111-4111-8111-111111111111', token: 'tok', instance: null }),
    runTurn: (t) => { seen.push(t.env); return Promise.resolve({ ok: true }); },
    cliDir: null,
    sessions: { pruneName: () => ({ ok: true, removed: 0 }) },
    reportIdle: () => null,
    lastReport: () => null,
    codexHookDeps: { execFile: () => {}, install: () => ({ ok: true }), bridge: null, personHomes: [], canonical: (p) => p },
    onEvent: (e) => events.push(e.action),
  });
  await new Promise((res) => h.send('hi', res));
  for (let i = 0; i < 200 && !seen.length; i++) await new Promise((res) => setTimeout(res, 10));
  h.stop();
  assert.equal(seen.length, 1, runner + ': no turn ran (' + events.join(',') + ')');
  return seen[0];
}

for (const runner of ['codex', 'gemini', 'grok', 'antigravity']) {
  test('the per-turn supervisor (' + runner + '): a Restored agent\'s turns run with the guard; unmarked, without', { skip: SKIP }, async () => {
    assert.ok(guarded(await turnEnvFor(runner, true)), 'restored');
    assert.ok(none(await turnEnvFor(runner, false)), 'CONTROL');
  });
}
