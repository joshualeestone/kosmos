'use strict';
/**
 * kosmos#8484: a setup guide Kosmos already made is adopted, never made a second time.
 *
 * The seeded flag was the only thing that said a guide exists. With it missing (its write failed, or the board
 * stopped between the create and the write), the seed found "Josh" taken and made "Josh AI" beside it. These pin:
 * - a healthy guide (marker, startup job) with no flag is adopted and no create is asked;
 * - a guide whose marker was never written is recognised by its NEWEST birth line, if that line is the guide's and its
 *   id matches the profile; then the marker is written;
 * - a person's own later agent under the name, or a line whose id does not match, adopts nothing;
 * - a guide with no startup job gets no flag and no second guide;
 * - a guide under the fallback name is found too.
 * The job is asked through a seam (create.jobPresence is the platform's own look), so every arm runs on every platform.
 *
 *   node --test engine/setup-assistant.adopt-8484.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-guide-adopt-8484-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
// Dry run (read when create loads): the real create in part 3's tests must never write an agent.
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/nonexistent/claude';
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const sa = require('./setup-assistant');
const create = require('./create');
const store = require('./store');
const instructions = require('./instructions');
const { skipOnWin32 } = require('../test-support/skip-on-win32');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const CONNECTED = () => true;
/* As create answers: a name whose folder is already there is refused as taken (the sentence ensureGuide matches). */
const created = (calls) => (opts) => {
  calls.push(opts.name);
  const slug = create.slugFor(opts.name);
  if (fs.existsSync(path.dirname(instructions.fileFor(slug)))) return { outcome: create.OUTCOME.REFUSED, because: `there is already an agent called ${slug}.` };
  return { outcome: create.OUTCOME.CREATED, name: slug };
};
const guideBirth = (slug, id, extra = {}) => ({ at: new Date().toISOString(), name: slug, slug, role: sa.SETUP_ROLE_KEY,
  createdBy: sa.GUIDE_CREATED_BY, purpose: 'default Kosmos setup guide, AI (auto-created when a model was connected)',
  outcome: create.OUTCOME.CREATED, id, ...extra });
const ownBirth = (slug, id) => ({ at: new Date().toISOString(), name: slug, slug, role: 'general', createdBy: null, purpose: null,
  outcome: create.OUTCOME.CREATED, id });

/* An agent folder and profile under `shown`; marked as the guide when asked. Returns { slug, dir, id }. */
function agent(shown, { marked = false } = {}) {
  const slug = create.slugFor(shown);
  const dir = path.dirname(instructions.fileFor(slug));
  assert.ok(dir.startsWith(SANDBOX + path.sep), `the folder resolved outside the sandbox: ${dir}`);
  fs.mkdirSync(dir, { recursive: true });
  store.writeProfile(slug, { displayName: shown });
  if (marked) fs.writeFileSync(path.join(dir, sa.GUIDE_MARKER), `${slug}\n`);
  return { slug, dir, id: store.readProfile(slug).id };
}
function clean() {
  fs.rmSync(sa.flagPath(), { force: true });
  fs.rmSync(path.join(store.ROOT, 'removed.json'), { force: true });   // the removed list (engine/remove.js REMOVED_FILENAME)
  for (const shown of [sa.GUIDE_NAME, sa.GUIDE_FALLBACK_NAME]) {
    const slug = create.slugFor(shown);
    fs.rmSync(path.dirname(instructions.fileFor(slug)), { recursive: true, force: true });
    fs.rmSync(store.profilePath(slug), { force: true });
  }
  sa.resetEnsureGuideForTests();
}
test.beforeEach(clean);

const seed = (createAgent, deps) => sa.seedSetupAssistant({ createAgent, hasConnectedAccount: CONNECTED, deps });

test('kosmos#8484: a healthy guide with no seeded flag is adopted, and no second guide is made', () => {
  const g = agent(sa.GUIDE_NAME, { marked: true });
  const calls = [];
  const r = seed(created(calls), { jobPresence: () => 'yes', birthLog: () => [] });
  assert.equal(r.seeded, true, r.reason || '');
  assert.equal(r.adopted, true);
  assert.equal(r.name, g.slug);
  assert.deepEqual(calls, [], 'a create was asked beside a guide that is already there');
  // CONTROL: with no guide there, the same call creates one.
  clean();
  const made = [];
  const c = seed(created(made), { jobPresence: () => 'yes', birthLog: () => [] });
  assert.equal(c.seeded, true);
  assert.equal(c.adopted, undefined);
  assert.deepEqual(made, [sa.GUIDE_NAME], 'CONTROL: no guide on disk did not create one');
});

test('kosmos#8484: ensureGuide writes the flag for an adopted guide, naming it and no provider', async () => {
  const g = agent(sa.GUIDE_NAME, { marked: true });
  fs.writeFileSync(sa.armPath(), '{}\n');
  try {
    const calls = [];
    const deps = { enabled: true, settings: {}, listFor: (mod) => (mod === './accounts' ? [{ dir: '/h/.claude', isDefault: true }] : []),
      connectable: async () => ({ ok: true }), liveDefault: async () => true, jobPresence: () => 'yes', birthLog: () => [] };
    const r = await sa.ensureGuide({ createAgent: created(calls), deps });
    assert.equal(r.seeded, true, r.reason || '');
    assert.deepEqual(calls, []);
    const rec = JSON.parse(fs.readFileSync(sa.flagPath(), 'utf8'));
    assert.equal(rec.name, g.slug);
    assert.equal(rec.adopted, true);
    assert.equal('provider' in rec, false, 'an adopted guide was recorded as running on the model that happened to be listed');
    assert.equal(sa.guideName(), g.slug);
  } finally { fs.rmSync(sa.armPath(), { force: true }); }
});

test('kosmos#8484: ensureGuide adopts before any live model check, and re-applies the guide\'s guards', async () => {
  const g = agent(sa.GUIDE_NAME, { marked: true });
  const guard = path.join(g.dir, '.claude', 'settings.json');
  assert.equal(fs.existsSync(guard), false, 'fixture: the guards are already there');
  fs.writeFileSync(sa.armPath(), '{}\n');
  try {
    let checks = 0;
    const deps = { enabled: true, settings: {}, jobPresence: () => 'yes', birthLog: () => [],
      listFor: (mod) => (mod === './accounts' ? [{ dir: '/h/.claude', isDefault: true }] : []),
      connectable: async () => { checks += 1; return { ok: false }; }, liveDefault: async () => false };
    const r = await sa.ensureGuide({ createAgent: created([]), deps });
    assert.equal(r.seeded, true, r.reason || '');
    assert.equal(checks, 0, 'adopting a guide already on disk paid for a live model check');
    assert.equal(fs.existsSync(guard), true, 'an adopted guide was left without its guards (a board can stop before they are written)');
  } finally { fs.rmSync(sa.armPath(), { force: true }); }
});

test('kosmos#8484: a guide whose job could not be looked at is not adopted, not replaced, and not called broken', async () => {
  agent(sa.GUIDE_NAME, { marked: true });
  for (const look of [() => 'unknown', () => { throw new Error('unreadable'); }]) {
    const calls = [];
    const r = seed(created(calls), { jobPresence: look, birthLog: () => [] });
    assert.equal(r.seeded, false);
    assert.equal('because' in r, false, 'a guide that may be working was given "delete what was left of it" advice');
    assert.deepEqual(calls, [], 'a second guide was made beside one whose job could not be checked');
    assert.equal(sa.setupAssistantSeeded(), false);
  }
  // Through ensureGuide it is 'unclear', which the page words as "could not tell whether a Kosmos Guide is already here".
  fs.writeFileSync(sa.armPath(), '{}\n');
  try {
    const deps = { enabled: true, settings: {}, jobPresence: () => 'unknown', birthLog: () => [],
      listFor: (mod) => (mod === './accounts' ? [{ dir: '/h/.claude', isDefault: true }] : []), connectable: async () => ({ ok: true }), liveDefault: async () => true };
    const e = await sa.ensureGuide({ createAgent: created([]), deps });
    assert.equal(e.state, 'unclear');
    assert.equal('because' in e, false);
  } finally { fs.rmSync(sa.armPath(), { force: true }); }
});

test('kosmos#8484: a guide the person removed is not adopted as here, and none is made beside it', async () => {
  const remove = require('./remove');
  const g = agent(sa.GUIDE_NAME, { marked: true });
  remove.setRunner(() => ({ ok: true, stdout: '' }));
  require('./status').setPaneSource(() => '');
  let rec;
  try { rec = remove.remove(g.slug); } finally { remove.setRunner(null); }
  assert.notEqual(rec.outcome, remove.OUTCOME.REFUSED, rec.because);
  fs.writeFileSync(sa.armPath(), '{}\n');
  try {
    assert.equal(remove.isRemoved(g.slug), true, 'fixture: not on the removed list');
    const calls = [];
    const deps = { enabled: true, settings: {}, jobPresence: () => 'yes', birthLog: () => [],
      listFor: (mod) => (mod === './accounts' ? [{ dir: '/h/.claude', isDefault: true }] : []), connectable: async () => ({ ok: true }), liveDefault: async () => true };
    const e = await sa.ensureGuide({ createAgent: created(calls), deps });
    assert.equal(e.seeded, false, 'a removed guide was reported as set up');
    assert.equal(e.because, 'Your Kosmos Guide, Josh, is on your removed list, so Kosmos did not make another. Put it back from "Show removed agents" at the bottom of the Agents tab.');
    assert.equal(sa.setupAssistantSeeded(), false);
    assert.deepEqual(calls, [], 'a second guide was made beside a removed one');
  } finally { fs.rmSync(sa.armPath(), { force: true }); }
});

test('kosmos#8484: a guide whose marker was never written is recognised by its newest birth line, and the marker is written', () => {
  const g = agent(sa.GUIDE_NAME);
  assert.equal(sa.isGuideFolder(g.slug), false, 'fixture: the marker is already there');
  const calls = [];
  const r = seed(created(calls), { jobPresence: () => 'yes', birthLog: () => [guideBirth(g.slug, g.id)] });
  assert.equal(r.seeded, true, r.reason || '');
  assert.equal(r.adopted, true);
  assert.deepEqual(calls, []);
  assert.equal(sa.isGuideFolder(g.slug), true, 'the adopted guide was left without its marker');
});

test('kosmos#8484: only the newest birth line counts, so a person\'s own later agent under the name stays theirs', () => {
  const g = agent(sa.GUIDE_NAME);
  const calls = [];
  const lines = [guideBirth(g.slug, 'old-guide-id'), ownBirth(g.slug, g.id)];
  const r = seed(created(calls), { jobPresence: () => 'yes', birthLog: () => lines });
  assert.equal(r.adopted, undefined, 'the person\'s own Josh was adopted as the guide');
  assert.equal(sa.isGuideFolder(g.slug), false, 'the person\'s own folder was marked as the guide');
  assert.deepEqual(calls, [sa.GUIDE_NAME, sa.GUIDE_FALLBACK_NAME], 'the seed did not go on to the create, which refuses the held name and moves to the fallback');
  // A refused line after the guide's does not hide it: nothing was made by a refusal.
  clean();
  const g2 = agent(sa.GUIDE_NAME);
  const refusedLater = { ...ownBirth(g2.slug, null), outcome: create.OUTCOME.REFUSED };
  const r2 = seed(created([]), { jobPresence: () => 'yes', birthLog: () => [guideBirth(g2.slug, g2.id), refusedLater] });
  assert.equal(r2.adopted, true, 'a refused create after the guide hid the guide');
});

test('kosmos#8484: a birth line whose id is not the profile\'s adopts nothing (a torn line or a reused folder)', () => {
  const g = agent(sa.GUIDE_NAME);
  for (const [why, line] of [['another id', guideBirth(g.slug, 'not-this-agent')], ['no id', guideBirth(g.slug, null)],
    ['partial, which carries no id', guideBirth(g.slug, null, { outcome: create.OUTCOME.PARTIAL })]]) {
    const calls = [];
    const r = seed(created(calls), { jobPresence: () => 'yes', birthLog: () => [line] });
    assert.equal(r.adopted, undefined, `${why}: adopted`);
    assert.equal(sa.isGuideFolder(g.slug), false, `${why}: marked`);
    fs.rmSync(sa.flagPath(), { force: true });
  }
  // CONTROL: the same line with the profile's id adopts.
  assert.equal(seed(created([]), { jobPresence: () => 'yes', birthLog: () => [guideBirth(g.slug, g.id)] }).adopted, true);
});

test('kosmos#8484: a guide whose job is PROVEN gone gets no flag and no second guide, and ensureGuide pays no live check', async () => {
  agent(sa.GUIDE_NAME, { marked: true });
  const calls = [];
  const r = seed(created(calls), { jobPresence: () => 'no', birthLog: () => [] });
  assert.equal(r.seeded, false);
  assert.match(r.reason, /has no startup job, so it cannot run/);
  assert.deepEqual(calls, [], 'a second guide was made beside one with no job');
  assert.equal(sa.setupAssistantSeeded(), false);

  fs.writeFileSync(sa.armPath(), '{}\n');
  try {
    let checks = 0;
    const deps = { enabled: true, settings: {}, jobPresence: () => 'no', birthLog: () => [],
      listFor: (mod) => ({ './accounts': [{ dir: '/h/.claude', isDefault: true }], './openaiaccounts': [{ dir: '/h/.codex', isDefault: false }] }[mod] || []),
      connectable: async () => { checks += 1; return { ok: true }; }, liveDefault: async () => true };
    const e = await sa.ensureGuide({ createAgent: created(calls), deps });
    assert.equal(e.seeded, false);
    assert.equal(e.state, 'refused');
    assert.match(e.because || '', /^Your Kosmos Guide, Josh, is on this computer but is not set to start, so Kosmos did not make another\./);
    assert.equal(checks, 0, 'a guide already on disk waited behind a live model check');
    assert.equal(sa.setupAssistantSeeded(), false, 'the flag was written for a guide that cannot run');
    assert.deepEqual(calls, []);
  } finally { fs.rmSync(sa.armPath(), { force: true }); }
});

test('kosmos#8484: a guide under the fallback name is found before any create', () => {
  agent(sa.GUIDE_NAME);   // the person's own Josh: no marker, no guide birth
  const g = agent(sa.GUIDE_FALLBACK_NAME, { marked: true });
  const calls = [];
  const r = seed(created(calls), { jobPresence: () => 'yes', birthLog: () => [] });
  assert.equal(r.adopted, true, r.reason || '');
  assert.equal(r.name, g.slug);
  assert.deepEqual(calls, [], 'a create was asked while the guide stood under the fallback name');
});

test('kosmos#8484: no folder under the name is not a guide', () => {
  assert.equal(sa.existingGuide(sa.GUIDE_NAME, { jobPresence: () => 'yes', birthLog: () => [] }), null);
  const g = agent(sa.GUIDE_NAME, { marked: true });
  assert.deepEqual(sa.existingGuide(sa.GUIDE_NAME, { jobPresence: () => 'yes', birthLog: () => [] }), { name: g.slug, job: 'yes', byBirth: false }, 'CONTROL');
});

/* Part 3: a guide name held by a leftover. These use create's REAL refusal (dry run, nothing is written), so a change
   to create's wording that the page sentence depends on turns them red rather than passing on a copied string. */
const realCreate = (calls) => (opts) => { calls.push(opts.name); return create.createAgent(opts); };

test('kosmos#8484: a guide name held by a leftover folder says how to free it, never "try again", and asks no other model', async () => {
  const slug = create.slugFor(sa.GUIDE_NAME);
  fs.mkdirSync(create.workerDir(slug), { recursive: true });   // a folder with no marker, no profile and no birth line
  try {
    const calls = [];
    const r = seed(realCreate(calls), { jobPresence: () => 'no', birthLog: () => [] });
    assert.equal(r.seeded, false);
    assert.deepEqual(calls, [sa.GUIDE_NAME], 'a leftover folder moved the seed on to the fallback name (behaviour this card leaves alone)');
    assert.match(r.because || '', /^Kosmos did not set up the Kosmos Guide, because the name Josh is in use\. There is already a folder for an agent called Josh\./);
    assert.match(r.because, /To free the name, delete what was left of it, from its page under Agents or from "Show removed agents" at the bottom of the Agents tab\. Then choose Set it up now\.$/);
    assert.doesNotMatch(r.because, /Pick another name|try again in a moment|which frees the name|\u2014/i);
    fs.writeFileSync(sa.armPath(), '{}\n');
    let checks = 0;
    const deps = { enabled: true, settings: {}, jobPresence: () => 'no', birthLog: () => [],
      listFor: (mod) => ({ './accounts': [{ dir: '/h/.claude', isDefault: true }], './openaiaccounts': [{ dir: '/h/.codex', isDefault: false }] }[mod] || []),
      connectable: async () => { checks += 1; return { ok: true }; }, liveDefault: async () => true };
    const e = await sa.ensureGuide({ createAgent: realCreate([]), deps, explicit: true });
    assert.equal(e.state, 'refused');
    assert.equal(e.because, r.because, 'ensureGuide dropped the sentence');
    assert.equal(checks, 1, 'a held name went on to live-check the next model');
  } finally { fs.rmSync(create.workerDir(slug), { recursive: true, force: true }); fs.rmSync(sa.armPath(), { force: true }); }
});

test('kosmos#8484: a guide name held by a job with no folder says so in create\'s own platform words', { skip: skipOnWin32('what it checks exists on Windows (a startup job with no folder is a Scheduled Task there), but this arm writes a plist or a systemd unit; the Windows sentences are pinned in this file through the platform seam of seedSetupAssistant, and running this arm against a real Scheduled Task is owed on kosmos#8484') }, () => {
  const slug = create.slugFor(sa.GUIDE_NAME);
  const job = process.platform === 'linux' ? require('./linuxjob').unitPath(slug) : create.plistPath(slug);
  fs.mkdirSync(path.dirname(job), { recursive: true });
  fs.writeFileSync(job, process.platform === 'linux' ? '[Unit]\n' : '<plist/>');
  try {
    const r = seed(realCreate([]), { jobPresence: () => 'yes', birthLog: () => [] });
    assert.match(r.because || '', /^Kosmos did not set up the Kosmos Guide, because the name Josh is in use\. Something called Josh is still set to start on this computer, though there is no folder for it\. To free the name, /);
    assert.match(r.because, / Then choose Set it up now\.$/);
    assert.doesNotMatch(r.because, /Pick another name/);
  } finally { fs.rmSync(job, { force: true }); }
});

test('kosmos#8484: any other refusal keeps its old wording (no sentence), so the page still says what it said', () => {
  const r = seed(refusedWith('we could not find Claude Code on this computer'), { jobPresence: () => 'yes', birthLog: () => [] });
  assert.equal(r.seeded, false);
  assert.equal('because' in r, false, 'a refusal that clears by itself was given a "free the name" sentence');
  assert.equal(sa.heldSentenceForTests('Josh', 'there is already an agent called Josh.'), null, 'CONTROL: a real agent holding the name is names-taken, not this');
  // create's other "still set to start" refusal ends "Pick another name for now", which no rewrite here can fix.
  assert.equal(sa.heldSentenceForTests('Josh', 'something called Josh is still set to start on this computer from a leftover file, and removing it did not work. Pick another name for now.'), null,
    'a refusal that only offers another name was turned into a guide sentence that still tells the person to pick a name');
});
function refusedWith(because) { return () => ({ outcome: create.OUTCOME.REFUSED, because }); }

test('kosmos#8484: a guide name on the removed list says the one way to free it (putting it back keeps the name taken)', () => {
  const remove = require('./remove');
  const g = agent(sa.GUIDE_NAME);   // the person's own Josh, then removed (a plain remove deletes nothing on disk)
  remove.setRunner(() => ({ ok: true, stdout: '' }));   // a stand-in launchctl, so the removal is recorded (dry run records nothing)
  require('./status').setPaneSource(() => '');
  let rec;
  try { rec = remove.remove(g.slug); } finally { remove.setRunner(null); }
  assert.notEqual(rec.outcome, remove.OUTCOME.REFUSED, rec.because);
  try {
    assert.equal(remove.isRemoved(g.slug), true, 'fixture: not on the removed list');
    const r = seed(realCreate([]), { jobPresence: () => 'no', birthLog: () => [] });
    assert.equal(r.seeded, false);
    assert.equal(r.because, 'Kosmos did not set up the Kosmos Guide, because the name Josh is in use. Josh is on your removed list. To free the name, delete what was left of it from "Show removed agents" at the bottom of the Agents tab. Then choose Set it up now.', r.reason);
  } finally { /* clean() empties the removed list */ }
});

test('kosmos#8484: the Linux job-only refusal (a command, not a page) reads as one instruction', () => {
  const linux = "something called Josh is still set to start on this computer, though there is no folder for it. Pick another name, or free it with: systemctl --user disable --now 'kosmos-josh.service' and then delete '/h/kosmos-josh.service'.";
  assert.equal(sa.heldSentenceForTests('Josh', linux),
    "Kosmos did not set up the Kosmos Guide, because the name Josh is in use. Something called Josh is still set to start on this computer, though there is no folder for it. To free the name, run: systemctl --user disable --now 'kosmos-josh.service' and then delete '/h/kosmos-josh.service'. Then choose Set it up now.");
});

test('kosmos#8484: a healthy guide under one name is adopted even when the other name holds a broken one', () => {
  const josh = agent(sa.GUIDE_NAME, { marked: true });           // the first guide, its job gone
  const joshAi = agent(sa.GUIDE_FALLBACK_NAME, { marked: true }); // the duplicate, running
  const calls = [];
  const r = seed(created(calls), { jobPresence: (n) => (n === joshAi.slug ? 'yes' : 'no'), birthLog: () => [] });
  assert.equal(r.adopted, true, r.reason || '');
  assert.equal(r.name, joshAi.slug, 'the broken guide under the first name hid the working one');
  assert.equal('because' in r, false, 'the person was told to clean up while a working guide was there');
  assert.deepEqual(calls, []);
  // CONTROL: with neither running, the first name's answer is given.
  const c = seed(created([]), { jobPresence: () => 'no', birthLog: () => [] });
  assert.match(c.because || '', new RegExp('^Your Kosmos Guide, ' + sa.GUIDE_NAME + ', is on this computer but is not set to start'));
  assert.ok(josh.slug);
});

test('kosmos#8484: a removed list that cannot be read is not known, so no "put it back" advice and nothing made', () => {
  agent(sa.GUIDE_NAME, { marked: true });
  fs.writeFileSync(path.join(store.ROOT, 'removed.json'), '{not json');
  const calls = [];
  const r = seed(created(calls), { jobPresence: () => 'yes', birthLog: () => [] });
  assert.equal(r.seeded, false, 'a guide was adopted while the removed list could not be read');
  assert.equal(r.state, 'unclear');
  assert.equal('because' in r, false, 'the person was told to put back a guide that may not be removed');
  assert.deepEqual(calls, []);
  assert.equal(require('./remove').removedNames().ok, false, 'CONTROL: the list really is unreadable');
});

/* Since #8466, on Windows a leftover Scheduled Task with no folder holds a name and the seed moves past it. These use
   the seed's `platform` seam and create's real Windows words (create.win32HeldTaskWords), so they run on any host. */
const win32job = require('./win32job');
function win32Seed(createAgent) {
  return sa.seedSetupAssistant({ platform: 'win32', createAgent, hasConnectedAccount: CONNECTED, deps: { jobPresence: () => 'no', birthLog: () => [] } });
}
const noRow = () => ({ ok: true, names: [] });   // no removed-list row for it, so the words name Task Scheduler

test('kosmos#8484: on Windows, a leftover task under the first name and a real agent under the second is not "two of your agents"', () => {
  const slug = create.slugFor(sa.GUIDE_NAME);
  const task = win32job.taskFilePath(slug);
  fs.mkdirSync(path.dirname(task), { recursive: true });
  fs.writeFileSync(task, '<Task/>');   // the leftover: a task, no folder
  try {
    const words = create.win32HeldTaskWords(slug, sa.GUIDE_NAME, noRow);
    const tried = [];
    const r = win32Seed((o) => { tried.push(o.name); return { outcome: create.OUTCOME.REFUSED,
      because: o.name === sa.GUIDE_NAME ? words : `there is already an agent called ${sa.GUIDE_FALLBACK_NAME}. If it never came up, it is half made rather than missing.` }; });
    assert.deepEqual(tried, [sa.GUIDE_NAME, sa.GUIDE_FALLBACK_NAME], 'PREMISE: #8466 moves past a leftover task');
    assert.equal(r.namesTaken, undefined, 'a leftover task was counted as one of "two of your agents"');
    assert.match(r.because || '', /^Kosmos did not set up the Kosmos Guide, because the name Josh is in use\. Something called Josh is still set to start on this computer, though Kosmos cannot find a folder for it\. If that agent is gone for good, you can free the name: open Task Scheduler, delete .* folder of the Task Scheduler Library\. Then choose Set it up now\.$/, r.because);
    assert.doesNotMatch(r.because, /Pick another name|try again here/);
  } finally { fs.rmSync(task, { force: true }); }
});

test('kosmos#8484: two real agents holding both names is still names-taken; one real agent stopping the loop is not', async () => {
  const agentWords = (n) => `there is already an agent called ${n}. If it never came up, it is half made rather than missing.`;
  const both = sa.seedSetupAssistant({ platform: 'darwin', hasConnectedAccount: CONNECTED, deps: { jobPresence: () => 'no', birthLog: () => [] },
    createAgent: (o) => ({ outcome: create.OUTCOME.REFUSED, because: agentWords(o.name) }) });
  assert.equal(both.namesTaken, true, 'CONTROL: two real agents are names-taken');
  // Windows since #8466: a real Josh (a folder there) stops at the first name, so only one name was refused.
  const slug = create.slugFor(sa.GUIDE_NAME);
  fs.mkdirSync(create.workerDir(slug), { recursive: true });
  const tried = [];
  const one = win32Seed((o) => { tried.push(o.name); return { outcome: create.OUTCOME.REFUSED, because: agentWords(o.name) }; });
  assert.deepEqual(tried, [sa.GUIDE_NAME], 'PREMISE: a folder under the first name stops the loop on Windows');
  assert.equal(one.namesTaken, undefined, 'one refused name was reported as "two of your agents"');
  assert.equal(one.heldByAgent, true);
});

test('kosmos#8484: the Windows "free this one" form (a removed-list row for the task) reads as one instruction', () => {
  const s = sa.heldSentenceForTests('Josh', 'something called Josh is still set to start on this computer, though Kosmos cannot find a folder for it. Pick another name, or free this one: at the bottom of the Agents tab, press "Show what is left of past agents", then press "Remove its startup job…" beside Josh. Its settings stay on this computer.');
  assert.equal(s, 'Kosmos did not set up the Kosmos Guide, because the name Josh is in use. Something called Josh is still set to start on this computer, though Kosmos cannot find a folder for it. To free the name: at the bottom of the Agents tab, press "Show what is left of past agents", then press "Remove its startup job…" beside Josh. Its settings stay on this computer. Then choose Set it up now.');
  // A running agent with no folder is a real agent, not a leftover: it keeps its old wording.
  assert.equal(sa.heldSentenceForTests('Josh', 'an agent called Josh is running on this computer, though Kosmos cannot find its folder. Pick another name, or stop Josh from its card under Agents and try this name again, and Kosmos will say how to free it.'), null);
});

test('kosmos#8484: on Windows, one real agent called Josh says so and is held for the process (no paid retries)', async () => {
  const agentWords = (n) => `there is already an agent called ${n}. If it never came up, it is half made rather than missing.`;
  const slug = create.slugFor(sa.GUIDE_NAME);
  fs.mkdirSync(create.workerDir(slug), { recursive: true });   // a folder there: #8466 stops at the first name on Windows
  const r = win32Seed(() => ({ outcome: create.OUTCOME.REFUSED, because: agentWords(sa.GUIDE_NAME) }));
  assert.equal(r.heldByAgent, true);
  assert.equal(r.because, 'Kosmos did not set up the Kosmos Guide, because one of your agents is already called Josh. Rename it, restart Kosmos, then choose Set it up now.');
  fs.writeFileSync(sa.armPath(), '{}\n');
  try {
    let checks = 0;
    const calls = [];
    const deps = { enabled: true, settings: {}, platform: 'win32', jobPresence: () => 'no', birthLog: () => [],
      listFor: (mod) => (mod === './accounts' ? [{ dir: '/h/.claude', isDefault: true }] : []),
      connectable: async () => { checks += 1; return { ok: true }; }, liveDefault: async () => true };
    const createAgent = (o) => { calls.push(o.name); return { outcome: create.OUTCOME.REFUSED, because: agentWords(o.name) }; };
    const e1 = await sa.ensureGuide({ createAgent, deps });
    assert.equal(e1.because, r.because);
    const e2 = await sa.ensureGuide({ createAgent, deps, now: Date.now() + 10 * sa.RETRY_MAX_MS, explicit: true });
    assert.equal(e2.because, r.because, 'the second try lost the sentence');
    assert.equal(e2.state, 'refused');
    assert.equal(checks, 1, 'a name a real agent holds was live-checked again (a paid call each hour)');
    assert.deepEqual(calls, [sa.GUIDE_NAME], 'the create was tried again');
  } finally { fs.rmSync(sa.armPath(), { force: true }); }
  // CONTROL: on a Mac the same refusal moves on, so this answer never applies there.
  const mac = sa.seedSetupAssistant({ platform: 'darwin', hasConnectedAccount: CONNECTED, deps: { jobPresence: () => 'no', birthLog: () => [] },
    createAgent: (o) => ({ outcome: o.name === sa.GUIDE_NAME ? create.OUTCOME.REFUSED : create.OUTCOME.CREATED, because: agentWords(o.name), name: create.slugFor(o.name) }) });
  assert.equal(mac.seeded, true, 'CONTROL: a Mac did not move on to the second name');
});

test('kosmos#8484: the first leftover is named only when the last name was refused as a real agent', () => {
  const slug = create.slugFor(sa.GUIDE_NAME);
  const task = win32job.taskFilePath(slug);
  fs.mkdirSync(path.dirname(task), { recursive: true });
  fs.writeFileSync(task, '<Task/>');
  try {
    const words = create.win32HeldTaskWords(slug, sa.GUIDE_NAME, noRow);
    const r = win32Seed((o) => ({ outcome: create.OUTCOME.REFUSED, because: o.name === sa.GUIDE_NAME ? words : 'we could not find Claude Code on this computer' }));
    assert.equal('because' in r, false, 'freeing Josh was advised for a refusal it would not fix');
  } finally { fs.rmSync(task, { force: true }); }
});

test('kosmos#8484: a guide known only by its birth line whose marker will not write is not adopted (the board would not treat it as the guide)', () => {
  const g = agent(sa.GUIDE_NAME);
  fs.chmodSync(g.dir, 0o555);   // the folder is read-only: the marker write fails
  try {
    const calls = [];
    const r = seed(created(calls), { jobPresence: () => 'yes', birthLog: () => [guideBirth(g.slug, g.id)] });
    assert.equal(r.seeded, false, 'a guide was flagged whose folder the board will not treat as the guide');
    assert.equal(r.state, 'unclear');
    assert.equal('because' in r, false);
    assert.deepEqual(calls, []);
    assert.equal(sa.isGuideFolder(g.slug), false, 'CONTROL: the marker really did not write');
  } finally { fs.chmodSync(g.dir, 0o755); }
});

/* kosmos#8491: create's three loaded-job refusals. Reaching them through the real create needs launchd or systemd
   to report a job, so these give heldSentence create's words, and the pin below fails if create's wording drifts. */
test('kosmos#8491: the three loaded-job refusals say how to free the name, not "try again"', () => {
  const cases = [
    ["something called Josh is already set to start on this computer, from a startup file Kosmos did not make here (/u/Library/LaunchAgents/other.plist). Pick another name, or remove that entry first.",
      'Kosmos did not set up the Kosmos Guide, because the name Josh is in use. Something called Josh is already set to start on this computer, from a startup file Kosmos did not make here (/u/Library/LaunchAgents/other.plist). To free the name, remove that entry first. Then choose Set it up now.'],
    ["systemd is still running something called Josh, though its startup file is gone. Pick another name, or stop it with: systemctl --user stop 'kosmos-josh.service'",
      "Kosmos did not set up the Kosmos Guide, because the name Josh is in use. systemd is still running something called Josh, though its startup file is gone. To free the name, stop it with: systemctl --user stop 'kosmos-josh.service'. Then choose Set it up now."],
    ['something called Josh is already set to start on this computer, though there is nothing else left of it. Pick another name, or open it under Agents and delete what was left of it, which frees the name.',
      'Kosmos did not set up the Kosmos Guide, because the name Josh is in use. Something called Josh is already set to start on this computer, though there is nothing else left of it. To free the name, open it under Agents and delete what was left of it. Then choose Set it up now.'],
  ];
  for (const [because, want] of cases) assert.equal(sa.heldSentenceForTests('Josh', because), want);
});

test('kosmos#8491: create still words those three refusals as the sentence rewrite expects (a drift pin)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  for (const piece of [
    'is already set to start on this computer, from a startup file Kosmos did not make here (${namedPath}). Pick another name, or remove that entry first.',
    "systemd is still running something called ${shown}, though its startup file is gone. Pick another name, or stop it with: systemctl --user stop '${lj.unitName(name)}'",
    'is already set to start on this computer, though there is nothing else left of it. Pick another name, or open it under Agents and delete what was left of it, which frees the name.',
  ]) assert.ok(src.includes(piece), 'create.js no longer says: ' + piece);
});
