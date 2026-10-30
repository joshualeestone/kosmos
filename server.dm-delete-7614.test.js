'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7614: the route the board (and the phone) call to delete one of the person's own direct messages,
 * POST /api/agent/:name/thread/delete with { at }. The engine's behaviour is pinned in
 * engine/chat.dm-delete-7614.test.js; this pins the route: its answers, its name gate, and that only the person's own
 * row goes. Real thread rows through the real route; the note to the agent is recorded instead of typed.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dmdelete-7614-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./engine/store');
const chat = require('./engine/chat');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');

const NAME = 'del7614';
assertSandboxedDataRoot(SANDBOX, [store.ROOT, chat.threadFile(chat.DIRECT, NAME)]);

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const t = (n) => new Date(Date.UTC(2026, 9, 30, 12, 0, n)).toISOString();
chat.appendMessage(chat.DIRECT, NAME, { text: 'delete me', at: t(1), delivery: { state: chat.DELIVERY.PLACED } });
chat.appendMessage(chat.DIRECT, NAME, { text: 'the agent wrote this', from: NAME, at: t(2) });
const rows = () => chat.readThread(chat.DIRECT, NAME).messages.map((m) => m.at);

async function del(name, body, origin, headers) {
  const board = fleet.install([fleet.agent(NAME, { state: 'idle' })]);
  const real = chat.deliverAutomaticAsync;
  const typed = [];
  chat.deliverAutomaticAsync = async (n, line) => { typed.push({ n, line }); return { state: chat.DELIVERY.PLACED }; };
  try {
    const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/thread/delete`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), ...(headers || {}) }, body: JSON.stringify(body),
    });
    return { status: res.status, out: await res.json().catch(() => null), typed };
  } finally { chat.deliverAutomaticAsync = real; board.restore(); }
}

test('#7614 route: the agent\'s own message is refused (403) and stays', async () => {
  const r = await del(NAME, { at: t(2) });
  assert.equal(r.status, 403);
  assert.deepEqual(rows(), [t(1), t(2)]);
  assert.equal(r.typed.length, 0);
});

test('#7614 route: a body without a time is refused (400); no message at that time is 404', async () => {
  assert.equal((await del(NAME, {})).status, 400);
  assert.equal((await del(NAME, { at: t(9) })).status, 404);
});

test('#7614 route: another site cannot delete (the board\'s cross-site guard)', async () => {
  const r = await del(NAME, { at: t(1) }, 'http://evil.example');
  assert.ok(r.status >= 400, 'refused, got ' + r.status);
  assert.deepEqual(rows(), [t(1), t(2)], 'still there');
});

test('#7614 review 1: an agent\'s token is refused (403), in the header or the body, and the person\'s message stays', async () => {
  const h = await del(NAME, { at: t(1) }, null, { 'x-kosmos-agent-token': 'any-agent-token' });
  const b = await del(NAME, { at: t(1), token: 'any-agent-token' });
  for (const r of [h, b]) {
    assert.equal(r.status, 403);
    assert.match(r.out.error, /person's, not an agent's/);
    assert.equal(r.typed.length, 0);
  }
  assert.deepEqual(rows(), [t(1), t(2)], 'still there');
});

test('#7614 route: the person\'s own message goes, and the answer names the agent told', async () => {
  const r = await del(NAME, { at: t(1) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.out, { deleted: true, at: t(1), told: [NAME] });
  assert.deepEqual(rows(), [t(2)], 'only the person\'s message is gone');
  assert.equal(r.typed.length, 1);
});
