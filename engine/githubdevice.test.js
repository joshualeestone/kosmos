'use strict';

// Both sandbox knobs BEFORE any require, travelling together per #527.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-ghdev-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
// gh absent, whatever the machine has: the road under test is the no-gh one.
process.env.AGENT_WORKFORCE_GH_BIN = path.join(SANDBOX, 'no-such-gh');

const test = require('node:test');
const assert = require('node:assert/strict');
const gd = require('./githubdevice');

/**
 * The stub GitHub (#620's whole point: the flow runs END TO END with no
 * real client_id and no real GitHub). One HTTP server stands for the three
 * endpoints; a scriptable answers-queue drives the poll arms.
 */
let answers = [];
let deviceRequests = [];
/* #1799: a poll from a flow the test has already left can arrive after the next
   arm has queued its answer, and consume it. Measured twice: the token was taken 2 ms
   BEFORE the new flow's device-code request, by the cancel arm's poll, still in
   flight two arms later. The product side is the generation check in githubdevice.js
   (that poll now bails). The fixture side is here: each flow gets its own device_code
   and its answers are bound to it at issue, which is also how GitHub keys a token. */
let deviceSeq = 0;
/* Answers are BOUND to a flow when its device code is issued, so a poll from a flow
   the test already left (measured: the cancel arm's poll was still in flight two
   arms later) finds its own, empty, queue rather than the next arm's token. */
const boundAnswers = new Map();
/* #1799 arm: hold the NEXT issued flow's token answers for this many ms, so its
   poll is still in flight when the arm abandons the flow and starts another. */
let holdNextFlowMs = 0;
const holdFor = new Map();
/* #1799 arms: hold the NEXT device-code response for this many ms (a cancel can then
   land while start() is still waiting on it), give the NEXT flow this poll interval
   in seconds, count polls per device code, and resolve a promise when a HELD token
   answer is actually sent, so arms wait on that signal rather than on a sleep. */
let holdNextDeviceMs = 0;
let failNextFlowPoll = false;  // the NEXT flow's held poll is answered by dropping the socket
const failFor = new Set();
let nextInterval = 0;
const polledBy = new Map();
let heldSentResolve = null;
const heldSent = () => new Promise((ok) => { heldSentResolve = ok; });
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/device/code') {
      deviceRequests.push(JSON.parse(body || '{}'));
      deviceSeq += 1;
      const code = 'dev-' + deviceSeq;
      boundAnswers.set(code, answers);
      answers = [];
      if (holdNextFlowMs) { holdFor.set(code, holdNextFlowMs); holdNextFlowMs = 0; }
      if (failNextFlowPoll) { failFor.add(code); failNextFlowPoll = false; }
      const reply = { device_code: code, user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: nextInterval };
      nextInterval = 0;
      if (holdNextDeviceMs) { const h = holdNextDeviceMs; holdNextDeviceMs = 0; setTimeout(() => send(200, reply), h); } else send(200, reply);
      return;
    }
    if (req.url === '/token') {
      const asked = JSON.parse(body || '{}').device_code;
      polledBy.set(asked, (polledBy.get(asked) || 0) + 1);
      const queue = boundAnswers.get(asked) || [];
      const next = queue.length ? queue.shift() : { error: 'authorization_pending' };
      const hold = holdFor.get(asked) || 0;
      if (hold && failFor.has(asked)) { setTimeout(() => { req.socket.destroy(); if (heldSentResolve) { const r = heldSentResolve; heldSentResolve = null; r(); } }, hold); return; }
      if (hold) setTimeout(() => { send(200, next); if (heldSentResolve) { const r = heldSentResolve; heldSentResolve = null; r(); } }, hold); else send(200, next);
      return;
    }
    if (req.url === '/user') {
      const auth = req.headers.authorization || '';
      if (auth === 'Bearer tok-live') { send(200, { login: 'joshualeestone' }); return; }
      send(401, { message: 'Bad credentials' });
      return;
    }
    send(404, {});
  });
});

test.before(async () => {
  await new Promise((ok) => stub.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + stub.address().port;
  process.env.AGENT_WORKFORCE_GITHUB_DEVICE_URL = base + '/device/code';
  process.env.AGENT_WORKFORCE_GITHUB_TOKEN_URL = base + '/token';
  process.env.AGENT_WORKFORCE_GITHUB_VERIFY_URL = base + '/user';
});
test.after(() => stub.close());

const settle = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* The Josh-line moved (#620, closed): Josh registered the app, the id ships
   in the build, and the unconfigured state this test used to pin no longer
   exists in any install. What remains to pin is the CONTRACT that killed it:
   every install has a usable id out of the box, and the two override roads
   still outrank it. The shipped value itself is deliberately not repeated
   here -- asserting the literal would be a second copy of one fact, and the
   door test drives the real one against the stub below. */
test('the shipped build is configured out of the box, and the overrides outrank the shipped id', async () => {
  delete process.env.KOSMOS_GITHUB_CLIENT_ID;
  const bare = gd.clientId();
  assert.ok(typeof bare === 'string' && bare.trim() && !/\s/.test(bare),
    'a fresh install has no usable client id, so the no-install road is dead for everyone but Josh');
  const st = await gd.state();
  assert.notEqual(st.because, gd.NO_APP,
    'a fresh install still shows the not-switched-on sentence, so the shipped id is not reaching state()');
  assert.equal(st.holder, 'kosmos');
  assert.equal(st.gh, 'missing');
  /* The paste road (the door's override) beats the build. The store root
     exists on any real install; this test runs before anything else made it. */
  fs.mkdirSync(path.dirname(gd.APP_FILE), { recursive: true });
  const saved = gd.setClientId('Iv1.pasted-own-app');
  assert.equal(saved.ok, true);
  try {
    assert.equal(gd.clientId(), 'Iv1.pasted-own-app', 'a pasted per-install id no longer outranks the shipped one');
    /* And the env var beats both. */
    process.env.KOSMOS_GITHUB_CLIENT_ID = 'Iv1.envwins';
    assert.equal(gd.clientId(), 'Iv1.envwins', 'the env override no longer outranks the pasted id');
  } finally {
    delete process.env.KOSMOS_GITHUB_CLIENT_ID;
    fs.rmSync(gd.APP_FILE, { force: true });
  }
});

test('the whole flow against the stub: code shown, pending then slow_down then token, stored 600, connected read from GitHub', async () => {
  process.env.KOSMOS_GITHUB_CLIENT_ID = 'Iv1.testclient';
  answers = [
    { error: 'authorization_pending' },
    { access_token: 'tok-live', token_type: 'bearer', scope: 'repo' },
  ];
  const started = await gd.start();
  assert.equal(started.phase, 'awaiting');
  assert.equal(started.code, 'ABCD-1234', 'the code lost its dash, and the door draws it verbatim');
  assert.equal(started.url, 'https://github.com/login/device');
  assert.equal(deviceRequests[0].client_id, 'Iv1.testclient');
  assert.equal(deviceRequests[0].scope, 'repo read:org');
  await settle(400);
  const st = await gd.state();
  assert.equal(st.connected, true, JSON.stringify(st));
  assert.equal(st.login, 'joshualeestone');
  assert.equal(st.held, true);
  assert.equal((fs.statSync(gd.FILE).mode & 0o777), 0o600, 'the held token is not mode 600');
  const kept = fs.readFileSync(gd.FILE, 'utf8').trim();
  assert.equal(kept, 'tok-live');
  assert.ok(!JSON.stringify(st).includes('tok-live'), 'state answered the token');
});

test('a revoked token shows as revoked: held, not connected, with a sentence', async () => {
  fs.writeFileSync(gd.FILE, 'tok-revoked\n', { mode: 0o600 });
  const st = await gd.state();
  assert.equal(st.held, true);
  assert.equal(st.connected, false);
  assert.match(st.because, /no longer accepts|did not confirm/);
});

test('forget deletes the held token and answers the fresh state', async () => {
  const st = await gd.forget();
  assert.equal(st.held, false);
  assert.equal(fs.existsSync(gd.FILE), false);
});

test('the declined arm fails with GitHub’s answer in a person’s sentence', async () => {
  answers = [{ error: 'access_denied' }];
  await gd.start();
  await settle(300);
  const st = await gd.state();
  assert.equal(st.phase, 'failed');
  assert.match(st.because, /declined/);
});

test('the expired arm names the remedy: start again for a fresh code', async () => {
  answers = [{ error: 'expired_token' }];
  await gd.start();
  await settle(300);
  const st = await gd.state();
  assert.equal(st.phase, 'failed');
  assert.match(st.because, /start again/);
});

test('slow_down honours GitHub’s rule: five real seconds pass before the next ask', async () => {
  /* The one deliberately slow test in this suite (~6s): the +5s reschedule
     is GitHub's own protocol rule, and only the clock can prove the maths.
     Not connected at one second; connected once the mandated wait passed. */
  answers = [{ error: 'slow_down' }, { access_token: 'tok-live', token_type: 'bearer', scope: 'repo' }];
  await gd.start();
  await settle(1000);
  assert.equal((await gd.state()).connected, false, 'the poll ignored slow_down and asked again early');
  await settle(5000);
  const st = await gd.state();
  assert.equal(st.connected, true, 'the slow_down reschedule never asked again at all');
  await gd.forget();
});

test('cancel stops a flow in flight and keeps any held token', async () => {
  answers = [{ error: 'authorization_pending' }];
  fs.mkdirSync(gd.DIR, { recursive: true });
  fs.writeFileSync(gd.FILE, 'tok-live\n', { mode: 0o600 });
  await gd.start();
  const st = await gd.cancel();
  assert.equal(st.phase, 'idle');
  assert.equal(st.held, true, 'cancel forgot the token; that is forget’s job, not cancel’s');
  await gd.forget();
});

test('the pasted client id survives to a fresh read, and a spaced one is refused', async () => {
  delete process.env.KOSMOS_GITHUB_CLIENT_ID;
  assert.equal(gd.setClientId('bad id').ok, false);
  assert.equal(gd.setClientId('Iv1.fromjosh').ok, true);
  assert.equal(gd.clientId(), 'Iv1.fromjosh');
  const st = await gd.state();
  assert.equal(st.ready, true);
  fs.rmSync(gd.APP_FILE, { force: true });
});

/* 🛑 #1787: THE `mode 0600` ASSERTION IN THE FLOW TEST ABOVE PASSES WHETHER OR NOT
   THIS IS FIXED, because both shapes end at 0600. The old one wrote the GitHub
   access_token into a pre-existing 0644 file, where the `mode:` option is silently
   IGNORED, then chmodded it. The INODE is what separates them: `rename` replaces
   it, a write in place reuses it.
   ⚠️ Verified by reverting a sibling call site to the old shape: with only the
   pre-existing tests, everything stayed green. */
test('#1787: a pre-existing loose token file is REPLACED, not rewritten in place', async () => {
  process.env.KOSMOS_GITHUB_CLIENT_ID = 'Iv1.testclient';
  try {
    fs.mkdirSync(path.dirname(gd.FILE), { recursive: true });
    fs.writeFileSync(gd.FILE, 'OLD-TOKEN\n');
    fs.chmodSync(gd.FILE, 0o644);
    assert.equal(fs.statSync(gd.FILE).mode & 0o777, 0o644,
    'the loose plant did not take, so this arm would pass without the fix');
    const inodeBefore = fs.statSync(gd.FILE).ino;

    answers = [{ access_token: 'tok-1787', token_type: 'bearer', scope: 'repo' }];
    const started = await gd.start();
    assert.equal(started.phase, 'awaiting', 'the flow did not start, so nothing was tested');
    /* Wait for the SIGNAL, not the clock: a fixed settle(400) went red under load with
       'the new token was not stored', a false red in the direction of the bug. */
    let st = null;
    for (let i = 0; i < 200; i += 1) {
      st = await gd.state();
      if (st.phase !== 'awaiting' && st.phase !== 'completing') break;
      await settle(25);
    }
    assert.equal(st && st.phase, 'idle', `the flow ended at ${st && st.phase} (${st && st.because}), not idle, so the write under test never happened`);

    assert.equal(fs.readFileSync(gd.FILE, 'utf8').trim(), 'tok-1787',
    'the new token was not stored, so this arm is not testing the write');
    assert.notEqual(fs.statSync(gd.FILE).ino, inodeBefore,
    'the credential was written IN PLACE into the pre-existing loose file: same inode '
    + 'means no rename, so the access_token bytes were on disk at 0644 before the chmod');
    assert.equal(fs.statSync(gd.FILE).mode & 0o777, 0o600, 'the credential was left loose');
  } finally {
    /* Restore on EVERY path. A failing assertion above would otherwise leak this env
       var AND a stored token into any test added after this one: cloudflare unlinks in
       beforeEach and tokendoor calls forget(), but this file does neither for FILE. */
    delete process.env.KOSMOS_GITHUB_CLIENT_ID;
    try { fs.rmSync(gd.FILE, { force: true }); } catch { /* nothing stored */ }
  }
});

/* 🛑 A THROW FROM THE WRITER MUST BE REPORTED, NOT SWALLOWED. `schedulePoll`'s
   `.catch(() => {})` means an exception on the completing path leaves FLOW pinned at
   COMPLETING with `because: null` and no reschedule: the sign-in never finishes and
   nothing anywhere says why. #1787 widened that gap by adding a new throw source,
   `refuseSymlinkTarget`'s ERR_KOSMOS_SYMLINK, which the old in-place write never raised.

   ⚠️ THE OBVIOUS FIXTURE IS THE WRONG ONE, and it cost me an arm that measured
   something else. Planting a symlink at `FILE` does make the writer throw, but it ALSO
   makes the held-token read return the victim's bytes, so `state()` reports "GitHub no
   longer accepts the held sign-in" and the arm never sees the write failure at all.
   Two effects from one plant. Stubbing `writeSecret` isolates the throw. */
test('#1787: a writer throw on the completing path is reported, not swallowed into a hang', async () => {
  process.env.KOSMOS_GITHUB_CLIENT_ID = 'Iv1.testclient';
  const securewrite = require('./securewrite');
  const realWriteSecret = securewrite.writeSecret;
  securewrite.writeSecret = () => {
    const e = new Error('refusing to write a secret through a symlink at /x');
    e.code = 'ERR_KOSMOS_SYMLINK'; // the writer's own code since iteration 7, not the kernel's ELOOP
    throw e;
  };
  try {
    fs.rmSync(gd.FILE, { force: true });
    answers = [{ access_token: 'tok-throw', token_type: 'bearer', scope: 'repo' }];
    const started = await gd.start();
    assert.equal(started.phase, 'awaiting', 'the flow did not start, so nothing was tested');

    /* ⚠️ WAIT FOR THE SIGNAL, NOT THE CLOCK. A fixed `settle(400)` made this arm
       FLAKY: when the poll had not completed yet the phase was still `awaiting` and
       `because` was null, so the arm reported the very hang it exists to detect and
       the failure was indistinguishable from the real bug. Poll for a terminal phase
       instead, with a bounded number of tries so a genuine hang still fails. */
    let st = null;
    /* ⚠️ THE BUDGET IS GENEROUS ON PURPOSE. This arm failed once at load average ~8
       with a 1s budget and passed 5/5 at 4.67, which is a flake that fails IN THE
       DIRECTION OF THE BUG: a slow poll looks exactly like the silent hang. The cost
       of a large budget is paid ONLY when the flow genuinely never settles, which is
       the case this arm exists to catch and the one where waiting is correct. */
    for (let i = 0; i < 200; i += 1) {
      st = await gd.state();
      if (st.phase !== 'awaiting' && st.phase !== 'completing') break;
      await settle(25);
    }
    assert.notEqual(st, null, 'the flow never reported a state at all');
    assert.notEqual(st.phase, 'completing',
      'the flow is STILL at completing after five seconds: that is the silent hang this '
      + 'arm '
      + 'exists for, with schedulePoll having swallowed the throw');
    assert.equal(st.connected, false, 'a refused write reported as connected');
    /* Pin the SENTENCE, not merely `connected === false`: a hung flow is also not
       connected, so a bare falsy check would pass while the bug is present. */
    assert.match(String(st.because || ''), /could not save the token/,
      `the flow reported "${st.because}" at phase ${st.phase} instead of the write failure: `
      + (st.phase === 'completing'
        ? 'FLOW stayed at COMPLETING and schedulePoll swallowed the throw, which is the defect this arm exists for'
        : 'the poll never reached the writer at all (a stalled or stolen poll, see #1799), so this arm measured nothing'));
    assert.equal(fs.existsSync(gd.FILE), false, 'a token was stored despite the writer throwing');
  } finally {
    securewrite.writeSecret = realWriteSecret;
    delete process.env.KOSMOS_GITHUB_CLIENT_ID;
    try { fs.rmSync(gd.FILE, { force: true }); } catch { /* nothing */ }
  }
});

/* #1799: A POLL BELONGS TO THE FLOW THAT SCHEDULED IT. stopPolling clears a timer that
   has not fired; it cannot reach a fetch already in flight. Measured twice on this
   file: the cancel arm's poll came back two arms later, took the next arm's token,
   and the new flow's start() overwrote the failure it caused with a fresh awaiting.
   For a person: start a sign-in, cancel it, start again, and the abandoned flow's
   answer can complete or reset the new one with nothing on screen saying why.
   This arm holds the first flow's token answer in the stub, abandons the flow while
   that answer is in flight, starts a second flow, and asserts the late answer
   touches nothing: no token stored, second flow still awaiting, no reason written.
   Red by name with the generation check removed from pollOnce. */
test('#1799: an answer to a flow the person already left cannot complete or reset the next flow', async () => {
  process.env.KOSMOS_GITHUB_CLIENT_ID = 'Iv1.testclient';
  try {
    fs.rmSync(gd.FILE, { force: true });
    answers = [{ access_token: 'tok-stale', token_type: 'bearer', scope: 'repo' }];
    holdNextFlowMs = 120;
    const sent = heldSent();
    const first = await gd.start();
    assert.equal(first.phase, 'awaiting', 'the first flow did not start, so nothing was tested');
    await settle(20);             // its poll has left and is being held by the stub
    await gd.cancel();            // the person leaves that flow
    answers = [];                 // the second flow has nothing to say yet
    const second = await gd.start();
    assert.equal(second.phase, 'awaiting', 'the second flow did not start, so nothing was tested');
    await sent;                   // the held answer has been SENT, not merely waited for
    await settle(30);             // and processed
    const st = await gd.state();
    assert.equal(fs.existsSync(gd.FILE), false,
      'the abandoned flow\'s token was STORED after the person had left it and started another sign-in');
    assert.equal(st.phase, 'awaiting',
      `the second flow ended at ${st.phase} (${st.because}): an answer to the flow the person left completed or reset it`);
    assert.equal(st.because, null, 'the second flow carries a reason written by the abandoned flow: ' + st.because);
  } finally {
    await gd.cancel();
    delete process.env.KOSMOS_GITHUB_CLIENT_ID;
    try { fs.rmSync(gd.FILE, { force: true }); } catch { /* nothing */ }
  }
});

/* #1799, the two holes a blind reviewer reproduced in the first version of the fix,
   which read the generation when the poll FIRED rather than binding it when the flow
   scheduled it. Each arm holds the stub so the ordering is forced, not raced. */
test('#1799: a cancel while the device-code request is out CANCELS: no awaiting is installed and no poll ever goes out', async () => {
  process.env.KOSMOS_GITHUB_CLIENT_ID = 'Iv1.testclient';
  try {
    fs.rmSync(gd.FILE, { force: true });
    answers = [{ access_token: 'tok-cancelled', token_type: 'bearer', scope: 'repo' }];
    holdNextDeviceMs = 100;
    const before = deviceSeq;
    const starting = gd.start();   // not awaited: the device request is being held
    await settle(15);
    const cancelled = await gd.cancel();
    assert.equal(cancelled.phase, 'idle', 'cancel did not report idle, so nothing was tested');
    const started = await starting;
    assert.equal(started.phase, 'idle',
      `start() resolved to ${started.phase} after the person had cancelled: the cancelled flow was installed anyway`);
    await settle(60);
    const code = 'dev-' + (before + 1);
    assert.equal(polledBy.get(code) || 0, 0, `the cancelled flow's code ${code} was polled ${polledBy.get(code)} time(s): a cancel that does not cancel`);
    assert.equal(fs.existsSync(gd.FILE), false, 'the cancelled flow stored a token');
    assert.equal((await gd.state()).phase, 'idle', 'the cancelled flow came back to life');
  } finally {
    await gd.cancel();
    delete process.env.KOSMOS_GITHUB_CLIENT_ID;
    try { fs.rmSync(gd.FILE, { force: true }); } catch { /* nothing */ }
  }
});

test('#1799: a second start while the first flow\'s poll is in flight is the one that gets polled and completed', async () => {
  process.env.KOSMOS_GITHUB_CLIENT_ID = 'Iv1.testclient';
  try {
    fs.rmSync(gd.FILE, { force: true });
    /* Flow 1: its first poll is held 150 ms and answers pending, so the old code would
       reschedule it at interval 0 and clear flow 2's timer in the process. */
    answers = [{ error: 'authorization_pending' }];
    holdNextFlowMs = 150;
    const sent = heldSent();
    const one = await gd.start();
    assert.equal(one.phase, 'awaiting', 'flow 1 did not start, so nothing was tested');
    await settle(15);            // flow 1's poll is out and held
    /* Flow 2: a real 1 s interval, so it has a PENDING timer when flow 1's poll returns. */
    answers = [{ access_token: 'tok-two', token_type: 'bearer', scope: 'repo' }];
    nextInterval = 1;
    const two = await gd.start();
    assert.equal(two.phase, 'awaiting', 'flow 2 did not start, so nothing was tested');
    const codeTwo = two.code;
    await sent;                  // flow 1's held answer has come back
    let st = null;
    for (let i = 0; i < 120; i += 1) {   // up to 3 s for flow 2's 1 s poll
      st = await gd.state();
      if (st.phase !== 'awaiting' && st.phase !== 'completing') break;
      await settle(25);
    }
    assert.equal(st.phase, 'idle',
      `flow 2 (${codeTwo}) ended at ${st.phase} (${st.because}): its poll never ran, because the superseded flow's reschedule cleared its timer`);
    assert.equal(fs.readFileSync(gd.FILE, 'utf8').trim(), 'tok-two', 'the wrong flow\'s token was stored');
    assert.equal(polledBy.get('dev-' + (deviceSeq - 1)) || 0, 1,
      'the superseded flow kept polling after the person had moved on');
  } finally {
    await gd.cancel();
    delete process.env.KOSMOS_GITHUB_CLIENT_ID;
    try { fs.rmSync(gd.FILE, { force: true }); } catch { /* nothing */ }
  }
});

/* The fetch-FAILURE path of a superseded poll. A poll whose request dies (ECONNRESET,
   EADDRNOTAVAIL, both live on this box) reschedules itself; if the flow has been
   superseded meanwhile, that reschedule must not clear the live flow's timer. Red by
   name with schedulePoll's generation guard removed. */
test('#1799: a superseded poll whose request FAILS does not reschedule over the live flow', async () => {
  process.env.KOSMOS_GITHUB_CLIENT_ID = 'Iv1.testclient';
  try {
    fs.rmSync(gd.FILE, { force: true });
    answers = [];
    holdNextFlowMs = 150;
    failNextFlowPoll = true;      // flow 1's held poll will be answered by a dropped socket
    const sent = heldSent();
    const one = await gd.start();
    assert.equal(one.phase, 'awaiting', 'flow 1 did not start, so nothing was tested');
    await settle(15);
    answers = [{ access_token: 'tok-two', token_type: 'bearer', scope: 'repo' }];
    nextInterval = 1;             // flow 2 has a PENDING timer when flow 1's request dies
    const two = await gd.start();
    assert.equal(two.phase, 'awaiting', 'flow 2 did not start, so nothing was tested');
    const codeOne = 'dev-' + (deviceSeq - 1);
    await sent;
    let st = null;
    for (let i = 0; i < 120; i += 1) {
      st = await gd.state();
      if (st.phase !== 'awaiting' && st.phase !== 'completing') break;
      await settle(25);
    }
    assert.equal(st.phase, 'idle',
      `flow 2 ended at ${st.phase} (${st.because}): the superseded flow's failed request rescheduled itself over flow 2's timer`);
    assert.equal(fs.readFileSync(gd.FILE, 'utf8').trim(), 'tok-two', 'the wrong token was stored');
    assert.equal(polledBy.get(codeOne) || 0, 1, 'the superseded flow kept polling after its request failed');
  } finally {
    await gd.cancel();
    delete process.env.KOSMOS_GITHUB_CLIENT_ID;
    try { fs.rmSync(gd.FILE, { force: true }); } catch { /* nothing */ }
  }
});

/* forget() bumps the generation in the same commit as cancel() and start(), and had
   nothing watching it: replacing its endFlow() with stopPolling() left every arm green.
   Scenario: the person authorises on GitHub and clicks Forget in the same round trip;
   the abandoned poll returns, the token is written into the file they just deleted,
   phase goes idle with no reason. Red by name under that mutation. */
test('#1799: a token that arrives after the person clicked Forget is not stored', async () => {
  process.env.KOSMOS_GITHUB_CLIENT_ID = 'Iv1.testclient';
  try {
    fs.rmSync(gd.FILE, { force: true });
    answers = [{ access_token: 'tok-forgot', token_type: 'bearer', scope: 'repo' }];
    holdNextFlowMs = 120;
    const sent = heldSent();
    const first = await gd.start();
    assert.equal(first.phase, 'awaiting', 'the flow did not start, so nothing was tested');
    await settle(20);             // its poll is out and held
    const forgot = await gd.forget();
    assert.equal(forgot.phase, 'idle', 'forget did not report idle, so nothing was tested');
    await sent;                   // the held token answer has been SENT
    await settle(30);             // and processed
    const st = await gd.state();
    assert.equal(fs.existsSync(gd.FILE), false,
      'the token arrived after the person clicked Forget and was stored into the file they had just deleted');
    assert.equal(st.phase, 'idle', 'phase ' + st.phase + ' (' + st.because + ') after a forget');
    assert.equal(st.held, false, 'a token is held after the person forgot');
  } finally {
    await gd.cancel();
    delete process.env.KOSMOS_GITHUB_CLIENT_ID;
    try { fs.rmSync(gd.FILE, { force: true }); } catch { /* nothing */ }
  }
});
