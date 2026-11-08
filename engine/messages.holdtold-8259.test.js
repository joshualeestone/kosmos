'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)

/**
 * kosmos#8259, through the real room path (messages._sendPostWithDelivery with a stub typer): an agent's room post naming
 * its for-you hold marks the person told; the person's post naming it adds the unhold sentence to the holder's typed
 * line (the trailer), to nobody else's, and marks it answered.
 *
 * ⚠️ SANDBOX BEFORE ANY ENGINE REQUIRE.
 *
 *   node --test engine/messages.holdtold-8259.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-mht-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'Projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');

const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('./chat');
const messages = require('./messages');
const projects = require('./projects');
const tasks = require('./tasks');
const fleet = require('../test-support/fleet');

const MEMBERS = ['leo', 'mara'];
let seq = 0;

function world() {
  const p = projects.create({ name: 'Room Told ' + (++seq), agents: MEMBERS.slice() });
  const t = tasks.create(p.id, { sentence: 'pick a price', who: 'leo' });
  tasks.setOnHold(p.id, t.number, true, { forPerson: true, because: 'needs your yes' });
  return { id: p.id, n: t.number };
}
const read = (id, n) => tasks.byNumber(projects.get(id), n);

/* A typer that records what each member was typed, trailer included, and reports it placed. */
function recorder() {
  const typed = [];
  const fn = (name, line, roster, _x, trailer) => { typed.push({ name, line, trailer: trailer || '' }); return { state: chat.DELIVERY.PLACED, because: null }; };
  return { typed, fn };
}

async function withBoard(fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'needs_you' }), fleet.agent('mara', { state: 'needs_you' })]);
  try { return await fn(board); } finally { board.restore(); }
}

test('the person\'s room post naming the hold: the holder\'s line gets the unhold sentence, the other member\'s does not', async () => {
  const { id, n } = world();
  await withBoard(async (board) => {
    const r = recorder();
    const out = await messages._sendPostWithDelivery({ operator: true, project: id, text: 'on #' + n + ': yes, go ahead' }, board.agents, MEMBERS, r.fn, true);
    assert.notEqual(out.state, chat.DELIVERY.COULD_NOT, JSON.stringify(out));
    const leo = r.typed.find((x) => x.name === 'leo');
    const mara = r.typed.find((x) => x.name === 'mara');
    assert.ok(leo && mara, 'both members were typed to: ' + JSON.stringify(r.typed.map((x) => x.name)));
    assert.match(leo.trailer, new RegExp('kosmos task unhold ' + id + ' ' + n));
    assert.doesNotMatch(mara.trailer, /unhold/);
    assert.equal(typeof read(id, n).onHoldAnsweredAt, 'string', 'answered once the post was recorded');
  });
});

test('control: the person\'s room post naming nothing, with no tell there, prompts nobody and marks nothing', async () => {
  const { id, n } = world();
  await withBoard(async (board) => {
    const r = recorder();
    await messages._sendPostWithDelivery({ operator: true, project: id, text: 'lunch?' }, board.agents, MEMBERS, r.fn, true);
    assert.ok(r.typed.length > 0, 'the post was typed');
    assert.ok(r.typed.every((x) => !/unhold/.test(x.trailer)));
    assert.equal(read(id, n).onHoldAnsweredAt, undefined);
  });
});

test('the holder\'s own room post naming the hold marks the person told, by room, with the post id', async () => {
  const { id, n } = world();
  await withBoard(async (board) => {
    const r = recorder();
    const sender = { ok: true, card: board.agents.find((c) => c.sessionName === 'leo') };
    assert.ok(sender.card, 'leo is on the board');
    const out = await messages._sendPostWithDelivery({ sender, project: id, text: '@all task ' + n + ': can the person decide the price?' }, board.agents, MEMBERS, r.fn, true);
    const t = read(id, n);
    assert.equal(t.onHoldToldVia, 'room', JSON.stringify(out));
    assert.equal(t.onHoldToldId, out.id);
  });
});
