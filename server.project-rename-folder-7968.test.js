'use strict';
/**
 * #7968: a renamed project's folder can be renamed to match, by the person, on the project's page
 * (PUT /api/project/<id> {renameFolder: true}). The id stays; a folder the person chose is never offered.
 *
 *   node --test server.project-rename-folder-7968.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-renamefolder-7968-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const messages = require('./engine/messages');
const store = require('./engine/store');
const create = require('./engine/create');
const fleet = require('./test-support/fleet');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { fleet.restore(); } catch { /* best effort */ }
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const KEEP = process.env.AGENT_WORKFORCE_PROJECTS;
const stored = (id) => projects.readAll().find((p) => p.id === id);
const SCREEN = { 'sec-fetch-site': 'same-origin' };
const put = (id, body, headers) => fetch(`${base}/api/project/${id}`, {
  method: 'PUT', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body),
});
const renamed = (starter, name) => {
  const p = projects.create({ name: starter });
  fs.writeFileSync(path.join(p.folder, 'work.txt'), 'mine');
  projects.edit(p.id, { name });
  return stored(p.id);
};
const offered = (id) => projects.get(id).folderRenameTo;

test('#7968 the person renames the folder: the work moves, the id and the old name stay out of it, the room is told', async () => {
  const p = renamed('Starter One', 'Launch Plan');
  assert.equal(offered(p.id), 'Launch Plan', 'CONTROL: it is offered first');
  const r = await put(p.id, { renameFolder: true }, SCREEN);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const now = path.join(KEEP, 'Launch Plan');
  assert.equal(stored(p.id).folder, now);
  assert.equal(stored(p.id).id, p.id, 'the id did not change');
  assert.equal(fs.readFileSync(path.join(now, 'work.txt'), 'utf8'), 'mine');
  assert.equal(fs.existsSync(path.join(KEEP, 'Starter One')), false, 'the old folder is gone');
  assert.equal(offered(p.id), null, 'and it is no longer offered');
  const notes = messages.record().rows.filter((m) => m.kind === 'note' && m.project === p.id).map((m) => m.text);
  assert.ok(notes.includes('This project\'s folder is now at ' + now + '. Work there from now on.'), JSON.stringify(notes));
});

test('#7968 only the person, and on its own', async () => {
  const p = renamed('Starter Two', 'Second Name');
  const agent = await put(p.id, { renameFolder: true });
  assert.equal(agent.status, 403);
  const mixed = await put(p.id, { renameFolder: true, name: 'Other' }, SCREEN);
  assert.equal(mixed.status, 400);
  const notTrue = await put(p.id, { renameFolder: 'yes' }, SCREEN);
  assert.equal(notTrue.status, 400);
  assert.equal(stored(p.id).folder, path.join(KEEP, 'Starter Two'), 'nothing moved');
  assert.equal(fs.existsSync(path.join(KEEP, 'Starter Two', 'work.txt')), true);
});

test('#7968 a folder the person chose is never offered, and asking anyway leaves it alone', async () => {
  const mine = path.join(HOME, 'My Own Work');
  fs.mkdirSync(mine, { recursive: true });
  const p = projects.create({ name: 'Elsewhere', folder: mine });
  projects.edit(p.id, { name: 'Elsewhere Renamed' });
  assert.equal(offered(p.id), null);
  const r = await put(p.id, { renameFolder: true }, SCREEN);
  assert.equal(r.status, 400, JSON.stringify(await r.clone().json()));
  assert.equal(stored(p.id).folder, mine);
  assert.equal(fs.existsSync(mine), true);
});

test('#7968 a folder already called that is refused, with both folders untouched', async () => {
  const p = renamed('Starter Three', 'Taken Name');
  fs.mkdirSync(path.join(KEEP, 'Taken Name'), { recursive: true });
  fs.writeFileSync(path.join(KEEP, 'Taken Name', 'theirs.txt'), 'theirs');
  assert.equal(offered(p.id), null, 'a name already taken is not offered');
  const r = await put(p.id, { renameFolder: true }, SCREEN);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /already a folder called Taken Name/);
  assert.equal(stored(p.id).folder, path.join(KEEP, 'Starter Three'));
  assert.equal(fs.existsSync(path.join(KEEP, 'Starter Three', 'work.txt')), true);
  assert.equal(fs.readFileSync(path.join(KEEP, 'Taken Name', 'theirs.txt'), 'utf8'), 'theirs');
});

test('#7968 a member working, or an agent living in or holding the folder, is refused and nothing moves', () => {
  const p = renamed('Starter Four', 'Fourth Name');
  const old = path.join(KEEP, 'Starter Four');
  assert.throws(() => projects.renameFolderToName(p.id, { busy: ['Ada'] }), /Ada is busy on this project/);
  assert.throws(() => projects.renameFolderToName(p.id, { homes: [old] }), /an agent lives in this folder/);
  assert.throws(() => projects.renameFolderToName(p.id, { homes: [path.join(old, 'inner')] }), /an agent lives in this folder/);
  assert.equal(stored(p.id).folder, old);
  assert.equal(fs.existsSync(path.join(old, 'work.txt')), true);
  // CONTROL: an unrelated agent's folder, one whose home merely holds the projects root, and nobody busy: it goes through.
  const done = projects.renameFolderToName(p.id, { homes: [path.join(SANDBOX, 'workers', 'someone'), KEEP] });
  assert.equal(done.folder, path.join(KEEP, 'Fourth Name'));
});

test('#7968 a project inside the folder is refused, so it is not orphaned', () => {
  const outer = renamed('Starter Nest', 'Nest Name');
  fs.mkdirSync(path.join(outer.folder, 'inner'));
  const inner = projects.create({ name: 'Inner', folder: path.join(outer.folder, 'inner') });
  assert.throws(() => projects.renameFolderToName(outer.id), /the project "Inner" is inside this folder/);
  assert.equal(stored(outer.id).folder, path.join(KEEP, 'Starter Nest'));
  assert.equal(projects.folderState(stored(inner.id).folder).state, 'readable');
});

test('#7968 through the route: a member not idle refuses, an idle member does not, and an agent living in the folder refuses', async (t) => {
  const b = fleet.install([fleet.agent('mara', { state: 'working' }), fleet.agent('pax', { state: 'idle' })]);
  t.after(() => b.restore());
  const p = projects.create({ name: 'Route Start' });
  projects.addAgent(p.id, 'mara');
  projects.edit(p.id, { name: 'Route Busy' });
  const busy = await put(p.id, { renameFolder: true }, SCREEN);
  assert.equal(busy.status, 409, JSON.stringify(await busy.clone().json()));
  assert.match((await busy.json()).error, /mara is busy on this project/);
  assert.equal(stored(p.id).folder, path.join(KEEP, 'Route Start'));

  const q = projects.create({ name: 'Route Calm' });
  projects.addAgent(q.id, 'pax');
  projects.edit(q.id, { name: 'Route Done' });
  const ok = await put(q.id, { renameFolder: true }, SCREEN);
  assert.equal(ok.status, 200, 'CONTROL: an idle member does not stop it');
  assert.equal((await ok.json()).members, 1);
  assert.equal(stored(q.id).folder, path.join(KEEP, 'Route Done'));

  const lived = renamed('Lived In', 'Lived Other');
  const realDir = create.workerDir;
  create.workerDir = () => lived.folder;
  try {
    const r = await put(lived.id, { renameFolder: true }, SCREEN);
    assert.equal(r.status, 409);
    assert.match((await r.json()).error, /an agent lives in this folder/);
  } finally { create.workerDir = realDir; }
});

test('#7968 a roster nobody can read refuses', async (t) => {
  const p = renamed('Starter Blind', 'Blind Name');
  const b = fleet.refuses();
  t.after(() => { if (b && b.restore) b.restore(); else fleet.restore(); });
  const r = await put(p.id, { renameFolder: true }, SCREEN);
  assert.equal(r.status, 409, JSON.stringify(await r.clone().json()));
  assert.equal(stored(p.id).folder, path.join(KEEP, 'Starter Blind'));
});

test('#7968 a case-only rename goes through where the disk does not care about case', () => {
  const p = projects.create({ name: 'casing plan' });
  projects.edit(p.id, { name: 'Casing Plan' });
  const done = projects.renameFolderToName(p.id);
  assert.equal(done.folder, path.join(KEEP, 'Casing Plan'));
  assert.ok(fs.readdirSync(KEEP).includes('Casing Plan'));
  assert.equal(fs.readdirSync(KEEP).includes('casing plan'), false);
});

test('#7968 a name Windows cannot hold is not offered there', () => {
  const p = renamed('Starter Win', 'What? Plan');
  assert.equal(offered(p.id), 'What? Plan', 'CONTROL: this disk can hold it');
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    assert.equal(projects.folderRenameTarget(stored(p.id)), null);
    for (const name of ['Con', 'nul', 'COM1', 'lpt2.txt', 'Plan.', 'Plan ']) {
      assert.equal(projects.folderRenameTarget({ folder: path.join(KEEP, 'x'), name }), null, name);
    }
    assert.equal(projects.folderRenameTarget({ folder: path.join(KEEP, 'x'), name: 'Console' }), 'Console', 'CONTROL: only the device names themselves');
  } finally { Object.defineProperty(process, 'platform', real); }
});

test('#7968 a folder that cannot be renamed leaves the record as it was, and a record that cannot be saved puts the folder back', () => {
  const p = renamed('Starter Five', 'Fifth Name');
  const old = path.join(KEEP, 'Starter Five');
  const realRename = fs.renameSync;
  fs.renameSync = () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; };
  try {
    assert.throws(() => projects.renameFolderToName(p.id), (e) => /could not be renamed/.test(e.message) && !/EBUSY|\//.test(e.message));
  } finally { fs.renameSync = realRename; }
  assert.equal(stored(p.id).folder, old);
  assert.equal(fs.existsSync(old), true);

  const realSave = store.saveFlushed;
  let blocked = 0;
  store.saveFlushed = () => { blocked += 1; throw new Error('disk full'); };
  try {
    assert.throws(() => projects.renameFolderToName(p.id), /disk full/);
  } finally { store.saveFlushed = realSave; }
  assert.ok(blocked > 0, 'CONTROL: the save really was refused');
  assert.equal(stored(p.id).folder, old);
  assert.equal(fs.existsSync(path.join(old, 'work.txt')), true, 'the folder went back');
  assert.equal(fs.existsSync(path.join(KEEP, 'Fifth Name')), false);

  // Neither the save nor the way back: it says the true thing, and the page must not say "Not changed".
  let renames = 0;
  store.saveFlushed = () => { throw new Error('disk full'); };
  fs.renameSync = (...a) => { renames += 1; if (renames === 2) throw new Error('nope'); return realRename(...a); };
  try {
    assert.throws(() => projects.renameFolderToName(p.id), (e) => e.status === 500 && /was renamed to Fifth Name/.test(e.message));
  } finally { store.saveFlushed = realSave; fs.renameSync = realRename; }
  assert.equal(fs.existsSync(path.join(KEEP, 'Fifth Name', 'work.txt')), true);
});

test('#7968 a name that cannot be a folder name is not offered, and a matching folder is not', () => {
  const p = renamed('Starter Six', '.hidden');
  assert.equal(offered(p.id), null);
  const q = projects.create({ name: 'Same Name' });
  assert.equal(offered(q.id), null);
});

test('#7968 the page offers it only with an answer to give, and sends it alone', () => {
  const page = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.match(page, /id="pjs-rename-folder" hidden/);
  assert.match(page, /rf\.hidden = !\(p\.folderRenameTo && p\.folderState && p\.folderState\.state === 'readable'\)/);
  assert.match(page, /JSON\.stringify\(\{ renameFolder: true \}\)/);
  assert.match(page, /e\.status === 500 \? t \+ '\.' : 'Not changed: '/);
});
