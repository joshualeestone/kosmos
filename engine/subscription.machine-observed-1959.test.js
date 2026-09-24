'use strict';
/**
 * #1959 -- computeMachine (the #2130 global banner) must honour the OBSERVED
 * per-dir liveness verdict, not only the raw credential-exists check().
 *
 * check() reads only whether a token EXISTS on disk (blind to a 401), so a
 * credential that is present but was rejected on a live probe still reads
 * CONNECTED. The "Check now" route (#3136) records that live outcome per config
 * dir via observed.sawDir(ANTHROPIC, dir, OK|REJECTED). These tests pin that a
 * FRESH rejection now stops the machine banner claiming a stale "connected", and
 * -- critically -- that the change is a strict no-op when no observation exists
 * (the common case), so it never invents or suppresses a connection wrongly.
 *
 * Harness mirrors subscription.machine-2130.test.js: AGENT_WORKFORCE_HOME steers
 * accounts.js, AGENT_WORKFORCE_CLAUDE_CONFIG steers subscription.js's default file.
 *
 *   node --test engine/subscription.machine-observed-1959.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const HOME_SB = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'sub-machine-observed-1959-'));
const DEFAULT_CONFIG = nodePath.join(HOME_SB, '.claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME_SB;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = DEFAULT_CONFIG;

const sub = require('./subscription');
const observed = require('./observed');
const accounts = require('./accounts');

const { ANTHROPIC } = observed.PROVIDER;
const { OK, REJECTED } = observed.OUTCOME;

test('#1959 observed.isFresh is the single owner of the fresh/stale rule the memo key reuses', () => {
  const now = 1_000_000;
  const win = 5000;
  assert.equal(observed.isFresh(now - 1, now, win), true, 'a just-recorded observation is fresh');
  assert.equal(observed.isFresh(now - win, now, win), true, 'the window boundary is inclusive (age == limit)');
  assert.equal(observed.isFresh(now - win - 1, now, win), false, 'one ms past the window is stale');
  assert.equal(observed.isFresh(now + 1000, now, win), false, 'a future observation is not fresh (the >= 0 guard)');
  assert.equal(observed.isFresh(undefined, now, win), false, 'a missing timestamp is not fresh');
  assert.equal(observed.isFresh(NaN, now, win), false, 'a NaN timestamp is not fresh');
});

function writeJSON(file, obj) {
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}
function acctFile(name) { return nodePath.join(HOME_SB, `.claude-${name}`, '.claude.json'); }
const CONNECTED = { oauthAccount: { emailAddress: 'her@example.com', organizationType: 'claude_max' } };
const NO_ACCT = { someOtherKey: true };

// The default account's dir as accounts.list() reports it (== sawDir's key from
// server.js check-now). Resolved from the list so the test tracks the real value.
function defaultDir() {
  const d = accounts.list().find((a) => a.isDefault);
  assert.ok(d && d.dir, 'the default account is not in accounts.list() -- fixture is wrong');
  return d.dir;
}
function nonDefaultDir(name) {
  const d = accounts.list().find((a) => a.label === name);
  assert.ok(d && d.dir, `the non-default account ${name} is not in accounts.list()`);
  return d.dir;
}

function clean() {
  for (const e of fs.readdirSync(HOME_SB)) fs.rmSync(nodePath.join(HOME_SB, e), { recursive: true, force: true });
  sub.resetCache();
  observed._clearForTest();
  delete process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
}

test('#1959 THE FIX: a FRESH observed rejection on the connected default -> checkMachine NONE with the honest signed-out wording (control: without it, CONNECTED)', () => {
  clean();
  writeJSON(DEFAULT_CONFIG, CONNECTED);
  // Control: raw check-only sees the existing credential as connected.
  assert.equal(sub.checkMachine().state, sub.STATE.CONNECTED,
    'CONTROL: an existing default credential reads CONNECTED before any observation -- if this fails the fix arm proves nothing');
  // A Check-now found it signed out (fresh):
  sub.resetCache();
  observed.sawDir(ANTHROPIC, defaultDir(), REJECTED, Date.now());
  const v = sub.checkMachine();
  assert.equal(v.state, sub.STATE.NONE,
    'a fresh observed rejection must stop the banner claiming a stale connected: ' + JSON.stringify(v));
  assert.match(v.because, /sign(ed)? ?in|signed out/i, 'the wording must reflect the signed-out/needs-sign-in state: ' + v.because);
});

test('#1959 NON-REGRESSION: connected default with NO observation -> CONNECTED, byte-for-byte the pre-#1959 verdict', () => {
  clean();
  writeJSON(DEFAULT_CONFIG, CONNECTED);
  const v = sub.checkMachine();
  assert.equal(v.state, sub.STATE.CONNECTED, 'absence of any observation must return the raw check unchanged (no-op)');
  assert.match(v.because, /connected on this computer/, 'the unchanged connected wording must be preserved');
});

test('#1959 FRESHNESS: a STALE observed rejection is ignored -> the default still reads CONNECTED (verdict freshness-gates the negative too)', () => {
  clean();
  writeJSON(DEFAULT_CONFIG, CONNECTED);
  observed.sawDir(ANTHROPIC, defaultDir(), REJECTED, Date.now() - 10 * 60 * 1000); // 10 min ago, past 5-min window
  assert.equal(sub.checkMachine().state, sub.STATE.CONNECTED,
    'a stale rejection must NOT keep asserting not-connected -- the person may have re-signed-in since');
});

test('#1959 POSITIVE is harmless: a fresh observed OK on the connected default -> still CONNECTED (the overlay never downgrades an ok)', () => {
  clean();
  writeJSON(DEFAULT_CONFIG, CONNECTED);
  observed.sawDir(ANTHROPIC, defaultDir(), OK, Date.now());
  assert.equal(sub.checkMachine().state, sub.STATE.CONNECTED);
});

test('#1959 NON-DEFAULT: a fresh-rejected non-default account does NOT flip the banner to connected (control: same account with no observation DOES)', () => {
  clean();
  writeJSON(DEFAULT_CONFIG, NO_ACCT);      // default: not a subscription
  writeJSON(acctFile('work'), CONNECTED);  // a non-default credential exists
  // Control: with no observation, the non-default connected account flips the banner CONNECTED.
  assert.equal(sub.checkMachine().state, sub.STATE.CONNECTED,
    'CONTROL: a connected non-default account should flip the banner connected when unobserved');
  // Now a Check-now found that non-default account signed out (fresh):
  sub.resetCache();
  observed.sawDir(ANTHROPIC, nonDefaultDir('work'), REJECTED, Date.now());
  assert.notEqual(sub.checkMachine().state, sub.STATE.CONNECTED,
    'a fresh-rejected non-default account must not be the reason the banner says connected');
});

test('#1959 MEMO: a Check-now rejection invalidates the 5s memo (folded freshness in the key), so the banner reflects it without a file change', () => {
  clean();
  writeJSON(DEFAULT_CONFIG, CONNECTED);
  assert.equal(sub.checkMachine().state, sub.STATE.CONNECTED, 'first read: connected');
  // Record a rejection -- NO config file changes, only the in-memory dir store.
  observed.sawDir(ANTHROPIC, defaultDir(), REJECTED, Date.now());
  assert.equal(sub.checkMachine().state, sub.STATE.NONE,
    'the memo key must fold the observation, or the banner keeps serving the pre-check connected verdict');
});

test('#1959 MEMO fresh->stale: when a fresh rejection later ages out, the memo key flips and the banner returns to CONNECTED', () => {
  clean();
  writeJSON(DEFAULT_CONFIG, CONNECTED);
  // A rejection recorded 1000ms ago, so freshness is decided by the WINDOW, not by
  // sub-millisecond timing. Large window -> fresh -> suppressed.
  const at = Date.now() - 1000;
  process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = String(60 * 1000); // 60s window
  observed.sawDir(ANTHROPIC, defaultDir(), REJECTED, at);
  assert.equal(sub.checkMachine().state, sub.STATE.NONE, 'fresh rejection (1000ms < 60s) suppresses connected');
  // Shrink the window under the observation's age so the same observation is now
  // STALE -- the key must flip (fresh->stale) and invalidate the memo, deterministically.
  process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = '100'; // 100ms window; 1000ms age is past it
  assert.equal(sub.checkMachine().state, sub.STATE.CONNECTED,
    'once the rejection ages past the window the memo must invalidate and fall back to the raw connected');
});
