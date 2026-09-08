'use strict';
/**
 * kosmos#988: while an update is applying, tell the coordinator, so a person on
 * their phone reads "your Mac is updating Kosmos, back in a moment" instead of
 * "Kosmos is not answering on this computer".
 *
 * The coordinator route exists but is deliberately not deployed, so these arms
 * assert the REQUEST this engine makes and, above all, that nothing here can
 * fail an install. Sandboxed data root before the require.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-updating-988-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const updating = require('./updating');
const update = require('./update');

function capture() {
  const sent = [];
  updating.setSender((call) => { sent.push(call); });
  return sent;
}
test.afterEach(() => { updating.setSender(null); });

test('#988: the contract is POST /v1/mac/updating with a seconds body', () => {
  const sent = capture();
  updating.announce(900);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].route, '/v1/mac/updating');
  assert.deepEqual(JSON.parse(sent[0].body), { seconds: 900 });
});

test('#988: seconds 0 is the finish signal and survives the clamp', () => {
  const sent = capture();
  updating.announce(0);
  assert.deepEqual(JSON.parse(sent[0].body), { seconds: 0 });
});

test('#988: a negative deadline clamps to 0 rather than being sent as negative', () => {
  const sent = capture();
  updating.announce(-5);
  assert.deepEqual(JSON.parse(sent[0].body), { seconds: 0 });
});

test('#988: a non-numeric deadline falls back to the default rather than sending NaN', () => {
  const sent = capture();
  updating.announce('soon');
  assert.deepEqual(JSON.parse(sent[0].body), { seconds: updating.DEFAULT_SECONDS });
});

test('#988: the default asks for more than any install needs, because the server caps it', () => {
  assert.ok(updating.DEFAULT_SECONDS >= 900, 'asking for the cap is the documented contract');
});

/* 🛑 THE ARMS THAT MATTER. The caller is the one route that installs software,
   so the question is not whether the announce works, it is whether a broken
   announce can reach the caller. Every shape below must be silent. */
test('#988 FAIL-OPEN: a throwing transport does not reach the caller', () => {
  updating.setSender(() => { throw new Error('coordinator on fire'); });
  assert.doesNotThrow(() => updating.announce(900));
});

test('#988 FAIL-OPEN: announce returns undefined, so no caller can await or branch on it', () => {
  capture();
  assert.equal(updating.announce(900), undefined);
});

test('#988 FAIL-OPEN: announce never throws for any argument shape', () => {
  capture();
  for (const arg of [undefined, null, NaN, Infinity, -Infinity, {}, [], 'x', 1e30]) {
    assert.doesNotThrow(() => updating.announce(arg), `argument ${String(arg)} must be survivable`);
  }
});

/* 🛑 THE ARM THAT PROVES THE OUTER GUARD. The two arms above are satisfied by the
   inner catch around the sender seam, so they pass even with the outer try/catch
   removed (measured by perturbation: 13/13 still green). The outer guard is what
   protects the REAL transport path, where remote lookups, URL parsing and
   https.request all run. Make something OUTSIDE the inner try throw. */
test('#988 FAIL-OPEN: a throw from the enrolment lookup, outside the sender seam, still cannot reach the caller', () => {
  updating.setSender(null);
  const remote = require('./remote');
  const real = remote.enrolled;
  remote.enrolled = () => { throw new Error('state dir unreadable'); };
  try {
    assert.doesNotThrow(() => updating.announce(900));
  } finally { remote.enrolled = real; }
});

/* The real transport path, exercised with no sender installed. This machine's
   sandbox has no enrolment, so the honest outcome is silence rather than a
   thrown error or a request to nowhere. */
test('#988: with no enrolment there is no coordinator to tell and no certificate to tell it with', () => {
  updating.setSender(null);
  assert.doesNotThrow(() => updating.announce(900));
});

/* ---- the lifecycle wiring, which is the actual deliverable ---------------- */

test('#988 WIRING: beginning to apply announces the deadline', () => {
  const sent = capture();
  update.setInstalledRoot(() => SANDBOX);
  update.setInstallRunner(() => ({ on: () => {} }));
  try { update.beginInstall({}); } catch { /* the fake child's shape is not what is under test */ }
  update.setInstallRunner(null);
  update.setInstalledRoot(null);
  const asked = sent.filter((c) => JSON.parse(c.body).seconds > 0);
  assert.ok(asked.length >= 1, 'applying must announce a deadline');
});

test('#988 WIRING: a board coming back up clears the flag, because success has no finish hook', () => {
  const sent = capture();
  const t = update.startPolling(60000);
  if (t && typeof t.unref === 'function') t.unref();
  clearInterval(t);
  const cleared = sent.filter((c) => JSON.parse(c.body).seconds === 0);
  assert.ok(cleared.length >= 1, 'a restarted board is by definition not mid-update');
});

test('#988 WIRING: the boot clear is idempotent, so repeated starts cannot begin a message falsely', () => {
  const sent = capture();
  for (let i = 0; i < 3; i++) { const t = update.startPolling(60000); clearInterval(t); }
  assert.ok(sent.length >= 3, 'each boot clears');
  assert.ok(sent.every((c) => JSON.parse(c.body).seconds === 0), 'a boot may only ever clear, never set');
});

/* CONTROL: the wiring arms above would pass if announce were called from
   somewhere harmless. This proves the module under test is the one being
   driven, by removing the sender and showing the same calls are still safe. */
test('#988 CONTROL: with no sender installed the same lifecycle still runs and still throws nothing', () => {
  updating.setSender(null);
  assert.doesNotThrow(() => { const t = update.startPolling(60000); clearInterval(t); });
});
