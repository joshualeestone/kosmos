---
pre_challenge: true
method: challenge-loop
branch: pkg-boot-nonce-2033
diff_hash: 1d7bf1a560b397a6635675315c866cc70a6aaa77270c9f8ed636c18d331b2ebd
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T16:47:07Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero new BLOCKER/CONVENTION; its one WARNING is a deferred coverage limitation, not a code defect)
**Total findings:** 3 (0 BLOCKERs, 1 WARNING deferred, 1 CONVENTION fixed, 1 NIT fixed)
**Fixed:** 2 | **Deferred:** 1 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1 (6.0 baseline validation)
Node suite ALL PASS, worktree clean. No findings.

#### Iteration 2 (first blind review)
- [CONVENTION] install/setup.sh — the pre-existing "a second open here would be a second tab" comment was the rationale for the OLD skip; now the code does that open, so the comment argued against the current behavior. --> FIXED: rewrote it to explain WHY the skip was removed (the bare-url 403) with an explicit "do NOT re-add the skip" tripwire.
- [NIT] tools/test-install.sh — the arm exercises the direct-open branch, not the LaunchAgent branch a real .pkg uses. --> FIXED: added a HARNESS LIMIT note.

#### Iteration 3 (second blind review)
- [WARNING] install/setup.sh — the fix's real production target (a real .pkg: KOSMOS_INSTALL_PAGE=1 + KOSMOS_INSTALL_VIA=pkg reaching the open-once LaunchAgent branch) is the one path the harness cannot exercise (needs a GUI session + unset KOSMOS_OPEN_CMD). The reviewer states plainly this is NOT a defect -- the newly-reached code is unchanged. --> DEFERRED: this is the plan's stated weakest premise, a coverage limitation not a code defect. A real built-and-installed .pkg smoke test is the closing evidence and should precede WIDE ROLLOUT (0.6.27), which this is queued for -- not merged into a shipping release yet.
- Five STRENGTHs confirmed: minimal correct restructure (exactly one fi moved, sh -n + bash -n pass); ALL security gates preserved (outer open gate + seed gate untouched, seed still requires _minted_nonce && _opened so no false "repaired"); no new exposure vs curl|sh (#1979) (token off-argv, mode-600 self-removing plist, short-TTL nonce only on argv); test arm red-capable and correctly positioned last; comments accurate and em-dash-free.
**Converged** -- zero new BLOCKER/CONVENTION; the one WARNING is a deferred coverage limitation.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 2 | CONVENTION | install/setup.sh | stale "second tab" comment argued against the new behavior | FIXED | comment rewrite + tripwire |
| 2 | 2 | NIT | tools/test-install.sh | arm exercises direct-open not LaunchAgent | FIXED | harness-limit note |
| 3 | 3 | WARNING | install/setup.sh | real-pkg LaunchAgent+INSTALL_PAGE path not harness-testable | DEFERRED | plan's weakest premise; real .pkg smoke test precedes wide rollout; code unchanged |

### Deferred (surfaced, not silently dropped)
- The real-pkg LaunchAgent+INSTALL_PAGE path is not exercisable in the shell harness (needs a GUI session + unset KOSMOS_OPEN_CMD). The core regression (reaching the mint+open at all under INSTALL_PAGE=1) IS covered and red-capable; the newly-reached open code is unchanged and covered by cli.open-1957. A real .pkg smoke test should precede wide rollout in 0.6.27.

### Scope (honest, per coordination with Angel + Splinter)
This fixes the BROWSER-primary pkg-install case only. It does NOT cover app-primary users (Kosmos.app / WKWebView has its own cookie jar) -- that is a separate surface still being worked; do not read #2033 as covering the app. It is NOT the fix for the wrong-app/multi-account incident Splinter2 reported.

### Strengths
- Surface-scoped honestly; security review found no new exposure; the restructure is minimal (one fi relocated) with sh -n + bash -n passing.

### Rebase note (post-review)
Rebased onto origin/main after #2030 (server-side seed on nonce redemption) merged. The two touch
the same setup.sh open block; the conflict resolution composes them: #2030 removed the setup.sh
dispatch-seed (server seeds on redemption now), and my open-block restructure makes the pkg path
mint+open a ?boot whose REDEMPTION is what triggers #2030's server-side seed. The only delta from
the reviewed version is the seed COMMENT (updated to say "server-side on redemption (#2030)" rather
than "the setup.sh seed gates on _minted_nonce && _opened") -- comment-only; the reviewed open-block
change is unchanged. sh -n + bash -n pass on the composed file.
