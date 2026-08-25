---
pre_challenge: true
method: challenge-loop
branch: install-gate-624
diff_hash: c369dbb3c28d7c1fdde8e5653ec7c17c31bc0cab74403c713d5d7b778a470179
subdir_audit: passed
timestamp: 2026-08-25T02:21:22Z
iterations: 2
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** No (stopped at the bound after iteration 2; see below)
**Total findings:** 15 (1 BLOCKER, 6 WARNINGs, 2 CONVENTIONs, 6 NITs)
**Fixed:** 1 BLOCKER + 6 WARNINGs + 2 CONVENTIONs + 4 NITs | **Deferred:** 2 NITs (recorded)

**Why stopped rather than converged:** two rounds by design for a release-path change tonight (the cut is waiting on this and on the bridge fix found while finishing it). Round 1 found the placement blocker; round 2's warnings were the control's missing tarball-only half and a message overclaim, both fixed with controls. After each round: the gate itself 75/75 in 23 seconds, the control 0 failures (three runs: untouched green, staged tree broken red at the install, tarball broken red at the download path), yarn test 1959/1959, audit clean, and the gate's disk use measured (277 MB peak, returned). Bounded on purpose (Angel).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 4 WARNINGs, 1 CONVENTION, 3 NITs
- [BLOCKER] release.sh:274 — the gate ran AFTER step 4 had copied the plain pair, the versioned pair and latest.json into the site dist: a failed bundle sat under the plain name (the export carries it by name) and the re-run hit the versioned-name refusal --> FIXED (7ae0b3f): the gate runs right after the build, before any copy
- [WARNING] test-install.sh:235 — a skipped block read as a pass in gate mode --> FIXED: a skipped block is exit 1 in gate mode
- [WARNING] release.sh:290 — the gate log lived under BUILD_ROOT, removed by the trap before anyone read it --> FIXED: a bare mktemp
- [WARNING] release.sh:295 — grep | sed aborted under set -e on a log with no matching line --> FIXED: a tail fallback
- [WARNING] control:42 — the repack changed the tarball's member shape (./app vs app) --> FIXED: repacked with the built shape, asserted
- [CONVENTION] package.json — the control script had no bash -n in test:shell --> FIXED
- [NIT] empty summary in the control's message --> FIXED (FAIL-count fallback); settle could not tell quiet from "could not look" --> FIXED (lsof presence); the tmux-pair refusal did not say how to get the pair --> FIXED

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] control:47 — the tarball half of the defect was never reached (the staged-tree failure stops the harness first), so the repack proved nothing --> FIXED (this iteration): a third copy with only the tarball broken, red asserted at the download-path install with the staged-tree install still passing
- [WARNING] release.sh:264 — "Nothing was copied to the site" was false when 3c had already placed the pkg triple --> FIXED: "no bundle was copied", and the triple named when PKG_PUBLISHED=1
- [CONVENTION] plan — silent on the other-account launcher fix the diff ships --> FIXED
- [NIT] comment said || true where the code tails --> FIXED; the no-summary fallback asserted "stopped at the broken install" before the check --> FIXED (count only)
- Also this iteration: a disk guard (refuse under 2 GB free, name the disk) after Splinter's finding that the full harness's fresh homes each pull a 345 MB Claude Code install; measured that gate mode never reaches those blocks (277 MB peak).
**Stopped at the bound** (see the summary).

### Final Ledger
| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | release.sh:274 | gate ran after the site-dist copies | FIXED | 7ae0b3f |
| 2 | 1 | WARNING | test-install.sh:235 | skipped block read as pass in gate mode | FIXED | 7ae0b3f |
| 3 | 1 | WARNING | release.sh:290 | gate log removed by the trap | FIXED | 7ae0b3f |
| 4 | 1 | WARNING | release.sh:295 | grep|sed aborted under set -e | FIXED | 7ae0b3f |
| 5 | 1 | WARNING | control:42 | repack changed the member shape | FIXED | 7ae0b3f |
| 6 | 2 | WARNING | control:47 | tarball half never reached | FIXED | iteration 2 |
| 7 | 2 | WARNING | release.sh:264 | red message overclaimed | FIXED | iteration 2 |

### NITs (non-blocking, across all iterations)
- Deferred: settle's vacuous pass when lsof errors silently (bounded, never hangs); the summary grep's dependence on the harness's summary wording (the FAIL count fallback covers a missing line).

### Strengths (across all iterations)
- The control is a real control: untouched copy green first, both halves of the defect red at the pass that owns each, the red names the install (both rounds).
- The other-account launcher pass sandboxes HOME in both legs, so the harness no longer runs the operator's real kosmos open (both rounds).
- exit inside summary_and_exit, the release reading the gate through an if subshell, a skipped block red in gate mode (round 2).
