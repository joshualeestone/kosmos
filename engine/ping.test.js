'use strict';

/**
 * #238: telling the Kosmos team an agent was created.
 *
 * 🔑 THE THIRD TEST IN THIS FILE IS THE ONE THAT MATTERS MOST, and it exists
 * because of a copy decision. Josh ruled the IP out of what the screen says, so
 * a reader can no longer check the payload against the words -- which means the
 * only thing keeping those sentences honest as the payload changes is a test
 * that fails when a field is added. (Mona Lisa's rule 3.)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-ping-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const ping = require('./ping');
const { codeOnly } = require('../test-support/code-only');

function fresh() { try { fs.unlinkSync(ping.FILE); } catch { /* none */ } }

test('nobody has been asked, so it is OFF and nothing is sent', () => {
  /* 🛑 THIS ASSERTED `true` UNTIL 2026-08-26, and the flip is a consequence,
     not a preference. Absent-means-on was defensible while a person had a
     control to answer with; Josh removed both surfaces of that control (item
     3), so "nobody has been asked" became "nobody CAN be asked". The page's
     own note set the condition: "removing every control while the send stays
     on is not a tidy-up, it is a removed opt-out."
     ⭐ It asserts the SEND, not just the flag: a default nobody can change is
     only meaningful in terms of what leaves the machine. */
  fresh();
  assert.equal(ping.read().on, false);
  let sent = 0;
  ping.setSender(() => { sent += 1; return Promise.resolve(); });
  ping.agentCreated({ wanted: true });
  assert.equal(sent, 0, 'a machine nobody has asked sent something anyway');
});

test('a preference we cannot read sends NOTHING', () => {
  fresh();
  fs.writeFileSync(ping.FILE, '{ not json');
  const r = ping.read();
  /* ⚠️ THE OPPOSITE DIRECTION FROM THE SHIPPED DEFAULT, deliberately. Absent
     means nobody has chosen; corrupt means somebody may have turned it off and
     we cannot see which. The only act gated here sends something off the
     machine, so an unreadable answer is not consent. */
  assert.equal(r.on, false);
  assert.equal(r.ok, false);
  let sent = 0;
  ping.setSender(() => { sent += 1; return Promise.resolve(); });
  ping.agentCreated({ wanted: true });
  assert.equal(sent, 0, 'an unreadable preference was read as permission to send');
});

test('what leaves is the event and never its contents', () => {
  fresh();
  const body = ping.payload();
  /**
   * 🛑 PINNED BY EXACT KEY SET. Adding a field makes this fail, and that is the
   * mechanism rather than a nuisance: the screen no longer enumerates what is
   * sent, so nothing else can notice a change. Whoever adds a key has to come
   * here, and coming here is the prompt to go and re-read the welcome line and
   * the checkbox label.
   */
  assert.deepEqual(Object.keys(body).sort(), ['at', 'event', 'installId', 'os', 'version']);
  const flat = JSON.stringify(body).toLowerCase();
  for (const forbidden of ['name', 'role', 'instruction', 'model', 'project', 'prompt', 'email']) {
    assert.ok(!flat.includes('"' + forbidden), 'the payload carries a ' + forbidden);
  }
});

test('the install id is random, kept, and not derived from the machine', () => {
  fresh();
  const a = ping.installId();
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.equal(ping.installId(), a, 'a second call made a second install');
  /* ⚠️ It must not be a fingerprint. A hash of the hostname would be just as
     stable and would also identify this COMPUTER across reinstalls and across
     products; random identifies an install and nothing else. */
  const host = require('node:crypto').createHash('sha256').update(os.hostname()).digest('hex');
  assert.ok(!host.startsWith(a.replace(/-/g, '').slice(0, 8)), 'the id looks derived from the hostname');
});

test('one creation never changes the standing setting, in either direction', () => {
  /* The box this used to describe is gone. What it was really protecting is
     the SEPARATION: a per-creation answer must not become the standing one.
     That rule outlives the checkbox and is what a future control would rely
     on, so it is kept and now checked in both directions. */
  fresh();
  assert.deepEqual(ping.setOn(true), { ok: true });
  let sent = 0;
  ping.setSender(() => { sent += 1; return Promise.resolve(); });
  ping.agentCreated({ wanted: false });
  assert.equal(sent, 0, 'a creation that did not ask still sent');
  assert.equal(ping.read().on, true, 'one un-asking creation turned the whole thing off');
  ping.agentCreated({ wanted: true });
  assert.equal(sent, 1, 'the next one, asking, did not send');
  assert.equal(ping.read().on, true, 'a sending creation rewrote the standing setting');
});

test('turning it off in Settings beats a ticked box', () => {
  fresh();
  assert.deepEqual(ping.setOn(false), { ok: true });
  let sent = 0;
  ping.setSender(() => { sent += 1; return Promise.resolve(); });
  ping.agentCreated({ wanted: true });
  assert.equal(sent, 0, 'the standing setting was overridden by a box somebody did not think about');
});

test('a network failure is invisible to the caller', async () => {
  fresh();
  ping.setSender(() => Promise.reject(new Error('no such host')));
  /* 🛑 THE PERSON ASKED FOR AN AGENT, NOT FOR A REPORT. This returns nothing at
     all, so no future edit can make a creation await it, and a rejection has
     nowhere to surface. */
  assert.equal(ping.agentCreated({ wanted: true }), undefined);
  ping.setSender(() => { throw new Error('synchronous boom'); });
  assert.equal(ping.agentCreated({ wanted: true }), undefined, 'a synchronous throw reached the caller');
  await new Promise((r) => setTimeout(r, 20));   // let any unhandled rejection surface
});

test('it posts to the Kosmos endpoint, as JSON', () => {
  fresh();
  /* Explicit now: the default went off with the control (2026-08-26), so this
     has to TURN IT ON to have anything to inspect. The payload shape is what
     this test is about and that has not changed. */
  assert.deepEqual(ping.setOn(true), { ok: true });
  let seen = null;
  ping.setSender((url, init) => { seen = { url, init }; return Promise.resolve(); });
  ping.agentCreated({ wanted: true });
  assert.equal(seen.url, ping.DEFAULT_ENDPOINT);
  assert.equal(seen.init.method, 'POST');
  assert.match(seen.init.headers['content-type'], /application\/json/);
  assert.deepEqual(Object.keys(JSON.parse(seen.init.body)).sort(),
    ['at', 'event', 'installId', 'os', 'version']);
  /* A hung host must not hold a socket open forever on somebody's machine. */
  assert.ok(seen.init.signal, 'the request has no timeout');
});

test('a test run never reaches the real network', () => {
  /**
   * 🛑 THE DEFECT THIS PINS ALREADY HAPPENED. `server.test.js` creates agents
   * through the real route, so the moment this feature was wired the suite
   * began POSTing to installkosmos.com on every run -- putting fake installs
   * into the number Josh reads off the homepage. Caught because the live
   * counter said 2 after one deliberate ping.
   */
  fresh();
  assert.equal(ping.underTest(), true, 'the runner signal is gone, so this test proves nothing');
  ping.setSender(null);
  let reached = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { reached += 1; return Promise.resolve(); };
  try {
    ping.agentCreated({ wanted: true });
    assert.equal(reached, 0, 'a test run reached the network');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the created-ping has NO control left, and therefore does not send', () => {
  /**
   * 🛑 THIS TEST USED TO ASSERT THE CHECKBOX AND NOW ASSERTS ITS ABSENCE, which
   * is the third home this disclosure has had. It sat on the welcome screen,
   * moved to the point of the act when Josh cut the lawyer-speak (2026-08-22),
   * and on 2026-08-26 he removed the setting itself: "the 'Let the Kosmos team
   * know when you create an agent' - they both need to be removed."
   *
   * ⭐ IT FAILED LOUDLY THROUGH ALL OF THAT, WHICH IS THE POINT. When the
   * Settings rows went first, this test went red on a product with a LIVE
   * control whose only explanation had just been deleted. That red was the
   * guarantee working: the fix was to finish the removal, not to quiet it.
   *
   * ⚠️ ABSENCE OF THE CONTROL IS ONLY HALF. A removed control with the send
   * still defaulting ON is strictly worse than what he complained about, and
   * unfixable by the person, so the default and the control are checked
   * TOGETHER here and were changed together.
   */
  const fs2 = require('node:fs');
  const page = fs2.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const words = codeOnly(page);

  for (const gone of ['id="create-tell"', 'id="create-tell-note"', 'id="create-tell-wrap"',
    'Let the Kosmos team know you created an agent']) {
    assert.equal(words.includes(gone), false,
      'the created-ping control is back on the create screen (' + gone + ') without its disclosure');
  }
  /* The control on the absences: the create screen itself must still be there,
     or every assertion above passes because the page lost its create form. */
  assert.match(words, /id="create-go"/,
    'the create screen is gone entirely, so the absences above prove nothing');

  /* And the half that absence alone cannot cover. */
  fresh();
  assert.equal(ping.read().on, false,
    'the control was removed while the send still defaults ON: nobody can turn this off');
});
