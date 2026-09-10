'use strict';
/**
 * #570: "does this agent have a startup job?", asked on the platform where the
 * job is not a file.
 *
 * 🛑 ONE QUESTION, FIVE READERS, AND ALL FIVE ANSWERED IT WITH `fs` (roadmap
 * §3b). `register.js`, `delete-leftover.js`, `status.js`, `discover.js` and
 * `create.installJob` each decided it by stat-ing a `.plist`. On the Mac the
 * plist IS the job, so that is correct. On Windows the job is a Scheduled Task
 * and no plist is ever written -- so none of them refused, they all answered NO,
 * confidently and wrongly, about agents that DO come back at logon (R8, measured
 * on a real reboot 2026-09-08).
 *
 * MEASURED ON THIS BOX BEFORE THE FIX, against three live registrations:
 *
 *     schtasks                 survey said
 *     agent-winreh-2  Running    job=false   <- and it was in `missing`,
 *     agent-winreh-3  Disabled   job=false      i.e. offered to the button
 *     agent-winreh-4  Disabled   job=false      that LAUNCHES agents
 *
 * 🔑 THE THREE-STATE ANSWER IS THE POINT, not the win32 branch. `create.js`'s
 * `disabledJobs()`/`runningJobs()` already fail soft to an empty set on the
 * stated grounds that "we could not look" is not a claim; these readers made the
 * claim anyway. So every arm below has a could-not-look case, and that is the
 * one that fails if somebody re-flattens this to a boolean.
 *
 * ⚠️ RUNS FROM EITHER PLATFORM. Every platform is INJECTED and both command
 * seams are stubbed, so this never shells `schtasks`, `launchctl` or `tmux`, and
 * the fleet's Macs exercise the Windows arm -- which is the only reason any of
 * this is testable at all.
 *
 *   node --test engine/jobexists.win32-570.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-jobexists-570-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'launch');
process.env.AGENT_WORKFORCE_TRASH = path.join(SB, 'Trash');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SB, 'claude.json');
process.env.AGENT_WORKFORCE_CODEX_HOME = path.join(SB, '.codex');
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });

const create = require('./create');
const register = require('./register');
const leftover = require('./delete-leftover');
const status = require('./status');
const store = require('./store');
const job = require('./win32job');
const launcher = require('./win32launch');

/* schtasks' own words, measured on en-US. `presence` reads THIS sentence to tell
   an absent task from a look that failed, so the fixtures use it verbatim
   rather than a paraphrase that would keep passing if the reading changed. */
const NOT_THERE = { ok: false, out: 'ERROR: The system cannot find the file specified.\n', code: 1 };
/* A look that FAILED. Access denied is the realistic shape: a task registered
   under another account, or a locked-down box. Nothing may be concluded from it. */
const CANNOT_LOOK = { ok: false, out: 'ERROR: Access is denied.\n', code: 1 };

/**
 * A stubbed Task Scheduler holding exactly `names`.
 *
 * ⚠️ IT SERVES BOTH READS: the per-agent `/Query /TN` that `presence` makes and
 * the folder `/Query /TN Kosmos\ /FO CSV` that `list` makes for the whole fleet.
 * A stub that only answered one of them would leave the other reader untested
 * while looking green, which is this lane's signature failure.
 */
function scheduler(names, { fail = false } = {}) {
  const calls = [];
  job.setRunner((args) => {
    calls.push(args.join(' '));
    if (fail) return CANNOT_LOOK;
    const tn = String(args[args.indexOf('/TN') + 1] || '');
    if (args[0] === '/Query' && tn === 'Kosmos\\') {
      if (!names.length) return NOT_THERE;   // an empty folder is a real empty fleet
      return { ok: true, out: names.map((n) => `"\\Kosmos\\agent-${n}","N/A","Ready"\n`).join('') };
    }
    if (args[0] === '/Query') {
      return names.includes(tn.replace('Kosmos\\agent-', ''))
        ? { ok: true, out: 'Scheduled Task State: Enabled\n' }
        : NOT_THERE;
    }
    return { ok: true, out: '' };
  });
  return calls;
}

/** An agent's folder and profile, with no job of either kind. */
function folderAgent(name) {
  store.writeProfile(name, { role: 'helper' });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
}
/** The Mac's job: a file. */
function plistFor(name) {
  fs.mkdirSync(path.dirname(create.plistPath(name)), { recursive: true });
  fs.writeFileSync(create.plistPath(name), '<plist/>', 'utf8');
}
function reset() {
  fs.rmSync(store.PROFILES, { recursive: true, force: true });
  fs.rmSync(path.join(SB, 'workers'), { recursive: true, force: true });
  fs.rmSync(path.join(SB, 'launch'), { recursive: true, force: true });
  fs.mkdirSync(path.join(SB, 'workers'), { recursive: true });
  fs.mkdirSync(path.join(SB, 'launch'), { recursive: true });
  status.setPaneSource(() => '');
}

test.after(() => {
  job.setRunner(null);
  job.setAnchorer(null);
  launcher.setSpawn(null);
  create.setRunner(null);
  status.setPaneSource(null);
  try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ }
});

/* ── the shared answer ─────────────────────────────────────────────────── */

test('#570 jobPresence: a registered task is yes, no such task is no, and a failed look is UNKNOWN', () => {
  reset();
  scheduler(['ava']);
  assert.equal(create.jobPresence('ava', 'win32'), 'yes');
  assert.equal(create.jobPresence('nobody', 'win32'), 'no');

  scheduler([], { fail: true });
  /* 🛑 THE ARM THE WHOLE CHANGE TURNS ON. A boolean has nowhere to put this, so
     every reader spelled it "no" -- and "no" here is a claim about an agent's
     future that nobody checked. */
  assert.equal(create.jobPresence('ava', 'win32'), 'unknown',
    'a look that failed was reported as a proven absence');
});

test('#570 jobPresence: darwin still reads the file, from either platform', () => {
  reset();
  scheduler([]);                 // a Task Scheduler that would say "no" to everything
  plistFor('mona');
  assert.equal(create.jobPresence('mona', 'darwin'), 'yes',
    'the win32 arm took over the Mac path');
  assert.equal(create.jobPresence('nobody', 'darwin'), 'no');
  // And the two derived readers keep their #149/#150 contract on top of it.
  assert.equal(create.hasJob('mona', 'darwin'), true);
  assert.equal(create.jobMissing('mona', 'darwin'), false);
  assert.equal(create.jobMissing('nobody', 'darwin'), true);
});

/* ── register.js: the screen this defect was worst on ─────────────────────── */

test('#570 the restart-survival screen SEES a Scheduled Task, and stops offering to repair it', () => {
  reset();
  folderAgent('winreh-2');
  scheduler(['winreh-2']);

  const s = register.survey({ platform: 'win32' });
  const row = s.agents.find((a) => a.name === 'winreh-2');
  assert.equal(s.ok, true, s.because);
  assert.equal(row.job, true,
    'the screen that exists to answer "will it be here after a restart" said no about an agent that will');
  /* 🛑 AND THE ACT, WHICH IS THE HALF THAT COULD HAVE HURT. `missing` feeds the
     "Set them to start at login" button, and on win32 that path LAUNCHES the
     agent -- so a wrong `job: false` meant a second live agent in the same
     folder for every agent on the board. */
  assert.deepEqual(s.missing, [],
    'an agent that already starts at login was queued to be started again');
});

test('#570 a folder with NO task is still the thing the screen is looking for', () => {
  reset();
  folderAgent('jobless');
  scheduler([]);
  const s = register.survey({ platform: 'win32' });
  assert.equal(s.agents.find((a) => a.name === 'jobless').job, false);
  assert.deepEqual(s.missing, ['jobless'], 'the screen stopped finding the agents it exists to find');
});

test('#570 a Task Scheduler that will not answer reports NULL, and repairs nobody', () => {
  reset();
  folderAgent('opaque');
  scheduler([], { fail: true });

  const s = register.survey({ platform: 'win32' });
  const row = s.agents.find((a) => a.name === 'opaque');
  assert.equal(row.job, null, 'a look we could not make was published as a fact');
  /* ⚠️ `!x.job` WOULD PASS null STRAIGHT THROUGH TO THE BUTTON. This is the
     assertion that goes red if `missing` is written with a negation again. */
  assert.deepEqual(s.missing, [],
    'an agent we could not check was offered to a button that starts processes');
  assert.equal(s.straySweepFailed, true,
    'the sweep reported a clean machine it had not managed to look at');
});

test('#570 a registered task with no profile is a STRAY, and repair never touches it', () => {
  reset();
  scheduler(['orphan-task']);
  const s = register.survey({ platform: 'win32' });
  const row = s.agents.find((a) => a.name === 'orphan-task');
  assert.ok(row, 'a registered task nothing accounts for was invisible to the sweep');
  assert.deepEqual({ folder: row.folder, job: row.job, profile: row.profile },
    { folder: false, job: true, profile: false });
  assert.deepEqual(s.missing, []);
});

test('#570 CONTROL: the same survey on darwin still reads plists, not tasks', () => {
  reset();
  folderAgent('macagent');
  plistFor('macagent');
  scheduler([]);            // Task Scheduler says nothing is registered
  const s = register.survey({ platform: 'darwin' });
  assert.equal(s.agents.find((a) => a.name === 'macagent').job, true,
    'the win32 arm answered for the Mac, which would report every Mac agent unregistered');
  assert.deepEqual(s.missing, []);
});

/* ── the never-overwrite guard behind that screen's button ────────────────── */

test('#570 installJob will not launch a SECOND agent over a task that is already registered', () => {
  reset();
  folderAgent('already');
  scheduler(['already']);
  /* If the guard does not fire, this spawn records -- which on a real box is a
     duplicate agent in a folder another agent is working in. */
  const spawned = [];
  launcher.setSpawn((cmd, argv) => { spawned.push({ cmd, argv }); return { pid: 1, unref() {} }; });
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);

  const r = create.installJob('already', { platform: 'win32', claudeBin: process.execPath, tmuxBin: process.execPath });
  assert.equal(r.ok, false);
  assert.equal(r.already, true, 'the never-overwrite guard did not fire on a registered task');
  assert.deepEqual(spawned, [], 'a second agent was launched over one that is already registered');
});

test('#570 and a look it could not make REFUSES rather than launching', () => {
  reset();
  folderAgent('opaque2');
  scheduler([], { fail: true });
  const spawned = [];
  launcher.setSpawn((cmd, argv) => { spawned.push({ cmd, argv }); return { pid: 1, unref() {} }; });
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);

  const r = create.installJob('opaque2', { platform: 'win32', claudeBin: process.execPath, tmuxBin: process.execPath });
  /* 🔑 THE ONE PLACE UNKNOWN MEANS "DO NOTHING" RATHER THAN "SAY NOTHING". The
     act is not idempotent: `win32job.install` overwrites with /F and the launch
     is a new process, so proceeding on a failed look is how two agents end up in
     one folder. A refusal is recoverable in one click. */
  assert.equal(r.ok, false);
  assert.match(String(r.because), /could not check/);
  assert.deepEqual(spawned, [], 'it launched an agent without knowing whether one was already registered');
});

/* ── delete-leftover.js: freeing a name ──────────────────────────────────── */

test('#570 freeing a name SEES a leftover Scheduled Task, and unregisters it', () => {
  reset();
  const tasks = scheduler(['ghosted']);

  const p = leftover.plan('ghosted', { platform: 'win32' });
  assert.equal(p.ok, true, p.because);
  assert.equal(p.job.task, true, 'the leftover job was described as a file');
  assert.equal(p.job.path, null);
  assert.match(p.loses.join(' '), /startup job/);
  /* No files are at risk, so the name-typing gate would be ceremony. */
  assert.equal(p.typeToConfirm, null);

  const done = leftover.del('ghosted', { platform: 'win32' });
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.ok(tasks.some((c) => c.startsWith('/Delete /F /TN Kosmos\\agent-ghosted')),
    'the name was reported free while the Scheduled Task was still registered');
  assert.match(done.said, /Nothing starts ghosted any more/,
    'it claimed to have deleted files an agent with no folder never had');
});

test('#570 a task we could not look for REFUSES, rather than reporting nothing is left', () => {
  reset();
  scheduler([], { fail: true });
  const p = leftover.plan('unknowable', { platform: 'win32' });
  assert.equal(p.ok, false);
  /* 🛑 THE DANGEROUS SENTENCE IS "nothing of X is left on this computer, so the
     name is free". Said over a task still registered, an agent comes back at the
     next logon under a name somebody has since given to a different agent. */
  assert.doesNotMatch(String(p.because), /nothing of unknowable is left/);
  assert.match(String(p.because), /could not check/);
});

test('#570 CONTROL: the Mac still moves its plist to the Trash', () => {
  reset();
  fs.mkdirSync(process.env.AGENT_WORKFORCE_TRASH, { recursive: true });
  plistFor('macleft');
  scheduler([]);
  const p = leftover.plan('macleft', { platform: 'darwin' });
  assert.equal(p.ok, true, p.because);
  assert.equal(p.job.path, create.plistPath('macleft'), 'the Mac lost the file it acts on');
  assert.ok(!p.job.task);
  assert.match(p.loses.join(' '), /auto-start file/);
});

/* ── status.js: what a freshly made Windows agent is told ─────────────────── */

test('#570 a Windows agent Kosmos just made is NOT "made before Kosmos recorded this"', () => {
  reset();
  fs.mkdirSync(create.workerDir('fresh'), { recursive: true });
  scheduler(['fresh']);

  /* 🛑 BOTH GATES, BECAUSE THEY ARE EACH OTHER'S INVERSE. `notYetStarted` needs
     the job to make an empty transcript folder MEAN something; `neverRecorded`
     is the same gate inverted, and it is the one that rendered the false
     provenance sentence for every Windows agent. */
  assert.equal(status.notYetStarted('fresh', 'win32'), true,
    'an agent with a registered task and nothing written yet was not recognised as fresh');
  assert.equal(status.neverRecorded('fresh', 'win32'), false,
    'Kosmos told a person it had not recorded an agent it had just made');
});

test('#570 an agent with no task IS never-recorded, and a failed look is neither', () => {
  reset();
  fs.mkdirSync(create.workerDir('stranger'), { recursive: true });
  scheduler([]);
  assert.equal(status.neverRecorded('stranger', 'win32'), true);
  assert.equal(status.notYetStarted('stranger', 'win32'), false);

  scheduler([], { fail: true });
  /* Both false: an unreadable machine falls back to the ordinary admission,
     which is vague but is not a claim about the agent's history. */
  assert.equal(status.neverRecorded('stranger', 'win32'), false,
    'provenance was asserted about an agent we could not check');
  assert.equal(status.notYetStarted('stranger', 'win32'), false);
});
