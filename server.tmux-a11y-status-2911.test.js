'use strict';
/**
 * #2911: the /api/tmux-a11y-status route serves tmux's OWN Accessibility grant
 * (a11ystatus.tmuxGrant) and maps the present:false verdict (tmux not yet listed in the
 * Accessibility list, so nothing to toggle) to a NON-blocking checkable:false, so a user
 * who reaches S3 before tmux has registered is never trapped (#2912). This drives the
 * REAL route and controls tmuxGrant's verdict via the injected module sqlite runner, so
 * the route conditional itself (not just its source text) is behaviourally covered.
 *
 *   node --test server.tmux-a11y-status-2911.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-tmuxa11y-'));
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

// The route calls a11ystatus.tmuxGrant() with no opts, so it resolves the tmux binary from
// AGENT_WORKFORCE_TMUX_BIN and reads the MODULE sqlite runner. tmuxGrant realpath-resolves
// the binary and exact-matches the TCC row on that path, so a "granted" row must carry the
// realpath. node --test runs server.js and this test in ONE process, so they share the
// a11ystatus singleton and setSqliteRunner here reaches the route.
const a11ystatus = require('./engine/a11ystatus');
const TMUX_REAL = fs.realpathSync(TMUX_BIN);

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => {
  a11ystatus.setSqliteRunner(() => ({ ok: false, because: 'test teardown runner' }));
  a11ystatus.resetGrantCache();
  try { server.close(); } catch { /* the port is going away anyway */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function tmuxA11y() {
  const res = await fetch(base + '/api/tmux-a11y-status');
  assert.equal(res.status, 200, '/api/tmux-a11y-status did not answer 200');
  return res.json();
}
// Inject the tmux TCC rows the route's tmuxGrant will read, and clear the 2s memo so the
// next fetch reflects them rather than a cached verdict.
function withRows(rows) { a11ystatus.setSqliteRunner(() => ({ ok: true, rows })); a11ystatus.resetGrantCache(); }

test('#2911 route: tmux NOT yet listed (present:false) -> checkable:false, so Next is NOT blocked (never a trap)', async () => {
  withRows([]);  // no tmux row anywhere -> tmuxGrant present:false
  const body = await tmuxA11y();
  assert.equal(body.checkable, false,
    'a tmux that is not yet in the Accessibility list must be advisory (nothing to toggle), never a blocking not-granted: ' + JSON.stringify(body));
});

test('#2911 route: tmux listed but OFF (present:true, auth 0) -> checkable:true + trusted:false (BLOCKS; the user can toggle it)', async () => {
  withRows([{ client: TMUX_REAL, auth: 0 }]);
  const body = await tmuxA11y();
  assert.equal(body.checkable, true, JSON.stringify(body));
  assert.equal(body.trusted, false, 'a listed-but-off tmux is a real not-granted the gate should block on: ' + JSON.stringify(body));
});

test('#2911 route: tmux GRANTED (present:true, auth 2) -> checkable:true + trusted:true (Next clears)', async () => {
  withRows([{ client: TMUX_REAL, auth: 2 }]);
  const body = await tmuxA11y();
  assert.equal(body.checkable, true, JSON.stringify(body));
  assert.equal(body.trusted, true, 'a granted tmux must read as granted: ' + JSON.stringify(body));
});

test('#2911 route: an UNREADABLE db (sqlite fails) -> checkable:false (advisory fail-safe, never a false block)', async () => {
  a11ystatus.setSqliteRunner(() => ({ ok: false, because: 'no access' }));
  a11ystatus.resetGrantCache();
  const body = await tmuxA11y();
  assert.equal(body.checkable, false, 'an unreadable TCC db must never block Next: ' + JSON.stringify(body));
});

// #2559: nativePresent is a11ystatus.read().checkable === true (a fresh a11y-status.json the
// native app maintains), so drive it by writing / removing that file. present:true = a real
// Mac with the app running; false = a browser tester (no native writer).
function setNativePresent(present) {
  try {
    if (present) {
      fs.mkdirSync(nodePath.dirname(a11ystatus.FILE), { recursive: true });
      fs.writeFileSync(a11ystatus.FILE, JSON.stringify({ trusted: false, at: new Date().toISOString() }));
    } else {
      fs.rmSync(a11ystatus.FILE, { force: true });
    }
  } catch { /* best effort; the assertions below prove which state took effect */ }
}

test('#2559 route: UNREADABLE db + a NATIVE APP present -> checkable:false + ACTIONABLE (Turn On, not a dead "Checking...")', async () => {
  // The Josh fresh-Mac case: the board has no Full Disk Access so tmuxGrant cannot read the
  // TCC db (checkable:false), but the native app IS running. The row must offer Turn On (which
  // fires the osascript-under-tmux prompt, no FDA needed), not strand the user on a spinner.
  setNativePresent(true);
  a11ystatus.setSqliteRunner(() => ({ ok: false, because: 'no access' }));
  a11ystatus.resetGrantCache();
  const body = await tmuxA11y();
  assert.equal(body.checkable, false, 'must stay checkable:false so the S3 Next gate is not blocked (#2912): ' + JSON.stringify(body));
  assert.equal(body.actionable, true, 'an unreadable grant on a real Mac (native present) must be actionable, not a dead spinner: ' + JSON.stringify(body));
});

test('#2559 CONTROL: UNREADABLE db + NO native app (a browser) -> checkable:false and NOT actionable (honest advisory, nothing to grant)', async () => {
  // The discriminator that keeps the fix from painting Turn On for a browser tester, where
  // there is genuinely nothing to grant and no native app to fire the prompt. If this control
  // trips, the fix would show a dead Turn On in a browser.
  setNativePresent(false);
  a11ystatus.setSqliteRunner(() => ({ ok: false, because: 'no access' }));
  a11ystatus.resetGrantCache();
  const body = await tmuxA11y();
  assert.equal(body.checkable, false, JSON.stringify(body));
  assert.notEqual(body.actionable, true, 'a browser (no native app) must keep the advisory "Checking...", never a Turn On: ' + JSON.stringify(body));
});
