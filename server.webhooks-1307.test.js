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
const { start, server, boardAuthState } = require('./server');
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
  for (const bad of [made.json.url + '/extra', made.json.url.slice(0, -1), base + '/hooks/abc/def', base + '/hooks/' + '0'.repeat(16)]) {
    assert.equal((await call(bad, { title: 'x' })).status, 403, bad);
  }
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
  let last;
  for (let i = 0; i < 31; i += 1) last = await call(made.json.url, { title: 'burst ' + i });
  assert.equal(last.status, 429);
});
