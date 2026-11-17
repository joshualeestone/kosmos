'use strict';
/**
 * #8625 (App Store guideline 1.2): the person blocks someone from outside this Kosmos, named by one of their messages.
 * The block is kept by the account the relay stamped, so it covers that person's other computers and every room; their
 * kept messages leave the room as it is read, their new ones are not kept at all, and someone else is untouched.
 * Real rows through the real routes.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-roomblock-8625-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const messages = require('./engine/messages');
const store = require('./engine/store');
const blocked = require('./engine/blockedmembers');

let base;
let pid;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const made = projects.create({ name: 'Shared Room' });
  // Rows older than the project are not its room's, so the project is dated before them (as the #7614 test does).
  projects.writeAll(projects.readAll().map((q) => (q.id === made.id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q)));
  pid = made.id;
  const at = (i) => new Date(Date.parse('2024-01-01T00:00:00.000Z') + i * 1000).toISOString();
  const ext = (id, member, from, i) => ({ kind: 'external', id, project: pid, from, fromKind: 'person', external: true,
    text: 'words from ' + from, at: at(i), ...(member ? { member } : {}) });
  const lines = [
    ext('x-a1', 'acctA', 'Ana', 1),
    ext('x-a2', 'acctA:mac1', 'Ana', 2),   // the same person from another computer
    ext('x-b1', 'acctB', 'Bea', 3),        // CONTROL: someone else
    ext('x-old', null, 'Old', 4),          // an older relay's row, with no stamp
    { ...ext('x-me', 'acctMe:mac2', 'Me', 5), sameAccount: true },   // the person's own other computer
    ext('x-me-old', 'acctMe:mac3', 'Me', 6),   // the same account, kept before rows carried the same_account mark
  ];
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.appendFileSync(path.join(store.ROOT, 'messages.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
});
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const post = (p, body, headers) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...(headers || {}) }, body: JSON.stringify(body || {}) });
async function outsideIds() {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room`);
  assert.equal(res.status, 200);
  const json = await res.json();
  return json.rows.filter((r) => r.kind === 'external').map((r) => r.id).sort();
}

test('#8625: before any block, every outside message is in the room (the precondition)', async () => {
  assert.deepEqual(await outsideIds(), ['x-a1', 'x-a2', 'x-b1', 'x-me', 'x-me-old', 'x-old']);
});

test('#8625: a message with no stamp cannot be blocked (409), and nothing is hidden', async () => {
  const res = await post(`/api/project/${encodeURIComponent(pid)}/room/x-old/block`);
  assert.equal(res.status, 409);
  assert.deepEqual(blocked.list(), []);
  assert.deepEqual(await outsideIds(), ['x-a1', 'x-a2', 'x-b1', 'x-me', 'x-me-old', 'x-old']);
});

test('#8625: the person\'s own post from another of their computers cannot be blocked or reported (409)', async () => {
  assert.equal((await post(`/api/project/${encodeURIComponent(pid)}/room/x-me/block`)).status, 409);
  assert.equal((await post(`/api/project/${encodeURIComponent(pid)}/room/x-me-old/block`)).status, 409, 'an older row of the same account, with no mark of its own');
  assert.equal((await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room/x-me/sender`)).status, 409);
  assert.deepEqual(blocked.list(), [], 'the person did not block themselves');
});

test('#8625: the sender route names the account behind an outside message, for the report', async () => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room/x-a2/sender`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { account: 'acctA' }, 'the account, without the computer part');
  assert.equal((await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room/x-old/sender`)).status, 409, 'no stamp, no account');
  assert.equal((await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room/x-none/sender`)).status, 404);
  assert.equal((await fetch(`${base}/api/project/${encodeURIComponent(pid)}/room/x-a1/sender`, { headers: { 'x-kosmos-agent-token': 'agent-token-not-a-person' } })).status, 403);
});

test('#8625: an unknown message is 404; an agent token is refused (403)', async () => {
  assert.equal((await post(`/api/project/${encodeURIComponent(pid)}/room/x-none/block`)).status, 404);
  assert.equal((await post(`/api/project/${encodeURIComponent(pid)}/room/x-a1/block`, {}, { 'x-kosmos-agent-token': 'agent-token-not-a-person' })).status, 403);
  assert.equal((await post(`/api/project/${encodeURIComponent(pid)}/room/x-a1/block`, { token: 'agent-token-not-a-person' })).status, 403, 'a token in the body too');
  assert.equal((await fetch(`${base}/api/blocked`, { headers: { 'x-kosmos-agent-token': 'agent-token-not-a-person' } })).status, 403);
  assert.equal((await post('/api/blocked/unblock', { account: 'acctA' }, { 'x-kosmos-agent-token': 'agent-token-not-a-person' })).status, 403);
  assert.deepEqual(blocked.list(), [], 'the refused calls blocked nobody');
});

test('#8625: blocking one message hides that person on every computer, and only them', async () => {
  const res = await post(`/api/project/${encodeURIComponent(pid)}/room/x-a1/block`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { blocked: true, name: 'Ana' });
  assert.deepEqual(await outsideIds(), ['x-b1', 'x-me', 'x-me-old', 'x-old'], 'Ana from both computers is gone; Bea, the person\'s own and the unstamped row stay');
  const unread = messages.unreadAll();
  assert.equal(unread && unread[pid], 4, 'the unread count leaves the blocked person\'s two rows out (6 outside rows, 2 hidden)');
  const list = await (await fetch(`${base}/api/blocked`)).json();
  assert.deepEqual(list.blocked.map((b) => [b.account, b.name]), [['acctA', 'Ana']]);
  assert.equal(JSON.stringify(list).includes('words from'), false, 'the list holds no message text');
});

test('#8625: a blocked person\'s new message is not kept; someone else\'s is', () => {
  const before = messages.record().rows.length;
  assert.equal(messages.externalPost(pid, { from: 'Ana', fromKind: 'person', text: 'again', member: 'acctA:mac2' }), null);
  assert.equal(messages.record().rows.length, before, 'nothing was written for the blocked person');
  const kept = messages.externalPost(pid, { from: 'Bea', fromKind: 'person', text: 'still here', member: 'acctB' });
  assert.ok(kept && kept.id, 'CONTROL: another person is still kept');
});

test('#8625: unblocking brings their kept messages back into the room', async () => {
  const res = await post('/api/blocked/unblock', { account: 'acctA' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).changed, true);
  const ids = await outsideIds();
  assert.ok(ids.includes('x-a1') && ids.includes('x-a2'));
  assert.equal((await post('/api/blocked/unblock', { account: '../etc' })).status, 400, 'a malformed account is refused');
});
