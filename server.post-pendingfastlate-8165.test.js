'use strict';
/**
 * kosmos#8165 review 3 (Opus): a reply to a post still being delivered reads the room as a late reply does. Two readers
 * scanned only the record, which takes a post when its deliveries finish: the quote tag (quotedSegments), and the
 * person's claim line (claimAskedMembers). Measured by the reviewer as fast-vs-late pairs; pinned here the same way.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fastlate-8165-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fastlate-8165-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fastlate-8165-w-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fastlate-8165-p-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-fastlate-8165-l-'));
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
let hook = null;
const typed = [];
async function post(body, headers) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/post`, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}
async function personPost(id, body) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/project/${id}/room`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}
const tok = (n) => ({ 'x-kosmos-agent-token': sendertoken.mint(n).token });

test.before(async () => {
  await start(0);
  board = fleet.install([fleet.agent('dana', { state: 'idle' }), fleet.agent('mara', { state: 'idle' }), fleet.agent('lee', { state: 'idle' })]);
  chat.setRunner((args) => {
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    const j = args.join(' ');
    typed.push(j);
    if (hook) hook(j);
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

const LONG = 'the signing step on the release branch failed with an expired certificate this morning';

/* The reply carries the WHOLE ask (quotedSegments tags a whole earlier post inside a reply). One room per arm (review 3's measure): a reply in the same room as another reply that quotes the same words is a
   different case, so the fast and the late arm must not share a room. `fast` sends the reply while the ask is typed. */
async function arm(name, fast, ask, reply, asker, replier) {
  const p = projects.create({ name });
  for (const n of ['dana', 'mara', 'lee']) projects.addAgent(p.id, n);
  let fastP = null;
  if (fast) hook = (j) => { const m = /--in-reply-to (m\d+)/.exec(j); if (m && !fastP) fastP = reply(p.id, m[1]); };
  typed.length = 0;
  const a = await post({ project: p.id, text: ask }, tok(asker));
  hook = null;
  let r;
  if (fast) { assert.ok(fastP, 'CONTROL: the fast reply was sent while the ask was typed (' + name + ')'); r = await fastP; }
  else { typed.length = 0; r = await reply(p.id, a.json.delivery.id); }
  return { id: a.json.delivery.id, r, typed: typed.slice(), rows: messages.record().rows.filter((x) => x && x.project === p.id) };
}

test('kosmos#8165 r3: a fast reply quoting the post it answers is tagged as quoting it, as a late one is', async () => {
  const reply = (pid, cite) => post({ project: pid, text: '@dana ' + LONG + ' -- renewing it now', in_reply_to: cite }, tok('dana'));
  const fast = await arm('Quotes fast 8165', true, '@dana ' + LONG, reply, 'mara');
  const late = await arm('Quotes late 8165', false, '@dana ' + LONG, reply, 'mara');
  const q = (x) => { const row = x.rows.find((y) => y.text === '@dana ' + LONG + ' -- renewing it now'); return row && row.quotes; };
  assert.ok(Array.isArray(q(late)) && q(late).length, 'CONTROL: the late reply is tagged: ' + JSON.stringify(q(late)));
  assert.ok(Array.isArray(q(fast)) && q(fast).length, 'the fast reply was not tagged as quoting: ' + JSON.stringify(q(fast)));
  assert.equal(q(fast)[0].of, fast.id);
  // And the ask is never tagged as quoting its own fast reply (a later post, pending while the ask was recorded).
  const askRow = fast.rows.find((y) => y.id === fast.id);
  assert.equal(askRow && askRow.quotes, undefined, 'the ask was tagged as quoting a later reply: ' + JSON.stringify(askRow && askRow.quotes));
});

test('kosmos#8165 r3: the person\'s fast reply to an agent\'s ask leaves it to the asker, as a late one does', async () => {
  const reply = (pid, cite) => personPost(pid, { text: 'yes please do that next', reply_to: cite });
  const fast = await arm('Claim fast 8165', true, '@dana should I roll the cert today?', reply, 'mara');
  const late = await arm('Claim late 8165', false, '@dana should I roll the cert today?', reply, 'mara');
  const claims = (x) => x.typed.filter((t) => t.includes('yes please do that next') && t.includes('claim it first')).length;
  const sent = (x) => x.typed.filter((t) => t.includes('yes please do that next')).length;
  assert.ok(sent(fast) && sent(late), 'CONTROL: both replies were typed: ' + sent(fast) + ' / ' + sent(late));
  // Measured against the previous commit: the fast reply woke 3 members (every one, to claim it), the late one 1 (the
  // asker). The envelope is typed in pieces, so "claim it first" need not share a chunk with the words; who is woken does.
  assert.equal(sent(fast), sent(late), 'a fast reply woke ' + sent(fast) + ' members where a late one wakes ' + sent(late));
  assert.equal(claims(fast), claims(late));
});
