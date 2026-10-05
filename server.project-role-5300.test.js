'use strict';
/**
 * #5300 (10-05 user diagnostic R10, and N11 in the 0.7.15 one): every project member showed its agent's one role, so
 * five agents made as Project Managers read as five Project Managers everywhere. `kosmos project role` lets a member
 * say what it does on one project; `project show` lists that, marked as this project's. Over HTTP on a sandboxed board.
 *
 *   node --test server.project-role-5300.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-project-role-5300-'));
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
const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const projectview = require('./engine/projectview');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => { try { fleet.restore(); } catch { /* best effort */ } try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const stored = (id) => projects.readAll().find((p) => p.id === id);
const post = (id, body, headers) => fetch(`${base}/api/project/${id}/role`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const asAgent = (id, token, body) => post(id, body, { 'x-kosmos-agent-token': token });
const asScreen = (id, body) => post(id, body, { 'sec-fetch-site': 'same-origin' });

function twoAgents() {
  const board = fleet.install([fleet.agent('rh-ada', { state: 'idle' }), fleet.agent('rh-bo', { state: 'idle' })]);
  const name = (p) => (board.agents.find((c) => (c.sessionName || '').startsWith(p)) || {}).sessionName;
  return { board, ada: name('rh-ada'), bo: name('rh-bo') };
}

test('#5300: an agent sets its role on one project; project show lists it, marked, and the other member keeps its own', async () => {
  const { board, ada, bo } = twoAgents();
  try {
    assert.ok(ada && bo, 'the fleet gave no cards');
    const p = projects.create({ name: 'Role Here' });
    projects.addAgent(p.id, ada, board.agents); projects.addAgent(p.id, bo, board.agents);
    const minted = sendertoken.mint(ada);
    assert.equal(minted.ok, true, 'fixture: no token was minted');
    const r = await asAgent(p.id, minted.token, { role: '  Researcher:\n reads the sources  ' });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(await r.json(), { ok: true, role: 'Researcher: reads the sources' });
    assert.deepEqual(stored(p.id).rolesHere, { [ada]: 'Researcher: reads the sources' });
    const ov = await (await fetch(`${base}/api/project/${p.id}/overview`)).json();
    const text = projectview.renderShow(ov).join('\n');
    assert.match(text, /rh-ada, on this project: "Researcher: reads the sources"  \|/, text);
    const boLine = text.split('\n').find((l) => l.trim().startsWith('rh-bo')) || '';
    assert.ok(boLine && !/on this project/.test(boLine), 'the other member was given a role here: ' + boLine);
    // An agent sets only its OWN role: a name in the body is not read on an agent's call.
    const r2 = await asAgent(p.id, minted.token, { role: 'Writer', name: bo });
    assert.equal(r2.status, 200);
    assert.deepEqual(stored(p.id).rolesHere, { [ada]: 'Writer' }, 'an agent set another member\'s role');
    // An empty role clears it.
    const r3 = await asAgent(p.id, minted.token, { role: '' });
    assert.deepEqual(await r3.json(), { ok: true, role: null });
    assert.deepEqual(stored(p.id).rolesHere, {});
  } finally { board.restore(); }
});

test('#5300: refusals: not a member, too long, not text, nobody named; the screen names the member', async () => {
  const { board, ada, bo } = twoAgents();
  try {
    const p = projects.create({ name: 'Role Refusals' });
    projects.addAgent(p.id, bo, board.agents);
    const minted = sendertoken.mint(ada);
    let r = await asAgent(p.id, minted.token, { role: 'Writer' });
    assert.equal(r.status, 403, 'a non-member set a role');
    projects.addAgent(p.id, ada, board.agents);
    r = await asAgent(p.id, minted.token, { role: 'x'.repeat(projects.ROLE_HERE_MAX + 1) });
    assert.equal(r.status, 400, 'an over-long role was taken');
    r = await asAgent(p.id, minted.token, { role: 7 });
    assert.equal(r.status, 400, 'a role that is not text was taken');
    r = await post(p.id, { role: 'Writer' }, {});
    assert.equal(r.status, 403, 'a caller nobody could name set a role');
    r = await asAgent('no-such-project', minted.token, { role: 'Writer' });
    assert.equal(r.status, 404);
    // The screen names the member; without a name it is refused.
    assert.equal((await asScreen(p.id, { role: 'Editor' })).status, 400);
    assert.equal((await asScreen(p.id, { role: 'Editor', name: 'nobody-here' })).status, 400, 'the screen naming a non-member is a bad request');
    r = await asScreen(p.id, { role: 'Editor', name: bo });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(stored(p.id).rolesHere[bo], 'Editor');
    // Leaving the project takes the role here with it.
    projects.removeAgent(p.id, bo);
    assert.equal(Object.prototype.hasOwnProperty.call(stored(p.id).rolesHere || {}, bo), false, 'the role outlived the membership');
  } finally { board.restore(); }
});

test('#5300 review 3: a paneless (Windows) agent sets its role under the member name the project stores; tag characters are dropped', async () => {
  // The REAL paneless row, as server.project-pause-4771 makes it: a token plus a live beat, no typed card.
  const remote = sendertoken.mint('Kip5300', { launcher: 'remote' });
  assert.equal(remote.ok, true, 'fixture: no paneless token');
  require('./engine/liveness').seen('kip5300');
  const p = projects.create({ name: 'Role Paneless' });
  const raw = projects.readAll();
  raw.find((x) => x.id === p.id).agents = ['Kip5300'];   // stored under the spelling it joined with, not the key
  projects.writeAll(raw);
  const r = await asAgent(p.id, remote.token, { role: 'Tester\u{E0041}\u{E0042} of builds' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(stored(p.id).rolesHere, { Kip5300: 'Tester of builds' }, 'not stored under the project\'s spelling, or a tag character kept');
});
