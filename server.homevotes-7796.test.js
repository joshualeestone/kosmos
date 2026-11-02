'use strict';
/*
 * kosmos#7796: GET /api/community/home shows the agent's vote standing as the board last read it (kosmos community votes), with
 * its age, and never makes the signed call itself. A vote through the board marks it as read before that vote; no
 * Votes line while the community or the public one is off. engine/communityhome and engine/communityvote are stubbed at
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
let gate = null;   // a promise the standing stub waits on, for the read-across-a-vote case
communityvote.standing = async (agentKey, opts) => { standings.push({ agentKey, opts }); if (gate) await gate; return standingAnswer; };
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
  assert.match(j.text, /\nVotes: not read recently/);
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
  assert.match(j.text, /\nVotes \(read just now\): 1 vote standing in the last 24 hours; 2 more would have met Kosmos's ask of 3 then/);
  assert.deepEqual(homes, ['Reader'], 'CONTROL: the second home reused the first read, and still shows the new standing');
  const { agoMs, beforeVote, ...shown } = j.home.votes;
  assert.equal(beforeVote, false);
  assert.deepEqual(shown, { held: 1, required: 3, remaining: 2 }, 'the home data carries the standing as read');
  assert.ok(Number.isFinite(agoMs) && agoMs >= 0 && agoMs < 60000, 'and its age: ' + agoMs);
  assert.deepEqual(standings.map((s) => s.agentKey), ['Reader'], 'only the votes command read it');
});

test('a vote marks the remembered standing as from before it; a failed standing read does not replace it', async (t) => {
  const b = fleet.install([fleet.agent('Caster', { state: 'idle' })]);
  t.after(() => { b.restore(); standingAnswer = { ok: true, standing: { held: 1, required: 3, remaining: 2, cast: 1, limit: 50 } }; });
  homeAs = {};
  const tok = sendertoken.mint('Caster').token;
  await votesRead(tok);
  standingAnswer = { ok: false, because: 'busy' };
  await votesRead(tok);
  assert.match((await (await home(tok)).json()).text, /\nVotes \(read [^)]*\): 1 vote standing/, 'a failed read kept what was known');
  assert.equal((await castVote(tok)).status, 200);
  const after = (await (await home(tok)).json()).text;
  assert.match(after, /\nVotes \(read just now, before your latest vote\): 1 vote standing in the last 24 hours then; kosmos community votes shows where you stand now\.\n/);
  assert.doesNotMatch(after, /more would have met/, 'a count from before the vote does not ask for more');
});

test('no Votes line while the community, or the public one, is off', async (t) => {
  const b = fleet.install([fleet.agent('Off1', { state: 'idle' }), fleet.agent('Off2', { state: 'idle' })]);
  t.after(() => { b.restore(); homeAs = {}; });
  homeAs = { switchedOn: false };
  assert.doesNotMatch((await (await home(sendertoken.mint('Off1').token)).json()).text, /Votes:/);
  homeAs = { publicOff: 'your company has the public community off' };
  assert.doesNotMatch((await (await home(sendertoken.mint('Off2').token)).json()).text, /Votes:/);
});

/* agentCall runs one call per agent at a time, so in the board this overlap cannot happen; the stub makes it, to show
   the VOTE_GEN guard is there and can fail. */
test('a standing read that was out while the agent voted is not kept', async (t) => {
  const b = fleet.install([fleet.agent('Racer', { state: 'idle' })]);
  let open;
  gate = new Promise((r) => { open = r; });
  t.after(() => { b.restore(); gate = null; });
  homeAs = {};
  const tok = sendertoken.mint('Racer').token;
  const reading = votesRead(tok);
  for (let i = 0; i < 400 && !standings.some((s) => s.agentKey === 'Racer'); i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.ok(standings.some((s) => s.agentKey === 'Racer'), 'the standing read never started');
  assert.equal((await castVote(tok)).status, 200);
  open();
  assert.equal((await reading).status, 200);
  assert.match((await (await home(tok)).json()).text, /\nVotes: not read recently/);
  gate = null;
  await votesRead(tok);
  assert.match((await (await home(tok)).json()).text, /\nVotes \(read [^)]*\): 1 vote standing/, 'CONTROL: a read with no vote across it is kept');
});

test('each agent sees only its own standing, and a reading an hour old reads as not read', async (t) => {
  const b = fleet.install([fleet.agent('Ann', { state: 'idle' }), fleet.agent('Bob', { state: 'idle' })]);
  const realNow = Date.now;
  t.after(() => { b.restore(); Date.now = realNow; });
  homeAs = {};
  const ann = sendertoken.mint('Ann').token;
  const bob = sendertoken.mint('Bob').token;
  await votesRead(ann);
  assert.match((await (await home(bob)).json()).text, /\nVotes: not read recently/, 'Bob was shown Ann\'s standing');
  assert.match((await (await home(ann)).json()).text, /\nVotes \(read [^)]*\): 1 vote standing/);
  const t0 = realNow();
  Date.now = () => t0 + 59 * 60000;
  assert.match((await (await home(ann)).json()).text, /Votes \(read 59 minutes ago\): /, 'CONTROL: under an hour it is shown');
  Date.now = () => t0 + 61 * 60000;
  assert.match((await (await home(ann)).json()).text, /\nVotes: not read recently/);
});

test('a vote refused before it was sent marks nothing', async (t) => {
  const b = fleet.install([fleet.agent('Refused', { state: 'idle' })]);
  t.after(() => { b.restore(); communityvote.vote = async () => ({ ok: true, text: 'You voted that post up.' }); });
  homeAs = {};
  const tok = sendertoken.mint('Refused').token;
  await votesRead(tok);
  communityvote.vote = async () => ({ ok: false, because: 'that is your own post' });
  assert.equal((await castVote(tok)).status, 400);
  assert.match((await (await home(tok)).json()).text, /\nVotes \(read just now\): 1 vote standing/, 'a refused vote marks nothing');
  communityvote.vote = async () => ({ ok: false, maybe: true, because: 'sent, not confirmed' });
  assert.equal((await castVote(tok)).status, 202);
  assert.match((await (await home(tok)).json()).text, /\nVotes \(read just now, before your latest vote\): /, 'CONTROL: a vote that may have landed marks it');
});
