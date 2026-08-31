'use strict';
/* #1666: the published checksum must describe the published installer.
 *
 * release.sh copies `setup` and `setup.sha256` out of dist/ independently and
 * then proves only that `setup` IS install/setup.sh. Nothing proved the
 * sidecar describes it, so a stale checksum shipped silently: a hand-sync of
 * the installer on 2026-08-30 21:30 left the sha from the 10:28 cut, and
 * production served an installer whose published checksum was a release
 * behind. Anyone verifying before piping to a shell got a tamper-looking
 * failure; anyone piping straight to sh saw nothing, which is why it went
 * unreported.
 *
 * The guard is EXTRACTED from tools/release.sh and run under bash, so this
 * pins the shipped text rather than a copy that could drift from it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SRC = fs.readFileSync(path.join(__dirname, 'tools', 'release.sh'), 'utf8');
const GUARD = SRC.match(/_setup_have="\$\(awk[\s\S]*?\n\}\n/);

/* Runs ONLY the extracted guard against a throwaway $SITE. Returns the exit
   code, so a must-fail arm is a real refusal rather than an absence. */
function runGuard({ setup, sidecar }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1666-'));
  try {
    if (setup !== null) fs.writeFileSync(path.join(dir, 'setup'), setup);
    if (sidecar !== null) fs.writeFileSync(path.join(dir, 'setup.sha256'), sidecar);
    /* 🛑 NO `set -e` HERE, DELIBERATELY. With it, the absent-sidecar arm went
       green because the failing `awk` aborted the script, NOT because the
       guard refused: measured by deleting the comparison entirely and
       watching that arm stay green. An arm that passes when the thing it
       tests is gone is not evidence. Without `set -e` the guard's own
       emptiness check is the only thing that can refuse. */
    const script = `SITE="$1"\n${GUARD[0]}\necho GUARD_PASSED\n`;
    try {
      const out = execFileSync('bash', ['-c', script, 'bash', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const BODY = '#!/bin/sh\necho installer\n';
const GOOD = execFileSync('shasum', ['-a', '256'], { input: BODY, encoding: 'utf8' }).split(' ')[0];

test('#1666: the guard was actually extracted from release.sh', () => {
  assert.ok(GUARD, 'could not extract the guard from tools/release.sh, so this file measured nothing');
});

test('#1666: a checksum that does NOT describe the installer is refused', () => {
  const r = runGuard({ setup: BODY, sidecar: `${'b'.repeat(64)}  setup\n` });
  assert.notEqual(r.code, 0,
    'a stale sidecar shipped: this is the exact 2026-08-30 defect, where the published checksum '
    + 'described the previous release and every cautious user got a tamper-looking failure');
});

test('#1666: a matching pair passes, so the guard did not just become a wall', () => {
  const r = runGuard({ setup: BODY, sidecar: `${GOOD}  setup\n` });
  assert.equal(r.code, 0, `a correct pair was refused, which would block every release: ${r.out}`);
});

test('#1666: an ABSENT sidecar is refused, not silently passed', () => {
  /* 🛑 The trap this arm exists for: without the emptiness checks both sides
     are the empty string and compare EQUAL, so the guard passes on a missing
     file. Two empties agreeing is not a match. */
  const r = runGuard({ setup: BODY, sidecar: null });
  assert.notEqual(r.code, 0, 'a missing setup.sha256 passed, because empty equals empty');
});

test('#1666: an EMPTY sidecar is refused too', () => {
  const r = runGuard({ setup: BODY, sidecar: '' });
  assert.notEqual(r.code, 0, 'an empty setup.sha256 passed, because empty equals empty');
});

test('#1666: BOTH files missing is refused, because two empties are not a match', () => {
  /* 🛑 THIS is the arm the emptiness checks exist for, and the only one that
     proves they earn their place. An absent or empty SIDECAR is already caught
     by the comparison alone, because the installer still hashes to something.
     But `release.sh` runs WITHOUT `set -e`, so a failed `cp` leaves BOTH files
     absent, both sides become the empty string, and a bare equality test
     PASSES on the exact state it exists to prevent.
     Measured: with the emptiness checks removed, every other arm here stays
     green and only this one goes red. I wrote those checks before I had an
     arm that needed them, which is a guard justified by argument rather than
     by measurement until this test existed. */
  const r = runGuard({ setup: null, sidecar: null });
  assert.notEqual(r.code, 0,
    'a release with NO installer and NO checksum passed the guard, because empty equals empty');
});
