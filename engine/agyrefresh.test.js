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
const agyrefresh = require('./agyrefresh');
const agyhooks = require('./agyhooks');
const create = require('./create');

function fakes(jobs, versions = {}, hooked = []) {
  const calls = { ensure: [], version: [] };
  return {
    calls,
    deps: {
      names: () => new Set(Object.keys(jobs)),
      job: (n) => jobs[n] || null,
      workdir: (n) => '/w/' + n,
      hasHook: (wd) => hooked.includes(wd),
      ensureHooks: (...a) => { calls.ensure.push(a); return { ok: true, changed: true, why: '' }; },
      toolHooksSafe: (v) => v === 'agy 1.2.12',
      versionOf: async (bin) => { calls.version.push(bin); return versions[bin] || ''; },
      nodeBin: '/n/node',
      bridge: '/b/agy-report-bridge.js',
      bridgeExists: () => true,
    },
  };
}

test('#4353 only running ANTIGRAVITY agents with no Kosmos hook get it, with the right tool-hook choice', async () => {
  const { calls, deps } = fakes({
    gem: { runner: 'antigravity', claude: '/x/agy' },
    old: { runner: 'antigravity', claude: '/y/agy' },
    done: { runner: 'antigravity', claude: '/x/agy' },
    cc: { runner: 'claude', claude: '/x/claude' },
    gone: null,
  }, { '/x/agy': 'agy 1.2.12', '/y/agy': 'agy 1.1.0' }, ['/w/done']);
  const rows = await agyrefresh.refreshRunningAgyHooks(deps);
  assert.deepEqual(rows.map((r) => r.name).sort(), ['done', 'gem', 'old'], 'a non-antigravity or jobless agent was touched');
  assert.deepEqual(calls.ensure.map((a) => a[0]).sort(), ['/w/gem', '/w/old'], 'an already-hooked agent was rewritten');
  assert.equal(rows.find((r) => r.name === 'done').why, 'already hooked');
  for (const a of calls.ensure) { assert.equal(a[1], '/n/node'); assert.equal(a[2], '/b/agy-report-bridge.js'); }
  const byDir = Object.fromEntries(calls.ensure.map((a) => [a[0], a[3]]));
  assert.equal(byDir['/w/gem'], true, 'a new-enough agy did not get the tool hooks');
  assert.equal(byDir['/w/old'], false, 'an old agy got tool hooks it cannot take');
});

test('#4353 nothing is written when the bridge the hook would run is missing', async () => {
  const { calls, deps } = fakes({ gem: { runner: 'antigravity', claude: '/x/agy' } });
  deps.bridgeExists = () => false;
  assert.deepEqual(await agyrefresh.refreshRunningAgyHooks(deps), []);
  assert.equal(calls.ensure.length, 0, 'a hook was written pointing at a missing bridge (agy reads that as a DENY)');
});

test('#4353 each agy binary is asked its version once, however many agents share it', async () => {
  const { calls, deps } = fakes({
    a: { runner: 'antigravity', claude: '/x/agy' },
    b: { runner: 'antigravity', claude: '/x/agy' },
  });
  await agyrefresh.refreshRunningAgyHooks(deps);
  assert.deepEqual(calls.version, ['/x/agy']);
  assert.equal(calls.ensure.length, 2);
});

test('#4353 nothing here throws: a missing folder, a throwing write and an unreadable list are rows or empty', async () => {
  const { deps } = fakes({ a: { runner: 'antigravity', claude: '/x/agy' }, b: { runner: 'antigravity', claude: '/x/agy' } });
  deps.workdir = (n) => (n === 'a' ? null : '/w/' + n);
  deps.ensureHooks = () => { throw new Error('boom'); };
  const rows = await agyrefresh.refreshRunningAgyHooks(deps);
  assert.deepEqual(rows.map((r) => [r.name, r.ok]), [['a', false], ['b', false]]);
  assert.match(rows[1].why, /boom/);
  assert.deepEqual(await agyrefresh.refreshRunningAgyHooks({ ...deps, names: () => { throw new Error('launchctl'); } }), []);
});

test('#4353 with the REAL ensureHooks and hasKosmosHook: written once, then left alone', async () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agyrefresh-wd-'));
  try {
    const deps = {
      names: () => ['gem'],
      job: () => ({ runner: 'antigravity', claude: '/x/agy' }),
      workdir: () => wd,
      hasHook: (d) => agyrefresh.hasKosmosHook(d, agyhooks.HOOK_NAME),
      ensureHooks: agyhooks.ensureHooks,
      toolHooksSafe: agyhooks.toolHooksSafe,
      versionOf: async () => 'agy 1.2.12',
      nodeBin: '/n/node',
      bridge: '/b/agy-report-bridge.js',
      bridgeExists: () => true,
    };
    const rows = await agyrefresh.refreshRunningAgyHooks(deps);
    assert.equal(rows[0].ok, true, rows[0].why);
    assert.equal(rows[0].changed, true);
    const hooks = JSON.parse(fs.readFileSync(path.join(wd, '.agents', 'hooks.json'), 'utf8'));
    const entry = hooks[agyhooks.HOOK_NAME];
    assert.ok(entry && entry.Stop && entry.PreInvocation, 'the Kosmos entry was not written');
    assert.match(entry.Stop[0].command, /agy-report-bridge\.js' Stop$/);
    const again = await agyrefresh.refreshRunningAgyHooks({ ...deps, nodeBin: '/other/node' });
    assert.equal(again[0].changed, false, 'a second start rewrote an entry that was already there');
    assert.equal(again[0].why, 'already hooked');
  } finally { fs.rmSync(wd, { recursive: true, force: true }); }
});

test('#4353 the launch folder the refresh uses is the one plistFor gives the supervisor', () => {
  const text = create.plistFor('refresh4353', '/x/agy', '/x/tmux', null, null, 'antigravity');
  const args = [...text.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)[1]
    .matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => m[1]);
  assert.equal(args[3], create.workerDir('refresh4353'), 'argument 3 is no longer workerDir; the refresh would hook the wrong folder');
});

test('#4353 the board runs the refresh at start, after the supervisor refresh, never under the dry run', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const sup = src.indexOf('const put = create.installSupervisor();');
  const ref = src.indexOf("require('./engine/agyrefresh').refreshAtBoardStart()");
  assert.ok(sup > 0 && ref > sup, 'the refresh is missing, or runs before the bridge is refreshed');
  const guard = src.lastIndexOf("process.env.AGENT_WORKFORCE_DRY_RUN !== '1'", ref);
  assert.ok(guard > sup, 'the refresh is not behind the dry-run guard');
  // INSIDE the guarded block, not merely after the guard's text: more braces opened than closed.
  const between = src.slice(guard, ref);
  assert.ok((between.match(/\{/g) || []).length > (between.match(/\}/g) || []).length,
    'the guard\'s block closes before the refresh call');
});

test('#4353 the launch folder is read from the plist the supervisor started with, else workerDir', () => {
  const name = 'launch4353';
  const text = create.plistFor(name, '/x/agy', '/x/tmux', null, null, 'antigravity')
    .replace('<string>' + create.workerDir(name) + '</string>', '<string>/Users/p/their &amp; folder</string>');
  fs.mkdirSync(path.dirname(create.plistPath(name)), { recursive: true });
  fs.writeFileSync(create.plistPath(name), text);
  try {
    assert.equal(agyrefresh.launchDir(create, name), '/Users/p/their & folder', 'not the folder the supervisor was started in');
  } finally { fs.rmSync(create.plistPath(name), { force: true }); }
  assert.equal(agyrefresh.launchDir(create, name), create.workerDir(name), 'no plist must fall back to workerDir');
});

test('#4353 a hook the supervisor wrote while the version was being asked is not overwritten', async () => {
  const { calls, deps } = fakes({ gem: { runner: 'antigravity', claude: '/x/agy' } });
  let asked = false;
  deps.versionOf = async () => { asked = true; return 'agy 1.2.12'; };
  deps.hasHook = () => asked;   // absent before the await, present after it
  const rows = await agyrefresh.refreshRunningAgyHooks(deps);
  assert.equal(calls.ensure.length, 0, 'an entry written during the await was overwritten');
  assert.equal(rows[0].why, 'already hooked');
});

test('#4353 a version probe whose grandchild holds the pipe still settles (a hang would stall every agent after it)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agyver-'));
  const tag = 'aw-agyver-grandchild-' + process.pid;
  const bin = path.join(dir, 'agy');
  fs.writeFileSync(bin, `#!/bin/bash\necho "agy 1.2.12"\n(exec -a ${tag} sleep 30) &\nexit 0\n`, { mode: 0o755 });
  try {
    const t0 = Date.now();
    const v = await agyrefresh.versionOf(bin);
    assert.ok(Date.now() - t0 < 9000, 'the probe did not settle');
    assert.ok(v === '' || v === 'agy 1.2.12', v);
  } finally {
    require('node:child_process').spawnSync('pkill', ['-f', tag]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
