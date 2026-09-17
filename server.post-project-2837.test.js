'use strict';
/**
 * #2837 (producer half): a post into a project room carries THAT project onto the
 * poster's self-report state, so the automatic `working` heartbeats inherit it
 * (selfreport's #763 carry-forward) and the project overview lights the RIGHT tile
 * for a multi-project agent instead of none. Driven through the real server.
 *
 * Each test uses a DISTINCT poster agent so one test's self-report never leaks
 * into the next (the report store is per-agent and persists across tests in the
 * shared sandbox); `mara` is the standing co-member so a post actually places.
 *
 *   node --test server.post-project-2837.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-post-project-2837-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-post-project-2837-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-post-project-2837-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-post-project-2837-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-post-project-2837-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const messagesEngine = require('./engine/messages');
const chatEngine = require('./engine/chat');
const projects = require('./engine/projects');
const selfreport = require('./engine/selfreport');

// One install for the whole file (a second install() fails its own arrangement
// assertion once a prior test has left projects/reports behind). mara is the
// standing co-member; leo/lee/lou/liv are one-per-test posters.
// `fixture` is the pane-path poster: the test fake-tmux resolves every pane's
// session_name to `fixture-discord`, so a tokenless post from any pane resolves to it.
const POSTERS = ['leo', 'lee', 'lou', 'liv', 'lex', 'lyn', 'fixture'];
let board;
test.before(async () => {
  await start(0);
  board = fleet.install([fleet.agent('mara', { state: 'idle' })].concat(POSTERS.map((n) => fleet.agent(n, { state: 'idle' }))));
  chatEngine.setRunner((args) => {
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chatEngine.setDryRun(false);
});
test.after(() => {
  messagesEngine.resetForTests(); chatEngine.setRunner(null); chatEngine.setDryRun(true);
  if (board) board.restore();
  server.closeAllConnections(); server.close();
  for (const d of [SANDBOX, process.env.HOME]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

async function post(body, headers) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/post`, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

function room(name, poster) {
  const p = projects.create({ name });
  projects.addAgent(p.id, poster);
  projects.addAgent(p.id, 'mara');
  return p;
}

test('a WORKING agent posting to a room carries that project onto its working state (the #2837 producer gap)', async () => {
  const tok = sendertoken.mint('leo').token;
  const p = room('Alpha 2837', 'leo');
  selfreport.record('leo', { state: 'working' });   // actively working (its auto heartbeats say so)
  const r = await post({ project: p.id, text: 'working on alpha', from_pane: '' }, { 'x-kosmos-agent-token': tok });
  assert.ok(['placed', 'unconfirmed'].includes(r.json.delivery.state), 'the post did not reach the room: ' + (r.json.delivery.because || ''));
  const rep = selfreport.read('leo');
  assert.equal(rep.state, 'working', 'the working state must be preserved, not reset');
  assert.equal(rep.project, p.id, 'a working poster was not attributed to the project it posted into');
});

test('a later post to a DIFFERENT project re-points the carried project (multi-project working agent)', async () => {
  const tok = sendertoken.mint('lee').token;
  const a = room('Alpha two', 'lee');
  const b = room('Beta two', 'lee');
  selfreport.record('lee', { state: 'working' });
  await post({ project: a.id, text: 'in alpha', from_pane: '' }, { 'x-kosmos-agent-token': tok });
  assert.equal(selfreport.read('lee').project, a.id, 'first post did not set alpha');
  await post({ project: b.id, text: 'now in beta', from_pane: '' }, { 'x-kosmos-agent-token': tok });
  assert.equal(selfreport.read('lee').project, b.id, 'the second post did not re-point the carried project to beta');
});

test('an IDLE poster is NOT forced to working and not attributed (the common case is untouched)', async () => {
  const tok = sendertoken.mint('lou').token;
  const p = room('Idle 2837', 'lou');
  selfreport.record('lou', { state: 'idle' });
  const r = await post({ project: p.id, text: 'a quick aside while idle', from_pane: '' }, { 'x-kosmos-agent-token': tok });
  assert.ok(['placed', 'unconfirmed'].includes(r.json.delivery.state), 'the post should still reach the room');
  const rep = selfreport.read('lou');
  assert.equal(rep.state, 'idle', 'posting must not flip an idle agent to working (no idle agent should light a tile)');
  assert.notEqual(rep.project, p.id, 'an idle poster must not be attributed to a project (it is not working in it)');
});

test('a post that did NOT reach a room (no such project) does not attribute any project', async () => {
  const tok = sendertoken.mint('liv').token;
  selfreport.record('liv', { state: 'working' });   // even a working agent: a FAILED post attributes nothing
  const r = await post({ project: 'no-such-project-xyz', text: 'nowhere', from_pane: '' }, { 'x-kosmos-agent-token': tok });
  assert.equal(r.json.delivery.state, 'could_not', 'a post to a missing project should not be placed');
  assert.equal(selfreport.read('liv').project, null, 'a failed post must not attribute a project onto a working agent');
});

test('a PANE-resolved poster (no agent token) is attributed the same way (the resolveAgentSender pane branch)', async () => {
  const p = room('Pane 2837', 'fixture');
  selfreport.record('fixture', { state: 'working' });
  // No token: the sender is resolved from the pane. The test fake-tmux answers
  // session_name as `fixture-discord`, which ties to the installed `fixture` agent.
  const r = await post({ project: p.id, text: 'pane-path post', from_pane: '%7' });
  assert.ok(['placed', 'unconfirmed'].includes(r.json.delivery.state), 'the pane post did not reach the room: ' + (r.json.delivery.because || ''));
  assert.equal(selfreport.read('fixture').project, p.id, 'a pane-resolved working poster was not attributed (the pane branch of resolveAgentSender)');
});

test('attribution preserves the existing working content (on/because), adding only the project', async () => {
  const tok = sendertoken.mint('lex').token;
  const p = room('Lex 2837', 'lex');
  // A working report that carries explicit content the CLI's free-form `working` allows.
  selfreport.record('lex', { state: 'working', on: 'the refactor', because: 'halfway through' });
  const r = await post({ project: p.id, text: 'posting from the refactor', from_pane: '' }, { 'x-kosmos-agent-token': tok });
  assert.ok(['placed', 'unconfirmed'].includes(r.json.delivery.state), 'the post did not reach the room: ' + (r.json.delivery.because || ''));
  const rep = selfreport.read('lex');
  assert.equal(rep.project, p.id, 'the project was not attributed');
  assert.equal(rep.on, 'the refactor', 'attribution dropped the working report\'s `on` content');
  assert.equal(rep.because, 'halfway through', 'attribution dropped the working report\'s note');
});

test('#3224: a post to project A while owing an addressed answer in project B logs a misroute suspect, and the post STILL succeeds (observability only)', async () => {
  const tok = sendertoken.mint('lyn').token;
  const a = room('Misroute A 3224', 'lyn');
  const b = room('Misroute B 3224', 'lyn');
  // The operator asks lyn in room B -> an unanswered addressed question lyn owes.
  const ask = messagesEngine.sendPost(
    { operator: true, project: b.id, projectName: b.name, text: '@lyn where is the draft?' },
    board.agents, ['lyn', 'mara']);
  assert.ok(['placed', 'unconfirmed'].includes(ask.state), 'the operator ask did not place: ' + (ask.because || ''));
  // Start from a clean misroute log so the assertion is about THIS post alone.
  try { fs.rmSync(messagesEngine.MISROUTE_LOG, { force: true }); } catch { /* fresh */ }
  selfreport.record('lyn', { state: 'working' });
  // lyn posts to a DIFFERENT room (A) while owing B -> a suspected misroute.
  const r = await post({ project: a.id, text: 'answering over here', from_pane: '' }, { 'x-kosmos-agent-token': tok });
  // The post is NEVER blocked or delayed by the detector: it still reaches the room.
  assert.ok(['placed', 'unconfirmed'].includes(r.json.delivery.state),
    'the post to A must still succeed - the detector is observability only: ' + (r.json.delivery.because || ''));
  // The route logged exactly one suspect line naming room B (same post-sendJson timing as
  // the #2837 attribution the tests above read synchronously).
  const raw = fs.readFileSync(messagesEngine.MISROUTE_LOG, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(raw.length, 1, 'expected exactly one misroute-suspect line from the route');
  const rec = JSON.parse(raw[0]);
  assert.equal(rec.kind, 'misroute-suspect');
  assert.equal(rec.from, 'lyn', 'the suspect was not attributed to the poster');
  assert.equal(rec.target, a.id, 'the suspect target was not the room actually posted to');
  assert.deepEqual(rec.owed.map((o) => o.project), [b.id], 'the suspect did not name the owed room B');
});

test('#3224: a post to the SAME room it owes is NOT a misroute suspect (no false positive from the route)', async () => {
  const tok = sendertoken.mint('mara').token;
  const p = room('Misroute same-room 3224', 'mara');
  const ask = messagesEngine.sendPost(
    { operator: true, project: p.id, projectName: p.name, text: '@mara any update?' },
    board.agents, ['mara']);
  assert.ok(['placed', 'unconfirmed'].includes(ask.state), 'the operator ask did not place: ' + (ask.because || ''));
  try { fs.rmSync(messagesEngine.MISROUTE_LOG, { force: true }); } catch { /* fresh */ }
  selfreport.record('mara', { state: 'working' });
  // mara answers IN the room it owes -> not a misroute, so no line.
  const r = await post({ project: p.id, text: 'here is the update', from_pane: '' }, { 'x-kosmos-agent-token': tok });
  assert.ok(['placed', 'unconfirmed'].includes(r.json.delivery.state), 'the post should still reach the room');
  assert.equal(fs.existsSync(messagesEngine.MISROUTE_LOG), false,
    'answering in the room you owe must not be logged as a misroute');
});

test('a post does NOT clobber a standing waiting state: a needs_you agent stays needs_you, unattributed', async () => {
  const tok = sendertoken.mint('mara').token;
  const p = room('Gamma 2837', 'mara');
  selfreport.record('mara', { state: 'needs_you', because: 'waiting on the operator' });
  const r = await post({ project: p.id, text: 'here is my question', from_pane: '' }, { 'x-kosmos-agent-token': tok });
  assert.ok(['placed', 'unconfirmed'].includes(r.json.delivery.state), 'the post should still reach the room');
  const rep = selfreport.read('mara');
  assert.equal(rep.state, 'needs_you', 'a post must not overwrite a standing needs_you');
  assert.notEqual(rep.project, p.id, 'a waiting agent posting its question must not be attributed as working that project');
});
