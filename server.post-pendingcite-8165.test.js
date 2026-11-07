'use strict';
/**
 * kosmos#8165 review 1 (Opus): a post's id reaches the members (their envelope says "to answer, run: kosmos post
 * --in-reply-to mN") before its row is written, which waits for every member's delivery. A member who answers at once
 * cites a real post the record does not hold yet; it must post, and say what it answers, not be refused.
 * Reproduced first by the reviewer with this harness (a fake tmux runner that answers while typing).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pendingcite-8165-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pendingcite-8165-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pendingcite-8165-w-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pendingcite-8165-p-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pendingcite-8165-l-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const messages = require('./engine/messages');
const chat = require('./engine/chat');
const projects = require('./engine/projects');

let board;
let seen = null;
let replyP = null;
let roomId = null;
async function post(body, headers) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/post`, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

test.before(async () => {
  await start(0);
  board = fleet.install([fleet.agent('dana', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  chat.setRunner((args) => {
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    const m = /--in-reply-to (m\d+)/.exec(args.join(' '));
    if (m && !seen && roomId) {
      seen = { id: m[1], at: messages.kindOfId(m[1]) };
      // The member answers at once, citing the id its envelope gave it, while the post is still being typed.
      replyP = post({ project: roomId, text: 'fast answer', from_pane: '' , in_reply_to: m[1] }, { 'x-kosmos-agent-token': sendertoken.mint('dana').token });
    }
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser((ms) => new Promise((r) => setTimeout(r, Math.max(ms, 300))));
});
test.after(() => {
  messages.resetForTests();
  chat.setRunner(null);
  chat.setDryRun(true);
  if (board) board.restore();
  server.closeAllConnections();
  server.close();
  for (const d of [SANDBOX, process.env.HOME]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

test('kosmos#8165: a reply citing a post that is still being delivered posts, and records what it answers', async () => {
  const p = projects.create({ name: 'Pending cite 8165' });
  projects.addAgent(p.id, 'dana');
  projects.addAgent(p.id, 'mara');
  roomId = p.id;
  const a = await post({ project: p.id, text: '@dana can you check this please?', from_pane: '' }, { 'x-kosmos-agent-token': sendertoken.mint('mara').token });
  assert.ok(seen, 'CONTROL: the envelope was typed with an --in-reply-to id: ' + JSON.stringify(a.json));
  assert.equal(seen.id, a.json.delivery.id);
  assert.deepEqual(seen.at, { is: 'post' }, 'the id of a post being delivered must read as a post');
  const r = await replyP;
  assert.notEqual(r.json.delivery.state, 'could_not', 'a real, fast reply was refused: ' + JSON.stringify(r.json.delivery));
  const row = messages.record().rows.find((x) => x && x.kind === 'post' && x.text === 'fast answer');
  assert.ok(row, 'the fast reply was not recorded');
  assert.equal(row.replyTo, a.json.delivery.id, 'the fast reply does not say what it answers');
});
