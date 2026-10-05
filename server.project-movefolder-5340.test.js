'use strict';
/**
 * kosmos#5340: a project whose folder was moved on this computer is pointed at its new place by the person, from the
 * project's page (PUT /api/project/<id> {folder}). The new folder passes the same checks a new project's folder does;
 * an agent cannot move it; the room is told where it went.
 *
 *   node --test server.project-movefolder-5340.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-movefolder-5340-'));
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
const fleet = require('./test-support/fleet');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { fleet.restore(); } catch { /* best effort */ }
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/* Real folders the board keeps, under the sandbox's own projects root (a temp folder elsewhere is refused, #525). */
const KEEP = process.env.AGENT_WORKFORCE_PROJECTS;
const folder = (name) => { const d = path.join(KEEP, name); fs.mkdirSync(d, { recursive: true }); return d; };
const stored = (id) => projects.readAll().find((p) => p.id === id);
const put = (id, body, headers) => fetch(`${base}/api/project/${id}`, {
  method: 'PUT', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body),
});
const SCREEN = { 'sec-fetch-site': 'same-origin' };
const notes = (pid) => messages.record().rows.filter((m) => m.kind === 'note' && m.project === pid).map((m) => m.text);

test('#5340 the person moves a project whose folder moved: saved, and the room is told where', async () => {
  const old = folder('Launch Old');
  const p = projects.create({ name: 'Launch', folder: old });
  const now = path.join(KEEP, 'Launch New');
  fs.renameSync(old, now);   // the folder was moved on this computer
  assert.equal(projects.folderState(stored(p.id).folder).state, 'missing', 'CONTROL: the recorded folder reads missing first');
  const r = await put(p.id, { folder: now }, SCREEN);
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(stored(p.id).folder, now);
  assert.equal(projects.folderState(stored(p.id).folder).state, 'readable');
  assert.ok(notes(p.id).some((t) => t === 'This project\'s folder is now at ' + now + '. Work there from now on.'), 'the room was not told: ' + JSON.stringify(notes(p.id)));
});

test('#5340 an agent cannot move it; a non-folder, a missing one, a relative path and another project\'s folder are refused', async () => {
  const opsAt = folder('Ops');
  const p = projects.create({ name: 'Ops', folder: opsAt });
  const other = projects.create({ name: 'Sales', folder: folder('Sales') });
  const target = folder('Ops Elsewhere');
  // A working project is not re-pointed (Sales's folder is there).
  const still = await put(other.id, { folder: target }, SCREEN);
  assert.equal(still.status, 400, 'a project whose folder is still there was re-pointed');
  assert.match((await still.json()).error, /still there, so Kosmos keeps using it/);
  fs.renameSync(opsAt, path.join(KEEP, 'Ops gone'));   // Ops's folder was moved, so each refusal below is about the TARGET
  const agent = await put(p.id, { folder: target }, { 'x-kosmos-agent-token': 'ab'.repeat(16) });
  assert.equal(agent.status, 403, 'an agent moved a project folder');
  const noScreen = await put(p.id, { folder: target });
  assert.equal(noScreen.status, 403, 'a request with no browser headers moved it');
  const file = path.join(KEEP, 'a-file.txt'); fs.writeFileSync(file, 'x');
  for (const [bad, why] of [[file, /a file, not a folder/], [path.join(KEEP, 'nowhere'), /no folder at that path/],
    ['relative/path', /full path/], [stored(other.id).folder, /already the project "Sales"/]]) {
    const r = await put(p.id, { folder: bad }, SCREEN);
    const j = await r.json();
    assert.equal(r.status, 400, JSON.stringify(bad) + ' was accepted');
    assert.match(j.error, why);
  }
  const arr = await put(p.id, { folder: [target] }, SCREEN);
  assert.equal(arr.status, 400, 'an array was taken as a path');
  const mixed = await put(p.id, { folder: target, name: 'Ops 2' }, SCREEN);
  assert.equal(mixed.status, 400, 'a folder move mixed with a rename was accepted');
  assert.equal(stored(p.id).name, 'Ops', 'the mixed request renamed it');
  assert.notEqual(stored(p.id).folder, target, 'a refused request moved the folder');
});

test('#5340 review 1: every member\'s instructions name the new folder, and the answer counts who was told', async (t) => {
  const b = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  t.after(() => b.restore());
  const WORKERS = process.env.AGENT_WORKFORCE_WORKERS;
  fs.mkdirSync(path.join(WORKERS, 'mara'), { recursive: true });
  fs.writeFileSync(path.join(WORKERS, 'mara', 'CLAUDE.md'), 'You are mara, the research agent. You find sources and summarise them.\n');
  const old = folder('Research Old');
  const p = projects.create({ name: 'Research', folder: old, agents: ['mara'] });
  const now = path.join(KEEP, 'Research New');
  fs.renameSync(old, now);
  const r = await put(p.id, { folder: now }, SCREEN);
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.members, 1, 'the answer did not count the member');
  assert.equal(typeof j.reached, 'number');
  const file = fs.readFileSync(path.join(WORKERS, 'mara', 'CLAUDE.md'), 'utf8');
  assert.ok(file.includes(now), 'the member\'s instructions do not name the new folder');
  assert.ok(!file.includes(old), 'the member\'s instructions still name the old folder');
});
