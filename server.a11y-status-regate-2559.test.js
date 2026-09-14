'use strict';
/**
 * #2559/#2911: the /api/a11y-status route serves the Kosmos APP's Accessibility grant and
 * is the RE-GATE mechanism that decides whether S3 Next blocks. It prefers the LIVE TCC-db
 * read (appGrant) and falls back to the native-file read() ONLY for the GRANTED signal, so
 * the laggy AXIsProcessTrusted reading (root cause of the #2912 trap) can never re-surface
 * as a false BLOCK. This drives the REAL route and controls both sources, so the merge
 * conditional itself (not just its source text) is behaviourally covered -- the symmetric
 * partner to server.tmux-a11y-status-2911.test.js.
 *
 *   node --test server.a11y-status-regate-2559.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-a11yregate-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
const DATA = nodePath.join(SANDBOX, 'data');
for (const d of [HOME, BIN, DATA, nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;
process.env.AGENT_WORKFORCE_TMUX_BIN = TMUX_BIN;

const a11ystatus = require('./engine/a11ystatus');

// The two sources the route merges:
//  - appGrant() reads the system TCC.db via the module app runner -> setAppSqliteRunner.
//  - read() reads the native-app file a11ystatus.FILE -> seed/clear it. A verdict is
//    "present" only while fresh (< STALE_AFTER_MS), so seed with a current timestamp.
function liveApp(rows) { a11ystatus.setAppSqliteRunner(() => ({ ok: true, rows })); a11ystatus.resetAppGrantCache(); }
function liveUncheckable() { a11ystatus.setAppSqliteRunner(() => ({ ok: false, because: 'no FDA' })); a11ystatus.resetAppGrantCache(); }
function seedNative(trusted) {
  fs.mkdirSync(nodePath.dirname(a11ystatus.FILE), { recursive: true });
  fs.writeFileSync(a11ystatus.FILE, JSON.stringify({ trusted, at: new Date().toISOString() }));
}
function clearNative() { try { fs.rmSync(a11ystatus.FILE, { force: true }); } catch { /* already gone */ } }
const APP = a11ystatus.APP_CLIENT;

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => {
  a11ystatus.setAppSqliteRunner(() => ({ ok: false, because: 'test teardown runner' }));
  a11ystatus.resetAppGrantCache();
  try { server.close(); } catch { /* the port is going away anyway */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function a11yStatus() {
  const res = await fetch(base + '/api/a11y-status');
  assert.equal(res.status, 200, '/api/a11y-status did not answer 200');
  return res.json();
}

test('#2559 route: LIVE app grant GRANTED -> checkable:true + trusted:true (Next clears)', async () => {
  liveApp([{ client: APP, auth: 2 }]); clearNative();
  const body = await a11yStatus();
  assert.equal(body.checkable, true, JSON.stringify(body));
  assert.equal(body.trusted, true, JSON.stringify(body));
});

test('#2559 route: LIVE app grant NOT granted -> checkable:true + trusted:false (BLOCKS -- the re-gate)', async () => {
  // The core re-gate arm: a DEFINITE live not-granted must block Next. A logic bug that
  // dropped this (e.g. only ever serving the granted signal) would silently un-gate S3.
  liveApp([{ client: APP, auth: 0 }]); seedNative(true);  // native says granted, but live is authoritative both ways
  const body = await a11yStatus();
  assert.equal(body.checkable, true, JSON.stringify(body));
  assert.equal(body.trusted, false, 'a definite LIVE not-granted must block Next, even if the laggy native file says granted: ' + JSON.stringify(body));
});

test('#2559 route: live UNCHECKABLE + native GRANTED -> falls back to granted (never strands a granted user)', async () => {
  liveUncheckable(); seedNative(true);
  const body = await a11yStatus();
  assert.equal(body.checkable, true, JSON.stringify(body));
  assert.equal(body.trusted, true, 'a no-FDA box with a granted native reading must not strand the user: ' + JSON.stringify(body));
});

test('#2912 route: live UNCHECKABLE + native NOT granted -> advisory checkable:false (the laggy not-granted NEVER blocks)', async () => {
  // The anti-#2912 arm: read()'s not-granted is the pinned/laggy reading that trapped Josh.
  // The route must NOT block on it -- it only borrows read() for the GRANTED signal.
  liveUncheckable(); seedNative(false);
  const body = await a11yStatus();
  assert.equal(body.checkable, false, 'the laggy native not-granted must degrade to advisory, never a block (the #2912 trap): ' + JSON.stringify(body));
});

test('#2559 route: live UNCHECKABLE + NO native writer (browser) -> advisory checkable:false (fail-safe)', async () => {
  liveUncheckable(); clearNative();
  const body = await a11yStatus();
  assert.equal(body.checkable, false, 'a browser / no-FDA context with no native writer must never block Next: ' + JSON.stringify(body));
});
