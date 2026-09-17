---
pre_challenge: true
method: challenge-loop
branch: dl-resume-3229
diff_hash: 03e79250a655c81fa14b898931b418f45301c4757cb73a0ea67f42c32ff4f214
validation: passed
subdir_audit: passed
timestamp: 2026-09-17T23:35:01Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 blind review rounds (plus a clean 6.0 initial validation)
**Converged:** Yes (round 7 found zero BLOCKER/WARNING/CONVENTION/NIT)
**Reviewer models:** alternated opus / sonnet across rounds (2 distinct models witnessed convergence)
**Total actionable findings:** 3 BLOCKER, 6 WARNING, 2 CONVENTION, plus several NITs
**Fixed:** all BLOCKER/WARNING/CONVENTION and most NITs | **Deferred:** 2 NITs (with reasoning) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 2 WARNING, 1 CONVENTION, 3 NIT
- [WARNING] installClaudeCode error-sweep does not remove `.part.<i>` segments --> FIXED (documented as deliberate resume-preservation; cross-version/abandon cleanup is download()'s own sweep)
- [WARNING] fetchSegment docstring claimed a per-segment fallback that did not exist --> FIXED (corrected the comment; a real fallback added in iter 3)
- [NIT] fetchSegment request-error path lacked fetchFile's close-before-settle discipline --> FIXED
- [NIT] progress double-count on an oversized leftover segment --> FIXED (iter 2)
- [NIT] single-stream re-hashes the whole file from disk --> DEFERRED (deliberate: one sha gate for both paths, one-time bounded cost, matches the #875 reuse path)
- [CONVENTION] no plan file --> FIXED (iter 6, plan file created)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 2 BLOCKER, 3 WARNING, 2 NIT
- [BLOCKER] orphan self-destroy tracked only one of C segments (per-flow single handle) --> FIXED (per-flow myReqs Set aborts all this flow's segments)
- [BLOCKER] fetchSegment had no size cap (a 206 overrun could fill the disk) --> FIXED (per-segment cap at the requested range length)
- [WARNING] progress double-count (oversized leftover) --> FIXED
- [WARNING] worker pool not fail-fast (in-flight peers finish after a failure) --> DEFERRED (no hang/leak; sha gate intact; aborting peers risks the successor-collision the flow-scoped handles avoid; bounded waste on an already-failing download)
- [WARNING] no test for parallel-path cancellation --> FIXED (added mid-parallel cancel test)
- [NIT] non-integer concurrency override --> FIXED (Math.trunc)
- [NIT] Content-Range not validated --> FIXED (comment: left to the sha gate)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 2 WARNING, 2 CONVENTION, 2 NIT
- [WARNING] no single-stream fallback when a service advertises ranges then ignores a segment Range (permanent regression for enterprise proxies) --> FIXED (download() retries with forceSingle on that specific error; red-capability proven)
- [WARNING] parallel-cancel test comment overclaimed (cannot isolate abortAllRequests) --> FIXED (comment corrected to the empty-dir contract it actually pins)
- [CONVENTION] plan file --> FIXED (iter 6)
- [CONVENTION] magic numbers not named --> FIXED (iter 6, named constants)
- [NIT] re-hash from disk --> DEFERRED (as above)
- [NIT] posthumous-segment cancel race (the #458 analogue) --> DEFERRED (a posthumous current-version segment is valid resume data or swept by the next download; self-healing)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 CONVENTION, 1 NIT
- [BLOCKER] segment concatenation had no persistent outAll error listener during the pipe loop (a write error mid-assembly would crash the board process) --> FIXED (one persistent settle-once error handler; added an assembly-write-error test)
- [CONVENTION] plan file --> FIXED (iter 6)
- [NIT] read stream not destroyed on the assembly error path --> FIXED (destroy currentRs + settle on 'close')

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 1 WARNING, 1 CONVENTION, 2 NIT
- [WARNING] parallel path had no absolute disk-fill ceiling, and the fetchSegment comment claiming "the same guarantee" was inaccurate --> FIXED (shared MAX_DOWNLOAD_BYTES gate on both paths; comment corrected)
- [CONVENTION] plan file (dedup) --> FIXED (iter 6)
- [NIT] re-hash from disk (dedup) --> DEFERRED
- [NIT] dangling never-settled assembly promise on abort --> FIXED (iter 6, settle on 'close')

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER (plan file), 1 WARNING, 1 NIT
- [BLOCKER/CONVENTION] no plan file --> FIXED (created .claude/plans/dl-resume-3229-20260917.md)
- [WARNING] a pre-existing download() contract comment still described the pre-#3229 discard-and-restart (stale, now backwards) --> FIXED (rewritten to describe resume)
- [NIT] concurrency literals not named like MAX_DOWNLOAD_BYTES --> FIXED (DEFAULT_DOWNLOAD_CONCURRENCY, MAX_DOWNLOAD_CONCURRENCY, MIN_SPLITTABLE_BYTES)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKER, 0 WARNING, 0 CONVENTION, 0 NIT
**Converged** -- reviewer verified the disk-fill ceiling, settle-once discipline, dual request tracking, sha gate, fallback scoping, and red-capable tests, and found no defects.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/connect.js | BRANCH | installClaudeCode sweep leaves `.part.<i>` | FIXED | documented deliberate resume-preservation |
| 2 | 1 | WARNING | engine/connect.js | SELF | fetchSegment docstring overstated a fallback | FIXED | comment corrected |
| 3 | 1 | NIT | engine/connect.js | SELF | fetchSegment error discipline | FIXED | close-before-settle |
| 4 | 1 | NIT | engine/connect.js | BRANCH | re-hash full file | DEFERRED | one gate; bounded |
| 5 | 1 | CONVENTION | .claude/plans/ | BRANCH | no plan file | FIXED | plan file created |
| 6 | 2 | BLOCKER | engine/connect.js | SELF | orphan-abort tracked one of C segments | FIXED | per-flow myReqs Set |
| 7 | 2 | BLOCKER | engine/connect.js | SELF | fetchSegment no size cap | FIXED | per-segment range cap |
| 8 | 2 | WARNING | engine/connect.js | SELF | progress double-count | FIXED | seed 0 for oversized |
| 9 | 2 | WARNING | engine/connect.js | SELF | pool not fail-fast | DEFERRED | correctness intact; peer-abort risks successor collision |
| 10 | 2 | WARNING | engine/connect.test.js | SELF | no parallel-cancel test | FIXED | added test |
| 11 | 2 | NIT | engine/connect.js | SELF | non-integer concurrency | FIXED | Math.trunc |
| 12 | 3 | WARNING | engine/connect.js | SELF | no single-stream fallback | FIXED | forceSingle retry (red-capable test) |
| 13 | 3 | WARNING | engine/connect.test.js | SELF | cancel-test comment overclaim | FIXED | comment corrected |
| 14 | 3 | CONVENTION | engine/connect.js | SELF | magic numbers | FIXED | named constants |
| 15 | 3 | NIT | engine/connect.js | SELF | posthumous-segment race | DEFERRED | self-healing (valid resume data or swept) |
| 16 | 4 | BLOCKER | engine/connect.js | SELF | assembly stream had no error listener (crash) | FIXED | persistent settle-once handler + test |
| 17 | 4 | NIT | engine/connect.js | SELF | rs not destroyed on assembly error | FIXED | destroy + settle on close |
| 18 | 5 | WARNING | engine/connect.js | SELF | no absolute disk-fill ceiling on parallel path | FIXED | MAX_DOWNLOAD_BYTES gate; comment corrected |
| 19 | 5 | NIT | engine/connect.js | SELF | dangling assembly promise on abort | FIXED | settle on close |
| 20 | 6 | WARNING | engine/connect.js | BRANCH | stale discard-and-restart contract comment | FIXED | rewritten for resume |
| 21 | 6 | NIT | engine/connect.js | SELF | concurrency literals unnamed | FIXED | named constants |

### Deferred (with reasoning, for operator override)
- Single-stream re-hash from disk (NIT): a single sha gate for both paths is simpler and more correct (verifies what persisted); one-time bounded cost, matches the #875 reuse path.
- Worker pool not fail-fast (WARNING): the download rejects correctly with no hang or leak; aborting in-flight peer segments on first failure would risk the successor-collision the flow-scoped handles prevent, for bounded waste on an already-failing download.
- Posthumous-segment cancel race (NIT): a posthumously-created current-version `.part.<i>` is valid resume data (kept + sha-gated) or swept by the next download's dir sweep; self-healing rather than harmful stranding.

### Strengths (across iterations)
- The sha256 over the assembled file is the single correctness gate for both paths; a corrupt or cross-layout resume fails it and is discarded whole, so the next attempt restarts clean.
- Disk-fill ceiling enforced on both paths (per-segment cap + advertised<=MAX entry gate + single-stream abort).
- Cancellation tears down every in-flight segment via abortAllRequests (module set) and the per-flow myReqs Set (orphan self-destroy).
- Detection folded into fetchFile on response headers, so every existing single-stream test path is byte-for-byte preserved (redirects, #458 cancel timing, checksum mismatch, reuse-if-verified).
- Tests are genuinely red-capable and non-vacuous (resume asserts exact bytes served; sha-gate flips one byte at the same length; fallback asserts a Range was attempted; assembly-error uses a real EISDIR; cancel waits for a real segment file).
