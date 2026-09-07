'use strict';
/**
 * The outbound "something happened" call: off by default, never the words,
 * never sent under test without an injected sender, and the closed list of
 * kinds. Sandboxed data root before the require.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-notify-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const notify = require('./notify');

function capture() {
  const sent = [];
  notify.setSender(async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true }; });
  return sent;
}
// Captures the whole init, headers included, for the #462 auth-header tests.
function captureInit() {
  const sent = [];
  notify.setSender(async (url, init) => { sent.push({ url, init }); return { ok: true }; });
  return sent;
}
test.afterEach(() => {
  notify.setSender(null);
  fs.rmSync(notify.FILE, { force: true });
  delete process.env.AGENT_WORKFORCE_NOTIFY_TOKEN;
});

test('#462: the notify token rides as x-kosmos-notify-token when one is configured', async () => {
  process.env.AGENT_WORKFORCE_NOTIFY_TOKEN = 'notif-abc123';
  const sent = captureInit();
  notify.setOn(true);
  notify.happened({ kind: 'posted', agent: 'Leo', project: 'Lease' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].init.headers['x-kosmos-notify-token'], 'notif-abc123',
    'the notify token was not sent as its header');
  assert.equal(sent[0].init.headers['content-type'], 'application/json',
    'the content-type header was lost when the token was added');
});

test('#462: no token configured means no auth header, byte-for-byte as before', async () => {
  const sent = captureInit();
  notify.setOn(true);
  notify.happened({ kind: 'replied', agent: 'April' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 1);
  assert.ok(!('x-kosmos-notify-token' in sent[0].init.headers),
    'an auth header appeared with no token configured, which changes the request against our own endpoint');
  assert.deepEqual(Object.keys(sent[0].init.headers), ['content-type'],
    'a request with no token must carry exactly the header it carried before #462');
});

test('ON by default (#2020 step 3); opting out stops the send, and a bad value is refused in words', async () => {
  const sent = capture();
  // A never-asked machine (afterEach removed the pref file): ON by default.
  assert.equal(notify.read().on, true, 'the notify send must default ON for a never-asked machine (#2020 step 3)');
  // Opt out: an explicit false is honoured, and then nothing is sent.
  assert.equal(notify.setOn(false).ok, true);
  assert.equal(notify.read().on, false);
  notify.happened({ kind: 'posted', agent: 'Leo', project: 'Lease' });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(sent, [], 'sent while off');
  // A bad value is refused in words, not silently.
  assert.match(notify.setOn('yes').because, /on or off/);
  // Back on.
  assert.equal(notify.setOn(true).ok, true);
  assert.equal(notify.read().on, true);
});

test('an existing-but-unreadable pref FAILS TO OFF, never sending against a possible opt-out (#2020 safety)', () => {
  /* 🛑 THE SAFETY-CRITICAL ARM, elevated by the step-3 flip: now that a
     never-asked machine defaults ON, the ONLY thing keeping an unreadable pref
     from sending against a person's possible opt-out is that a malformed /
     non-object / unreadable file reads OFF, not the ON default. A person who
     turned it OFF and whose file then became unreadable must NOT start sending
     again. */
  // Malformed (not JSON): OFF, ok:false.
  fs.writeFileSync(notify.FILE, 'not json at all');
  assert.deepEqual(notify.read(), { on: false, ok: false }, 'a malformed pref must fail to OFF, ok:false');
  // Non-object JSON (an array): OFF, ok:false.
  fs.writeFileSync(notify.FILE, '[1,2,3]');
  assert.deepEqual(notify.read(), { on: false, ok: false }, 'a non-object pref must fail to OFF, ok:false');
  /* Control that proves the OFF above is the fail-safe and not just the default:
     remove the file and the same read is ON (the never-asked default). If the
     default were OFF this control would not discriminate. */
  fs.rmSync(notify.FILE, { force: true });
  assert.equal(notify.read().on, true, 'control: a never-asked machine reads ON, so the OFF above is the unreadable fail-safe');
});

test('what leaves the Mac is who, what, which project and when; never the words, and never an unknown kind', async () => {
  const sent = capture();
  notify.setOn(true);
  notify.happened({ kind: 'posted', agent: 'Leo', project: 'Henderson lease', text: 'the secret words', words: 'more secrets' });
  notify.happened({ kind: 'replied', agent: 'April' });
  notify.happened({ kind: 'typed', agent: 'Mikey' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.length, 2, 'an unknown kind was sent, or a known one was not');
  assert.deepEqual(Object.keys(sent[0].body).sort(), ['agent', 'at', 'id', 'installId', 'kind', 'project', 'session']);
  assert.equal(sent[0].body.id, null, 'an event with no key must say null, not omit it');
  assert.equal(sent[0].body.kind, 'posted');
  assert.equal(sent[0].body.agent, 'Leo');
  assert.equal(sent[0].body.project, 'Henderson lease');
  assert.ok(!JSON.stringify(sent[0].body).includes('secret'), 'the words left the Mac: ' + JSON.stringify(sent[0].body));
  assert.equal(sent[1].body.project, null, 'a reply has no project and must say so, not omit it');
  assert.match(sent[0].url, /^https:\/\/installkosmos\.com\/api\/happened$/);
  assert.match(sent[0].body.installId, /^[0-9a-f-]{36}$/);
});

test('CONTROL: with no injected sender under test, nothing is sent even when on, and the guard is what stops it', async () => {
  notify.setOn(true);
  notify.setSender(null);
  const had = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls += 1; return { ok: true }; };
  const ctx = process.env.NODE_TEST_CONTEXT;
  try {
    /* The positive half first: with the under-test mark removed, the same
       call reaches the (overridden) fetch exactly once. Without this, a
       fetch captured at module load would pass the negative half green. */
    delete process.env.NODE_TEST_CONTEXT;
    notify.happened({ kind: 'posted', agent: 'Leo', project: 'x' });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1, 'with the guard lifted the send did not reach fetch, so the negative half below proves nothing');
    process.env.NODE_TEST_CONTEXT = ctx || 'child';
    notify.happened({ kind: 'posted', agent: 'Leo', project: 'x' });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(calls, 1, 'the suite reached for the network');
  } finally {
    global.fetch = had;
    if (ctx === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = ctx;
  }
});

test('both telemetry opt-out rows are PRESENT and wired; ping and notify both default ON (#2020/#2013)', () => {
  /* 🛑 THE HISTORY, so nobody re-derives it: this pinned the rows PRESENT before
     2026-08-26, then their ABSENCE after Josh removed both (his item 3). #2020
     restores them as opt-out CONTROLS (Josh 09-03: "on, and they can turn it off"),
     so it pins their PRESENCE again. The control and the default are ONE decision
     (#2013): each control was restored first with the default OFF, then Josh
     flipped BOTH defaults ON - the create-ping on 2026-09-05 (#2020/#2013) and the
     notify send in #2020 step 3 on 2026-09-03 - so both assertions below check ON,
     each paired with its restored switch: never a default-on without a control,
     the exact "removed opt-out" state the deletion existed to prevent. */
  const page = fs.readFileSync(nodePath.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  for (const id of ['id="notify-row"', 'id="notify-msg"', 'id="notify-toggle"',
    'id="tell-row"', 'id="tell-msg"', 'id="tell-toggle"']) {
    assert.ok(page.includes(id), 'a telemetry opt-out control is missing from Settings (' + id + ')');
  }
  /* The control on the control: the section that HOLDS them must still exist, or
     the presences above prove nothing. */
  assert.match(page, /id="auto-row"/,
    'the Updates section is gone entirely, so the presences above prove nothing');
  /* 🛑 #2047: the reads must be 403-SAFE. A gated GET (every /api/* is gated on an
     enforcing board) must draw COULD-NOT-READ, never a confident Off - a privacy
     opt-out that falsely reads Off tells a person nothing is sent while the engine
     may be. Pin that both refreshers bail to a null paint on a non-ok response, so
     that safety cannot be silently removed. */
  assert.match(page, /if \(!res\.ok\) \{ if \(mine === TELL_EPOCH\) tellPaint\(null\)/,
    'refreshTell does not guard on a non-ok read (#2047: a 403 would draw a false Off)');
  assert.match(page, /if \(!res\.ok\) \{ if \(mine === NOTIFY_EPOCH\) notifyPaint\(null\)/,
    'refreshNotify does not guard on a non-ok read (#2047: a 403 would draw a false Off)');
  /* The half absence alone cannot cover (ping.test.js's rule, applied here): the
     control is back AND the send default is whatever Josh has ruled. A fresh
     machine has no pref file, so read() returns the default. Both defaults are
     now ON, each paired with its restored Settings opt-out switch (the #2013
     rule: never a default-on without a control): Josh ruled the created-agent
     PING back ON on 2026-09-05 (#2020/#2013), and he ruled the notify send ON in
     #2020 step 3 on 2026-09-03 ("on, and they can turn it off"). So the notify
     default flips from OFF to ON here, its opt-out being #notify-toggle above. */
  const ping = require('./ping');
  assert.equal(notify.read().on, true, 'the notify send must default ON now that #2020 step 3 is ruled (Josh 2026-09-03 "on, and they can turn it off")');
  assert.equal(ping.read().on, true, 'the ping send defaults ON per #2020/#2013 (Josh 2026-09-05)');
  /* 🛑 THE DISCLOSURE COPY MUST COVER WHAT THE PAYLOAD SENDS (#2020 step 2 = honest
     disclosure). This pins the payload's EXACT field set; the notify row's copy above
     is human-verified to name each one - the agent's name and session, kind
     (posted/answered), project, at (when), an event id, and installId (a random
     per-install id) - and it says the content ("the words") is never sent. A field
     added to payload() reds HERE, forcing the disclosure copy to be reviewed rather
     than silently under-disclosing. That is the copy-matches-payload check the prior
     version of this test asked to re-derive when the row returned. */
  const keys = Object.keys(notify.payload({ kind: 'posted', id: 'e1', agent: 'x', session: 's', project: 'y' })).sort();
  assert.deepEqual(keys, ['agent', 'at', 'id', 'installId', 'kind', 'project', 'session'],
    'notify.payload() changed shape; review the Settings disclosure copy for the new/removed field before updating this set');
});
