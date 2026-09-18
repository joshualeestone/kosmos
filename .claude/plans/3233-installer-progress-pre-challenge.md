---
pre_challenge: true
method: challenge-loop
branch: 3233-installer-progress
diff_hash: 05cffd8577a413ae935e3654856b1756abee395f4e09aa87d240abf9b11c9695
validation: passed
subdir_audit: passed
timestamp: 2026-09-18T07:26:54Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 11 (0 BLOCKERs, 7 WARNINGs, 2 CONVENTIONs, plus NITs)
**Fixed:** 9 | **Deferred:** 2 (NITs only) | **Asked (awaiting user):** 0
(The plan-file CONVENTION was initially deferred as out-of-scope for a handoff gate run, then FIXED at PR time: the pre-PR plan-file gate enforces it, so a plan file was added and this proof's hash recomputed to include it.)

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above (nothing had committed yet; ITER_COMMITS empty on the first pass)
- [WARNING] setup.sh:942 — bare `wait`/`kill` teardown returns non-zero (143/kill-of-dead) and would abort under set -e; isolation was extrinsic (only the `|| die` call site saved it), contradicting the block's own "fully isolated" comment --> FIXED (5f3b453): `|| true` on the success-path teardown.
- [WARNING] setup.sh:922 — unguarded `_kp_total=$(curl … | awk …)` aborts under pipefail on a failed HEAD --> FIXED (5f3b453): `|| _kp_total=""`.
- [WARNING] setup.sh:_kp_emit (self-surfaced while fixing) — the `# always returns 0` contract was false under set -e (active inside the background watcher subshell): `[ -n "$_kp_total" ] && …` returns 1 on the common empty-total case, and the `printf && mv` write could too --> FIXED (5f3b453): `case` instead of `[ -n ] &&`, and `|| true` on the write.
- [CONVENTION] .claude/plans/ — no plan file for this branch --> FIXED (47bb8f4): initially deferred, then a plan file was added at PR time because the pre-PR plan-file gate enforces it.
- [CONVENTION] setup.sh / installing.html — behavioral change with no test (CLAUDE.md: no size exemption) --> FIXED (5f3b453): added 5 mechanism tests to install.installing-page.test.js and a new tools/test-install-progress-emit-3233.sh (drives the REAL extracted _kp_emit under set -euo pipefail, evals the emitted JS), wired into test:shell.

#### Iteration 2
**Reviewer model:** sonnet (a different model from iteration 1, per the model-rotation rule)
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above (all four were about the ORIGINAL 69996747d code's isolation gaps, not iteration-1's fixes; line-reflow makes setup.sh:927 read SELF under blame, but the defect — the -m 15 value — is pre-existing, so it is counted BRANCH)
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] setup.sh:951 — curl-FAILURE-branch teardown left `kill` unguarded, unlike the success path --> FIXED (0bac806): `|| true` there too, so isolation is intrinsic on both paths.
- [WARNING] setup.sh:927 — the content-length HEAD (`-m 15`) is a second blocking round-trip that could add up to ~15s of swoosh before the download starts --> FIXED (0bac806): bounded to `-m 5` with a comment noting reachable() just succeeded on the same URL, so it answers in ~1 RTT in practice.
- [WARNING] setup.sh:948 — the background watcher had no parent-liveness bound; a hard `kill -9` of setup.sh orphans a process that rewrites install-progress.js once a second forever --> FIXED (0bac806): `while [ -f "$sentinel" ] && kill -0 "$_kp_ppid"`.
- [WARNING] installing.html / postinstall — no run clears a stale install-progress.js, so a repeat install can briefly render a leftover percentage --> FIXED (0bac806): postinstall clears it at page setup, before the page opens.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (the plan-file CONVENTION deduplicated to the iteration-1 DEFERRED entry), 3 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings; three STRENGTHs confirmed the iteration-2 fixes (watcher parent-liveness bound, both guarded teardowns, postinstall stale-clear, the injection-safe/isolated emit, and the non-vacuous tests) reviewed clean by a fresh blind model different from the one that authored them.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | setup.sh:942 | BRANCH | teardown wait/kill aborts under set -e | FIXED | 5f3b453 |
| 2 | 1 | WARNING | setup.sh:922 | BRANCH | unguarded cmd-subst aborts under pipefail | FIXED | 5f3b453 |
| 3 | 1 | WARNING | setup.sh:_kp_emit | BRANCH | "always returns 0" false under set -e | FIXED | 5f3b453 |
| 4 | 1 | CONVENTION | .claude/plans/ | BRANCH | no plan file for branch | FIXED | 47bb8f4 (plan gate enforces it) |
| 5 | 1 | CONVENTION | setup.sh / installing.html | BRANCH | behavioral change, no test | FIXED | 5f3b453 |
| 6 | 2 | WARNING | setup.sh:951 | BRANCH | failure-branch teardown unguarded | FIXED | 0bac806 |
| 7 | 2 | WARNING | setup.sh:927 | BRANCH | blocking HEAD up to 15s latency | FIXED | 0bac806 |
| 8 | 2 | WARNING | setup.sh:948 | BRANCH | orphaned watcher rewrites forever | FIXED | 0bac806 |
| 9 | 2 | WARNING | installing.html/postinstall | BRANCH | stale install-progress.js shows old % | FIXED | 0bac806 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Deferred (with reasoning, so the operator can override)
- [NIT] setup.sh:927 — the content-length HEAD is a second round-trip to a URL reachable() just fetched; a fully-async fetch (write total to a file the watcher reads) would remove even the bounded 5s worst case. Deferred as a perf refinement with near-zero practical impact (reachable() success makes it ~1 RTT); would change _kp_emit's interface.
- [NIT] installing.html:36 (reduced-motion) — `.bar.determinate>i` keeps `transition:width` which is not suppressed under `@media (prefers-reduced-motion:reduce)`. Deferred to Mona's bar visual/reduced-motion refinement (documented ownership split); a11y polish, not a mechanism defect.
- [NIT] installing.html — no `aria-valuenow`/`min`/`max` on the determinate bar. Pairs with Mona's bar-presentation refinement; deferred there.
- [NIT] setup.sh:938 / :942 — `$_kp_js.$$.tmp` name is not unique (`$$` is the parent PID in a backgrounded subshell) and a stale `.tmp` can survive an interrupted write. Safe: watcher and foreground never write concurrently (watcher is reaped before the foreground emits), the write is atomic via `mv -f`, and any stray `.tmp` lives in a cache dir and is overwritten by the next emit. Cosmetic.
- [NIT] setup.sh non-local `_kp_*` vars — harmless given the `_kp_` prefix; consistency-only.
- [NIT] installing.html:377 — first determinate reading can briefly show an empty (0%) bar before bytes climb; self-correcting within ~1s and the honest state.

### Strengths (across all iterations)
- The emit is isolated from the download/checksum/error path line-by-line, so it holds even without the `|| die` call site suspending errexit (iteration 3).
- The watcher is bounded by both a sentinel and a `kill -0` parent-liveness check; a hard kill of setup.sh cannot orphan it (iteration 3).
- The emit is injection-safe by construction: all emitted values are digit-sanitized or fixed literals; atomic tmp-then-`mv` write (iterations 1-3).
- tools/test-install-progress-emit-3233.sh extracts and drives the REAL shipped _kp_emit under the exact set -euo pipefail mode and evals the emitted JS with a stubbed window; the HTML assertions run against comment-stripped CODE so prose cannot satisfy the wiring (iterations 1-3).
- postinstall's stale-clear is correctly placed inside the console-user set -e page-setup block, guarded so it can never abort the real install (iteration 3).
