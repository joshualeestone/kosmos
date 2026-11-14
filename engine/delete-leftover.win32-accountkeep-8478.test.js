'use strict';
/**
 * kosmos#8478: on Windows the account folder a Claude or Codex agent runs on, and the model it was set to, lived only in
 * its Scheduled Task. So kosmos#8475's task-only leftover delete (which removes the task and keeps everything else, so
 * that it is recoverable) lost them, and Start at login (register.repair, then create.installJob) brought the agent
 * back on the main account and the model it last ran. Every task write now records both in the agent's profile
 * (`win32Task`), and the repair puts back whichever of them still can be.
 *
 * Driven end to end on the Windows box: the task is written by the real rewrite (create.setModel), removed by the real
 * task-only delete (delete-leftover.del), and registered again by the real repair, all against jobfixture's stand-in
 * Task Scheduler (win32job's runner seam, a task file per task in the sandbox), so nothing here creates, changes or
 * deletes a real Scheduled Task. Windows only: the stand-in is installed only on a Windows host (jobfixture), and the
 * record is written only by the win32 arms. Sandboxed like delete-leftover.win32-recoverable-task-8475.test.js, because
 * delete-leftover MOVES OR DELETES FOLDERS.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-8478-')));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'LaunchAgents', 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_CLAUDE_BIN = process.execPath;   // a runnable file: the repair checks the runner exists
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const WORKERS = process.env.AGENT_WORKFORCE_WORKERS;
fs.mkdirSync(nodePath.join(WORKERS, 'neighbour8478'), { recursive: true });   // a computer with agents

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const store = require('./store');
const win32job = require('./win32job');
const win32create = require('./win32create');
const register = require('./register');
const liveness = require('./liveness');
const leftover = require('./delete-leftover');
const jobfix = require('../test-support/jobfixture');

const WINDOWS_ONLY = { skip: process.platform !== 'win32' ? 'the stand-in Task Scheduler (jobfixture) is installed only on a Windows host' : false };

remove.setRunner(() => ({ ok: true, stdout: '' }));
leftover.setRunner((file, args) => {
  const script = args[args.length - 1];
  if (script === leftover.DRIVE_SCRIPT) {
    return { ok: true, stdout: JSON.stringify({ type: 'Fixed', total: 500 * 1024 ** 3, policy: false, nuke: 0, maxMB: 20000 }) + '\r\n' };
  }
  return { ok: true, stdout: '' };
});

/* The account folder the agent was moved to (not the main account), and the two models: the one it was set to, and
   the one it last ran (what server.js's modelFor would read), which is what a repair used before this change. */
const ACCOUNT = nodePath.join(SANDBOX, '.claude-second8478');
const SET_MODEL = 'claude-opus-5-5';      // setModel('opus55')
const LAST_RAN = 'claude-haiku-4-5-20251001';
const modelFor = () => LAST_RAN;
/* round 3: ACCOUNT holds a real Claude sign-in (a record keeps whose account a folder held), and this is how the
   record names it (create's win32IdentityToRecord: email lower-cased, the organization uuid). */
const OWNER = { emailAddress: 'Owner@example.test', organizationUuid: 'org-8478' };
const OWNER_IDENTITY = { kind: 'signin', email: 'owner@example.test', keyTail: null, org: 'org-8478' };
const signIn = (dir, oauthAccount) => {   // an account as Claude Code leaves it: its folder, its sign-in in its config
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(require('./accounts').configFile(dir), JSON.stringify(oauthAccount ? { oauthAccount } : { theme: 'dark' }));
  // Sharing this computer's agent history, as Kosmos sets an account up, so an agent may be moved onto it (setAccount).
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude', 'projects'), { recursive: true });
  if (oauthAccount) require('./accounts').share(dir);
};
/* round 6: an identity is read only when an account is CHOSEN, so a recorded agent is set up the way a person does it:
   its account chosen (setAccount), then its model (setModel, which reads none). */
function chooseThenModel(name, dir, modelKey) {
  const moved = create.setAccount(name, dir, { platform: 'win32' });
  assert.equal(moved.outcome, create.OUTCOME.CREATED, 'fixture: the account move was refused: ' + JSON.stringify(moved));
  return create.setModel(name, modelKey, { platform: 'win32' });
}

const win = {
  plan: (name) => leftover.plan(name, { platform: 'win32' }),
  del: (name) => leftover.del(name, { platform: 'win32' }),
};
const made = [];
/* An agent that has run here (a liveness record, so the survey offers Start at login when it lacks a job), with its
   folder in the workers folder and a startup task on ACCOUNT running `model`, as a task written before this change
   left it (nothing recorded in the profile). */
function agent(name, { model = 'claude-sonnet-5', account = ACCOUNT } = {}) {
  made.push(name);
  store.writeProfile(name, { displayName: name, provider: 'anthropic' });
  fs.mkdirSync(nodePath.dirname(liveness.fileFor(name)), { recursive: true });
  fs.writeFileSync(liveness.fileFor(name), JSON.stringify({ at: new Date().toISOString(), state: 'idle' }));
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), 'work\n');
  fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, process.execPath, null, model, account, 'claude'));
  return name;
}
const taskThere = (name) => fs.existsSync(jobfix.jobPath(name));
/* The task a repair wrote, read back the way the board reads it (win32job's own parse of the task's argument line). */
function writtenTask(name) {
  jobfix.jobPath(name);   // forgets what win32job remembered of the task
  const read = win32job.taskSpec(name);
  assert.equal(read.known && read.registered, true, 'no task was registered: ' + JSON.stringify(read));
  return { configDir: read.spec.configDir || null, model: read.spec.model || null };
}
/* Remove the task alone the way the person does: the folder is away, so the name is a task-only leftover. */
function taskOnlyDelete(name) {
  const away = nodePath.join(SANDBOX, name + '-away');
  fs.renameSync(create.workerDir(name), away);
  let p;
  try {
    p = win.plan(name);
    assert.equal(p.ok, true, p.because);
    assert.equal(p.taskOnly, true, 'fixture: not the task-only delete');
    const done = win.del(name);
    assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
    assert.equal(taskThere(name), false, 'fixture: the task is still registered');
    p = { ...p, said: done.said };   // the outcome's words, beside the plan's
  } finally { fs.renameSync(away, create.workerDir(name)); }
  return p;
}
function startAtLogin(name) {
  const s = register.survey({ platform: 'win32' });
  assert.ok(s.missing.includes(name), 'fixture: Start at login is not offered: ' + JSON.stringify(s));
  const out = register.repair({ platform: 'win32', only: name, modelFor });
  assert.equal(out.ok, true, JSON.stringify(out));
  const r = out.results[0];
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}

test.before(() => {
  win32create.setPark(() => {});   // the stand-in writes the ownership row at /Run, so nothing needs waiting for
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
});
test.after(() => {
  create.setRunner(null);
  win32create.setPark(null);
  win32job.setRunner(null);
  win32job.setAnchorer(null);
});
test.beforeEach(() => {
  status.setPaneSource(() => '');
  signIn(ACCOUNT, OWNER);
});
test.afterEach(() => {
  status.setPaneSource(null);
  for (const n of made.splice(0)) {
    try { fs.rmSync(jobfix.jobPath(n), { force: true }); } catch { /* none */ }
    fs.rmSync(store.profilePath(n), { force: true });
    fs.rmSync(liveness.fileFor(n), { force: true });
    fs.rmSync(nodePath.join(WORKERS, n), { recursive: true, force: true });
  }
  fs.rmSync(ACCOUNT, { recursive: true, force: true });
});

test('kosmos#8478: an agent on another account and a chosen model comes back on both after its task alone was removed', WINDOWS_ONLY, () => {
  const name = agent('keep8478');
  // The person changes its model: the real rewrite writes the task, and now records what it wrote.
  const set = chooseThenModel(name, ACCOUNT, 'opus55');
  assert.equal(set.outcome, create.OUTCOME.CREATED, JSON.stringify(set));
  assert.deepEqual(store.readProfile(name).win32Task, { runner: 'claude', configDir: ACCOUNT, model: SET_MODEL, account: OWNER_IDENTITY },
    'the task write did not record the account folder and model it wrote');

  const p = taskOnlyDelete(name);
  assert.match(p.reassurance, /then use Start at login when Kosmos offers it; it starts on the account and model it was set to before\./);
  assert.doesNotMatch(p.reassurance, /main account|last ran/, 'it promised the main account and the last model for an agent whose own are recorded');

  const r = startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: SET_MODEL }, 'Start at login did not put back its account folder and model');
  assert.equal(r.guessed && r.guessed.model, null, 'the report would say it had no record of its model');
});

test('kosmos#8478: an agent with NO record (its task written before this change) keeps its chosen model, and comes back on the main account because nobody recorded whose account its folder held', WINDOWS_ONLY, () => {
  // The task carries the second account and the chosen model; the profile records nothing (as for every agent today).
  const name = agent('legacy8478', { model: SET_MODEL });
  assert.equal(store.readProfile(name).win32Task, undefined, 'fixture: something is recorded');
  const p = taskOnlyDelete(name);
  /* The delete recorded the task's folder and model before removing it, and NO identity (round 5: an identity is read
     only when a task is written; whoever is in that folder at the delete may be someone else). */
  assert.deepEqual(store.readProfile(name).win32Task, { runner: 'claude', configDir: ACCOUNT, model: SET_MODEL, account: null },
    'the task-only delete did not record the task, or read an identity at the delete');
  const words = /then use Start at login when Kosmos offers it; it starts on the model it was set to, but on your main account, because Kosmos did not record whose account was in the folder it used\. Choose its account again if it should use another\./;
  assert.match(p.reassurance, words);
  assert.match(p.said, words);
  const r = startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL }, 'Start at login did not keep its model, or trusted a folder it cannot verify');
  assert.equal(r.guessed && r.guessed.model, null);
});

test('kosmos#8478 round 5: a disconnected account whose folder name bob reuses never gets the agent: recorded, and unrecorded', WINDOWS_ONLY, () => {
  const accounts = require('./accounts');
  const alice = accounts.nextWorkDir();
  signIn(alice.dir, { emailAddress: 'alice@example.test', organizationUuid: 'org-alice' });
  const rec = agent('discon8478', { account: alice.dir });   // recorded below
  const legacy = agent('discold8478', { account: alice.dir, model: SET_MODEL });   // never recorded
  let aside = null;
  try {
    assert.equal(chooseThenModel(rec, alice.dir, 'opus55').outcome, create.OUTCOME.CREATED);
    // Alice's account is disconnected; both tasks still name the folder.
    const out = accounts.forgetAccount(alice.dir, []);
    assert.equal(out.ok, true, JSON.stringify(out));
    aside = out.movedTo || null;
    assert.equal(store.readProfile(rec).win32Task.accountRemoved, true, 'fixture: the disconnect did not clear the record');
    // Bob signs in, and Kosmos gives him the same folder name.
    const next = accounts.nextWorkDir();
    assert.equal(nodePath.resolve(next.dir), nodePath.resolve(alice.dir), 'fixture: the folder name was not reused, so this guards nothing');
    signIn(next.dir, { emailAddress: 'bob@example.test', organizationUuid: 'org-bob' });
    for (const [name, why] of [[rec, /because the account it used was disconnected or removed, so choose its account again if it should use another\./],
      [legacy, /because Kosmos did not record whose account was in the folder it used\. Choose its account again if it should use another\./]]) {
      const p = taskOnlyDelete(name);
      startAtLogin(name);
      // The outcome first, so a control against the old code shows the wrong account, not only other words.
      assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL }, `${name} was put on bob's account`);
      assert.match(p.reassurance, why, `${name}: the plan's words`);
      assert.match(p.said, why, `${name}: the outcome's words`);
    }
  } finally {
    fs.rmSync(alice.dir, { recursive: true, force: true });
    if (aside) fs.rmSync(aside, { recursive: true, force: true });
  }
});

test('kosmos#8478 round 6: a model change after the disconnect and bob\'s sign-in reads no identity, so the agent still comes back on the main account', WINDOWS_ONLY, () => {
  const accounts = require('./accounts');
  const alice = accounts.nextWorkDir();
  signIn(alice.dir, { emailAddress: 'alice@example.test', organizationUuid: 'org-alice' });
  const rec = agent('rewrite8478', { account: alice.dir });   // recorded below
  const legacy = agent('rewriteold8478', { account: alice.dir });   // never recorded
  let aside = null;
  try {
    assert.equal(chooseThenModel(rec, alice.dir, 'haiku55').outcome, create.OUTCOME.CREATED);
    const out = accounts.forgetAccount(alice.dir, []);   // alice disconnected; both tasks still name the folder
    assert.equal(out.ok, true, JSON.stringify(out));
    aside = out.movedTo || null;
    const next = accounts.nextWorkDir();
    assert.equal(nodePath.resolve(next.dir), nodePath.resolve(alice.dir), 'fixture: the folder name was not reused, so this guards nothing');
    signIn(next.dir, { emailAddress: 'bob@example.test', organizationUuid: 'org-bob' });
    for (const [name, why] of [[rec, /because the account it used was disconnected or removed, so choose its account again if it should use another\./],
      [legacy, /because Kosmos did not record whose account was in the folder it used\. Choose its account again if it should use another\./]]) {
      // The person changes its model now: the rewrite keeps the folder the task names, which bob is signed in to.
      assert.equal(create.setModel(name, 'opus55', { platform: 'win32' }).outcome, create.OUTCOME.CREATED, `${name}: fixture`);
      const p = taskOnlyDelete(name);
      startAtLogin(name);
      // The outcome first, so a control against the old code shows the wrong account, not only other words.
      assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL }, `${name} was put on bob's account`);
      assert.match(p.reassurance, why, `${name}: the plan's words`);
      assert.doesNotMatch(p.reassurance, /account and model it was set to before/, `${name}: promised bob's account`);
    }
  } finally {
    fs.rmSync(alice.dir, { recursive: true, force: true });
    if (aside) fs.rmSync(aside, { recursive: true, force: true });
  }
});

test('kosmos#8478 round 7: installJob given a folder it was not told is verified (an import read it earlier) records no identity, so bob\'s reused folder is never trusted', WINDOWS_ONLY, () => {
  const accounts = require('./accounts');
  const alice = accounts.nextWorkDir();
  signIn(alice.dir, { emailAddress: 'alice@example.test', organizationUuid: 'org-alice' });
  const name = agent('import8478', { account: alice.dir });
  fs.rmSync(jobfix.jobPath(name), { force: true });   // no task yet: an imported agent waiting for this Kosmos to open
  let aside = null;
  try {
    // Between the import reading alice's folder and this Kosmos starting it: alice disconnected, bob reuses the name.
    const out = accounts.forgetAccount(alice.dir, []);
    assert.equal(out.ok, true, JSON.stringify(out));
    aside = out.movedTo || null;
    const next = accounts.nextWorkDir();
    assert.equal(nodePath.resolve(next.dir), nodePath.resolve(alice.dir), 'fixture: the folder name was not reused, so this guards nothing');
    signIn(next.dir, { emailAddress: 'bob@example.test', organizationUuid: 'org-bob' });
    // The import's start (worldstarts) hands installJob the folder it read, without saying it is verified.
    const started = create.installJob(name, { platform: 'win32', configDir: alice.dir, model: SET_MODEL });
    assert.equal(started.ok, true, JSON.stringify(started));
    const rec = store.readProfile(name).win32Task;
    assert.equal(rec.configDir, alice.dir, 'fixture: the task folder was not recorded');
    assert.equal(rec.account, null, 'installJob recorded bob as the account of a folder nobody verified: ' + JSON.stringify(rec.account));
    // So when its task goes, Start at login does not trust it.
    taskOnlyDelete(name);
    startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL }, 'the agent was put on bob\'s account');
  } finally {
    fs.rmSync(alice.dir, { recursive: true, force: true });
    if (aside) fs.rmSync(aside, { recursive: true, force: true });
  }
});

test('kosmos#8478: an agent with nothing recorded whose task cannot be read at the delete comes back on the main account and the model it last ran, as before, and is recorded from then on', WINDOWS_ONLY, (t) => {
  const name = agent('old8478');
  assert.equal(store.readProfile(name).win32Task, undefined, 'fixture: something is recorded');
  // The delete's fresh read of the task fails (Task Scheduler would not answer it): the delete goes ahead unrecorded.
  const spec = t.mock.method(win32job, 'taskSpec', () => ({ known: false, because: 'Task Scheduler did not answer' }));
  const p = taskOnlyDelete(name);
  assert.ok(spec.mock.callCount() >= 1, 'CONTROL: the delete never asked for the task, so the failed read guards nothing');
  spec.mock.restore();
  assert.equal(store.readProfile(name).win32Task, undefined, 'a record was written from a read that failed');
  // The outcome is read after the task is gone, so it says only what was recorded: nothing.
  assert.match(p.said, /it starts on your main account and the model it last ran, so choose its account and model again if it used others\. /);
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: null, model: LAST_RAN }, 'with nothing recorded the repair did not fall back as before');
  // The task Start at login wrote is recorded, so the next time the agent comes back as it is now.
  assert.deepEqual(store.readProfile(name).win32Task, { runner: 'claude', configDir: null, model: LAST_RAN, account: null },
    'Start at login wrote a task and did not record it');
});

const CANNOT_REACH = /it starts on the model it was set to, but Kosmos cannot reach the account folder it used right now, so it starts on your main account unless that folder can be reached by then and still holds the same account\. If that folder is on a disk or shared folder that is not connected, connect it first; otherwise choose its account again afterwards if it should use another\. Kosmos keeps that folder and tries it again at each Start at login until its startup job is written again \(changing its account or model does that\), which forgets that folder\./;

test('kosmos#8478: a recorded account folder that cannot be reached falls back to the main account, says so, and comes back on it at the next Start at login, if no change to the agent rewrites its task first', WINDOWS_ONLY, () => {
  const name = agent('gone8478');
  assert.equal(chooseThenModel(name, ACCOUNT, 'opus55').outcome, create.OUTCOME.CREATED);
  // round 1: out of reach, as a disk that is not connected is (a folder moved away reads the same to Kosmos).
  const unplugged = ACCOUNT + '-unplugged';
  fs.renameSync(ACCOUNT, unplugged);
  const p = taskOnlyDelete(name);
  assert.match(p.reassurance, CANNOT_REACH);
  assert.doesNotMatch(p.reassurance, /no longer on this computer/, 'an unplugged disk was called gone');
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL }, 'a task was written pointing at an account folder that cannot be reached, or the model was lost');
  // round 1: the record keeps the folder (the task runs on the main account meanwhile), so it is not forgotten.
  assert.equal(store.readProfile(name).win32Task.configDir, ACCOUNT, 'the repair overwrote the recorded account folder with the main account');
  // The disk is back: the next time the task goes, Start at login puts it back on its own account.
  fs.renameSync(unplugged, ACCOUNT);
  assert.match(taskOnlyDelete(name).reassurance, /it starts on the account and model it was set to before\./);
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: SET_MODEL }, 'with its folder back the agent did not come back on it');
});

test('kosmos#8489: a recorded account whose config cannot be read right now (Claude Code writing it) starts on the main account this time, says so truly, and the record is kept so it comes back on its account next time', WINDOWS_ONLY, () => {
  const name = agent('midwrite8489');
  assert.equal(chooseThenModel(name, ACCOUNT, 'opus55').outcome, create.OUTCOME.CREATED);
  const config = require('./accounts').configFile(ACCOUNT);
  const whole = fs.readFileSync(config, 'utf8');
  fs.writeFileSync(config, whole.slice(0, Math.floor(whole.length / 2)));   // caught mid-write: half the file
  const p = taskOnlyDelete(name);
  const words = /it starts on the model it was set to, but Kosmos could not read which account is signed in to the account folder it last used, so it starts on your main account unless it can read that by then and it is still the same account\. If it still cannot, Kosmos keeps that folder and tries it again at the next Start at login, unless its startup job is written again before then \(changing its account or model does that\), which forgets that folder\./;
  assert.match(p.reassurance, words);
  assert.match(p.said, words);
  assert.doesNotMatch(p.reassurance, /signed out or changed/, 'the person was told their account signed out or changed');
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL }, 'a folder whose account could not be read was trusted, or the model was lost');
  // The record keeps the folder and whose account it was, so the next Start at login tries it again.
  const kept = store.readProfile(name).win32Task;
  assert.equal(kept.configDir, ACCOUNT, 'the record of an account that only could not be read was dropped');
  assert.deepEqual(kept.account, OWNER_IDENTITY, 'the kept record lost whose account it was');
  fs.writeFileSync(config, whole);   // Claude Code finished writing
  assert.match(taskOnlyDelete(name).reassurance, /it starts on the account and model it was set to before\./);
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: SET_MODEL }, 'with its config readable again the agent did not come back on its account');
});

test('kosmos#8489 review 1: Start at login records the identity it just checked, so the agent it starts writing its config at that moment cannot leave the record with none', WINDOWS_ONLY, (t) => {
  const name = agent('racerec8489');
  assert.equal(chooseThenModel(name, ACCOUNT, 'opus55').outcome, create.OUTCOME.CREATED);
  taskOnlyDelete(name);
  const config = require('./accounts').configFile(ACCOUNT);
  const whole = fs.readFileSync(config, 'utf8');
  // Between the check and the record, the agent just started is writing its config.
  const real = create.installJob;
  t.mock.method(create, 'installJob', (...args) => { fs.writeFileSync(config, whole.slice(0, 10)); return real(...args); });
  try { startAtLogin(name); } finally { fs.writeFileSync(config, whole); }
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: SET_MODEL });
  assert.deepEqual(store.readProfile(name).win32Task.account, OWNER_IDENTITY, 'the record lost whose account it was, so the next Start at login would never trust it');
});

test('kosmos#8489 review 2: a newly chosen folder whose account cannot be read records no identity, never the one an old record held for the same folder name', WINDOWS_ONLY, (t) => {
  const accounts = require('./accounts');
  const alice = accounts.nextWorkDir();
  signIn(alice.dir, { emailAddress: 'alice@example.test', organizationUuid: 'org-alice' });
  const name = agent('reuse8489', { account: alice.dir });
  try {
    assert.equal(chooseThenModel(name, alice.dir, 'opus55').outcome, create.OUTCOME.CREATED);
    assert.equal(store.readProfile(name).win32Task.account.email, 'alice@example.test', 'fixture: not recorded on alice');
    // Alice signs out, Bob signs in to the same folder name, and the person picks it for the agent while Bob's config
    // is being written: the list read it a moment before, the record reads it half written.
    signIn(alice.dir, { emailAddress: 'bob@example.test', organizationUuid: 'org-bob' });
    const config = accounts.configFile(alice.dir);
    const whole = fs.readFileSync(config, 'utf8');
    const realList = accounts.list;
    t.mock.method(accounts, 'list', (...a) => { const r = realList(...a); fs.writeFileSync(config, whole.slice(0, 10)); return r; });
    try {
      assert.equal(create.setAccount(name, alice.dir, { platform: 'win32' }).outcome, create.OUTCOME.CREATED);
    } finally { t.mock.restoreAll(); fs.writeFileSync(config, whole); }
    assert.equal(store.readProfile(name).win32Task.account, null, 'a new choice kept the old person in the record');
    taskOnlyDelete(name);
    startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL }, 'the agent was put on a folder whose account nobody checked');
  } finally { fs.rmSync(alice.dir, { recursive: true, force: true }); }
});

test('kosmos#8489 review 2: a thrown reader bug on the record path is "changed" as at Start at login: logged, and nothing kept', WINDOWS_ONLY, (t) => {
  const name = agent('bugrec8489');
  assert.equal(chooseThenModel(name, ACCOUNT, 'opus55').outcome, create.OUTCOME.CREATED);
  const accounts = require('./accounts');
  const realFile = accounts.configFile;
  const logged = [];
  t.mock.method(console, 'error', (...a) => logged.push(a.join(' ')));
  // An adoption install told the folder is verified, with no identity in hand: it reads, and the read throws.
  fs.rmSync(jobfix.jobPath(name), { force: true });   // the stand-in task gone, so installJob writes one
  t.mock.method(accounts, 'configFile', (d) => { if (nodePath.resolve(d) === nodePath.resolve(ACCOUNT)) throw new Error('a bug'); return realFile(d); });
  let r;
  try { r = create.installJob(name, { platform: 'win32', model: SET_MODEL, configDir: ACCOUNT, runner: 'claude', accountVerified: true }); }
  finally { t.mock.restoreAll(); }
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(store.readProfile(name).win32Task.account, null, 'a thrown read kept the old identity');
  assert.ok(logged.some((l) => /kosmos#8489: reading the account in .* failed: a bug/.test(l)), 'the bug was not logged: ' + JSON.stringify(logged));
});

test('kosmos#8489: what a record keeps of a chosen account: the organization uuid where Claude Code wrote one (not its name); a key by its fingerprint, never the key', WINDOWS_ONLY, () => {
  const accounts = require('./accounts');
  const named = agent('orgrec8489');
  signIn(ACCOUNT, { emailAddress: 'Owner@example.test', organizationName: 'Acme Studio', organizationUuid: 'org-8478' });
  assert.equal(chooseThenModel(named, ACCOUNT, 'opus55').outcome, create.OUTCOME.CREATED);
  assert.deepEqual(store.readProfile(named).win32Task.account, OWNER_IDENTITY, 'the record kept the organization name, or lost the uuid');
  const key = 'sk-ant-api03-' + 'a'.repeat(40) + 'WXYZ';
  const keyDir = nodePath.join(SANDBOX, '.claude-key8489');
  fs.mkdirSync(keyDir, { recursive: true });
  fs.writeFileSync(require('./claudeaccounts').keyFile(keyDir), key + '\n');
  accounts.share(keyDir);
  const keyed = agent('keyrec8489', { account: keyDir });
  try {
    assert.equal(chooseThenModel(keyed, keyDir, 'opus55').outcome, create.OUTCOME.CREATED);
    const id = store.readProfile(keyed).win32Task.account;
    const hash = require('node:crypto').createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
    assert.deepEqual(id, { kind: 'apikey', email: null, keyTail: 'WXYZ', keyHash: hash, org: null });
    assert.doesNotMatch(JSON.stringify(store.readProfile(keyed)), /aaaaaaaa/, 'the key itself went into the profile');
  } finally { fs.rmSync(keyDir, { recursive: true, force: true }); }
});

test('kosmos#8489 review 1: a folder unread at three Start at logins in a row is dropped for good with true words; one readable start in between resets the count', WINDOWS_ONLY, () => {
  const name = agent('thrice8489');
  assert.equal(chooseThenModel(name, ACCOUNT, 'opus55').outcome, create.OUTCOME.CREATED);
  const config = require('./accounts').configFile(ACCOUNT);
  const whole = fs.readFileSync(config, 'utf8');
  try {
    fs.writeFileSync(config, Buffer.alloc(64));   // torn to NULs by a crash
    taskOnlyDelete(name); startAtLogin(name);
    assert.equal(store.readProfile(name).win32Task.unreadable, 1);
    taskOnlyDelete(name); startAtLogin(name);
    assert.equal(store.readProfile(name).win32Task.unreadable, 2);
    const p = taskOnlyDelete(name);
    assert.match(p.reassurance, /it starts on the model it was set to, but Kosmos could not read which account is signed in to the account folder it last used, and could not confirm that account at the two Start at logins before either, so it starts on your main account from now on unless it can read that by then and it is still the same account\. Choose its account again if it should use another\./);
    startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL });
    assert.equal(store.readProfile(name).win32Task.configDir, null, 'the folder was kept after three unreadable Start at logins');
    // Readable again: the record no longer names the folder, so nothing puts the agent back on it on its own.
    fs.writeFileSync(config, whole);
    taskOnlyDelete(name); startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL });
    // The reset: a fresh choice, one unreadable start, then a readable one, clears the count.
    assert.equal(chooseThenModel(name, ACCOUNT, 'opus55').outcome, create.OUTCOME.CREATED);
    fs.writeFileSync(config, Buffer.alloc(64));
    taskOnlyDelete(name); startAtLogin(name);
    assert.equal(store.readProfile(name).win32Task.unreadable, 1);
    fs.writeFileSync(config, whole);
    taskOnlyDelete(name); startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: SET_MODEL });
    const rec = store.readProfile(name).win32Task;
    assert.equal(rec.unreadable, undefined, 'a readable match did not reset the count');
    assert.deepEqual(rec.account, OWNER_IDENTITY);
  } finally { fs.writeFileSync(config, whole); }
});

test('kosmos#8478 round 1: an account removed after the task-only delete is forgotten in the record, so a new sign-in reusing its folder name never gets the agent', WINDOWS_ONLY, () => {
  const accounts = require('./accounts');
  const signInAs = (dir, email) => signIn(dir, { emailAddress: email });   // the file-level fixture (shares history)
  const first = accounts.nextWorkDir();
  assert.ok(first && first.dir, 'fixture: no free account folder name');
  signInAs(first.dir, 'first@example.test');
  const name = agent('reuse8478', { account: first.dir });
  try {
    assert.equal(chooseThenModel(name, first.dir, 'opus55').outcome, create.OUTCOME.CREATED);
    assert.equal(store.readProfile(name).win32Task.configDir, first.dir, 'fixture: the account was not recorded');
    taskOnlyDelete(name);
    // The person removes that account: its agents are found through their tasks, and this one has none, so none refuses.
    const gone = accounts.removeAccount(first.dir, []);
    assert.equal(gone.ok, true, JSON.stringify(gone));
    assert.equal(store.readProfile(name).win32Task.configDir, null, 'the removed account is still in the record');
    assert.equal(store.readProfile(name).win32Task.model, SET_MODEL, 'the model went with the account');
    // Someone else signs in, and Kosmos gives the new account the same folder name.
    const next = accounts.nextWorkDir();
    assert.equal(nodePath.resolve(next.dir), nodePath.resolve(first.dir), 'fixture: the folder name was not reused, so this guards nothing');
    signInAs(next.dir, 'someone-else@example.test');
    assert.match(leftover.startsAgainWords(name), /it starts on the model it was set to, but on your main account, because the account it used was disconnected or removed, so choose its account again if it should use another\./);
    startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL }, 'the agent was put on the new account that reused the folder name');
  } finally { fs.rmSync(first.dir, { recursive: true, force: true }); }
});

test('kosmos#8478 round 2: an unrecorded agent whose account was disconnected before the task-only delete never gets the account that reuses its folder name', WINDOWS_ONLY, () => {
  const accounts = require('./accounts');
  const signIn = (dir, email) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(accounts.configFile(dir), JSON.stringify({ oauthAccount: { emailAddress: email } }));
  };
  const first = accounts.nextWorkDir();
  signIn(first.dir, 'first@example.test');
  // Its task was written before records existed: the task carries the account and the chosen model, the profile nothing.
  const name = agent('stale8478', { account: first.dir, model: SET_MODEL });
  let aside = null;
  try {
    // Disconnect and stop: the account folder is renamed aside, the task stays (nothing recorded, so nothing to clear).
    const out = accounts.forgetAccount(first.dir, []);
    assert.equal(out.ok, true, JSON.stringify(out));
    aside = out.movedTo || null;
    assert.equal(fs.existsSync(first.dir), false, 'fixture: the account folder is still there');
    assert.equal(store.readProfile(name).win32Task, undefined, 'fixture: something is recorded');
    const p = taskOnlyDelete(name);
    const rec = store.readProfile(name).win32Task;
    assert.equal(rec && rec.configDir, null, 'the delete recorded an account folder that was not there: ' + JSON.stringify(rec));
    assert.equal(rec.model, SET_MODEL, 'the model was not recorded');
    const words = /it starts on the model it was set to, but on your main account, because the account folder it used was not there when its startup job was removed, so choose its account again if it should use another\./;
    assert.match(p.reassurance, words, 'the plan did not say what the delete recorded');
    assert.match(p.said, words);
    // Someone else signs in, and Kosmos gives the new account the same folder name.
    const next = accounts.nextWorkDir();
    assert.equal(nodePath.resolve(next.dir), nodePath.resolve(first.dir), 'fixture: the folder name was not reused, so this guards nothing');
    signIn(next.dir, 'someone-else@example.test');
    startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL }, 'the agent was put on the new account that reused the folder name');
  } finally {
    fs.rmSync(first.dir, { recursive: true, force: true });
    if (aside) fs.rmSync(aside, { recursive: true, force: true });
  }
});

test('kosmos#8478 round 4: a stale record loses to the task: recorded on alice, the task rewritten to the main account with no record write, and Start at login keeps it on the main account', WINDOWS_ONLY, () => {
  const accounts = require('./accounts');
  const alice = accounts.nextWorkDir();
  signIn(alice.dir, { emailAddress: 'alice@example.test', organizationUuid: 'org-alice' });
  const name = agent('stalerec8478', { account: alice.dir });
  try {
    assert.equal(chooseThenModel(name, alice.dir, 'opus55').outcome, create.OUTCOME.CREATED);
    assert.equal(store.readProfile(name).win32Task.configDir, alice.dir, 'fixture: not recorded on alice');
    // An older Kosmos (or a record write that failed) rewrites the task onto the main account and records nothing.
    fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, process.execPath, null, SET_MODEL, null, 'claude'));
    assert.equal(store.readProfile(name).win32Task.configDir, alice.dir, 'fixture: the record moved with the task');
    const p = taskOnlyDelete(name);
    startAtLogin(name);
    // The outcome first, so a control against the old code shows the wrong account, not only other words.
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL }, 'Start at login put it on alice although its task ran on the main account');
    assert.match(p.reassurance, /it starts on the account and model it was set to before\./, 'the plan did not read what the delete records');
    assert.equal(store.readProfile(name).win32Task.configDir, null);
  } finally { fs.rmSync(alice.dir, { recursive: true, force: true }); }
});

test('kosmos#8478 round 2: a Gemini account removed is forgotten in the records that name it', WINDOWS_ONLY, () => {
  const gem = require('./geminiaccounts');
  const home = nodePath.join(SANDBOX, gem.DIR_PREFIX + 'work8478');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(gem.keyFile(home), 'AIzaSyKosmosTestKeyNotARealKey000000000');
  assert.ok(gem.identityOf(home), 'fixture: the folder is not a Gemini account');
  const name = 'gemini8478';
  made.push(name);
  store.writeProfile(name, { displayName: name, provider: 'google', win32Task: { runner: 'gemini', configDir: home, model: null } });
  try {
    const out = gem.removeAccount(home, []);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(store.readProfile(name).win32Task, { runner: 'gemini', configDir: null, model: null, accountRemoved: true, removedDir: home });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('kosmos#8478 round 3: a folder name is not an account: alice signs out, Kosmos will not remove the folder, bob signs in there, and the agent comes back on the main account', WINDOWS_ONLY, () => {
  const accounts = require('./accounts');
  const alice = accounts.nextWorkDir();
  signIn(alice.dir, { emailAddress: 'alice@example.test', organizationUuid: 'org-alice' });
  const name = agent('alice8478', { account: alice.dir });
  try {
    assert.equal(chooseThenModel(name, alice.dir, 'opus55').outcome, create.OUTCOME.CREATED);
    const recorded = store.readProfile(name).win32Task;
    // Alice signs out of that folder: no account in it now, so Kosmos refuses to remove it, and the record stays.
    signIn(alice.dir, null);
    const refused = accounts.removeAccount(alice.dir, []);
    assert.equal(refused.ok, false, 'fixture: the signed-out folder was removed after all: ' + JSON.stringify(refused));
    // The folder holds no account, so the next sign-in is given it: bob.
    const next = accounts.nextWorkDir();
    assert.equal(nodePath.resolve(next.dir), nodePath.resolve(alice.dir), 'fixture: the folder name was not reused, so this guards nothing');
    signIn(next.dir, { emailAddress: 'bob@example.test', organizationUuid: 'org-bob' });
    const p = taskOnlyDelete(name);
    startAtLogin(name);
    // The outcome first, so a control against code without the check shows the wrong account, not only other words.
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL }, 'the agent was put on bob\'s account');
    const words = /it starts on the model it was set to, but on your main account, because the account in the folder it used has signed out or changed, so choose its account again if it should use another\./;
    assert.match(p.reassurance, words);
    assert.doesNotMatch(p.reassurance, /account and model it was set to before/, 'it promised the account it was set to, which is now bob\'s');
    assert.match(p.said, words);
    assert.equal(recorded.account && recorded.account.email, 'alice@example.test', 'the record did not keep whose account it was');
  } finally { fs.rmSync(alice.dir, { recursive: true, force: true }); }
});

test('kosmos#8478 round 3: a record of a folder with no identity is never trusted: main account, and the words say so', WINDOWS_ONLY, () => {
  const name = agent('noid8478', { model: SET_MODEL });
  // A record written before records kept whose account it was: the folder is there and holds an account, unverifiable.
  store.writeProfile(name, { win32Task: { runner: 'claude', configDir: ACCOUNT, model: SET_MODEL } });
  const p = taskOnlyDelete(name);
  assert.match(p.reassurance, /it starts on the model it was set to, but on your main account, because Kosmos did not record whose account was in the folder it used\. Choose its account again if it should use another\./);
  assert.match(p.said, /because Kosmos did not record whose account was in the folder it used\. Choose its account again if it should use another\./);
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL });
});

test('kosmos#8478 round 5: the record step can never fail an account removal: the removal runs first and answers', (t) => {
  const gem = require('./geminiaccounts');
  const home = nodePath.join(SANDBOX, gem.DIR_PREFIX + 'throw8478');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(gem.keyFile(home), 'AIzaSyKosmosTestKeyNotARealKey000000000');
  const step = t.mock.method(create, 'afterAccountGone', () => { throw new Error('the record step broke'); });
  try {
    let out;
    assert.doesNotThrow(() => { out = gem.removeAccount(home, []); }, 'a broken record step failed the removal');
    assert.equal(out && out.ok, true, JSON.stringify(out));
    assert.equal(fs.existsSync(home), false, 'the account was not removed');
    // CONTROL: on Windows the step was reached (elsewhere it may not be, and the removal is all that matters there).
    if (process.platform === 'win32') assert.ok(step.mock.callCount() >= 1, 'the record step was never called, so this guards nothing');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('kosmos#8478 round 3: a Grok account removed is forgotten in the records that name it', WINDOWS_ONLY, () => {
  const grok = require('./grokaccounts');
  const home = nodePath.join(SANDBOX, grok.DIR_PREFIX + 'work8478');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(grok.keyFile(home), 'xai-KosmosTestKeyNotARealKey0000000000');
  assert.ok(grok.identityOf(home), 'fixture: the folder is not a Grok account');
  const name = 'grok8478';
  made.push(name);
  store.writeProfile(name, { displayName: name, provider: 'xai', win32Task: { runner: 'grok', configDir: home, model: null } });
  try {
    const out = grok.removeAccount(home, []);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(store.readProfile(name).win32Task, { runner: 'grok', configDir: null, model: null, accountRemoved: true, removedDir: home });
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('kosmos#8478 round 1: an OpenAI account removed or disconnected is forgotten in the records that name it, and only those', WINDOWS_ONLY, () => {
  const oa = require('./openaiaccounts');
  const home = nodePath.join(SANDBOX, '.codex-work8478');
  const other = nodePath.join(SANDBOX, '.codex-other8478');
  for (const d of [home, other]) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(nodePath.join(d, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-test-not-a-key' }));
  }
  const a = 'codexa8478';
  const b = 'codexb8478';
  made.push(a, b);
  store.writeProfile(a, { displayName: a, provider: 'openai', win32Task: { runner: 'codex', configDir: home, model: 'gpt-5.5' } });
  store.writeProfile(b, { displayName: b, provider: 'openai', win32Task: { runner: 'codex', configDir: other, model: null } });
  try {
    const out = oa.removeAccount(home, []);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(store.readProfile(a).win32Task, { runner: 'codex', configDir: null, model: 'gpt-5.5', accountRemoved: true, removedDir: home });
    assert.equal(store.readProfile(b).win32Task.configDir, other, 'a record naming another account was changed');
    // Disconnecting (the folder renamed aside, its name free again) forgets it the same way.
    const out2 = oa.forgetAccount(other, []);
    assert.equal(out2.ok, true, JSON.stringify(out2));
    assert.equal(store.readProfile(b).win32Task.configDir, null, 'a disconnected account is still in the record');
  } finally { for (const d of [home, other]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('kosmos#8478: a recorded account folder that is a junction leading nowhere is not put back', WINDOWS_ONLY, () => {
  const name = agent('junction8478');
  assert.equal(chooseThenModel(name, ACCOUNT, 'opus55').outcome, create.OUTCOME.CREATED);
  const target = nodePath.join(SANDBOX, 'account-target8478');
  fs.rmSync(ACCOUNT, { recursive: true, force: true });
  fs.mkdirSync(target);
  fs.symlinkSync(target, ACCOUNT, 'junction');
  fs.rmSync(target, { recursive: true, force: true });   // the junction now leads nowhere
  try {
    assert.equal(fs.lstatSync(ACCOUNT).isSymbolicLink(), true, 'fixture: no junction at the account folder');
    const rec = create.win32RecordedTask(name);
    assert.equal(rec.accountOk, false, 'a junction leading nowhere read as a usable account folder');
    assert.equal(rec.modelOk, true);
    assert.match(taskOnlyDelete(name).reassurance, CANNOT_REACH);
    startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL });
  } finally { fs.rmSync(ACCOUNT, { recursive: true, force: true }); }
});

test('kosmos#8478: a recorded model no longer offered falls back to the model it last ran, and says so; the account stays', WINDOWS_ONLY, () => {
  const name = agent('retired8478', { model: 'claude-opus-3' });   // round 4: the task carries it too (the task is the truth)
  // A model that has since left the list (setModel would refuse it now, so the record is written as an old task left it).
  store.writeProfile(name, { win32Task: { runner: 'claude', configDir: ACCOUNT, model: 'claude-opus-3', account: OWNER_IDENTITY } });
  const p = taskOnlyDelete(name);
  assert.match(p.reassurance, /it starts on the account it was set to, but on the model it last ran, because the model it was set to is no longer offered, so choose its model again if it used another\./);
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: LAST_RAN });
});

test('kosmos#8478: Restore after the task-only delete says the agent starts on the account and model it was set to', WINDOWS_ONLY, () => {
  const name = agent('restore8478');
  assert.equal(chooseThenModel(name, ACCOUNT, 'opus55').outcome, create.OUTCOME.CREATED);
  const sr = require('./selfreport').fileFor(name);   // what a removed agent that ran here keeps (register.hasRun)
  fs.mkdirSync(nodePath.dirname(sr), { recursive: true });
  fs.writeFileSync(sr, '');
  try {
    assert.notEqual(remove.remove(name, { platform: 'win32' }).outcome, remove.OUTCOME.REFUSED);
    taskOnlyDelete(name);
    const back = remove.restore(name, { platform: 'win32' });
    assert.equal(back.outcome, remove.OUTCOME.PARTIAL, JSON.stringify(back));
    assert.match(back.because, /Use Start at login when Kosmos offers it; it starts on the account and model it was set to before\.$/);
    startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: SET_MODEL });
  } finally {
    fs.rmSync(sr, { force: true });
    try { remove.forget(name); } catch { /* not removed */ }
  }
});

test('kosmos#8478: a record for another runner, and a Qwen agent, are never read as the agent\'s own', () => {
  const codex = 'codex8478';
  made.push(codex);
  // The provider changed without the task being written: the record is for claude, the agent now runs codex.
  store.writeProfile(codex, { displayName: codex, provider: 'openai', win32Task: { runner: 'claude', configDir: ACCOUNT, model: SET_MODEL } });
  assert.equal(create.win32RecordedTask(codex), null);
  const qwen = 'qwen8478';
  made.push(qwen);
  store.writeProfile(qwen, { displayName: qwen, provider: 'alibaba', win32Task: { runner: 'codex', configDir: ACCOUNT, model: null } });
  assert.equal(create.win32RecordedTask(qwen), null, 'a Qwen agent is restored from qwenAccount, never from this record');
  // CONTROL: the same record, for the runner the agent does run, is read.
  store.writeProfile(codex, { win32Task: { runner: 'codex', configDir: ACCOUNT, model: 'gpt-5.5' } });
  const read = create.win32RecordedTask(codex);
  assert.ok(read, 'the record for the runner the agent runs was not read');
  assert.equal(read.configDir, ACCOUNT);
  assert.equal(read.model, 'gpt-5.5');
  assert.equal(read.modelOk, true);
  // round 3: it holds no identity, so its folder is never trusted.
  assert.equal(read.accountOk, false);
  assert.equal(read.accountWhy, 'unverifiable');
});
