---
pre_challenge: true
method: challenge-loop
branch: stale-tunnel-3884
diff_hash: 52ef1c1c18ae0ee536ae6f2d6ea8ead99775312174ff580150257642e2031e66
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T07:39:20Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (fresh blind reviewers)
**Converged:** Yes. Round 3 found no BLOCKER or WARNING; its three NITs are applied.
**Validation (this HEAD, rebased onto origin/main):** tools/test-connector-currency-3884.sh 17/17 under bash AND zsh; test-connector-provenance 0 failures; bash -n tools/release.sh ok.

### Per-Iteration Breakdown

#### After the PR opened
- [WARNING] CI: three tools.release-gate.test.js arms stopped at the new step 1d (their sandbox has no connector or relay) --> FIXED (a current relay + connector fixture, so the check RUNS and passes); full yarn test 9736/0 + test:shell green locally

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 5 NITs
- [WARNING] `git fetch origin main` on a clone whose refspec does not cover main updates only FETCH_HEAD: stale origin/main, false green --> FIXED (explicit refspec; arm red-checked against the old fetch)
- [NIT] build script is a build input --> FIXED
- [NIT] tests-only changes forced a rebuild --> FIXED (excluded; tested both ways)
- [NIT] shallow clone blamed on an unpushed commit --> FIXED
- [NIT] fetch could hang on a credential prompt --> FIXED (GIT_TERMINAL_PROMPT=0)
- [NIT] no arm for a non-main checkout --> FIXED (combined with the narrowed-refspec arm)

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 4 NITs
- [WARNING] a word-split string input list is ONE pathspec under zsh: matches nothing, stale reads CURRENT (fail open) --> FIXED (array; test runs under zsh; old lib red under zsh, 8 arms)
- [NIT] rebuild hint did not say to pull main first --> FIXED
- [NIT] wiring arm did not require || exit 1 --> FIXED
- [NIT] plan count stale --> FIXED
- [NIT] time of check vs use --> DOCUMENTED as the weakest premise

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 3 NITs
- [NIT] hint command not pasteable (unquoted :(exclude)) --> FIXED
- [NIT] a connector ahead of main called "stale" --> FIXED (worded as ahead/off main)
- [NIT] wiring arm could match a later || exit 1 --> FIXED (same or next line; red-checked)
