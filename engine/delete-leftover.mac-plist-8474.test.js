'use strict';
/**
 * kosmos#8474: the macOS half of #8471. When a delete-leftover could not move an agent's auto-start file (its launchd
 * plist) to the Trash, it still trashed the folder, kept the settings and forgot the removal: a job file with no folder
 * that no row showed, so nobody could delete it from the screen.
 *
 * 1. A plist that will not move keeps the folder and every record, as a Linux unit and a Windows task do.
 * 2. settingsLeftovers lists a name whose profile is there, whose folder is gone and whose OWN plist is still on disk
 *    (never a name a login job merely covers), so the removed list draws a Delete for it.
 *
 * Sandboxed like delete-leftover.test.js, because this module MOVES OR DELETES FOLDERS. The plist is made unmovable by a
 * read-only LaunchAgents folder in the sandbox; launchctl is a stand-in behind this module's runner seam.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-8474-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'LaunchAgents', 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.on('exit', () => { try { fs.chmodSync(process.env.AGENT_WORKFORCE_LAUNCH, 0o755); } catch { /* gone */ } try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const store = require('./store');
const sendertoken = require('./sendertoken');
const leftover = require('./delete-leftover');

remove.setRunner(() => ({ ok: true, stdout: '' }));
leftover.setRunner(() => ({ ok: true, stdout: '' }));   // launchctl bootout: nothing real is touched
fs.mkdirSync(process.env.AGENT_WORKFORCE_TRASH, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });

const SKIP = process.getuid && process.getuid() === 0 ? 'a read-only folder does not stop root' : false;
const mac = {
  plan: (name) => leftover.plan(name, { platform: 'darwin' }),
  del: (name) => leftover.del(name, { platform: 'darwin', typed: name }),
};
const REMOVED = nodePath.join(store.ROOT, 'removed.json');
function markRemoved(name) {
  fs.mkdirSync(nodePath.dirname(REMOVED), { recursive: true });
  fs.writeFileSync(REMOVED, JSON.stringify([{ name, shownAs: name, removedAt: new Date().toISOString(), stopped: true }]));
}
const removedNow = () => remove.removedNames().names;
const made = [];
function agent(name, { folder = true, plist = true } = {}) {
  made.push(name);
  store.writeProfile(name, { displayName: name });
  if (folder) {
    const dir = create.workerDir(name);
    fs.mkdirSync(nodePath.join(dir, 'notes'), { recursive: true });
    fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'), 'work\n');
  }
  if (plist) fs.writeFileSync(create.plistPath(name), '<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>' + create.serviceLabel(name) + '</string></dict></plist>\n');
  return name;
}
const lock = () => fs.chmodSync(process.env.AGENT_WORKFORCE_LAUNCH, 0o555);   // nothing in it can be moved out
const unlock = () => fs.chmodSync(process.env.AGENT_WORKFORCE_LAUNCH, 0o755);

test.beforeEach(() => { status.setPaneSource(() => ''); unlock(); fs.rmSync(REMOVED, { force: true }); });
test.afterEach(() => {
  unlock();
  status.setPaneSource(null);
  for (const n of made.splice(0)) {
    fs.rmSync(store.profilePath(n), { force: true });
    fs.rmSync(create.workerDir(n), { recursive: true, force: true });
    fs.rmSync(create.plistPath(n), { force: true });
  }
});

test('kosmos#8474 part 1: a plist that will not go to the Trash keeps the folder, the settings and the removal', { skip: SKIP }, () => {
  const name = agent('stuck8474');
  markRemoved(name);
  sendertoken.mint(name);
  const p = mac.plan(name);
  assert.equal(p.ok, true, p.because);
  assert.ok(p.folder && p.job && !p.job.task && !p.job.unit, 'the plan did not see both the folder and the plist');
  lock();
  const done = mac.del(name);
  unlock();
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(done));
  assert.equal(fs.existsSync(create.plistPath(name)), true, 'CONTROL: the plist did move, so this shows nothing');
  assert.equal(fs.existsSync(create.workerDir(name)), true, 'the folder went while its plist still holds the name');
  assert.equal(fs.existsSync(store.profilePath(name)), true, 'its settings went');
  assert.ok(removedNow().includes(name), 'the removal was forgotten, so nothing on screen reaches the agent again');
  assert.equal(sendertoken.holdsTokens(name), true, 'its sender tokens were revoked although nothing was deleted');
  assert.equal(done.because, `stuck8474's auto-start file could not be moved to the Trash, so its folder was kept too. The name stays taken; try again in a moment, and if it keeps failing, move ${create.plistPath(name)} to the Trash yourself. Its standing in the community was reset, so if it comes back it starts at the beginning.`);
  assert.deepEqual(done.steps.find((s) => s.step === 'its folder'), { step: 'its folder', ok: false, because: 'kept, because its startup job could not be removed' });
  // The retry, once the plist can move: everything goes, and the name is free.
  const again = mac.del(name);
  assert.equal(again.outcome, leftover.OUTCOME.DELETED, JSON.stringify(again));
  assert.equal(fs.existsSync(create.plistPath(name)), false);
  assert.equal(fs.existsSync(create.workerDir(name)), false);
  assert.ok(!removedNow().includes(name));
});

test('kosmos#8474 part 1: with no folder, a plist that will not go keeps the settings and the removal too', { skip: SKIP }, () => {
  const name = agent('nofold8474', { folder: false });
  markRemoved(name);
  lock();
  const done = mac.del(name);
  unlock();
  assert.equal(done.outcome, leftover.OUTCOME.REFUSED, JSON.stringify(done));
  assert.match(done.because, /^nofold8474's auto-start file could not be moved to the Trash\. The name stays taken;/);
  assert.equal(fs.existsSync(store.profilePath(name)), true, 'its settings went');
  assert.ok(removedNow().includes(name), 'the removal was forgotten');
});

test('kosmos#8474 part 1 CONTROL: a plist that goes still sends the folder to the Trash, as before', () => {
  const name = agent('fine8474');
  const done = mac.del(name);
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
  assert.equal(fs.existsSync(create.workerDir(name)), false);
  assert.equal(fs.existsSync(create.plistPath(name)), false);
});

test('kosmos#8474 part 2: the removed list lists an agent with settings, no folder and its own plist, never one a login job covers', () => {
  const lone = agent('plist8474', { folder: false });
  const covered = agent('covered8474', { folder: false, plist: false });   // job true from a login job, no plist of its own
  const plain = agent('plain8474', { folder: false, plist: false });
  const survey = { ok: true, agents: [
    { name: lone, shownAs: lone, profile: true, folder: false, job: true, removed: false },
    { name: covered, shownAs: covered, profile: true, folder: false, job: true, removed: false },
    { name: plain, shownAs: plain, profile: true, folder: false, job: false, removed: false },
  ] };
  const r = leftover.settingsLeftovers({ platform: 'darwin', survey });
  assert.equal(r.ok, true);
  assert.deepEqual(r.names.find((x) => x.name === lone), { name: lone, shownAs: lone, startsAtLogin: true }, JSON.stringify(r.names));
  assert.ok(!r.names.some((x) => x.name === covered), 'a name only a login job covers was offered for deletion');
  assert.deepEqual(r.names.find((x) => x.name === plain), { name: plain, shownAs: plain }, 'CONTROL: settings only, as before');
  // Linux is unchanged: a job there is never listed.
  const lx = leftover.settingsLeftovers({ platform: 'linux', survey });
  assert.ok(!lx.names.some((x) => x.name === lone), 'Linux started listing jobs');
});
