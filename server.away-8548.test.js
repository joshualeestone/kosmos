'use strict';
require('./test-support/tmpscope');

/**
 * kosmos#8548: GET /api/away tells an agent what reached it while it was not running: room posts to it, `kosmos msg`
 * messages to it and the person's direct messages, from its last report to now (`at=startup`, the hook, called before
 * `started`), or the window its newest startup had (by hand). The caller is resolved as /api/file-notices/take
 * resolves it, with no agent parameter. `as=hook` is what Kosmos's Claude Code hook prints (empty when there is
 * nothing, and on every failure).
 *
 *   node --test server.away-8548.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-8548away-'));
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
const selfreport = require('./engine/selfreport');
const messages = require('./engine/messages');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [require('./engine/store').ROOT, selfreport.fileFor('leo'), messages.LOG]);

const TOK = 'BOARDTOKEN_8548_0123456789abcdef';
const H = 60 * 60 * 1000;
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.token = TOK;
});
test.after(() => { try { server.close(); } catch { /* best effort */ } });

function withBoard(fn2) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('nova', { state: 'idle' })]);
  return Promise.resolve().then(() => fn2()).finally(() => {
    board.restore();
    // The fleet fixture reads these as the agents' state: one test's history must not reach the next one's fleet.
    for (const n of ['leo', 'nova']) { try { fs.rmSync(selfreport.fileFor(n), { force: true }); } catch { /* none */ } }
  });
}
async function get(p, headers = {}) {
  const res = await fetch(base + p, { headers, redirect: 'manual' });
  const text = await res.text().catch(() => '');
  let json = {}; try { json = JSON.parse(text); } catch { /* text arm */ }
  return { code: res.status, json, text };
}
const iso = (t) => new Date(t).toISOString();
/* The agent's report history, oldest first, written as selfreport.record writes it (one JSON line each). */
function reports(name, rows) {
  const file = selfreport.fileFor(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify({ ...r, at: iso(r.at) })).join('\n') + '\n');
}
function logRows(rows) {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.writeFileSync(messages.LOG, rows.map((r) => JSON.stringify({ ...r, at: iso(r.at) })).join('\n') + '\n');
}

test('at=startup: posts, messages since the last report; the text and JSON forms; nothing for another agent', async () => {
  boardAuthState.on = false;
  await withBoard(async () => {
    const now = Date.now();
    reports('leo', [{ state: 'started', at: now - 10 * H }, { state: 'working', at: now - 3 * H }]);
    logRows([
      { kind: 'post', outcomes: { leo: 'could_not' }, id: 'm1', project: 'fleet', from: 'nova', to: ['leo', 'nova'], text: 'BEFORE', at: now - 4 * H },
      { kind: 'post', outcomes: { leo: 'could_not' }, id: 'm2', project: 'fleet', from: 'nova', to: ['leo', 'nova'], text: 'SECRET WORDS', mentioned: ['leo'], at: now - 2 * H },
      { kind: 'post', outcomes: { leo: 'could_not' }, id: 'm3', project: 'fleet', from: 'leo', to: ['leo', 'nova'], text: 'mine', at: now - 2 * H },
      { kind: 'refused', from: 'nova', to: 'leo', because: 'leo is not running', at: now - H },
      { kind: 'message', id: 'x2', from: 'nova', to: 'leo', text: 'typed into a running leo', state: 'placed', at: now - H },
    ]);
    const tok = sendertoken.mint('leo').token;
    const ntok = sendertoken.mint('nova').token;
    try {
      const hook = await get('/api/away?as=hook&at=startup', { 'x-kosmos-agent-token': tok });
      assert.equal(hook.code, 200, hook.text);
      const ctx = hook.json.hookSpecificOutput;
      assert.equal(ctx.hookEventName, 'SessionStart');
      assert.match(ctx.additionalContext, /- fleet: 1 post to you; naming you or from the person: m2\. Read it with: kosmos room fleet/);
      assert.match(ctx.additionalContext, /- at least 1 message from other agents to you refused, for any reason \(nova\)\./);
      assert.doesNotMatch(ctx.additionalContext, /SECRET WORDS|BEFORE/);
      const json = await get('/api/away?at=startup', { 'x-kosmos-agent-token': tok });
      assert.deepEqual(json.json.counts, { posts: 1, refused: 1, direct: 0 });
      const other = await get('/api/away?as=hook&at=startup', { 'x-kosmos-agent-token': ntok });
      assert.equal(other.code, 200);
      assert.equal(other.text, '', 'nova has no report history here, so no window: nothing');
    } finally { sendertoken.revoke('leo'); sendertoken.revoke('nova'); }
  });
});

test('by hand: the window the newest startup had, not what arrived since', async () => {
  boardAuthState.on = false;
  await withBoard(async () => {
    const now = Date.now();
    reports('leo', [{ state: 'working', at: now - 5 * H }, { state: 'started', at: now - 2 * H }, { state: 'working', at: now - H }]);
    logRows([
      { kind: 'post', outcomes: { leo: 'could_not' }, id: 'm1', project: 'fleet', from: 'nova', to: ['leo'], text: 'x', at: now - 3 * H },
      { kind: 'post', outcomes: { leo: 'could_not' }, id: 'm9', project: 'fleet', from: 'nova', to: ['leo'], text: 'x', mentioned: ['leo'], at: now - 30 * 60 * 1000 },
    ]);
    const tok = sendertoken.mint('leo').token;
    try {
      const r = await get('/api/away?as=text', { 'x-kosmos-agent-token': tok });
      assert.equal(r.code, 200, r.text);
      assert.match(r.text, /- fleet: 1 post to you\. Read it with: kosmos room fleet\n$/);
      assert.doesNotMatch(r.text, /m9/, 'a post after the startup is not part of that startup\'s window');
      logRows([]);
      assert.equal((await get('/api/away?as=text', { 'x-kosmos-agent-token': tok })).text, 'Nothing arrived for you while you were not running.\n');
      reports('leo', [{ state: 'working', at: now - H }]);
      assert.match((await get('/api/away?as=text', { 'x-kosmos-agent-token': tok })).text, /^Kosmos has no earlier report from you/);
    } finally { sendertoken.revoke('leo'); }
  });
});

test('on an enforcing board a caller with no credential is refused, and the hook form says nothing', async () => {
  await withBoard(async () => {
    boardAuthState.on = true;
    const now = Date.now();
    reports('leo', [{ state: 'working', at: now - 3 * H }]);
    logRows([{ kind: 'post', outcomes: { leo: 'could_not' }, id: 'm2', project: 'fleet', from: 'nova', to: ['leo'], text: 'x', at: now - H }]);
    const tok = sendertoken.mint('leo').token;
    try {
      const refused = await get('/api/away?as=hook&at=startup');
      assert.notEqual(refused.code, 200);
      assert.equal(refused.text, '');
      const bare = await get('/api/away?at=startup&from_pane=%251');
      assert.notEqual(bare.code, 200, bare.text);
      const ok = await get('/api/away?as=hook&at=startup', { 'x-kosmos-agent-token': tok });
      assert.equal(ok.code, 200, 'control: the agent\'s own token is answered: ' + ok.text);
      assert.match(ok.text, /^\{"hookSpecificOutput":/);
    } finally { sendertoken.revoke('leo'); boardAuthState.on = false; }
  });
});

test('a POST is not this route', async () => {
  boardAuthState.on = false;
  const res = await fetch(base + '/api/away?as=hook', { method: 'POST', redirect: 'manual' });
  await res.text().catch(() => '');
  assert.notEqual(res.status, 200);
});
