'use strict';
/**
 * kosmos#7614: the person deletes one of their own messages in a direct conversation. The row leaves the thread, a copy
 * still kept to type later is taken out of the queue (so it is never typed), and an agent that was given it is told in
 * one line, without the words, that it was withdrawn. Only the person's own messages; the agent's never.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dm-delete-7614-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');

const chat = require('./chat');
const limitqueue = require('./limitqueue');
chat.resetForTests();

const SECRET = 'words the note must never repeat';
const typed = [];
const realDeliver = chat.deliverAutomaticAsync;
let verdict = chat.DELIVERY.PLACED;
chat.deliverAutomaticAsync = async (name, line) => { typed.push({ name, line }); return { state: verdict }; };
test.after(() => { chat.deliverAutomaticAsync = realDeliver; fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
const t = (n) => new Date(Date.UTC(2026, 9, 30, 12, 0, n)).toISOString();
function thread(person) {
  const agent = 'dd' + (++seq);
  chat.appendMessage(chat.DIRECT, agent, { text: SECRET, at: t(1), delivery: person });
  chat.appendMessage(chat.DIRECT, agent, { text: 'the agent answered', from: agent, at: t(2) });
  chat.appendMessage(chat.DIRECT, agent, { text: 'a control that stays', at: t(3), delivery: { state: 'placed' } });
  return agent;
}
const ats = (agent) => chat.readThread(chat.DIRECT, agent).messages.map((m) => m.at);

test('#7614: a delivered message leaves the thread and the agent is told without the words', async () => {
  typed.length = 0; verdict = chat.DELIVERY.PLACED;
  const agent = thread({ state: 'placed' });
  const out = await chat.deleteDirectAsync(agent, t(1));
  assert.equal(out.ok, true);
  assert.deepEqual(out.told, [agent]);
  assert.deepEqual(ats(agent), [t(2), t(3)], 'only the deleted row is gone');
  assert.equal(typed.length, 1);
  assert.match(typed[0].line, /deleted the message they sent you/);
  assert.ok(!typed[0].line.includes(SECRET));
  const again = await chat.deleteDirectAsync(agent, t(1));
  assert.equal(again.code, 404, 'a second delete finds nothing');
});

test('#7614: the agent\'s own message is refused and stays', async () => {
  typed.length = 0;
  const agent = thread({ state: 'placed' });
  const out = await chat.deleteDirectAsync(agent, t(2));
  assert.equal(out.code, 403);
  assert.deepEqual(ats(agent), [t(1), t(2), t(3)]);
  assert.equal(typed.length, 0);
});

test('#7614: a message never typed (could not) is deleted and nobody is told', async () => {
  typed.length = 0;
  const agent = thread({ state: chat.DELIVERY.COULD_NOT, because: 'x' });
  const out = await chat.deleteDirectAsync(agent, t(1));
  assert.equal(out.ok, true);
  assert.deepEqual(out.told, []);
  assert.equal(typed.length, 0);
});

test('#7614: a kept (held) message is taken out of the queue, never typed, and nobody is told', async () => {
  typed.length = 0;
  const agent = thread({ state: 'held', held: true, heldBy: 'limit', at: t(1) });
  assert.ok(limitqueue.add(agent, { id: 'dm-kept-1', from: '', kind: 'dm', text: SECRET, envelope: '', at: t(1), reset: t(1) }));
  assert.equal(limitqueue.list(agent).length, 1, 'control: kept before');
  const out = await chat.deleteDirectAsync(agent, t(1));
  assert.equal(out.ok, true);
  assert.deepEqual(out.told, []);
  assert.equal(limitqueue.list(agent).length, 0, 'gone from the queue, so the sweep never types it');
  assert.equal(typed.length, 0);
});

test('#7614: a kept message being typed this moment counts as given; the note waits until that typing has finished', async () => {
  typed.length = 0; verdict = chat.DELIVERY.PLACED;
  const agent = thread({ state: 'held', held: true, heldBy: 'limit', at: t(1) });
  assert.ok(limitqueue.add(agent, { id: 'dm-typing-1', from: '', kind: 'dm', text: SECRET, envelope: '', at: t(1), reset: t(1) }));
  assert.ok(limitqueue.claim('dm-typing-1'), 'the sweep holds it');
  const wait = { ...chat.DELETE_WAIT }; chat.DELETE_WAIT.pollMs = 10;
  let releasedAt = 0;
  const timer = setTimeout(() => { releasedAt = Date.now(); limitqueue.release('dm-typing-1'); }, 150);
  try {
    const out = await chat.deleteDirectAsync(agent, t(1));
    assert.deepEqual(out.told, [agent]);
    assert.ok(releasedAt > 0, 'the delete waited for the typing to finish');
    assert.equal(typed.length, 1, 'the note, once, after the typing');
  } finally { clearTimeout(timer); limitqueue.release('dm-typing-1'); Object.assign(chat.DELETE_WAIT, wait); }
});

test('#7614 review 1: when the typing that held it fails, the deleted message is not typed again', async () => {
  typed.length = 0; verdict = chat.DELIVERY.PLACED;
  const agent = thread({ state: 'held', held: true, heldBy: 'limit', at: t(1) });
  assert.ok(limitqueue.add(agent, { id: 'dm-typing-2', from: '', kind: 'dm', text: SECRET, envelope: '', at: t(1), reset: t(1) }));
  assert.ok(limitqueue.claim('dm-typing-2'), 'the sweep holds it');
  const wait = { ...chat.DELETE_WAIT }; chat.DELETE_WAIT.pollMs = 10;
  const timer = setTimeout(() => limitqueue.release('dm-typing-2'), 50);   // the typing failed: the sweep only lets go
  try {
    await chat.deleteDirectAsync(agent, t(1));
    const left = limitqueue.list(agent).some((e) => e.id === 'dm-typing-2');
    assert.ok(!left || limitqueue.isDone('dm-typing-2'), 'nothing kept to type again');
    assert.equal(limitqueue.claim('dm-typing-2'), left ? false : true, 'control: a later claim finds it gone or done');
    limitqueue.release('dm-typing-2');
  } finally { clearTimeout(timer); limitqueue.release('dm-typing-2'); Object.assign(chat.DELETE_WAIT, wait); }
});

test('#7614 review 1: a row update the sweep kept for the deleted row is dropped, not retried for ever', async () => {
  typed.length = 0;
  const agent = thread({ state: 'placed' });
  limitqueue.setRow(agent, t(1), { state: 'placed' }, { updateDmDelivery: () => false });   // a write that could not land
  assert.ok(limitqueue.hasRowFix(agent, t(1)), 'control: kept to retry');
  await chat.deleteDirectAsync(agent, t(1));
  assert.equal(limitqueue.hasRowFix(agent, t(1)), false);
});

test('#7614: a note that could not be typed is not counted as told', async () => {
  typed.length = 0; verdict = chat.DELIVERY.COULD_NOT;
  const agent = thread({ state: 'placed' });
  try {
    const out = await chat.deleteDirectAsync(agent, t(1));
    assert.equal(out.ok, true);
    assert.deepEqual(out.told, []);
    assert.equal(typed.length, 1, 'it was tried');
  } finally { verdict = chat.DELIVERY.PLACED; }
});

test('#7614: no message at that time answers 404', async () => {
  const agent = thread({ state: 'placed' });
  assert.equal((await chat.deleteDirectAsync(agent, t(9))).code, 404);
  assert.equal((await chat.deleteDirectAsync('', t(1))).code, 404);
});
