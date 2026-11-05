'use strict';
/**
 * kosmos#8024: opening an agent's chat acknowledges the needs-you pushes it holds, through the real routes.
 *
 *   node --test engine/needsyouack-8024.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ack-8024-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, '..', 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const state = mk('remote');
for (const f of ['mac_id', 'address', 'tls.crt', 'tls.key']) fs.writeFileSync(path.join(state, f), 'x');
fs.writeFileSync(path.join(state, 'phone-notify.json'), JSON.stringify({ on: true, notifyId: '11111111-2222-4333-8444-555555555555', token: 'knt1_needsyouack0123456789' }));
process.env.AGENT_WORKFORCE_TUNNEL_STATE = state;
process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR = 'http://127.0.0.1:9';   // never dialled: a sender is injected
delete process.env.KOSMOS_NO_PHONE_NOTICES;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const test = require('node:test');
const assert = require('node:assert/strict');
const remote = require('./remote');
fs.mkdirSync(path.dirname(remote.FILE), { recursive: true });
fs.writeFileSync(remote.FILE, JSON.stringify({ on: true }));
remote.macRequest = async () => ({ ok: false, notSent: true, because: 'no coordinator in this test' });
const pn = require('./phonenotify');
const posts = [];
const { start, server } = require('../server');
const fleet = require('../test-support/fleet');
const messages = require('./messages');
const nya = require('./needsyouack');
const chat = require('./chat');

let base;
test.before(async () => {
  await start(0);
  base = 'http://127.0.0.1:' + server.address().port;
  pn.setAvailableForTests(true);
  pn.setSender((url, headers, body) => { posts.push({ url, body: JSON.parse(body) }); });
});
test.after(() => { server.close(); });

function withAgent(name, fn) {
  const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
  messages.setRunner(() => ({ ok: true, session: name + '-discord' }));
  return Promise.resolve().then(fn).finally(() => { messages.setRunner(null); board.restore(); });
}
async function report(body) {
  const res = await fetch(base + '/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from_pane: 'x', ...body }) });
  assert.equal(res.status, 200, await res.clone().text());
}
const seen = (name, headers = { 'sec-fetch-site': 'same-origin' }) => fetch(base + '/api/agent/' + name + '/seen', { method: 'POST', headers });
const acks = () => posts.filter((p) => p.url.endsWith('/v1/mac/notify-ack'));

test('a report opened on the person\'s screen is acknowledged once, and only then', async () => {
  await withAgent('ack-open', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'Which logo?' });
    assert.equal(acks().length, 0, 'unopened: nothing acknowledged');
    assert.equal(nya.due('ack-open'), true, 'control: the push was held to acknowledge');
    const r = await seen('ack-open');
    assert.equal(r.status, 200);
    assert.equal(acks().length, 1);
    assert.match(acks()[0].body.eventId, /^report:.*:ack-open$/);
    assert.equal(nya.due('ack-open'), false);
    await seen('ack-open');
    assert.equal(acks().length, 1, 'a second open sends nothing');
  });
});

test('an agent cannot acknowledge its own question: no person\'s screen, no ack, though the cursor moves', async () => {
  await withAgent('ack-self', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'May I merge?' });
    const r = await seen('ack-self', {});
    assert.equal(r.status, 200, 'the read cursor still answers as before');
    assert.equal(acks().length, 0);
    assert.equal(nya.due('ack-self'), true);
  });
});

test('a tab in the background moves the cursor but acknowledges nothing', async () => {
  await withAgent('ack-hidden', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'Are you there?' });
    const r = await fetch(base + '/api/agent/ack-hidden/seen?hidden=1', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } });
    assert.equal(r.status, 200);
    assert.equal(acks().length, 0);
    assert.equal(nya.due('ack-hidden'), true);
    await seen('ack-hidden');
    assert.equal(acks().length, 1, 'control: the same agent opened in view is acknowledged');
  });
});

test('another agent\'s open does not acknowledge this one, and an ordinary report holds nothing', async () => {
  await withAgent('ack-a', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'A question' });
    await seen('ack-other');
    assert.equal(acks().length, 0);
    assert.equal(nya.due('ack-a'), true);
  });
  await withAgent('ack-plain', async () => {
    await report({ state: 'working', text: 'at it' });
    assert.equal(nya.due('ack-plain'), false);
  });
});

test('a held question sends no push, so it holds nothing to acknowledge', async () => {
  await withAgent('ack-held', async () => {
    await report({ state: 'needs_you', text: 'Later', held: true });
    assert.equal(nya.due('ack-held'), false);
  });
});

test('the board and the phone both fire on a due ack, not only on unread replies', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.ok(page.includes("if (dmRec && (dmRec.dmUnread > 0 || (dmRec.openAckDue === true && !dmHidden))) {"));
  assert.ok(page.includes('if (!dmHidden) dmRec.openAckDue = false;'), 'zeroed, or every poll while the chat is open re-fires');
  assert.ok(page.includes("(dmHidden ? '?hidden=1' : '')"), 'a tab in the background says so');
  const chat = fs.readFileSync(path.join(__dirname, '..', 'ios', 'Kosmos', 'ChatView.swift'), 'utf8');
  assert.ok(chat.includes('guard visible, unreadHere > 0 || ackDue, !seenInFlight else { return }'));
});

test('kosmos#8036: a permission wait that passes unopened leaves one line and an ack; one opened first leaves neither', async () => {
  await withAgent('wait-gone', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'asking permission to use Bash: rm -rf /Users/someone/secret', auto: true });
    assert.equal(nya.due('wait-gone'), true, 'control: its push went out and is held');
    assert.equal(acks().length, 0);
    await report({ state: 'working', text: 'running a tool', auto: true });
    assert.equal(acks().length, 1, 'over: the coordinator is told, so no email');
    assert.match(acks()[0].body.eventId, /^report:.*:wait-gone$/);
    assert.equal(nya.due('wait-gone'), false);
    const rows = chat.readThread(chat.DIRECT, 'wait-gone').messages;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, nya.WAIT_ENDED_LINE);
    assert.equal(rows[0].kosmos, true, 'nothing owed');
    assert.doesNotMatch(rows[0].text, /secret|rm -rf/, 'the hook\'s words never reach the chat');
    await report({ state: 'idle', text: 'done', auto: true });
    assert.equal(chat.readThread(chat.DIRECT, 'wait-gone').messages.length, 1, 'once');
  });
  await withAgent('wait-seen', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'asking permission to use Bash: ls', auto: true });
    await seen('wait-seen');
    assert.equal(acks().length, 1, 'control: opened, acknowledged then');
    await report({ state: 'working', text: 'running a tool', auto: true });
    assert.equal(acks().length, 1);
    assert.equal(chat.readThread(chat.DIRECT, 'wait-seen').messages.length, 0, 'they saw it: no line');
  });
  await withAgent('ask-real', async () => {
    posts.length = 0;
    await report({ state: 'needs_you', text: 'Which logo?' });
    await report({ state: 'working', text: 'back at it' });
    assert.equal(acks().length, 0, 'an agent\'s own question is not this');
    assert.equal(chat.readThread(chat.DIRECT, 'ask-real').messages.length, 0);
  });
});

test('the store: a failed hand-over is kept, a week is the limit, and each agent keeps a few', () => {
  nya.remember('s1', 'one', 1000);
  assert.equal(nya.opened('s1', () => false, 2000), 0);
  assert.equal(nya.due('s1', 2000), false, 'not reached: not due again at once, or every poll would POST');
  assert.equal(nya.due('s1', 2000 + nya.RETRY_MS), true, 'and due again later');
  let again = 0;
  assert.equal(nya.opened('s1', () => { again++; return true; }, 3000), 1, 'a later open still sends it');
  assert.equal(again, 1);
  nya.remember('s1', 'one', 1000);
  assert.equal(nya.due('s1', 1000 + nya.KEEP_MS), false, 'past a week: dropped');
  for (let i = 0; i < nya.KEEP_PER_AGENT + 3; i++) nya.remember('s2', 'id' + i, 5000 + i);
  const got = [];
  assert.equal(nya.opened('s2', (id) => { got.push(id); return true; }, 6000), nya.KEEP_PER_AGENT);
  assert.ok(got.includes('id' + (nya.KEEP_PER_AGENT + 2)) && !got.includes('id0'), 'the newest are the ones kept');
  assert.equal(nya.opened('nobody', () => { throw new Error('never asked'); }, 6000), 0);
  fs.writeFileSync(nya.file(), 'not json');
  assert.equal(nya.due('s1', 2000), false, 'an unreadable file holds nothing, and does not throw');
  nya.remember('s3', 'three', 7000);
  assert.equal(nya.due('s3', 7000), true, 'and is written fresh');
});
