'use strict';
/*
 * kosmos#4353: at board start, write Kosmos's report hook for every agy agent that is already
 * running, because its old supervisor never will and the board does not restart it.
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agyrefresh-4353-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const test = require('node:test');
const assert = require('node:assert/strict');
const agyrefresh = require('./engine/agyrefresh');
const agyhooks = require('./engine/agyhooks');
const create = require('./engine/create');

function fakes(jobs, versions = {}) {
  const calls = { ensure: [], version: [] };
  return {
    calls,
    deps: {
      names: () => new Set(Object.keys(jobs)),
      job: (n) => jobs[n] || null,
      ensureHooks: (...a) => { calls.ensure.push(a); return { ok: true, changed: true, why: '' }; },
      toolHooksSafe: (v) => v === 'agy 1.2.12',
      versionOf: (bin) => { calls.version.push(bin); return versions[bin] || ''; },
      nodeBin: '/n/node',
      bridge: '/b/agy-report-bridge.js',
    },
  };
}

test('#4353 only running AGY agents get the hook, each in its own folder, with the right tool-hook choice', () => {
  const { calls, deps } = fakes({
    gem: { runner: 'antigravity', claude: '/x/agy', workdir: '/w/gem' },
    old: { runner: 'antigravity', claude: '/y/agy', workdir: '/w/old' },
    cc: { runner: 'claude', claude: '/x/claude', workdir: '/w/cc' },
    gone: null,
  }, { '/x/agy': 'agy 1.2.12', '/y/agy': 'agy 1.1.0' });
  const rows = agyrefresh.refreshRunningAgyHooks(deps);
  assert.deepEqual(rows.map((r) => r.name).sort(), ['gem', 'old'], 'a non-agy or jobless agent was touched');
  assert.deepEqual(calls.ensure.map((a) => a[0]).sort(), ['/w/gem', '/w/old']);
  for (const a of calls.ensure) { assert.equal(a[1], '/n/node'); assert.equal(a[2], '/b/agy-report-bridge.js'); }
  const byDir = Object.fromEntries(calls.ensure.map((a) => [a[0], a[3]]));
  assert.equal(byDir['/w/gem'], true, 'a new-enough agy did not get the tool hooks');
  assert.equal(byDir['/w/old'], false, 'an old agy got tool hooks it cannot take');
});

test('#4353 each agy binary is asked its version once, however many agents share it', () => {
  const { calls, deps } = fakes({
    a: { runner: 'antigravity', claude: '/x/agy', workdir: '/w/a' },
    b: { runner: 'antigravity', claude: '/x/agy', workdir: '/w/b' },
  });
  agyrefresh.refreshRunningAgyHooks(deps);
  assert.deepEqual(calls.version, ['/x/agy']);
  assert.equal(calls.ensure.length, 2);
});

test('#4353 nothing here throws: a missing folder, a throwing write and an unreadable list are rows or empty', () => {
  const { deps } = fakes({ a: { runner: 'antigravity', claude: '/x/agy', workdir: null }, b: { runner: 'antigravity', claude: '/x/agy', workdir: '/w/b' } });
  deps.ensureHooks = () => { throw new Error('boom'); };
  const rows = agyrefresh.refreshRunningAgyHooks(deps);
  assert.deepEqual(rows.map((r) => [r.name, r.ok]), [['a', false], ['b', false]]);
  assert.match(rows[1].why, /boom/);
  assert.deepEqual(agyrefresh.refreshRunningAgyHooks({ ...deps, names: () => { throw new Error('launchctl'); } }), []);
});

test('#4353 with the REAL ensureHooks, a running agent\'s folder gets hooks.json pointing at the bridge', () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agyrefresh-wd-'));
  try {
    const rows = agyrefresh.refreshRunningAgyHooks({
      names: () => ['gem'],
      job: () => ({ runner: 'antigravity', claude: '/x/agy', workdir: wd }),
      ensureHooks: agyhooks.ensureHooks,
      toolHooksSafe: agyhooks.toolHooksSafe,
      versionOf: () => 'agy 1.2.12',
      nodeBin: '/n/node',
      bridge: '/b/agy-report-bridge.js',
    });
    assert.equal(rows[0].ok, true, rows[0].why);
    const hooks = JSON.parse(fs.readFileSync(path.join(wd, '.agents', 'hooks.json'), 'utf8'));
    const entry = hooks[agyhooks.HOOK_NAME];
    assert.ok(entry && entry.Stop && entry.PreInvocation, 'the Kosmos entry was not written');
    assert.match(entry.Stop[0].command, /agy-report-bridge\.js' Stop$/);
  } finally { fs.rmSync(wd, { recursive: true, force: true }); }
});

test('#4353 readJob reports the folder the supervisor launches in', () => {
  const name = 'refresh4353';
  const text = create.plistFor(name, '/x/agy', '/x/tmux', null, null, 'antigravity');
  fs.mkdirSync(path.dirname(create.plistPath(name)), { recursive: true });
  fs.writeFileSync(create.plistPath(name), text);
  try {
    const job = create.readJob(name);
    assert.equal(job.runner, 'antigravity');
    assert.equal(job.workdir, create.workerDir(name), 'readJob lost the working folder');
  } finally { fs.rmSync(create.plistPath(name), { force: true }); }
});

test('#4353 the board runs the refresh at start, after the supervisor refresh, never under the dry run', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const sup = src.indexOf('const put = create.installSupervisor();');
  const ref = src.indexOf("require('./engine/agyrefresh').refreshAtBoardStart()");
  assert.ok(sup > 0 && ref > sup, 'the refresh is missing, or runs before the bridge is refreshed');
  const guard = src.lastIndexOf("process.env.AGENT_WORKFORCE_DRY_RUN !== '1'", ref);
  assert.ok(guard > sup, 'the refresh is not behind the dry-run guard');
});
