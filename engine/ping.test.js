'use strict';

/**
 * engine/ping.js after #2623: the create-agent telemetry was deleted (Josh,
 * 2026-09-09, called the "let the Kosmos team know..." toggles an invasion of
 * privacy and asked for them gone). What remains is the local install id and the
 * under-test guard, neither of which leaves the Mac. These arms pin exactly that:
 * the id is random, kept, and not a machine fingerprint; read() is null-safe on a
 * missing or corrupt file; and the send surface is gone, not merely unused.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-ping-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const ping = require('./ping');

// #1856: ping.FILE lives under the Kosmos leaf, so ensure its dir exists before
// the tests write to ping.FILE directly.
function fresh() { fs.mkdirSync(nodePath.dirname(ping.FILE), { recursive: true }); try { fs.unlinkSync(ping.FILE); } catch { /* none */ } }

test('the install id is random, kept, and not derived from the machine', () => {
  fresh();
  const a = ping.installId();
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.equal(ping.installId(), a, 'a second call made a second install');
  /* ⚠️ It must not be a fingerprint. A hash of the hostname would be just as
     stable and would also identify this COMPUTER across reinstalls and across
     products; random identifies an install and nothing else. */
  const host = require('node:crypto').createHash('sha256').update(os.hostname()).digest('hex');
  assert.ok(!host.startsWith(a.replace(/-/g, '').slice(0, 8)), 'the id looks derived from the hostname');
});

test('read() returns the stored id, and null for an absent or unreadable file', () => {
  fresh();
  assert.equal(ping.read().installId, null, 'a never-written file has no id yet');
  const made = ping.installId();
  assert.equal(ping.read().installId, made, 'the minted id is read back');
  /* Corrupt or non-object prefs read as "no id", never a throw. typeof [] ===
     'object', so the array arm proves the plain-object guard is doing its job
     rather than falling through. */
  fs.writeFileSync(ping.FILE, '{ not json');
  assert.equal(ping.read().installId, null);
  fs.writeFileSync(ping.FILE, '[1,2,3]');
  assert.equal(ping.read().installId, null, 'a top-level array is not a readable pref');
});

test("underTest is true inside node's test runner", () => {
  assert.equal(ping.underTest(), true, 'the runner signal is gone, so callers that inline it would misbehave');
});

test('#2623: the telemetry send surface is gone, not merely unused', () => {
  /* The create-agent telemetry was deleted. ping.js must no longer expose any
     send path or on/off setting: only the local id and the under-test guard. An
     absence guard so a later re-export cannot quietly bring the phone-home back. */
  for (const gone of ['agentCreated', 'setOn', 'payload', 'setSender', 'DEFAULT_ENDPOINT']) {
    assert.equal(ping[gone], undefined, 'ping.' + gone + ' should have been deleted with the telemetry');
  }
});
