'use strict';

/**
 * #1307: a project's webhooks over HTTP, on an ENFORCING board.
 *
 * - The settings routes (list / make / rename / delete) are board-token routes like the rest of
 *   /api, and never return a hash. Making one returns the full URL once.
 * - A call to that URL, with NO board token, adds a task to the project, marked as added by the
 *   webhook (by name) and given to nobody.
 * - A wrong secret and an unknown id answer the same 404; a deleted webhook stops answering; a
 *   renamed one keeps its URL.
 * - The board-token exemption covers ONLY the exact /hooks/<id>/<secret> shape.
 * - A call past the per-webhook limit answers 429.
 * - JSON only: a plain-text POST is refused by the board's cross-site guard.
 *
 * Network peers: the route is not in REMOTE_AGENT_ROUTES, so remoteWriteGuard refuses them before
 * this gate; that set is pinned exactly by server.remote-bind-1112.test.js.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE.
 *
 *   node --test server.webhooks-1307.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-hooks-'));
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
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState, HOOK_RATE } = require('./server');
const projects = require('./engine/projects');
const webhooks = require('./engine/webhooks');

const TOK = 'BOARDTOKEN_test_webhooks_0123456789abcdef';
let base;
let projectId;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = TOK;
  projectId = projects.create({ name: 'Alpha' }).id;
});
/* The limits are module state; each test starts from none, so no test's 429 depends on the calls
   an earlier one made in the same minute. */
test.beforeEach(() => { HOOK_RATE.seen.clear(); HOOK_RATE.byProject.clear(); });
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const api = async (p, { method = 'GET', body, token = TOK } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-kosmos-board-token'] = token;
  const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const call = async (url, body, type = 'application/json') => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': type }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const P = () => `/api/project/${encodeURIComponent(projectId)}/webhooks`;
const task = (n) => projects.get(projectId).tasks.find((t) => t.number === n);

test('the settings routes need the board token (CONTROL: enforcement is really on)', async () => {
  assert.equal((await api(P(), { token: null })).status, 403);
  assert.equal((await api(P(), { method: 'POST', body: {}, token: null })).status, 403);
  assert.equal((await api(P())).status, 200);
});

test('making a webhook returns its URL once, names it Webhook 1, 2..., and never returns a hash', async () => {
  const a = await api(P(), { method: 'POST', body: {} });
  assert.equal(a.status, 201);
  assert.equal(a.json.webhook.name, 'Webhook 1');
  assert.match(a.json.url, new RegExp('^http://127\\.0\\.0\\.1:\\d+/hooks/' + a.json.webhook.id + '/[A-Za-z0-9_-]{43}$'));
  const b = await api(P(), { method: 'POST', body: {} });
  assert.equal(b.json.webhook.name, 'Webhook 2');
  const listed = await api(P());
  assert.deepEqual(listed.json.webhooks.map((h) => h.name), ['Webhook 1', 'Webhook 2']);
  assert.doesNotMatch(JSON.stringify(listed.json), /hash|[A-Za-z0-9_-]{43}/, 'the list carries no hash and no secret');
  assert.doesNotMatch(JSON.stringify((await api('/api/projects')).json || {}), /"hash"/, 'the project records carry no hash');
});

test('a call with no board token adds a task marked with the webhook, given to nobody', async () => {
  const made = await api(P(), { method: 'POST', body: { name: 'Zapier' } });
  const r = await call(made.json.url, { title: 'Invoice 42 is overdue', detail: 'From the billing system.' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const t = task(r.json.task);
  assert.equal(t.sentence, 'Invoice 42 is overdue');
  assert.equal(t.detail, 'From the billing system.');
  assert.equal(t.addedVia, 'webhook');
  assert.equal(t.addedBy, 'Zapier');
  assert.ok(!t.who, 'given to nobody');
  const used = (await api(P())).json.webhooks.find((h) => h.name === 'Zapier');
  assert.ok(used.lastUsedAt, 'the settings list shows when it was last used');
});

test('a plain-text call is refused (the board\'s cross-site guard), and adds nothing', async () => {
  const made = await api(P(), { method: 'POST', body: { name: 'Script' } });
  const before = projects.get(projectId).tasks.length;
  const r = await call(made.json.url, 'Back up the drive', 'text/plain');
  assert.equal(r.status, 403, 'a simple-request POST is what any web page can send; JSON only');
  assert.equal(projects.get(projectId).tasks.length, before);
});

test('a wrong secret and an unknown id answer the same 404, and add nothing', async () => {
  const made = await api(P(), { method: 'POST', body: { name: 'Probe' } });
  const before = projects.get(projectId).tasks.length;
  const [, id] = made.json.url.match(/\/hooks\/([0-9a-f]{16})\//);
  const wrong = await call(base + '/hooks/' + id + '/' + 'A'.repeat(43), { title: 'x' });
  const unknown = await call(base + '/hooks/' + '0'.repeat(16) + '/' + 'A'.repeat(43), { title: 'x' });
  assert.equal(wrong.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(wrong.json, unknown.json, 'nothing tells a caller which webhooks exist');
  assert.equal(projects.get(projectId).tasks.length, before);
});

test('the board-token exemption is ONLY the exact /hooks/<id>/<secret> shape', async () => {
  const made = await api(P(), { method: 'POST', body: { name: 'Shape' } });
  const [, id, secret] = made.json.url.match(/\/hooks\/([0-9a-f]{16})\/(.+)$/);
  for (const bad of [made.json.url + '/extra', made.json.url + '/', made.json.url.slice(0, -1),
    base + '/hooks/' + id.toUpperCase() + '/' + secret, base + '/hooks/abc/def', base + '/hooks/' + '0'.repeat(16)]) {
    assert.equal((await call(bad, { title: 'x' })).status, 403, bad);
  }
  // A query string is not part of the path: the same link with one still works (control: the
  // exemption is on the parsed pathname, so it can neither widen nor break on a query).
  assert.equal((await call(made.json.url + '?from=zapier', { title: 'with a query' })).status, 201);
});

test('renaming keeps the URL; deleting revokes it at once', async () => {
  const made = await api(P(), { method: 'POST', body: { name: 'Temp' } });
  const id = made.json.webhook.id;
  const renamed = await api(P() + '/' + id + '/name', { method: 'POST', body: { name: 'Renamed' } });
  assert.equal(renamed.json.webhook.name, 'Renamed');
  assert.equal((await call(made.json.url, { title: 'still works' })).status, 201);
  assert.equal((await api(P() + '/' + id, { method: 'DELETE' })).status, 200);
  assert.equal((await call(made.json.url, { title: 'gone' })).status, 404);
});

test('bad input is refused with a sentence and adds nothing', async () => {
  const made = await api(P(), { method: 'POST', body: { name: 'Input' } });
  const before = projects.get(projectId).tasks.length;
  assert.equal((await call(made.json.url, { detail: 'no title' })).status, 400);
  assert.equal((await call(made.json.url, '{not json', 'application/json')).status, 400);
  assert.equal((await call(made.json.url, '[1,2]', 'application/json')).status, 400);
  assert.equal((await call(made.json.url, { title: '   ' })).status, 400);
  assert.equal((await api(P(), { method: 'POST', body: { name: 'x'.repeat(webhooks.NAME_MAX + 1) } })).status, 400);
  assert.equal(projects.get(projectId).tasks.length, before);
});

test('past 30 calls a minute a webhook answers 429', async () => {
  const made = await api(P(), { method: 'POST', body: { name: 'Burst' } });
  let last; let ok = 0;
  for (let i = 0; i < 31; i += 1) { last = await call(made.json.url, { title: 'burst ' + i }); if (last.status === 201) ok += 1; }
  assert.equal(ok, HOOK_RATE.perMinute, 'the first 30 really added tasks');
  assert.equal(last.status, 429);
});

test('a deleted project takes its webhooks with it; a new project reusing its id inherits none', async () => {
  const old = projects.create({ name: 'Reused' });
  const made = await api(`/api/project/${encodeURIComponent(old.id)}/webhooks`, { method: 'POST', body: {} });
  assert.equal(made.status, 201);
  projects.remove(old.id);
  assert.equal(webhooks.list(old.id, old.createdAt).length, 0, 'removed with the project');
  const again = projects.create({ name: 'Reused' });
  assert.equal(again.id, old.id, 'fixture: the id really is reused');
  assert.equal((await api(`/api/project/${encodeURIComponent(again.id)}/webhooks`)).json.webhooks.length, 0);
  assert.equal((await call(made.json.url, { title: 'into the wrong project' })).status, 404);
  assert.equal(projects.get(again.id).tasks.length, 0);
});

test('an orphan the clean-up missed still answers for nobody: the project stamp refuses it', async () => {
  const old = projects.create({ name: 'Stamped' });
  const made = await api(`/api/project/${encodeURIComponent(old.id)}/webhooks`, { method: 'POST', body: {} });
  // Simulate the clean-up failing: remove the project record only, bypassing projects.remove.
  const orig = webhooks.removeProject;
  webhooks.removeProject = () => { throw new Error('simulated'); };
  try { projects.remove(old.id); } finally { webhooks.removeProject = orig; }
  const again = projects.create({ name: 'Stamped' });
  assert.equal(again.id, old.id);
  assert.equal((await api(`/api/project/${encodeURIComponent(again.id)}/webhooks`)).json.webhooks.length, 0, 'not listed on the new project');
  assert.equal((await call(made.json.url, { title: 'orphan' })).status, 404);
  assert.equal(projects.get(again.id).tasks.length, 0);
  // And it does not sit in the store forever: the next change anywhere sweeps it out.
  const file = path.join(require('./engine/store').ROOT, 'webhooks', 'webhooks.json');
  const orphanId = made.json.webhook.id;
  assert.ok(fs.readFileSync(file, 'utf8').includes(orphanId), 'fixture: the orphan really is in the file');
  await api(`/api/project/${encodeURIComponent(again.id)}/webhooks`, { method: 'POST', body: {} });
  assert.ok(!fs.readFileSync(file, 'utf8').includes(orphanId), 'the orphan was swept on the next change');
});

test('a project gets at most 120 webhook tasks an hour across all its webhooks', async () => {
  const p = projects.create({ name: 'Hourly' });
  const url = [];
  for (let i = 0; i < 5; i += 1) url.push((await api(`/api/project/${encodeURIComponent(p.id)}/webhooks`, { method: 'POST', body: {} })).json.url);
  let ok = 0; let last;
  for (let i = 0; i < 125; i += 1) { last = await call(url[i % 5], { title: 'h' + i }); if (last.status === 201) ok += 1; }
  assert.equal(ok, HOOK_RATE.perProjectHour);
  assert.equal(last.status, 429);
  assert.match(last.json.error, /last hour/);
});

test('a webhooks file that is not JSON: calls answer 404, the list answers 503, and making one moves it aside and works', async () => {
  const file = path.join(require('./engine/store').ROOT, 'webhooks', 'webhooks.json');
  const made = await api(P(), { method: 'POST', body: { name: 'Before' } });
  fs.writeFileSync(file, '{broken');
  assert.equal((await call(made.json.url, { title: 'x' })).status, 404);
  assert.equal((await api(P())).status, 503);
  const fresh = await api(P(), { method: 'POST', body: {} });
  assert.equal(fresh.status, 201, JSON.stringify(fresh.json));
  assert.ok(fs.readdirSync(path.dirname(file)).some((n) => n.startsWith('webhooks.json.unreadable-')), 'the bad file is kept aside, not deleted');
  assert.equal((await call(fresh.json.url, { title: 'after recovery' })).status, 201);
});

test('the store on disk holds the hash, never the secret', async () => {
  const made = await api(P(), { method: 'POST', body: { name: 'Disk' } });
  const secret = made.json.url.split('/').pop();
  const raw = fs.readFileSync(path.join(require('./engine/store').ROOT, 'webhooks', 'webhooks.json'), 'utf8');
  assert.ok(raw.includes(made.json.webhook.id), 'control: this is the file that holds it');
  assert.ok(!raw.includes(secret), 'the secret is not on disk');
  assert.ok(raw.includes(require('node:crypto').createHash('sha256').update(secret).digest('hex')), 'its hash is');
});

test('an agent cannot give a webhook task to anyone; the screen can (the task waits for a person)', async () => {
  const tasks = require('./engine/tasks');
  const p = projects.create({ name: 'Give' });
  projects.addAgent(p.id, 'ada', [{ sessionName: 'ada' }]);
  const made = await api(`/api/project/${encodeURIComponent(p.id)}/webhooks`, { method: 'POST', body: {} });
  const n = (await call(made.json.url, { title: 'outside words' })).json.task;
  assert.throws(() => tasks.assignPart(p.id, n, 1, 'ada', { via: 'process' }), /from the screen, by a person/);
  assert.throws(() => tasks.addPart(p.id, n, { sentence: 'do it', who: 'ada', made: { via: 'process' } }), /from the screen, by a person/);
  assert.throws(() => tasks.assignPart(p.id, n, 1, 'ada', { via: 'assigner' }), /from the screen, by a person/);
  assert.equal(tasks.assignPart(p.id, n, 1, 'ada', { via: 'screen' }).ok, true, 'control: a person can');
  assert.equal(tasks.assignPart(p.id, n, 1, null, { via: 'process' }).ok, true, 'taking someone off is always allowed');
  const plain = tasks.create(p.id, { sentence: 'from the screen', made: { via: 'screen' } });
  assert.equal(tasks.assignPart(p.id, plain.number, 1, 'ada', { via: 'process' }).ok, true, 'control: an ordinary task an agent can give');
});

test('past 200 open webhook tasks a project refuses more until some are closed', async () => {
  const p = projects.create({ name: 'Waiting' });
  const made = await api(`/api/project/${encodeURIComponent(p.id)}/webhooks`, { method: 'POST', body: {} });
  const old = HOOK_RATE.openMax;
  HOOK_RATE.openMax = 3;
  try {
    for (let i = 0; i < 3; i += 1) assert.equal((await call(made.json.url, { title: 'w' + i })).status, 201);
    const over = await call(made.json.url, { title: 'one too many' });
    assert.equal(over.status, 429);
    assert.match(over.json.error, /open tasks from webhooks/);
    require('./engine/tasks').close(p.id, 1);
    assert.equal((await call(made.json.url, { title: 'after closing one' })).status, 201, 'control: closing one makes room');
  } finally { HOOK_RATE.openMax = old; }
});
