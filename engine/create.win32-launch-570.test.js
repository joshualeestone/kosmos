'use strict';
/**
 * #570: create.js starts a Windows agent through the win32 substrate, not launchd.
 *
 * `installJob` is where a Mac agent gets its launchd job: install the supervisor
 * script, write a `.plist`, `launchctl enable`, `launchctl bootstrap`. None of
 * those exist on Windows. These arms pin that the win32 branch takes over the
 * whole of that, and -- more importantly -- that it does NOT reach any of it.
 *
 * 🛑 THE PLATFORM IS INJECTED (`opts.platform`) SO A MAC CAN DRIVE BOTH SIDES.
 * A branch that hard-read `process.platform` would be unexercised on this fleet,
 * which is exactly how the defects in this lane survived: the suite goes green
 * and says nothing at all about the platform it is about.
 *
 *   node --test engine/create.win32-launch-570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'create-win32-570-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));

const create = require('./create');
const launcher = require('./win32launch');
const job = require('./win32job');
const win32create = require('./win32create');
const win32sessions = require('./win32sessions');

/* 🛑 NEVER ACTUALLY SLEEP. Since 7c-2 the win32 create waits for the SUPERVISOR
   to write its ownership record -- the launch happens in another process now, so
   this is how create sees its result. Every arm that drives a failure would
   otherwise serve the real eight-second timeout, one after another. */
win32create.setPark(() => {});

/**
 * 🛑 BOTH JOB SEAMS, STUBBED FOR EVERY win32 ARM, and this is not tidiness. With
 * them live, `installJob` on win32 REGISTERS A REAL SCHEDULED TASK on whatever
 * box runs the suite and copies a 92 MB interpreter into the sandbox. It also
 * hides its own failure: the create succeeds either way (a failed job must not
 * fail a launched agent), so a broken registration reads as a green test with a
 * quietly different sentence -- which is exactly what it did before this stub
 * existed.
 */
let sessionSeq = 0;
/**
 * Stand in for the supervisor the task would have started.
 *
 * 🔑 THE ONLY EVIDENCE A win32 CREATE HAS (7c-2). `create.js` no longer spawns
 * the agent: it registers the job and runs it, and the supervisor -- in another
 * process -- writes the ownership record before it spawns. So a stub that only
 * answered SUCCESS to `/Run` would be describing a machine where the task starts
 * nothing, which is exactly the machine `schtasks` lies about (it reports success
 * for a run that started nothing; measured, see engine/win32board.js). Writing the
 * row here is what makes this fixture a machine where the job WORKED.
 */
function supervisorStarts(taskArg) {
  const name = String(taskArg || '').replace(/^.*\\agent-/, '');
  if (!name) return;
  win32sessions.record('sess-' + (++sessionSeq) + '-0000', { name, runner: 'claude' });
}

function stubJob(opts) {
  const o = opts || {};
  const calls = [];
  job.setAnchorer(() => ({ ok: true, node: 'C:\\Anchor\\node.exe', boot: 'C:\\Anchor\\supervisor-boot.js' }));
  job.setRunner((args) => {
    calls.push(args);
    /* `/Run` is where a real supervisor comes up, so it is where the fixture's
       one does too -- unless the arm is about a run that started nothing. */
    if (args && args[0] === '/Run' && o.startsNothing !== true) supervisorStarts(args[2]);
    /* ⚠️ A QUERY MUST ANSWER "NO SUCH TASK", NOT BLANKET SUCCESS. `installJob`
       gained a never-overwrite guard: it asks `presence()` first and refuses an
       agent that already has a job. A stub that answers ok to EVERY schtasks call
       makes that query read as "the task is already there", so every arm below
       refused with "it already has one" -- a fixture that had been describing a
       machine where every task exists, which nothing noticed while nothing asked.
       These arms are about a FRESH registration, so the query says not-found in
       the shape win32job's NO_SUCH_TASK matches. */
    if (args && args[0] === '/Query') return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
    return { ok: true, out: '' };
  });
  return calls;
}

test.after(() => {
  /* ⚠️ ORDER, AND create.js WILL TELL YOU IF YOU GET IT WRONG. It refuses to
     leave dry-run with no injected runner ("this would create real agents"), so
     nulling the runner and THEN clearing dry-run throws out of the teardown --
     which surfaces as a file-level failure with every arm green, a confusing
     shape. `setRunner(null)` re-arms dry-run by itself, so that is all that is
     needed and the explicit setDryRun is simply wrong here. */
  launcher.setSpawn(null);
  job.setRunner(null);
  job.setAnchorer(null);
  create.setRunner(null);
  win32create.setPark(null);
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

const REAL_BIN = process.execPath;   // exists and is runnable on every platform

function agentFolder(name) {
  const d = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function recordingSpawn() {
  const calls = [];
  launcher.setSpawn((cmd, argv, opts) => { calls.push({ cmd, argv, opts }); return { pid: 777, unref() {} }; });
  return calls;
}

test('#570 createAgent does not require tmux on win32 -- the third instance of #2304', () => {
  /* 🛑 MEASURED LIVE, 2026-09-08, and this test exists because the unit suite was
     fully green while the real thing was refused. The first end-to-end create on
     this platform came back "we could not find tmux on this computer, so an agent
     made now would never start" -- about a program Windows neither has nor needs.
     The preflight loop in createAgentInner required tmux on EVERY platform.

     ⚠️ Same shape as #2304 (installedCheck required tmux everywhere, so a healthy
     Windows box reported it could not run agents) and as #1185's preflight inside
     installJob. Three instances now, which is why this is pinned rather than
     just fixed.

     📌 SCOPE OF THE ASSERTION, stated so it is not read as more than it is: this
     pins the GATE, not a successful creation. createAgent's launch block is still
     launchd-only, so a win32 create gets past this gate and then fails at
     "started it" -- that port is the next slice. What must never come back is a
     refusal naming tmux. */
  /* 🛑 THE FIXTURE WAS NAMED `winreh-tmuxgate`, AND THE ASSERTION FORBIDS "tmux".
     Every sentence this create returns names the agent, so the guard matched its
     own fixture's name and went red on the fleet's Macs -- where the create gets
     far enough to say "<name> is set up and starting". On Windows it happened to
     take a path whose sentence did not carry the name, so it passed. A test whose
     subject appears inside the pattern it forbids is not testing the pattern.
     Renamed; the assertion is unchanged and now means what it says.

     ⚠️ AND BOTH SEAMS ARE STUBBED, for the reason the file header already gives.
     Unstubbed, this drove a REAL `cmd /c start` and a real schtasks: on a Mac
     that is `spawn cmd.exe ENOENT`, thrown asynchronously AFTER the test ended,
     which node reports as an uncaught exception rather than a failure anyone can
     read. The gate under test is reached long before either seam. */
  recordingSpawn();
  stubJob();
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  const r = create.createAgent({
    name: 'winreh-gate', role: 'qa', instructions: 'A probe agent used to pin the tmux preflight gate for #570.',
    platform: 'win32', claudeBin: REAL_BIN, tmuxBin: '/nonexistent/tmux',
  });
  assert.doesNotMatch(String(r.because || ''), /tmux/,
    'a win32 create must never be refused for a program this platform does not use: ' + r.because);
});

test('#570 and darwin STILL requires tmux -- the two-sided control, source-pinned', () => {
  /* The other half: a win32 branch that quietly stopped gating tmux on the Mac
     would be a worse regression than the bug it fixed, and the arm above would
     still pass. #1616's rule has to keep standing on darwin -- runnerRunnable,
     not existsSync, for the runner AND for tmux.

     🛑 WHY THIS IS A SOURCE PIN AND NOT A CALL. Driving the darwin arm needs a
     Mac: from Windows the create refuses earlier, at "we could not check which
     agents are already running", because that check is itself launchd/tmux
     shaped. That is the exact mirror of why this whole lane's defects survive --
     a Mac cannot exercise win32, and this box cannot exercise darwin -- so a
     behavioural control here would simply not run on the platform the change is
     for, which is the same as not having one.

     🔑 SO PIN THE STRUCTURE, the technique supportdir-win32-2039 calls the
     load-bearing half of its own guard: the non-win32 required-list must still
     carry a tmux entry, and the win32 one must not. Deleting the branch, or
     flattening both arms back to one list, goes red here on any platform. */
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  const loop = src.slice(src.indexOf('const required = jobPlatform'), src.indexOf('for (const [what, bin] of required)'));
  assert.ok(loop.length > 0, 'the required-list construction must still exist in createAgentInner');

  const [winArm, macArm] = loop.split(': [');
  assert.ok(!/tmux/.test(winArm), 'the win32 arm must NOT probe tmux: ' + winArm);
  assert.ok(/tmux/.test(macArm), 'the darwin arm MUST still probe tmux: ' + macArm);
});

test('#570 asked about win32, installJob launches through the substrate and NEVER touches launchd', () => {
  const calls = recordingSpawn();
  const tasks = stubJob();
  const ranMacCommands = [];
  create.setRunner((bin, args) => { ranMacCommands.push(bin + ' ' + (args || []).join(' ')); return { ok: true }; });
  create.setDryRun(false);
  agentFolder('winjob');

  const r = create.installJob('winjob', {
    platform: 'win32', claudeBin: REAL_BIN, tmuxBin: REAL_BIN, model: 'haiku',
  });

  assert.equal(r.ok, true, r.because || '');
  assert.equal(r.started, true);
  /* 🛑 THE ONE LAUNCH PATH (7c-2). create.js used to spawn the agent ITSELF and
     then register a job that would start a different one at logon -- two paths,
     and the one a person got by pressing the button was the detached shape nobody
     holds the stdin of, which is why a Windows agent could not be messaged. The
     job is the launcher now, so create spawns NOTHING directly. */
  assert.equal(calls.length, 0, 'create does not spawn the agent itself any more');
  assert.ok(tasks.some((a) => a[0] === '/Run'), 'it started the agent by RUNNING its job');

  /* 🛑 THE LOAD-BEARING NEGATIVE. The Mac path shells `launchctl enable` and
     `launchctl bootstrap`; on Windows there is no launchd and those calls would
     fail AFTER the caller had been told the job was installed. Asserting that
     something EXPECTED is present would not catch that -- this asserts the
     unexpected is ABSENT, which is the asymmetry this lane keeps paying for. */
  assert.deepEqual(ranMacCommands.filter((c) => /launchctl/.test(c)), [],
    'no launchctl on Windows');

  /* 🔑 AND THE KEEP-ALIVE HALF RAN. On the Mac one plist write buys both "start
     it now" and "start it at every login"; here they are two acts, and the
     second is the one nobody notices missing until a reboot. */
  /* ⚠️ FILTERED, NOT COUNTED. installJob now ASKS before it registers -- a
     never-overwrite guard queries presence first -- so the vector is /Query then
     /Create. Counting calls made this arm about how many times schtasks was run,
     which was never the claim; the claim is that the at-logon job was registered
     exactly once. Asserting the query too, because that guard is what stops a
     second live agent being put in an agent's folder. */
  const created = tasks.filter((a) => a[0] === '/Create');
  assert.equal(created.length, 1, 'the at-logon job was registered exactly once');
  assert.equal(tasks[0][0], '/Query', 'and it asked whether one already existed first');
  /* Registered from an XML definition, never `/SC ONLOGON` -- that spelling needs
     administrator (measured unelevated 2026-09-08) because it triggers on ANY
     user's logon. win32job.test.js pins the definition's content. */
  assert.ok(created[0].includes('/XML'), 'and it is the RunAtLoad analog, defined in XML');
  assert.ok(!created[0].includes('ONLOGON'), '/SC ONLOGON requires elevation and must not come back');
  assert.equal(fs.existsSync(path.join(SANDBOX, 'Library')), false,
    'and no LaunchAgents/plist tree was created');

  /* ⚠️ REGISTER, THEN RUN, and the order is not interchangeable: `/Run` names a
     task, so running before registering runs nothing and reports success doing it. */
  const verbs = tasks.map((a) => a[0]);
  assert.ok(verbs.indexOf('/Create') < verbs.indexOf('/Run'),
    'the job has to exist before it can be run');

  /* 🔑 AND THE RESOLVED RUNNER RIDES INTO THE TASK. Everything the agent needs has
     to survive on the task's command line now; the resolved path did not, and a
     task-started agent fell back to a bare `claude` on whatever PATH the logon had. */
  assert.ok(created[0].join(' ').includes('/XML'), 'registered from XML');
  const xml = job.taskXml({ name: 'winjob', cwd: 'C:\\w', claudeBin: REAL_BIN }, { USERNAME: 'u' });
  assert.ok(xml.includes(REAL_BIN.replace(/&/g, '&amp;')),
    'the runner Kosmos resolved is carried, not assumed off PATH');
});

test('#570 the same call on darwin still takes the launchd path', () => {
  /* The control. Without it the arm above passes for a branch that simply never
     runs anything, and this file would be asserting its own emptiness. */
  const calls = recordingSpawn();
  const ran = [];
  create.setRunner((bin, args) => { ran.push(bin + ' ' + (args || []).join(' ')); return { ok: true }; });
  create.setDryRun(false);
  agentFolder('macjob');

  const r = create.installJob('macjob', {
    platform: 'darwin', claudeBin: REAL_BIN, tmuxBin: REAL_BIN,
  });

  /* This half runs everywhere and is the one that matters: whatever darwin does,
     it must not be routed through the Windows substrate. */
  assert.equal(calls.length, 0, 'darwin does NOT go through the win32 launcher');

  /* ⚠️ THE launchctl HALF ONLY RUNS ON A MAC, and saying so is the point rather
     than an excuse. On Windows `process.getuid` is UNDEFINED, so the enable/
     bootstrap calls throw, the surrounding try/catch swallows it (by design --
     "the job stays either way"), and installJob still returns ok:true having run
     no launchctl at all. Asserting the positive here would therefore fail on
     Windows for a reason that has nothing to do with this branch. Gated on the
     HOST, not on the injected platform, because it is a fact about the machine
     running the test. */
  if (process.platform === 'darwin') {
    assert.ok(ran.some((c) => /launchctl/.test(c)) || r.ok === false,
      'on a Mac the darwin path is still the launchd one');
  }
});

test('#570 DRY_RUN spawns nothing on win32', () => {
  const calls = recordingSpawn();
  create.setDryRun(true);
  agentFolder('dry');
  const r = create.installJob('dry', { platform: 'win32', claudeBin: REAL_BIN, tmuxBin: REAL_BIN });
  create.setDryRun(false);
  assert.equal(r.ok, true, r.because || '');
  assert.equal(calls.length, 0, 'a dry run must not start a real agent');
});

test('#570 7c-2 a job that RAN and started nothing is a failed create, not a quiet success', () => {
  /* 🛑 THE MEASURED LIE THIS ARM EXISTS FOR. `schtasks /Run` reports SUCCESS
     whether or not the task's action actually started -- measured on this box
     against an already-running task (engine/win32board.js). So its exit code is
     not evidence, and a create that believed it would hand somebody an agent that
     does not exist. The evidence is the ownership record the supervisor writes
     before it spawns; this fixture is a machine where the run started nothing. */
  const tasks = stubJob({ startsNothing: true });
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  agentFolder('ranothing');
  const r = create.installJob('ranothing', { platform: 'win32', claudeBin: REAL_BIN, tmuxBin: REAL_BIN });

  assert.equal(r.ok, false, 'schtasks said SUCCESS and no agent started -- that is not a created agent');
  assert.match(String(r.because), /no agent had started/);
  /* ⚠️ AND IT TAKES ITS OWN REGISTRATION BACK. installJob has no rollback behind
     it, so a task left here would start an agent at the next logon that the person
     was just told does not exist -- the undisclosed-install defect, through the
     adoption path. */
  assert.ok(tasks.some((a) => a[0] === '/Delete'), 'the job it registered was removed again');
  assert.ok(tasks.some((a) => a[0] === '/End'), 'and anything it started was ended first');
});

test('#570 7c-2 the sentence promises login persistence, because it is now the SAME act', () => {
  /* 🔑 THE PROMISE AND THE FACT ARE NO LONGER SEPARABLE. This used to assert the
     asymmetry -- an agent could be running while its job was not, so the sentence
     tracked the second half per agent. Registering the job is HOW the agent starts
     now, so there is no state where one is true and the other is not, and the
     sentence can be flat. */
  const calls = recordingSpawn();
  stubJob();
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  agentFolder('sentence');
  const r = create.installJob('sentence', { platform: 'win32', claudeBin: REAL_BIN, tmuxBin: REAL_BIN });
  assert.equal(r.ok, true, r.because || '');
  assert.equal(calls.length, 0, 'nothing was spawned directly');
  assert.equal(r.atLogin, true);
  assert.match(String(r.because), /login/, 'the durability we now deliver is stated');
});

test('#570 7c-2 A FAILED JOB IS NOW A FAILED START -- and it says so instead of half-succeeding', () => {
  /* 🛑 THE TRADE, PINNED SO IT CANNOT BE UNDONE BY ACCIDENT. Before 7c-2 a box
     where the job could not be registered still got a running agent, and the
     sentence said it would not survive a restart. That agent was the DETACHED
     shape -- nobody holds its stdin, so nobody can ever type to it. Falling back
     to it would ship exactly the failure this slice removes: a healthy-looking row
     that silently answers nobody. So the refusal is deliberate, and what must
     never happen is a create that claims an agent it did not start. */
  const calls = recordingSpawn();
  job.setAnchorer(() => ({ ok: false, because: 'the anchor could not be written' }));
  /* The /Query must answer not-found, or installJob's never-overwrite guard
     refuses this fresh agent as one that already has a job -- see stubJob. */
  const tasks = [];
  job.setRunner((args) => {
    tasks.push(args);
    return args && args[0] === '/Query'
      ? { ok: false, out: 'ERROR: The system cannot find the file specified.' }
      : { ok: true, out: '' };
  });
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
  agentFolder('nojob');
  const r = create.installJob('nojob', { platform: 'win32', claudeBin: REAL_BIN, tmuxBin: REAL_BIN });

  assert.equal(r.ok, false, 'no job means no agent, and the answer says so');
  assert.match(String(r.because), /anchor could not be written/, 'with the reason a person can act on');
  assert.equal(calls.length, 0, 'and nothing was started behind the refusal');
  assert.deepEqual(tasks.filter((a) => a[0] === '/Create'), [],
    'a registration that could not be anchored is never attempted');
});

test('#570 7d the launch does NOT hand back a pid that is not the agent', () => {
  /* 🛑 MEASURED ON THE BOX. `cmd /c start` is the only way to give the agent its
     own console, so the process we spawn is CMD -- and cmd exits the instant
     `start` has handed off. A live agent's parent pid was already dead when
     checked. The field was called `pid`, and create.js's rollback duly called
     process.kill() on it: it killed nothing, or -- once Windows reused the number
     -- something else. Renamed so no future caller can read it as the agent's.
     The agent's REAL pid comes from `claude agents --json`, joined on the session
     id (engine/win32live). */
  const folder = agentFolder('pidname-1');
  recordingSpawn();
  const out = launcher.launch({ name: 'pidname-1', cwd: folder, claudeBin: REAL_BIN, platform: 'win32' });

  assert.equal(out.ok, true, out.because);
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'pid'), false,
    'a field called `pid` here is a trap: it is the launcher\'s, not the agent\'s');
  assert.equal(out.launcherPid, 777, 'kept under an honest name -- it IS what we spawned');
  assert.ok(out.sessionId, 'and the id, which is the handle that actually addresses the agent');
});

test('#570 7d the rollback ends the session BY ID, and never process.kill()s a launcher pid', () => {
  /* The defect: a create that failed after the launch deleted the worker folder
     and the task while the agent it had just started kept running -- because the
     only thing it tried to kill was a pid that had already exited.

     Asserted at the source rather than by driving a failure, because the two
     facts that matter are both textual: the rollback must reach win32stop with a
     SESSION ID, and it must not carry a process.kill of a launch pid. */
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  /* Anchored on the task removal, which is unique to the rollback arm.
     `if (jobPlatform === 'win32')` is NOT unique -- it appears nine times in this
     file, and anchoring there sliced a different branch entirely. */
  const arm = src.slice(src.indexOf("require('./win32job').remove(name)"));
  const rollback = arm.slice(0, arm.indexOf('return;'));

  assert.match(rollback, /win32stop'\)\.endSession\(win32Launched\.sessionId\)/,
    'the rollback must end the session it started, addressed by its id');

  /* ⚠️ COMMENTS STRIPPED BEFORE THE NEGATIVE. The comment above this code in
     create.js explains the defect by NAMING `process.kill`, so a raw text search
     matches the explanation and goes red on the fix. A guard that cannot tell
     code from the comment describing it is worse than no guard: it would have
     been "fixed" by deleting the sentence that says why. */
  const code = rollback.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /process\.kill\(/,
    'a process.kill here is the defect: the pid it had was the launcher\'s, already dead');
  assert.ok(rollback.indexOf('remove(name)') < rollback.indexOf('endSession'),
    'and the TASK still goes first -- a logon inside that window would start it back up');
});
