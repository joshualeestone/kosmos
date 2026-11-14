'use strict';
/* kosmos#8519: what agents found about a connection's actions, against the real server. A refused plugin call on
 * POST /api/toolfail becomes a finding; POST /api/connections/found names its caller from the token, never the body;
 * GET /api/connections/found reads the disk only.
 *   node --test server.connfound-8519.test.js */
require('./test-support/tmpscope'); // this process's temp folders, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connfound-8519-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connfound-8519-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connfound-8519-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connfound-8519-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connfound-8519-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const store = require('./engine/store');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const toolloop = require('./engine/toolloop');

test.before(async () => { toolloop.setLateMsForTests(0); await start(0); });
test.after(() => {
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

const base = () => `http://127.0.0.1:${server.address().port}`;
async function call(method, route, body, headers) {
  const res = await fetch(base() + route, {
    method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
function reset() { try { fs.rmSync(path.join(store.ROOT, 'connfound.json'), { force: true }); } catch { /* none */ } }
const SIG = 'd'.repeat(64);

test('a refused plugin call on /api/toolfail is a finding; a plain failure and a local refusal are not', async (t) => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => board.restore());
  reset(); toolloop.forget('leo');
  const tok = sendertoken.mint('leo').token;
  const h = { 'x-kosmos-agent-token': tok };
  assert.equal((await call('POST', '/api/toolfail', { tool: 'mcp__hubspot__merge_contacts', sig: SIG, error: 'Unknown tool: merge_contacts', from_pane: '' }, h)).json.recorded, true);
  await call('POST', '/api/toolfail', { tool: 'mcp__hubspot__get_deal', sig: 'e'.repeat(64), error: 'Invalid input: id', from_pane: '' }, h);
  await call('POST', '/api/toolfail', { tool: 'mcp__hubspot__delete_deal', sig: 'f'.repeat(64), error: 'Permission to use mcp__hubspot__delete_deal has been denied', from_pane: '' }, h);
  await call('POST', '/api/toolfail', { tool: 'Bash', sig: 'a'.repeat(64), error: 'HTTP 403 Forbidden', from_pane: '' }, h);
  const r = await call('GET', '/api/connections/found', undefined, h);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.services.map((s) => [s.name, s.kind, s.actions.map((a) => [a.action, a.outcome, a.by, a.how])]),
    [['hubspot', 'other', [['merge_contacts', 'not-offered', 'leo', 'auto']]]]);
});

test('the error line is only sorted, never kept: nothing it says (a token, a path) reaches the store', async (t) => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  t.after(() => board.restore());
  reset();
  const tok = sendertoken.mint('leo').token;
  await call('POST', '/api/toolfail', { tool: 'mcp__crm__export', sig: 'b'.repeat(64), error: 'MCP error -32601: Unknown tool: export', from_pane: '' }, { 'x-kosmos-agent-token': tok });
  const raw = fs.readFileSync(path.join(store.ROOT, 'connfound.json'), 'utf8');
  assert.ok(raw.includes('"export"') && raw.includes('not-offered'), 'CONTROL: the finding was written');
  for (const piece of ['Unknown tool', '32601', tok]) assert.ok(!raw.includes(piece), piece + ' is not in the store');
  // A refusal the hook does not record (a 403 carrying a token and a path) leaves the store exactly as it was.
  await call('POST', '/api/toolfail', { tool: 'mcp__crm__delete', sig: 'c'.repeat(64), error: 'HTTP 403 Forbidden for token ' + tok + ' at /Users/someone/x', from_pane: '' }, { 'x-kosmos-agent-token': tok });
  assert.equal(fs.readFileSync(path.join(store.ROOT, 'connfound.json'), 'utf8'), raw);
});

test('POST /api/connections/found names the caller from its token, files a Kosmos connection apart, and refuses nonsense', async (t) => {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  t.after(() => board.restore());
  reset();
  const h = { 'x-kosmos-agent-token': sendertoken.mint('leo').token };
  const ok = await call('POST', '/api/connections/found', { service: 'GitHub', action: 'create release', outcome: 'needs-scope', note: 'token lacks contents write', from: 'mara', from_pane: '' }, h);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.recorded, true);
  const plugin = await call('POST', '/api/connections/found', { service: 'Acme CRM', action: 'search', outcome: 'works', from_pane: '' }, h);
  assert.equal(plugin.json.recorded, true);
  const bad = await call('POST', '/api/connections/found', { service: 'GitHub', action: 'x', outcome: 'perhaps', from_pane: '' }, h);
  assert.equal(bad.status, 400);
  assert.match(bad.json.because, /outcome is one of/);
  const anon = await call('POST', '/api/connections/found', { service: 'GitHub', action: 'y', outcome: 'works', from_pane: '' });
  assert.equal(anon.json.recorded, false, 'no credential and no pane records nothing');
  const all = (await call('GET', '/api/connections/found', undefined, h)).json.services;
  const gh = all.find((s) => s.name === 'GitHub');
  assert.equal(gh.kind, 'kosmos', 'a connection Kosmos makes is filed as Kosmos\'s');
  assert.equal(gh.actions[0].by, 'leo', 'the token decides who found it, not the body\'s "from"');
  assert.equal(all.find((s) => s.name === 'Acme CRM').kind, 'other');
  const one = (await call('GET', '/api/connections/found?service=github', undefined, h)).json.services;
  assert.deepEqual(one.map((s) => s.name), ['GitHub'], '?service= narrows by the service key');
  // Review 4: --outside files a plugin of the same name apart from Kosmos's own connection.
  const out = await call('POST', '/api/connections/found', { service: 'GitHub', action: 'create release', outcome: 'needs-scope', outside: true, from_pane: '' }, h);
  assert.equal(out.json.recorded, true);
  const both = (await call('GET', '/api/connections/found?service=github', undefined, h)).json.services;
  assert.deepEqual(both.map((s) => s.kind).sort(), ['kosmos', 'other'], 'two rows: Kosmos\'s GitHub and the plugin');
  // Review 5: a door Kosmos offers but this computer never connected is a plugin's name here, not Kosmos's connection.
  const notion = await call('POST', '/api/connections/found', { service: 'Notion', action: 'search', outcome: 'needs-permission', from_pane: '' }, h);
  assert.equal(notion.json.recorded, true);
  const n = (await call('GET', '/api/connections/found?service=notion', undefined, h)).json.services;
  assert.deepEqual(n.map((s) => s.kind), ['other'], 'an unconnected door name files as outside Kosmos');
});

test('GET /api/connections/found is refused to another site, like /held', async () => {
  const r = await call('GET', '/api/connections/found', undefined, { 'sec-fetch-site': 'cross-site' });
  assert.equal(r.status, 403);
});
