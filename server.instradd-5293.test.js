'use strict';
/**
 * kosmos#5293: the routes. An agent PROPOSES (named by its agent token or pane, never by a name it types); the PERSON
 * applies, dismisses or undoes on the page (isViaScreen: an agent token is refused, a browser's headers are required).
 * One pending per target: a second proposal is refused, naming the waiting one.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-instradd-5293-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-instradd-5293-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-instradd-5293-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-instradd-5293-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-instradd-5293-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const adds = require('./engine/instructionadds');

const WORKERS = process.env.AGENT_WORKFORCE_WORKERS;
const BASE = 'You are mara, the sales agent. Your job is to answer leads from the shared inbox, politely.\n';
const ADD = 'When a lead goes quiet for two days, write to them once. Do not chase twice; tell me instead.';

test.before(async () => { await start(0); });
test.after(() => {
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME, WORKERS]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function board(t) {
  const b = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  fs.mkdirSync(path.join(WORKERS, 'mara'), { recursive: true });
  fs.writeFileSync(path.join(WORKERS, 'mara', 'CLAUDE.md'), BASE);
  try { fs.rmSync(adds.FILE, { force: true }); } catch { /* absent */ }
  t.after(() => b.restore());
}
async function call(p, { method = 'POST', body, headers } = {}) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`, {
    method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}
const asLeo = () => ({ 'x-kosmos-agent-token': sendertoken.mint('leo').token });
const SCREEN = { 'sec-fetch-site': 'same-origin' };
const maraFile = () => fs.readFileSync(path.join(WORKERS, 'mara', 'CLAUDE.md'), 'utf8');

test('#5293 an agent proposes: held under the asker its token names, and the instructions are untouched', async (t) => {
  board(t);
  const r = await call('/api/agent/mara/instruction-add', { body: { text: ADD }, headers: asLeo() });
  assert.equal(r.status, 200); assert.equal(r.json.ok, true, JSON.stringify(r.json));
  assert.equal(r.json.pending.askedBy, 'leo', 'the asker is not the agent the token names');
  assert.equal(maraFile(), BASE);
  const g = await call('/api/agent/mara/instruction-add', { method: 'GET' });
  assert.equal(g.json.pending.text, ADD);
});

test('#5293 the asker cannot be typed: a body naming someone else is ignored, the token decides', async (t) => {
  board(t);
  const r = await call('/api/agent/mara/instruction-add', { body: { text: ADD, askedBy: 'The person', from: 'mara' }, headers: asLeo() });
  assert.equal(r.json.pending.askedBy, 'leo');
});

test('#5293 no token and no pane: nothing is held', async (t) => {
  board(t);
  const r = await call('/api/agent/mara/instruction-add', { body: { text: ADD } });
  assert.equal(r.json.ok, false);
  assert.equal(adds.pending('mara'), null);
});

test('#5293 a second proposal is REFUSED and names the waiting one; the first is kept', async (t) => {
  board(t);
  await call('/api/agent/mara/instruction-add', { body: { text: ADD }, headers: asLeo() });
  const r = await call('/api/agent/mara/instruction-add', { body: { text: 'another' }, headers: asLeo() });
  assert.equal(r.json.ok, false); assert.equal(r.json.code, 'pending');
  assert.equal(r.json.pending.askedBy, 'leo');
  assert.equal(adds.pending('mara').text, ADD);
});

test('#5293 apply is the PERSON\'s: refused with an agent token, refused with no browser headers, applied from the page', async (t) => {
  board(t);
  await call('/api/agent/mara/instruction-add', { body: { text: ADD }, headers: asLeo() });
  const byAgent = await call('/api/agent/mara/instruction-add/apply', { body: {}, headers: Object.assign({}, asLeo(), SCREEN) });
  assert.equal(byAgent.status, 403, 'an agent token applied an addition');
  const byCurl = await call('/api/agent/mara/instruction-add/apply', { body: {} });
  assert.equal(byCurl.status, 403, 'a request with no browser headers applied an addition');
  assert.equal(maraFile(), BASE, 'a refused apply changed the instructions');
  const byPage = await call('/api/agent/mara/instruction-add/apply', { body: {}, headers: SCREEN });
  assert.equal(byPage.status, 200, JSON.stringify(byPage.json));
  assert.match(maraFile(), /## Added on \d{4}-\d{2}-\d{2}, asked by leo\n\nWhen a lead goes quiet/);
  const g = await call('/api/agent/mara/instruction-add', { method: 'GET' });
  assert.equal(g.json.pending, null); assert.equal(g.json.last.undoable, true);
});

test('#5293 dismiss and undo are the person\'s too, and undo restores the earlier text', async (t) => {
  board(t);
  await call('/api/agent/mara/instruction-add', { body: { text: ADD }, headers: asLeo() });
  assert.equal((await call('/api/agent/mara/instruction-add/dismiss', { body: {}, headers: asLeo() })).status, 403);
  assert.equal((await call('/api/agent/mara/instruction-add/dismiss', { body: {}, headers: SCREEN })).status, 200);
  assert.equal(adds.pending('mara'), null);
  await call('/api/agent/mara/instruction-add', { body: { text: ADD }, headers: asLeo() });
  await call('/api/agent/mara/instruction-add/apply', { body: {}, headers: SCREEN });
  assert.equal((await call('/api/agent/mara/instruction-add/undo', { body: {}, headers: asLeo() })).status, 403);
  assert.equal((await call('/api/agent/mara/instruction-add/undo', { body: {}, headers: SCREEN })).status, 200);
  assert.equal(maraFile(), BASE);
});

test('#5293 a name that is not one of this board\'s agents is refused', async (t) => {
  board(t);
  const r = await call('/api/agent/nobody/instruction-add', { body: { text: ADD }, headers: asLeo() });
  assert.equal(r.status, 404);
});
