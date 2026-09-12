'use strict';

/**
 * #1760 hardening: the data root must be owner-only (0700), so a NON-default data
 * root (an AGENT_WORKFORCE_DATA / AGENT_WORKFORCE_HOME override outside macOS's
 * already-0700 ~/Library) is not readable by other local accounts. store.ensure()
 * chmods the data root 0700, and every store write goes through ensure(), so any
 * write pins the root. This root-0700 is the load-bearing traversal barrier: a
 * 0700 root blocks entry regardless of the individual files' modes. (The message
 * log/spill writes ALSO pass mode 0600 as defense-in-depth; that is a mode arg on
 * the same fs.appendFileSync/writeFileSync primitives, exercised in production.)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Pin the data root to an absolute sandbox, the way every store fixture does.
const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'storemode-1760-')));
process.env.AGENT_WORKFORCE_DATA = SB;
delete process.env.AGENT_WORKFORCE_HOME;

const store = require('./store');

test('#1760: a store write (writeProfile -> ensure) pins the data ROOT to 0700', () => {
  // ROOT is `${SB}/<app>`, a subdir mkdirSync creates under the default umask
  // (~0755). Only the chmod in ensure() makes it 0700, so this discriminates:
  // remove that chmod and the assertion goes red at the umask default.
  store.writeProfile('modeprobe', { dir: path.join(SB, 'work', 'modeprobe'), provider: 'anthropic' });
  const mode = fs.statSync(store.ROOT).mode & 0o777;
  assert.equal(mode, 0o700, `data root is ${mode.toString(8)}, expected 700 (owner-only)`);
});

test('#1760 CONTROL: ROOT is a SUBDIR of the mkdtemp sandbox, so the 0700 is ensure()\'s doing, not the temp default', () => {
  // mkdtemp makes SB itself 0700, but ROOT is `${SB}/<app>`; the discriminator is
  // that the app subdir (not SB) is 0700, which only store.ensure() produces.
  assert.equal(path.dirname(store.ROOT), SB, 'ROOT must be a subdir of the sandbox for the mode assertion to test ensure(), not the mkdtemp default');
});
