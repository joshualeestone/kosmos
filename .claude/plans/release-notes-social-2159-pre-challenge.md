---
pre_challenge: true
method: challenge-loop
branch: release-notes-social-2159
diff_hash: e8feb56f21790131b517cf07ab1d08af0a817dea2e0653b48eae91ccbff27fb1
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T21:47:04Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5: zero BLOCKER/WARNING/CONVENTION - a clean pass)
**Total findings:** 0 BLOCKER, ~7 WARNINGs, several NITs
**Fixed:** all WARNINGs | **Deferred:** the NITs (documented) | **Asked:** 0

### Per-Iteration Breakdown
- **iter 1** [WARNING x3] board-shape-not-live-tested residual (documented); both-providers-required (by design); + NITs --> per-platform idempotency added, red-capable autopost arm, PORT numeric guard, port-forward test arm. Also: 2nd-round design.
- **iter 2** [WARNING] truncation arm counted bytes (C-locale false-fail) --> node code-point count; [CONVENTION] plan em dashes --> stripped; NITs deferred.
- **iter 3** [WARNING] a generic FALLBACK note could auto-publish --> **Gate 5b** (a degraded fallback note never auto-publishes) + red-capable arm; [NIT] entity decode added; NITs deferred.
- **iter 4** [WARNING x2] `&#34;` mis-decoded to apostrophe (--> double-quote); a LITERAL U+2014 in prose survived (--> final literal-dash->hyphen replace + hex dash entities). Both spot-check-verified.
- **iter 5** CONVERGED - clean pass. [NIT] hex/named curly-quote entities undecoded (cosmetic; the safety-critical em-dash IS covered in literal/decimal/hex/named forms) --> DEFERRED.

### Validation
- Full `validation_log_run_or_skip` PASSED (hash below): JS suite + all test:shell arms incl. the new test-post-release-notes.sh (11 arms). (Earlier reds during iterations were browser-run-guard fleet contention on an untouched file - green in isolation.)

### The safety property (repeatedly verified across 5 reviews)
No path auto-publishes without ALL of: prod release + --publish + KOSMOS_SOCIAL_AUTOPOST=1 + both creds + the one-time approval marker + a REAL versions-page extraction (not the generic fallback) + not-already-announced (per-platform). Every dry-run/HOLD path is `write_preview; exit 0` and never marks. The publish seam refuses (exit 3) rather than silently succeeding when unwired. Today (no creds, no marker, autopost unset) the only reachable path is dry-run. Wiring: prod CUT calls --publish after deploy; PROMOTE previews only; both best-effort so a hook non-zero never fails a shipped release. No em dash (U+2014) in any added line.

### Deferred NITs
- hex/named curly-quote + ellipsis entities undecoded (cosmetic; hand-authored notes use literal chars; the em-dash hard rule is fully covered).
- `cut -c` byte-split under a C locale (rare; the dash mapping removes the common multibyte offender; notes are ASCII).
- the 4 pre-existing em dashes in release.sh header comments are outside this diff.
