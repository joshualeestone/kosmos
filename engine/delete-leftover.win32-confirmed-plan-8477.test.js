'use strict';
/**
 * kosmos#8477: the leftover delete plans again when it runs, so what runs can differ from what the person confirmed.
 * On Windows, a dialog for a task left with no folder asks "Remove X's startup job?" (only the task goes, recoverable).
 * If the folder comes back before the click, the re-plan is the FULL delete (folder to the Recycle Bin, community
 * standing reset, account retired), which asks for no typing, so it would run with nobody having confirmed it.
 *
 * The fix: each plan carries `confirm`, a short fingerprint of what it promises; the page sends it back with the DELETE,
 * and del() refuses, touching nothing, when the fresh plan's differs. A request that carried none (`confirmed: null`,
 * what the route passes then) gets the startup job alone at most, never the full delete.
 *
 * Harness as in delete-leftover.win32-recoverable-task-8475.test.js: the win32 arm is injected, Task Scheduler is a
 * stand-in behind win32job's runner seam and PowerShell one behind delete-leftover's, so nothing here creates, changes
 * or deletes a real Scheduled Task or touches a real Recycle Bin. Every root is a sandbox, set before any require.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-8477-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'LaunchAgents', 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const WORKERS = process.env.AGENT_WORKFORCE_WORKERS;
fs.mkdirSync(nodePath.join(WORKERS, 'neighbour8477'), { recursive: true });   // a computer with agents

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const store = require('./store');
const sendertoken = require('./sendertoken');
const win32job = require('./win32job');
const liveness = require('./liveness');
const leftover = require('./delete-leftover');

remove.setRunner(() => ({ ok: true, stdout: '' }));

/* PowerShell stand-in: the drive answers as `driveType` says (Fixed: the Recycle Bin takes it; Network: it does not),
   and a Recycle Bin move takes the path away. */
let driveType = 'Fixed';
const recycled = [];
function powershellStandIn(file, args, opts) {
  const script = args[args.length - 1];
  const p = opts && opts.env && opts.env.KOSMOS_RECYCLE_PATH;
  if (script === leftover.DRIVE_SCRIPT) {
    return { ok: true, stdout: JSON.stringify({ type: driveType, total: 500 * 1024 ** 3, policy: false, nuke: 0, maxMB: 20000 }) + '\r\n' };
  }
  if (script === leftover.RECYCLE_SCRIPT) { recycled.push(p); fs.rmSync(p, { recursive: true, force: true }); return { ok: true, stdout: 'RECYCLED\r\n' }; }
  return { ok: true, stdout: '' };
}
// setRunner also forgets the drive answers it kept, so a changed `driveType` is read on the next plan.
const driveNow = (type) => { driveType = type; leftover.setRunner(powershellStandIn); };

/* Task Scheduler stand-in: `tasks` holds the registered task names. */
const NOT_FOUND = 'ERROR: The system cannot find the file specified.';
const tasks = new Set();
const deletes = [];
function scheduler(args) {
  const a = args.map(String);
  const tnAt = a.indexOf('/TN');
  const tn = tnAt >= 0 ? a[tnAt + 1].replace(/^\\+/, '') : null;
  if (a[0] === '/Query' && a.includes('CSV')) {
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
  if (a[0] === '/End' || a[0] === '/Change') return tasks.has(tn) ? { ok: true, out: 'SUCCESS' } : { ok: false, out: NOT_FOUND };
  return { ok: false, out: 'ERROR: the stand-in Task Scheduler does not know this call.' };
}

const win = {
  plan: (name) => leftover.plan(name, { platform: 'win32' }),
  del: (name, extra) => leftover.del(name, { platform: 'win32', ...(extra || {}) }),
};
const made = [];
const folderOf = (name) => create.workerDir(name);
const putFolder = (name) => {
  fs.mkdirSync(nodePath.join(folderOf(name), 'notes'), { recursive: true });
  fs.writeFileSync(nodePath.join(folderOf(name), 'CLAUDE.md'), 'work\n');
};
/* An agent that has run here, with its settings and a startup task, its folder in the workers folder unless `folder`
   is false. */
function agent(name, { folder = true, profile = {} } = {}) {
  made.push(name);
  store.writeProfile(name, { displayName: name, ...profile });
  fs.mkdirSync(nodePath.dirname(liveness.fileFor(name)), { recursive: true });
  fs.writeFileSync(liveness.fileFor(name), JSON.stringify({ at: new Date().toISOString(), state: 'idle' }));
  sendertoken.mint(name);
  if (folder) putFolder(name);
  tasks.add(win32job.taskName(name));
  return name;
}
/* Every step of the full delete that cannot be undone, watched: a refused delete may run none of them. */
function watchIrreversible(t) {
  const seen = [];
  const spy = (mod, fn, label) => t.mock.method(mod, fn, (...args) => { seen.push(label); return fn === 'revoke' ? { ok: true } : undefined; });
  spy(require('./communitysend'), 'requestRetire', 'community account retired');
  spy(require('./communitystore'), 'forgetTrust', 'community standing reset');
  spy(sendertoken, 'revoke', 'sender tokens revoked');
  return seen;
}
/* Nothing of `name` was touched: its task, folder (when it had one) and settings are all where they were. */
function untouched(name, { folder }) {
  assert.deepEqual(deletes, [], 'a Scheduled Task was removed');
  assert.ok(tasks.has(win32job.taskName(name)), 'the task is gone');
  assert.equal(recycled.length, 0, 'something went to the Recycle Bin');
  assert.equal(fs.existsSync(folderOf(name)), folder, folder ? 'the folder went' : 'a folder appeared');
  assert.equal(fs.existsSync(store.profilePath(name)), true, 'its settings went');
}

test.beforeEach(() => {
  win32job.setRunner(scheduler);
  status.setPaneSource(() => '');
  driveNow('Fixed');
  tasks.clear();
  deletes.length = 0;
  recycled.length = 0;
});
test.afterEach(() => {
  status.setPaneSource(null);
  win32job.setRunner(null);
  for (const n of made.splice(0)) {
    fs.rmSync(store.profilePath(n), { force: true });
    fs.rmSync(liveness.fileFor(n), { force: true });
    try { remove.forget(n); } catch { /* not removed */ }
    try { sendertoken.revoke(n); } catch { /* none */ }
    fs.rmSync(nodePath.join(WORKERS, n), { recursive: true, force: true });
  }
});

test('kosmos#8477: every offered plan carries a short fingerprint, the same for the same leftover', () => {
  const a = agent('same8477', { folder: false });
  const first = win.plan(a);
  assert.equal(first.ok, true, first.because);
  assert.match(String(first.confirm), /^4\.[0-9a-f]{16}$/, 'the task-only plan carries no fingerprint');
  assert.equal(win.plan(a).confirm, first.confirm, 'the same leftover planned twice reads as changed');
  const b = agent('full8477');
  const full = win.plan(b);
  assert.equal(full.ok, true, full.because);
  assert.match(String(full.confirm), /^4\.[0-9a-f]{16}$/, 'the full plan carries no fingerprint');
  assert.notEqual(full.confirm, first.confirm);
});

test('kosmos#8477: the startup job alone was confirmed, then the folder came back: refused, nothing touched', (t) => {
  const name = agent('back8477', { folder: false });
  const shown = win.plan(name);
  assert.equal(shown.taskOnly, true, 'CONTROL: the dialog does not show the startup job alone');
  putFolder(name);   // the person puts the folder back while the dialog is open
  const now = win.plan(name);
  assert.ok(now.ok && !now.taskOnly && now.toTrash && now.typeToConfirm === null,
    'CONTROL: with the folder back the plan is not the untyped full delete the race needs: ' + JSON.stringify(now));
  const seen = watchIrreversible(t);
  const done = win.del(name, { confirmed: shown.confirm });
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(done));
  assert.equal(done.because, leftover.CHANGED_SINCE_SHOWN_BECAUSE);
  assert.equal(done.changed, true);
  assert.equal(done.plan && done.plan.confirm, now.confirm, 'the fresh plan does not travel back for the page to show');
  assert.deepEqual(seen, [], 'a step that cannot be undone ran: ' + seen.join(', '));
  untouched(name, { folder: true });
});

test('kosmos#8477: the same plan confirmed runs, task-only and full', () => {
  const lone = agent('lone8477', { folder: false });
  const p = win.plan(lone);
  const done = win.del(lone, { confirmed: p.confirm });
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
  assert.deepEqual(deletes, [win32job.taskName(lone)]);
  assert.equal(fs.existsSync(store.profilePath(lone)), true, 'the task-only delete took its settings');

  deletes.length = 0;
  const whole = agent('whole8477');
  const f = win.plan(whole);
  assert.ok(f.ok && !f.taskOnly && f.toTrash, 'CONTROL: not the full delete to the Recycle Bin: ' + JSON.stringify(f));
  const gone = win.del(whole, { confirmed: f.confirm });
  assert.equal(gone.outcome, leftover.OUTCOME.DELETED, JSON.stringify(gone));
  assert.equal(fs.existsSync(folderOf(whole)), false, 'the folder is still there');
  assert.ok(recycled.includes(folderOf(whole)), 'the folder did not go to the Recycle Bin');
  assert.deepEqual(deletes, [win32job.taskName(whole)]);
});

test('kosmos#8477: Recycle Bin confirmed, now for good: refused, nothing touched; and the other way round', () => {
  const name = agent('bin8477');
  const toBin = win.plan(name);
  assert.equal(toBin.toTrash, true, 'CONTROL: the shown plan does not go to the Recycle Bin');
  driveNow('Network');   // the drive stops taking the Recycle Bin
  const forGood = win.plan(name);
  assert.equal(forGood.toTrash, false, 'CONTROL: the drive change did not reach the plan');
  // Typed, as the new plan would ask: the typed name is not what decides it, the promise is.
  const done = win.del(name, { confirmed: toBin.confirm, typed: forGood.typeToConfirm });
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(done));
  assert.equal(done.because, leftover.CHANGED_SINCE_SHOWN_BECAUSE);
  untouched(name, { folder: true });

  // For good confirmed (the name typed), then the drive takes the Recycle Bin again: still a different promise.
  driveNow('Fixed');
  const back = win.del(name, { confirmed: forGood.confirm, typed: forGood.typeToConfirm });
  assert.equal(back.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(back));
  untouched(name, { folder: true });
});

test('kosmos#8477: no fingerprint from a request (null): the full delete is refused, the startup job alone still goes', (t) => {
  const whole = agent('nofp8477');
  const seen = watchIrreversible(t);
  const done = win.del(whole, { confirmed: null });
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(done));
  assert.equal(done.because, leftover.UNCONFIRMED_FULL_DELETE_BECAUSE);
  assert.deepEqual(seen, []);
  untouched(whole, { folder: true });
  // Not a string either (a page that sent something else) reads as none.
  assert.equal(win.del(whole, { confirmed: 42 }).outcome, leftover.OUTCOME.REFUSED);
  untouched(whole, { folder: true });

  // The race itself with no fingerprint: an older page showed the startup job alone, the folder came back.
  const raced = agent('raced8477', { folder: false });
  putFolder(raced);
  assert.equal(win.del(raced, { confirmed: null }).outcome, leftover.OUTCOME.REFUSED);
  untouched(raced, { folder: true });

  // The startup job alone, which Start at login undoes, still goes without one.
  const lone = agent('lonenofp8477', { folder: false });
  const ok = win.del(lone, { confirmed: null });
  assert.equal(ok.outcome, leftover.OUTCOME.DELETED, JSON.stringify(ok));
  assert.ok(deletes.includes(win32job.taskName(lone)));
});

test('kosmos#8477 review 7: a caller that leaves `confirmed` out is refused the full delete; only `unchecked: true` by name skips the check', (t) => {
  const whole = agent('inproc8477');
  const seen = watchIrreversible(t);
  const done = win.del(whole);
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, 'a caller that forgot `confirmed` ran the full delete: ' + JSON.stringify(done).slice(0, 300));
  assert.equal(done.because, leftover.UNCONFIRMED_FULL_DELETE_BECAUSE);
  assert.deepEqual(seen, []);
  untouched(whole, { folder: true });
  t.mock.restoreAll();
  const ran = win.del(whole, { unchecked: true });
  assert.equal(ran.outcome, leftover.OUTCOME.DELETED, JSON.stringify(ran));
  assert.equal(leftover.UNCONFIRMED_FULL_DELETE_BECAUSE, 'Kosmos was not told what you agreed to delete, perhaps because this page is from before an update, so nothing was deleted. Reload the page and look again before deleting.');
});

test('kosmos#8477 review 1: unsent community posts that appear after the dialog opened: refused, nothing marked', (t) => {
  const communitysend = require('./communitysend');
  t.mock.method(communitysend, 'hasAccount', () => false);   // no account, so only the unsent posts can be named
  let unsent = 0;
  t.mock.method(communitysend, 'unsentCount', () => unsent);
  const name = agent('unsent8477');
  const shown = win.plan(name);
  assert.ok(shown.ok && !shown.loses.some((l) => /has not gone out/.test(l)), 'CONTROL: the shown dialog already names unsent posts: ' + JSON.stringify(shown.loses));
  unsent = 1;   // an item becomes due, or a store file it cannot read answers 1
  const now = win.plan(name);
  assert.ok(now.loses.some((l) => /has not gone out/.test(l)), 'CONTROL: the fresh plan does not name the unsent posts');
  const retired = t.mock.method(communitysend, 'requestRetire', () => ({ ok: true }));
  const done = win.del(name, { confirmed: shown.confirm });
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(done));
  assert.equal(done.changed, true);
  assert.equal(retired.mock.callCount(), 0, 'its unsent posts were marked never to send');
  untouched(name, { folder: true });
  // With the posts named in the dialog it was shown, the same delete runs.
  const ran = win.del(name, { confirmed: now.confirm });
  assert.equal(ran.outcome, leftover.OUTCOME.DELETED, JSON.stringify(ran));
  assert.equal(retired.mock.callCount(), 1);
});

test('kosmos#8477 review 1: the name no longer asked for on the same act still runs; newly asked for, the typed check refuses', { skip: process.platform !== 'win32' ? 'the recorded folder out of sight is read with Windows paths here' : false }, () => {
  // A recorded folder that is not there makes the task-only plan ask for the name (kosmos#8475 review 4).
  const gone = nodePath.join(SANDBOX, 'not-here-8477');
  const name = agent('typed8477', { folder: false, profile: { dir: gone } });
  const typedPlan = win.plan(name);
  assert.ok(typedPlan.taskOnly && typedPlan.typeToConfirm === name, 'CONTROL: the plan does not ask for the name: ' + JSON.stringify(typedPlan));
  store.writeProfile(name, { dir: create.workerDir(name) });   // the record points back into the workers folder: no name asked for
  const plainPlan = win.plan(name);
  assert.ok(plainPlan.taskOnly && plainPlan.typeToConfirm === null, 'CONTROL: the plan still asks for the name');
  const done = win.del(name, { confirmed: typedPlan.confirm, typed: name });
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, 'the same act was refused as changed: ' + JSON.stringify(done));

  // The other way round: confirmed with no name asked, now one is: refused by the typed check, the plan sent back.
  const other = agent('typed2-8477', { folder: false });
  const before = win.plan(other);
  assert.equal(before.typeToConfirm, null);
  store.writeProfile(other, { displayName: other, dir: gone });
  deletes.length = 0;
  const refused = win.del(other, { confirmed: before.confirm });
  assert.equal(refused.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(refused));
  assert.equal(refused.plan && refused.plan.typeToConfirm, other, 'the plan asking for the name does not travel back');
  untouched(other, { folder: false });
});

test('kosmos#8477 review 2: a git repository that appears in the folder after the dialog opened: refused; a file written there is not', () => {
  const name = agent('git8477');
  const shown = win.plan(name);
  assert.ok(shown.ok && !shown.loses.some((l) => /git repository/.test(l)), 'CONTROL: the shown dialog already names a git repository');
  fs.writeFileSync(nodePath.join(folderOf(name), 'notes', 'more.md'), 'more\n');   // a file count that changes alone: same act
  assert.equal(win.plan(name).confirm, shown.confirm, 'a file written into the folder reads as a changed promise');
  fs.mkdirSync(nodePath.join(folderOf(name), '.git'));
  const now = win.plan(name);
  assert.ok(now.loses.some((l) => /git repository/.test(l)), 'CONTROL: the fresh plan does not name the git repository');
  const done = win.del(name, { confirmed: shown.confirm });
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(done));
  assert.equal(done.changed, true);
  untouched(name, { folder: true });
});

test('kosmos#8477 review 4: going for good, a folder grown materially since the dialog is refused; a small write is not; to the Recycle Bin neither is', () => {
  const name = agent('grow8477');
  const grow = (n) => { const d = nodePath.join(folderOf(name), 'grown'); fs.mkdirSync(d, { recursive: true }); for (let i = 0; i < n; i++) fs.writeFileSync(nodePath.join(d, `f${i}.txt`), 'x'.repeat(1024)); };
  driveNow('Network');   // the Recycle Bin cannot take it: deleted for good, the name typed
  const shown = win.plan(name);
  assert.ok(shown.ok && shown.toTrash === false && shown.typeToConfirm === name, 'CONTROL: not the for-good delete: ' + JSON.stringify(shown));
  fs.writeFileSync(nodePath.join(folderOf(name), 'notes', 'n.md'), 'abc');   // a small write
  assert.equal(win.plan(name).confirm, shown.confirm, 'a small write reads as a changed promise');
  grow(2000);
  const done = win.del(name, { confirmed: shown.confirm, typed: name });
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, 'a folder grown to thousands of files went for good: ' + JSON.stringify(done).slice(0, 300));
  assert.equal(done.because, leftover.CHANGED_SINCE_SHOWN_BECAUSE);
  untouched(name, { folder: true });

  // To the Recycle Bin the same growth is not refused: everything can be got back.
  fs.rmSync(nodePath.join(folderOf(name), 'grown'), { recursive: true, force: true });
  driveNow('Fixed');
  const toBin = win.plan(name);
  assert.equal(toBin.toTrash, true, 'CONTROL: not the Recycle Bin');
  grow(2000);
  assert.equal(win.plan(name).confirm, toBin.confirm, 'a Recycle Bin delete is refused for the folder growing');
});

test('kosmos#8477 review 5: the size step falls at the powers of ten, with none a step of its own', () => {
  const s = leftover.sizeStep;
  assert.deepEqual([0, 1, 9, 10, 99, 100, 999, 1000].map(s), [-1, 0, 0, 1, 1, 2, 2, 3]);
  assert.equal(s(undefined), -1, 'an unknown size reads as none');
});

test('kosmos#8477 review 5: the refusal speaks of what Kosmos would do, true when only a drive probe answered differently', () => {
  assert.equal(leftover.CHANGED_SINCE_SHOWN_BECAUSE, 'What Kosmos would do here is different now, so nothing was deleted. Look at what it says now before deleting.');
});

test('kosmos#8477 review 4: a community read that throws refuses with a sentence that says so, not "changed"', (t) => {
  const communitysend = require('./communitysend');
  let throws = false;
  t.mock.method(communitysend, 'hasAccount', () => { if (throws) throw new Error('EBUSY'); return false; });
  t.mock.method(communitysend, 'unsentCount', () => 0);
  const name = agent('unread8477');
  const shown = win.plan(name);
  throws = true;
  const done = win.del(name, { confirmed: shown.confirm });
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(done));
  assert.equal(done.because, leftover.COULD_NOT_READ_BECAUSE);
  untouched(name, { folder: true });
  throws = false;
  assert.equal(win.del(name, { confirmed: shown.confirm }).outcome, leftover.OUTCOME.DELETED, 'CONTROL: the read back, the same delete runs');
});

test('kosmos#8477: delAsync (the route\'s path) refuses the same way', async () => {
  const name = agent('async8477', { folder: false });
  const shown = win.plan(name);
  putFolder(name);
  const done = await leftover.delAsync(name, { platform: 'win32', confirmed: shown.confirm });
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(done));
  assert.equal(done.changed, true);
  untouched(name, { folder: true });
});

test('kosmos#8477: the route passes what the request confirmed, null when it carried none', () => {
  const server = fs.readFileSync(nodePath.join(__dirname, '..', 'server.js'), 'utf8');
  const at = server.indexOf("if (lo && req.method === 'DELETE')");
  assert.ok(at > -1, 'the DELETE route moved; re-anchor');
  const route = server.slice(at, server.indexOf("const rs = pathname.match(", at));
  assert.match(route, /leftover\.delAsync\(name, \{ typed: body\.typed, confirmed: typeof body\.confirmed === 'string' \? body\.confirmed : null \}\)/);
  const calls = route.match(/leftover\.(delAsync|del)\(/g) || [];
  assert.equal(calls.length, 1, 'another delete call in the route may not pass what was confirmed');
});
