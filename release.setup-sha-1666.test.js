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

/* ---- the POST-DEPLOY half of #1666 ----------------------------------------
 * The release-side guard above cannot see the path that actually caused this.
 * The 2026-08-30 21:32 deploy was a hand-sync of one source file followed by a
 * bare deploy: release.sh never ran. tools/verify-served.sh asks PRODUCTION,
 * so it holds however the bytes got there, and it used to assert only that
 * setup.sha256 returned 200. A stale sidecar returns 200 forever.
 */
const VS = fs.readFileSync(path.join(__dirname, 'tools', 'verify-served.sh'), 'utf8');
const SIDECAR = VS.match(/check_sidecar\(\)\s*\{[\s\S]*?\n\}\n/);

function runSidecar({ setup, sidecar }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-1666-srv-'));
  try {
    if (setup !== null) fs.writeFileSync(path.join(dir, 'setup'), setup);
    if (sidecar !== null) fs.writeFileSync(path.join(dir, 'setup.sha256'), sidecar);
    /* file:// rather than a socket: curl reads it the same way and there is no
       server to deadlock against, which is the trap the #1662 file documents. */
    const script = `say() { printf '%s %s\\n' "$1" "$2"; }\nfail=0\nHOST="file://${dir}"\n${SIDECAR[0]}\ncheck_sidecar "/setup.sha256"\necho "FAIL=$fail"\n`;
    const out = execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { failed: /FAIL=1/.test(out), out };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('#1666: check_sidecar was actually extracted from verify-served.sh', () => {
  assert.ok(SIDECAR, 'could not extract check_sidecar, so the post-deploy arms measured nothing');
});

test('#1666 post-deploy: a STALE sidecar on the served site is caught', () => {
  const r = runSidecar({ setup: BODY, sidecar: `${'b'.repeat(64)}  setup\n` });
  assert.ok(r.failed,
    `the served checksum described a different installer and the sweep passed: ${r.out}`);
});

test('#1666 post-deploy: a correct pair passes', () => {
  const r = runSidecar({ setup: BODY, sidecar: `${GOOD}  setup\n` });
  assert.ok(!r.failed, `a correct serving set was reported broken: ${r.out}`);
});

test('#1666 post-deploy: an unreadable pair is refused, not counted as a match', () => {
  const r = runSidecar({ setup: null, sidecar: null });
  assert.ok(r.failed, `nothing could be read and the sweep called it healthy: ${r.out}`);
});

test('#1666 post-deploy: an UNFETCHABLE installer cannot be matched by the empty hash', () => {
  /* 🛑 THE TRAP THAT MADE ME RESTRUCTURE check_sidecar, and I only found it by
     perturbing. `curl ... | shasum` turns a FAILED fetch into
     e3b0c442...b855, the hash of empty input, which is a plausible-looking
     sha rather than an empty string. So an emptiness test on the body side is
     DEAD CODE, and a sidecar carrying that exact value would MATCH an
     installer that cannot be fetched at all and report the site healthy.
     The fetch is now checked separately from the hash, so a failed fetch is a
     failure rather than a value. Same class as the 206 in #1662: a failure
     wearing the shape of a success. */
  const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const r = runSidecar({ setup: null, sidecar: `${EMPTY_SHA}  setup\n` });
  assert.ok(r.failed,
    `an unfetchable /setup matched the empty hash and the sweep called the site healthy: ${r.out}`);
});
