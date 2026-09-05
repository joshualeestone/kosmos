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

// #1856: ping.FILE now lives under the AgentWorkforce leaf, so ensure its dir
// exists before the tests write to ping.FILE directly.
function fresh() { fs.mkdirSync(nodePath.dirname(ping.FILE), { recursive: true }); try { fs.unlinkSync(ping.FILE); } catch { /* none */ } }

test('nobody has been asked yet, so it is ON and the event is sent', () => {
  /* 🛑 THIS ASSERTED `false` FROM 2026-08-26 UNTIL 2026-09-05, and the flip
     BACK is Josh's ruling, not a preference (#2020/#2013, via Splinter: "we
     need that back in for sure", "I've never said flip it off"). Absent-means-on
     was turned off on 08-26 only because both control surfaces had been removed,
     which made a default-on send a removed opt-out. Josh reversed that: the
     create-page checkbox AND the Settings switch are both back, so "nobody has
     been asked yet" is a person who still has a control, and that is on.
     ⭐ It asserts the SEND, not just the flag: a default is only meaningful in
     terms of what leaves the machine. */
  fresh();
  assert.equal(ping.read().on, true);
  let sent = 0;
  ping.setSender(() => { sent += 1; return Promise.resolve(); });
  ping.agentCreated({ wanted: true });
  assert.equal(sent, 1, 'a never-asked machine with the default ON did not send');
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
  /* The box this describes is back (#2020, restored 2026-09-05). What it
     protects is the SEPARATION: a per-creation answer must not become the
     standing one. That rule holds with the checkbox present or absent, so it is
     checked in both directions. */
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
  /* Explicit setOn(true) so this pins the payload shape regardless of the
     default (which is back ON as of 2026-09-05, but this test is about the
     shape, not the default, and should not silently depend on it). */
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

test('the created-ping CREATE-PAGE control is present, and the send defaults ON, together', () => {
  /**
   * 📌 #2020/#2013: the create-page control is BACK and the default is ON, and
   * they are asserted TOGETHER because they are one decision (a default and its
   * control change together). Josh reversed the 08-26 removal on 2026-09-05, via
   * Splinter: "we need that back in for sure", "I've never said flip it off".
   *
   * 🛑 THIS TEST HAS FLIPPED DIRECTION TWICE, and the direction is always the
   * ruling of the day, never drift. It asserted the checkbox present (through
   * 08-26), then its ABSENCE (the removal), and now its presence again. The pair
   * that never changes is the coupling: a control with the send defaulting the
   * WRONG way relative to it is the bug, in either direction. A present control
   * with a default-OFF send is a dead opt-out; an absent control with a
   * default-ON send is a removed opt-out. So both halves are pinned here.
   *
   * ⚠️ ANCHORED ON CODE, NOT COMMENTS. codeOnly() strips comments first, so the
   * many comment mentions of this copy and these ids cannot satisfy the
   * presence assertions - only the real markup can.
   */
  const fs2 = require('node:fs');
  const page = fs2.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const words = codeOnly(page);

  for (const present of ['id="create-tell"', 'id="create-tell-note"', 'id="create-tell-wrap"',
    'Let the Kosmos team know you created an agent']) {
    assert.ok(words.includes(present),
      'the created-ping control is missing from the create screen (' + present + ')');
  }
  /* The control on the presences: the create screen itself must still be there,
     so a page that lost its create form cannot pass by coincidence. */
  assert.match(words, /id="create-go"/,
    'the create screen is gone entirely, so the presences above prove nothing');

  /* And the half a present control alone cannot cover: the default. */
  fresh();
  assert.equal(ping.read().on, true,
    'the control is back but the send defaults OFF: a dead opt-out nobody can turn on');
});
