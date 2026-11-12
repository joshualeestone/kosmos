'use strict';
/**
 * kosmos#8471: on Windows, a leftover Kosmos Scheduled Task with no agent folder was invisible on the board, so nobody
 * could delete it from the screen, and a delete whose task could not be removed made exactly that state itself (it
 * still sent the folder to the Recycle Bin, kept the settings and forgot the removal).
 *
 * 1. A delete whose startup job Task Scheduler would not remove keeps the folder and every record, as a Linux unit does
 *    (review 33), so the agent stays where a person can see it and the delete can be tried again.
 * 2. settingsLeftovers lists a name whose profile is there, whose folder is gone and whose task is still registered, so
 *    the removed list draws a Delete for it, and that delete removes the task and the settings end to end.
 *
 * Driven from any platform: the win32 arm is injected, and Task Scheduler is a stand-in behind win32job's own runner
 * seam (a set of registered task names), so nothing here creates, changes or deletes a real Scheduled Task. Sandboxed
 * like delete-leftover.test.js, because this module MOVES OR DELETES FOLDERS.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-8471-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'LaunchAgents', 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
// review 7: the workers folder exists from the start (as on a real computer), so no test depends on an earlier one making it.
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
// And holds an agent's folder, as on a computer with agents.
fs.mkdirSync(nodePath.join(process.env.AGENT_WORKFORCE_WORKERS, 'neighbour8471'), { recursive: true });

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const store = require('./store');
const sendertoken = require('./sendertoken');
const win32job = require('./win32job');
const leftover = require('./delete-leftover');

remove.setRunner(() => ({ ok: true, stdout: '' }));

/* PowerShell stand-in: a fixed drive, and a Recycle Bin move that takes the folder away. */
const recycled = [];
leftover.setRunner((file, args, opts) => {
  const script = args[args.length - 1];
  const p = opts && opts.env && opts.env.KOSMOS_RECYCLE_PATH;
  if (script === leftover.DRIVE_SCRIPT) {
    return { ok: true, stdout: JSON.stringify({ type: 'Fixed', total: 500 * 1024 ** 3, policy: false, nuke: 0, maxMB: 20000 }) + '\r\n' };
  }
  if (script === leftover.RECYCLE_SCRIPT) { recycled.push(p); fs.rmSync(p, { recursive: true, force: true }); return { ok: true, stdout: 'RECYCLED\r\n' }; }
  return { ok: true, stdout: '' };
});

/* Task Scheduler stand-in: `tasks` holds the registered task names (as win32job.taskName spells them); a /Delete is
   refused while `deleteRefused` is set, the way an access-denied answer comes back. */
const NOT_FOUND = 'ERROR: The system cannot find the file specified.';
const tasks = new Set();
let deleteRefused = false;
const deletes = [];
function scheduler(args) {
  const a = args.map(String);
  const tnAt = a.indexOf('/TN');
  const tn = tnAt >= 0 ? a[tnAt + 1].replace(/^\\+/, '') : null;
  if (a[0] === '/Query' && a.includes('CSV')) {
    // The folder listing (win32job.list): every Kosmos task, plus one outside the folder as a real machine has.
    const rows = ['"\\Microsoft\\Windows\\Fixture\\Task","N/A","Ready"'].concat([...tasks].map((t) => `"\\${t}","N/A","Ready"`));
    return { ok: true, out: rows.join('\r\n') + '\r\n' };
  }
  if (a[0] === '/Query' && a.includes('/XML')) return tasks.has(tn) ? { ok: true, out: '<Task></Task>' } : { ok: false, out: NOT_FOUND };
  if (a[0] === '/Query') return tasks.has(tn) ? { ok: true, out: `TaskName: \\${tn}\r\nStatus: Ready\r\n` } : { ok: false, out: NOT_FOUND };
  if (a[0] === '/Delete') {
    deletes.push(tn);
    if (deleteRefused) return { ok: false, out: 'ERROR: Access is denied.' };
    if (!tasks.delete(tn)) return { ok: false, out: NOT_FOUND };
    return { ok: true, out: `SUCCESS: The scheduled task "${tn}" was successfully deleted.` };
  }
  if (a[0] === '/End') return tasks.has(tn) ? { ok: true, out: 'SUCCESS' } : { ok: false, out: NOT_FOUND };
  return { ok: false, out: 'ERROR: the stand-in Task Scheduler does not know this call.' };
}

const win = {
  plan: (name) => leftover.plan(name, { platform: 'win32' }),
  del: (name) => leftover.del(name, { platform: 'win32', typed: name }),
};
const REMOVED = nodePath.join(store.ROOT, 'removed.json');
function markRemoved(name) {
  fs.mkdirSync(nodePath.dirname(REMOVED), { recursive: true });
  fs.writeFileSync(REMOVED, JSON.stringify([{ name, shownAs: name, removedAt: new Date().toISOString(), stopped: true }]));
}
const removedNow = () => remove.removedNames().names;
const made = [];
function agent(name, { folder = true, task = true } = {}) {
  made.push(name);
  store.writeProfile(name, { displayName: name });
  if (folder) {
    const dir = create.workerDir(name);
    fs.mkdirSync(nodePath.join(dir, 'notes'), { recursive: true });
    fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'), 'work\n');
    fs.writeFileSync(nodePath.join(dir, 'notes', '1.md'), 'more\n');
  }
  if (task) tasks.add(win32job.taskName(name));
  return name;
}

test.beforeEach(() => {
  win32job.setRunner(scheduler);
  status.setPaneSource(() => '');
  tasks.clear();
  deletes.length = 0;
  recycled.length = 0;
  deleteRefused = false;
  fs.rmSync(REMOVED, { force: true });
});
test.afterEach(() => {
  status.setPaneSource(null);
  win32job.setRunner(null);
  for (const n of made.splice(0)) {
    fs.rmSync(store.profilePath(n), { force: true });
    fs.rmSync(create.workerDir(n), { recursive: true, force: true });
  }
});

test('kosmos#8471 part 1: a delete whose task Task Scheduler would not remove keeps the folder, the settings and the removal', () => {
  const name = agent('stuck8471');
  markRemoved(name);
  sendertoken.mint(name);
  const p = win.plan(name);
  assert.equal(p.ok, true, p.because);
  assert.ok(p.folder && p.job && p.job.task, 'the plan did not see both the folder and the task');

  deleteRefused = true;
  const done = win.del(name);
  assert.equal(deletes.length, 1, 'the task was never asked to go');
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(done));
  assert.equal(recycled.length, 0, 'the folder was sent to the Recycle Bin while its task still holds the name');
  assert.equal(fs.existsSync(create.workerDir(name)), true, 'the folder is gone while its task is still registered');
  assert.equal(fs.existsSync(store.profilePath(name)), true, 'its settings went');
  assert.ok(removedNow().includes(name), 'the removal was forgotten, so nothing on screen reaches the agent again');
  assert.equal(sendertoken.holdsTokens(name), true, 'its sender tokens were revoked although nothing was deleted');
  assert.match(done.because, /^Task Scheduler would not remove stuck8471's startup job, so its folder was kept too\. The name stays taken; try again in a moment, and if it keeps failing, open Task Scheduler, find agent-stuck8471 in the Kosmos folder of the Task Scheduler Library, delete it, then try again here\./);
  assert.match(done.because, /standing in the community was reset/);
  assert.doesNotMatch(done.because, /systemd|user services/, 'a Windows sentence spoke of Linux');
  const folderStep = done.steps.find((s) => s.step === 'its folder');
  assert.deepEqual(folderStep, { step: 'its folder', ok: false, because: 'kept, because its startup job could not be removed' });
  assert.ok(!done.steps.some((s) => s.step === 'its sender tokens'), 'its tokens were revoked although nothing was deleted');

  // The retry, once Task Scheduler answers: everything goes, and the name is free.
  deleteRefused = false;
  const again = win.del(name);
  assert.equal(again.outcome, leftover.OUTCOME.DELETED, JSON.stringify(again));
  assert.equal(tasks.size, 0);
  assert.equal(fs.existsSync(create.workerDir(name)), false);
  assert.equal(fs.existsSync(store.profilePath(name)), false, 'its settings stayed after the retry');
  assert.ok(!removedNow().includes(name));
});

test('kosmos#8471 part 1: with no folder, a task that would not go keeps the settings and the removal too', () => {
  const name = agent('nofold8471', { folder: false });
  markRemoved(name);
  deleteRefused = true;
  const done = win.del(name);
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(done));
  // kosmos#8471 review 1: a refusal that lasts (another account's task) names the task a person can delete themselves.
  assert.match(done.because, /^Task Scheduler would not remove nofold8471's startup job\. The name stays taken; try again in a moment, and if it keeps failing, open Task Scheduler, find agent-nofold8471 in the Kosmos folder of the Task Scheduler Library, delete it, then try again here\./);
  assert.equal(fs.existsSync(store.profilePath(name)), true, 'its settings went');
  assert.ok(removedNow().includes(name), 'the removal was forgotten');
});

test('kosmos#8471 part 1 CONTROL: a task that goes still sends the folder to the Recycle Bin, as before', () => {
  const name = agent('fine8471');
  const done = win.del(name);
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
  assert.ok(recycled.length >= 1, 'nothing went to the Recycle Bin');
  assert.equal(fs.existsSync(create.workerDir(name)), false);
  assert.equal(tasks.size, 0);
});

test('kosmos#8471: the task of a removed agent left with no folder: its delete removes the task and the settings, and says so', () => {
  const lone = agent('task8471', { folder: false });
  markRemoved(lone);   // reached from its removed row (kosmos#8471 lists no task with no folder: review 9)

  // The click: the plan offers to remove the task and the settings, and the delete does both.
  const p = win.plan(lone);
  assert.equal(p.ok, true, p.because);
  assert.equal(p.folder, null);
  assert.ok(p.job && p.job.task, 'the plan did not see the task');
  // kosmos#8471 review 2: the button names everything the click does, the settings included.
  assert.equal(p.verb, 'Remove its startup job and delete its settings');
  /* kosmos#8471 review 1: with no folder the settings go for good (by #7820's design) and the name is typed, but the
     sentence gave a reason that was not true ("the Recycle Bin cannot take them"). It now says the fact. */
  assert.equal(p.records.trash, false, 'CONTROL: #7820 keeps a task-only delete off the Recycle Bin');
  assert.equal(p.typeToConfirm, lone, 'settings deleted for good, yet no typing was asked');
  assert.match(p.reassurance, /^Its startup job is removed\. Its settings are deleted for good\. After this, the name task8471 is free for a new agent\.$/);
  assert.doesNotMatch(p.reassurance, /cannot go to the Recycle Bin|Nothing you can lose/);
  const done = win.del(lone);
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
  assert.ok(!tasks.has(win32job.taskName(lone)), 'the task is still registered');
  assert.equal(fs.existsSync(store.profilePath(lone)), false, 'its settings stayed');
  assert.equal(done.said, 'Nothing starts task8471 any more. The name is free.');
  assert.ok(!removedNow().includes(lone), 'its removed row stayed after its delete');
});

test('kosmos#8471 review 4: a task left with no folder because the workers folder is behind a dead link is refused, never deleted', () => {
  /* An unplugged disk or share behind a junction: every agent's folder then reads as gone while its task is registered,
     so every agent looks like a task left with no folder. The delete would remove each task and its settings for good;
     it must refuse instead. (Stricter than settings alone, which go to the Recycle Bin and so are not refused here.) */
  const name = agent('dangle8471', { folder: false });
  const before = process.env.AGENT_WORKFORCE_WORKERS;
  const target = nodePath.join(SANDBOX, 'unplugged-disk');
  const link = nodePath.join(SANDBOX, 'workers-link');
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(target, link, 'junction');   // a junction: no admin rights or Developer Mode needed
  fs.rmSync(target, { recursive: true, force: true });   // the disk goes away; the junction now leads nowhere
  process.env.AGENT_WORKFORCE_WORKERS = link;
  try {
    const p = win.plan(name);
    assert.equal(p.ok, false, 'a delete was offered while the workers folder leads nowhere: ' + JSON.stringify(p));
    assert.match(p.because, /^the folder Kosmos keeps its agents in is behind a link that leads nowhere right now, .* so Kosmos will not delete dangle8471's settings\. If that folder is gone for good, open Task Scheduler, delete agent-dangle8471 in the Kosmos folder of the Task Scheduler Library, then try again here\.$/);
    const done = win.del(name);
    assert.notEqual(done.outcome, leftover.OUTCOME.DELETED, 'the delete went ahead');
    assert.equal(fs.existsSync(store.profilePath(name)), true, 'its settings were deleted');
    assert.ok(tasks.has(win32job.taskName(name)), 'its task was removed');
  } finally {
    process.env.AGENT_WORKFORCE_WORKERS = before;
    fs.rmSync(link, { force: true });
  }
  // CONTROL: with the workers folder back, the same row is offered.
  assert.equal(win.plan(name).ok, true, 'the control did not offer the delete, so the refusal above proves nothing');
});

test('kosmos#8471 review 5: a task left with no folder because the workers folder is not there at all is refused, never deleted', () => {
  /* A workers folder on a drive that is not connected, or renamed or moved: every agent's folder reads as gone while its
     task is registered, and a missing drive reads as "the rest of the path is gone", not as a dead link. */
  const name = agent('absent8471', { folder: false });
  const before = process.env.AGENT_WORKFORCE_WORKERS;
  process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'not-connected', 'workers');   // nothing at this path
  try {
    const p = win.plan(name);
    assert.equal(p.ok, false, 'a delete was offered while the workers folder is not there: ' + JSON.stringify(p));
    assert.match(p.because, /^the folder Kosmos keeps its agents in is not there right now, perhaps on a disk that is not connected, so Kosmos will not delete absent8471's settings\. If that folder is gone for good, open Task Scheduler, delete agent-absent8471 in the Kosmos folder of the Task Scheduler Library, then try again here\.$/);
    const done = win.del(name);
    assert.notEqual(done.outcome, leftover.OUTCOME.DELETED, 'the delete went ahead');
    assert.equal(fs.existsSync(store.profilePath(name)), true, 'its settings were deleted');
    assert.ok(tasks.has(win32job.taskName(name)), 'its task was removed');
  } finally {
    process.env.AGENT_WORKFORCE_WORKERS = before;
  }
  assert.equal(win.plan(name).ok, true, 'the control did not offer the delete, so the refusal above proves nothing');
});

test('kosmos#8471 review 9: no platform lists a task left with no folder (a folder moved elsewhere reads the same)', () => {
  /* Listing it offered a delete that loses settings for good, and nothing can tell a deleted agent folder from one
     renamed or moved elsewhere (review 9 reproduced a whole fleet offered after a rename and one create). Only a job
     KNOWN to be absent is listed, on every platform; the one that could not be looked at never is. */
  const given = { ok: true, agents: [
    { name: 'task8471b', shownAs: 'Task', profile: true, folder: false, job: true, removed: false },
    { name: 'none8471', shownAs: 'None', profile: true, folder: false, job: false, removed: false },
    { name: 'unk8471', shownAs: 'Unk', profile: true, folder: false, job: null, removed: false },
  ] };
  for (const platform of ['darwin', 'linux', 'win32']) {
    assert.deepEqual(leftover.settingsLeftovers({ platform, survey: given }).names, [{ name: 'none8471', shownAs: 'None' }], platform);
  }
});
