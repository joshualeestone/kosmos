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

function fakes(jobs, hooked = []) {
  const calls = { ensure: [] };
  return {
    calls,
    deps: {
      names: () => new Set(Object.keys(jobs)),
      job: (n) => jobs[n] || null,
      workdir: (n) => '/w/' + n,
      hasHook: (wd) => hooked.includes(wd),
      ensureHooks: (...a) => { calls.ensure.push(a); return { ok: true, changed: true, why: '' }; },
      nodeBin: '/n/node',
      bridge: '/b/agy-report-bridge.js',
      bridgeExists: () => true,
    },
  };
}

test('#4353 only running ANTIGRAVITY agents with no Kosmos hook get it, and never the tool hooks', async () => {
  const { calls, deps } = fakes({
    gem: { runner: 'antigravity', claude: '/x/agy' },
    old: { runner: 'antigravity', claude: '/x/agy' },
    done: { runner: 'antigravity', claude: '/x/agy' },
    cc: { runner: 'claude', claude: '/x/claude' },
    gone: null,
  }, ['/w/done']);
  const rows = await agyrefresh.refreshRunningAgyHooks(deps);
  assert.deepEqual(rows.map((r) => r.name).sort(), ['done', 'gem', 'old'], 'a non-antigravity or jobless agent was touched');
  assert.deepEqual(calls.ensure.map((a) => a[0]).sort(), ['/w/gem', '/w/old'], 'an already-hooked agent was rewritten');
  assert.equal(rows.find((r) => r.name === 'done').why, 'already hooked');
  for (const a of calls.ensure) { assert.equal(a[1], '/n/node'); assert.equal(a[2], '/b/agy-report-bridge.js'); }
  // The running process may be older than the agy on disk, so the ask_question tool hooks are
  // left to the supervisor's next launch: every write here is Working/Idle only.
  assert.ok(calls.ensure.every((a) => a[3] === false), 'tool hooks were hot-written into a running agy');
});

test('#4353 nothing is written when the bridge the hook would run is missing', async () => {
  const { calls, deps } = fakes({ gem: { runner: 'antigravity', claude: '/x/agy' } });
  deps.bridgeExists = () => false;
  assert.deepEqual(await agyrefresh.refreshRunningAgyHooks(deps), []);
  assert.equal(calls.ensure.length, 0, 'a hook was written pointing at a missing bridge (agy reads that as a DENY)');
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
  // Real paths: an entry naming a node or bridge that does not exist counts as absent.
  const bridge = path.join(wd, 'agy-report-bridge.js');
  fs.writeFileSync(bridge, '');
  try {
    const deps = {
      names: () => ['gem'],
      job: () => ({ runner: 'antigravity', claude: '/x/agy' }),
      workdir: () => wd,
      hasHook: (d) => agyrefresh.hasKosmosHook(d, agyhooks.HOOK_NAME),
      ensureHooks: agyhooks.ensureHooks,
      nodeBin: process.execPath,
      bridge,
      bridgeExists: () => true,
    };
    const rows = await agyrefresh.refreshRunningAgyHooks(deps);
    assert.equal(rows[0].ok, true, rows[0].why);
    assert.equal(rows[0].changed, true);
    const hooks = JSON.parse(fs.readFileSync(path.join(wd, '.agents', 'hooks.json'), 'utf8'));
    const entry = hooks[agyhooks.HOOK_NAME];
    assert.ok(entry && entry.Stop && entry.PreInvocation, 'the Kosmos entry was not written');
    assert.equal(entry.PreToolUse, undefined, 'tool hooks were hot-written');
    assert.match(entry.Stop[0].command, /agy-report-bridge\.js' Stop$/);
    const again = await agyrefresh.refreshRunningAgyHooks({ ...deps, nodeBin: '/usr/bin/true' });
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

test('#4353 a malformed Kosmos entry (null, a string, a list, no readable Stop command, no PreInvocation) is not "already hooked", so it gets repaired', () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agyhas-'));
  try {
    fs.mkdirSync(path.join(wd, '.agents'));
    const f = path.join(wd, '.agents', 'hooks.json');
    for (const bad of [null, 'x', []]) {
      fs.writeFileSync(f, JSON.stringify({ [agyhooks.HOOK_NAME]: bad }));
      assert.equal(agyrefresh.hasKosmosHook(wd, agyhooks.HOOK_NAME), false, JSON.stringify(bad) + ' read as hooked');
    }
    // An object entry with no readable Stop command is not a working hook either.
    for (const bad of [{}, { Stop: [] }, { Stop: [{}] }, { Stop: [{ command: 'node bridge Stop' }] }]) {
      fs.writeFileSync(f, JSON.stringify({ [agyhooks.HOOK_NAME]: bad }));
      assert.equal(agyrefresh.hasKosmosHook(wd, agyhooks.HOOK_NAME), false, JSON.stringify(bad) + ' read as hooked');
    }
    const bridge = path.join(wd, 'agy-report-bridge.js');
    fs.writeFileSync(bridge, '');
    const hook = (ev) => [{ command: `'${process.execPath}' '${bridge}' ${ev}` }];
    // A live Stop but no PreInvocation (a hand edit): Working would never be reported.
    for (const bad of [{ Stop: hook('Stop') }, { Stop: hook('Stop'), PreInvocation: [] }]) {
      fs.writeFileSync(f, JSON.stringify({ [agyhooks.HOOK_NAME]: bad }));
      assert.equal(agyrefresh.hasKosmosHook(wd, agyhooks.HOOK_NAME), false, JSON.stringify(bad) + ' read as hooked');
    }
    // CONTROL: a real entry, both halves, naming a node and a bridge that exist, does read as hooked.
    fs.writeFileSync(f, JSON.stringify({ [agyhooks.HOOK_NAME]: { PreInvocation: hook('PreInvocation'), Stop: hook('Stop') } }));
    assert.equal(agyrefresh.hasKosmosHook(wd, agyhooks.HOOK_NAME), true);
  } finally { fs.rmSync(wd, { recursive: true, force: true }); }
});

test('#4353 an entry whose node or bridge no longer exists counts as absent, so it is written again', () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agystale-'));
  try {
    const bridge = path.join(wd, 'bridge.js');
    fs.writeFileSync(bridge, '');
    // A real entry pointing at a node that exists and a bridge that exists: hooked.
    agyhooks.ensureHooks(wd, process.execPath, bridge, false);
    assert.equal(agyrefresh.hasKosmosHook(wd, agyhooks.HOOK_NAME), true, 'CONTROL: a live entry must read as hooked');
    // The same entry after an upgrade removed the node it names: absent.
    const f = path.join(wd, '.agents', 'hooks.json');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split(process.execPath).join('/gone/node'));
    assert.equal(agyrefresh.hasKosmosHook(wd, agyhooks.HOOK_NAME), false, 'an entry naming a missing node read as hooked');
  } finally { fs.rmSync(wd, { recursive: true, force: true }); }
});

test('#4353 repairing a broken entry keeps its ask_question tool hooks, and adds none to one without', async () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agykeep-'));
  try {
    const bridge = path.join(wd, 'agy-report-bridge.js');
    fs.writeFileSync(bridge, '');
    const f = path.join(wd, '.agents', 'hooks.json');
    const deps = {
      names: () => ['gem'],
      job: () => ({ runner: 'antigravity', claude: '/x/agy' }),
      workdir: () => wd,
      hasHook: (d) => agyrefresh.hasKosmosHook(d, agyhooks.HOOK_NAME),
      hadToolHooks: (d) => agyrefresh.hadToolHooks(d, agyhooks.HOOK_NAME),
      ensureHooks: agyhooks.ensureHooks,
      nodeBin: process.execPath,
      bridge,
      bridgeExists: () => true,
    };
    for (const withTools of [true, false]) {
      // A current supervisor's entry (with or without the tool hooks), then an upgrade removes its node.
      agyhooks.ensureHooks(wd, process.execPath, bridge, withTools);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split(process.execPath).join('/gone/node'));
      assert.equal(agyrefresh.hasKosmosHook(wd, agyhooks.HOOK_NAME), false, 'the broken entry read as hooked');
      const rows = await agyrefresh.refreshRunningAgyHooks(deps);
      assert.equal(rows[0].changed, true, rows[0].why);
      const entry = JSON.parse(fs.readFileSync(f, 'utf8'))[agyhooks.HOOK_NAME];
      assert.equal(Array.isArray(entry.PreToolUse), withTools,
        withTools ? 'the repair dropped the tool hooks a current supervisor had written' : 'the repair added tool hooks the entry never had');
      assert.equal(agyrefresh.hasKosmosHook(wd, agyhooks.HOOK_NAME), true, 'the repaired entry does not read as hooked');
      fs.rmSync(path.join(wd, '.agents'), { recursive: true, force: true });
    }
  } finally { fs.rmSync(wd, { recursive: true, force: true }); }
});

test('#4353 an entry whose PreInvocation names a missing node is broken even when Stop is live', () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-agypre-'));
  try {
    const bridge = path.join(wd, 'bridge.js');
    fs.writeFileSync(bridge, '');
    agyhooks.ensureHooks(wd, process.execPath, bridge, false);
    assert.equal(agyrefresh.hasKosmosHook(wd, agyhooks.HOOK_NAME), true, 'CONTROL: a live entry must read as hooked');
    const f = path.join(wd, '.agents', 'hooks.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const e = j[agyhooks.HOOK_NAME];
    e.PreInvocation[0].command = e.PreInvocation[0].command.split(process.execPath).join('/gone/node');
    fs.writeFileSync(f, JSON.stringify(j));
    assert.equal(agyrefresh.hasKosmosHook(wd, agyhooks.HOOK_NAME), false, 'a dead PreInvocation read as hooked');
  } finally { fs.rmSync(wd, { recursive: true, force: true }); }
});
