'use strict';
require('./test-support/tmpscope');

/**
 * kosmos#7155: after a gap (out of usage, a crash, a restart), `kosmos inbox --unanswered` lists the person's messages
 * after the agent's newest reply, and `--since <time>` only those at or after a time. Both filter before the limit,
 * and the limit says what it left out.
 *
 *   node --test server.inbox-unanswered-7155.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-7155-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState, keepAgentReply } = require('./server');
const fleet = require('./test-support/fleet');
const chat = require('./engine/chat');
const sendertoken = require('./engine/sendertoken');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [require('./engine/store').ROOT, chat.threadFile(chat.DIRECT, 'leo')]);

const TOK = 'BOARDTOKEN_7155_0123456789abcdef';
const WHO = 'leo';
let base;

let t0;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.token = TOK;
  boardAuthState.on = false;
  t0 = Date.parse('2026-10-25T10:00:00Z');
  const at = (s) => new Date(t0 + s * 1000).toISOString();
  const placed = { state: chat.DELIVERY.PLACED };
  chat.appendMessage(chat.DIRECT, WHO, { text: 'answered question', at: at(0), delivery: placed });
  keepAgentReply(WHO, 'Done.', at(10));
  chat.appendMessage(chat.DIRECT, WHO, { text: 'first unanswered', at: at(20), delivery: placed });
  chat.appendMessage(chat.DIRECT, WHO, { text: 'Yes', wire: '1', at: at(30), delivery: placed });
  keepAgentReply(WHO, 'Kosmos: your daily limit is reached', at(40), { kosmos: true });
  chat.appendMessage(chat.DIRECT, WHO, { text: 'lost one', at: at(50), delivery: { state: chat.DELIVERY.COULD_NOT } });
  chat.appendMessage(chat.DIRECT, WHO, { text: 'third unanswered', at: at(60), delivery: placed });
});
test.after(() => { try { server.close(); } catch { /* best effort */ } });

async function get(p) {
  const board = fleet.install([fleet.agent(WHO, { state: 'idle' })]);
  const tok = sendertoken.mint(WHO).token;
  try {
    const res = await fetch(base + p, { headers: { 'x-kosmos-agent-token': tok } });
    const text = await res.text();
    let json = {}; try { json = JSON.parse(text); } catch { /* text arm */ }
    return { code: res.status, text, json };
  } finally { sendertoken.revoke(WHO); board.restore(); }
}

test('#7155: --unanswered lists the person\'s messages after your newest reply, oldest first, a lost one marked', async () => {
  const r = await get('/api/inbox?as=text&unanswered=1');
  assert.equal(r.code, 200, r.text);
  const lines = r.text.trimEnd().split('\n');
  assert.deepEqual(lines.map((l) => l.replace(/^\S+ \S+ /, '')), [
    'the person: first unanswered',
    'the person [this did not reach you]: lost one',
    'the person: third unanswered',
  ], 'the menu answer, the answered question, your reply, or Kosmos\'s notice leaked in: ' + r.text);
  // Control: the plain read still shows the answered question and your reply, so the filter is what removed them.
  const all = await get('/api/inbox?as=text');
  assert.match(all.text, /answered question/);
  assert.match(all.text, /you: Done\./);
});

test('#7155: Kosmos\'s own notice never counts as your reply', async () => {
  const r = await get('/api/inbox?unanswered=1');
  assert.equal(r.code, 200, r.text);
  assert.ok(r.json.messages.some((m) => m.text === 'first unanswered'), 'the notice at +40s hid the message at +20s: ' + r.text);
  assert.equal(r.json.earlier, 0);
});

test('#7155: --since keeps only messages at or after the time; an offset and a local time are read', async () => {
  const r = await get('/api/inbox?as=text&since=' + encodeURIComponent('2026-10-25T10:00:50Z'));
  assert.equal(r.code, 200, r.text);
  assert.deepEqual(r.text.trimEnd().split('\n').map((l) => l.replace(/^\S+ \S+ /, '')), [
    'the person [this did not reach you]: lost one', 'the person: third unanswered']);
  const off = await get('/api/inbox?since=' + encodeURIComponent('2026-10-25T05:00:50-05:00'));
  assert.equal(off.json.messages.length, 2, 'an offset time was not read: ' + off.text);
  const off4 = await get('/api/inbox?since=' + encodeURIComponent('2026-10-25T05:00:50-0500'));
  assert.equal(off4.json.messages.length, 2, 'a +HHMM offset was not read: ' + off4.text);
  const d = new Date(t0 + 50000);
  const p2 = (n) => String(n).padStart(2, '0');
  const local = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  const loc = await get('/api/inbox?since=' + encodeURIComponent(local));
  assert.equal(loc.json.messages.length, 2, 'a local time was not read as this computer\'s: ' + local + ' ' + loc.text);
});

test('#7155: --since together with --unanswered narrows both ways', async () => {
  const r = await get('/api/inbox?unanswered=1&since=' + encodeURIComponent('2026-10-25T10:00:55Z'));
  assert.deepEqual(r.json.messages.map((m) => m.text), ['third unanswered']);
});

test('#7155: a time that is not a date with a clock time is refused, with how to write one', async () => {
  for (const bad of ['yesterday', '2026-10-25', '2026-10-25T25:99', '', '10:00']) {
    const r = await get('/api/inbox?as=text&since=' + encodeURIComponent(bad));
    assert.equal(r.code, 400, JSON.stringify(bad) + ' was accepted: ' + r.text);
    assert.match(r.text, /--since takes a date and a clock time/);
  }
});

test('#7155: the limit says how many earlier matches it left out, and keeps the newest', async () => {
  const r = await get('/api/inbox?as=text&unanswered=1&limit=1');
  assert.equal(r.code, 200, r.text);
  const lines = r.text.trimEnd().split('\n');
  assert.equal(lines[0], '2 earlier messages not shown (--limit 50 shows more).');
  assert.match(lines[1], /the person: third unanswered$/);
  assert.equal(lines.length, 2);
  const j = await get('/api/inbox?unanswered=1&limit=1');
  assert.equal(j.json.earlier, 2);
  // Control: the plain read with a limit adds no such line (its old output is unchanged).
  const plain = await get('/api/inbox?as=text&limit=1');
  assert.doesNotMatch(plain.text, /not shown/);
});

test('#7155: an empty answer says what was asked', async () => {
  const none = await get('/api/inbox?as=text&since=' + encodeURIComponent('2030-01-01T00:00:00Z'));
  assert.equal(none.text, 'No messages between you and the person since then.\n');
  const both = await get('/api/inbox?as=text&unanswered=1&since=' + encodeURIComponent('2030-01-01T00:00:00Z'));
  assert.match(both.text, /^Nothing unanswered/);
  keepAgentReply(WHO, 'Caught up.', new Date(t0 + 70000).toISOString());
  const clear = await get('/api/inbox?as=text&unanswered=1');
  assert.equal(clear.text, 'Nothing unanswered: you have replied since the person\'s last message.\n');
});
