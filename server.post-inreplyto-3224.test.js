'use strict';
/**
 * #3224: an agent on multiple projects posts a reply into the WRONG project's room.
 * The fix binds a reply to the room the answered message came from: POST /api/post
 * accepts in_reply_to (a post id); the answered post's project is a NON-CIRCULAR
 * oracle (recorded when it was posted, independent of this reply, unlike stateProject
 * #2837). If the target project differs, the reply is REFUSED and both rooms named --
 * the misroute caught. Absent in_reply_to is unchanged; an aged-out citation falls
 * through to the explicit project so a legitimate reply is never blocked.
 *
 * The poster is a member of BOTH rooms (a real multi-project agent), so a refusal is
 * the in_reply_to guard, never a membership refusal -- the CONTROL arms pin that.
 *
 *   node --test server.post-inreplyto-3224.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-inreplyto-3224-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-inreplyto-3224-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-inreplyto-3224-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-inreplyto-3224-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-inreplyto-3224-launch-'));
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

let board;
test.before(async () => {
  await start(0);
  // `dana` is the multi-project poster; `mara` is the standing co-member so a post places.
  board = fleet.install([fleet.agent('dana', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
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

// A room `dana` (the multi-project agent) and `mara` both belong to.
function room(name) {
  const p = projects.create({ name });
  projects.addAgent(p.id, 'dana');
  projects.addAgent(p.id, 'mara');
  return p;
}

const tok = () => sendertoken.mint('dana').token;

test('#3224 THE FIX: a reply whose in_reply_to is in a DIFFERENT room than the target is REFUSED, naming both rooms', async () => {
  const a = room('Alpha 3224');
  const b = room('Beta 3224');
  // A message lands in B; capture its id (the message the agent will answer).
  const seed = await post({ project: b.id, text: 'question for beta', from_pane: '' }, { 'x-kosmos-agent-token': tok() });
  assert.ok(['placed', 'unconfirmed'].includes(seed.json.delivery.state), 'the seed post did not reach Beta: ' + (seed.json.delivery.because || ''));
  const mB = seed.json.delivery.id;
  assert.ok(mB, 'the seed post did not return an id to answer');

  // CONTROL: dana is a member of Alpha, so a plain post to Alpha places -- proving the
  // refusal below is the in_reply_to guard, not a membership refusal.
  const control = await post({ project: a.id, text: 'a legit alpha post', from_pane: '' }, { 'x-kosmos-agent-token': tok() });
  assert.ok(['placed', 'unconfirmed'].includes(control.json.delivery.state),
    'CONTROL: dana must be able to post to Alpha at all, or the fix arm proves nothing: ' + (control.json.delivery.because || ''));

  // THE FIX: answering B's message (in_reply_to mB) but targeting Alpha is the misroute.
  const r = await post({ project: a.id, text: 'answer meant for beta', from_pane: '', in_reply_to: mB }, { 'x-kosmos-agent-token': tok() });
  assert.equal(r.json.delivery.state, 'could_not', 'a reply bound to Beta but aimed at Alpha must be refused, not posted into Alpha');
  assert.match(r.json.delivery.because, new RegExp(mB), 'the refusal references the cited message id the caller already holds');
  assert.match(r.json.delivery.because, /different room/, 'the refusal must explain the misroute');
  // #3224 iter2 leak-fix: the refusal must NOT disclose the answered project's NAME --
  // that would leak a project name to a caller who may not be a member of it
  // (the id-enumeration tell react() avoids). The answering agent already has the name
  // in the envelope it is replying to.
  assert.doesNotMatch(r.json.delivery.because, /Beta 3224/, 'the refusal must not leak the answered project name');
  assert.doesNotMatch(r.json.delivery.because, /Alpha 3224/, 'the refusal must not leak the target project name either');
});

test('#3224 MATCH: a reply whose in_reply_to is in the SAME room as the target posts normally', async () => {
  const b = room('Beta match 3224');
  const seed = await post({ project: b.id, text: 'seed', from_pane: '' }, { 'x-kosmos-agent-token': tok() });
  const mB = seed.json.delivery.id;
  const r = await post({ project: b.id, text: 'the right answer', from_pane: '', in_reply_to: mB }, { 'x-kosmos-agent-token': tok() });
  assert.ok(['placed', 'unconfirmed'].includes(r.json.delivery.state),
    'a reply into the same room the message came from must place: ' + (r.json.delivery.because || ''));
});

test('#3224 NON-REGRESSION: a post with NO in_reply_to is unchanged (the common case)', async () => {
  const a = room('Alpha plain 3224');
  const r = await post({ project: a.id, text: 'a proactive post, not a reply', from_pane: '' }, { 'x-kosmos-agent-token': tok() });
  assert.ok(['placed', 'unconfirmed'].includes(r.json.delivery.state),
    'a proactive post must be unaffected by the in_reply_to guard: ' + (r.json.delivery.because || ''));
});

test('#3224 AGED-OUT: an in_reply_to that names no known post falls through to the explicit project (never blocks a legit reply)', async () => {
  const a = room('Alpha aged 3224');
  const r = await post({ project: a.id, text: 'answering a citation that rolled off the record', from_pane: '', in_reply_to: 'm999999' }, { 'x-kosmos-agent-token': tok() });
  assert.ok(['placed', 'unconfirmed'].includes(r.json.delivery.state),
    'an unresolvable in_reply_to must not block a legitimate reply; it should proceed with the explicit project: ' + (r.json.delivery.because || ''));
});

test('#3224 TYPE-CHECK: a non-string in_reply_to is refused with 400 before any side-effect (parity with reply_expected)', async () => {
  const a = room('Alpha type 3224');
  const r = await post({ project: a.id, text: 'x', from_pane: '', in_reply_to: { not: 'a string' } }, { 'x-kosmos-agent-token': tok() });
  assert.equal(r.status, 400, 'a non-string in_reply_to must be a 400 request-shape refusal, not coerced');
  assert.match(r.json.error || '', /in_reply_to/, 'the 400 must name the offending field');
});

// LAST test in this file: it makes the message log unreadable, so nothing may run after it.
test('#3224 FAIL-CLOSED (server path): an unreadable record makes /api/post REFUSE the bound reply, not post blind or 500', async () => {
  const b = room('Beta failclosed 3224');
  const seed = await post({ project: b.id, text: 'seed', from_pane: '' }, { 'x-kosmos-agent-token': tok() });
  const mB = seed.json.delivery.id;
  // Force messages.record() to ok:false: replace the log FILE with a directory.
  const fs2 = require('node:fs');
  const logPath = messagesEngine.LOG;
  messagesEngine.resetForTests();
  fs2.rmSync(logPath, { force: true, recursive: true });
  fs2.mkdirSync(logPath, { recursive: true });
  messagesEngine.resetForTests();
  const r = await post({ project: b.id, text: 'a bound reply while the record is unreadable', from_pane: '', in_reply_to: mB }, { 'x-kosmos-agent-token': tok() });
  assert.equal(r.status, 200, 'the route must still respond 200 with a delivery verdict, not throw a 500');
  assert.equal(r.json.delivery.state, 'could_not',
    'an unreadable record must FAIL CLOSED (refuse), never post blind into a possibly-wrong room: ' + JSON.stringify(r.json.delivery));
  assert.match(r.json.delivery.because, /could not check/, 'the refusal must say it could not verify the room');
});
