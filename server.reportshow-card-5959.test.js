'use strict';

/**
 * #5959: `kosmos report show` also says what the agent's CARD shows (the page's own word), and points out a waiting
 * state that has stood over a day. Harness from server.report-readback-2709.test.js.
 *
 *   node --test server.reportshow-card-5959.test.js
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


/* A self-report line dated `at`, in the store's own line format: selfreport.record stamps now, and this test needs an
   old one. */
function backdate(name, state, at, by = 'agent') {
  fs.mkdirSync(selfreport.DIR, { recursive: true });
  fs.appendFileSync(selfreport.fileFor(name),
    JSON.stringify({ v: 1, state, because: 'which colour?', on: null, owner: null, until: null, project: null, left: null, at, by }) + '\n');
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
    assert.match(old.text, /Your own `blocked` report has been standing for 2 days\. If nobody needs to answer it any more, clear it/, old.text);
    assert.doesNotMatch(old.text, /waiting-on-a-person state/, 'two overlapping instructions: ' + old.text);
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

test('#5959 review 1: with no report at all, the label still comes from the card (the board, not the report)', async () => {
  boardAuthState.on = false;
  await withLeo(async () => {
    const t = await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': sendertoken.mint(WHO).token } });
    assert.match(t.text, /^Your card on the board shows: Idle\.\nYou have not reported a state to the board yet\.\n$/, t.text);
  });
});

test('#5959 review 1: the stale boundary is a day, and between one and two days it says "over a day"', async () => {
  boardAuthState.on = false;
  await withLeo(async () => {
    const tok = sendertoken.mint(WHO).token;
    const at = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    backdate(WHO, 'needs_you', at(23));
    assert.equal((await get('/api/report', { headers: { 'x-kosmos-agent-token': tok } })).json.stale, false, '23 hours read stale');
    backdate(WHO, 'needs_you', at(25));
    const t = await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': tok } });
    assert.match(t.text, /Your own `needs_you` report has been standing for over a day\./, t.text);
    backdate(WHO, 'needs_you', at(36));
    assert.match((await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': tok } })).text, /for over a day\./);
  });
});

test('#5959 review 2: a report time in the future, or one that cannot be read, is never called stale', async () => {
  boardAuthState.on = false;
  await withLeo(async () => {
    const tok = sendertoken.mint(WHO).token;
    backdate(WHO, 'blocked', new Date(Date.now() + 3 * 24 * 3600e3).toISOString());
    assert.equal((await get('/api/report', { headers: { 'x-kosmos-agent-token': tok } })).json.stale, false, 'a future time read stale');
    backdate(WHO, 'blocked', 'not a time');
    const j = await get('/api/report', { headers: { 'x-kosmos-agent-token': tok } });
    assert.equal(j.json.stale, false, JSON.stringify(j.json));
  });
});

test('#5959 review 3: a waiting report Kosmos wrote (by auto) is not called "your own", and names kosmos report clear', async () => {
  boardAuthState.on = false;
  await withLeo(async () => {
    const tok = sendertoken.mint(WHO).token;
    backdate(WHO, 'blocked', new Date(Date.now() - 3 * 24 * 3600e3).toISOString(), 'auto');
    const t = await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': tok } });
    assert.match(t.text, /A `blocked` report Kosmos wrote for you has been standing for 3 days\. If what it was about has passed, clear it with `kosmos report clear`\./, t.text);
    assert.doesNotMatch(t.text, /Your own/, t.text);
    // CONTROL: the agent's own report says so.
    backdate(WHO, 'blocked', new Date(Date.now() - 3 * 24 * 3600e3).toISOString(), 'agent');
    assert.match((await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': tok } })).text, /Your own `blocked` report has been standing for 3 days\..*`kosmos report clear`/);
  });
});

test('#5959 review 4: a waiting report a person or an unknown writer left is said without naming a writer', async () => {
  boardAuthState.on = false;
  await withLeo(async () => {
    const tok = sendertoken.mint(WHO).token;
    for (const by of ['operator', null]) {
      backdate(WHO, 'blocked', new Date(Date.now() - 3 * 24 * 3600e3).toISOString(), by);
      const t = (await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': tok } })).text;
      assert.match(t, /This `blocked` report has been standing for 3 days\./, String(by) + ': ' + t);
      assert.doesNotMatch(t, /Your own|Kosmos wrote/, String(by) + ': ' + t);
    }
  });
});

test('#5959 review 5: a label that already ends in punctuation ("Reconnecting…") is not given a second', async () => {
  boardAuthState.on = false;
  const board = fleet.install([fleet.agent('leo', { state: 'connection_lost' })]);
  messages.setRunner(() => ({ ok: true, session: 'leo-discord' }));
  try {
    const card = board.agents.find((c) => c.sessionName === 'leo');
    assert.equal(card.state, 'connection_lost', 'setup: the fixture is not a lost connection');
    const t = await get('/api/report?as=text', { headers: { 'x-kosmos-agent-token': sendertoken.mint(WHO).token } });
    assert.match(t.text, /^Your card on the board shows: (Reconnecting…|Connection lost\.)\n/, t.text);
    assert.doesNotMatch(t.text, /…\./, t.text);
  } finally { messages.setRunner(null); board.restore(); }
});
