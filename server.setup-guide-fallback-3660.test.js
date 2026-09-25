'use strict';

/**
 * #3660 fallback through the real server (Josh, 2026-09-25 07:22): a guide whose card shows one of the
 * three #3723 states makes GET /api/setup-guide say `hosted: true, hostedWhy: 'own_model_failing'` with the
 * problem and runner, and POST /api/setup-guide/hosted then answers. A guide that answers keeps the old
 * shape and the hosted route refuses with `own_model`.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-guide-fallback-route-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
// A connected model (an OpenAI key, listed by the real account module): a guide exists only once one is.
fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.codex'), { recursive: true });
fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.codex', 'auth.json'),
  JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-testtestFALLBACK1' }), { mode: 0o600 });

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, guideCardFailing, resetGuideCardMemoForTests } = require('./server');
const removal = require('./engine/remove');
const fleet = require('./test-support/fleet');
const setupAssistant = require('./engine/setup-assistant');
const remote = require('./engine/remote');

const GUIDE = 'guidebot';
const restore = [];
function stub(obj, key, value) { const was = obj[key]; obj[key] = value; restore.push(() => { obj[key] = was; }); }

const bin = path.join(SANDBOX, 'tunnel.sh');
fs.writeFileSync(bin, `#!/bin/bash\ncat >/dev/null; printf '{"status":200,"body":{"reply":"Add credits at OpenAI, then try again.","remaining":29}}'\n`, { mode: 0o755 });
process.env.AGENT_WORKFORCE_TUNNEL_BIN = bin;

let base;
test.before(async () => {
  stub(setupAssistant, 'guideName', () => GUIDE);
  stub(setupAssistant, 'isGuideFolder', (n) => n === GUIDE);
  stub(remote, 'hostedAvailable', () => true);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  for (const undo of restore.reverse()) undo();
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const status = async () => (await fetch(base + '/api/setup-guide')).json();
const ask = () => fetch(base + '/api/setup-guide/hosted', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'why is nothing answering?' }] }) });

for (const state of ['rate_limited', 'auth_failed', 'connection_lost']) {
  test(`#3660 a guide that is ${state} falls back: GET says so with the problem and runner, and the hosted route answers`, async () => {
    resetGuideCardMemoForTests();
    const board = fleet.install([fleet.agent(GUIDE, { state })]);
    try {
      const g = await status();
      assert.equal(g.ok, true);
      assert.equal(g.name, GUIDE);
      assert.equal(g.hosted, true, JSON.stringify(g));
      assert.equal(g.hostedWhy, 'own_model_failing');
      assert.equal(g.problem, state);
      assert.equal(g.runner, 'claude');
      const r = await ask();
      assert.equal(r.status, 200, 'the hosted route refused a chat while the guide was failing');
      assert.match((await r.json()).reply, /Add credits/);
    } finally { board.restore(); }
  });
}

test('#3660 a guide that answers keeps the old shape, and the hosted route refuses with own_model (it flips back)', async () => {
  assert.equal(setupAssistant.listedModels().rows.length, 1, 'CONTROL: the sandbox lists one model of their own');
  resetGuideCardMemoForTests();
  const board = fleet.install([fleet.agent(GUIDE, { state: 'idle' })]);
  try {
    assert.deepEqual(await status(), { ok: true, name: GUIDE }, 'a working guide was offered the hosted fallback');
    const r = await ask();
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'own_model');
  } finally { board.restore(); }
});

test('#3660 with no connector a failing guide gets the plain answer: nothing to fall back to', async () => {
  const was = remote.hostedAvailable;
  remote.hostedAvailable = () => false;
  resetGuideCardMemoForTests();
  const board = fleet.install([fleet.agent(GUIDE, { state: 'auth_failed' })]);
  try {
    assert.deepEqual(await status(), { ok: true, name: GUIDE }, 'no connector still reported the fallback fields');
    remote.hostedAvailable = was;
    const g = await status();
    assert.equal(g.problem, 'auth_failed', 'CONTROL: with the connector back the same card is reported');
    assert.equal(g.runner, 'claude', 'an agent with no recorded runner is claude, as its card says');
  } finally { board.restore(); remote.hostedAvailable = was; }
});

test('#3660 a board that cannot be read is unchecked, never "answering": GET keeps the bubble\'s state and the hosted route says retry', async () => {
  resetGuideCardMemoForTests();
  assert.throws(() => guideCardFailing(GUIDE, () => null), 'an unreadable board read as an answer');
  const board = fleet.install([fleet.agent(GUIDE, { state: 'auth_failed' })]);
  try {
    assert.deepEqual(guideCardFailing(GUIDE, () => board.agents), { problem: 'auth_failed', runner: 'claude' },
      'CONTROL: a readable failing card is read');
  } finally { board.restore(); }
  resetGuideCardMemoForTests();
  const blind = fleet.blind();
  try {
    assert.deepEqual(await status(), { ok: true, name: GUIDE, hosted: false, hostedWhy: 'unchecked' });
    const r = await ask();
    assert.equal(r.status, 503, 'an unreadable board ended the fallback chat (own_model 409)');
    assert.equal((await r.json()).code, 'unchecked');
  } finally { blind.restore(); }
});

test('#3660 a guide whose removal could not be checked is unchecked on the hosted route, not own_model', async () => {
  resetGuideCardMemoForTests();
  const was = removal.removedNames;
  removal.removedNames = () => ({ ok: false });
  const board = fleet.install([fleet.agent(GUIDE, { state: 'auth_failed' })]);
  try {
    const r = await ask();
    assert.equal(r.status, 503);
    assert.equal((await r.json()).code, 'unchecked');
  } finally { board.restore(); removal.removedNames = was; }
  resetGuideCardMemoForTests();
  const again = fleet.install([fleet.agent(GUIDE, { state: 'idle' })]);
  try {
    assert.equal((await ask()).status, 409, 'CONTROL: with the removals readable an answering guide is own_model');
  } finally { again.restore(); }
});

test('#3660 the flip back: failing, then answering, with the memo live, waits out the memo and no longer', () => {
  resetGuideCardMemoForTests();
  let t = 1000000;
  const clock = () => t;
  const failing = fleet.install([fleet.agent(GUIDE, { state: 'rate_limited' })]);
  const failingCards = failing.agents;
  failing.restore();
  const answering = fleet.install([fleet.agent(GUIDE, { state: 'idle' })]);
  const answeringCards = answering.agents;
  answering.restore();
  let cards = failingCards;
  const roster = () => cards;
  assert.deepEqual(guideCardFailing(GUIDE, roster, clock), { problem: 'rate_limited', runner: 'claude' });
  cards = answeringCards;   // their model answers again
  t += 14000;
  assert.notEqual(guideCardFailing(GUIDE, roster, clock), null, 'the memo was not kept for its window');
  t += 1001;
  assert.equal(guideCardFailing(GUIDE, roster, clock), null, 'the flip back did not happen once the memo ran out');
});

test('#3660 the memo is stamped after the board read, so a slow read does not shorten it', () => {
  resetGuideCardMemoForTests();
  let t = 2000000;
  const clock = () => t;
  const board = fleet.install([fleet.agent(GUIDE, { state: 'auth_failed' })]);
  try {
    let reads = 0;
    const slow = () => { reads += 1; t += 20000; return board.agents; };   // a capture that takes 20 seconds
    guideCardFailing(GUIDE, slow, clock);
    guideCardFailing(GUIDE, slow, clock);
    assert.equal(reads, 1, 'the memo was stamped before the read, so it was already stale when written');
  } finally { board.restore(); }
});

test('#3660 the guide card reading is kept for a few seconds, so a poll does not read the whole board each time', () => {
  resetGuideCardMemoForTests();
  const board = fleet.install([fleet.agent(GUIDE, { state: 'rate_limited' })]);
  try {
    let reads = 0;
    const roster = () => { reads += 1; return board.agents; };
    assert.deepEqual(guideCardFailing(GUIDE, roster), { problem: 'rate_limited', runner: 'claude' });
    guideCardFailing(GUIDE, roster);
    assert.equal(reads, 1, 'the board was read again within the memo window');
    resetGuideCardMemoForTests();
    guideCardFailing(GUIDE, roster);
    assert.equal(reads, 2, 'CONTROL: after a reset it reads again');
  } finally { board.restore(); }
});
