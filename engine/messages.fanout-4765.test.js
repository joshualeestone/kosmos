'use strict';

/**
 * #4765: a room post reaches its members AT ONCE, not one after another.
 *
 * Measured on 0.7.11's engine with a fake tmux costing what a tmux call costs on a Mac and real paste-to-Enter
 * waits: the person's post came back after 0.31 s for 1 member, 3.06 s for 10 and 6.11 s for 20, because each
 * member's wait (250 ms at least) ran after the last one finished. The page shows the post only once this
 * returns, so that was the wait after Enter. These tests pin the overlap and what the person is told when one
 * member fails, without timing anything: the pauser counts how many waits are open at once.
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

const MEMBERS = ['ava', 'ben', 'cy', 'dee', 'eli', 'fay'];

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
      await new Promise((r) => setTimeout(r, 20));
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

test('#4765: when one member fails, the others are still reached, and the failure is told only after all have finished', async () => {
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
    await assert.rejects(
      post(roster, 'one line for the whole room').catch((err) => { settledBeforeReject = enters(calls).length; throw err; }),
      /the second member's typing path broke/);
    /* Every member but the broken one had its Enter pressed, and all of them before the failure was reported. */
    assert.equal(settledBeforeReject, MEMBERS.length - 1, 'the failure was reported before the other members were reached');
    /* CONTROL: the broken member really was the one not entered, so the count above is not a coincidence. */
    assert.equal(enters(calls).length, MEMBERS.length - 1);
  });
});
