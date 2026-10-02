'use strict';
/**
 * #4896: one folder is one agent. Connecting a folder another name already records was allowed, because every
 * check asked only about the NEW name. Both names then resolved to the same instructions file, so every one of
 * them showed the same name and role on the board and on a project ("every member shows the joining role"), and
 * starting both put two Claudes in one worker folder. Measured before the fix (2026-10-01, origin/main a7cae2b3e):
 * ann and bob both connected to one folder, and both read { displayName: 'Ann', role: 'project manager' }.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-onefolder-'));
process.env.HOME = path.join(SB, 'home');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'launch');
fs.mkdirSync(process.env.HOME, { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const create = require('./create');
create.setDryRun(true);
const discover = require('./discover');
const store = require('./store');
const status = require('./status');
const remove = require('./remove');

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });
/* An empty board through the paneSource seam, as connect-agent.test.js does (#1794). */
test.beforeEach(() => { status.setPaneSource(() => ''); });
test.afterEach(() => { status.setPaneSource(null); });

let seq = 0;
function folder(body) {
  seq += 1;
  const dir = path.join(SB, 'theirs', 'f' + seq);
  fs.mkdirSync(dir, { recursive: true });
  if (body != null) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body);
  return dir;
}

test('#4896: a folder already connected under one name is refused under another, and nothing is recorded', () => {
  const dir = folder('You are **Ann**, a project manager.\n');
  const a = discover.connect(dir, { name: 'ann1' });
  assert.equal(a.ok, true, a.because);
  const b = discover.connect(dir, { name: 'bob1' });
  assert.equal(b.ok, false, 'a second name was connected to the same folder');
  assert.match(b.because, /already connected as Ann, and one folder holds one agent/);
  assert.equal(store.readProfile('bob1').dir, undefined, 'the refused name still recorded the folder');
  assert.notEqual(create.workerDir('bob1'), dir, 'the refused name still resolves to the first agent\'s folder');
  assert.equal(status.readIdentity('bob1').role, null, 'the refused name still reads the first agent\'s role');
});

test('#4896: the folder-only path (no instructions, a typed name) refuses a second name the same way', () => {
  const dir = folder(null);
  const a = discover.connect(dir, { name: 'cy1' });
  assert.equal(a.ok, true, a.because);
  assert.equal(a.registered, true, 'fixture: this did not take the folder-only path');
  const b = discover.connect(dir, { name: 'dee1' });
  assert.equal(b.ok, false);
  assert.match(b.because, /already connected as cy1, and one folder holds one agent/);
  assert.equal(store.readProfile('dee1').dir, undefined);
});

test('#4896 CONTROL: the same name connecting its own folder again, and a different folder under a new name, are allowed', () => {
  const dir = folder('You are **Eve**, a designer.\n');
  assert.equal(discover.connect(dir, { name: 'eve1' }).ok, true);
  const again = discover.connect(dir, { name: 'eve1' });
  assert.equal(again.ok, true, 'the same name was refused its own folder: ' + again.because);
  const other = discover.connect(folder('You are **Fay**, a writer.\n'), { name: 'fay1' });
  assert.equal(other.ok, true, other.because);
});

test('#4896: the found list counts a folder recorded under ANY name as already in', () => {
  const dir = folder('You are **Gus**, an editor.\n');
  assert.equal(discover.alreadyIn(dir, []), false, 'CONTROL: a folder nobody records is offered');
  assert.equal(discover.connect(dir, { name: 'gus-typed' }).ok, true);
  assert.equal(discover.alreadyIn(dir, []), true, 'a folder recorded under a typed name is still offered');
});

/* Review 2: a removed agent's profile outlives the removal, so its folder must be free for a new name. Written as the
   real removed list remove.js reads (removed.json under the store root), in the shape hidesCard reads. */
test('#4896: a REMOVED agent does not hold its folder; a different spelling of a live one still does', () => {
  const dir = folder('You are **Ivy**, an analyst.\n');
  assert.equal(discover.connect(dir, { name: 'ivy1' }).ok, true);
  const trailing = discover.connect(dir + '/', { name: 'ivy2' });
  assert.match(String(trailing.because || ''), /already connected as Ivy/, 'a trailing slash slipped past the check');
  const file = path.join(store.ROOT, 'removed.json');
  fs.writeFileSync(file, JSON.stringify([{ name: 'ivy1', removedAt: new Date().toISOString(), stopped: true }]));
  try {
    assert.equal(discover.alreadyIn(dir, []), false, 'a removed agent\'s folder is still hidden from the found list');
    const again = discover.connect(dir, { name: 'ivy3' });
    assert.equal(again.ok, true, 'a removed agent still holds its folder: ' + again.because);
  } finally { fs.rmSync(file, { force: true }); }
});

test('#4896: profiles that cannot be read refuse the connect rather than add blind', () => {
  const dir = folder('You are **Hal**, a researcher.\n');
  const profiles = store.PROFILES;
  fs.mkdirSync(profiles, { recursive: true });
  fs.chmodSync(profiles, 0o000);
  try {
    let readable = true;
    try { fs.readdirSync(profiles); } catch { readable = false; }
    if (readable) return;   // running as root: the directory cannot be made unreadable, so this arm cannot be measured
    const out = discover.connect(dir, { name: 'hal1' });
    assert.equal(out.ok, false);
    assert.match(out.because, /could not check which agents this computer already has/);
  } finally { fs.chmodSync(profiles, 0o755); }
});

/* ---- review 3 ---- */
const removedFile = () => path.join(store.ROOT, 'removed.json');
function withRemoved(records, fn) {
  fs.writeFileSync(removedFile(), JSON.stringify(records));
  try { return fn(); } finally { fs.rmSync(removedFile(), { force: true }); }
}

test('#4896 r3: a card cleared while its session was LEFT RUNNING still holds its folder (it is still there)', () => {
  const dir = folder('You are **Jo**, a planner.\n');
  assert.equal(discover.connect(dir, { name: 'jo1' }).ok, true);
  withRemoved([{ name: 'jo1', removedAt: new Date().toISOString(), stopped: false, leftRunningByChoice: true }], () => {
    const b = discover.connect(dir, { name: 'jo2' });
    assert.equal(b.ok, false, 'a second Claude was started in a running agent\'s folder');
    assert.match(b.because, /already connected as Jo/);
  });
  withRemoved([{ name: 'jo1', removedAt: new Date().toISOString(), stopped: false }], () => {
    assert.match(String(discover.connect(dir, { name: 'jo3' }).because || ''), /one folder holds one agent/, 'a partial removal (may be running) freed the folder');
  });
});

test('#4896 r3: restoring a removed agent is refused while another name holds its folder', () => {
  const dir = folder('You are **Kit**, a tester.\n');
  assert.equal(discover.connect(dir, { name: 'kit1' }).ok, true);
  withRemoved([{ name: 'kit1', removedAt: new Date().toISOString(), stopped: true }], () => {
    assert.equal(discover.connect(dir, { name: 'kit2' }).ok, true, 'fixture: the stopped removal did not free the folder');
    const back = remove.restore('kit1');
    assert.equal(back.outcome, remove.OUTCOME.REFUSED, JSON.stringify(back));
    assert.match(back.because, /folder is now connected as Kit, and one folder holds one agent/);
  });
});

test('#4896 r3: a typed name that safeKey rewrites ("Casey Jones") can connect its own folder again', () => {
  const dir = folder(null);
  assert.equal(discover.connect(dir, { name: 'Casey Jones' }).ok, true);
  const again = discover.connect(dir, { name: 'Casey Jones' });
  assert.equal(again.ok, true, 'a name refused its own folder: ' + again.because);
});

test('#4896 r3: a name outside NAME_RE (one letter) still holds its folder', () => {
  const dir = folder(null);
  assert.equal(discover.connect(dir, { name: 'Q' }).ok, true, 'fixture: the folder-only path refused a one-letter name');
  const b = discover.connect(dir, { name: 'zed2' });
  assert.equal(b.ok, false, 'a one-letter name\'s folder was given to a second name');
  assert.match(b.because, /already connected as Q, and one folder holds one agent/);
});

test('#4896 r3: a case variant and a symlinked-parent spelling are the same folder', () => {
  const real = fs.realpathSync(path.join(SB, 'theirs'));
  const dir = path.join(real, 'CaseProj');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'You are **Lu**, a builder.\n');
  assert.equal(discover.connect(dir, { name: 'lu1' }).ok, true);
  const lower = path.join(real, 'caseproj');
  if (fs.existsSync(lower)) {   // a case-insensitive volume (APFS default); on a case-sensitive one this is another folder
    assert.match(String(discover.connect(lower, { name: 'lu2' }).because || ''), /already connected as Lu/, 'a case variant connected as a second agent');
  }
  const link = path.join(SB, 'link-to-theirs');
  fs.symlinkSync(real, link);
  const viaLink = path.join(link, 'CaseProj');
  assert.match(String(discover.connect(viaLink, { name: 'lu3' }).because || ''), /already connected as Lu/, 'a spelling through a symlinked parent connected as a second agent');
});

/* ---- review 4 ---- */
test('#4896 r4: restore names a REMOVED holder that may still be running, and says to stop it (not "remove" it)', () => {
  const dir = folder('You are **Mo**, a lead.\n');
  assert.equal(discover.connect(dir, { name: 'mo1' }).ok, true);
  withRemoved([{ name: 'mo1', removedAt: new Date().toISOString(), stopped: true }], () => {
    assert.equal(discover.connect(dir, { name: 'mo2' }).ok, true, 'fixture: the stopped removal did not free the folder');
  });
  withRemoved([
    { name: 'mo1', removedAt: new Date().toISOString(), stopped: true },
    { name: 'mo2', removedAt: new Date().toISOString(), stopped: false, leftRunningByChoice: true },
  ], () => {
    const back = remove.restore('mo1');
    assert.equal(back.outcome, remove.OUTCOME.REFUSED, JSON.stringify(back));
    assert.match(back.because, /was removed but may still be running there, and one folder holds one agent\. Stop Mo first/);
    assert.doesNotMatch(back.because, /Remove Mo first/, 'it told the person to remove an agent that is already removed');
  });
});

test('#4896 r4: restore refuses when its own profile cannot be read (store.readProfile would have answered {})', () => {
  const dir = folder('You are **Ned**, a clerk.\n');
  assert.equal(discover.connect(dir, { name: 'ned1' }).ok, true);
  const own = path.join(store.PROFILES, store.profileFileName('ned1'));
  const kept = fs.readFileSync(own, 'utf8');
  fs.writeFileSync(own, '{bad');
  try {
    withRemoved([{ name: 'ned1', removedAt: new Date().toISOString(), stopped: true }], () => {
      const back = remove.restore('ned1');
      assert.equal(back.outcome, remove.OUTCOME.REFUSED, JSON.stringify(back));
      assert.match(back.because, /could not check which agents use/);
    });
  } finally { fs.writeFileSync(own, kept); }
});

test('#4896 r4: a recorded folder that does not exist yet is matched through a symlinked parent', () => {
  const real = fs.realpathSync(path.join(SB, 'theirs'));
  const link = path.join(SB, 'link-r4');
  fs.symlinkSync(real, link);
  const viaLink = path.join(link, 'NotYet');
  assert.equal(discover.connect(folder(null), { name: 'ox1' }).ok, true);   // fixture: profiles exist
  store.writeProfile('ox1', { dir: viaLink });                               // a folder recorded, then not there
  const taken = discover.folderTakenBy(path.join(real, 'NotYet'), 'ox2', { store });
  assert.equal(taken.ok, true);
  assert.equal(taken.other !== null, true, 'a missing leaf under a symlinked parent read as a different folder');
});

/* ---- review 5 ---- */
test('#4896 r5: an agent Kosmos CREATED (no recorded folder) holds its home; another name is refused, its own is not', () => {
  const home = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'alice5');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'CLAUDE.md'), 'You are **Alice**, a writer.\n');
  store.writeProfile('alice5', { role: 'Writer' });   // what create writes: a role, no dir
  assert.equal(create.workerDir('alice5'), home, 'fixture: the created agent does not live in its default home');
  const b = discover.connect(home, { name: 'bob5' });
  assert.equal(b.ok, false, 'a second name was connected to a created agent\'s own folder');
  assert.match(b.because, /that folder is alice5’s own folder in Kosmos, and one folder holds one agent/);
  assert.notEqual(create.workerDir('bob5'), home);
  const own = discover.folderTakenBy(home, 'alice5', { store });
  assert.equal(own.other, null, 'CONTROL: the created agent\'s own name is not a second holder of its home');
});

test('#4896 r5: a RELATIVE recorded dir holds nothing (no agent lives at a path relative to the board\'s cwd)', () => {
  const dir = folder('You are **Pia**, a poet.\n');
  store.writeProfile('pia-rel', { dir: path.relative(process.cwd(), dir) });
  const taken = discover.folderTakenBy(dir, 'pia2', { store });
  assert.equal(taken.ok, true);
  assert.equal(taken.other, null, 'a relative recorded dir was counted as holding the folder');
});

/* ---- review 6 ---- */
function createdAgent(name, role) {
  const home = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'CLAUDE.md'), 'You are **' + name + '**, a ' + role + '.\n');
  store.writeProfile(name, { role });
  return home;
}

test('#4896 r6: a created agent asked for under another CASE of its own name is the same agent', () => {
  const home = createdAgent('bobby6', 'writer');
  const t = discover.folderTakenBy(home, 'Bobby6', { store });
  assert.equal(t.other, null, 'Bobby6 was refused its own folder bobby6: ' + JSON.stringify(t));
});

test('#4896 r6: a name whose own profile records a slug folder in the workers root is not refused it', () => {
  const home = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'slugfolder6');
  fs.mkdirSync(home, { recursive: true });
  store.writeProfile('slugfolder6', { role: 'x' });        // an agent of the folder's own name exists
  store.writeProfile('slug-folder-6', { dir: home });      // ...and this name's OWN record points there
  const t = discover.folderTakenBy(home, 'slug-folder-6', { store });
  assert.equal(t.other, null, 'a name was refused the folder its own profile records: ' + JSON.stringify(t));
});

test('#4896 r6: a folder in the workers root whose agent never existed belongs to nobody', () => {
  const left = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'old-project6');
  fs.mkdirSync(left, { recursive: true });
  const t = discover.folderTakenBy(left, 'casey6', { store });
  assert.equal(t.other, null, 'a leftover folder was claimed for an agent that does not exist');
  const home = createdAgent('real6', 'editor');
  assert.equal(discover.folderTakenBy(home, 'casey6', { store }).other, 'real6', 'CONTROL: an existing agent still holds its home');
});

/* ---- review 7 ---- */
test('#4896 r7: an agent of the folder\'s name that LIVES ELSEWHERE does not hold the leftover folder; list and connect agree', () => {
  const elsewhere = folder('You are **Bea**, a lead.\n');
  assert.equal(discover.connect(elsewhere, { name: 'bea7' }).ok, true);
  const left = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'bea7');
  fs.mkdirSync(left, { recursive: true });
  fs.writeFileSync(path.join(left, 'CLAUDE.md'), 'You are **Old**, a leftover.\n');
  const t = discover.folderTakenBy(left, 'cal7', { store });
  assert.equal(t.other, null, 'a folder bea7 does not live in was claimed for bea7: ' + JSON.stringify(t));
  assert.equal(discover.alreadyIn(left, []) === true, false, 'CONTROL of agreement: the list offers it');
  assert.doesNotMatch(String(discover.connect(left, { name: 'cal7' }).because || ''), /own folder in Kosmos/,
    'the list offered a folder connect then refused with a false sentence');
});

test('#4896 r7: a created agent whose name safeKey empties (a job, no profile) holds its home without a throw', () => {
  const odd = 'éé';
  const home = path.join(process.env.AGENT_WORKFORCE_WORKERS, odd);
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'CLAUDE.md'), 'You are **Ee**, a singer.\n');
  const plist = create.plistPath(odd);
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, '<plist/>');   // the job is what makes the agent exist; safeKey cannot give it a profile
  try {
    let out;
    assert.doesNotThrow(() => { out = discover.connect(home, { name: 'carol7' }); }, 'an odd created name threw out of connect');
    assert.equal(out.ok, false, JSON.stringify(out));
    assert.match(out.because, /own folder in Kosmos, and one folder holds one agent/);
  } finally { fs.rmSync(plist, { force: true }); }
});

test('#4896 r7: a REMOVED created agent\'s home names it as removed', () => {
  const home = createdAgent('gil7', 'analyst');
  withRemoved([{ name: 'gil7', removedAt: new Date().toISOString(), stopped: true }], () => {
    const b = discover.connect(home, { name: 'hob7' });
    assert.equal(b.ok, false);
    assert.match(b.because, /that folder is gil7’s own folder in Kosmos \(an agent you removed\), and one folder holds one agent/);
  });
});
