'use strict';
/**
 * #3224, the proactive half: a room post that is NOT a reply (no in_reply_to), from
 * an agent that owes the person an answer in a DIFFERENT room, is held back once with
 * a question naming that room and both commands (answer it with --in-reply-to, or
 * send it again with --new). The reply half (#3567) is pinned in
 * server.post-inreplyto-3224.test.js; this file pins the hold, its exits, and that
 * the outbox drain never holds (its author is not there to answer).
 *
 * The poster is a member of BOTH rooms, so every refusal here is the hold, never
 * membership; the CONTROL arm pins that.
 *
 *   node --test server.post-whichroom-3224.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-whichroom-3224-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-whichroom-3224-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-whichroom-3224-work-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-whichroom-3224-proj-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-whichroom-3224-launch-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, drainOutboxNow } = require('./server');
const outbox = require('./engine/outbox');
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
const H = () => ({ 'x-kosmos-agent-token': tok() });
const reached = (d) => ['placed', 'unconfirmed'].includes(d.state);

/* An operator question in `project` that mentioned dana and reached her pane, seeded
   straight into the record with the current time (the operator room route is not
   what is under test). record() reads the appended tail, so the next post sees it. */
let seq = 0;
/* Each test starts from an empty message record, so a question one test seeds is not
   still owed in the next (the hold would then fire for the wrong reason). */
test.beforeEach(() => {
  messagesEngine.resetForTests();
  fs.rmSync(messagesEngine.LOG, { force: true });
  messagesEngine.resetForTests();
});
function operatorAsk(project, minsAgo = 1) {
  const id = 'q3224w' + (++seq);
  const row = { kind: 'post', id, from: 'you', project, to: ['dana'], text: '@dana where is it?',
    operator: true, mentioned: ['dana'], outcomes: { dana: chatEngine.DELIVERY.PLACED },
    at: new Date(Date.now() - minsAgo * 60 * 1000).toISOString() };
  fs.appendFileSync(messagesEngine.LOG, JSON.stringify(row) + '\n');
  return id;
}

test('#3224 THE HOLD: a non-reply post to A while dana owes the person in B is held, naming B, the question and both commands', async () => {
  const a = room('Alpha hold 3224');
  const b = room('Beta hold 3224');
  // CONTROL: before any question is owed, the same post places (so the hold below is not membership).
  const control = await post({ project: a.id, text: 'a plain alpha post', from_pane: '' }, H());
  assert.ok(reached(control.json.delivery), 'CONTROL: dana must be able to post to Alpha at all: ' + (control.json.delivery.because || ''));
  const q = operatorAsk(b.id);
  const r = await post({ project: a.id, text: 'meant for beta', from_pane: '' }, H());
  assert.equal(r.status, 200);
  assert.equal(r.json.delivery.state, 'could_not', 'the post must be held, not placed in Alpha: ' + JSON.stringify(r.json.delivery));
  assert.equal(r.json.delivery.code, 'which_room');
  const because = r.json.delivery.because;
  assert.match(because, /Beta hold 3224/, 'names the room the question is in, by name');
  assert.ok(because.includes('(' + q + ')'), 'names the question by id');
  assert.ok(because.includes('kosmos post --in-reply-to ' + q + ' ' + b.id), 'gives the answer-it command');
  assert.ok(because.includes('kosmos post --new ' + a.id), 'gives the it-is-new command');
  assert.doesNotMatch(because, /["`]/, 'no double quote or backtick: the bash CLI reads because with a sed that stops at a quote');
  // Nothing was written into Alpha's room for the held post.
  const inAlpha = messagesEngine.readLog().filter((m) => m && m.kind === 'post' && m.project === a.id && m.text === 'meant for beta');
  assert.equal(inAlpha.length, 0, 'a held post must not reach the record');
  // And it is not a refused row the room would show.
  const refusedRows = messagesEngine.readLog().filter((m) => m && m.kind === 'refused' && m.project === a.id);
  assert.equal(refusedRows.length, 0, 'the hold is a question to the agent, not a refusal logged in the room');
});

test('#3224 --new: new_post:true posts to A as before, is recorded on the row, and the NEXT post to A is not held again', async () => {
  const a = room('Alpha new 3224');
  const b = room('Beta new 3224');
  operatorAsk(b.id);
  const held = await post({ project: a.id, text: 'first', from_pane: '' }, H());
  assert.equal(held.json.delivery.code, 'which_room', 'CONTROL: without --new the post is held');
  const r = await post({ project: a.id, text: 'genuinely new for alpha', from_pane: '', new_post: true }, H());
  assert.ok(reached(r.json.delivery), 'new_post:true must place: ' + (r.json.delivery.because || ''));
  const row = messagesEngine.readLog().find((m) => m && m.kind === 'post' && m.text === 'genuinely new for alpha');
  assert.equal(row && row.newPost, true, 'the --new post is marked on its row');
  const next = await post({ project: a.id, text: 'the next alpha post', from_pane: '' }, H());
  assert.ok(reached(next.json.delivery), 'the question was put once; the next post must not be held for it again: ' + (next.json.delivery.because || ''));
});

test('#3224 removed from B, or B deleted: its question no longer holds a post to A', async () => {
  const a = room('Alpha gone 3224');
  const b = room('Beta gone 3224');
  operatorAsk(b.id);
  const held = await post({ project: a.id, text: 'while still in beta', from_pane: '' }, H());
  assert.equal(held.json.delivery.code, 'which_room', 'CONTROL: while dana is on Beta the post is held');
  projects.removeAgent(b.id, 'dana');
  const r1 = await post({ project: a.id, text: 'after leaving beta', from_pane: '' }, H());
  assert.ok(reached(r1.json.delivery), 'a room dana cannot post in must not be offered as the answer: ' + (r1.json.delivery.because || ''));
  const c = room('Gamma gone 3224');
  operatorAsk(c.id);
  const held2 = await post({ project: a.id, text: 'while gamma exists', from_pane: '' }, H());
  assert.equal(held2.json.delivery.code, 'which_room', 'CONTROL: while Gamma exists the post is held');
  projects.remove(c.id);
  const r2 = await post({ project: a.id, text: 'after gamma is gone', from_pane: '' }, H());
  assert.ok(reached(r2.json.delivery), 'a deleted room must not be offered as the answer: ' + (r2.json.delivery.because || ''));
});

test('#3224 a post that would be refused anyway gets that refusal, not the which-room question', async () => {
  const a = room('Alpha bad 3224');
  const b = room('Beta bad 3224');
  operatorAsk(b.id);
  const r = await post({ project: a.id, text: 'x'.repeat(200000), from_pane: '' }, H());
  assert.equal(r.json.delivery.state, 'could_not');
  assert.notEqual(r.json.delivery.code, 'which_room', 'the real refusal must come first: ' + r.json.delivery.because);
});

test('#3224 answering it: a reply into B with in_reply_to the question places (and clears the debt)', async () => {
  const a = room('Alpha answer 3224');
  const b = room('Beta answer 3224');
  const q = operatorAsk(b.id);
  const r = await post({ project: b.id, text: 'the answer', from_pane: '', in_reply_to: q }, H());
  assert.ok(reached(r.json.delivery), 'the answer must place: ' + (r.json.delivery.because || ''));
  const after = await post({ project: a.id, text: 'now alpha, nothing owed', from_pane: '' }, H());
  assert.ok(reached(after.json.delivery), 'once answered, a post to Alpha is not held: ' + (after.json.delivery.because || ''));
});

test('#3224 a reply (in_reply_to set) is never asked which room, even while another room is owed', async () => {
  const a = room('Alpha reply 3224');
  const b = room('Beta reply 3224');
  const seed = await post({ project: a.id, text: 'seed in alpha', from_pane: '' }, H());
  assert.ok(reached(seed.json.delivery));
  operatorAsk(b.id);
  const ctl = await post({ project: a.id, text: 'CONTROL, no citation', from_pane: '' }, H());
  assert.equal(ctl.json.delivery.code, 'which_room', 'CONTROL: the same post without in_reply_to is held');
  const r = await post({ project: a.id, text: 'answering the alpha seed', from_pane: '', in_reply_to: seed.json.delivery.id }, H());
  assert.ok(reached(r.json.delivery), 'a bound reply is already checked by #3567 and must not also be held: ' + (r.json.delivery.because || ''));
});

test('#3224 posting into the room the question is in is not held', async () => {
  const a = room('Alpha same 3224');
  const b = room('Beta same 3224');
  operatorAsk(b.id);
  // CONTROL first (a post into Beta answers the question): the same setup posting to Alpha is held.
  const ctl = await post({ project: a.id, text: 'CONTROL into alpha', from_pane: '' }, H());
  assert.equal(ctl.json.delivery.code, 'which_room', 'CONTROL: the same setup posting to Alpha is held');
  const r = await post({ project: b.id, text: 'into beta, no citation', from_pane: '' }, H());
  assert.ok(reached(r.json.delivery), r.json.delivery.because || '');
});

test('#3224 an old question (over an hour) does not hold a post', async () => {
  const a = room('Alpha old 3224');
  const b = room('Beta old 3224');
  operatorAsk(b.id, 61);
  const r = await post({ project: a.id, text: 'alpha, the beta ask is stale', from_pane: '' }, H());
  assert.ok(reached(r.json.delivery), r.json.delivery.because || '');
  operatorAsk(b.id, 59);
  const ctl = await post({ project: a.id, text: 'CONTROL, a 59-minute ask', from_pane: '' }, H());
  assert.equal(ctl.json.delivery.code, 'which_room', 'CONTROL: an ask just inside the hour holds');
});

test('#3224 TYPE-CHECK: a non-boolean new_post is a 400 before any side-effect', async () => {
  const a = room('Alpha type new 3224');
  const r = await post({ project: a.id, text: 'x', from_pane: '', new_post: 'true' }, H());
  assert.equal(r.status, 400);
  assert.match(r.json.error || '', /new_post/);
});

test('#3224 THE DRAIN never holds: a kept post replays into A while B is owed', async () => {
  const a = room('Alpha drain 3224');
  const b = room('Beta drain 3224');
  operatorAsk(b.id);
  fs.rmSync(outbox.outboxDir(), { recursive: true, force: true });
  assert.equal(outbox.keep({ verb: 'post', body: { project: a.id, text: 'kept for alpha', from_pane: '' }, from: 'dana' }).ok, true);
  const summary = drainOutboxNow();
  assert.equal(summary.delivered, 1, 'the kept post must be delivered, not retried forever: ' + JSON.stringify(summary));
  const rows = messagesEngine.readLog().filter((m) => m && m.kind === 'post' && m.project === a.id && m.text === 'kept for alpha');
  assert.equal(rows.length, 1);
});
