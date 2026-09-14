'use strict';
/**
 * #3013: server-side wiring of the workspace-trust diagnosis onto the offline row.
 *
 * 🛑 WHY THIS IS A STATIC (SOURCE) GUARD. The behaviour needs a win32 board with a
 * registered Scheduled Task, a stuck sessions dir and an untrusted folder -- and on
 * this fleet's Windows box the whole suite runs with schtasks BLOCKED (the no-schtasks
 * preload) and win32job refusing in a test process, so `win32trustcard.waiting()`
 * fail-closes to [] and an end-to-end arm can never construct the state. The engine
 * path itself is covered exhaustively over seams in engine/win32trustcard.test.js and
 * the render in web.trust-wait-card-3013.test.js; this arm pins that server.js still
 * COMPOSES them onto the offline row -- the seam a silent edit would drop, leaving both
 * halves green while the board showed nothing.
 *
 *   node --test server.trust-wait-offline-3013.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const SRC = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');

/* The offline-row builder region, located by its anchor so this reads the real
   block rather than any other mention of these tokens elsewhere in server.js. */
function offlineRegion() {
  const at = SRC.indexOf('const offline = (() => {');
  assert.notEqual(at, -1, 'the offline builder moved or was renamed; this guard is stale, not the code');
  const end = SRC.indexOf('const counts = countAgents(', at);
  assert.notEqual(end, -1, 'could not find the end of the offline builder region');
  return SRC.slice(at, end);
}

test('#3013 the offline builder consults win32trustcard, win32-gated', () => {
  const region = offlineRegion();
  assert.match(region, /process\.platform === 'win32'/,
    'the trust-wait probe is not gated to win32, so every Mac board would spawn a failing schtasks per poll');
  assert.match(region, /require\('\.\/engine\/win32trustcard'\)\.waiting\(\)/,
    'the offline builder no longer reuses the win32trustcard engine path');
});

test('#3013 a stuck agent gets state needs_trust and the needsTrust marker', () => {
  const region = offlineRegion();
  assert.match(region, /state: stuckBecause \? 'needs_trust' :/,
    'the offline row no longer promotes a trust-waiting agent to the needs_trust state');
  assert.match(region, /needsTrust: Boolean\(stuckBecause\)/,
    'the offline row no longer carries the needsTrust marker the card branches on');
});

test('#3013 the supervisor reason wins the because when the agent is stuck', () => {
  const region = offlineRegion();
  assert.match(region, /because: stuckBecause \? stuckBecause :/,
    'the trust reason no longer overrides the generic offline copy');
});

test('#3013 the needsTrust field is referenced by the page (inventory: no unknown field)', () => {
  /* Mirrors server.test.js\'s "no field the board sends is unknown to the page" arm for
     the one field #3013 adds: it must appear in web/index.html (or be excused in
     UNREAD_ON_PURPOSE). It IS referenced (the card/row read it), so no excuse is needed. */
  const page = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  assert.ok(page.includes('needsTrust'),
    'the board sends needsTrust and the page never reads it: draw it or excuse it in UNREAD_ON_PURPOSE');
});
