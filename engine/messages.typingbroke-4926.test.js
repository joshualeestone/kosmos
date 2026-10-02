'use strict';
/**
 * #4926: a room post that reached its members must never be answered as a failure. A member whose typing path THREW
 * (not one that answered could_not) used to throw the whole post after every other member had been typed into and
 * before the row was written, so the sender read "refused", posted again, and with no row the retry was not folded:
 * every other member got it twice. Now that member is unconfirmed, the row is written, and a retry folds into it.
 *
 *   node --test engine/messages.typingbroke-4926.test.js
 */
const os = require('node:os');
const path = require('node:path');
// Sandboxed BEFORE any engine require: this writes a message log under store.ROOT.
const SANDBOX = path.join(os.tmpdir(), 'kosmos-messages-typingbroke-4926-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const fleet = require('../test-support/fleet');

process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const MEMBERS = ['ava', 'bix', 'cy', 'dee'];

function arm() {
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => new Promise((r) => setTimeout(r, 2)));
  return calls;
}
const enters = (calls) => calls.filter((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Enter').map((a) => a[a.indexOf('-t') + 1]);

async function withRoom(fn) {
  const board = fleet.install(MEMBERS.map((n) => fleet.agent(n, { state: 'idle' })));
  try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ }
  try {
    return await fn(board.snapshot ? board.snapshot() : board.roster);
  } finally {
    board.restore();
    chat.resetForTests();
    if (typeof messages.resetForTests === 'function') messages.resetForTests();
  }
}

/* The agent ava posts to the room; its members are the other three. One of them (cy) has a typing path that throws. */
function breakOne(roster, name, how) {
  const real = { a: chat.deliverAsync, s: chat.deliver, aa: chat.deliverAutomaticAsync, sa: chat.deliverAutomatic };
  const boom = (n, ...rest) => { if (n === name) { if (how === 'reject') return Promise.reject(new Error('typing into ' + n + ' broke')); throw new Error('typing into ' + n + ' broke'); } return null; };
  chat.deliverAsync = (n, ...rest) => boom(n) || real.a(n, ...rest);
  chat.deliverAutomaticAsync = (n, ...rest) => boom(n) || real.aa(n, ...rest);
  chat.deliver = (n, ...rest) => boom(n) || real.s(n, ...rest);
  chat.deliverAutomatic = (n, ...rest) => boom(n) || real.sa(n, ...rest);
  return () => Object.assign(chat, { deliverAsync: real.a, deliver: real.s, deliverAutomaticAsync: real.aa, deliverAutomatic: real.sa });
}
const agentPost = (roster, text, sync) => {
  const sender = { ok: true, card: roster.find((c) => c.sessionName === 'ava') };
  const members = roster.map((c) => c.sessionName);
  const input = { sender, project: 'room4926', projectName: 'Room', text };
  return sync ? messages.sendPost(input, roster, members) : messages.sendPostAsync(input, roster, members);
};
const rows = () => messages.list().filter((r) => r.kind === 'post' && r.project === 'room4926');

for (const how of ['reject', 'throw']) {
  test('#4926 (' + how + '): a post that reached the room is recorded and answered unconfirmed, never refused; a retry folds into it', async () => {
    await withRoom(async (roster) => {
      const calls = arm();
      const restore = breakOne(roster, 'cy', how);
      try {
        const d = await agentPost(roster, 'the build is green', false);
        assert.ok(!d.because || d.state !== chat.DELIVERY.COULD_NOT, 'refused: ' + d.because);
        assert.equal(d.state, chat.DELIVERY.UNCONFIRMED, 'a post that reached two of three members was answered ' + d.state);
        assert.equal(d.outcomes.cy, chat.DELIVERY.UNCONFIRMED);
        assert.equal(rows().length, 1, 'the post was not recorded');
        const first = enters(calls).length;
        assert.equal(first, 2, 'fixture: bix and dee were not both typed into');
        // The sender, told "unconfirmed, do not re-post", posts it again anyway: the twin folds, nobody is typed into twice.
        const again = await agentPost(roster, 'the build is green', false);
        assert.equal(again.duplicate, true, 'the retry was posted a second time');
        assert.equal(enters(calls).length, first, 'a member was typed into twice');
        assert.equal(rows().length, 1, 'the retry was recorded as a second post');
      } finally { restore(); }
    });
  });
}

test('#4926: the synchronous path (outbox drain) records a post whose one member\'s typing threw, too', async () => {
  await withRoom(async (roster) => {
    arm();
    chat.setPauser(() => {});
    const restore = breakOne(roster, 'cy', 'throw');
    try {
      const d = await agentPost(roster, 'sync post', true);
      assert.equal(d.state, chat.DELIVERY.UNCONFIRMED, 'answered ' + d.state + (d.because ? ': ' + d.because : ''));
      assert.equal(rows().length, 1, 'the post was not recorded');
    } finally { restore(); }
  });
});

test('#4926: a post where EVERY member\'s typing threw is recorded unconfirmed too (each may have been typed), so it is never re-posted blind', async () => {
  await withRoom(async (roster) => {
    arm();
    const restores = ['bix', 'cy', 'dee'].map((n) => breakOne(roster, n, 'throw'));
    try {
      const d = await agentPost(roster, 'nobody', false);
      // Each member's throw is "may have reached", so the post is recorded unconfirmed and the sender told not to re-post.
      assert.equal(d.state, chat.DELIVERY.UNCONFIRMED);
      assert.equal(rows().length, 1);
    } finally { restores.reverse().forEach((r) => r()); }
  });
});
