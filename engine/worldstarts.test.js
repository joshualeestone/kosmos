'use strict';
/**
 * #1704 PR3: engine/worldstarts -- pausing a Kosmos's agents on a switch, and the
 * boot drain that brings them back.
 *
 * Both platform arms are driven through the seams remove.js's own suites use
 * (remove.setRunner for launchctl/tmux, win32job.setRunner for schtasks,
 * win32stop.setLive for the live-session read), so nothing here reaches a real
 * job. Live execution is armed only around the tests that need it and closed
 * again after, because worldstarts gates on it itself (win32job does not).
 *
 *   node --test engine/worldstarts.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// SANDBOX BEFORE REQUIRING: store.ROOT, the launch dir and the workers dir are all
// frozen at require time by the modules below.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'worldstarts-test-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const liveExec = require('./live-execution');
const remove = require('./remove');
const create = require('./create');
const win32job = require('./win32job');
const win32stop = require('./win32stop');
const worldstarts = require('./worldstarts');

// The darwin arm builds gui/<uid>/<label>; win32 has no getuid.
if (typeof process.getuid !== 'function') process.getuid = () => 501;
const UID = process.getuid();
const MAC = 'darwin';
const WIN = 'win32';

let calls = [];
let failing = [];           // substrings of a command that should fail
let onFirstCall = null;     // runs once, before the first command is answered
let macDisabled = new Set(); // agents launchd reports switched off (print-disabled)
let winDisabled = new Set(); // agents whose Scheduled Task reports Disabled
let winMissing = new Set();  // agents with no Scheduled Task at all (an import's first start)
let winGerman = false;       // the LIST status printed as a German Windows prints it

function answerMac(file, args) {
  const line = [nodePath.basename(file), ...args].join(' ');
  if (onFirstCall) { const f = onFirstCall; onFirstCall = null; f(); }
  calls.push(line);
  // tmux's look-again: exit 1 is "no such session", i.e. the kill worked.
  if (args[0] === 'has-session') return { ok: false, code: 1 };
  const fail = failing.find((f) => line.includes(f.match));
  if (fail) return { ok: false, code: fail.code };
  return { ok: true, stdout: '' };
}
function answerWin(args) {
  const line = ['schtasks', ...args].join(' ');
  if (onFirstCall) { const f = onFirstCall; onFirstCall = null; f(); }
  calls.push(line);
  if (args[0] === '/Query') {
    if ([...winMissing].some((n) => args.includes(win32job.taskName(n)))) return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
    const off = [...winDisabled].some((n) => args.includes(win32job.taskName(n)));
    /* The switched-off decision reads the task's own definition (win32job.taskEnabled). */
    if (args.includes('/XML')) return { ok: true, out: '<Task><Settings><Enabled>' + (off ? 'false' : 'true') + '</Enabled></Settings></Task>' };
    if (winGerman) return { ok: true, out: off ? 'Status: Deaktiviert\n' : 'Status: Bereit\n' };
    return { ok: true, out: off ? 'Status: Disabled\n' : 'Status: Ready\n' };
  }
  const fail = failing.find((f) => line.includes(f.match));
  if (fail) return { ok: false, out: 'ERROR: ' + fail.match };
  return { ok: true, out: 'SUCCESS' };
}

// create.js's own runner answers launchd's per-user overrides (create.disabledJobs).
// `macDisabled` holds launch KEYS, as launchd does: `ava` is Kosmos 1's, `ava+test`
// is Kosmos "test"'s. In the default world a key is the bare name.
function answerCreate(file, args) {
  if (args[0] === 'print-disabled') {
    return { ok: true, stdout: [...macDisabled].map((k) => `\t"${create.SERVICE_LABEL_PREFIX}${k}" => disabled`).join('\n') };
  }
  return { ok: true, stdout: '' };
}

/* Run `body` with this process in Kosmos `world` (the board's KOSMOS_WORLD, which
   launchidentity.currentWorldId reads), then restore. */
function inWorld(world, body) {
  const saved = process.env.KOSMOS_WORLD;
  process.env.KOSMOS_WORLD = world;
  try { return body(); } finally {
    if (saved === undefined) delete process.env.KOSMOS_WORLD; else process.env.KOSMOS_WORLD = saved;
  }
}
/* A command naming Kosmos 1's `ava`: its bare launchd label or plist, or its bare
   Scheduled Task. A named world's are `...ava+<world>`. */
const DEFAULT_AVA = /com\.kosmos\.agent\.ava(?!\+)|\\agent-ava(?!\+)/;

function giveMacJob(name) {
  fs.mkdirSync(nodePath.dirname(create.plistPath(name)), { recursive: true });
  fs.writeFileSync(create.plistPath(name), '<plist/>');
}
const readRecord = () => JSON.parse(fs.readFileSync(worldstarts.RECORD_FILE, 'utf8'));
const writeRecord = (entries) => {
  fs.mkdirSync(nodePath.dirname(worldstarts.RECORD_FILE), { recursive: true });
  fs.writeFileSync(worldstarts.RECORD_FILE, JSON.stringify({ entries }));
};

test.beforeEach(() => {
  calls = []; failing = []; onFirstCall = null;
  macDisabled = new Set(); winDisabled = new Set(); winMissing = new Set();
  remove.setRunner(answerMac);
  create.setRunner(answerCreate);
  win32job.setRunner(answerWin);
  win32stop.setLive(() => new Map());     // nothing live under any name: the end state
  liveExec.allowLiveExecution();
  fs.rmSync(worldstarts.RECORD_FILE, { force: true });
  fs.rmSync(remove.REMOVED_FILE, { force: true });
  for (const n of ['ava', 'bo', 'cy']) giveMacJob(n);
});
test.after(() => {
  remove.resetForTests();
  create.setRunner(null);
  win32job.setRunner(null);
  win32stop.setLive(null);
  liveExec.resetForTests();
});

test('pause (Mac): records the agent BEFORE the first stop, then disable, bootout, end the session -- never a removal', () => {
  let recordAtFirstCommand = null;
  onFirstCall = () => {
    recordAtFirstCommand = fs.existsSync(worldstarts.RECORD_FILE) ? readRecord() : null;
  };
  const out = worldstarts.pauseForSwitch([{ name: 'ava', session: 'ava-discord', tied: true }], { platform: MAC });

  assert.deepEqual(out.paused, ['ava']);
  assert.deepEqual(out.notPaused, []);
  assert.ok(recordAtFirstCommand, 'the record did not exist when the first stop command ran -- not write-ahead');
  assert.deepEqual(recordAtFirstCommand.entries.map((e) => e.name), ['ava']);

  const label = `gui/${UID}/${create.serviceLabel('ava')}`;
  assert.deepEqual(calls, [
    `launchctl disable ${label}`,
    `launchctl bootout ${label}`,
    'tmux kill-session -t =ava-discord',
    'tmux has-session -t =ava-discord',
  ], 'disable must come first, so a login between the acts cannot revive it');

  const entry = readRecord().entries[0];
  assert.equal(entry.name, 'ava');
  assert.equal(entry.why, 'paused');
  assert.ok(Number.isFinite(Date.parse(entry.at)), 'at is a readable time');
  assert.equal(remove.isRemoved('ava'), false, 'a paused agent must never be marked removed');
});

test('the record is written atomically in its documented shape', () => {
  worldstarts.pauseForSwitch([{ name: 'ava', session: null, tied: true }, { name: 'bo', session: null, tied: true }], { platform: MAC });
  const raw = fs.readFileSync(worldstarts.RECORD_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  assert.deepEqual(Object.keys(parsed), ['entries']);
  assert.deepEqual(parsed.entries.map((e) => e.name).sort(), ['ava', 'bo']);
  const leftovers = fs.readdirSync(nodePath.dirname(worldstarts.RECORD_FILE)).filter((f) => f.startsWith('world-starts.json.'));
  assert.deepEqual(leftovers, [], 'the temp file of the rename was left behind');
  assert.equal(worldstarts.RECORD_FILE, nodePath.join(require('./store').ROOT, 'world-starts.json'),
    'the record lives in the booted world\'s store');
});

test('an agent with no running session is still paused: disabled and recorded, no session end', () => {
  const out = worldstarts.pauseForSwitch([{ name: 'ava', session: null, tied: true }], { platform: MAC });
  assert.deepEqual(out.paused, ['ava']);
  assert.equal(calls.some((c) => c.startsWith('tmux')), false, 'there was no session to end');
  assert.ok(calls.some((c) => c.startsWith('launchctl disable')), 'its logon start must still be switched off');
});

test('a failed stop comes OUT of the record and into notPaused, with the disable undone', () => {
  failing = [{ match: 'bootout', code: 9 }];
  const out = worldstarts.pauseForSwitch([{ name: 'ava', session: 'ava-discord', tied: true }], { platform: MAC });
  assert.deepEqual(out.paused, []);
  assert.equal(out.notPaused.length, 1);
  assert.equal(out.notPaused[0].name, 'ava');
  assert.match(out.notPaused[0].because, /keeps running/);
  assert.ok(calls.some((c) => c.startsWith('launchctl enable')), 'the disable must be undone, or it never starts at login again');
  assert.deepEqual(readRecord().entries, [], 'an agent that kept running must not be listed as paused');
});

test('a failed stop whose undo ALSO fails keeps its entry, so the next boot sets it to start again', () => {
  failing = [{ match: 'bootout', code: 9 }, { match: 'launchctl enable', code: 9 }];
  const out = worldstarts.pauseForSwitch([{ name: 'ava', session: null, tied: true }], { platform: MAC });
  assert.equal(out.notPaused[0].name, 'ava');
  const entries = readRecord().entries;
  assert.equal(entries.length, 1, 'dropping it would leave an agent disabled forever');
  assert.match(entries[0].because, /next opens/);
});

test('a failed disable changes nothing: no stop is sent, the entry comes out', () => {
  failing = [{ match: 'launchctl disable', code: 9 }];
  const out = worldstarts.pauseForSwitch([{ name: 'ava', session: 'ava-discord', tied: true }], { platform: MAC });
  assert.deepEqual(out.paused, []);
  assert.equal(calls.some((c) => c.includes('bootout') || c.startsWith('tmux')), false);
  assert.deepEqual(readRecord().entries, []);
});

test('an untied card and an agent Kosmos did not start are reported, not touched', () => {
  fs.rmSync(create.plistPath('bo'), { force: true });
  const out = worldstarts.pauseForSwitch([
    { name: 'ava', session: 'ava', tied: false },
    { name: 'bo', session: 'bo-discord', tied: true },
  ], { platform: MAC });
  assert.deepEqual(out.paused, []);
  assert.deepEqual(out.notPaused.map((n) => n.name), ['ava', 'bo']);
  assert.match(out.notPaused[0].because, /cannot confirm/);
  assert.match(out.notPaused[1].because, /not started by Kosmos/);
  assert.equal(calls.some((c) => /disable|bootout|kill-session/.test(c)), false);
});

test('live execution OFF: refuses, writes nothing, stops nothing, and reports every agent', () => {
  liveExec.resetForTests();
  const out = worldstarts.pauseForSwitch([{ name: 'ava', session: 'ava-discord', tied: true }], { platform: WIN });
  assert.deepEqual(out.paused, []);
  assert.equal(out.notPaused[0].name, 'ava');
  assert.match(out.notPaused[0].because, /not allowed to start or stop agents/);
  assert.match(String(out.refused), /test process/, 'the gate\'s own refusal is carried, not swallowed');
  assert.deepEqual(calls, [], 'not even a /Query may run: win32job is not gated itself');
  assert.equal(fs.existsSync(worldstarts.RECORD_FILE), false);
});

test('pause and resume (Windows): /Change /DISABLE + /End, then /Change /ENABLE + /Run, on this Kosmos\'s task', () => {
  const task = win32job.taskName('ava');
  const out = worldstarts.pauseForSwitch([{ name: 'ava', session: 'ava', tied: true }], { platform: WIN });
  assert.deepEqual(out.paused, ['ava']);
  const acts = calls.filter((c) => !c.includes('/Query'));
  assert.deepEqual(acts, [
    `schtasks /Change /TN ${task} /DISABLE`,
    `schtasks /End /TN ${task}`,
  ]);

  calls = [];
  const back = worldstarts.resumePaused({ platform: WIN });
  assert.deepEqual(back.resumed, ['ava']);
  assert.deepEqual(calls.filter((c) => !c.includes('/Query')), [
    `schtasks /Change /TN ${task} /ENABLE`,
    `schtasks /Run /TN ${task}`,
  ]);
  assert.deepEqual(readRecord().entries, [], 'a resumed agent is cleared from the record');
});

test('resume (Mac): enable then bootstrap its plist; bootstrap code 5 (already loaded) is success', () => {
  writeRecord([{ name: 'ava', why: 'paused', at: new Date().toISOString() }]);
  failing = [{ match: 'bootstrap', code: 5 }];
  const back = worldstarts.resumePaused({ platform: MAC });
  assert.deepEqual(back.resumed, ['ava']);
  assert.deepEqual(calls, [
    `launchctl enable gui/${UID}/${create.serviceLabel('ava')}`,
    `launchctl bootstrap gui/${UID} ${create.plistPath('ava')}`,
  ]);
});

test('the drain skips removed agents, keeps failures with a because, and clears successes', () => {
  fs.mkdirSync(nodePath.dirname(remove.REMOVED_FILE), { recursive: true });
  fs.writeFileSync(remove.REMOVED_FILE, JSON.stringify([{ name: 'ava' }]));
  const at = new Date().toISOString();
  writeRecord([
    { name: 'ava', why: 'paused', at },
    { name: 'bo', why: 'paused', at },
    { name: 'cy', why: 'paused', at },
  ]);
  failing = [{ match: `enable gui/${UID}/${create.serviceLabel('cy')}`, code: 9 }];
  const r = worldstarts.drainAtBoot({ platform: MAC });

  assert.deepEqual(r.cleared, ['ava'], 'a removed agent stays removed; the removal owns it now');
  assert.equal(calls.some((c) => c.includes('.ava')), false, 'nothing was sent for the removed agent');
  assert.deepEqual(r.resumed, ['bo']);
  assert.deepEqual(r.held.map((h) => h.name), ['cy']);
  const left = readRecord().entries;
  assert.deepEqual(left.map((e) => e.name), ['cy'], 'only the failure stays, for the next boot');
  assert.match(left[0].because, /could not set cy to start/);
});

/* ── world-guard-lift-1704: a NAMED Kosmos pauses and resumes its own agents ── */

test('a NAMED Kosmos\'s boot drain resumes its own agents on their world-keyed identity (Mac and Windows), never Kosmos 1\'s', () => {
  const at = new Date().toISOString();
  // beforeEach gave Kosmos 1's `ava` its bare plist: the control that must stay untouched.
  assert.ok(fs.existsSync(create.plistPath('ava')), 'the control: Kosmos 1\'s ava has a job on disk');
  const all = [];
  inWorld('test', () => {
    giveMacJob('ava');
    assert.match(create.plistPath('ava'), /com\.kosmos\.agent\.ava\+test\.plist$/, 'the control: this world\'s plist is keyed');
    writeRecord([{ name: 'ava', why: 'paused', at }]);
    const mac = worldstarts.drainAtBoot({ platform: MAC });
    assert.deepEqual(mac.resumed, ['ava']);
    assert.deepEqual(calls, [
      `launchctl enable gui/${UID}/com.kosmos.agent.ava+test`,
      `launchctl bootstrap gui/${UID} ${create.plistPath('ava')}`,
    ]);
    all.push(...calls);

    calls = [];
    writeRecord([{ name: 'ava', why: 'paused', at }]);
    const win = worldstarts.drainAtBoot({ platform: WIN });
    assert.deepEqual(win.resumed, ['ava']);
    assert.deepEqual(calls.filter((c) => !c.includes('/Query')), [
      'schtasks /Change /TN Kosmos\\agent-ava+test /ENABLE',
      'schtasks /Run /TN Kosmos\\agent-ava+test',
    ]);
    all.push(...calls);
    fs.rmSync(create.plistPath('ava'), { force: true });
  });
  assert.deepEqual(all.filter((c) => DEFAULT_AVA.test(c)), [], 'a named Kosmos\'s drain reached Kosmos 1\'s ava');
});

test('a NAMED Kosmos\'s pause (Mac and Windows) stops only its own agent, and records it', () => {
  const all = [];
  inWorld('test', () => {
    giveMacJob('ava');
    const mac = worldstarts.pauseForSwitch([{ name: 'ava', session: 'ava+test', tied: true }], { platform: MAC });
    assert.deepEqual(mac.paused, ['ava']);
    assert.deepEqual(calls, [
      `launchctl disable gui/${UID}/com.kosmos.agent.ava+test`,
      `launchctl bootout gui/${UID}/com.kosmos.agent.ava+test`,
      'tmux kill-session -t =ava+test',
      'tmux has-session -t =ava+test',
    ]);
    all.push(...calls);

    calls = [];
    fs.rmSync(worldstarts.RECORD_FILE, { force: true });
    const win = worldstarts.pauseForSwitch([{ name: 'ava', session: 'ava', tied: true }], { platform: WIN });
    assert.deepEqual(win.paused, ['ava']);
    assert.deepEqual(calls.filter((c) => !c.includes('/Query')), [
      'schtasks /Change /TN Kosmos\\agent-ava+test /DISABLE',
      'schtasks /End /TN Kosmos\\agent-ava+test',
    ]);
    all.push(...calls);
    fs.rmSync(create.plistPath('ava'), { force: true });
  });
  assert.deepEqual(readRecord().entries.map((e) => e.name), ['ava'], 'recorded in the booted world\'s store');
  assert.deepEqual(all.filter((c) => DEFAULT_AVA.test(c)), [], 'a named Kosmos\'s pause reached Kosmos 1\'s ava');
});

test('the Mac switched-off check reads THIS Kosmos\'s key: Kosmos 1\'s ava switched off does not stop world "test" pausing its own', () => {
  inWorld('test', () => {
    giveMacJob('ava');
    try {
      macDisabled = new Set(['ava']);            // Kosmos 1's ava, switched off
      const out = worldstarts.pauseForSwitch([{ name: 'ava', session: null, tied: true }], { platform: MAC });
      assert.deepEqual(out.paused, ['ava'], 'Kosmos 1\'s switched-off job was read as this world\'s');
      assert.ok(calls.includes(`launchctl disable gui/${UID}/com.kosmos.agent.ava+test`));

      calls = [];
      fs.rmSync(worldstarts.RECORD_FILE, { force: true });
      macDisabled = new Set(['ava+test']);       // this world's own ava, switched off by somebody
      const again = worldstarts.pauseForSwitch([{ name: 'ava', session: null, tied: true }], { platform: MAC });
      assert.deepEqual(again.paused, []);
      assert.match(again.notPaused[0].because, /already switched off/, 'this world\'s own switched-off job was not seen');
      assert.deepEqual(calls, []);
    } finally {
      fs.rmSync(create.plistPath('ava'), { force: true });
    }
  });
});

test('a resume leaves alone a job Kosmos did not write (Kosmos 1\'s legacy com.<name>.discord), and a named Kosmos never reaches it', () => {
  // bo's own plist is gone; only a legacy, unkeyed one some other tool wrote is on disk.
  fs.rmSync(create.plistPath('bo'), { force: true });
  const discord = nodePath.join(nodePath.dirname(create.plistPath('bo')), 'com.bo.discord.plist');
  fs.writeFileSync(discord, '<plist/>');
  try {
    // Kosmos 1: jobFor offers the legacy job, and the resume's own fence refuses it.
    assert.equal(remove.jobFor('bo', MAC).ours, false, 'the control: in Kosmos 1 jobFor returns the not-ours candidate');
    writeRecord([{ name: 'bo', why: 'paused', at: new Date().toISOString() }]);
    const r = worldstarts.drainAtBoot({ platform: MAC });
    assert.deepEqual(r.resumed, []);
    assert.deepEqual(r.held.map((h) => h.name), ['bo']);
    assert.match(r.held[0].because, /other than Kosmos/);
    assert.deepEqual(calls, [], 'a job Kosmos did not write was enabled or started');
    assert.match(readRecord().entries[0].because, /other than Kosmos/, 'the held entry says why');

    // A named Kosmos: jobFor never offers Kosmos 1's legacy job, so nothing is sent for it.
    inWorld('test', () => {
      assert.equal(remove.jobFor('bo', MAC), null, 'a named Kosmos was offered Kosmos 1\'s legacy job');
      writeRecord([{ name: 'bo', why: 'paused', at: new Date().toISOString() }]);
      const named = worldstarts.drainAtBoot({ platform: MAC });
      assert.deepEqual(named.resumed, []);
      assert.match(named.held[0].because, /could not find how Kosmos starts bo/);
      assert.deepEqual(calls, [], 'a named Kosmos\'s resume reached Kosmos 1\'s legacy job');
    });
  } finally {
    fs.rmSync(discord, { force: true });
  }
});

test('resumeNames touches only the names given (the route\'s rollback)', () => {
  const at = new Date().toISOString();
  writeRecord([{ name: 'ava', why: 'paused', at }, { name: 'bo', why: 'paused', at }]);
  const r = worldstarts.resumeNames(['bo'], { platform: MAC });
  assert.deepEqual(r.resumed, ['bo']);
  assert.equal(calls.some((c) => c.includes('.ava')), false);
  assert.deepEqual(readRecord().entries.map((e) => e.name), ['ava']);
});

test('no paused entries: the resume costs nothing and asks no gate, even with live execution off', () => {
  liveExec.resetForTests();
  const r = worldstarts.resumePaused({ platform: WIN });
  assert.deepEqual(r, { resumed: [], held: [], cleared: [] });
  assert.deepEqual(calls, []);
});

/* ── review round 1 ───────────────────────────────────────────────────── */

test('R1-2: a launchd job some other tool wrote (com.<name>.discord, ours:false) is not paused', () => {
  fs.rmSync(create.plistPath('bo'), { force: true });
  const discord = nodePath.join(nodePath.dirname(create.plistPath('bo')), 'com.bo.discord.plist');
  fs.writeFileSync(discord, '<plist/>');
  try {
    assert.equal(remove.jobFor('bo', MAC).ours, false, 'the control: jobFor really returns the not-ours candidate');
    const out = worldstarts.pauseForSwitch([{ name: 'bo', session: 'bo', tied: true }], { platform: MAC });
    assert.deepEqual(out.paused, []);
    assert.match(out.notPaused[0].because, /not started by Kosmos/);
    assert.equal(calls.some((c) => /disable|bootout|kill-session/.test(c)), false, 'a job we did not write was touched');
    assert.equal(fs.existsSync(worldstarts.RECORD_FILE), false);
  } finally {
    fs.rmSync(discord, { force: true });
  }
});

test('R1-3: an UNREADABLE removed list starts nothing: every entry is held, for the next pass', () => {
  fs.mkdirSync(nodePath.dirname(remove.REMOVED_FILE), { recursive: true });
  fs.writeFileSync(remove.REMOVED_FILE, '{ not json');
  const at = new Date().toISOString();
  writeRecord([{ name: 'ava', why: 'paused', at }, { name: 'bo', why: 'paused', at }]);
  const r = worldstarts.drainAtBoot({ platform: MAC });
  assert.deepEqual(r.resumed, []);
  assert.deepEqual(r.held.map((h) => h.name), ['ava', 'bo']);
  assert.match(r.held[0].because, /could not read the list of removed agents/);
  assert.deepEqual(calls, [], 'an agent the person may have removed was started');
  assert.deepEqual(readRecord().entries.map((e) => e.name), ['ava', 'bo']);
});

test('R1-4 (Windows): a task that was ALREADY switched off is left off: not recorded, not touched', () => {
  winDisabled.add('ava');
  const out = worldstarts.pauseForSwitch([{ name: 'ava', session: 'ava', tied: true }], { platform: WIN });
  assert.deepEqual(out.paused, []);
  assert.match(out.notPaused[0].because, /already switched off/);
  assert.equal(calls.some((c) => /\/Change|\/End/.test(c)), false);
  assert.equal(fs.existsSync(worldstarts.RECORD_FILE), false, 'recording it would make the resume switch it back on');
});

test('R1-4 (Windows, German): a switched-off task is still left off, read from its definition not the translated status', () => {
  /* win32-agent-job-read round 2: the LIST status is localized. A German Windows
     prints "Deaktiviert", which a search for "disabled" misses, so a pause that read
     it would record this agent and the resume would switch it back on. */
  winDisabled.add('ava');
  winGerman = true;
  try {
    const out = worldstarts.pauseForSwitch([{ name: 'ava', session: 'ava', tied: true }], { platform: WIN });
    assert.deepEqual(out.paused, [], 'a switched-off agent on a German Windows was paused, so the resume would switch it on');
    assert.match(out.notPaused[0].because, /already switched off/);
    assert.equal(calls.some((c) => /\/Change|\/End/.test(c)), false);
  } finally { winGerman = false; }
});

test('R1-4 (Mac): a job launchd reports switched off is left off: not recorded, not touched', () => {
  macDisabled.add('ava');
  const out = worldstarts.pauseForSwitch([{ name: 'ava', session: 'ava-discord', tied: true }], { platform: MAC });
  assert.deepEqual(out.paused, []);
  assert.match(out.notPaused[0].because, /already switched off/);
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(worldstarts.RECORD_FILE), false);
});

test('R1-4: an agent THIS Kosmos already paused (switched off by us) stays paused and keeps its entry', () => {
  const at = '2026-09-11T00:00:00.000Z';
  writeRecord([{ name: 'ava', why: 'paused', at }]);
  macDisabled.add('ava');
  const out = worldstarts.pauseForSwitch([{ name: 'ava', session: null, tied: true }], { platform: MAC });
  assert.deepEqual(out.paused, ['ava']);
  assert.deepEqual(out.notPaused, []);
  assert.deepEqual(calls, []);
  assert.deepEqual(readRecord().entries, [{ name: 'ava', why: 'paused', at }], 'the earlier pause entry was dropped or rewritten');
});

test('R2: an entry HELD for retry (stop and undo both failed) is not a confirmed pause: a later pause tries the stop again', () => {
  const label = `gui/${UID}/${create.serviceLabel('ava')}`;
  const agent = [{ name: 'ava', session: null, tied: true }];

  // 1. The stop fails and so does the undo: disabled but still running, entry held.
  failing = [{ match: 'bootout', code: 9 }, { match: 'launchctl enable', code: 9 }];
  const first = worldstarts.pauseForSwitch(agent, { platform: MAC });
  assert.deepEqual(first.notPaused.map((n) => n.name), ['ava']);
  assert.ok(readRecord().entries[0].because, 'the control: the entry is held with a because');
  macDisabled.add('ava');   // launchd now reports the job switched off, as it would

  // 2. A later pause from the same Kosmos, still failing: NOT reported paused, and
  //    a fresh stop was attempted rather than trusting the held entry.
  calls = [];
  const second = worldstarts.pauseForSwitch(agent, { platform: MAC });
  assert.deepEqual(second.paused, [], 'an agent that never stopped was reported paused');
  assert.deepEqual(second.notPaused.map((n) => n.name), ['ava']);
  assert.ok(calls.includes(`launchctl bootout ${label}`), 'no fresh stop was attempted');
  assert.match(readRecord().entries[0].because, /could not be stopped/, 'the held entry lost its diagnostic');

  // 3. The stop now works: paused, and the stale because is cleared.
  failing = [];
  const third = worldstarts.pauseForSwitch(agent, { platform: MAC });
  assert.deepEqual(third.paused, ['ava']);
  const entry = readRecord().entries[0];
  assert.equal(entry.name, 'ava');
  assert.equal(entry.because, undefined, 'a confirmed pause must not carry the old failure');
});

test('R3 (Windows arm of R2): a held entry gets a fresh /End, keeps its because while it fails, clears it once it works', () => {
  const task = win32job.taskName('ava');
  const agent = [{ name: 'ava', session: null, tied: true }];
  failing = [{ match: '/End' }, { match: '/ENABLE' }];
  const first = worldstarts.pauseForSwitch(agent, { platform: WIN });
  assert.deepEqual(first.notPaused.map((n) => n.name), ['ava']);
  assert.ok(readRecord().entries[0].because, 'the control: the entry is held with a because');
  winDisabled.add('ava');   // the task now reports Disabled, as it would

  calls = [];
  const second = worldstarts.pauseForSwitch(agent, { platform: WIN });
  assert.deepEqual(second.paused, [], 'an agent that never stopped was reported paused');
  assert.ok(calls.includes(`schtasks /End /TN ${task}`), 'no fresh stop was attempted');
  assert.match(readRecord().entries[0].because, /could not be stopped/);

  failing = [];
  const third = worldstarts.pauseForSwitch(agent, { platform: WIN });
  assert.deepEqual(third.paused, ['ava']);
  assert.deepEqual(third.stoppedNow, ['ava']);
  assert.equal(readRecord().entries[0].because, undefined);
});

for (const arm of [
  { platform: MAC, stop: 'bootout', undo: 'launchctl enable', disable: 'launchctl disable', off: () => macDisabled.add('ava') },
  { platform: WIN, stop: '/End', undo: '/ENABLE', disable: '/DISABLE', off: () => winDisabled.add('ava') },
]) {
  test(`R3 (${arm.platform}): a held entry whose fresh DISABLE fails keeps its entry and because, so a boot still switches it back on`, () => {
    const agent = [{ name: 'ava', session: null, tied: true }];
    failing = [{ match: arm.stop, code: 9 }, { match: arm.undo, code: 9 }];
    worldstarts.pauseForSwitch(agent, { platform: arm.platform });
    const held = readRecord().entries[0];
    assert.ok(held.because, 'the control: the entry is held with a because');
    arm.off();

    failing = [{ match: arm.disable, code: 9 }];
    const again = worldstarts.pauseForSwitch(agent, { platform: arm.platform });
    assert.deepEqual(again.paused, []);
    assert.deepEqual(again.notPaused.map((n) => n.name), ['ava']);
    const entries = readRecord().entries;
    assert.equal(entries.length, 1, 'the held entry was dropped, so no boot will ever switch the job back on');
    assert.equal(entries[0].because, held.because, 'the held entry lost its diagnostic');
  });
}

test('R3: an agent an EARLIER pause stopped is in paused but NOT in stoppedNow (an undo of this call must not start it)', () => {
  writeRecord([{ name: 'ava', why: 'paused', at: new Date().toISOString() }]);
  macDisabled.add('ava');
  const out = worldstarts.pauseForSwitch([
    { name: 'ava', session: null, tied: true },
    { name: 'bo', session: null, tied: true },
  ], { platform: MAC });
  assert.deepEqual(out.paused.sort(), ['ava', 'bo']);
  assert.deepEqual(out.stoppedNow, ['bo']);
});

/* ── #1704 PR4: imported agents start through the same resume ─────────── */

const importEntry = (name, extra = {}) => ({ name, why: 'imported', at: new Date().toISOString(), from: 'src', runner: 'claude', ...extra });
function withInstallJob(fake, fn) {
  const real = create.installJob;
  create.installJob = fake;
  try { return fn(); } finally { create.installJob = real; }
}

test('PR4: an imported agent\'s first start is installJob, handed the runner, model and account the import read', () => {
  writeRecord([importEntry('dee', { runner: 'codex', model: 'gpt-5', configDir: '/Users/x/.codex-work' }), importEntry('eli')]);
  const got = [];
  const r = withInstallJob((name, opts) => { got.push({ name, opts }); return { ok: true, started: true }; },
    () => worldstarts.resumePaused({ platform: MAC }));
  assert.deepEqual(r.resumed, ['dee', 'eli']);
  assert.deepEqual(got, [
    { name: 'dee', opts: { platform: MAC, runner: 'codex', model: 'gpt-5', configDir: '/Users/x/.codex-work' } },
    { name: 'eli', opts: { platform: MAC } },
  ]);
  assert.deepEqual(readRecord().entries, [], 'a started import stayed on the list to start');
});

test('PR4 (Mac, end to end in dry-run): the copy\'s Claude folder is trusted, then installJob enables and bootstraps its job', () => {
  fs.mkdirSync(create.workerDir('fae'), { recursive: true });
  writeRecord([importEntry('fae')]);
  const seen = [];
  create.setRunner((file, args) => { seen.push([nodePath.basename(file), ...args].join(' ')); return answerCreate(file, args); });
  create.setDryRun(true);
  try {
    const r = worldstarts.resumePaused({ platform: MAC });
    assert.deepEqual(r.held, []);
    assert.deepEqual(r.resumed, ['fae']);
    assert.ok(seen.includes(`launchctl enable gui/${UID}/${create.serviceLabel('fae')}`), 'no enable: ' + JSON.stringify(seen));
    assert.ok(seen.includes(`launchctl bootstrap gui/${UID} ${create.plistPath('fae')}`), 'no bootstrap: ' + JSON.stringify(seen));
    const cfg = fs.readFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, 'utf8');
    assert.ok(cfg.includes('fae') && cfg.includes('hasTrustDialogAccepted'),
      'the copy\'s new folder was not trusted, so it would park on Claude\'s trust prompt');
  } finally {
    create.setDryRun(false);
    create.setRunner(answerCreate);
  }
});

test('PR4: an imported agent whose job already exists (a restart after a lost record write) is enabled and started, not reinstalled', () => {
  writeRecord([importEntry('ava')]);
  const r = withInstallJob(() => { throw new Error('installJob must not run for an agent that has a job'); },
    () => worldstarts.resumePaused({ platform: MAC }));
  assert.deepEqual(r.resumed, ['ava']);
  assert.deepEqual(calls, [
    `launchctl enable gui/${UID}/${create.serviceLabel('ava')}`,
    `launchctl bootstrap gui/${UID} ${create.plistPath('ava')}`,
  ]);
});

test('PR4: a job registered but not started keeps its entry, with the sentence, for the next pass', () => {
  writeRecord([importEntry('gil')]);
  const r = withInstallJob(() => ({ ok: true, started: false }), () => worldstarts.resumePaused({ platform: MAC }));
  assert.deepEqual(r.resumed, []);
  assert.equal(r.held[0].because, 'we could not start gil now; it starts at your next login');
  assert.equal(readRecord().entries[0].because, 'we could not start gil now; it starts at your next login');
});

test('PR4: startImported starts only the IMPORTED names it is given', () => {
  writeRecord([{ name: 'bo', why: 'paused', at: new Date().toISOString() }, importEntry('ava'), importEntry('cy')]);
  const r = worldstarts.startImported(['ava', 'bo'], { platform: MAC });
  assert.deepEqual(r.resumed, ['ava'], 'a paused agent was started as if it had been imported');
  assert.equal(calls.some((c) => c.includes('.bo') || c.includes('.cy')), false);
  assert.deepEqual(readRecord().entries.map((e) => e.name), ['bo', 'cy']);
});

test('post-lift: startImported takes no gate beyond live execution -- a named Kosmos\'s import starts at once', () => {
  writeRecord([importEntry('dee')]);
  const got = [];
  const r = withInstallJob((name) => { got.push(name); return { ok: true, started: true }; },
    () => worldstarts.startImported(['dee'], { platform: MAC }));
  assert.deepEqual(r.resumed, ['dee']);
  assert.deepEqual(got, ['dee'], 'an import into the open Kosmos was held instead of started');
});

test('R3 (5): a trust write that throws is logged with its code -- never the account folder -- and the start goes on', () => {
  const trust = require('./trust');
  const realTrust = trust.trustFolder;
  trust.trustFolder = () => { const e = new Error('denied'); e.code = 'EACCES'; throw e; };
  writeRecord([importEntry('tee', { configDir: nodePath.join(SANDBOX, 'acct-secret') })]);
  const real = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  let r;
  try {
    r = withInstallJob(() => ({ ok: true, started: true }), () => worldstarts.startImported(['tee'], { platform: MAC }));
  } finally {
    process.stderr.write = real;
    trust.trustFolder = realTrust;
  }
  assert.deepEqual(r.resumed, ['tee'], 'a failed trust write stopped the start');
  assert.ok(lines.some((l) => l.includes('tee') && l.includes('EACCES')), 'the trust failure was silent: ' + lines.join(''));
  assert.equal(lines.join('').includes('acct-secret'), false, 'an account folder was logged');
});

test('R3 (10): forgetEntries takes a name off the list to start; importsWaitingIn skips a name on that Kosmos\'s removed list', () => {
  writeRecord([importEntry('ava'), importEntry('bo')]);
  fs.mkdirSync(nodePath.dirname(remove.REMOVED_FILE), { recursive: true });
  fs.writeFileSync(remove.REMOVED_FILE, JSON.stringify([{ name: 'bo' }]));
  assert.deepEqual(worldstarts.importsWaitingIn(nodePath.dirname(worldstarts.RECORD_FILE)).map((e) => e.name), ['ava'],
    'a removed agent is still listed as waiting');
  worldstarts.forgetEntries(['ava']);
  assert.deepEqual(readRecord().entries.map((e) => e.name), ['bo']);
});

test('R4: forgetEntries drops only the named entry, whatever its reason -- a paused and an imported agent under other names stay', () => {
  const at = new Date().toISOString();
  writeRecord([{ name: 'pat', why: 'paused', at }, importEntry('imo')]);
  worldstarts.forgetEntries(['pat']);
  assert.deepEqual(readRecord().entries.map((e) => [e.name, e.why]), [['imo', 'imported']], 'removing one agent took another agent\'s entry');
  writeRecord([{ name: 'pat', why: 'paused', at }, importEntry('imo')]);
  worldstarts.forgetEntries(['imo']);
  assert.deepEqual(readRecord().entries.map((e) => [e.name, e.why]), [['pat', 'paused']]);
  worldstarts.forgetEntries(['nobody']);
  assert.deepEqual(readRecord().entries.map((e) => e.name), ['pat'], 'forgetting a name with no entry changed the list');
});

test('post-lift: an entry still carrying a pre-lift named-world sentence is read with no reason, not shown as barred', () => {
  const stale = [
    'Agents do not run in a named Kosmos yet, so it waits there and starts on its own once they can.',
    'Kosmos is running a named world, which does not run agents yet. Switch back to Kosmos 1 (the default world) to create agents.',
  ];
  writeRecord([importEntry('old1', { because: stale[0] }), importEntry('old2', { because: stale[1] }), importEntry('real', { because: 'we could not start real now; it starts at your next login' })]);
  assert.deepEqual(worldstarts.importsWaitingIn(nodePath.dirname(worldstarts.RECORD_FILE)), [
    { name: 'old1', because: null },
    { name: 'old2', because: null },
    { name: 'real', because: 'we could not start real now; it starts at your next login' },
  ]);
});

test('PR4: live execution OFF holds imported agents with a sentence that does not claim nothing changed', () => {
  liveExec.resetForTests();
  writeRecord([importEntry('dee')]);
  const r = withInstallJob(() => { throw new Error('installJob ran with live execution off'); },
    () => worldstarts.startImported(['dee'], { platform: MAC }));
  assert.equal(r.held[0].because, 'Kosmos is not allowed to start agents from here, so it has not been started yet');
  assert.match(String(r.refused), /test process/);
  assert.deepEqual(calls, []);
  assert.deepEqual(readRecord().entries.map((e) => e.name), ['dee'], 'it must stay recorded for the next boot');
});

test('PR4: recordImport writes into ANOTHER Kosmos\'s store; importsWaitingIn reads it back; a same-name entry is replaced', () => {
  const root = fs.mkdtempSync(nodePath.join(SANDBOX, 'other-kosmos-'));
  assert.deepEqual(worldstarts.recordImport(root, { name: 'zed', from: 'default', runner: 'claude', model: null, configDir: null }), { ok: true });
  assert.deepEqual(worldstarts.recordImport(root, { name: 'zed', from: 'default', runner: 'codex', model: 'gpt-5' }), { ok: true });
  const entries = JSON.parse(fs.readFileSync(worldstarts.recordFileIn(root), 'utf8')).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].runner, 'codex');
  assert.equal(entries[0].model, 'gpt-5');
  assert.deepEqual(worldstarts.importsWaitingIn(root), [{ name: 'zed', because: null }]);
  assert.equal(fs.existsSync(worldstarts.RECORD_FILE), false, 'the booted world\'s record was written instead');
  // An unreadable record there is refused, never overwritten.
  fs.writeFileSync(worldstarts.recordFileIn(root), '{ not json');
  assert.equal(worldstarts.recordImport(root, { name: 'amy', from: 'default', runner: 'claude' }).ok, false);
  assert.equal(fs.readFileSync(worldstarts.recordFileIn(root), 'utf8'), '{ not json');
});

test('an unreadable record is refused, never rewritten from empty', () => {
  fs.mkdirSync(nodePath.dirname(worldstarts.RECORD_FILE), { recursive: true });
  fs.writeFileSync(worldstarts.RECORD_FILE, '{ not json');
  const out = worldstarts.pauseForSwitch([{ name: 'ava', session: null, tied: true }], { platform: MAC });
  assert.deepEqual(out.paused, []);
  assert.match(out.notPaused[0].because, /could not read the list/);
  assert.equal(calls.some((c) => /disable|bootout/.test(c)), false, 'nothing may stop without its entry written first');
  assert.equal(fs.readFileSync(worldstarts.RECORD_FILE, 'utf8'), '{ not json', 'the unreadable record was overwritten');
});

test('R1 TEST-GAP (Windows, the path this box ships): no task yet -> the folder is trusted on its account, then installJob gets the win32 spec', () => {
  winMissing.add('wen');
  fs.mkdirSync(create.workerDir('wen'), { recursive: true });
  const account = nodePath.join(SANDBOX, 'acct-wen');
  fs.mkdirSync(account, { recursive: true });
  writeRecord([importEntry('wen', { model: 'claude-opus-4', configDir: account })]);
  const got = [];
  const r = withInstallJob((name, opts) => { got.push({ name, opts }); return { ok: true, started: true }; },
    () => worldstarts.startImported(['wen'], { platform: WIN }));
  assert.deepEqual(r.held, []);
  assert.deepEqual(r.resumed, ['wen']);
  assert.ok(calls.some((c) => c.includes('/Query') && c.includes(win32job.taskName('wen'))), 'the start never looked for the task');
  assert.equal(calls.some((c) => /\/Change|\/Run/.test(c)), false, 'a task that is not there was enabled or run');
  assert.deepEqual(got, [{ name: 'wen', opts: { platform: WIN, model: 'claude-opus-4', configDir: account } }]);
  const cfg = fs.readFileSync(nodePath.join(account, '.claude.json'), 'utf8');
  assert.ok(cfg.includes('wen') && cfg.includes('hasTrustDialogAccepted'), 'the copy was not trusted on the account it will run on');
});
