'use strict';
/**
 * kosmos#8466 (second half): on Windows a Kosmos Scheduled Task left with no agent folder holds its name.
 *
 * create.nameHeld read a plist path, which never exists on Windows, so its "job" was always false there: create and the
 * team step went on with such a name and /Create /F overwrote the leftover task without a word. It now reads the file
 * Task Scheduler keeps the task in (win32job.taskFilePath, kosmos#8454). It waited for kosmos#8475, which made such a
 * task visible on the screen (a row in the list of what is left of past agents) and its delete recoverable (the task
 * alone): create's refusal must point at a way out that exists. Where the row is not shown for the name, the sentence
 * names the task to delete in Task Scheduler instead, and for a running agent it says to stop it first.
 *
 * The task is a file in the sandbox and Task Scheduler is test-support/jobfixture.js's stand-in behind win32job's runner
 * seam, which reads those files, so nothing here creates, changes or deletes a real Scheduled Task. The stand-in is
 * installed only on a Windows host, so the Windows tests run there (the CI windows job selects this file by its name);
 * the macOS and Linux pin runs everywhere. Sandboxed, as delete-leftover's own tests are: it MOVES OR DELETES FOLDERS.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'create-namehold-8466-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'LaunchAgents', 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const WORKERS = process.env.AGENT_WORKFORCE_WORKERS;
fs.mkdirSync(nodePath.join(WORKERS, 'neighbour8466'), { recursive: true });   // a computer with agents

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const store = require('./store');
const win32job = require('./win32job');
const linuxjob = require('./linuxjob');
const liveness = require('./liveness');
const worldstarts = require('./worldstarts');
const teamseed = require('./teamseed');
const fleet = require('../test-support/fleet');
const jobfixture = require('../test-support/jobfixture');
const leftover = require('./delete-leftover');

remove.setRunner(() => ({ ok: true, stdout: '' }));
/* PowerShell stand-in: a fixed drive, and a Recycle Bin move that takes the path away (a task-only delete moves nothing). */
leftover.setRunner((file, args, opts) => {
  const script = args[args.length - 1];
  const p = opts && opts.env && opts.env.KOSMOS_RECYCLE_PATH;
  if (script === leftover.DRIVE_SCRIPT) {
    return { ok: true, stdout: JSON.stringify({ type: 'Fixed', total: 500 * 1024 ** 3, policy: false, nuke: 0, maxMB: 20000 }) + '\r\n' };
  }
  if (script === leftover.RECYCLE_SCRIPT) { fs.rmSync(p, { recursive: true, force: true }); return { ok: true, stdout: 'RECYCLED\r\n' }; }
  return { ok: true, stdout: '' };
});

const WIN = process.platform === 'win32';
const onlyWin = WIN ? {} : { skip: 'the stand-in Task Scheduler (test-support/jobfixture.js) is installed only on a Windows host' };
const BINS = { claudeBin: process.execPath, tmuxBin: process.execPath };   // runnable on every host; never started here

/* The Scheduled Task, registered the way the stand-in keeps it: its definition file where Task Scheduler stores it. Ask
   for the path each time (jobfixture: it also forgets what win32job remembered of the task). */
function registerTask(name) {
  const at = jobfixture.jobPath(name);
  fs.writeFileSync(at, jobfixture.jobFor(name, process.execPath, null, null, null, 'claude'), 'utf8');
  return at;
}
const taskThere = (name) => fs.existsSync(win32job.taskFilePath(name));

const made = [];
/* An agent that has run here, with settings and a task, and no folder unless `folder` is true. */
function leftoverTask(name, { profile = true, folder = false } = {}) {
  made.push(name);
  if (profile) store.writeProfile(name, { displayName: name });
  fs.mkdirSync(nodePath.dirname(liveness.fileFor(name)), { recursive: true });
  fs.writeFileSync(liveness.fileFor(name), JSON.stringify({ at: new Date().toISOString(), state: 'idle' }));
  if (folder) fs.mkdirSync(create.workerDir(name), { recursive: true });
  registerTask(name);
  return name;
}
function createNow(name) {
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  jobfixture.useJobStore();   // the job the create registers goes to the stand-in Task Scheduler
  try { return create.createAgent({ ...BINS, name, role: 'pm' }); } finally { create.setDryRun(true); create.setRunner(null); }
}

/* The way out where no screen shows the task: delete-leftover.js's words for it, with this name's task. */
const schedulerWords = (name) => `something called ${name} is still set to start on this computer, though Kosmos cannot find a folder for it. Pick another name. If that agent is gone for good, you can free this one: open Task Scheduler, delete agent-${name} in the Kosmos folder of the Task Scheduler Library, then try again here.`;

/* Where the row is shown: the toggle's label exactly as web/index.html draws it (without its count), and the row's
   button, ellipsis included. ONLY_LEFT with nobody removed, BOTH with a removed agent on the list. */
const ONLY_LEFT = '"Show what is left of past agents"';
const BOTH = '"Show removed agents and what is left of others"';
const rowWords = (name, toggle) => `something called ${name} is still set to start on this computer, though Kosmos cannot find a folder for it. Pick another name, or free this one: at the bottom of the Agents tab, press ${toggle}, then press "Remove its startup job…" beside ${name}. Its settings stay on this computer.`;
const REMOVED = nodePath.join(store.ROOT, 'removed.json');
function markRemoved(name) {
  fs.mkdirSync(nodePath.dirname(REMOVED), { recursive: true });
  fs.writeFileSync(REMOVED, JSON.stringify([{ name, shownAs: name, removedAt: new Date().toISOString(), stopped: true }]));
}

test.beforeEach(() => {
  status.setPaneSource(() => '');
  fs.rmSync(worldstarts.RECORD_FILE, { force: true });
  fs.rmSync(REMOVED, { force: true });
});
test.afterEach(() => {
  status.setPaneSource(null);
  for (const n of made.splice(0)) {
    fs.rmSync(store.profilePath(n), { force: true });
    fs.rmSync(liveness.fileFor(n), { force: true });
    try { remove.forget(n); } catch { /* not removed */ }
    fs.rmSync(win32job.taskFilePath(n), { force: true });
    fs.rmSync(nodePath.join(WORKERS, n), { recursive: true, force: true });
  }
});

test('kosmos#8466: macOS and Linux read their own job, never the Windows task file (unchanged)', () => {
  const name = 'pin8466';
  made.push(name);
  const taskFile = win32job.taskFilePath(name);
  fs.mkdirSync(nodePath.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, '<Task/>');
  assert.deepEqual(create.nameHeld(name, 'darwin'), { folder: false, job: false }, 'macOS read the Windows task file');
  assert.deepEqual(create.nameHeld(name, 'linux'), { folder: false, job: false }, 'Linux read the Windows task file');
  fs.mkdirSync(nodePath.dirname(create.plistPath(name)), { recursive: true });
  fs.writeFileSync(create.plistPath(name), '<plist/>');
  fs.mkdirSync(nodePath.dirname(linuxjob.unitPath(name)), { recursive: true });
  fs.writeFileSync(linuxjob.unitPath(name), '[Unit]\n');
  try {
    assert.deepEqual(create.nameHeld(name, 'darwin'), { folder: false, job: true }, 'CONTROL: macOS no longer reads its plist');
    assert.deepEqual(create.nameHeld(name, 'linux'), { folder: false, job: true }, 'CONTROL: Linux no longer reads its unit');
  } finally {
    fs.rmSync(create.plistPath(name), { force: true });
    fs.rmSync(linuxjob.unitPath(name), { force: true });
  }
});

test('kosmos#8466: on Windows nameHeld reads the Scheduled Task, so a leftover task holds its name until it is removed', onlyWin, () => {
  const name = leftoverTask('held8466');
  assert.deepEqual(create.nameHeld(name, 'win32'), { folder: false, job: true }, 'a registered task with no folder does not hold its name');
  fs.rmSync(jobfixture.jobPath(name), { force: true });
  assert.deepEqual(create.nameHeld(name, 'win32'), { folder: false, job: false }, 'a removed task still holds its name');
});

test('kosmos#8466: create refuses a listed leftover task with the row to use, and the row frees the name', onlyWin, () => {
  const name = leftoverTask('listed8466');
  const row = (leftover.settingsLeftovers({ platform: 'win32' }).names || []).find((x) => x.name === name);
  assert.deepEqual(row, { name, shownAs: name, startsAtLogin: true }, 'PREMISE: the row kosmos#8475 shows is not listed');
  const before = fs.readFileSync(win32job.taskFilePath(name), 'utf8');

  const refused = createNow(name);
  assert.equal(refused.outcome, create.OUTCOME.REFUSED, 'a name whose task is still registered was made again over it');
  assert.equal(refused.field, 'name');
  assert.equal(refused.because, rowWords(name, ONLY_LEFT));
  assert.equal(fs.readFileSync(win32job.taskFilePath(name), 'utf8'), before, 'the refused create changed the leftover task');
  // With a removed agent on the list the toggle reads otherwise, and the sentence quotes that label.
  made.push('gone8466');
  markRemoved('gone8466');
  assert.equal(createNow(name).because, rowWords(name, BOTH));
  fs.rmSync(REMOVED, { force: true });

  // The row's own delete: the task alone, the settings kept, as its words say.
  const p = leftover.plan(name, { platform: 'win32' });
  assert.equal(p.ok, true, p.because);
  assert.equal(p.taskOnly, true, 'PREMISE: the row does not remove the task alone');
  const out = leftover.del(name, { platform: 'win32' });
  assert.notEqual(out.outcome, leftover.OUTCOME.REFUSED, out.because);
  assert.equal(taskThere(name), false, 'the row removed nothing');
  assert.ok(fs.existsSync(store.profilePath(name)), 'the settings did not stay, though the sentence says they do');
  assert.deepEqual(create.nameHeld(name, 'win32'), { folder: false, job: false });

  const again = createNow(name);
  assert.equal(again.outcome, create.OUTCOME.CREATED, again.because || '');
  assert.ok(taskThere(name), 'the new agent has no task');
});

test('kosmos#8466: the sentence names the row as the row draws it, not as the name was typed', onlyWin, () => {
  const name = leftoverTask('rowname8466');
  store.writeProfile(name, { displayName: 'Row Name' });
  const row = (leftover.settingsLeftovers({ platform: 'win32' }).names || []).find((x) => x.name === name);
  assert.equal(row && row.shownAs, 'Row Name', 'PREMISE: the row does not draw the profile name');
  const r = createNow('ROWNAME8466');
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.match(r.because, /beside Row Name\. Its settings stay/, 'the sentence names a row the screen does not draw: ' + r.because);
});

test('kosmos#8466: where no row shows the task, the sentence names it in Task Scheduler, and that frees the name', onlyWin, () => {
  // No profile behind the task: never listed (a stray), so the screen has no row for it.
  const stray = leftoverTask('stray8466', { profile: false });
  assert.equal((leftover.settingsLeftovers({ platform: 'win32' }).names || []).some((x) => x.name === stray), false, 'PREMISE: the stray is listed');
  const r1 = createNow(stray);
  assert.equal(r1.outcome, create.OUTCOME.REFUSED, 'a stray task was overwritten');
  assert.equal(r1.because, schedulerWords(stray));
  // Doing what it says (the task deleted in Task Scheduler) frees the name.
  fs.rmSync(jobfixture.jobPath(stray), { force: true });
  assert.equal(createNow(stray).outcome, create.OUTCOME.CREATED);

  // Waiting to start (a world switch will start it): not listed, so the same words.
  const waiting = leftoverTask('waiting8466');
  fs.mkdirSync(nodePath.dirname(worldstarts.RECORD_FILE), { recursive: true });
  fs.writeFileSync(worldstarts.RECORD_FILE, JSON.stringify({ entries: [{ name: waiting, why: 'import' }] }));
  assert.equal(createNow(waiting).because, schedulerWords(waiting));
  fs.rmSync(worldstarts.RECORD_FILE, { force: true });

  // The whole workers folder missing: every agent reads like this, so nothing is listed and the same words are given.
  const away = leftoverTask('away8466');
  const kept = WORKERS + '-away';
  fs.renameSync(WORKERS, kept);
  try {
    assert.equal(createNow(away).because, schedulerWords(away));
  } finally { fs.rmSync(WORKERS, { recursive: true, force: true }); fs.renameSync(kept, WORKERS); }
  // CONTROL: with the workers folder back, the row is there and the sentence says so.
  assert.equal(createNow(away).because, rowWords(away, ONLY_LEFT));
});

test('kosmos#8466: a link that leads nowhere at the agent\'s folder is named, since deleting the task alone would not free the name', onlyWin, () => {
  const name = leftoverTask('link8466');
  const target = nodePath.join(SANDBOX, 'unplugged8466');
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(target, create.workerDir(name), 'junction');
  fs.rmSync(target, { recursive: true, force: true });
  try {
    assert.deepEqual(create.nameHeld(name, 'win32'), { folder: false, job: true }, 'PREMISE: the link reads as a folder');
    const dir = create.workerDir(name);
    const r = createNow(name);
    assert.equal(r.outcome, create.OUTCOME.REFUSED);
    assert.equal(r.because, `something called ${name} is still set to start on this computer, though its folder cannot be reached: ${dir} is a link that leads nowhere right now, perhaps to a disk or a shared folder that is not connected; if so, connecting it brings that agent back. Pick another name. If that agent is gone for good, you can free this name: delete the link at ${dir}, then open Task Scheduler, delete agent-${name} in the Kosmos folder of the Task Scheduler Library, then try again here.`);
    // Doing both things it says frees the name.
    fs.rmSync(dir, { recursive: false, force: true });
    fs.rmSync(jobfixture.jobPath(name), { force: true });
    assert.equal(createNow(name).outcome, create.OUTCOME.CREATED);
  } finally { try { fs.unlinkSync(create.workerDir(name)); } catch { /* gone or a folder now */ } }
});

test('kosmos#8466: a running agent whose folder is not found is said to be running, never sent to Task Scheduler', onlyWin, () => {
  const name = leftoverTask('running8466');
  status.setPaneSource(() => fleet.line({ session: name, title: 'idle' }));
  const r = createNow(name);
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.equal(r.because, `an agent called ${name} is running on this computer, though Kosmos cannot find its folder. Pick another name, or stop ${name} from its card under Agents and try this name again, and Kosmos will say how to free it.`);
  assert.ok(taskThere(name), 'the running agent lost its task');
});

test('kosmos#8466: the team step counts a seat whose name a leftover task holds as taken, and a free one as free', onlyWin, () => {
  const name = leftoverTask('seat8466');
  const team = {
    key: 'duo', kind: 'business', rank: 1, label: 'Duo', blurb: 'b', purpose: 'p',
    members: [
      { slot: 'lead', role: 'pm', title: 'Lead', name: 'L', reportsTo: null, avatar: {} },
      { slot: 'helper', role: 'pm', title: 'Helper', name: 'H', reportsTo: 'lead', avatar: {} },
    ],
  };
  const cat = { teams: () => [team], team: (k) => (k === 'duo' ? team : null), memberInstructions: () => 'brief' };
  const ask = () => teamseed.specs({ team: 'duo', names: { lead: 'free8466', helper: name }, checkTaken: true }, cat, { removed: () => false });
  const r = ask();
  assert.equal(r.ok, false, 'the seat was free though a leftover task holds its name');
  assert.equal(r.because, "the Helper's name: " + rowWords(name, ONLY_LEFT), "the seat was not given create's words for a leftover task");
  // Review 3: every taken seat in one answer, a real agent's and a leftover task's together.
  const lead = 'lead8466';
  made.push(lead);
  fs.mkdirSync(create.workerDir(lead), { recursive: true });
  const both = teamseed.specs({ team: 'duo', names: { lead, helper: name }, checkTaken: true }, cat, { removed: () => false });
  assert.equal(both.because, `there is already an agent called ${lead} on this computer; give the Lead another name. If you were making this team a moment ago, those agents are already on your board. The Helper's name: ` + rowWords(name, ONLY_LEFT),
    'the answer stopped at one taken seat');
  fs.rmSync(create.workerDir(lead), { recursive: true, force: true });
  // CONTROL: a seat held by an agent with its folder too is still said the generic way (it is an agent on the board).
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  assert.match(ask().because, new RegExp(`^there is already an agent called ${name} on this computer; give the Helper another name`));
  fs.rmSync(create.workerDir(name), { recursive: true, force: true });
  fs.rmSync(jobfixture.jobPath(name), { force: true });
  assert.equal(ask().ok, true, 'CONTROL: the seat stays taken with the task removed, so the refusal above proves nothing');
});

/* kosmos#8466: the setup guide's choice between its two names (setup-assistant.js seedSetupAssistant). With nameHeld
   reading the Scheduled Task, two of create's Windows sentences changed, so on win32 the seed decides by what holds
   the name: a leftover task with no folder moves on to the second name; a folder there stops, as main did. */
const setupAssistant = require('./setup-assistant');
const GUIDE = create.slugFor(setupAssistant.GUIDE_NAME);
const GUIDE2 = create.slugFor(setupAssistant.GUIDE_FALLBACK_NAME);
function seedNow(tried) {
  fs.rmSync(setupAssistant.flagPath(), { force: true });
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  jobfixture.useJobStore();
  try {
    return setupAssistant.seedSetupAssistant({
      createAgent: (o) => { tried.push(o.name); return create.createAgent({ ...BINS, name: o.name, role: o.role, createdBy: o.createdBy, purpose: o.purpose }); },
      hasConnectedAccount: () => true,
      avatarDir: nodePath.join(SANDBOX, 'avatars'),
    });
  } finally { create.setDryRun(true); create.setRunner(null); }
}

test('kosmos#8466: a leftover task with no folder under the guide\'s first name makes the guide take its second name', onlyWin, () => {
  leftoverTask(GUIDE);
  made.push(GUIDE2);
  const tried = [];
  const r = seedNow(tried);
  assert.deepEqual(tried, [setupAssistant.GUIDE_NAME, setupAssistant.GUIDE_FALLBACK_NAME], 'the guide did not move on to its second name');
  assert.equal(r.seeded, true, r.reason || '');
  assert.equal(r.name, GUIDE2);
  assert.ok(taskThere(GUIDE), 'the leftover task under the first name was overwritten');
});

test('kosmos#8466: a healthy guide under the first name with no seeded flag gets no second guide beside it', onlyWin, () => {
  made.push(GUIDE, GUIDE2);
  const tried = [];
  const first = seedNow(tried);
  assert.equal(first.name, GUIDE, 'PREMISE: the guide was not made under its first name');
  assert.ok(fs.existsSync(create.workerDir(GUIDE)) && taskThere(GUIDE), 'PREMISE: the guide is not whole (folder and task)');
  // Its seeded flag missing (a failed write, or the board died before it): the seed runs again.
  tried.length = 0;
  const again = seedNow(tried);
  assert.deepEqual(tried, [setupAssistant.GUIDE_NAME], 'a second guide was tried beside a healthy one');
  assert.equal(again.seeded, false);
  assert.ok(!fs.existsSync(create.workerDir(GUIDE2)), 'a second guide folder was made');
});

test('kosmos#8466: a removed guide name with only its task left makes nothing, as on main', onlyWin, () => {
  leftoverTask(GUIDE);
  made.push(GUIDE2);
  markRemoved(GUIDE);
  const tried = [];
  const r = seedNow(tried);
  assert.deepEqual(tried, [setupAssistant.GUIDE_NAME], 'a removed guide was made again under its second name');
  assert.equal(r.seeded, false);
  assert.ok(taskThere(GUIDE), 'the removed guide lost its task');
});

test('kosmos#8466: macOS and Linux keep main\'s rule: the sentence decides, whatever is on disk', () => {
  made.push(GUIDE);
  // On disk, what the Windows rule would act on: a folder under the first name, and (below) a leftover task.
  fs.mkdirSync(create.workerDir(GUIDE), { recursive: true });
  const taskFile = win32job.taskFilePath(GUIDE);
  fs.mkdirSync(nodePath.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, '<Task/>');
  const seedOn = (platform, because) => {
    fs.rmSync(setupAssistant.flagPath(), { force: true });
    const tried = [];
    const r = setupAssistant.seedSetupAssistant({
      platform,
      hasConnectedAccount: () => true,
      avatarDir: nodePath.join(SANDBOX, 'avatars'),
      createAgent: (o) => { tried.push(o.name); return o.name === setupAssistant.GUIDE_NAME ? { outcome: create.OUTCOME.REFUSED, because, field: 'name' } : { outcome: create.OUTCOME.CREATED, name: create.slugFor(o.name) }; },
    });
    return { tried, r };
  };
  const taken = `there is already an agent called ${setupAssistant.GUIDE_NAME}. If it never came up, it is half made rather than missing.`;
  const leftoverWords = `something called ${setupAssistant.GUIDE_NAME} is still set to start on this computer, though there is no folder for it.`;
  for (const platform of ['darwin', 'linux']) {
    assert.deepEqual(seedOn(platform, taken).tried, [setupAssistant.GUIDE_NAME, setupAssistant.GUIDE_FALLBACK_NAME], `${platform}: "already an agent called" no longer moves on`);
    assert.deepEqual(seedOn(platform, leftoverWords).tried, [setupAssistant.GUIDE_NAME], `${platform}: another refusal moved on`);
  }
  // CONTROL: the same refusal, with the folder there, stops on Windows (the rule above is what differs).
  assert.deepEqual(seedOn('win32', taken).tried, [setupAssistant.GUIDE_NAME], 'CONTROL: Windows did not apply its own rule, so the pin above proves nothing');
  fs.rmSync(taskFile, { force: true });
  fs.rmSync(setupAssistant.flagPath(), { force: true });
});
