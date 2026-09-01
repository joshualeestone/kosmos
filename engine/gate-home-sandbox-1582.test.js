'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

/* kosmos#1582: every release cut wired a frozen-export temp hook path into the REAL
 * shared ~/.claude/settings.json, killing report-hook reporting for all 18 agents.
 *
 * Root cause (diagnosed read-only 2026-08-30): the install gate (tools/test-install.sh)
 * sandboxes KOSMOS_HOME but not the report-hook's TARGET home. setup.sh's hook-wiring
 * resolves its target settings files through `accounts.HOME_FOR_TEST` = `homeDir()` =
 * `AGENT_WORKFORCE_HOME || os.homedir()`. With AGENT_WORKFORCE_HOME unset, homeDir()
 * fell back to the REAL $HOME, so the gate wrote its ephemeral sandbox hook path into
 * the real shared settings.json -- dead the instant $SB was deleted.
 *
 * Fix: test-install.sh now exports AGENT_WORKFORCE_HOME="$SB/home" alongside
 * KOSMOS_HOME, so the wiring targets the sandbox's own settings.json and the real
 * shared file is never touched. #1634's reporthook refuse-guard is the complementary
 * defense (it permits an ephemeral script in an ephemeral settings file).
 *
 * These tests are READ-ONLY: they build the exact target list setup.sh builds and
 * assert on the PATHS. They never call ensureWired, so no settings.json is written.
 *
 *   node --test engine/gate-home-sandbox-1582.test.js
 */

const accounts = require('./accounts');

const REAL_HOME = os.homedir();
const REAL_DEFAULT_SETTINGS = path.join(REAL_HOME, '.claude', 'settings.json');

// The exact target list the setup.sh hook-wiring block builds (install/setup.sh):
//   const home = accounts.HOME_FOR_TEST;
//   const targets = [home/.claude/settings.json, ...non-default accounts' settings.json]
function wiringTargets() {
  const home = accounts.HOME_FOR_TEST;
  return [path.join(home, '.claude', 'settings.json')]
    .concat(accounts.list().filter((a) => !a.isDefault).map((a) => path.join(a.dir, 'settings.json')));
}

function withEnv(val, fn) {
  const prev = process.env.AGENT_WORKFORCE_HOME;
  try {
    if (val === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = val;
    return fn();
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = prev;
  }
}

test('#1582: with AGENT_WORKFORCE_HOME sandboxed (what test-install.sh now sets), NO wiring target is the real shared settings.json', () => {
  const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-1582-'));
  try {
    const sbHome = path.join(SB, 'home');
    withEnv(sbHome, () => {
      assert.equal(accounts.HOME_FOR_TEST, sbHome, 'HOME_FOR_TEST must follow AGENT_WORKFORCE_HOME');
      const targets = wiringTargets();
      assert.equal(targets[0], path.join(sbHome, '.claude', 'settings.json'), 'the default target is the sandbox settings.json');
      for (const t of targets) {
        assert.notEqual(t, REAL_DEFAULT_SETTINGS,
          'a wiring target is the REAL ~/.claude/settings.json -- the cut would poison the shared file (#1582): ' + t);
        assert.ok(t.startsWith(SB), 'every wiring target must be under the sandbox: ' + t);
      }
    });
  } finally {
    fs.rmSync(SB, { recursive: true, force: true }); // no leaked temp dir per run
  }
});

test('#1582 CONTROL: WITHOUT the sandbox var (the pre-fix state), the default target IS the real shared settings.json', () => {
  // This is the defect. It proves the sandbox var is exactly what redirects the
  // target off the real home -- so the test above is not vacuously passing. Read-only:
  // it only computes the path, it does not write it.
  withEnv(undefined, () => {
    const home = accounts.HOME_FOR_TEST;
    assert.equal(home, REAL_HOME, 'without the var, HOME_FOR_TEST is the real home (os.homedir())');
    assert.equal(path.join(home, '.claude', 'settings.json'), REAL_DEFAULT_SETTINGS,
      'the pre-fix gate targeted the REAL shared settings.json; the fix is test-install.sh exporting AGENT_WORKFORCE_HOME="$SB/home"');
  });
});

test('#1582: test-install.sh exports AGENT_WORKFORCE_HOME="$SB/home" alongside KOSMOS_HOME (the actual fix)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'test-install.sh'), 'utf8');
  // Match the var + sandbox value on an export line, tolerant of order (KOSMOS_HOME
  // and AGENT_WORKFORCE_HOME can be in either order, or on separate export lines) so
  // a correctness-preserving reorder does not false-fail; still red-capable (reverting
  // the fix removes the assignment entirely).
  assert.match(src, /^\s*export\b[^\n]*\bAGENT_WORKFORCE_HOME="\$SB\/home"/m,
    'test-install.sh must export AGENT_WORKFORCE_HOME="$SB/home" so the gate sandboxes the hook-wiring target home (#1582)');
});
