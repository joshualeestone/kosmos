'use strict';
/*
 * kosmos#7796: GET /api/community/home also reads the agent's vote standing (the one signed read on that route), with a
 * bounded wait, and not while the community or the public one is off. A vote cast through the board drops the agent's
 * cached home read, so the next home shows the new standing. engine/communityhome and engine/communityvote are stubbed at
 * their seams (the routes call them through the module objects). No network.
 *
 *   node --test server.homevotes-7796.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-homevotes-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-homevotes-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-homevotes-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-homevotes-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-homevotes-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const communityhome = require('./engine/communityhome');
const communityvote = require('./engine/communityvote');
require('./engine/communitynudge').nudge = async () => null;

const realHomeFor = communityhome.homeFor;
const realStanding = communityvote.standing;
const realVote = communityvote.vote;
let homeAs = {};
let homes = [];
let standings = [];
let standingAnswer = { ok: true, standing: { held: 1, required: 3, remaining: 2, cast: 1, limit: 50 } };
communityhome.homeFor = async (agentKey) => { homes.push(agentKey); return { ok: true, switchedOn: true, posts: [], following: { count: 0, replies: 0, later: 0, titles: [] }, counts: { comments: 0, follows: 0, posts: 0 }, floors: null, ...homeAs }; };
communityvote.standing = async (agentKey, opts) => { standings.push({ agentKey, opts }); return standingAnswer; };
communityvote.vote = async () => ({ ok: true, text: 'You voted that post up.' });

test.before(async () => { await start(0); });
test.after(() => { communityhome.homeFor = realHomeFor; communityvote.standing = realStanding; communityvote.vote = realVote; try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const base = () => `http://127.0.0.1:${server.address().port}`;
const home = (tok) => fetch(`${base()}/api/community/home`, { headers: { 'x-kosmos-agent-token': tok } });

test('home carries the Votes line, read once for the authenticated agent with a bounded wait', async (t) => {
  const b = fleet.install([fleet.agent('Voter', { state: 'idle' })]);
  t.after(() => b.restore());
  homes = []; standings = []; homeAs = {};
  const j = await (await home(sendertoken.mint('Voter').token)).json();
  assert.match(j.text, /\nVotes: 1 vote standing in the last 24 hours \(Kosmos asks for 3; 2 more would meet it/);
  assert.deepEqual(standings.map((s) => s.agentKey), ['Voter']);
  const w = standings[0].opts.waitMs;
  assert.ok(Number.isFinite(w) && w > 0 && w <= 10000, 'the wait for the slot is bounded: ' + w);
});

test('a failed standing read says so, never a 0', async (t) => {
  const b = fleet.install([fleet.agent('Busy', { state: 'idle' })]);
  t.after(() => { b.restore(); standingAnswer = { ok: true, standing: { held: 1, required: 3, remaining: 2, cast: 1, limit: 50 } }; });
  standingAnswer = { ok: false, because: 'busy' };
  homeAs = {};
  const j = await (await home(sendertoken.mint('Busy').token)).json();
  assert.match(j.text, /\nVotes: could not be read just now/);
});

test('nothing signed is read while the community, or the public one, is off', async (t) => {
  const b = fleet.install([fleet.agent('Off1', { state: 'idle' }), fleet.agent('Off2', { state: 'idle' }), fleet.agent('On1', { state: 'idle' })]);
  t.after(() => { b.restore(); homeAs = {}; });
  standings = [];
  homeAs = { switchedOn: false };
  await (await home(sendertoken.mint('Off1').token)).json();
  homeAs = { publicOff: 'your company has the public community off' };
  await (await home(sendertoken.mint('Off2').token)).json();
  assert.deepEqual(standings, []);
  homeAs = {};
  await (await home(sendertoken.mint('On1').token)).json();
  assert.deepEqual(standings.map((s) => s.agentKey), ['On1'], 'CONTROL: with it on, the standing is read');
});

test('a vote through the board drops the cached home read, so the next home reads the standing again', async (t) => {
  const b = fleet.install([fleet.agent('Caster', { state: 'idle' })]);
  t.after(() => b.restore());
  standings = []; homeAs = {};
  const tok = sendertoken.mint('Caster').token;
  await (await home(tok)).json();
  await (await home(tok)).json();
  /* Standing reads, not home reads: a vote also starts the board's read-ahead refresh (homeFor, never the standing). */
  assert.deepEqual(standings.map((s) => s.agentKey), ['Caster'], 'CONTROL: a second read inside the reuse window is the first one');
  const v = await fetch(`${base()}/api/community/vote`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok },
    body: JSON.stringify({ kind: 'post', id: '1b2c3d4e-0000-4000-8000-000000000001', direction: 'up' }) });
  assert.equal(v.status, 200, 'the vote went through: ' + v.status);
  await (await home(tok)).json();
  assert.deepEqual(standings.map((s) => s.agentKey), ['Caster', 'Caster'], 'the home after the vote read the standing again');
});
