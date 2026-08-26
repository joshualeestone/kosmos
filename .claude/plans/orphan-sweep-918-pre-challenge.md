---
pre_challenge: true
method: challenge-loop
branch: orphan-sweep-918
diff_hash: a2b497c3b04900bc93f496d99ffb1f75d7309d77d3bc404ae16ed08eb0949368
subdir_audit: passed
timestamp: 2026-08-26T12:38:59Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 found zero new findings)
**Total findings:** 4 (1 BLOCKER, 2 WARNINGs, 1 CONVENTION)
**Fixed:** 4 | **Deferred:** 0

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
- [WARNING] install/setup.sh — The orphan-existence check `[ -d "$_orphan_home" ]` alone could not
  distinguish a genuinely deleted `KOSMOS_HOME` from one that is merely transiently unreachable
  (an unmounted volume, a network share hiccup) — the sweep runs on every uninstall, unscoped to
  the caller's own `KOSMOS_HOME`, so a false-confirmed-gone reading would sweep a live install's
  label out from under it. --> FIXED: added a second signal, `[ -d "$(dirname "$_orphan_home")" ]`
  — if the parent is also unreadable, that reads as "cannot tell" and the label is left alone.
  Also added scenario D (a genuine default-`KOSMOS_HOME` install) to `tools/test-install.sh` to
  prove the shipped loop, not just the comment reasoning, protects the single highest-stakes
  case: a real end-user's own board label.

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 0 NITs
- [WARNING] install/setup.sh — The plist-shape match `*/bin/kosmos)` could match a degenerate
  `ProgramArguments[1]` of exactly `/bin/kosmos` (no home prefix), since `*` matches zero-width —
  the resulting empty `_orphan_home` defeated BOTH refusal guards at once (`[ -d "" ]` reads
  false, and `dirname ""` is POSIX-defined as `.`, which always exists). --> FIXED: tightened the
  case pattern to require an absolute path (`/*/bin/kosmos)`). Verified live via a standalone
  bash repro both before and after the fix. Added the degenerate-plist scenario to
  `tools/test-install.sh` proving it survives the sweep untouched.

#### Iteration 3
**New findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
- [BLOCKER] install/setup.sh — The bare `_orphan_home_bin="$(/usr/libexec/PlistBuddy ...)"`
  assignment, under this file's `set -euo pipefail`, would silently abort the ENTIRE uninstall
  script mid-function the instant PlistBuddy failed to read any plist in the launch dir (missing
  key, corrupted file, non-XML) — meaning any unrelated malformed `com.kosmos.board.*.plist`
  sitting in a real user's LaunchAgents folder would crash their completely normal, healthy
  uninstall partway through, leaving their machine half-uninstalled with no error shown.
  --> FIXED: `|| _orphan_home_bin=""`, so a read failure degrades to "unrecognized shape, leave
  it alone" instead of aborting. Reproduced the crash live via a standalone `set -euo pipefail`
  repro both before and after the fix. Added a hand-crafted `com.kosmos.board.noargs.plist` (a
  valid, parseable plist with a real `Label` but no `ProgramArguments` key at all) to
  `tools/test-install.sh`, asserting `rc_ok` on the uninstall's own exit code — the assertion
  that actually proves the crash did not happen.

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 0 NITs
- [CONVENTION] .claude/plans/orphan-sweep-918.md — The plan file's Test-plan section was not
  updated after iteration 3 added the `noargs.plist` scenario, so the plan drifted from the
  implementation it was meant to describe. --> FIXED: added a bullet describing the new scenario
  and its `rc_ok` assertion.

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 0 NITs
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | install/setup.sh (orphan sweep, existence check) | Cannot distinguish deleted from transiently unreachable KOSMOS_HOME | FIXED | added parent-dir readability check + scenario D |
| 2 | 2 | WARNING | install/setup.sh (orphan sweep, plist-shape case pattern) | `*/bin/kosmos` zero-width match derives an empty, always-passing KOSMOS_HOME | FIXED | tightened to `/*/bin/kosmos)` |
| 3 | 3 | BLOCKER | install/setup.sh (orphan sweep, PlistBuddy read) | Unguarded command substitution under `set -euo pipefail` aborts the whole uninstall on any malformed plist | FIXED | `\|\| _orphan_home_bin=""` + noargs.plist regression scenario |
| 4 | 4 | CONVENTION | .claude/plans/orphan-sweep-918.md | Test-plan section stale after iteration 3's new scenario | FIXED | added bullet for noargs.plist scenario |

### NITs (non-blocking, across all iterations)

None raised across any iteration.

### Strengths (across all iterations)

- Every refusal path in the sweep defaults to "leave it alone" (unrecognized shape, transient
  unreadability, PlistBuddy read failure) — only a positively, repeatedly-confirmed-gone home is
  ever swept, directly extending this codebase's existing three-state-asymmetry convention
  (CONNECTED/NONE/UNKNOWN) into a filesystem-sweep context (iteration 1-3 reviews).
- Every WARNING and the BLOCKER were verified against a live, standalone repro of the actual
  failure mode (not just reasoned about), both before and after each fix (iterations 1-3).
- `tools/test-install.sh` scenarios share one launch dir across six cases, mirroring how
  multiple walk runs on one real Mac would coexist, rather than testing each case in isolation
  (iteration 1 review, holistic pass).
