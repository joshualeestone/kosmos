'use strict';
/**
 * world-guard-lift-1704: #2849's refusal is gone, so a board booted into a NAMED
 * Kosmos creates, restarts, removes and restores its own agents. The guard existed
 * because those acts used to land on the bare agent name, and so on Kosmos 1's
 * like-named agent. Each act must now land on launchidentity.launchKey(name, world)
 * and name nothing of Kosmos 1's.
 *
 * The Mac arm is driven through create.setRunner / remove.setRunner and the pane
 * source; the Windows arm through win32job.setRunner, win32stop.setLive and the
 * supervisor's ownership record. Both run from either kind of host, and nothing
 * here reaches a real launchd, tmux or Task Scheduler.
 *
 *   node --test engine/world-guard-lift-1704.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// SANDBOX BEFORE REQUIRING: store.ROOT, the launch dir and the workers dir are
// frozen at require time by the modules below, and create writes Claude's config.
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'world-guard-lift-')));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const win32job = require('./win32job');
const win32stop = require('./win32stop');
const win32create = require('./win32create');
const win32sessions = require('./win32sessions');
const win32launch = require('./win32launch');
const launchidentity = require('./launchidentity');
const fleet = require('../test-support/fleet');

// The darwin arm builds gui/<uid>/<label>; win32 has no getuid.
if (typeof process.getuid !== 'function') process.getuid = () => 501;
const UID = process.getuid();
const MAC = 'darwin';
const WIN = 'win32';
const WORLD = 'test';
const KEY = launchidentity.launchKey('ava', WORLD);

/* A real, runnable file on this host; never spawned (the runners are stubbed).
   Forward slashes: create.unusablePath refuses a backslash on the darwin arm. */
const HOST_BIN = process.platform === 'win32' ? 'C:/Windows/System32/cmd.exe' : '/bin/echo';
const BINS = { claudeBin: HOST_BIN, tmuxBin: HOST_BIN };

/* The board serves Kosmos "test" for this whole file. KOSMOS_WORLD is what
   launchidentity.currentWorldId reads, and what worlds.applyWorldEnv sets when a
   board boots into a named world. */
const savedWorld = process.env.KOSMOS_WORLD;
process.env.KOSMOS_WORLD = WORLD;

/* Kosmos 1's `ava`, the collision the guard was for: its bare plist is on disk,
   and every command below must leave it and its task, label and session alone. */
const DEFAULT_PLIST = nodePath.join(process.env.AGENT_WORKFORCE_LAUNCH, 'com.kosmos.agent.ava.plist');
const DEFAULT_PLIST_BODY = '<plist>kosmos-1 ava</plist>';
fs.mkdirSync(nodePath.dirname(DEFAULT_PLIST), { recursive: true });
fs.writeFileSync(DEFAULT_PLIST, DEFAULT_PLIST_BODY);
/* A command naming Kosmos 1's `ava`: its bare label or plist, its bare task, or
   its bare tmux session target. */
const NAMES_DEFAULT_AVA = /com\.kosmos\.agent\.ava(?!\+)|\\agent-ava(?!\+)|=ava(?![+\w-])/;

win32create.setPark(() => {});   // never serve the real create wait

test.after(() => {
  remove.setRunner(null);
  create.setRunner(null);
  win32job.setRunner(null);
  win32job.setAnchorer(null);
  win32stop.setLive(null);
  win32create.setPark(null);
  win32launch.setSpawn(null);
  if (savedWorld === undefined) delete process.env.KOSMOS_WORLD; else process.env.KOSMOS_WORLD = savedWorld;
});

/** The board sees `session` running (tied by Kosmos's claim), or nothing. */
function paneShows(session) {
  status.setPaneSource(() => (session ? fleet.line({ session, claim: session, title: '✳ Claude Code' }) : ''));
}

/** A launchd + tmux world that answers every act with success and records it. */
function macWorld() {
  const calls = [];
  remove.setRunner((file, args) => {
    calls.push([nodePath.basename(file), ...args].join(' '));
    // has-session exit 1 is "no such session": the kill worked.
    if (args[0] === 'has-session') return { ok: false, code: 1 };
    return { ok: true, stdout: '' };
  });
  remove.setDryRun(false);
  return calls;
}

/** A Task Scheduler that answers every act with success and records it. */
function winWorld({ taskExists = true, onRun = null, onCreate = null } = {}) {
  const calls = [];
  win32job.setAnchorer(() => ({ ok: true, node: 'C:\\Anchor\\node.exe', boot: 'C:\\Anchor\\supervisor-boot.js' }));
  win32job.setRunner((args) => {
    calls.push(['schtasks', ...args].join(' '));
    if (args[0] === '/Query') {
      return taskExists ? { ok: true, out: 'Status: Ready\n' } : { ok: false, out: 'ERROR: The system cannot find the file specified.' };
    }
    if (args[0] === '/Create' && onCreate) onCreate(args);
    if (args[0] === '/Run' && onRun) onRun(args[args.indexOf('/TN') + 1]);
    return { ok: true, out: 'SUCCESS' };
  });
  win32stop.setLive(() => new Map());   // nothing live under any name: the end state
  remove.setDryRun(false);
  return calls;
}

/** Every `/TN` a set of schtasks calls named. */
const tasksNamed = (calls) => calls.map((c) => (/\/TN (\S+)/.exec(c) || [])[1]).filter(Boolean);

function assertKosmos1Untouched(calls) {
  assert.deepEqual(calls.filter((c) => NAMES_DEFAULT_AVA.test(c)), [], 'a named Kosmos reached Kosmos 1\'s ava');
  assert.equal(fs.readFileSync(DEFAULT_PLIST, 'utf8'), DEFAULT_PLIST_BODY, 'Kosmos 1\'s ava plist was rewritten');
}

test('Mac: a create in a named Kosmos writes and starts ITS keyed job, and Kosmos 1\'s like-named job is untouched', () => {
  const calls = [];
  create.setRunner((file, args) => { calls.push([nodePath.basename(file), ...args].join(' ')); return { ok: true, stdout: '' }; });
  create.setDryRun(false);
  paneShows(null);
  let r;
  try {
    r = create.createAgent({ ...BINS, name: 'ava', role: 'pm', platform: MAC });
  } finally {
    create.setRunner(null);
  }
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);

  const plist = create.plistPath('ava');
  assert.match(plist, /com\.kosmos\.agent\.ava\+test\.plist$/);
  const body = fs.readFileSync(plist, 'utf8');
  assert.match(body, /<key>Label<\/key><string>com\.kosmos\.agent\.ava\+test<\/string>/);
  assert.match(body, /<key>KOSMOS_WORLD<\/key><string>test<\/string>/);
  assert.ok(body.includes(`<string>${KEY}</string>`), 'the supervisor\'s tmux session is the launch key');
  assert.ok(calls.some((c) => c.includes(`com.kosmos.agent.${KEY}`)), 'the control: create named its job to launchd');
  assertKosmos1Untouched(calls);
});

test('Mac: restart, remove and restore in a named Kosmos act only on its keyed label, plist and session', () => {
  if (!fs.existsSync(create.plistPath('ava'))) fs.writeFileSync(create.plistPath('ava'), '<plist/>');
  const all = [];

  paneShows(KEY);
  let calls = macWorld();
  const rs = remove.restart('ava', 'restart', { platform: MAC });
  assert.equal(rs.outcome, remove.OUTCOME.RESTARTED, rs.because);
  assert.ok(calls.includes(`tmux kill-session -t =${KEY}`), 'restart did not end this world\'s session: ' + JSON.stringify(calls));
  assert.ok(calls.includes(`launchctl bootout gui/${UID}/com.kosmos.agent.${KEY}`));
  assert.ok(calls.includes(`launchctl bootstrap gui/${UID} ${create.plistPath('ava')}`));
  all.push(...calls);

  calls = macWorld();
  const rm = remove.remove('ava', { platform: MAC });
  assert.equal(rm.outcome, remove.OUTCOME.REMOVED, rm.because);
  assert.ok(calls.includes(`launchctl disable gui/${UID}/com.kosmos.agent.${KEY}`), 'remove did not switch off this world\'s job: ' + JSON.stringify(calls));
  assert.ok(calls.includes(`tmux kill-session -t =${KEY}`));
  const record = remove.removedAgents().find((a) => a.name === 'ava');
  assert.equal(record.label, `com.kosmos.agent.${KEY}`, 'restore reads this label back, so it must be this world\'s');
  all.push(...calls);

  paneShows(null);
  calls = macWorld();
  const back = remove.restore('ava', { platform: MAC });
  assert.equal(back.outcome, remove.OUTCOME.RESTORED, back.because);
  assert.ok(calls.includes(`launchctl enable gui/${UID}/com.kosmos.agent.${KEY}`));
  assert.ok(calls.includes(`launchctl bootstrap gui/${UID} ${create.plistPath('ava')}`));
  all.push(...calls);

  assertKosmos1Untouched(all);
});

test('Windows: a create in a named Kosmos registers and runs ITS keyed task, carrying the world as argument seven', () => {
  let createdLine = null;
  const calls = winWorld({
    taskExists: false,
    // The line the task was registered with, read back out of its XML.
    onCreate: (args) => {
      const xml = fs.readFileSync(args[args.indexOf('/XML') + 1]).toString('utf16le');
      createdLine = win32job.xmlUnescape(/<Arguments>([^<]*)<\/Arguments>/.exec(xml)[1]);
    },
    // The supervisor the task would start writes its ownership row under the
    // agent's PLAIN name; the record is already this world's store.
    onRun: (task) => {
      const name = launchidentity.parseKey(String(task).replace(/^.*\\agent-/, '')).name;
      win32sessions.record('sess-9001-0000', { name, runner: 'claude' });
    },
  });
  win32launch.setSpawn(() => ({ pid: 777, unref() {} }));
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  paneShows(null);
  let r;
  try {
    r = create.createAgent({ name: 'cy', role: 'qa', platform: WIN, claudeBin: process.execPath, tmuxBin: '/nonexistent/tmux' });
  } finally {
    create.setRunner(null);
  }
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  const named = tasksNamed(calls);
  assert.ok(named.length >= 2, 'the control: create named a task: ' + JSON.stringify(calls));
  for (const t of named) assert.equal(t, 'Kosmos\\agent-cy+test', 'a create in Kosmos "test" named ' + t);
  assert.ok(calls.some((c) => c.startsWith('schtasks /Create /F /TN Kosmos\\agent-cy+test')));
  const argv = (createdLine.match(/"[^"]*"/g) || []).map((q) => q.slice(1, -1)).slice(2);
  assert.equal(argv[6], WORLD, 'the task line hands the agent its Kosmos as argument seven');
});

test('Windows: restart, remove and restore in a named Kosmos act only on its keyed task', () => {
  const all = [];

  paneShows(KEY);
  let calls = winWorld();
  const rs = remove.restart('ava', 'restart', { platform: WIN });
  assert.equal(rs.outcome, remove.OUTCOME.RESTARTED, rs.because);
  assert.ok(calls.includes(`schtasks /End /TN Kosmos\\agent-${KEY}`), JSON.stringify(calls));
  assert.ok(calls.includes(`schtasks /Run /TN Kosmos\\agent-${KEY}`));
  all.push(...calls);

  calls = winWorld();
  const rm = remove.remove('ava', { platform: WIN });
  assert.equal(rm.outcome, remove.OUTCOME.REMOVED, rm.because);
  assert.ok(calls.includes(`schtasks /Change /TN Kosmos\\agent-${KEY} /DISABLE`), JSON.stringify(calls));
  assert.equal(remove.removedAgents().find((a) => a.name === 'ava').label, `Kosmos\\agent-${KEY}`);
  all.push(...calls);

  paneShows(null);
  calls = winWorld();
  const back = remove.restore('ava', { platform: WIN });
  assert.equal(back.outcome, remove.OUTCOME.RESTORED, back.because);
  assert.ok(calls.includes(`schtasks /Change /TN Kosmos\\agent-${KEY} /ENABLE`), JSON.stringify(calls));
  assert.ok(calls.includes(`schtasks /Run /TN Kosmos\\agent-${KEY}`));
  all.push(...calls);

  for (const t of tasksNamed(all)) assert.equal(t, `Kosmos\\agent-${KEY}`, 'an act in Kosmos "test" named ' + t);
  assertKosmos1Untouched(all);
});

test('the create probe (never overwrite) asks about THIS Kosmos\'s job on both arms, so Kosmos 1\'s ava does not block it', () => {
  // Kosmos 1's ava has a job on disk; the named world's probe must not see it.
  fs.rmSync(create.plistPath('ava'), { force: true });
  assert.equal(create.hasJob('ava', MAC), false, 'Kosmos 1\'s bare plist was read as this world\'s job');
  fs.writeFileSync(create.plistPath('ava'), '<plist/>');
  assert.equal(create.hasJob('ava', MAC), true, 'the control: this world\'s own keyed plist is seen');

  const calls = winWorld({ taskExists: false });
  assert.equal(create.hasJob('ava', WIN), false);
  assert.deepEqual(tasksNamed(calls), [`Kosmos\\agent-${KEY}`]);
});
