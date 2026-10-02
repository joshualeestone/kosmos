'use strict';
/*
 * kosmos#4913 step 4: POST /api/community/endorse on the real board. Only an agent the board can verify endorses or
 * takes one back, and the ENDORSER is always that authenticated agent, never a name or a pane in the body.
 * engine/communityendorse is stubbed at its seam (the route calls it through the module object), so each test reads
 * which agent key the board handed it. An endorsement counts against the agent's hourly community writes (the cap is
 * 3 here); a take-back does not. No network.
 *
 *   node --test server.community-endorse-4913.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-endorse-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-endorse-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-endorse-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-endorse-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-endorse-launch-'));
process.env.AGENT_WORKFORCE_COMMUNITY_CAP = '3';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const communityendorse = require('./engine/communityendorse');
const communitysend = require('./engine/communitysend');

const realEndorse = communityendorse.endorse;
const realTakeBack = communityendorse.takeBack;
let calls = [];
function stub({ endorse = [200, 'You endorsed Theo Nguyen with 5 stars.'], takeBack = [200, 'You took back your endorsement of Theo Nguyen.'], counts = true } = {}) {
  calls = [];
  const as = ([code, words]) => (code === 200 ? { ok: true, text: words } : { ok: false, upstream: code === 502 || code === 202, maybe: code === 202, limited: code === 429, because: words });
  communityendorse.endorse = async (agentKey, name, stars, text) => { calls.push({ fn: 'endorse', agentKey, name, stars, text }); return { ...as(endorse), ...(counts ? { counts: true } : {}) }; };
  communityendorse.takeBack = async (agentKey, name) => { calls.push({ fn: 'takeBack', agentKey, name }); return as(takeBack); };
}

test.before(async () => { await start(0); });
test.after(() => {
  communityendorse.endorse = realEndorse;
  communityendorse.takeBack = realTakeBack;
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});

const base = () => `http://127.0.0.1:${server.address().port}`;
const endorseAs = (tok, body) => fetch(`${base()}/api/community/endorse`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(tok ? { 'x-kosmos-agent-token': tok } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const GOOD = { name: 'Theo Nguyen', stars: 5, text: 'Careful work.' };

test('#4913 sandbox: the community keys the board would act with live in this test\'s data root', () => {
  assert.ok(communitysend._paths.keysFile().startsWith(SANDBOX + path.sep), communitysend._paths.keysFile());
});

test('#4913: with no agent token, even naming a real agent\'s pane, nothing is endorsed or taken back', async (t) => {
  const b = fleet.install([fleet.agent('Ender', { state: 'idle' })]);
  t.after(() => b.restore());
  stub();
  const pane = (b.agents.find((c) => c.sessionName === 'Ender') || {}).target;
  assert.ok(pane, 'the fixture gave no pane target');
  const r = await endorseAs(null, { ...GOOD, from_pane: pane });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /requires an agent token/);
  assert.equal((await endorseAs('ef'.repeat(16), GOOD)).status, 403, 'a token the board never issued was accepted');
  assert.equal((await endorseAs(null, { name: 'Theo Nguyen', takeBack: true, from_pane: pane })).status, 403);
  assert.equal(calls.length, 0, 'the board acted for an unverified endorser');
});

test('#4913: the endorser is the authenticated agent even when the body names another', async (t) => {
  const b = fleet.install([fleet.agent('Ender', { state: 'idle' }), fleet.agent('Other', { state: 'idle' })]);
  t.after(() => b.restore());
  stub();
  const otherPane = (b.agents.find((c) => c.sessionName === 'Other') || {}).target;
  const r = await endorseAs(sendertoken.mint('Ender').token, { ...GOOD, agent: 'Other', from_pane: otherPane });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, text: 'You endorsed Theo Nguyen with 5 stars.' });
  assert.deepEqual(calls, [{ fn: 'endorse', agentKey: 'Ender', name: 'Theo Nguyen', stars: '5', text: 'Careful work.' }]);
  const back = await endorseAs(sendertoken.mint('Ender').token, { name: 'Theo Nguyen', takeBack: true, stars: 5, text: 'x', agent: 'Other' });
  assert.equal(back.status, 200);
  assert.deepEqual(calls[1], { fn: 'takeBack', agentKey: 'Ender', name: 'Theo Nguyen' }, 'takeBack: true takes it back and sends no stars or text');
});

test('#4913: fields of the wrong type reach the engine as empty, never as objects; only takeBack: true takes back', async (t) => {
  const b = fleet.install([fleet.agent('Ender', { state: 'idle' })]);
  t.after(() => b.restore());
  stub();
  const tok = sendertoken.mint('Ender').token;
  await endorseAs(tok, { name: ['Theo'], stars: { n: 5 }, text: 7, takeBack: 'true' });
  assert.deepEqual(calls, [{ fn: 'endorse', agentKey: 'Ender', name: '', stars: '', text: '' }], 'a string "true" took an endorsement back');
  await endorseAs(tok, { name: 'Theo Nguyen', stars: 4.5, text: 'x' });
  assert.equal(calls[1].stars, '4.5', 'a fractional number reaches the engine as written (which refuses it), not rounded');
  assert.equal((await endorseAs(tok, '{not json')).status, 400);
  assert.equal(calls.length, 2);
});

test('#4913: a refusal is a 400, the daily cap a 429, a service failure a 502, a maybe a 202, each in the engine\'s words', async (t) => {
  const b = fleet.install([fleet.agent('Capped', { state: 'idle' })]);
  t.after(() => b.restore());
  const tok = sendertoken.mint('Capped').token;
  stub({ endorse: [400, 'you cannot endorse yourself'], counts: false });
  const own = await endorseAs(tok, GOOD);
  assert.equal(own.status, 400);
  assert.deepEqual(await own.json(), { error: 'you cannot endorse yourself' });
  stub({ endorse: [429, 'over the cap'], counts: false });
  assert.equal((await endorseAs(tok, GOOD)).status, 429);
  stub({ endorse: [502, 'the community could not be reached'], takeBack: [502, 'the community could not be reached'], counts: false });
  assert.equal((await endorseAs(tok, GOOD)).status, 502);
  assert.equal((await endorseAs(tok, { name: 'Theo Nguyen', takeBack: true })).status, 502);
  stub({ endorse: [202, 'the community could not be reached'], counts: false });
  const sent = await endorseAs(tok, GOOD);
  assert.equal(sent.status, 202, 'an endorsement that may have landed is not a plain service failure');
});

test('#4913: an endorsement the engine counts uses the hourly community valve; a take-back and an uncounted answer do not', async (t) => {
  const b = fleet.install([fleet.agent('Valved', { state: 'idle' })]);
  t.after(() => b.restore());
  const tok = sendertoken.mint('Valved').token;
  stub({ counts: false });
  for (let i = 0; i < 4; i++) assert.equal((await endorseAs(tok, GOOD)).status, 200, 'an answer the engine did not count tripped the valve');
  stub();
  for (let i = 0; i < 5; i++) assert.equal((await endorseAs(tok, { name: 'Theo Nguyen', takeBack: true })).status, 200, 'a take-back is not a write');
  for (let i = 0; i < 3; i++) assert.equal((await endorseAs(tok, GOOD)).status, 200, 'endorsement ' + (i + 1) + ' of the cap of 3');
  const over = await endorseAs(tok, GOOD);
  assert.equal(over.status, 429, 'a 4th counted endorsement in the hour was not paused');
  assert.match((await over.json()).error, /3 times in the last hour/);
  assert.equal(calls.filter((c) => c.fn === 'endorse').length, 3, 'the paused endorsement reached the engine');
  assert.equal((await endorseAs(tok, { name: 'Theo Nguyen', takeBack: true })).status, 200, 'a take-back still works with the valve tripped');
});

test('#4913: the real engine behind the route: switched off is a 400 (a local refusal, not a 502)', async (t) => {
  const b = fleet.install([fleet.agent('Offed', { state: 'idle' })]);
  communityendorse.endorse = realEndorse;
  communityendorse.takeBack = realTakeBack;
  communitysend.setSwitch(() => ({ ok: true, on: false }));
  t.after(() => { b.restore(); communitysend.setSwitch(null); });
  const tok = sendertoken.mint('Offed').token;
  const r = await endorseAs(tok, GOOD);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /switched off/);
  const s = await endorseAs(tok, { name: 'Theo Nguyen', takeBack: true });
  assert.equal(s.status, 400);
  assert.match((await s.json()).error, /switched off/);
});
