'use strict';
/**
 * kosmos#8475: on Windows, a Kosmos Scheduled Task left with no agent folder is listed in the removed list, and its
 * delete is fully recoverable: it removes the Scheduled Task and nothing else.
 *
 * Why the delete and not the listing was made safe: nothing can tell an agent folder that was DELETED from one moved
 * elsewhere (a renamed workers folder, a disk that is not connected). #8471 tried nine times to sharpen that guess and
 * each round found healthy agents reading as leftovers. So a wrong guess here must cost nothing: the settings, picture,
 * sender tokens, community account and standing, history and any removal record all stay, and nothing is typed. The
 * name then shows as a settings-only row, whose own delete (to the Recycle Bin) removes the rest. If the folder was only
 * moved, putting it back makes the survey offer Start at login, which registers the task again.
 *
 * Driven from any platform where it can be: the win32 arm is injected, and Task Scheduler is a stand-in behind
 * win32job's runner seam (a set of registered task names), so nothing here creates, changes or deletes a real
 * Scheduled Task. Sandboxed like delete-leftover.test.js, because this module MOVES OR DELETES FOLDERS.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-8475-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'LaunchAgents', 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const WORKERS = process.env.AGENT_WORKFORCE_WORKERS;
fs.mkdirSync(nodePath.join(WORKERS, 'neighbour8475'), { recursive: true });   // a computer with agents

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const store = require('./store');
const sendertoken = require('./sendertoken');
const win32job = require('./win32job');
const register = require('./register');
const liveness = require('./liveness');
const worldstarts = require('./worldstarts');
const fleet = require('../test-support/fleet');
const leftover = require('./delete-leftover');

remove.setRunner(() => ({ ok: true, stdout: '' }));

/* PowerShell stand-in: a fixed drive, and a Recycle Bin move that takes the path away. */
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

/* Task Scheduler stand-in (as in the kosmos#8471 file): `tasks` holds the registered task names; `listFails` makes the
   folder listing fail, the way a schtasks that will not answer does. */
const NOT_FOUND = 'ERROR: The system cannot find the file specified.';
const tasks = new Set();
let listFails = false;
const deletes = [];
function scheduler(args) {
  const a = args.map(String);
  const tnAt = a.indexOf('/TN');
  const tn = tnAt >= 0 ? a[tnAt + 1].replace(/^\\+/, '') : null;
  if (a[0] === '/Query' && a.includes('CSV')) {
    if (listFails) return { ok: false, out: 'ERROR: The RPC server is unavailable.' };
    const rows = ['"\\Microsoft\\Windows\\Fixture\\Task","N/A","Ready"'].concat([...tasks].map((t) => `"\\${t}","N/A","Ready"`));
    return { ok: true, out: rows.join('\r\n') + '\r\n' };
  }
  if (a[0] === '/Query' && a.includes('/XML')) return tasks.has(tn) ? { ok: true, out: '<Task></Task>' } : { ok: false, out: NOT_FOUND };
  if (a[0] === '/Query') return tasks.has(tn) ? { ok: true, out: `TaskName: \\${tn}\r\nStatus: Ready\r\n` } : { ok: false, out: NOT_FOUND };
  if (a[0] === '/Delete') {
    deletes.push(tn);
    if (!tasks.delete(tn)) return { ok: false, out: NOT_FOUND };
    return { ok: true, out: `SUCCESS: The scheduled task "${tn}" was successfully deleted.` };
  }
  if (a[0] === '/End') return tasks.has(tn) ? { ok: true, out: 'SUCCESS' } : { ok: false, out: NOT_FOUND };
  // /Change /ENABLE or /DISABLE (remove and restore): only a registered task can be changed.
  if (a[0] === '/Change') return tasks.has(tn) ? { ok: true, out: `SUCCESS: The parameters of scheduled task "${tn}" have been changed.` } : { ok: false, out: NOT_FOUND };
  return { ok: false, out: 'ERROR: the stand-in Task Scheduler does not know this call.' };
}

const win = {
  plan: (name) => leftover.plan(name, { platform: 'win32' }),
  del: (name, typed) => leftover.del(name, { platform: 'win32', ...(typed ? { typed } : {}) }),
  list: () => leftover.settingsLeftovers({ platform: 'win32' }),
};
const listed = (name) => (win.list().names || []).find((x) => x.name === name) || null;
const REMOVED = nodePath.join(store.ROOT, 'removed.json');
function markRemoved(name) {
  fs.mkdirSync(nodePath.dirname(REMOVED), { recursive: true });
  fs.writeFileSync(REMOVED, JSON.stringify([{ name, shownAs: name, removedAt: new Date().toISOString(), stopped: true }]));
}
const removedNow = () => remove.removedNames().names;
const made = [];
/* An agent that has run here (a liveness record, so the survey offers Start at login when it lacks a job), with a
   picture and a sender token, its folder in the workers folder unless `folder` is false. */
function agent(name, { folder = true, task = true, profile = {} } = {}) {
  made.push(name);
  store.writeProfile(name, { displayName: name, ...profile });
  fs.mkdirSync(nodePath.dirname(liveness.fileFor(name)), { recursive: true });
  fs.writeFileSync(liveness.fileFor(name), JSON.stringify({ at: new Date().toISOString(), state: 'idle' }));
  fs.mkdirSync(store.AVATARS, { recursive: true });
  fs.writeFileSync(nodePath.join(store.AVATARS, `${store.safeKey(name)}.png`), 'png');
  sendertoken.mint(name);
  if (folder) {
    const dir = create.workerDir(name);
    fs.mkdirSync(nodePath.join(dir, 'notes'), { recursive: true });
    fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'), 'work\n');
  }
  if (task) tasks.add(win32job.taskName(name));
  return name;
}
const picture = (name) => nodePath.join(store.AVATARS, `${store.safeKey(name)}.png`);

/* Every step of a full delete that cannot be undone, or that drops what an agent keeps, watched: none may run for a
   task-only delete. */
function watchIrreversible(t) {
  const seen = [];
  const spy = (mod, fn, label) => t.mock.method(mod, fn, (...args) => { seen.push(label); return fn === 'revoke' ? { ok: true } : undefined; });
  spy(require('./communitysend'), 'requestRetire', 'community account retired');
  spy(require('./communitystore'), 'forgetTrust', 'community standing reset');
  spy(sendertoken, 'revoke', 'sender tokens revoked');
  spy(require('./crashloop'), 'forget', 'crash history cleared');
  spy(require('./liveness'), 'forget', 'liveness cleared');
  spy(remove, 'forget', 'removal record forgotten');
  // A removal recorded is read from the removed list itself (recordRemoval is not exported): see removedNow below.
  return seen;
}

test.beforeEach(() => {
  win32job.setRunner(scheduler);
  status.setPaneSource(() => '');
  tasks.clear();
  deletes.length = 0;
  recycled.length = 0;
  listFails = false;
  fs.rmSync(REMOVED, { force: true });
  fs.rmSync(worldstarts.RECORD_FILE, { force: true });
});
test.afterEach(() => {
  status.setPaneSource(null);
  win32job.setRunner(null);
  for (const n of made.splice(0)) {
    fs.rmSync(store.profilePath(n), { force: true });
    try { fs.rmSync(picture(n), { force: true }); } catch { /* none */ }
    fs.rmSync(liveness.fileFor(n), { force: true });
    try { fs.rmSync(require('./selfreport').fileFor(n), { force: true }); } catch { /* none */ }
    try { remove.forget(n); } catch { /* not removed */ }
    try { sendertoken.revoke(n); } catch { /* none */ }
    fs.rmSync(nodePath.join(WORKERS, n), { recursive: true, force: true });
  }
});

test('kosmos#8475: Windows lists a task still registered with no folder, marked, and nothing it should not', () => {
  const lone = agent('lone8475', { folder: false });
  const running = agent('running8475', { folder: false });
  const removed = agent('removed8475', { folder: false });
  const waiting = agent('waiting8475', { folder: false });
  const whole = agent('whole8475');   // folder and task: an ordinary stopped agent, not a leftover
  tasks.add(win32job.taskName('noprofile8475'));   // a task with no profile behind it: a stray, never acted on
  markRemoved(removed);
  fs.mkdirSync(nodePath.dirname(worldstarts.RECORD_FILE), { recursive: true });
  fs.writeFileSync(worldstarts.RECORD_FILE, JSON.stringify({ entries: [{ name: waiting, why: 'import' }] }));
  status.setPaneSource(() => fleet.line({ session: running, title: 'idle' }));

  const r = win.list();
  assert.equal(r.ok, true);
  assert.deepEqual(r.names.find((x) => x.name === lone), { name: lone, shownAs: lone, startsAtLogin: true }, 'the task left with no folder was not listed, or not marked: ' + JSON.stringify(r.names));
  for (const n of [running, removed, waiting, whole, 'noprofile8475']) assert.ok(!r.names.some((x) => x.name === n), `${n} was listed: ` + JSON.stringify(r.names));
  // The removed one is still reachable: its removed row asks the same plan, which offers the task alone.
  assert.equal(win.plan(removed).taskOnly, true, 'CONTROL: the removed row does not reach the task-only delete');

  // A look at Task Scheduler that failed is never "still registered": nothing is listed from it.
  listFails = true;
  const failed = win.list();
  assert.ok(!(failed.names || []).some((x) => x.name === lone), 'a failed look listed a task: ' + JSON.stringify(failed));

  // The workers folder itself not there: every agent would read like this, so none is listed (and the click refuses).
  listFails = false;
  const kept = WORKERS + '-away';
  fs.renameSync(WORKERS, kept);
  try {
    assert.equal(listed(lone), null, 'a task was listed while the whole workers folder is missing');
    assert.equal(win.plan(lone).ok, false, 'a task-only delete was offered while the whole workers folder is missing');
  } finally { fs.renameSync(kept, WORKERS); }
  assert.ok(listed(lone), 'CONTROL: with the workers folder back the row is listed again');
});

test('kosmos#8475: its delete removes the Scheduled Task and nothing else, and asks for no typing', (t) => {
  const name = agent('only8475', { folder: false });
  const p = win.plan(name);
  assert.equal(p.ok, true, p.because);
  assert.equal(p.taskOnly, true);
  assert.equal(p.typeToConfirm, null, 'a delete that loses nothing for good asked for typing');
  assert.equal(p.verb, 'Remove its startup job');
  assert.equal(p.question, 'Remove only8475\'s startup job?');
  assert.deepEqual(p.loses, ['Its startup job, so nothing tries to start it again']);
  assert.equal(p.keep, 'Keep its startup job', 'the cancel button would say "Keep the files" over an act that touches none');
  /* kosmos#8475 review: the way back first, saying it starts on the main account and the model it last ran (both lived
     only in the task); then what stays, and how to delete it, since this one's settings would be offered. */
  const back = `If its folder was only moved, or is on a disk that is not connected, put it back at ${create.workerDir(name)}, then use Start at login when Kosmos offers it; `
    + 'it starts on your main account and the model it last ran, so choose its account and model again if it used others.';
  const stay = 'Its settings and picture stay on this computer; to delete them too, delete what is left of only8475 again.';
  assert.equal(p.reassurance, `Only its startup job is removed, so nothing starts only8475 when you log in. ${back} ${stay}`);

  const seen = watchIrreversible(t);
  const done = win.del(name);   // no name typed
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
  assert.deepEqual(deletes, [win32job.taskName(name)], 'the task was not the one thing removed');
  assert.ok(!tasks.has(win32job.taskName(name)), 'the task is still registered');
  assert.deepEqual(seen, [], 'a step that cannot be undone ran: ' + seen.join(', '));
  assert.equal(fs.existsSync(store.profilePath(name)), true, 'its settings went');
  assert.equal(fs.existsSync(picture(name)), true, 'its picture went');
  assert.equal(sendertoken.holdsTokens(name), true, 'its sender tokens were revoked');
  assert.equal(fs.existsSync(liveness.fileFor(name)), true, 'its history went');
  assert.equal(recycled.length, 0, 'something was sent to the Recycle Bin');
  assert.ok(!removedNow().includes(name), 'a removal was recorded');
  assert.equal(done.said, `only8475's startup job is removed, so nothing starts it when you log in. ${back} ${stay}`);
  assert.doesNotMatch(done.said, /name is free/);
});

test('kosmos#8475: afterwards the name is a settings-only row, whose delete goes to the Recycle Bin', () => {
  const name = agent('after8475', { folder: false });
  assert.equal(listed(name).startsAtLogin, true);
  assert.equal(win.del(name).outcome, leftover.OUTCOME.DELETED);
  assert.deepEqual(listed(name), { name, shownAs: name }, 'after the task went, the name is not a settings-only row');
  const p = win.plan(name);
  assert.equal(p.ok, true, p.because);
  assert.ok(!p.job && !p.folder && !p.taskOnly, 'the second plan is not settings alone: ' + JSON.stringify(p));
  assert.equal(p.records.trash, true, 'the settings were not offered to the Recycle Bin');
  const done = win.del(name);
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
  assert.ok(recycled.some((x) => x === store.profilePath(name)), 'the settings did not go to the Recycle Bin: ' + JSON.stringify(recycled));
  assert.equal(listed(name), null, 'the name is still listed once everything went');
});

test('kosmos#8475: a workers folder renamed, then one create: the healthy agents lose only their task, and Start at login brings them back', () => {
  /* The #8471 review 9 case: the whole fleet reads as "no folder" while the workers folder is somewhere else and the
     next create made it again with one agent in it. A delete from any of those rows must cost nothing for good. */
  const a = agent('moved8475a');
  const b = agent('moved8475b');
  const moved = WORKERS + '-renamed';
  fs.renameSync(WORKERS, moved);
  fs.mkdirSync(nodePath.join(WORKERS, 'fresh8475'), { recursive: true });   // the one create after the rename
  try {
    assert.ok(listed(a) && listed(a).startsAtLogin && listed(b), 'the moved agents were not listed (the case this test is about)');
    const p = win.plan(a);
    assert.equal(p.ok, true, p.because);
    assert.equal(p.taskOnly, true, 'a moved agent was offered more than its task');
    const done = win.del(a);
    assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
    assert.ok(!tasks.has(win32job.taskName(a)));
    assert.ok(tasks.has(win32job.taskName(b)), 'another agent lost its task');
    assert.equal(fs.existsSync(store.profilePath(a)), true, 'the moved agent lost its settings');
    assert.equal(fs.existsSync(picture(a)), true, 'the moved agent lost its picture');
    assert.equal(sendertoken.holdsTokens(a), true, 'the moved agent lost its sender tokens');
    assert.equal(fs.existsSync(nodePath.join(moved, a, 'CLAUDE.md')), true, 'the moved agent lost its files');
  } finally {
    fs.rmSync(WORKERS, { recursive: true, force: true });
    fs.renameSync(moved, WORKERS);
  }
  // The folder put back: the survey offers Start at login for it (register.repair acts on exactly this list).
  const s = register.survey({ platform: 'win32' });
  assert.equal(s.ok, true, s.because);
  assert.ok(s.missing.includes(a), 'with its folder back the agent is not offered Start at login: ' + JSON.stringify(s.missing));
  assert.ok(!s.missing.includes(b), 'CONTROL: an agent that kept its task is not offered it');
  assert.equal(listed(a), null, 'with its folder back the agent is still listed as left over');
});

test('kosmos#8475: a recorded folder on a disk that is not connected loses only its task, removed or not', { skip: process.platform !== 'win32' ? 'a drive letter that is not connected is a Windows path' : false }, () => {
  /* The #8475 issue comment: a recorded folder outside the workers folder, on a drive that is not there. Its settings
     must survive the delete, and are not offered for deleting on their own while the folder is out of sight. */
  const free = 'QRSTUVWXYZ'.split('').reverse().find((l) => !fs.existsSync(`${l}:\\`));
  assert.ok(free, 'no free drive letter on this computer for the fixture');
  const dir = `${free}:\\proj8475`;
  for (const [name, removed] of [['drive8475', false], ['drive8475r', true]]) {
    agent(name, { folder: false, profile: { dir } });
    if (removed) markRemoved(name);
    assert.equal(create.recordedDirSpelling(name), dir, 'fixture: the profile does not record the folder');
    const p = win.plan(name);
    assert.equal(p.ok, true, `${name}: ${p.because}`);
    assert.equal(p.taskOnly, true);
    assert.match(p.reassurance, new RegExp('put it back at ' + dir.replace(/\\/g, '\\\\') + (removed ? ', use Restore' : ', then use Start at login')));
    /* kosmos#8475 review: its settings are not offered on their own afterwards (below), so no sentence may send the
       person to delete them "again"; it says only that they stay. */
    assert.match(p.reassurance, /Its settings and picture stay on this computer\.$/, `${name}: ${p.reassurance}`);
    assert.doesNotMatch(p.reassurance, /delete what is left/, `${name}: the plan promised a delete that would be refused`);
    if (!removed) assert.equal(listed(name).startsAtLogin, true, 'the task was not listed');
    const done = win.del(name);
    assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
    assert.doesNotMatch(done.said, /delete what is left/, `${name}: the outcome promised a delete that would be refused`);
    assert.equal(fs.existsSync(store.profilePath(name)), true, `${name} lost its settings`);
    assert.equal(store.readProfile(name).dir, dir, `${name} lost the folder it records`);
    assert.equal(sendertoken.holdsTokens(name), true, `${name} lost its sender tokens`);
    assert.equal(removedNow().includes(name), removed, `${name}: the removed list changed`);
    // Its settings alone are not offered while the folder may only be out of sight (kosmos#7825's rule).
    assert.equal(win.plan(name).ok, false, `${name}: its settings were offered for deleting while its folder may be on a disk that is not connected`);
    assert.equal(listed(name), null, `${name}: listed as settings only while its folder may be out of sight`);
    fs.rmSync(REMOVED, { force: true });
  }
});

test('kosmos#8475 review: a REMOVED name with nothing stored is freed in one click, as on main (no dead end)', (t) => {
  /* With no settings or picture (or only ones another agent shares), removing the task alone left the name on the
     removed list for good: the next click found nothing to delete, and create refuses a removed name. Such a name gets
     the full delete instead: the task, its tokens and the removal record, and the name is free. */
  const bare = 'bare8475';
  made.push(bare);
  tasks.add(win32job.taskName(bare));
  sendertoken.mint(bare);
  // Shared: its stored name is another agent's too (kept.8475's folder maps to the same key), so its settings stay.
  const shared = 'kept8475';
  made.push(shared, 'kept.8475');
  store.writeProfile(shared, { displayName: 'Kept' });
  fs.mkdirSync(nodePath.join(WORKERS, 'kept.8475'), { recursive: true });
  tasks.add(win32job.taskName(shared));
  for (const name of [bare, shared]) {
    markRemoved(name);
    const p = win.plan(name);
    assert.equal(p.ok, true, `${name}: ${p.because}`);
    assert.ok(!p.taskOnly, `${name}: nothing stored, yet the plan removes the task alone and keeps the name taken`);
    assert.equal(p.typeToConfirm, null, `${name}: nothing is lost for good, yet typing was asked`);
    const done = win.del(name);
    assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
    assert.ok(!tasks.has(win32job.taskName(name)), `${name}: its task is still registered`);
    assert.ok(!removedNow().includes(name), `${name}: still on the removed list, so the name stays taken for good`);
    assert.match(done.said, /The name is free\./, `${name}: ${done.said}`);
    assert.equal(sendertoken.holdsTokens(name), false, `${name}: the name is free while its sender tokens still work`);
    assert.deepEqual(win.plan(name).ok, false, `${name}: something is still offered after the name was freed`);
  }
  assert.equal(fs.existsSync(store.profilePath(shared)), true, 'the settings another agent shares were deleted');
  // CONTROL: a removed name WITH its own settings still gets the task-only delete and keeps its row.
  const own = agent('own8475', { folder: false });
  markRemoved(own);
  assert.equal(win.plan(own).taskOnly, true, 'CONTROL: a removed name with settings no longer gets the task-only delete');
  assert.equal(win.del(own).outcome, leftover.OUTCOME.DELETED);
  assert.ok(removedNow().includes(own), 'CONTROL: the removed row of a name with settings went');
});

test('kosmos#8475 review: the way back says which account and model the agent starts on', () => {
  /* A Claude or Codex agent's account folder and set model lived only in its Scheduled Task, so Start at login brings it
     back on the main account and the model it last ran. A Qwen agent's account is in its profile and comes back. */
  const main = agent('acct8475', { folder: false, profile: { provider: 'openai' } });
  const qwen = agent('qwen8475', { folder: false, profile: { provider: 'alibaba' } });
  assert.match(win.plan(main).reassurance, /Start at login when Kosmos offers it; it starts on your main account and the model it last ran, so choose its account and model again if it used others\./);
  const q = win.plan(qwen).reassurance;
  assert.match(q, /Start at login when Kosmos offers it; it starts on the model it last ran, so choose its model again if it used another\./);
  assert.doesNotMatch(q, /main account/, 'a Qwen agent was told it starts on the main account');
});

test('kosmos#8475 review: Restore after its startup job alone was removed says to use Start at login, not to start it by hand', () => {
  const name = agent('restore8475');
  /* Removing clears its liveness record but keeps its self-report history (register.hasRun), which is what a real agent
     that ran here has; without one the board never offers Start at login (the plan names that as its weakest part). */
  const sr = require('./selfreport').fileFor(name);
  fs.mkdirSync(nodePath.dirname(sr), { recursive: true });
  fs.writeFileSync(sr, '');
  const removal = remove.remove(name, { platform: 'win32' });
  assert.notEqual(removal.outcome, remove.OUTCOME.REFUSED, JSON.stringify(removal));
  assert.ok(removedNow().includes(name), 'fixture: the agent was not removed');
  const away = nodePath.join(SANDBOX, 'restore8475-away');
  fs.renameSync(create.workerDir(name), away);   // its folder moved elsewhere
  const done = win.del(name);
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
  assert.ok(!tasks.has(win32job.taskName(name)), 'fixture: the task is still registered');
  fs.renameSync(away, create.workerDir(name));   // put back
  const back = remove.restore(name, { platform: 'win32' });
  assert.equal(back.outcome, remove.OUTCOME.PARTIAL, JSON.stringify(back));
  assert.match(back.because, /^restore8475 is back on the board, but its startup job is no longer set up, so it will not start on its own\. Use Start at login when Kosmos offers it; it starts on your main account/);
  assert.doesNotMatch(back.because, /by hand/);
  assert.ok(!removedNow().includes(name), 'Restore left it on the removed list');
  assert.ok(register.survey({ platform: 'win32' }).missing.includes(name), 'Start at login is not offered for it');
});

test('kosmos#8475 review 2: Restore while the folder is still away says to put it back first', () => {
  /* register.survey offers Start at login only for an agent whose folder is there, so with it still missing the sentence
     must not promise an offer that never comes. */
  const name = agent('restore8475b');
  const sr = require('./selfreport').fileFor(name);
  fs.mkdirSync(nodePath.dirname(sr), { recursive: true });
  fs.writeFileSync(sr, '');
  assert.notEqual(remove.remove(name, { platform: 'win32' }).outcome, remove.OUTCOME.REFUSED);
  const away = nodePath.join(SANDBOX, 'restore8475b-away');
  fs.renameSync(create.workerDir(name), away);
  try {
    assert.equal(win.del(name).outcome, leftover.OUTCOME.DELETED);
    const back = remove.restore(name, { platform: 'win32' });
    assert.equal(back.outcome, remove.OUTCOME.PARTIAL, JSON.stringify(back));
    assert.match(back.because, /so it will not start on its own\. Once its folder is back, use Start at login when Kosmos offers it; it starts on your main account/);
    assert.ok(!register.survey({ platform: 'win32' }).missing.includes(name), 'CONTROL: with its folder away Start at login is offered after all, so the words above guard nothing');
  } finally { fs.rmSync(away, { recursive: true, force: true }); }
});

test('kosmos#8475 review 2: a listed, NOT removed agent whose stored name another folder shares keeps everything but its task', (t) => {
  /* namedRecords answers "nothing stored" when another folder maps to the same stored key (pear.8475 beside pear8475).
     The full-delete fallback is for removed names only; this healthy agent, its folder only moved, gets the task-only
     delete and keeps its tokens, standing and community account. */
  const name = agent('pear8475', { folder: false });
  made.push('pear.8475');
  fs.mkdirSync(nodePath.join(WORKERS, 'pear.8475'), { recursive: true });
  assert.equal(listed(name) && listed(name).startsAtLogin, true, 'fixture: the name is not listed');
  const p = win.plan(name);
  assert.equal(p.ok, true, p.because);
  assert.equal(p.taskOnly, true, 'a healthy agent sharing its stored name got the full delete: ' + p.reassurance);
  assert.equal(p.hint, 'Something on this computer still starts pear8475 when you log in.');
  const seen = watchIrreversible(t);
  assert.equal(win.del(name).outcome, leftover.OUTCOME.DELETED);
  assert.deepEqual(seen, [], 'a step that cannot be undone ran: ' + seen.join(', '));
  assert.equal(sendertoken.holdsTokens(name), true, 'its sender tokens were revoked');
  assert.equal(fs.existsSync(store.profilePath(name)), true, 'its settings went');
  // CONTROL: the same name once removed (and nothing of its own stored) still gets the one-click full delete.
  tasks.add(win32job.taskName(name));
  markRemoved(name);
  assert.ok(!win.plan(name).taskOnly, 'CONTROL: a removed name sharing its stored key no longer gets the full delete');
});
