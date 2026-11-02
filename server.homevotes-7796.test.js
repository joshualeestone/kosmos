'use strict';
/*
 * kosmos#7796: GET /api/community/home shows the agent's vote standing as the board last read it (kosmos community votes), with
 * its age, and never makes the signed call itself. A vote through the board forgets it; nothing is shown while the
 * community or the public one is off. engine/communityhome and engine/communityvote are stubbed at
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
const votesRead = (tok) => fetch(`${base()}/api/community/votes`, { headers: { 'x-kosmos-agent-token': tok } });
const castVote = (tok) => fetch(`${base()}/api/community/vote`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': tok },
  body: JSON.stringify({ kind: 'post', id: '1b2c3d4e-0000-4000-8000-000000000001', direction: 'up' }) });

test('home never reads the standing itself; before any read of it, it says so', async (t) => {
  const b = fleet.install([fleet.agent('Fresh', { state: 'idle' })]);
  t.after(() => b.restore());
  standings = []; homeAs = {};
  const j = await (await home(sendertoken.mint('Fresh').token)).json();
  assert.match(j.text, /\nVotes: not read since your last vote or since this board started/);
  assert.deepEqual(standings, [], 'home made the signed call');
});

test('after kosmos community votes, home shows that standing and its age, from the same cached home read', async (t) => {
  const b = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  t.after(() => b.restore());
  standings = []; homes = []; homeAs = {};
  const tok = sendertoken.mint('Reader').token;
  await (await home(tok)).json();
  assert.equal((await votesRead(tok)).status, 200);
  const j = await (await home(tok)).json();
  assert.match(j.text, /\nVotes: 1 vote standing in the last 24 hours when last read, just now \(Kosmos asks for 3; 2 more would meet it/);
  assert.deepEqual(homes, ['Reader'], 'CONTROL: the second home reused the first read, and still shows the new standing');
  assert.deepEqual(standings.map((s) => s.agentKey), ['Reader'], 'only the votes command read it');
});

test('a vote forgets the remembered standing; a failed standing read does not replace it', async (t) => {
  const b = fleet.install([fleet.agent('Caster', { state: 'idle' })]);
  t.after(() => { b.restore(); standingAnswer = { ok: true, standing: { held: 1, required: 3, remaining: 2, cast: 1, limit: 50 } }; });
  homeAs = {};
  const tok = sendertoken.mint('Caster').token;
  await votesRead(tok);
  standingAnswer = { ok: false, because: 'busy' };
  await votesRead(tok);
  assert.match((await (await home(tok)).json()).text, /\nVotes: 1 vote standing/, 'a failed read kept what was known');
  assert.equal((await castVote(tok)).status, 200);
  assert.match((await (await home(tok)).json()).text, /\nVotes: not read since your last vote/);
});

test('no Votes line while the community, or the public one, is off', async (t) => {
  const b = fleet.install([fleet.agent('Off1', { state: 'idle' }), fleet.agent('Off2', { state: 'idle' })]);
  t.after(() => { b.restore(); homeAs = {}; });
  homeAs = { switchedOn: false };
  assert.doesNotMatch((await (await home(sendertoken.mint('Off1').token)).json()).text, /Votes:/);
  homeAs = { publicOff: 'your company has the public community off' };
  assert.doesNotMatch((await (await home(sendertoken.mint('Off2').token)).json()).text, /Votes:/);
});
