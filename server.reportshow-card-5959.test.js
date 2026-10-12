'use strict';

/**
 * #5959: `kosmos report show` also says what the agent's CARD shows (the page's own word), and points out a waiting
 * state that has stood over a day. Harness from server.report-readback-2709.test.js.
 *
 * `kosmos report` was write-only, so an agent could set its state (incl a
 * needs_you it is TOLD to clear once answered) but never check it -- and memory
 * of it does not survive a compaction. The new read-back returns ONLY the
 * caller's own report, authenticated exactly like POST /api/report
 * (resolveAgentSender, token-first then pane), so it is never a window onto the
 * roster (that stays account-gated).
 *
 * Same sandbox posture as server.liveness-refused-2558.test.js.
 *
 *   node --test server.report-readback-2709.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5959-'));
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
const sendertoken = require('./engine/sendertoken');
const selfreport = require('./engine/selfreport');
const liveness = require('./engine/liveness');

const TOK = 'BOARDTOKEN_5959_0123456789abcdef';
const WHO = 'leo';   // sender.card.sessionName for the fleet 'leo' agent
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.token = TOK;
});

function clearStores() {
  for (const dir of [sendertoken.DIR, liveness.DIR, selfreport.DIR]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* not there yet */ }
  }
}
test.beforeEach(clearStores);
test.after(() => {
  boardAuthState.on = false;
  try { server.close(); } catch { /* ignore */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

function withLeo(fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  return Promise.resolve().then(() => fn()).finally(() => { messages.setRunner(null); board.restore(); });
}

async function post(p, { headers = {}, body }) {
  const res = await fetch(base + p, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body), redirect: 'manual',
  });
  const text = await res.text().catch(() => '');
  let json = {}; try { json = JSON.parse(text); } catch { /* leave {} */ }
  return { code: res.status, json, text };
}
async function get(p, { headers = {} } = {}) {
  const res = await fetch(base + p, { method: 'GET', headers, redirect: 'manual' });
  const text = await res.text().catch(() => '');
  let json = {}; try { json = JSON.parse(text); } catch { /* leave {} for as=text */ }
  return { code: res.status, json, text, type: res.headers.get('content-type') || '' };
}


const store = require('./engine/store');
/* A self-report line dated `at`, in the store's own line format: selfreport.record stamps now, and this test needs an
   old one. */
function backdate(name, state, at) {
  fs.mkdirSync(selfreport.DIR, { recursive: true });
  fs.appendFileSync(path.join(selfreport.DIR, store.safeKey(name) + '.jsonl'),
    JSON.stringify({ v: 1, state, because: 'which colour?', on: null, owner: null, until: null, project: null, left: null, at, by: 'agent' }) + '\n');
}

test('#5959: report show says what the card shows, in the page\'s own word', async () => {
  boardAuthState.on = false;
  await withLeo(async () => {
    const tok = sendertoken.mint(WHO).token;
    const asked = await post('/api/report', { headers: { 'x-kosmos-agent-token': tok }, body: { state: 'needs_you', text: 'which colour?' } });
    assert.equal(asked.json.recorded, true, asked.text);
    const t = await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': tok } });
    assert.equal(t.code, 200, t.text);
    assert.match(t.text, /^Your card on the board shows: Question\.\n/, t.text);
    const j = await get('/api/report', { headers: { 'x-kosmos-agent-token': tok } });
    assert.deepEqual([j.json.card && j.json.card.label, j.json.stale], ['Question', false], j.text);
  });
});

test('#5959: a waiting state standing over a day is pointed out; a fresh one is not', async () => {
  boardAuthState.on = false;
  await withLeo(async () => {
    const tok = sendertoken.mint(WHO).token;
    backdate(WHO, 'blocked', new Date(Date.now() - 2.5 * 24 * 3600e3).toISOString());
    const old = await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': tok } });
    assert.match(old.text, /This blocked has been standing for 2 days\. If nobody needs to answer it any more, clear it/, old.text);
    assert.equal((await get('/api/report', { headers: { 'x-kosmos-agent-token': tok } })).json.stale, true);
    // CONTROL: the same state reported now is not stale.
    await post('/api/report', { headers: { 'x-kosmos-agent-token': tok }, body: { state: 'blocked', on: 'the deploy' } });
    const fresh = await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': tok } });
    assert.doesNotMatch(fresh.text, /has been standing/, fresh.text);
    // CONTROL: an old working report is not a waiting state, so it is not pointed out.
    clearStores();
    backdate(WHO, 'working', new Date(Date.now() - 3 * 24 * 3600e3).toISOString());
    const work = await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': sendertoken.mint(WHO).token } });
    assert.doesNotMatch(work.text, /has been standing/, work.text);
  });
});
