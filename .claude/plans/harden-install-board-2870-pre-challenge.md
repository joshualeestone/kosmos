---
pre_challenge: true
method: challenge-loop
branch: harden-install-board-2870
diff_hash: 4b29bc9f567c5d43fbd217a0d1c6d9688d2331b99f098b46582685bdcff18d45
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T07:52:00Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (blind passes; model rotation opus/sonnet/opus/sonnet/opus/sonnet/opus/sonnet)
**Converged:** Yes (iteration 8 surfaced zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 11 WARNINGs, 1 CONVENTION, ~16 NITs across all iterations
**Fixed:** 11 WARNINGs + 1 CONVENTION + several NITs | **Deferred:** 1 WARNING (leaf-symlink) + several NITs (documented in the plan) | **Asked:** 0

A 6.0 baseline validation failed once on box contention (an unrelated board-server test,
`server.reports-refresh-1676`/`#1649`, that passes 2/2 in isolation; no test invokes
install-board.sh) and was DEFERRED as environmental, not a defect. The final 6j validation
ran clean (0 node failures, `validation PASSED hash=4b29bc9f567c`).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 WARNING
**Self-generated:** 0 (ITER_COMMITS empty)
- [WARNING] deploy/install-board.sh — validate_dest accepted any existing dir as $DEST; the apply swap (mv-aside then rm -rf) would destroy a misconfigured KOSMOS_BOARD_LIBEXEC=$HOME / /usr / /Applications --> FIXED (require a board marker before swapping aside a populated dir)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 (the leaf-symlink finding concerned iter-1 marker code)
- [WARNING] test — every assertion drove only the dry run; the destructive swap is on --apply --> FIXED (added a swap-path regression case)
- [WARNING] install-board.sh — an existing plain-file $DEST reported a wrong-sounding "ancestor" error --> FIXED (explicit early check)
- [WARNING] install-board.sh — a leaf-symlink $DEST is validated on its resolved target while mv acts on the link --> DEFERRED (only over-refuses; never a data-loss path; resolved-path checks are required to catch a dest resolving INTO the repo)
- [CONVENTION] plan — did not list the iter-1 marker refusal --> FIXED (plan updated; stale `cd -P` fixed)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 WARNING, 3 NITs
**Self-generated:** 1 (the vacuous test was iter-2's own addition)
- [WARNING] test — the iter-2 --apply regression assertion was VACUOUS: the fake repo was not stageable, so an unguarded --apply aborted before the swap and the fixture survived either way --> FIXED (made the fake source fully stageable and drove --refresh-only, which reaches the real swap then exits before plist/launchctl; proven red-capable out of band)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 1 (the fail-open concerned iter-1 marker code)
- [WARNING] install-board.sh — the emptiness check read ls -A's OUTPUT only, so an unreadable populated dir enumerated as empty and would be swapped/deleted (fail-OPEN) --> FIXED (capture ls's exit status; fail CLOSED; proven red-capable)
- [WARNING] test — the pwd -P symlink-resolution code had no test --> FIXED (symlink-into-repo refusal + symlinked-ancestor acceptance)
- [NIT] install-board.sh — doubled-leading-slash false-accept (symlink-to-root ancestor) --> FIXED (collapse leading slashes)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 1 WARNING, 1 NIT
**Self-generated:** 1 (the marker was iter-1 code)
- [WARNING] install-board.sh — the marker was a single top-level server.js, so a user's own Node project would be classified as a board and destroyed --> FIXED (require server.js AND an engine/ dir)
- [NIT] install-board.sh — git-worktree refusal fails open if git absent --> documented

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** 1 (the -e marker was loop code)
- [WARNING] install-board.sh — the server.js marker used -e, so a directory named server.js/ (plus engine/) would be misclassified as a board and destroyed --> FIXED (-f, matches "the plist runs it"; proven red-capable)
- [WARNING] test — dot-component tests used only mid-string dots, which match even without the /$DEST/ wrapping; start/end dots untested --> FIXED (trailing '.' and '..' cases; proven red-capable)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 1 (the inaccurate comment was iter-6's own addition)
- [WARNING] install-board.sh — the git fail-open comment claimed "a git-less box cannot run --apply at all", which is false (the source-clean check takes an else branch and proceeds) --> FIXED (dropped the false claim; kept the accurate reason -- the data-critical refusals use pwd -P/file tests, not git). The loop catching its own prior comment error (convention #5 / kosmos#120 class).

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKER/WARNING/CONVENTION, 2 NITs
**Self-generated:** 0
**Converged** — the reviewer found no false-accept that loses data, no false-refuse of a legitimate install, and no vacuous test. Addressed one NIT (documented the TOCTOU backstop at the `-d "$_dest_real"` check); the other NIT (the glob-metachar test is a weak control) is an accepted coverage gap since the quoting is verified correct.

### Final Ledger (WARNING/CONVENTION)

| # | Iter | Category | Origin | Description | Status |
|---|------|----------|--------|-------------|--------|
| 1 | 1 | WARNING | BRANCH | data-loss: any existing dir swapped/deleted | FIXED |
| 2 | 2 | WARNING | BRANCH | test drove dry-run only, not the swap path | FIXED |
| 3 | 2 | WARNING | BRANCH | existing plain-file $DEST wrong message | FIXED |
| 4 | 2 | WARNING | SELF | leaf-symlink dest validated on target | DEFERRED |
| 5 | 2 | CONVENTION | BRANCH | plan did not list the marker refusal | FIXED |
| 6 | 3 | WARNING | SELF | iter-2 --apply regression test was vacuous | FIXED |
| 7 | 4 | WARNING | SELF | emptiness check failed OPEN on unreadable dir | FIXED |
| 8 | 4 | WARNING | BRANCH | pwd -P symlink resolution untested | FIXED |
| 9 | 5 | WARNING | SELF | marker too weak (server.js alone) | FIXED |
| 10 | 6 | WARNING | SELF | server.js marker used -e (dir misclassified) | FIXED |
| 11 | 6 | WARNING | BRANCH | dot-component wrapping untested (start/end) | FIXED |
| 12 | 7 | WARNING | SELF | git fail-open comment asserted false behavior | FIXED |

### Deferred (with reasoning)
- [WARNING] leaf-symlink dest (iter 2): mv acts on the leaf symlink, not its target, so it is never a data-loss path; only over-refuses (safe). Resolved-path checks are required to catch a dest resolving INTO the repo.
- NITs recorded in the plan's "Deliberate calls": ls -A (macOS-only target); empty-$DEST guard (unreachable given the :- default, kept as defense-in-depth); literal `//` env var (macOS collapses; refused anyway); raw-string root check (symlink-to-root caught by the marker backstop); in-suite mechanical red-capability of the destructive test (would need a guard-disable knob in production -- worse hazard; proven out of band instead); .DS_Store over-refuse (safe direction).

### Strengths (recurring across passes)
- validate_dest runs in the MAIN shell (not a $(...) capture), so fail()'s exit 1 is terminal.
- Path-prefix comparisons quote the variable half and leave the trailing * bare (repo-boundary-safe AND glob-metachar-literal).
- pwd -P canonicalization catches a dest that resolves into the repo via a symlink alias.
- The --refresh-only test is genuinely load-bearing (a stageable fake source; removing the guard deletes the fixture file byte-for-byte).
- Fail-closed enumeration (captures ls's exit status), server.js+engine/ marker via -f -d.

### Notes
Every fix was proven red-capable out of band (neuter the guard on a scratch copy, confirm the dangerous input is then accepted / the fixture destroyed). The change touches no rendered web/ surface, so the browser-check gate does not apply. It is a `.sh` test wired into `test:shell`, so it does not perturb run-tests.sh's `*.test.js` count guard.
