'use strict';

/**
 * #1760 hardening: pin the data root owner-only (0700) on EVERY store write, and
 * write the message log/spill files 0600, so a NON-default data root (an
 * AGENT_WORKFORCE_DATA / AGENT_WORKFORCE_HOME override outside macOS's already-0700
 * ~/Library, or a store created by a CLI write before any board start) is not
 * readable by other local accounts.
 *
 * NOTE (honest scope): boardauth.js already chmods store.ROOT to 0700 on board
 * startup (boardauth.js:332/348), so on a running board the root is already pinned.
 * store.ensure()'s chmod extends that to ALL store-write contexts (e.g. `kosmos
 * feedback` writing a report with no board running), and the message-file 0600 is
 * the genuinely-new part. This test asserts store.ensure() TIGHTENS a loose root.
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

test('#1760: a file written with mode 0600 under the store root is owner-only (the message-log/spill mode)', () => {
  // The message log/spill writes pass { mode: 0o600 }; verify the fs semantics the
  // hardening relies on, on this platform, under the store root (which now exists).
  const f = path.join(store.ROOT, 'mode-probe.jsonl');
  try { fs.unlinkSync(f); } catch { /* fresh */ }
  fs.appendFileSync(f, '{}\n', { mode: 0o600 });
  const mode = fs.statSync(f).mode & 0o777;
  assert.equal(mode, 0o600, `a mode-0600 create landed at ${mode.toString(8)}, expected 600`);
});
