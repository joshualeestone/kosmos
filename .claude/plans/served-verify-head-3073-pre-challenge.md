---
pre_challenge: true
method: challenge-loop
branch: served-verify-head-3073
diff_hash: 105915a2f6d28032ca1783093262e22fc963acb6a559c806021a8ddeebef56e8
validation: passed
subdir_audit: passed
timestamp: 2026-09-15T08:06:57Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 surfaced zero BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
**Fixed:** 5 | **Deferred:** 0 | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 (ITER_COMMITS empty on the first reviewer pass; 6.0 passed clean)
- [WARNING] served-verify.sh / plan — the "never-worse / correctness is unconditional" claim overstated; the real residual is the HEAD/GET-agreement assumption (a server could answer HEAD with a clean 200+non-html while GET would refuse) --> FIXED (31e18080b): documented that residual honestly in the plan's weakest-premise section and the code comment; bounded (byte integrity is verified locally, and the realistic #1667 SSO shape returns html/empty-CT on both verbs).
- [NIT] served-verify.sh — on a fallback the function now does HEAD then GET (two round-trips) --> no change: net win for HEAD-supporting CDNs; a HEAD-less server pays one wasted header round-trip. Acceptable tradeoff.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 0 NITs
**Self-generated:** 1 (the SSO CONVENTION cites served-verify.sh:306, a line iteration 1's fix wrote; the two WARNINGs cite BRANCH lines)
- [WARNING] served-verify.sh — the HEAD probe reused the GET's full timeout budget (10s/30s), so fallback paths pay both back-to-back (~doubles worst-case time-to-refuse); the file's own _served_verify_redirect_note uses a tighter diagnostic budget --> FIXED (0146eb843): tightened the HEAD probe to 5s/10s so a slow HEAD falls through fast; worst-case grows by 10s, not another 30s.
- [WARNING] test — no test exercised the fast path THROUGH A REDIRECT (HEAD 302 -> clean 200), leaving curl's HEAD-follows-302 semantics unverified --> FIXED (0146eb843): added a redirect arm; empirically verified `curl -sSLI -L` follows a 302 with HEAD (not GET) and asserted HEAD-only/no-GET on the redirect target via request-method logging.
- [CONVENTION] served-verify.sh:306 — the "#1667 SSO wall returns text/html on BOTH verbs" claim was stated as settled fact but is unmeasured on HEAD specifically; the file's convention distinguishes MEASURED from reasoned --> FIXED (0146eb843): softened to "expected/believed, not measured against a real SSO wall on HEAD".

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 1 (the RFC line cited was written by iteration 1's fix)
- [WARNING] plan / comment — "RFC 9110 requires it" overstated header-mirroring on HEAD; RFC 9110 §9.3.2 makes it a SHOULD (and permits omitting representation headers on HEAD). Code is defensive (empty-CT falls through, tested) so it is a prose-accuracy issue --> FIXED (f055112e1): softened both the plan and the comment to "SHOULD per §9.3.2, not a MUST".
- [NIT] served-verify.sh:316 — the HEAD probe suppresses its own stderr while the GET surfaces it; deliberate and correct, but not narrated --> addressed at iteration 4 (raised again there).

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
**Converged** -- five STRENGTHs: never-worse design verified end to end (the HEAD path only ever `return 0` on an unambiguous success or falls through, preserving every deploy-site.sh caller rc), POSIX/dash-clean parsing with distinct HEAD-path vars, the test is red-capable and non-vacuous (method logging + a GET-would-have-served control), the tighter timeout breaks no correctness case, and the plan/comments now match the code exactly (residual, RFC SHOULD, and the not-measured-on-a-real-SSO-wall admission all accurately hedged). The one CONVENTION-tagged item was a positive ("no over- or under-statement found").
- [NIT] served-verify.sh:317 — the deliberate HEAD-probe stderr-suppression asymmetry is not narrated in the comment, unlike the file's convention --> FIXED (7cf8e8220): added a one-line note explaining why the probe suppresses stderr (optimistic; degrades silently to the GET, which owns the diagnostic). Twice-flagged (iterations 3 and 4); addressed as final polish, no behavior change.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | served-verify.sh / plan | BRANCH | "correctness unconditional" overstates; HEAD/GET-agreement is the real residual | FIXED | 31e18080b |
| 2 | 1 | NIT | served-verify.sh | BRANCH | two round-trips on fallback | no change | acceptable tradeoff |
| 3 | 2 | WARNING | served-verify.sh | BRANCH | HEAD probe reused GET's full timeout budget (doubles worst-case) | FIXED | 0146eb843 (5s/10s) |
| 4 | 2 | WARNING | test | BRANCH | no redirect fast-path test | FIXED | 0146eb843 (verified curl HEAD-follows-302) |
| 5 | 2 | CONVENTION | served-verify.sh:306 | SELF | SSO-on-HEAD claim stated as measured fact | FIXED | 0146eb843 (hedged) |
| 6 | 3 | WARNING | plan / comment | SELF | "RFC 9110 requires" overstates (it is a SHOULD) | FIXED | f055112e1 |
| 7 | 3 | NIT | served-verify.sh:316 | SELF | stderr-suppression asymmetry not narrated | FIXED | 7cf8e8220 |
| 8 | 4 | NIT | served-verify.sh:317 | SELF | (same as #7, re-raised) | FIXED | 7cf8e8220 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] served-verify.sh — two round-trips on a fallback (iteration 1, no change; acceptable).
- [NIT] served-verify.sh — stderr-suppression asymmetry not narrated (iterations 3 & 4, FIXED at 7cf8e8220).

### Strengths (across all iterations)
- Never-worse design verified end to end: the HEAD path only ever returns 0 on an unambiguous success or falls through to the unchanged GET; every deploy-site.sh caller rc is preserved (iterations 1, 3, 4).
- #1667 preservation is real and tested: html-on-HEAD (direct or via a 302 that -L follows to a login page) falls through to the GET, which keeps the #1667 message and redirect note (iterations 1, 2, 4).
- POSIX/dash-clean: `sh -n`/`dash -n` pass; empty content-type collapses to '' and is rejected as ambiguous; HEAD-path vars are distinct from GET-path vars (iterations 3, 4).
- The isolated test is red-capable and non-vacuous: request-method logging asserts HEAD-only/no-GET, backed by a control proving the skipped GET would have served a real body (iterations 1, 2, 3, 4).
- The frozen tools/test-served-verify.sh is untouched and stays green (103/103), a HEAD to its do_GET-only mock 501s and falls through to GET (all iterations).

### Note on the final gate
The first 6j run failed on a single unrelated test (engine/create.test.js "adopts a healthy agent",
`spawnSync /bin/bash ETIMEDOUT` at 21s) -- a load-contention timeout, not this change (comment-only
to served-verify.sh, a different subsystem). Confirmed a flake: the test passes in isolation in ~2.6s,
and the suite's own #704/#708 diagnostic named the shared board + load as the cause. The full
validation was re-run and PASSED cleanly (hash 105915a2f6d2).
