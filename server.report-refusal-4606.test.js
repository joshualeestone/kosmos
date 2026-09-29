'use strict';

/**
 * #4606 (follow-up to #4602, #4580 item 13): on an enforcing board, `kosmos report`, `kosmos report show` and
 * `kosmos reply` sent with NO credential at all are told a token is missing, not only whose board this is (which
 * an agent read as "another machine's board"). A board token that was sent and did not match keeps today's words.
 * Both refuse: the words change, never who gets in.
 *
 * Same sandbox posture as server.report-reply-loopback-1968.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-4606-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const messages = require('./engine/messages');

const TOK = 'BOARDTOKEN_4606_0123456789abcdef';
const MISSING = /^no board token or agent token came with this request, and this board only /;
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.token = TOK;
});
test.after(() => {
  boardAuthState.on = false;
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

function withLeo(fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  return Promise.resolve().then(() => fn()).finally(() => { messages.setRunner(null); board.restore(); });
}

async function call(method, p, { headers = {}, body } = {}) {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual',
  });
  const text = await res.text().catch(() => '');
  let json = {};
  try { json = JSON.parse(text); } catch { /* leave {} */ }
  return { code: res.status, json, text };
}

/* The three routes, each with its refusal flag and its own existing sentence. */
const ROUTES = [
  { name: 'report', go: (h) => call('POST', '/api/report', { headers: h, body: { state: 'idle', from_pane: '%3' } }), flag: 'recorded',
    words: 'this board only records a report from the account that started it; run `kosmos report` from that account, or present an agent token' },
  { name: 'reply', go: (h) => call('POST', '/api/reply', { headers: h, body: { text: 'on it', from_pane: '%3' } }), flag: 'kept',
    words: 'this board only keeps a reply from the account that started it; run `kosmos reply` from that account, or present an agent token' },
  { name: 'report show', go: (h) => call('GET', '/api/report?from_pane=%253', { headers: h }), flag: null,
    words: 'this board only shows a report to the account that started it; run `kosmos report show` from that account, or present an agent token' },
];
const becauseOf = (r) => r.json.because || r.json.error || '';

for (const route of ROUTES) {
  test(`#4606: a ${route.name} with no credential at all is told the token is missing, and is still refused`, async () => {
    boardAuthState.on = true;
    await withLeo(async () => {
      const r = await route.go({});
      assert.match(becauseOf(r), MISSING, r.text);
      assert.ok(becauseOf(r).endsWith(route.words), 'the route\'s own sentence must follow: ' + r.text);
      if (route.flag) assert.equal(r.json[route.flag], false, 'DANGEROUS: a no-credential ' + route.name + ' got through: ' + r.text);
    });
  });

  test(`#4606 CONTROL: a ${route.name} with a WRONG board token keeps today's words exactly`, async () => {
    boardAuthState.on = true;
    await withLeo(async () => {
      const r = await route.go({ 'x-kosmos-board-token': 'not-the-token' });
      assert.equal(becauseOf(r), route.words, r.text);
    });
  });
}

test('#4606 CONTROL: the right board token still lets a report through (the words changed, not who gets in)', async () => {
  boardAuthState.on = true;
  await withLeo(async () => {
    const r = await ROUTES[0].go({ 'x-kosmos-board-token': TOK });
    assert.equal(r.json.recorded, true, r.text);
  });
});
