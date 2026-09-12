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
    const off = [...winDisabled].some((n) => args.includes(win32job.taskName(n)));
    return { ok: true, out: off ? 'Status: Disabled\n' : 'Status: Ready\n' };
  }
  const fail = failing.find((f) => line.includes(f.match));
  if (fail) return { ok: false, out: 'ERROR: ' + fail.match };
  return { ok: true, out: 'SUCCESS' };
}

// create.js's own runner answers launchd's per-user overrides (create.disabledJobs).
function answerCreate(file, args) {
  if (args[0] === 'print-disabled') {
    return { ok: true, stdout: [...macDisabled].map((n) => `\t"${create.serviceLabel(n)}" => disabled`).join('\n') };
  }
  return { ok: true, stdout: '' };
}

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
  macDisabled = new Set(); winDisabled = new Set();
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

test('#2849: the drain holds every entry while the spawn refusal refuses, with its sentence, and sends nothing', () => {
  const at = new Date().toISOString();
  writeRecord([{ name: 'ava', why: 'paused', at }, { name: 'bo', why: 'paused', at }]);
  const refusal = { code: 409, error: 'Kosmos is running a named world, which does not run agents yet.' };
  const r = worldstarts.drainAtBoot({ platform: MAC, spawnRefusal: () => refusal });
  assert.deepEqual(r.resumed, []);
  assert.deepEqual(r.held.map((h) => h.name), ['ava', 'bo']);
  assert.deepEqual(calls, [], 'a held agent must not be enabled or started');
  const entries = readRecord().entries;
  assert.deepEqual(entries.map((e) => e.name), ['ava', 'bo'], 'held entries stay, to resume once the rule is lifted');
  assert.equal(entries[0].because, refusal.error);

  // And once the refusal lifts, the same entries resume.
  const later = worldstarts.drainAtBoot({ platform: MAC, spawnRefusal: () => null });
  assert.deepEqual(later.resumed, ['ava', 'bo']);
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

test('an unreadable record is refused, never rewritten from empty', () => {
  fs.mkdirSync(nodePath.dirname(worldstarts.RECORD_FILE), { recursive: true });
  fs.writeFileSync(worldstarts.RECORD_FILE, '{ not json');
  const out = worldstarts.pauseForSwitch([{ name: 'ava', session: null, tied: true }], { platform: MAC });
  assert.deepEqual(out.paused, []);
  assert.match(out.notPaused[0].because, /could not read the list/);
  assert.equal(calls.some((c) => /disable|bootout/.test(c)), false, 'nothing may stop without its entry written first');
  assert.equal(fs.readFileSync(worldstarts.RECORD_FILE, 'utf8'), '{ not json', 'the unreadable record was overwritten');
});
