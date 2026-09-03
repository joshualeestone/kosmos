---
pre_challenge: true
method: challenge-loop
branch: staging-channel-2036
diff_hash: 8fbd2210191b2f83e1461aade280af66a3ac3c2867604c534178b4b4bb952f85
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T21:26:18Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (fresh blind review after rebasing the branch onto origin/main; the branch's
own earlier `iter-1/2/3` commits were prior in-flight work, continued here)
**Converged:** Yes (iteration 3 returned zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 8 (0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs) + 1 validation-caught guard
**Fixed:** 6 | **Deferred:** 3 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
- [WARNING] test-staging-channel-2036.sh — no test pinned that `--force` can NEVER bypass the same-bytes invariant (only the experience gate) --> FIXED (added an arm: wrong pointer sha + `--force` + a PASSING gate must still exit 1, prod pointer untouched; red-capable; commit 5934fe4f)
- [CONVENTION] `set -uo pipefail` without `set -e` --> DEFERRED: reviewer traced every critical command and confirmed each fails closed; deliberate, correct style, not a defect.
- [NIT] publish nullglob assumption --> DEFERRED: fails closed (refuses to publish).
- [NIT] promote verify->gate->copy TOCTOU --> DEFERRED: benign in the accidental-corruption threat model; matches release.sh.
- [NIT] default GATE_CMD not exercised e2e --> DEFERRED: no live board available in CI.

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] pointer-shape duplication (publish vs release.sh) --> FIXED: extracted the ONE shared writer tools/lib/write-latest-pointer.js (byte-identical to both, refuses an empty field), called by both, so they cannot diverge (commit d5645dda).
- [WARNING] gate invoked with no port --> a wrong-port HOLD on a non-16180 staging board pushes an operator toward `--force`, which bypasses the gate --> FIXED: added a `[port]` arg forwarded to the gate as arg1, documented; pinned by tests (port reaches gate; non-numeric refused) (commit d5645dda).
- [NIT] artifact/manifest from the pointer used as FS paths with no basename guard --> FIXED: reject any `/` or `..` before use; pinned by a `../evil` test (commit d5645dda).
- [NIT] misleading post-mv "did not land" message --> FIXED: reworded (latest.json is already written by then).
- [NIT] publish missing-artifact test matched the ambiguous "does not exist" --> FIXED: now matches the specific "nothing to point at" token.
- **Validation (6g) caught a real consequence:** bundle.manifest.test.js #1920 greps release.sh's source for the pointer shape (`sha256: e.KM_LJ_SHA`), which the extraction moved into the shared writer --> FIXED: relocated the shape assertions to the writer (their single source) and ADDED assertions that release.sh feeds the verified sidecar sha to the writer and writes latest.json THROUGH it -- guard preserved and strengthened (commit c51532f2).

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- [CONVENTION] `set -uo pipefail` without `set -e` --> duplicate of iteration 1's (already DEFERRED; reviewer again confirmed it is deliberate and correct, not a defect).
- [NIT] default GATE_CMD only `bash -n`'d + unquoted `$GATE_CMD` assumes no spaces in the repo path --> near-duplicate of iteration 1's NIT; non-blocking, "fine on this fleet".
**Converged** -- no new actionable findings. Six strengths confirmed the release.sh extraction is byte-identical and safe, the same-bytes invariant is airtight, `--force` cannot bypass the byte checks, the basename guard and `[port]` forwarding work, and the tests are red-capable.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | test-staging-channel-2036.sh | no `--force` vs same-bytes test | FIXED | 5934fe4f |
| 2 | 1 | CONVENTION | publish/promote | set -uo pipefail w/o set -e | DEFERRED | deliberate, fails-closed (traced) |
| 3 | 1 | NIT | publish/promote | nullglob / TOCTOU / gate-e2e | DEFERRED | benign / no live board |
| 4 | 2 | WARNING | publish + release.sh | pointer-shape duplication | FIXED | d5645dda (shared writer) |
| 5 | 2 | WARNING | promote-channel.sh | gate port not forwarded | FIXED | d5645dda ([port] arg) |
| 6 | 2 | NIT | promote-channel.sh | no basename guard | FIXED | d5645dda |
| 7 | 2 | (6g) | bundle.manifest.test.js:44 | #1920 source-grep guard followed the moved shape | FIXED | c51532f2 |
| 8 | 3 | CONVENTION/NIT | promote/publish | dupes of iter-1 | DEFERRED | reviewer-confirmed non-defects |

### NITs (non-blocking)
- Recorded above; the actionable ones (basename guard, post-mv message, test token) were fixed; the style/e2e ones deferred with reasoning.

### Strengths
- release.sh extraction is byte-identical and cannot break the cut (same shape, key order, trailing newline, KM_LJ_* interface; path resolution consistent with release.sh's own $0-relative pattern). The shared writer's empty-field refusal is strictly safer than the old inline block and can never fire in a real cut.
- The same-bytes invariant is airtight: every refusal/HOLD exits before the only atomic write to latest.json; `--force` is consulted only in the gate-exit-2 arm, so it can bypass only the experience gate, never the byte checks (pinned decisively by the wrong-sha + --force + passing-gate test).
- Tests are red-capable and non-vacuous across all three gate arms, the tamper-after-publish case, missing artifact/sidecar/manifest, non-numeric port, the basename guard, port forwarding, and the empty-field writer refusal.
