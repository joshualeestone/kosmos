'use strict';
require('./test-support/tmpscope');

/**
 * kosmos#7989 slice 3: POST /api/file-notices/take hands an agent its OWN waiting file-owner notices once. The caller
 * is resolved as GET /api/inbox resolves it, with no agent parameter. `as=hook` is what Kosmos's Claude Code hook
 * prints (empty when there is nothing, and on every failure).
 *
 *   node --test server.filenotices-7989.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-7989fn-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const fn = require('./engine/filenotices');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [require('./engine/store').ROOT, fn.fileFor('leo')]);

const TOK = 'BOARDTOKEN_7989_0123456789abcdef';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.token = TOK;
});
test.after(() => { try { server.close(); } catch { /* best effort */ } });

function withBoard(fn2) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('nova', { state: 'idle' })]);
  return Promise.resolve().then(() => fn2()).finally(() => board.restore());
}
async function post(p, headers = {}, method = 'POST') {
  const res = await fetch(base + p, { method, headers, redirect: 'manual' });
  const text = await res.text().catch(() => '');
  let json = {}; try { json = JSON.parse(text); } catch { /* text arm */ }
  return { code: res.status, json, text };
}

test('an agent takes its own notices once, and never another agent\'s', async () => {
  boardAuthState.on = false;
  await withBoard(async () => {
    fn.queue('leo', 'nova was about to change "plan.md"');
    fn.queue('nova', 'SECRET FOR NOVA ONLY');
    const tok = sendertoken.mint('leo').token;
    try {
      const r = await post('/api/file-notices/take', { 'x-kosmos-agent-token': tok });
      assert.equal(r.code, 200, r.text);
      assert.deepEqual(r.json.notices.map((n) => n.text), ['nova was about to change "plan.md"']);
      assert.doesNotMatch(r.text, /SECRET FOR NOVA/);
      const again = await post('/api/file-notices/take?as=text', { 'x-kosmos-agent-token': tok });
      assert.equal(again.text, 'No file notices are waiting for you.\n', 'taken once');
      assert.equal(fn.take('nova').notices.length, 1, 'nova\'s are still waiting for nova');
    } finally { sendertoken.revoke('leo'); }
  });
});

test('as=hook: the UserPromptSubmit JSON when there is a notice, an empty body when there is none or the caller is refused', async () => {
  boardAuthState.on = true;
  await withBoard(async () => {
    const tok = sendertoken.mint('leo').token;
    try {
      fn.queue('leo', 'nova was about to change "a.md"');
      const r = await post('/api/file-notices/take?as=hook', { 'x-kosmos-agent-token': tok });
      assert.equal(r.code, 200, r.text);
      assert.equal(r.json.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
      assert.match(r.json.hookSpecificOutput.additionalContext, /nova was about to change "a\.md"/);
      const none = await post('/api/file-notices/take?as=hook', { 'x-kosmos-agent-token': tok });
      assert.equal(none.code, 200);
      assert.equal(none.text, '');
      fn.queue('leo', 'kept for leo');
      const refused = await post('/api/file-notices/take?as=hook', {});
      assert.notEqual(refused.code, 200, 'control: no credential on an enforcing board is refused');
      assert.equal(refused.text, '', 'and the hook form says nothing');
      assert.equal(fn.take('leo').notices.length, 1, 'a refused take clears nothing');
    } finally { sendertoken.revoke('leo'); boardAuthState.on = false; }
  });
});

test('a GET does not take them', async () => {
  boardAuthState.on = false;
  await withBoard(async () => {
    const tok = sendertoken.mint('leo').token;
    try {
      fn.queue('leo', 'still here');
      await post('/api/file-notices/take', { 'x-kosmos-agent-token': tok }, 'GET');
      assert.equal(fn.take('leo').notices.length, 1);
    } finally { sendertoken.revoke('leo'); }
  });
});
