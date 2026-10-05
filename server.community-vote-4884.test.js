'use strict';
/*
 * kosmos#4884: POST /api/community/vote and GET /api/community/votes on the real board. Only an agent the board can
 * verify votes or reads where it stands, and the VOTER is always that authenticated agent, never a name or a pane in
 * the body. engine/communityvote is stubbed at its seam (the route calls it through the module object), so each test
 * reads which agent key the board handed it. No network.
 *
 *   node --test server.community-vote-4884.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-vote-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-vote-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-vote-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-vote-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-vote-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
// #5211: the after-vote/after-comment line has its own test (server.community-nudge-5211); here it adds nothing, so
// these exact answer shapes stay this file's subject.
require('./engine/communitynudge').nudge = async () => null;
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const communityvote = require('./engine/communityvote');
const communitysend = require('./engine/communitysend');

const realVote = communityvote.vote;
const realStanding = communityvote.standing;
let calls = [];
function stub({ vote = [200, 'You voted that post up.'], standing = [200, 'STANDING'] } = {}) {
  calls = [];
  const as = ([code, words]) => (code === 200 ? { ok: true, text: words } : { ok: false, upstream: code === 502 || code === 202, maybe: code === 202, limited: code === 429, because: words });
  communityvote.vote = async (agentKey, kind, id, direction) => { calls.push({ fn: 'vote', agentKey, kind, id, direction }); return as(vote); };
  communityvote.standing = async (agentKey) => { calls.push({ fn: 'standing', agentKey }); return as(standing); };
}

test.before(async () => { await start(0); });
test.after(() => {
  communityvote.vote = realVote;
  communityvote.standing = realStanding;
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});

const base = () => `http://127.0.0.1:${server.address().port}`;
const voteAs = (tok, body) => fetch(`${base()}/api/community/vote`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(tok ? { 'x-kosmos-agent-token': tok } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const votesAs = (tok) => fetch(`${base()}/api/community/votes`, { headers: tok ? { 'x-kosmos-agent-token': tok } : {} });
const POST = '11111111-2222-4333-8444-555555555555';

test('#4884 sandbox: the community keys the board would act with live in this test\'s data root', () => {
  assert.ok(communitysend._paths.keysFile().startsWith(SANDBOX + path.sep), communitysend._paths.keysFile());
});

test('#4884: with no agent token, even naming a real agent\'s pane, nothing is voted and nothing is read', async (t) => {
  const b = fleet.install([fleet.agent('Voter', { state: 'idle' })]);
  t.after(() => b.restore());
  stub();
  const pane = (b.agents.find((c) => c.sessionName === 'Voter') || {}).target;
  assert.ok(pane, 'the fixture gave no pane target');
  const r = await voteAs(null, { kind: 'post', id: POST, direction: 'up', from_pane: pane });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /requires an agent token/);
  assert.equal((await voteAs('ef'.repeat(16), { kind: 'post', id: POST, direction: 'up' })).status, 403, 'a token the board never issued was accepted');
  assert.equal((await votesAs(null)).status, 403);
  assert.equal(calls.length, 0, 'the board acted for an unverified voter');
});

test('#4884: the voter is the authenticated agent even when the body names another', async (t) => {
  const b = fleet.install([fleet.agent('Voter', { state: 'idle' }), fleet.agent('Other', { state: 'idle' })]);
  t.after(() => b.restore());
  stub();
  const otherPane = (b.agents.find((c) => c.sessionName === 'Other') || {}).target;
  const r = await voteAs(sendertoken.mint('Voter').token, { kind: 'post', id: POST, direction: 'up', agent: 'Other', from_pane: otherPane });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, text: 'You voted that post up.' });
  assert.deepEqual(calls, [{ fn: 'vote', agentKey: 'Voter', kind: 'post', id: POST, direction: 'up' }]);
  const s = await votesAs(sendertoken.mint('Voter').token);
  assert.equal(s.status, 200);
  assert.deepEqual(await s.json(), { ok: true, text: 'STANDING' });
  assert.deepEqual(calls[1], { fn: 'standing', agentKey: 'Voter' });
});

test('#4884: fields that are not strings reach the engine as empty, never as objects', async (t) => {
  const b = fleet.install([fleet.agent('Voter', { state: 'idle' })]);
  t.after(() => b.restore());
  stub();
  await voteAs(sendertoken.mint('Voter').token, { kind: ['post'], id: { x: 1 }, direction: 1 });
  assert.deepEqual(calls, [{ fn: 'vote', agentKey: 'Voter', kind: '', id: '', direction: '' }]);
  const bad = await voteAs(sendertoken.mint('Voter').token, '{not json');
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 1);
});

test('#4884: a refusal is a 400, the daily cap a 429, a service failure a 502, each in the engine\'s words', async (t) => {
  const b = fleet.install([fleet.agent('Voter', { state: 'idle' })]);
  t.after(() => b.restore());
  const tok = sendertoken.mint('Voter').token;
  stub({ vote: [400, 'you cannot vote on your own post'] });
  const own = await voteAs(tok, { kind: 'post', id: POST, direction: 'up' });
  assert.equal(own.status, 400);
  assert.deepEqual(await own.json(), { error: 'you cannot vote on your own post' });
  stub({ vote: [429, 'over the cap'] });
  assert.equal((await voteAs(tok, { kind: 'post', id: POST, direction: 'up' })).status, 429);
  stub({ vote: [502, 'the community could not be reached'], standing: [502, 'the community could not be reached'] });
  assert.equal((await voteAs(tok, { kind: 'post', id: POST, direction: 'up' })).status, 502);
  assert.equal((await votesAs(tok)).status, 502);
  stub({ vote: [202, 'the community could not be reached'] });   // sent, answer lost: it may have been counted
  const sent = await voteAs(tok, { kind: 'post', id: POST, direction: 'up' });
  assert.equal(sent.status, 202, 'a vote that may have been counted is not a plain service failure');
  assert.deepEqual(await sent.json(), { error: 'the community could not be reached' });
});

test('#4884: the real engine behind the route: switched off is a 400 (a local refusal, not a 502)', async (t) => {
  const b = fleet.install([fleet.agent('Voter', { state: 'idle' })]);
  communityvote.vote = realVote;
  communityvote.standing = realStanding;
  communitysend.setSwitch(() => ({ ok: true, on: false }));
  t.after(() => { b.restore(); communitysend.setSwitch(null); });
  const tok = sendertoken.mint('Voter').token;
  const r = await voteAs(tok, { kind: 'post', id: POST, direction: 'up' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /switched off/);
  const s = await votesAs(tok);
  assert.equal(s.status, 400);
  assert.match((await s.json()).error, /switched off/);
});
