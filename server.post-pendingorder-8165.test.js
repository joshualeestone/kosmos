'use strict';
/**
 * kosmos#8165 review 4 (Sonnet): the quote tag reads the record as it is when a post is written, so a LATER post that
 * finished first (a fast reply recorded before the ask it answers, in a room the ask takes long to reach) was in it,
 * and the ask was tagged as quoting its own reply. Only rows earlier than the post count, recorded or pending. The
 * first delivery is slowed here so the reply finishes first, as on a busy board (the reviewer's measure).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pendingorder-8165-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pendingorder-8165-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pendingorder-8165-w-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pendingorder-8165-p-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pendingorder-8165-l-'));
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

const NAMES = ['dana', 'mara', 'lee', 'a1', 'a2', 'a3', 'a4'];
let board;
let hook = null;
async function post(body, headers) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/post`, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}
const tok = (n) => ({ 'x-kosmos-agent-token': sendertoken.mint(n).token });

test.before(async () => {
  await start(0);
  board = fleet.install(NAMES.map((n) => fleet.agent(n, { state: 'idle' })));
  chat.setRunner((args) => {
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    if (hook) hook(args.join(' '));
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  let calls = 0;
  chat.setPauser(() => new Promise((r) => setTimeout(r, calls++ === 0 ? 1500 : 20)));   // the ask's first delivery is slow
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

const LONG = 'the signing step on the release branch failed with an expired certificate this morning';

test('kosmos#8165 r4: an ask is never tagged as quoting its fast reply, even when the reply is recorded first', async () => {
  const p = projects.create({ name: 'Order 8165' });
  for (const n of NAMES) projects.addAgent(p.id, n);
  let fastP = null;
  hook = (j) => { const m = /--in-reply-to (m\d+)/.exec(j); if (m && !fastP) fastP = post({ project: p.id, text: '@dana ' + LONG + ' -- renewing it now', in_reply_to: m[1] }, tok('dana')); };
  const a = await post({ project: p.id, text: '@dana ' + LONG }, tok('mara'));
  hook = null;
  assert.ok(fastP, 'CONTROL: the fast reply was sent while the ask was typed');
  const f = await fastP;
  const rows = messages.record().rows.filter((x) => x && x.project === p.id && x.kind === 'post');
  const ask = rows.find((x) => x.id === a.json.delivery.id);
  const reply = rows.find((x) => x.id === f.json.delivery.id);
  assert.ok(rows.indexOf(reply) < rows.indexOf(ask), 'CONTROL: the reply was recorded before the ask (the case under test): ' + JSON.stringify(rows.map((x) => x.id)));
  assert.equal(ask.quotes, undefined, 'the ask was tagged as quoting its own later reply: ' + JSON.stringify(ask.quotes));
  assert.ok(Array.isArray(reply.quotes) && reply.quotes[0] && reply.quotes[0].of === ask.id, 'the reply is tagged as quoting the ask: ' + JSON.stringify(reply.quotes));
});
