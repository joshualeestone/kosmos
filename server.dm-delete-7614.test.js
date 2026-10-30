'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * kosmos#7614: the route the board (and the phone) call to delete one of the person's own direct messages,
 * POST /api/agent/:name/thread/delete with { at }. The engine's behaviour is pinned in
 * engine/chat.dm-delete-7614.test.js; this pins the route: its answers, its name gate, and that only the person's own
 * row goes. Real thread rows through the real route; the note to the agent is recorded instead of typed.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dmdelete-7614-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./engine/store');
const chat = require('./engine/chat');
const fleet = require('./test-support/fleet');
const { start, server } = require('./server');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');

const NAME = 'del7614';
assertSandboxedDataRoot(SANDBOX, [store.ROOT, chat.threadFile(chat.DIRECT, NAME)]);

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

const t = (n) => new Date(Date.UTC(2026, 9, 30, 12, 0, n)).toISOString();
chat.appendMessage(chat.DIRECT, NAME, { text: 'delete me', at: t(1), delivery: { state: chat.DELIVERY.PLACED } });
chat.appendMessage(chat.DIRECT, NAME, { text: 'the agent wrote this', from: NAME, at: t(2) });
const rows = () => chat.readThread(chat.DIRECT, NAME).messages.map((m) => m.at);

async function del(name, body, origin, headers) {
  const board = fleet.install([fleet.agent(NAME, { state: 'idle' })]);
  const real = chat.deliverAutomaticAsync;
  const typed = [];
  chat.deliverAutomaticAsync = async (n, line) => { typed.push({ n, line }); return { state: chat.DELIVERY.PLACED }; };
  try {
    const res = await fetch(`${base}/api/agent/${encodeURIComponent(name)}/thread/delete`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), ...(headers || {}) }, body: JSON.stringify(body),
    });
    return { status: res.status, out: await res.json().catch(() => null), typed };
  } finally { chat.deliverAutomaticAsync = real; board.restore(); }
}

test('#7614 route: the agent\'s own message is refused (403) and stays', async () => {
  const r = await del(NAME, { at: t(2) });
  assert.equal(r.status, 403);
  assert.deepEqual(rows(), [t(1), t(2)]);
  assert.equal(r.typed.length, 0);
});

test('#7614 route: a body without a time is refused (400); no message at that time is 404', async () => {
  assert.equal((await del(NAME, {})).status, 400);
  assert.equal((await del(NAME, { at: t(9) })).status, 404);
});

test('#7614 route: another site cannot delete (the board\'s cross-site guard)', async () => {
  const r = await del(NAME, { at: t(1) }, 'http://evil.example');
  assert.ok(r.status >= 400, 'refused, got ' + r.status);
  assert.deepEqual(rows(), [t(1), t(2)], 'still there');
});

test('#7614 review 1: an agent\'s token is refused (403), in the header or the body, and the person\'s message stays', async () => {
  const h = await del(NAME, { at: t(1) }, null, { 'x-kosmos-agent-token': 'any-agent-token' });
  const b = await del(NAME, { at: t(1), token: 'any-agent-token' });
  for (const r of [h, b]) {
    assert.equal(r.status, 403);
    assert.match(r.out.error, /person's, not an agent's/);
    assert.equal(r.typed.length, 0);
  }
  assert.deepEqual(rows(), [t(1), t(2)], 'still there');
});

test('#7614 route: the person\'s own message goes, and the answer names the agent told', async () => {
  const r = await del(NAME, { at: t(1) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.out, { deleted: true, at: t(1), told: [NAME] });
  assert.deepEqual(rows(), [t(2)], 'only the person\'s message is gone');
  assert.equal(r.typed.length, 1);
});

test('#7614 review 5: the scroll-back page marks only rows from a rolled-over file (earlierPart), and those alone refuse Delete', async () => {
  const who = 'rollbot';
  const at = (i) => new Date(Date.UTC(2026, 0, 2, 0, 0, 0, i)).toISOString();
  for (let i = 0; i < chat.MAX_MESSAGES; i += 1) assert.equal(chat.appendMessage(chat.DIRECT, who, { text: 'p' + i, at: at(i), delivery: { state: 'placed' } }).recorded, true);
  assert.equal(chat.appendMessage(chat.DIRECT, who, { text: 'rolls it over', at: at(5000), delivery: { state: 'placed' } }).recorded, true);
  const board = fleet.install([fleet.agent(who, { state: 'idle' })]);
  try {
    // Two pages: the oldest rows (before=50, from the rolled-over file) and the newest (this file's own and its carried copies).
    const pageOf = async (before) => { const res = await fetch(`${base}/api/agent/${who}/thread/older?before=${before}`); assert.equal(res.status, 200); return (await res.json()).messages; };
    const byAt = new Map([...(await pageOf(50)), ...(await pageOf(100000))].map((m) => [m.at, m]));
    // p5 lives only in the rolled-over file; p990 was carried into the current one; the newest is the current file's own.
    assert.equal(byAt.get(at(5)) && byAt.get(at(5)).earlierPart, true, 'a rolled-over row is marked');
    assert.equal(byAt.get(at(990)) && byAt.get(at(990)).earlierPart, true, 'a carried row (kept in the earlier file too) is marked');
    assert.ok(byAt.get(at(5000)) && !byAt.get(at(5000)).earlierPart, 'this file\'s own row is not marked');
    // The thread route marks the carried head the same way.
    const tail = (await (await fetch(`${base}/api/agent/${who}/thread`)).json()).messages;
    const tailAt = new Map(tail.map((m) => [m.at, m]));
    assert.equal(tailAt.get(at(990)) && tailAt.get(at(990)).earlierPart, true, 'the thread route marks a carried row');
    assert.ok(tailAt.get(at(5000)) && !tailAt.get(at(5000)).earlierPart, 'the thread route leaves this file\'s own row unmarked');
    // And the marks agree with what Delete does: an earlier file's row and a carried row are refused; this file's own goes.
    assert.equal((await del(who, { at: at(5) })).status, 409);
    assert.equal((await del(who, { at: at(990) })).status, 409);
    assert.equal((await del(who, { at: at(5000) })).status, 200);
    const after = [...(await pageOf(100000))].map((m) => m.at);
    assert.equal(new Set(after).size, after.length, 'a row shows twice in scroll-back');
    assert.ok(after.includes(at(990)) && !after.includes(at(5000)), 'the carried row stays; the deleted one is gone');
  } finally { board.restore(); }
});

