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
  fs.mkdirSync(ACCOUNT, { recursive: true });
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
  const set = create.setModel(name, 'opus55', { platform: 'win32' });
  assert.equal(set.outcome, create.OUTCOME.CREATED, JSON.stringify(set));
  assert.deepEqual(store.readProfile(name).win32Task, { runner: 'claude', configDir: ACCOUNT, model: SET_MODEL },
    'the task write did not record the account folder and model it wrote');

  const p = taskOnlyDelete(name);
  assert.match(p.reassurance, /then use Start at login when Kosmos offers it; it starts on the account and model it was set to before\./);
  assert.doesNotMatch(p.reassurance, /main account|last ran/, 'it promised the main account and the last model for an agent whose own are recorded');

  const r = startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: SET_MODEL }, 'Start at login did not put back its account folder and model');
  assert.equal(r.guessed && r.guessed.model, null, 'the report would say it had no record of its model');
});

test('kosmos#8478: an agent with NO record (its task written before this change) on another account and a chosen model comes back on both', WINDOWS_ONLY, () => {
  // The task carries the second account and the chosen model; the profile records nothing (as for every agent today).
  const name = agent('legacy8478', { model: SET_MODEL });
  assert.equal(store.readProfile(name).win32Task, undefined, 'fixture: something is recorded');
  const p = taskOnlyDelete(name);
  // The delete read them from the task and recorded them before removing it.
  assert.deepEqual(store.readProfile(name).win32Task, { runner: 'claude', configDir: ACCOUNT, model: SET_MODEL },
    'the task-only delete did not record the account folder and model from the task first');
  assert.match(p.reassurance, /then use Start at login when Kosmos offers it; it starts on the account and model it was set to before\./);
  assert.match(p.said, /then use Start at login when Kosmos offers it; it starts on the account and model it was set to before\./);
  const r = startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: SET_MODEL }, 'Start at login did not put back its account folder and model');
  assert.equal(r.guessed && r.guessed.model, null);
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
  assert.deepEqual(store.readProfile(name).win32Task, { runner: 'claude', configDir: null, model: LAST_RAN },
    'Start at login wrote a task and did not record it');
});

const CANNOT_REACH = /it starts on the model it was set to, but Kosmos cannot reach the account folder it used right now, so unless it can by then it starts on your main account\. If that folder is on a disk or shared folder that is not connected, connect it first; otherwise choose its account again afterwards if it should use another\./;

test('kosmos#8478: a recorded account folder that cannot be reached falls back to the main account, says so, and comes back once it can', WINDOWS_ONLY, () => {
  const name = agent('gone8478');
  assert.equal(create.setModel(name, 'opus55', { platform: 'win32' }).outcome, create.OUTCOME.CREATED);
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

test('kosmos#8478 round 1: an account removed after the task-only delete is forgotten in the record, so a new sign-in reusing its folder name never gets the agent', WINDOWS_ONLY, () => {
  const accounts = require('./accounts');
  const signIn = (dir, email) => {   // an account as Claude Code leaves it: its folder, with its sign-in in its config
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(accounts.configFile(dir), JSON.stringify({ oauthAccount: { emailAddress: email } }));
  };
  const first = accounts.nextWorkDir();
  assert.ok(first && first.dir, 'fixture: no free account folder name');
  signIn(first.dir, 'first@example.test');
  const name = agent('reuse8478', { account: first.dir });
  try {
    assert.equal(create.setModel(name, 'opus55', { platform: 'win32' }).outcome, create.OUTCOME.CREATED);
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
    signIn(next.dir, 'someone-else@example.test');
    assert.match(leftover.startsAgainWords(name), /it starts on the model it was set to, but on your main account, because the account it used was removed, so choose its account again if it should use another\./);
    startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL }, 'the agent was put on the new account that reused the folder name');
  } finally { fs.rmSync(first.dir, { recursive: true, force: true }); }
});

test('kosmos#8478 round 1: an OpenAI account removed or disconnected is forgotten in the records that name it, and only those', () => {
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
    assert.deepEqual(store.readProfile(a).win32Task, { runner: 'codex', configDir: null, model: 'gpt-5.5', accountRemoved: true });
    assert.equal(store.readProfile(b).win32Task.configDir, other, 'a record naming another account was changed');
    // Disconnecting (the folder renamed aside, its name free again) forgets it the same way.
    const out2 = oa.forgetAccount(other, []);
    assert.equal(out2.ok, true, JSON.stringify(out2));
    assert.equal(store.readProfile(b).win32Task.configDir, null, 'a disconnected account is still in the record');
  } finally { for (const d of [home, other]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('kosmos#8478: a recorded account folder that is a junction leading nowhere is not put back', WINDOWS_ONLY, () => {
  const name = agent('junction8478');
  assert.equal(create.setModel(name, 'opus55', { platform: 'win32' }).outcome, create.OUTCOME.CREATED);
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
  const name = agent('retired8478');
  // A model that has since left the list (setModel would refuse it now, so the record is written as an old task left it).
  store.writeProfile(name, { win32Task: { runner: 'claude', configDir: ACCOUNT, model: 'claude-opus-3' } });
  const p = taskOnlyDelete(name);
  assert.match(p.reassurance, /it starts on the account it was set to, but on the model it last ran, because the model it was set to is no longer offered, so choose its model again if it used another\./);
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: LAST_RAN });
});

test('kosmos#8478: Restore after the task-only delete says the agent starts on the account and model it was set to', WINDOWS_ONLY, () => {
  const name = agent('restore8478');
  assert.equal(create.setModel(name, 'opus55', { platform: 'win32' }).outcome, create.OUTCOME.CREATED);
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
  assert.deepEqual(create.win32RecordedTask(codex), { configDir: ACCOUNT, model: 'gpt-5.5', accountRemoved: false, accountOk: true, modelOk: true });
});
