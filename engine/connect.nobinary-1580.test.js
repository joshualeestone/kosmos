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

const connect = require('./connect');
const subscription = require('./subscription');

const PAID_FILE = { oauthAccount: { organizationType: 'claude_max' } };

/**
 * One cell of the #1562 matrix: a machine described by whether Claude Code is on
 * disk and whether the person is really signed in, driven through the real
 * `start()`.
 */
async function cell(t, { binary, fileSaysPaid, liveLoggedIn }) {
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
    delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  });
  const st = await connect.start();
  return st.phase;
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
  const phase = await cell(t, { binary: true, fileSaysPaid: true, liveLoggedIn: false });
  assert.equal(phase, connect.PHASE.SIGNIN_LAUNCHING,
    'a signed-out person with a stale paid-plan file was locked out again');
});

test('#1580 CONTROL: signed out with a CLEAN file also reaches sign-in', async (t) => {
  const phase = await cell(t, { binary: true, fileSaysPaid: false, liveLoggedIn: false });
  assert.equal(phase, connect.PHASE.SIGNIN_LAUNCHING);
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
  assert.notEqual(connect.state().phase, connect.PHASE.CONNECTED,
    'installing the binary declared a SIGNED-OUT person connected: #1560 through the install path');
});
