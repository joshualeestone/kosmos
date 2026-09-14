'use strict';
/**
 * world-guard-lift-1704, review round 1 (b): an offline row's two launchd facts,
 * "its background job was switched off" (#310) and "its job is running but no
 * session is visible" (#668), are read off create.disabledJobs() and
 * create.runningJobs(). launchd lists every Kosmos's jobs under their launch keys
 * (`ava` is Kosmos 1's, `ava+test` is Kosmos "test"'s), and the route asks
 * `.has(name)`, so the probes must answer in THIS Kosmos's names. Otherwise a
 * named Kosmos's offline `ava` wears Kosmos 1's `ava`'s state (after a keep-running
 * switch Kosmos 1's `ava` is running, which is the common case), and its own
 * switched-off `ava+test` job reads as not switched off.
 *
 * In-process, on either kind of host: launchd answers through create.setRunner;
 * the agent's job is there on BOTH arms (its plist on disk for the Mac survey, and
 * the Task Scheduler answering through win32job.setRunner for the Windows one), so
 * the offline row is built whichever arm the host takes. The roster is empty, so
 * the agent is offline.
 *
 *   node --test server.world-offline-rows-1704.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-world-offline-1704-'));
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

/* create.disabledJobs asks launchd for `gui/<uid>`, and win32 has no getuid: without
   this the probe throws on a Windows host, fails soft to "nothing switched off", and
   every switched-off assertion here would be about an empty list. */
if (typeof process.getuid !== 'function') process.getuid = () => 501;

const store = require('./engine/store');
const create = require('./engine/create');
const status = require('./engine/status');
const win32job = require('./engine/win32job');
const launchidentity = require('./engine/launchidentity');
const { start, server } = require('./server');

const WORLD = 'test';
const savedWorld = process.env.KOSMOS_WORLD;

/* What launchd answers right now: `launchctl list` and `print-disabled`. */
let launchd = { list: '', disabled: '' };

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;

  // One agent, `ava`: a profile, a worker folder, and a job file for BOTH Kosmoses
  // (Kosmos 1's bare plist and Kosmos "test"'s keyed one) on disk.
  fs.mkdirSync(nodePath.join(store.ROOT, 'profiles'), { recursive: true });
  fs.writeFileSync(nodePath.join(store.ROOT, 'profiles', 'ava.json'), JSON.stringify({ role: 'Researcher', displayName: 'Ava' }));
  fs.mkdirSync(nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, 'ava'), { recursive: true });
  fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });
  for (const world of [undefined, WORLD]) {
    fs.writeFileSync(nodePath.join(process.env.AGENT_WORKFORCE_LAUNCH, `${create.serviceLabel('ava', world)}.plist`), '<plist/>');
  }

  create.setRunner((file, args) => {
    if (args && args[0] === 'list') return { ok: true, stdout: launchd.list };
    if (args && args[0] === 'print-disabled') return { ok: true, stdout: launchd.disabled };
    return { ok: true, stdout: '' };
  });
  // The Windows arm's job: this Kosmos's task for `ava` is registered.
  win32job.setRunner((args) => {
    if (args.includes('/TN')) return { ok: true, out: 'Status: Ready\n' };
    const task = `\\Kosmos\\agent-${launchidentity.launchKey('ava', launchidentity.currentWorldId())}`;
    return { ok: true, out: `"${task}","N/A","Ready"\r\n` };
  });
});
test.after(() => {
  create.setRunner(null);
  win32job.setRunner(null);
  if (savedWorld === undefined) delete process.env.KOSMOS_WORLD; else process.env.KOSMOS_WORLD = savedWorld;
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

/** The `ava` row, as a board serving `world` (undefined = Kosmos 1) shows it while launchd says `answer`. */
async function avaRow(world, answer) {
  if (world === undefined) delete process.env.KOSMOS_WORLD; else process.env.KOSMOS_WORLD = world;
  launchd = { list: '', disabled: '', ...answer };
  status.setPaneSource(() => '');   // no session anywhere: ava is offline
  try {
    const body = await (await fetch(base + '/api/status')).json();
    const row = (body.agents || []).find((a) => a.sessionName === 'ava');
    assert.ok(row, `the offline ava row is missing (world ${world || 'default'}): ${JSON.stringify((body.agents || []).map((a) => a.sessionName))}`);
    return row;
  } finally {
    delete process.env.KOSMOS_WORLD;
  }
}

const running = (key) => ({ list: `PID\tStatus\tLabel\n90870\t0\tcom.kosmos.agent.${key}\n` });
const switchedOff = (key) => ({ disabled: `disabled services = {\n\t"com.kosmos.agent.${key}" => disabled\n}\n` });
const SWITCHED_OFF = /background job was switched off/;

test('a named Kosmos\'s offline ava is NOT running-unseen because Kosmos 1\'s ava is running; its own ava+test running is', async () => {
  const kosmos1Running = await avaRow(WORLD, running('ava'));
  assert.equal(kosmos1Running.jobRunningUnseen, false, 'Kosmos 1\'s running ava dressed the named Kosmos\'s ava in running-unseen');
  assert.equal(kosmos1Running.state, 'stopped');

  const ownRunning = await avaRow(WORLD, running(launchidentity.launchKey('ava', WORLD)));
  assert.equal(ownRunning.jobRunningUnseen, true, 'the control: the named Kosmos\'s own running job is its fact');
});

test('a named Kosmos\'s offline ava is NOT "switched off" because Kosmos 1\'s ava is; its own ava+test switched off IS', async () => {
  const kosmos1Off = await avaRow(WORLD, switchedOff('ava'));
  assert.doesNotMatch(String(kosmos1Off.because), SWITCHED_OFF, 'Kosmos 1\'s switched-off job was told as the named Kosmos\'s');

  const ownOff = await avaRow(WORLD, switchedOff(launchidentity.launchKey('ava', WORLD)));
  assert.match(String(ownOff.because), SWITCHED_OFF, 'the named Kosmos\'s own switched-off job fell through to another sentence');
});

test('control: Kosmos 1 still reads its own ava running and switched off', async () => {
  assert.equal((await avaRow(undefined, running('ava'))).jobRunningUnseen, true);
  assert.match(String((await avaRow(undefined, switchedOff('ava'))).because), SWITCHED_OFF);
  assert.equal((await avaRow(undefined, running(launchidentity.launchKey('ava', WORLD)))).jobRunningUnseen, false,
    'Kosmos 1 read the named Kosmos\'s running job as its own');
});
