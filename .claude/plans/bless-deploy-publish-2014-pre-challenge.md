---
pre_challenge: true
method: challenge-loop
branch: bless-deploy-publish-2014
diff_hash: f838952adec1c820c754910f24b719342238dfb4691b25c3fd44898f617e3eec
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T01:55:17Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes
**Total findings:** 3 (0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs)
**Fixed:** 1 | **Deferred:** 2 | **Asked (awaiting user):** 0

This branch is #2014: Baron (the release/deploy pipeline owner, the reviewer the
gate names) blesses `tools/deploy-site.sh --publish`. The change is comment-only:
it replaces the "REVIEW GATE / Do NOT run --publish until reviewed" header block
with a "--publish REVIEWED AND BLESSED" block recording what was verified and
keeping the concurrency-coordination caveat. No executable line changed.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
- Blind reviewer verdict: the bless is justified and accurate; every header claim
  maps to the code; no overclaim; diff genuinely comment-only.
- [NIT] tools/deploy-site.sh header — the phrase "against what was deployed" could
  read as a claim the served bytes are compared to the deploy output rather than
  to the local verified copy --> FIXED (commit 7d7cfbe8): reworded to "against the
  LOCAL verified copy (which equals what was deployed, absent a concurrent cut)".
- [NIT] tools/deploy-site.sh:234 — `grep -q "\"$ART\""` treats dots in `$ART` as
  regex wildcards; `grep -Fq` would be exact. Pre-existing, not introduced by this
  diff, near-zero real-world risk (greps the artifact name in its own pointer)
  --> DEFERRED: out of scope for a comment-only bless; recorded in the plan file.
- [NIT] tools/deploy-site.sh:74 — the `[ -f "$REPO/tools/verify-served.sh" ]`
  precondition is dead weight since the deploy path deliberately never invokes
  verify-served.sh (the #2014 version-skew reasoning at lines 210-217). Pre-existing
  --> DEFERRED: out of scope for a comment-only bless; recorded in the plan file.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Duplicates of prior findings (confirmed resolved/deferred):** 2
- [NIT] tools/deploy-site.sh:234 (grep -Fq) — DUPLICATE of iteration-1 NIT, already deferred.
- [NIT] tools/deploy-site.sh:74 (dead verify-served.sh precondition) — DUPLICATE of iteration-1 NIT, already deferred.
**Converged** — no new actionable findings; the blind reviewer independently confirmed
the bless is justified, accurate, comment-only, preserves the coordination caveat,
and contains no overclaim.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | NIT | tools/deploy-site.sh (header) | "against what was deployed" could misread | FIXED | 7d7cfbe8 |
| 2 | 1 | NIT | tools/deploy-site.sh:234 | grep -q vs grep -Fq (regex dots) | DEFERRED | Pre-existing; out of scope for comment-only bless |
| 3 | 1 | NIT | tools/deploy-site.sh:74 | dead verify-served.sh precondition | DEFERRED | Pre-existing; out of scope for comment-only bless |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] tools/deploy-site.sh:234 — grep -q vs grep -Fq (iteration 1, deferred pre-existing)
- [NIT] tools/deploy-site.sh:74 — dead verify-served.sh precondition (iteration 1, deferred pre-existing)

### Strengths (across all iterations)
- The diff is genuinely comment-only: filtering added/removed non-`#` lines returns
  empty; `--numstat` 14/3, all in the header block. The `--publish` executable path
  (fetch, verify_sha, honest-marker checks, .vercelignore guard, deploy,
  served_matches/served_200) is byte-unchanged. (both iterations)
- Every specific claim in the bless header maps accurately to the code and is
  honestly hedged: served_matches sha-checks each artifact AND its .sha256 sidecar
  against the LOCAL verified copy; `$ART` is sourced from live latest.json (the
  site's own version, not agent-workforce package.json); served latest.json is
  name-checked only (header says "name-checked", not "sha-checked"); win zip + /setup
  are 200-checked; the header distinguishes dry-run-EXERCISED guards from
  REVIEWED-only post-deploy served checks — no overclaim. (both iterations)
- The concurrency-coordination caveat is preserved and strengthened (do not run a
  prod deploy concurrently with a release cut populating the same dist/). (both iterations)
- The #1669 unpopulated/partial-dist hazard is genuinely prevented on the blessed
  path: fetch refuses on any curl failure (-f), verify_sha refuses on mismatch/empty,
  the honest-marker block refuses if any critical artifact/sidecar/marker was dropped,
  and the .vercelignore guard refuses if it would drop anything. Redirect stub caught
  by verify_sha; stale CDN caught by no-cache. The post-deploy served checks fail
  closed, so a latent bug raises a false alarm rather than shipping broken bytes —
  reading + a green dry run is sufficient to bless. (iteration 2)
- No test pins the header text (grep across test files returns only the script and
  plan themselves), so the wording change causes no test regression. (both iterations)

### Note (not a code finding on this diff)
The plan file also records the WINZIP precondition for the separate Windows /dist
publish work (KOSMOS_WIN_ZIP must name the win zip AND it must be committed to dist,
since the zip is git-tracked). That is operational guidance for a different card, not
a defect in this comment-only diff; captured so it is not lost.

### Validation
`yarn test` (bash tools/run-tests.sh) — full JS + shell suite — PASSED green on a
cleared box. validation-log: PASSED for stack=typescript hash=f838952adec1.
Earlier red runs were pure box contention (another agent's test-browser-run-guard.sh
#1391 tripping on a concurrent browser-checks run); confirmed environmental, not this
comment-only change.
