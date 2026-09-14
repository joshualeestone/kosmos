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

test('#3013 the offline builder consults win32trustcard.diagnose, win32-gated', () => {
  const region = offlineRegion();
  assert.match(region, /process\.platform === 'win32' \? require\('\.\/engine\/win32trustcard'\) : null/,
    'the trust-card module is not required win32-gated, so a Mac board would load/probe it every poll');
  assert.match(region, /trustCard\.diagnose\(k\.name\)/,
    'the offline builder no longer calls the per-agent diagnose path');
});

test('#3013 (PERF) the trust probe adds NO per-poll spawn and no second live pass', () => {
  /* 🛑 THE #2717 GUARD AT THE CALL SITE. The offline builder must not re-run the
     fleet-level waiting() (which re-ran schtasks + claude) nor a second
     `claude agents --json`; diagnose reads only win32job's process-lifetime cache. */
  const region = offlineRegion();
  assert.doesNotMatch(region, /win32trustcard'\)\.waiting\(\)/,
    'the offline builder still calls the removed fleet-level waiting() (a second claude/schtasks pass)');
  assert.doesNotMatch(region, /win32roster'\)\.defaultRun\(\)/,
    'the offline builder runs a second claude agents --json for the trust probe');
});

test('#3013 (WIN32 ENABLED GATE) the trust probe does NOT gate on the darwin-only create.disabledJobs', () => {
  /* 🛑 THE ROUND-2 REGRESSION GUARD. create.disabledJobs() throws on Windows
     (process.getuid is undefined) and returns an empty Set, so gating the trust
     probe on `!switchedOff.has(name)` was DEAD on win32 -- the one platform trustCard
     runs -- and a switched-off agent would render needs_trust. The enabled decision
     now lives inside diagnose (win32job's task XML), so the call site must not gate on
     switchedOff. */
  const region = offlineRegion();
  /* Scope to the trust-gate STATEMENT itself -- the offline row legitimately still
     uses switchedOff elsewhere (the darwin-only #310 jobSwitchedOff field). */
  const gate = /const stuckBecause = [^\n]*/.exec(region);
  assert.ok(gate, 'the stuckBecause trust gate statement is gone or reshaped');
  assert.doesNotMatch(gate[0], /switchedOff/,
    'the trust gate is gated on the darwin-only switchedOff again, which is inert on win32');
  assert.match(gate[0], /trustCard \? \(\(trustCard\.diagnose\(k\.name\) \|\| \{\}\)\.because\) : undefined;/,
    'the trust gate is no longer the plain win32-gated diagnose call (enabled decided inside diagnose)');
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
