'use strict';
/**
 * #4466: GET /api/health is the CLI's cheap health probe, so a busy board is not read as "not running".
 *
 * It must answer on an ENFORCING board with no token (the CLI's health check runs before it has
 * read anything), carry the identity the CLI matches ("app":"kosmos"), stay a few bytes (the whole
 * point: the old probe fetched the app page), carry no account data, and answer GET and HEAD only.
 * The control is a gated route on the same enforcing board: it must still refuse without a token,
 * so this proves the exemption is this one route and not the gate being off.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-health4466-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = true;
  boardAuthState.token = 'BOARDTOKEN_test_4466_0123456789abcdef';
});
test.after(() => { server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('#4466: /api/health answers an enforcing board with no token, in a few bytes, as Kosmos', async () => {
  const res = await fetch(base + '/api/health');
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /"app":"kosmos"/, 'the CLI identifies the board by this');
  assert.ok(body.length < 100, `a health answer must stay tiny (got ${body.length} bytes)`);
  assert.deepEqual(JSON.parse(body), { app: 'kosmos', ok: true }, 'a fixed body: no account data');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('#4466 CONTROL: a gated route on the same board still refuses with no token', async () => {
  const res = await fetch(base + '/api/status');
  await res.text().catch(() => {});
  assert.equal(res.status, 403, 'the gate is on, so the health answer above is the exemption, not an open board');
});

test('#4466: HEAD /api/health answers with no body; a write to it does not reach the health answer', async () => {
  const head = await fetch(base + '/api/health', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await fetch(base + '/api/health', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  const text = await post.text();
  assert.notEqual(post.status, 200, 'POST must not be answered as health');
  assert.doesNotMatch(text, /"app":"kosmos"/);
});

test('#4466: the page is still what an older CLI probes, and it is much larger than the health answer', async () => {
  const page = await (await fetch(base + '/')).text();
  assert.match(page, /Kosmos|Agent Workforce/, 'an older CLI (and the fallback) matches the page');
  assert.ok(page.length > 10000, 'if the page were tiny this change would have been pointless: pin the premise');
});
