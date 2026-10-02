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

/* Review 2: a held wake says why, after the site's own line, and promises nothing. */
function liftWithHeld(fetchImpl, seq) {
  const src = page.lift(SCRIPT, 'wakeHeldLine') + '\n' + page.lift(SCRIPT, 'quotaResetWords') + '\n' + page.lift(SCRIPT, 'sendWakeHello');
  // eslint-disable-next-line no-new-func
  return new Function('fetch', 'RESTART_HELLO_SEQ', src + '\nreturn sendWakeHello;')(fetchImpl, seq);
}
test('#4959: a hello held on the shared quota is not said, and the manual line says the quota is out until the reset', async () => {
  let said = null;
  const until = new Date(Date.now() + 40 * 60e3).toISOString();
  await liftWithHeld(answer({ state: 'could_not', held: true, heldUntil: until }), { bob: 2 })('bob', 2, (t) => { said = t; }, 'SAID', 'MANUAL');
  assert.match(said, /^MANUAL This computer's shared Google quota is out until .+, so Kosmos sent nothing\.$/);
  assert.doesNotMatch(said, /will|later|when it is back/i, 'the held line promised a send nothing makes');
});
test('#4959: a held answer with no usable time still says the quota is out; an unheld could_not stays the bare manual line', async () => {
  let said = null;
  await liftWithHeld(answer({ state: 'could_not', held: true, heldUntil: 'garbage' }), { bob: 3 })('bob', 3, (t) => { said = t; }, 'SAID', 'MANUAL');
  assert.equal(said, "MANUAL This computer's shared Google quota is out, so Kosmos sent nothing.");
  await liftWithHeld(answer({ state: 'could_not', because: 'busy' }), { bob: 4 })('bob', 4, (t) => { said = t; }, 'SAID', 'MANUAL');
  assert.equal(said, 'MANUAL', 'CONTROL: a refusal that is not a quota hold must not mention the quota');
});
test('#4588 ask 3: a hello held by the Gemini cap says the limit, never that the quota is out', async () => {
  let said = null;
  const until = new Date(Date.now() + 60e3).toISOString();
  await liftWithHeld(answer({ state: 'could_not', held: true, heldBy: 'cap', heldUntil: until }), { bob: 5 })('bob', 5, (t) => { said = t; }, 'SAID', 'MANUAL');
  assert.equal(said, 'MANUAL The Gemini subscription agents on this computer are at the limit you set for working at once, so Kosmos sent nothing.');
  assert.doesNotMatch(said, /quota/i);
});
test('#4959: deliverPickup passes a held 409 verdict through, and still returns null for any other refusal', async () => {
  const lift = (res) => new Function('fetch', page.lift(SCRIPT, 'deliverPickup') + '\nreturn deliverPickup;')(async () => res); // eslint-disable-line no-new-func
  const held = { state: 'could_not', held: true, heldUntil: '2026-10-02T06:00:00.000Z' };
  assert.deepEqual(await lift({ ok: false, json: async () => ({ delivery: held }) })('bob'), held);
  assert.equal(await lift({ ok: false, json: async () => ({ delivery: { state: 'could_not', because: 'busy' } }) })('bob'), null);
});
