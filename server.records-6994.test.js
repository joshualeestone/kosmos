'use strict';

/**
 * #6994: the records routes. GET /api/project/:id/records lists a project's records with their age and the stale
 * count; POST adds or updates one; POST .../remove and .../label. The engine rules are in
 * engine/records-6994.test.js; this proves the HTTP surface, and the card's "two agents on one project add and
 * update rows" with the two writes sent at the same moment.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.records-6994.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-records6994srv-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function post(p, body, headers = {}) {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const at = (id, rest = '') => `/api/project/${encodeURIComponent(id)}/records${rest}`;
/* Read from the engine: the agent arms run with enforcement on, where an unauthenticated GET is refused. */
const stored = (id) => require('./engine/records').list(id).rows;

/* The agent arms: enforcement on, as server.agent-writes-4491.test.js runs it. mara and ana are on the project, otto is not. */
const BOARD = 'BOARDTOKEN_test_6994_records_0123456789abcd';
function agents(t) {
  const board = fleet.install([fleet.agent('mara', { state: 'idle' }), fleet.agent('ana', { state: 'idle' }), fleet.agent('otto', { state: 'idle' })]);
  const was = { on: boardAuthState.on, token: boardAuthState.token };
  boardAuthState.on = true;
  boardAuthState.token = BOARD;
  t.after(() => { boardAuthState.on = was.on; boardAuthState.token = was.token; board.restore(); });
  return { mara: sendertoken.mint('mara').token, ana: sendertoken.mint('ana').token, otto: sendertoken.mint('otto').token };
}
function project() {
  const p = projects.create({ name: 'Records ' + Math.random().toString(36).slice(2) });
  projects.mutate(p.id, (q) => ({ ...q, agents: ['mara', 'ana'] }));
  return p.id;
}

test('GET lists a new project\'s records as none, with its label and stale threshold', async () => {
  const id = project();
  const res = await fetch(base + at(id));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.label, body.rows, body.stale, body.staleDays], ['records', [], 0, 30]);
});

test('two agents on the project add and update rows at the same moment, and every write survives, each named as its writer', async (t) => {
  const id = project();
  const tok = agents(t);
  const [a, b] = await Promise.all([
    post(at(id), { name: 'Acme', status: 'active' }, { 'x-kosmos-agent-token': tok.mara }),
    post(at(id), { name: 'Globex', status: 'lead', source: 'https://crm.example/globex' }, { 'x-kosmos-agent-token': tok.ana }),
  ]);
  assert.deepEqual([a.status, b.status], [201, 201], JSON.stringify([a.json, b.json]));
  const [c, d] = await Promise.all([
    post(at(id), { name: 'acme', source: 'notes/acme.md' }, { 'x-kosmos-agent-token': tok.ana }),
    post(at(id), { name: 'GLOBEX', status: 'customer' }, { 'x-kosmos-agent-token': tok.mara }),
  ]);
  assert.deepEqual([c.status, d.status], [200, 200], JSON.stringify([c.json, d.json]));
  assert.deepEqual(stored(id).map((r) => [r.name, r.status, r.source, r.by]), [
    ['Acme', 'active', 'notes/acme.md', 'ana'],
    ['Globex', 'customer', 'https://crm.example/globex', 'mara'],
  ]);
});

test('an agent that is not on the project is refused (403) and nothing is stored', async (t) => {
  const id = project();
  const tok = agents(t);
  const w = await post(at(id), { name: 'Acme' }, { 'x-kosmos-agent-token': tok.otto });
  assert.equal(w.status, 403, JSON.stringify(w.json));
  assert.match(w.json.error, /not on this project, so it cannot change its records/);
  assert.deepEqual(stored(id), []);
  assert.equal((await post(at(id), { name: 'Acme' }, { 'x-kosmos-agent-token': tok.mara })).status, 201, 'CONTROL: a member could not write');
});

test('a bad request is a 400 that names the problem and stores nothing; an unknown project is a 404', async () => {
  const id = project();
  for (const body of [{}, { name: '' }, { name: 'A', confirmed: 'yesterday' }, { name: 'A', status: 7 }, []]) {
    const w = await post(at(id), body);
    assert.equal(w.status, 400, `accepted ${JSON.stringify(body)}`);
    assert.ok(w.json && w.json.error, 'a 400 should name the problem');
  }
  assert.deepEqual(stored(id), []);
  assert.equal((await post(at('no-such-project'), { name: 'A' })).status, 404);
  assert.equal((await fetch(base + at('no-such-project'))).status, 404);
});

test('remove takes a row away by any spelling; a missing one is a 404; label names the rows', async () => {
  const id = project();
  assert.equal((await post(at(id), { name: 'Acme' })).status, 201);
  const gone = await post(at(id, '/remove'), { name: 'ACME' });
  assert.equal(gone.status, 200, JSON.stringify(gone.json));
  assert.deepEqual(stored(id), []);
  assert.equal((await post(at(id, '/remove'), { name: 'Acme' })).status, 404);
  assert.equal((await post(at(id, '/label'), { label: 'accounts' })).status, 200);
  assert.equal((await (await fetch(base + at(id))).json()).label, 'accounts');
});

test('the screen writes a row as the person\'s; a GET to remove is a 405', async () => {
  const id = project();
  const w = await post(at(id), { name: 'Acme', status: 'checked' }, { 'sec-fetch-site': 'same-origin' });
  assert.equal(w.status, 201, JSON.stringify(w.json));
  assert.equal(w.json.row.byPerson, true);
  assert.equal((await fetch(base + at(id, '/remove'))).status, 405);
});

test('GET ?as=text answers the list as both CLIs print it (records.renderList), with the project\'s name', async () => {
  const id = project();
  assert.equal((await post(at(id), { name: 'Acme', status: 'active' })).status, 201);
  const res = await fetch(base + at(id) + '?as=text');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  const name = projects.readAll().find((x) => x.id === id).name;
  assert.match(await res.text(), new RegExp('^Records on ' + name + ': 1\\n  Acme \\| active \\| confirmed \\d{4}-\\d{2}-\\d{2} \\(today\\)'));
});

test('an agent that is not on the project cannot remove a row or rename the rows either (403), and nothing changes', async (t) => {
  const id = project();
  const tok = agents(t);
  assert.equal((await post(at(id), { name: 'Acme' }, { 'x-kosmos-agent-token': tok.mara })).status, 201);
  const gone = await post(at(id, '/remove'), { name: 'Acme' }, { 'x-kosmos-agent-token': tok.otto });
  const named = await post(at(id, '/label'), { label: 'leads' }, { 'x-kosmos-agent-token': tok.otto });
  assert.deepEqual([gone.status, named.status], [403, 403], JSON.stringify([gone.json, named.json]));
  assert.deepEqual(stored(id).map((r) => r.name), ['Acme']);
  assert.equal(require('./engine/records').list(id).label, 'records');
});

test('a HEAD to the list is a 405, as the agent-token gate admits GET only', async () => {
  const id = project();
  assert.equal((await fetch(base + at(id), { method: 'HEAD' })).status, 405);
  assert.equal((await fetch(base + at(id))).status, 200, 'CONTROL: the GET answers');
});

test('the project overview (kosmos project show\'s read) carries the records count and the stale count', async () => {
  const id = project();
  assert.equal((await post(at(id), { name: 'Acme' })).status, 201);
  assert.equal((await post(at(id), { name: 'Globex', confirmed: '2020-01-02' })).status, 201);
  const body = await (await fetch(`${base}/api/project/${encodeURIComponent(id)}/overview`)).json();
  assert.deepEqual(body.project && body.project.records, { total: 2, stale: 1, label: 'records', staleDays: 30 }, JSON.stringify(body).slice(0, 300));
});

test('an agent reads the list with its own token alone, as text (kosmos records with enforcement on)', async (t) => {
  const id = project();
  const tok = agents(t);
  assert.equal((await post(at(id), { name: 'Acme' }, { 'x-kosmos-agent-token': tok.mara })).status, 201);
  const res = await fetch(base + at(id) + '?as=text', { headers: { 'x-kosmos-agent-token': tok.ana } });
  assert.equal(res.status, 200, await res.clone().text());
  assert.match(await res.text(), /^Records on .*: 1\n  Acme \|/);
  const none = await fetch(base + at(id) + '?as=text');
  assert.notEqual(none.status, 200, 'CONTROL: with enforcement on, a caller with no token at all is not let in');
});

test('an agent on its token alone reads the records only of a project it is on (403 otherwise), as task activity', async (t) => {
  const id = project();
  const tok = agents(t);
  assert.equal((await post(at(id), { name: 'Acme' }, { 'x-kosmos-agent-token': tok.mara })).status, 201);
  const theirs = await fetch(base + at(id) + '?as=text', { headers: { 'x-kosmos-agent-token': tok.otto } });
  assert.equal(theirs.status, 403, await theirs.clone().text());
  assert.match((await theirs.json()).error, /not on this project, so it cannot read its records/);
  const ours = await fetch(base + at(id) + '?as=text', { headers: { 'x-kosmos-agent-token': tok.mara } });
  assert.equal(ours.status, 200, 'CONTROL: a member reads them');
});
