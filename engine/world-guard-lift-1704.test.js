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
const win32live = require('./win32live');
const win32roster = require('./win32roster');
const launchidentity = require('./launchidentity');
const worlds = require('./worlds');
const team = require('./team');
const register = require('./register');
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
    // The folder listing (`/Query /TN Kosmos\ /FO CSV`, register.survey's one
    // query): an empty, readable answer, so every agent reads as having no task.
    if (args[0] === '/Query' && args.includes('CSV')) return { ok: true, out: '' };
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

/* Two live Claude sessions named `ava` on this machine, as `claude agents --json`
   lists them: Kosmos 1's (pid 111, recorded in Kosmos 1's store, so NOT in this
   one's) and this Kosmos's (pid 222, recorded here). The roster and the stop both
   run the REAL join (win32roster.make, win32live.byName) against this world's
   ownership record, so only pid 222 may ever be ended. */
const LIVE = [
  { sessionId: 'sess-kosmos1-ava', name: 'ava', pid: 111, status: 'idle' },
  { sessionId: 'sess-test-ava', name: 'ava', pid: 222, status: 'idle' },
];
function windowsSessionsLive() {
  win32sessions.record('sess-test-ava', { name: 'ava', runner: 'claude' });
  status.setPaneSource(win32roster.make({ run: () => LIVE }));
  win32stop.setLive(() => win32live.byName({ run: () => LIVE }));
  const killed = [];
  win32stop.setRunner((args) => { killed.push(args.join(' ')); return { ok: true, out: '' }; });
  win32stop.setAlive(() => false);   // the look-again: the killed pid is gone
  return killed;
}

test('Windows: restart, remove and restore in a named Kosmos act only on its keyed task and its OWN live session', () => {
  const all = [];
  const killedAll = [];

  let calls = winWorld();
  let killed = windowsSessionsLive();
  const card = status.paneRoster().find((c) => c.sessionName === 'ava');
  assert.ok(card, 'the control: a named Kosmos\'s Windows roster shows its own ava');
  const rs = remove.restart('ava', 'restart', { platform: WIN });
  assert.equal(rs.outcome, remove.OUTCOME.RESTARTED, rs.because);
  assert.deepEqual(killed, ['/PID 222 /T /F'], 'restart ended a session that is not this Kosmos\'s');
  assert.ok(calls.includes(`schtasks /End /TN Kosmos\\agent-${KEY}`), JSON.stringify(calls));
  assert.ok(calls.includes(`schtasks /Run /TN Kosmos\\agent-${KEY}`));
  all.push(...calls);
  killedAll.push(...killed);

  calls = winWorld();
  killed = windowsSessionsLive();
  const rm = remove.remove('ava', { platform: WIN });
  assert.equal(rm.outcome, remove.OUTCOME.REMOVED, rm.because);
  assert.deepEqual(killed, ['/PID 222 /T /F'], 'remove ended a session that is not this Kosmos\'s');
  assert.ok(calls.includes(`schtasks /Change /TN Kosmos\\agent-${KEY} /DISABLE`), JSON.stringify(calls));
  assert.equal(remove.removedAgents().find((a) => a.name === 'ava').label, `Kosmos\\agent-${KEY}`);
  all.push(...calls);
  killedAll.push(...killed);
  win32stop.setRunner(null);
  win32stop.setAlive(null);
  assert.ok(!killedAll.some((k) => k.includes('/PID 111')), 'Kosmos 1\'s ava process was ended');

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

/* ── review round 1 ───────────────────────────────────────────────────── */

/** Run `body` as the DEFAULT board (Kosmos 1), then back to Kosmos "test". */
function asKosmos1(body) {
  delete process.env.KOSMOS_WORLD;
  try { return body(); } finally { process.env.KOSMOS_WORLD = WORLD; }
}

test('R1 (a): in a named Kosmos, remove, restart and restore never reach Kosmos 1\'s legacy com.<name>.discord job', () => {
  // A worker folder for `dee` in this Kosmos, no keyed plist, and the legacy,
  // unkeyed com.dee.discord.plist on disk (Kosmos 1's).
  fs.mkdirSync(create.workerDir('dee'), { recursive: true });
  const legacy = nodePath.join(process.env.AGENT_WORKFORCE_LAUNCH, 'com.dee.discord.plist');
  fs.writeFileSync(legacy, '<plist/>');
  try {
    assert.equal(remove.jobFor('dee', MAC), null, 'a named Kosmos was offered Kosmos 1\'s legacy job');
    const all = [];

    paneShows(null);
    let calls = macWorld();
    remove.remove('dee', { platform: MAC });
    all.push(...calls);
    const record = remove.removedAgents().find((a) => a.name === 'dee');
    assert.ok(!record || !record.label, 'the removal recorded the legacy label for a later restore to switch on');

    paneShows(launchidentity.launchKey('dee', WORLD));
    calls = macWorld();
    remove.restart('dee', 'restart', { platform: MAC });
    all.push(...calls);

    calls = macWorld();
    remove.restore('dee', { platform: MAC });
    all.push(...calls);

    assert.deepEqual(all.filter((c) => c.includes('com.dee.discord')), [], 'a named Kosmos acted on Kosmos 1\'s legacy job');

    // Control: Kosmos 1 still finds its own legacy job.
    const found = asKosmos1(() => remove.jobFor('dee', MAC));
    assert.ok(found, 'the control: Kosmos 1 no longer finds the legacy job');
    assert.equal(found.label, 'com.dee.discord');
    assert.equal(found.ours, false);
  } finally {
    fs.rmSync(legacy, { force: true });
    try { remove.forgetRemoval && remove.forgetRemoval('dee'); } catch { /* best effort */ }
  }
});

test('R1 (c): a crafted `<name>+<world>` is refused on both arms, before any command', () => {
  const crafted = launchidentity.launchKey('ava', WORLD);
  assert.ok(fs.existsSync(create.plistPath('ava')), 'the control: the named world\'s ava has its keyed plist, which a crafted name would reach');
  asKosmos1(() => {
    assert.match(String(remove.unsafeToActOn(crafted)), /another Kosmos/);
    for (const platform of [MAC, WIN]) {
      const mac = macWorld();
      const win = winWorld();
      paneShows(null);
      const rm = remove.remove(crafted, { platform });
      const rs = remove.restart(crafted, 'restart', { platform });
      const back = remove.restore(crafted, { platform });
      for (const r of [rm, rs, back]) assert.equal(r.outcome, remove.OUTCOME.REFUSED, `${platform}: ${r.because}`);
      assert.deepEqual([...mac, ...win].filter((c) => !c.includes('/Query')), [], `${platform}: a crafted name reached a command`);
    }
  });
});

test('R1 (c): a NEW agent name can never hold the separator (create\'s NAME_RE refuses it)', () => {
  paneShows(null);
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  let r;
  try {
    r = asKosmos1(() => create.createAgent({ ...BINS, name: 'eve+test', role: 'pm', platform: MAC }));
  } finally {
    create.setRunner(null);
  }
  assert.notEqual(r.outcome, create.OUTCOME.CREATED);
  assert.equal(fs.existsSync(create.workerDir('eve+test')), false, 'a folder was made for a name holding the separator');
});

test('R1 (b): launchd\'s fleet probes answer in THIS Kosmos\'s names; Kosmos 1\'s and other worlds\' keys are dropped', () => {
  create.setRunner((file, args) => {
    if (args[0] === 'print-disabled') {
      return { ok: true, stdout: '\t"com.kosmos.agent.ava" => disabled\n\t"com.kosmos.agent.bo+test" => true\n\t"com.kosmos.agent.cy+other" => true\n' };
    }
    if (args[0] === 'list') {
      return { ok: true, stdout: 'PID\tStatus\tLabel\n111\t0\tcom.kosmos.agent.ava\n222\t0\tcom.kosmos.agent.bo+test\n333\t0\tcom.kosmos.agent.cy+other\n' };
    }
    return { ok: true, stdout: '' };
  });
  create.setDryRun(false);
  try {
    assert.deepEqual([...create.disabledJobs()], ['bo'], 'a named Kosmos read another Kosmos\'s switched-off job as its own');
    assert.deepEqual([...create.runningJobs()], ['bo'], 'a named Kosmos read another Kosmos\'s running job as its own');
    asKosmos1(() => {
      assert.deepEqual([...create.disabledJobs()], ['ava'], 'the control: Kosmos 1 keeps its own');
      assert.deepEqual([...create.runningJobs()], ['ava']);
    });
  } finally {
    create.setRunner(null);
  }
});

test('R1: a named Kosmos\'s Windows roster keeps its own rows (they carry the plain name); tmux rows stay keyed', () => {
  // The row win32roster emits: the plain name as session, claim and title, under claude.exe.
  const windowsRow = fleet.line({ session: 'ava', command: win32roster.WIN32_COMMAND, claim: 'ava', runner: 'claude', title: 'ava' });
  const kosmos1Tmux = fleet.line({ session: 'bo', claim: 'bo' });
  const ownTmux = fleet.line({ session: 'cy+test', claim: 'cy+test' });
  // parsePanes drops another Kosmos's row outright, so Kosmos 1's `bo` is absent.
  const names = status.parsePanes([windowsRow, kosmos1Tmux, ownTmux].join('\n')).map((p) => p.name);
  assert.deepEqual(names, ['ava', 'cy'],
    'a Windows row was dropped (the named board would see none of its agents), or a tmux row lost its key filter');
  // The whole roster, the way the board reads it: the named Kosmos sees its Windows agent.
  status.setPaneSource(() => windowsRow + '\n');
  assert.deepEqual(status.paneRoster().map((c) => c.sessionName), ['ava']);
});

/* ── Renet's condition 2: the BOOTED world, never the registry's active one ──
   A switch only records activeWorldId and needs a restart to take effect, so until
   that restart every spawn must key to the world the board BOOTED into (the
   KOSMOS_WORLD the boot applied, worlds.applyWorldEnv), never to the registry. */

/** Every launch key a set of commands named: launchd labels and plists, and task names. */
function launchKeysNamed(calls) {
  const keys = [];
  for (const c of calls) {
    for (const m of c.matchAll(/com\.kosmos\.agent\.([A-Za-z0-9_+-]+?)(?:\.plist)?(?=\s|$)/g)) keys.push(m[1]);
    const task = /\/TN \S*\\agent-(\S+)/.exec(c);
    if (task) keys.push(task[1]);
  }
  return keys;
}
/** The supervisor a task starts writes its ownership row under the plain name. */
function supervisorRecordsOnRun(task) {
  const name = launchidentity.parseKey(String(task).replace(/^.*\\agent-/, '')).name;
  win32sessions.record(`sess-${name}-9002`, { name, runner: 'claude' });
}
/** Point the registry's ACTIVE world at `id`, the way a switch does, with no restart. */
function switchWithoutRestart(id) {
  const base = worlds.baseRoot(process.env);
  if (!worlds.listWorlds(base).some((w) => w.id === WORLD)) worlds.createWorld(base, WORLD);
  worlds.setActiveWorld(base, id);
  assert.equal(worlds.activeWorld(base).id, id, 'the control: the registry now points at ' + id);
  return base;
}
function workerFolder(name) {
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), `You are **${name}**.\n`);
}

test('Renet (2): a board BOOTED into "test" whose registry was switched to Kosmos 1 WITHOUT a restart keys create, adopt, team, restore and repair to "test" on both arms', () => {
  const base = switchWithoutRestart(worlds.DEFAULT_ID);
  try {
    assert.equal(launchidentity.currentWorldId(), WORLD, 'the control: the board is still booted into "test"');
    const mac = [];
    const win = [];

    // Mac: create, adopt, team.
    create.setRunner((file, args) => { mac.push([nodePath.basename(file), ...args].join(' ')); return { ok: true, stdout: '' }; });
    create.setDryRun(false);
    paneShows(null);
    try {
      const made = create.createAgent({ ...BINS, name: 'fin', role: 'pm', platform: MAC });
      assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
      workerFolder('hal');
      const adopted = create.installJob('hal', { ...BINS, platform: MAC });   // discover.connect's act
      assert.equal(adopted.ok, true, adopted.because);
      const built = team.createTeam({ creator: 'operator', purpose: 'Renet condition 2', members: [{ ...BINS, name: 'ivy', role: 'qa', platform: MAC }] });
      assert.equal(built.outcome, 'created', JSON.stringify(built.refused));
    } finally {
      create.setRunner(null);
    }

    // Windows: create, adopt.
    const winCreate = winWorld({ taskExists: false, onRun: supervisorRecordsOnRun });
    win32launch.setSpawn(() => ({ pid: 777, unref() {} }));
    create.setRunner(() => ({ ok: true, stdout: '' }));
    create.setDryRun(false);
    try {
      const made = create.createAgent({ name: 'jon', role: 'qa', platform: WIN, claudeBin: process.execPath, tmuxBin: HOST_BIN });
      assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
      workerFolder('kay');
      const adopted = create.installJob('kay', { platform: WIN, claudeBin: process.execPath, tmuxBin: HOST_BIN });
      assert.equal(adopted.ok, true, adopted.because);
    } finally {
      create.setRunner(null);
    }
    win.push(...winCreate);

    // Restore (the re-enable #2849 guarded), on both arms: remove, then restore.
    paneShows(null);
    let calls = macWorld();
    assert.equal(remove.remove('fin', { platform: MAC }).outcome, remove.OUTCOME.REMOVED);
    assert.equal(remove.restore('fin', { platform: MAC }).outcome, remove.OUTCOME.RESTORED);
    mac.push(...calls);
    calls = winWorld();
    assert.equal(remove.remove('jon', { platform: WIN }).outcome, remove.OUTCOME.REMOVED);
    assert.equal(remove.restore('jon', { platform: WIN }).outcome, remove.OUTCOME.RESTORED);
    win.push(...calls);

    // Register repair on both arms: fin loses its job file, and every agent is jobless to a fresh Task Scheduler.
    // repair passes installJob no binaries, so the runner and terminal come from the env overrides.
    fs.rmSync(create.plistPath('fin'), { force: true });
    const savedBins = { claude: process.env.AGENT_WORKFORCE_CLAUDE_BIN, tmux: process.env.AGENT_WORKFORCE_TMUX_BIN };
    process.env.AGENT_WORKFORCE_CLAUDE_BIN = HOST_BIN;
    process.env.AGENT_WORKFORCE_TMUX_BIN = HOST_BIN;
    const macRepair = [];
    create.setRunner((file, args) => { macRepair.push([nodePath.basename(file), ...args].join(' ')); return { ok: true, stdout: '' }; });
    create.setDryRun(false);
    try {
      const macRepairResult = register.repair({ platform: MAC, modelFor: () => null });
      assert.ok(macRepair.some((c) => c.includes(`com.kosmos.agent.fin+${WORLD}`)),
        'the control: the Mac repair re-installed fin: ' + JSON.stringify({ calls: macRepair, result: macRepairResult }));
      mac.push(...macRepair);
      const winRepair = winWorld({ taskExists: false, onRun: supervisorRecordsOnRun });
      const winRepairResult = register.repair({ platform: WIN, modelFor: () => null });
      assert.ok(winRepair.some((c) => c.startsWith('schtasks /Create')),
        'the control: the Windows repair installed a task: ' + JSON.stringify({ calls: winRepair, result: winRepairResult }));
      win.push(...winRepair);
    } finally {
      create.setRunner(null);
      for (const [k, v] of [['AGENT_WORKFORCE_CLAUDE_BIN', savedBins.claude], ['AGENT_WORKFORCE_TMUX_BIN', savedBins.tmux]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }

    const keys = launchKeysNamed([...mac, ...win]);
    assert.ok(keys.length >= 10, 'the control: the acts named their launch identities: ' + JSON.stringify(keys));
    assert.deepEqual(keys.filter((k) => !k.endsWith(`+${WORLD}`)), [],
      'a spawn keyed to the registry\'s active world (Kosmos 1) instead of the booted one');
    assert.ok(mac.some((c) => c.includes(`com.kosmos.agent.hal+${WORLD}`)), 'adopt did not key to the booted world');
    assert.ok(mac.some((c) => c.includes(`com.kosmos.agent.ivy+${WORLD}`)), 'team did not key to the booted world');
    assert.ok(win.some((c) => c.includes(`Kosmos\\agent-kay+${WORLD}`)), 'the Windows adopt did not key to the booted world');
  } finally {
    worlds.setActiveWorld(base, worlds.DEFAULT_ID);
  }
});

test('Renet (2) mirror: a board BOOTED into Kosmos 1 whose registry was switched to "test" WITHOUT a restart still keys bare', () => {
  const base = switchWithoutRestart(WORLD);
  try {
    asKosmos1(() => {
      assert.equal(launchidentity.currentWorldId(), worlds.DEFAULT_ID, 'the control: the board is still booted into Kosmos 1');
      const mac = [];
      create.setRunner((file, args) => { mac.push([nodePath.basename(file), ...args].join(' ')); return { ok: true, stdout: '' }; });
      create.setDryRun(false);
      paneShows(null);
      try {
        assert.equal(create.createAgent({ ...BINS, name: 'lee', role: 'pm', platform: MAC }).outcome, create.OUTCOME.CREATED);
      } finally {
        create.setRunner(null);
      }
      const win = winWorld({ taskExists: false, onRun: supervisorRecordsOnRun });
      create.setRunner(() => ({ ok: true, stdout: '' }));
      create.setDryRun(false);
      try {
        const made = create.createAgent({ name: 'max', role: 'qa', platform: WIN, claudeBin: process.execPath, tmuxBin: HOST_BIN });
        assert.equal(made.outcome, create.OUTCOME.CREATED, made.because);
      } finally {
        create.setRunner(null);
      }
      const keys = launchKeysNamed([...mac, ...win]);
      assert.ok(keys.includes('lee') && keys.includes('max'), 'the control: both creates named their identities: ' + JSON.stringify(keys));
      assert.deepEqual(keys.filter((k) => k.includes('+')), [], 'a Kosmos 1 board keyed a spawn to the registry\'s "test"');
    });
  } finally {
    worlds.setActiveWorld(base, worlds.DEFAULT_ID);
  }
});
