'use strict';

/**
 * #4959, the page half: the restart wake's 'hello' is sent as an AUTOMATIC message ({ text: 'hello',
 * automatic: true }), so the server delivers it through the shared-quota gate (#4588). A held answer is not
 * placed, so the person gets the site's manual line and is never told the agent was greeted.
 * The server half is server.automatic-hello-4959.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

function liftSendWakeHello(fetchImpl, seq) {
  // eslint-disable-next-line no-new-func
  return new Function('fetch', 'RESTART_HELLO_SEQ', page.lift(SCRIPT, 'sendWakeHello') + '\nreturn sendWakeHello;')(fetchImpl, seq);
}
const answer = (delivery) => async () => ({ ok: true, json: async () => ({ delivery, recorded: delivery.state === 'placed' }) });

test('#4959: the wake hello is posted to the thread route as automatic', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push([url, init.method, JSON.parse(init.body)]); return answer({ state: 'placed' })(); };
  let said = null;
  await liftSendWakeHello(fetchImpl, { bob: 1 })('bob', 1, (t) => { said = t; }, 'SAID', 'MANUAL');
  assert.deepEqual(sent, [['/api/agent/bob/thread', 'POST', { text: 'hello', automatic: true }]]);
  assert.equal(said, 'SAID', 'CONTROL: a placed hello still reads as said');
});

test('#4959: a hello held on the shared quota reads as not said (the manual line)', async () => {
  let said = null;
  const held = answer({ state: 'could_not', held: true, heldUntil: '2026-10-02T06:00:00.000Z' });
  await liftSendWakeHello(held, { bob: 2 })('bob', 2, (t) => { said = t; }, 'SAID', 'MANUAL');
  assert.equal(said, 'MANUAL');
});
