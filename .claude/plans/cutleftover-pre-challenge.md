---
pre_challenge: true
method: challenge-loop
branch: cutleftover
diff_hash: df13246f3483dfea2a0d523b03cd682fba6df9f7fc6c68ef3b50fb5a6445272a
validation: passed (full suite through queued-heavy on 186c32f950: node 29219 tests, 28695 pass, 0 fail, 524 skipped; shell 4 shards all green; release-leftovers-8562 all passed. The first run (on c0ff17f973) went red on one test, the #8195 pipefail ratchet, fixed in 186c32f950 with no behaviour change)
subdir_audit: passed (no CLAUDE.md changed)
timestamp: 2026-11-15T22:32:46Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round review cap (Splinter's usage rule, 2026-10-22: past 8 rounds only a BLOCKER keeps the loop going). Round 8 found no BLOCKER; its two WARNINGs and four NITs are carried on kosmos#8563.
**Total findings:** 1 BLOCKER, 15 WARNINGs, 0 CONVENTIONs, many NITs
**Fixed:** 13 | **Deferred (decided, in the plan):** 2 | **Carried (review cap):** 2 | **Asked:** 0

After round 8, one commit (186c32f950) answered the full suite's #8195 ratchet: pipelines ending in an early-stopping reader (`| head`) in the lib and the test became a bash regex, parameter expansions and `grep -m1`. Behaviour unchanged; the lib's tests, 5471 and the ratchet pass.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [BLOCKER] tools/lib/release-leftovers.sh:50 - "not a checksum" read as never served, so a timeout or 5xx on the version's own read moved a served version's files --> FIXED (8ae7431e78: exact 404 required, both controls)
- [WARNING] Linux manifest committed by an aborted cut's 7b refused at 4b two hours in --> FIXED (8ae7431e78, refused at 1g)
- [WARNING] "served now" is not "ever served" (reverted and pruned to 404) --> FIXED (8ae7431e78, served marker at step 8)
- [WARNING] docs said the host answers 200 for any name (it answers 404) --> FIXED (8ae7431e78)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] marker silently not written in a linked worktree --> FIXED (852ff438fb, git rev-parse; 3929d4c0fe, common dir)
- [WARNING] a 404 right after a deploy that may still land --> FIXED then REPLACED (852ff438fb age wait; removed in 3929d4c0fe, see iteration 5)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 2 of the above
- [WARNING] a deploy in flight when 1g looked, or one that landed after cleanup, still published over --> FIXED (635b0eff56, step-8 guard before vercel)
- [WARNING] the age wait timed from the wrong event --> FIXED (step-8 guard is the protection)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] no leftovers: 1g reads nothing, so a landed version is refused only after the build --> DEFERRED (ff7623c7b8: an early read made every cut start and the suite's nested cuts hit production; cost named in the plan)
- [WARNING] first Linux cut has no Linux pointer for the positive control --> FIXED (ff7623c7b8, Mac pointer stands in)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 7 NITs
**Self-generated:** 1 of the above
- [WARNING] the one-hour wait gives false comfort (mtime set at 4b) --> FIXED (3929d4c0fe, removed; guard named as the protection; retry hook added)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] ls-files exit code safe only because the caller uses `||` --> FIXED (39a8737be5, rc=0; ... || rc=$?, set -e arm)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] the guard ran only after 7b had committed over a served manifest --> FIXED (c0ff17f973, guard before 7b's site commit)
- [WARNING] three quick reads threw away a two-hour build on a blip --> FIXED (c0ff17f973, 12 reads x 10 s)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above
- [WARNING] a served version's committed Mac manifest overwritten in the working tree before 7b refuses --> CARRIED to #8563
- [WARNING] the refusal at 7b says the site commit "stays pushed" --> CARRIED to #8563
**Stopped:** review cap, no BLOCKER open.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools/lib/release-leftovers.sh:50 | SELF | transient failure read as never served | FIXED | 8ae7431e78 |
| 2 | 1 | WARNING | tools/lib/release-linux.sh:104 | BRANCH | committed Linux manifest refused at 4b | FIXED | 8ae7431e78 |
| 3 | 1 | WARNING | tools/lib/release-leftovers.sh:54 | SELF | served now vs ever served | FIXED | 8ae7431e78 |
| 4 | 1 | WARNING | docs/releasing.md:453 | SELF | host status claim false | FIXED | 8ae7431e78 |
| 5 | 2 | WARNING | tools/lib/release-leftovers.sh:26 | SELF | marker lost in a worktree | FIXED | 3929d4c0fe |
| 6 | 2 | WARNING | tools/lib/release-leftovers.sh:81 | SELF | deploy may still land | FIXED (replaced) | 635b0eff56 |
| 7 | 3 | WARNING | tools/lib/release-leftovers.sh:102 | SELF | in-flight deploy | FIXED | 635b0eff56 |
| 8 | 3 | WARNING | tools/release.sh:1022 | SELF | landed after cleanup | FIXED | 635b0eff56 |
| 9 | 4 | WARNING | tools/release.sh:1022 | SELF | no early read | DEFERRED | plan |
| 10 | 4 | WARNING | tools/lib/release-leftovers.sh:88 | SELF | first Linux cut | FIXED | ff7623c7b8 |
| 11 | 5 | WARNING | tools/lib/release-leftovers.sh:120 | SELF | age wait false comfort | FIXED | 3929d4c0fe |
| 12 | 6 | WARNING | tools/lib/release-leftovers.sh:82 | SELF | set -e dependency | FIXED | 39a8737be5 |
| 13 | 7 | WARNING | tools/release.sh:2062 | SELF | guard after 7b | FIXED | c0ff17f973 |
| 14 | 7 | WARNING | tools/lib/release-leftovers.sh:133 | SELF | retry budget | FIXED | c0ff17f973 |
| 15 | 8 | WARNING | tools/release.sh:1656 | BRANCH | Mac manifest overwrite | CARRIED | #8563 |
| 16 | 8 | WARNING | tools/lib/release-leftovers.sh:144 | SELF | refusal text at 7b | CARRIED | #8563 |

### NITs (non-blocking, across all iterations)
- marker per clone, bounded as the plan says (iterations 2, 3, 7)
- "about two minutes" of retries is a floor (iteration 8)
- `_vdep_served_check`'s body is checked only by grep (iteration 8)

### Strengths (across all iterations)
- "never served" needs an exact 404 plus a made-up 404 plus a served 200 checksum; anything else refuses (all iterations, checked against the live host)
- every family decided before anything moves; nothing deleted; tracked files never moved (all iterations)
- each rule pinned by an arm that its mutation reds, checked each round
