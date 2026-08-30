/**
 * #1580: auth without a binary reported CONNECTED.
 *
 * `start()` returned CONNECTED five lines before it computed `haveBinary`, so a
 * machine with valid auth and no Claude Code was told it was connected and never
 * offered the install. Plausible after a migration or a partial uninstall, and it
 * failed in the reassuring direction: nothing to click, no error, and the failure
 * surfaced later as an agent that would not start.
 *
 * 🛑 WHY THIS FILE EXISTS SEPARATELY FROM connect.test.js: the defect was found by
 * RUNNING the #1562 QA matrix, not by reading, and the fix's first version
 * REINTRODUCED #1560 while the whole suite stayed green. These cells are what
 * caught it. They belong somewhere they will be run.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const nodePath = require('node:path');
const { mkTemp } = require('../test-support/tmpdir');

const SANDBOX = mkTemp('nobinary1580-');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
const CFG_DIR = nodePath.join(SANDBOX, 'claude-config');
fs.mkdirSync(CFG_DIR, { recursive: true });
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(CFG_DIR, '.claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = CFG_DIR;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
/* #527: without this a default-dir scoped check in this file would read the
   operator's real ~/.claude.json. Inert today because every cell overrides
   AGENT_WORKFORCE_CLAUDE_BIN and none passes a configDir, but it arms the
   multi-account cell this file will eventually want. */
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');

const connect = require('./connect');
const subscription = require('./subscription');

const PAID_FILE = { oauthAccount: { organizationType: 'claude_max' } };

const http = require('node:http');
const crypto = require('node:crypto');

function serveRelease(t, binary, checksum) {
  const paths = {
    '/latest': () => '9.9.5',
    '/9.9.5/manifest.json': () => JSON.stringify({ platforms: { [connect.platformKey()]: { checksum } } }),
    [`/9.9.5/${connect.platformKey()}/claude`]: () => binary,
  };
  const server = http.createServer((req, res) => {
    const answer = paths[req.url];
    if (!answer) { res.writeHead(404); res.end(); return; }
    const body = Buffer.isBuffer(answer()) ? answer() : Buffer.from(answer());
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}


/**
 * One cell of the #1562 matrix: a machine described by whether Claude Code is on
 * disk and whether the person is really signed in, driven through the real
 * `start()`.
 */
async function cell(t, { binary, fileSaysPaid, liveLoggedIn }) {
  /**
   * 🛑 SERVE A LOCAL RELEASE OR THIS HITS downloads.claude.ai FOR REAL. A review
   * witnessed the first version of this helper fetching `/latest`, then the
   * manifest, then the 281MB production artifact, on every suite run, stopped
   * only by the runner force-exiting: `download()` has no cancellation check
   * between the manifest fetch and `fetchFile`, and `resetForTests()` nulls
   * `activeRequest` without destroying it.
   *
   * ⚠️ Every cell here that falls through reaches the download by design, which
   * is the whole point of the card, so the base is not optional in this file.
   */
  const fixture = crypto.randomBytes(8 * 1024);
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE = await serveRelease(
    t, fixture, crypto.createHash('sha256').update(fixture).digest('hex'));
  const bin = nodePath.join(SANDBOX, `claude-${Math.random().toString(36).slice(2, 8)}`);
  if (binary) { fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n'); fs.chmodSync(bin, 0o755); }
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG,
    JSON.stringify(fileSaysPaid ? PAID_FILE : {}));
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: liveLoggedIn }), err: null }));
  connect.setRunner(() => ({ ok: true, stdout: '' }));
  connect.setDryRun(false);
  t.after(() => {
    connect.setRunner(null);
    subscription.setRunner(null);
    connect.resetForTests();
    connect.setDryRun(true);
    connect.setTickInterval(700);
    delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    delete process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE;
  });
  const st = await connect.start();
  return st.phase;
}

/**
 * 🛑 READ THE SETTLED PHASE, NOT `start()`'s IMMEDIATE RETURN. A review measured
 * that one of these tests went red under a mutation for the wrong reason: it saw
 * `idle` (the flow had not written a phase yet) rather than a lockout, because
 * removing a guard inserted an `await` before `launchSignin`'s synchronous
 * `writeState`. Settled, that mutation was behaviourally inert for the cell.
 *
 * ⇒ An assertion on the immediate return cannot tell "wrote the wrong phase"
 * from "has not written one yet", so any future refactor that adds an unrelated
 * await would redden these with a misleading message.
 *
 * ⚠️ AND `signin-launching` IS A WAYPOINT, NOT AN END STATE. A review measured
 * that with a pane classifying as `unknown` rather than this file's blank
 * fixture, the trail continues `downloading -> signin-launching -> connected`
 * via the pre-existing config-outranks-screen arm, which reads the FILE. That
 * arm is not touched by this branch.
 *
 * ⇒ So the assertions below establish "the flow reaches sign-in rather than
 * short-circuiting to connected", which is what this card is about. They do NOT
 * establish that a stale file can never reach connected by any route, and their
 * names should not be read that way.
 */
async function settled(ms = 6000) {
  const deadline = Date.now() + ms;
  const moving = [connect.PHASE.DOWNLOADING, connect.PHASE.INSTALLING, connect.PHASE.IDLE];
  while (Date.now() < deadline) {
    if (!moving.includes(connect.state().phase)) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  return connect.state().phase;
}

test('#1580: signed in with NO binary is not reported connected, it is offered the install', async (t) => {
  const phase = await cell(t, { binary: false, fileSaysPaid: true, liveLoggedIn: true });
  assert.notEqual(phase, connect.PHASE.CONNECTED,
    'a machine with no Claude Code was told it was connected; nothing on it can run an agent');
  assert.equal(phase, connect.PHASE.DOWNLOADING);
});

test('#1580 CONTROL: signed in WITH a binary still short-circuits to connected', async (t) => {
  // Without this arm the fix above is satisfied by never reporting connected,
  // which would drag every already-connected person through an install.
  const phase = await cell(t, { binary: true, fileSaysPaid: true, liveLoggedIn: true });
  assert.equal(phase, connect.PHASE.CONNECTED);
});

test('#1560 MUST NOT RETURN: signed OUT with a stale paid-plan file still reaches sign-in', async (t) => {
  /**
   * 🛑 THIS GUARDS A REGRESSION I ACTUALLY SHIPPED INTO THE WORKING TREE. The
   * first version of #1580's fix added a post-install connected check that read
   * the FILE and ran for EVERY flow, so this cell was declared connected at the
   * end of runFlow: #1560's lockout, re-entering through the back door of its
   * own fix. The full suite stayed green; only this cell caught it.
   */
  await cell(t, { binary: true, fileSaysPaid: true, liveLoggedIn: false });
  assert.equal(await settled(), connect.PHASE.SIGNIN_LAUNCHING,
    'a signed-out person with a stale paid-plan file was locked out again');
});

test('#1580 CONTROL: signed out with a CLEAN file also reaches sign-in', async (t) => {
  await cell(t, { binary: true, fileSaysPaid: false, liveLoggedIn: false });
  assert.equal(await settled(), connect.PHASE.SIGNIN_LAUNCHING);
});

/**
 * 🛑 THE ARM THAT PINS THE `checkLive` HALF, ADDED BECAUSE PERTURBING IT LEFT THE
 * FILE GREEN. The post-install check only runs when an install happened, so a
 * cell with a binary present never reaches it. This one has NO binary AND a
 * stale paid-plan file over a signed-out account, which is the only shape where
 * removing the live verification declares somebody connected who is not.
 *
 * It drives the flow to completion rather than reading `start()`'s first answer,
 * because the defect is in what happens AFTER the download.
 */
test('#1560 MUST NOT RETURN VIA THE INSTALL PATH: no binary, signed out, stale paid file', async (t) => {
  const binary = crypto.randomBytes(16 * 1024);
  const checksum = crypto.createHash('sha256').update(binary).digest('hex');
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE = await serveRelease(t, binary, checksum);
  const bin = nodePath.join(SANDBOX, `claude-live-${Math.random().toString(36).slice(2, 8)}`);
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;                     // ABSENT
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(PAID_FILE));
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: false }), err: null }));
  connect.setRunner((file, args) => {
    if (args && args[0] === 'install') { fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n'); fs.chmodSync(bin, 0o755); }
    return { ok: true, stdout: '' };
  });
  connect.setDryRun(false);
  connect.setTickInterval(60);
  t.after(() => {
    connect.setRunner(null); subscription.setRunner(null); connect.resetForTests();
    delete process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE;
    delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  });

  await connect.start();
  const deadline = Date.now() + 9000;
  while (Date.now() < deadline) {
    if (connect.state().phase !== connect.PHASE.DOWNLOADING
      && connect.state().phase !== connect.PHASE.INSTALLING) break;
    await new Promise((r) => setTimeout(r, 80));
  }
  /* ⚠️ AN EQUALITY, NOT `notEqual(CONNECTED)`. A review sabotaged the install so
     the flow reached STUCK, and the negative form still passed: it named the
     #1560 path and was satisfied by an unrelated failure. */
  assert.equal(connect.state().phase, connect.PHASE.SIGNIN_LAUNCHING,
    'installing the binary declared a SIGNED-OUT person connected: #1560 through the install path');
});

test('#1580 part 2: installing the missing binary FINISHES the job for a signed-in person', async (t) => {
  /**
   * 🛑 THE ONE BEHAVIOUR PART 2 EXISTS TO PRODUCE, AND IT HAD NO TEST. A review
   * deleted the whole post-install block and ran 1671 tests green: every other
   * assertion in this file is either about part 1 or is a NEGATIVE ("must not be
   * connected"), so nothing detected part 2 never firing. Only over-firing was
   * caught.
   *
   * ⇒ A guard's positive case needs an arm of its own. Measured with the block
   * deleted: this cell settles at `signin-launching`, walking somebody who was
   * already signed in through a sign-in they do not need.
   */
  const binary = crypto.randomBytes(16 * 1024);
  const checksum = crypto.createHash('sha256').update(binary).digest('hex');
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE = await serveRelease(t, binary, checksum);
  const bin = nodePath.join(SANDBOX, `claude-p2-${Math.random().toString(36).slice(2, 8)}`);
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;                     // ABSENT
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(PAID_FILE));
  subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: true }), err: null }));
  connect.setRunner((file, args) => {
    if (args && args[0] === 'install') { fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n'); fs.chmodSync(bin, 0o755); }
    return { ok: true, stdout: '' };
  });
  connect.setDryRun(false);
  connect.setTickInterval(60);
  t.after(() => {
    connect.setRunner(null); subscription.setRunner(null); connect.resetForTests();
    delete process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE;
    delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  });

  assert.equal(await connect.start().then((s) => s.phase), connect.PHASE.DOWNLOADING);
  assert.equal(await settled(9000), connect.PHASE.CONNECTED,
    'the binary was the only thing missing, so installing it should finish the job, not start a sign-in');
  assert.equal(fs.existsSync(bin), true, 'the install did not actually produce a binary');
});

test('#1580 part 2: an UNANSWERABLE post-install probe must not declare a stale file connected', async (t) => {
  /**
   * 🛑 THE PROBE IS AT ITS LEAST RELIABLE EXACTLY HERE: it runs against a binary
   * that has never executed, seconds after a 281MB install. `checkLive` answers
   * UNKNOWN on a timeout, on ENOENT, or on any stdout that is not pure JSON, so
   * one line of first-run chatter is enough.
   *
   * ⚠️ Reading UNKNOWN as connected declares somebody connected off a stale
   * paid-plan file, which is #1560 again through the install path. `start()`
   * treats UNKNOWN as "keep the old behaviour" for a good reason that does not
   * survive to this point: here the person has already clicked Connect and
   * already waited for the download, so a sign-in is what they asked for.
   *
   * Measured: without this arm, reverting the check to `!== NONE` left the whole
   * file green.
   */
  const binary = crypto.randomBytes(16 * 1024);
  const checksum = crypto.createHash('sha256').update(binary).digest('hex');
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE = await serveRelease(t, binary, checksum);
  const bin = nodePath.join(SANDBOX, `claude-unk-${Math.random().toString(36).slice(2, 8)}`);
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;                     // ABSENT
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(PAID_FILE));
  // first-run chatter rather than JSON: checkLive cannot parse it, so UNKNOWN
  subscription.setRunner(async () => ({ stdout: 'Welcome to Claude Code!\n{"loggedIn":true}', err: null }));
  connect.setRunner((file, args) => {
    if (args && args[0] === 'install') { fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n'); fs.chmodSync(bin, 0o755); }
    return { ok: true, stdout: '' };
  });
  connect.setDryRun(false);
  connect.setTickInterval(60);
  t.after(() => {
    connect.setRunner(null); subscription.setRunner(null); connect.resetForTests();
    delete process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE;
    delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  });

  await connect.start();
  assert.equal(await settled(9000), connect.PHASE.SIGNIN_LAUNCHING,
    'an unanswerable probe was read as connected, off a stale paid-plan file');
});

test('#1580: the !haveBinary guard stops a flow that ALREADY had a binary from re-deciding', async (t) => {
  /**
   * 🛑 THIS ARM EXISTS BECAUSE A REVIEW MEASURED THAT MY PLAN WAS WRONG. It
   * claimed both guards on the post-install check went red under mutation;
   * replacing `if (!haveBinary)` with `if (true)` left every connect test green,
   * because no cell reached the end of `runFlow` with a binary present AND a
   * live-CONNECTED account. The guard's positive case was unreachable in the
   * fixture set: the same gap I had already found and closed for `checkLive`,
   * still open one guard over.
   *
   * ⇒ The shape that reaches it is a LIVE ANSWER THAT CHANGES MID-FLOW. Signed
   * out at `start()` (so the sign-in flow runs with a binary already present),
   * signed in by the time the tail is reached. Without `!haveBinary` the tail
   * would then declare connected for a flow that installed nothing, skipping the
   * sign-in the person is in the middle of.
   */
  const bin = nodePath.join(SANDBOX, `claude-flip-${Math.random().toString(36).slice(2, 8)}`);
  fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n'); fs.chmodSync(bin, 0o755);   // PRESENT
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify(PAID_FILE));
  let answers = 0;
  subscription.setRunner(async () => {
    answers += 1;
    // NONE at start() so the flow runs; CONNECTED by the time the tail asks
    return { stdout: JSON.stringify({ loggedIn: answers > 1 }), err: null };
  });
  connect.setRunner(() => ({ ok: true, stdout: '' }));
  connect.setDryRun(false);
  connect.setTickInterval(60);
  t.after(() => {
    connect.setRunner(null); subscription.setRunner(null); connect.resetForTests();
    delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  });

  await connect.start();
  assert.equal(await settled(), connect.PHASE.SIGNIN_LAUNCHING,
    'a flow that installed nothing re-decided at the tail and skipped the sign-in in progress');
});
