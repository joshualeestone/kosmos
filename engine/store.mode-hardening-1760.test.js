'use strict';

/**
 * #1760 hardening: pin the data root owner-only (0700) on EVERY store write, and
 * create the message log 0600, so a data root outside ~/Library is not readable by
 * other local accounts.
 *
 * The first test asserts store.ensure() TIGHTENS a loose root; the second that the
 * message log is created 0600.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'storemode-1760-')));
process.env.AGENT_WORKFORCE_DATA = SB;
delete process.env.AGENT_WORKFORCE_HOME;

const store = require('./store');

test('#1760: a store write (writeProfile -> ensure) TIGHTENS a loose data ROOT to 0700', () => {
  // Pre-create ROOT and set it DELIBERATELY LOOSE (0755) so the assertion
  // discriminates regardless of the ambient umask: under umask 077 a fresh
  // mkdirSync would already be 0700 and hide whether ensure() did anything, so we
  // pin the precondition ourselves. ensure() (reached via writeProfile) must
  // tighten it to 0700; delete the chmod in store.ensure() and this stays 0755 and reds.
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.chmodSync(store.ROOT, 0o755);
  assert.equal(fs.statSync(store.ROOT).mode & 0o777, 0o755, 'precondition: ROOT starts loose at 0755');

  store.writeProfile('modeprobe', { dir: path.join(SB, 'work', 'modeprobe'), provider: 'anthropic' });

  const mode = fs.statSync(store.ROOT).mode & 0o777;
  assert.equal(mode, 0o700, `store.ensure() did not tighten ROOT to 0700 (got ${mode.toString(8)})`);
});

test('#1760: the message log is created owner-only (0600), whatever the umask', () => {
  // Under a permissive umask a plain append would land 0644; the log's own create must say 0600. Remove the mode from
  // messages.js appendLog and this reds.
  const messages = require('./messages');
  assert.ok(messages.LOG.startsWith(SB), 'the message log is not in this test\'s sandbox: ' + messages.LOG);
  try { fs.unlinkSync(messages.LOG); } catch { /* fresh */ }
  const was = process.umask(0o022);
  try { messages.logHeldDropped({ id: 'm1', from: 'a', to: 'b' }); } finally { process.umask(was); }
  const mode = fs.statSync(messages.LOG).mode & 0o777;
  assert.equal(mode, 0o600, `the message log was created ${mode.toString(8)}, expected 600`);
});
