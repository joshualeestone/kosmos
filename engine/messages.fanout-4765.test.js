'use strict';

/**
 * #4765: a room post reaches its members AT ONCE, not one after another.
 *
 * Measured on 0.7.11's engine with a fake tmux costing what a tmux call costs on a Mac and real paste-to-Enter
 * waits: the person's post came back after 0.31 s for 1 member, 3.06 s for 10 and 6.11 s for 20, because each
 * member's wait (250 ms at least) ran after the last one finished. The page shows the post only once this
 * returns, so that was the wait after Enter. These tests pin the overlap and what the person is told when one
 * member fails. The first counts how many waits are open at once inside a 200 ms wait, which the members'
 * starts (a few milliseconds apart) fall well within; the rest count, and time nothing.
 *
 *   node --test engine/messages.fanout-4765.test.js
 */

const os = require('node:os');
const path = require('node:path');

// Sandboxed BEFORE any engine require, like engine/messages.test.js: this writes a message log under store.ROOT.
const SANDBOX = path.join(os.tmpdir(), 'kosmos-messages-fanout-4765-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const chat = require('./chat');
const messages = require('./messages');
const fleet = require('../test-support/fleet');

process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const MEMBERS = ['ava', 'bix', 'cy', 'dee', 'eli', 'fay'];

/** A scripted tmux that answers every call as healthy and records the calls in order. */
function arm() {
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  return calls;
}

/** The target of each Enter, in the order the Enters were pressed. */
const enters = (calls) => calls.filter((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Enter').map((a) => a[a.indexOf('-t') + 1]);
/** The target of each member's first paste, in the order the pastes were made. */
const firstPastes = (calls) => {
  const seen = [];
  for (const a of calls) {
    if (a[0] !== 'paste-buffer') continue;
    const t = a[a.indexOf('-t') + 1];
    if (!seen.includes(t)) seen.push(t);
  }
  return seen;
};

async function withRoom(fn) {
  const board = fleet.install(MEMBERS.map((n) => fleet.agent(n, { state: 'idle' })));
  try {
    return await fn(board.snapshot ? board.snapshot() : board.roster);
  } finally {
    board.restore();
    chat.resetForTests();
  }
}

const post = (roster, text) => messages.sendPostAsync(
  { operator: true, project: 'fanout', projectName: 'Fanout', text }, roster, roster.map((c) => c.sessionName));

test('#4765: every member\'s paste-to-Enter wait is open at the same time, and every member is placed', async () => {
  await withRoom(async (roster) => {
    const calls = arm();
    let open = 0;
    let most = 0;
    chat.setPauser(async () => {
      open += 1;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 200));
      open -= 1;
    });
    const d = await post(roster, 'one line for the whole room');
    assert.equal(d.state, chat.DELIVERY.PLACED);
    assert.deepEqual(Object.values(d.outcomes), MEMBERS.map(() => chat.DELIVERY.PLACED), 'a member was not placed');
    assert.equal(enters(calls).length, MEMBERS.length, 'a member was not sent its Enter');
    /* The old loop waited for each member before starting the next, so this was 1. */
    assert.equal(most, MEMBERS.length, 'the members\' waits did not overlap: ' + most + ' open at once');
    /* The synchronous part still runs in the members' order: each member's paste goes in in turn. */
    const whose = (target) => MEMBERS.find((m) => target.includes('=' + m + '-discord:'));
    assert.deepEqual(firstPastes(calls).map(whose), MEMBERS, 'the pastes did not go in in the members\' order');
  });
});

test('#4765: when one member fails, the others are still reached, and the answer comes only after all have finished (#4926: as unconfirmed, not a failure)', async () => {
  await withRoom(async (roster) => {
    const calls = arm();
    let n = 0;
    let settledBeforeReject = null;
    chat.setPauser(async () => {
      n += 1;
      const mine = n;
      await new Promise((r) => setTimeout(r, 10 + 5 * mine));
      if (mine === 2) throw new Error('the second member\'s typing path broke');
    });
    const d = await post(roster, 'one line for the whole room').then((v) => { settledBeforeReject = enters(calls).length; return v; });
    /* #4926: the post is not refused: it reached five members. The broken one is unconfirmed (it may have been typed). */
    assert.equal(d.state, chat.DELIVERY.UNCONFIRMED, 'a post that reached five members was answered as ' + d.state);
    assert.equal(Object.values(d.outcomes).filter((v) => v === chat.DELIVERY.UNCONFIRMED).length, 1);
    /* Every member but the broken one had its Enter pressed, and all of them before the answer. */
    assert.equal(settledBeforeReject, MEMBERS.length - 1, 'the answer came before the other members were reached');
    /* CONTROL: the broken member really was the one not entered, so the count above is not a coincidence. */
    assert.equal(enters(calls).length, MEMBERS.length - 1);
  });
});

test('#4765 review 1: one member starts per turn of the event loop, so the board answers other requests between them', async () => {
  /* Each member's tmux calls are synchronous. Started in one tick, every member's paste ran as one block with the
     board answering nothing else (measured: 20 members, the loop went 599 ms without a turn). A setImmediate
     chain counts turns; each member's first paste must land on a later turn than the one before it. */
  await withRoom(async (roster) => {
    let turn = 0;
    let ticking = true;
    const spin = () => { if (!ticking) return; turn += 1; setImmediate(spin); };
    setImmediate(spin);
    const pasteTurn = {};
    chat.setRunner((args) => {
      if (args[0] === 'paste-buffer') { const t = args[args.indexOf('-t') + 1]; if (!(t in pasteTurn)) pasteTurn[t] = turn; }
      if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
      return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
    });
    chat.setDryRun(false);
    chat.setPauser(() => new Promise((r) => setTimeout(r, 5)));
    try {
      const d = await post(roster, 'one line for the whole room');
      assert.equal(d.state, chat.DELIVERY.PLACED);
    } finally { ticking = false; }
    const turns = Object.values(pasteTurn);
    assert.equal(turns.length, MEMBERS.length, 'a member was not pasted into');
    for (let i = 1; i < turns.length; i++) assert.ok(turns[i] > turns[i - 1], 'two members were started in the same turn: ' + JSON.stringify(turns));
  });
});

test('#4765 review 1: a member whose delivery throws at once still lets every other member finish before the answer (#4926: unconfirmed)', async () => {
  await withRoom(async (roster) => {
    const calls = arm();
    chat.setPauser(() => new Promise((r) => setTimeout(r, 5)));
    /* The third member's pane refuses to be typed at by throwing from the typing path itself. */
    const third = roster[2].session;
    const realDeliverAsync = chat.deliverAsync;
    chat.deliverAsync = (name, ...rest) => { if (name === roster[2].sessionName) throw new Error('the third member\'s typing path threw at once'); return realDeliverAsync(name, ...rest); };
    let enteredBeforeReject = null;
    try {
      const d = await post(roster, 'one line for the whole room').then((v) => { enteredBeforeReject = enters(calls).length; return v; });
      assert.equal(d.outcomes[roster[2].sessionName], chat.DELIVERY.UNCONFIRMED, 'the throwing member is not unconfirmed');
    } finally { chat.deliverAsync = realDeliverAsync; }
    assert.equal(enteredBeforeReject, MEMBERS.length - 1, 'the answer came before the other members had finished');
    assert.ok(!enters(calls).some((t) => t.includes('=' + third + ':')), 'control: the throwing member was typed at');
  });
});
