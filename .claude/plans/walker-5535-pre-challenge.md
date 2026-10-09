---
pre_challenge: true
method: challenge-loop
branch: walker-5535
diff_hash: 91a39ebd196eead24466e2ce443c5e98a6f2a5f39b213b574d051de668844111
validation: passed
subdir_audit: passed
timestamp: 2026-10-09T11:22:52Z
iterations: 40
converged: true
---

## [CHALLENGE-LOOP] Summary

**Re-hashed after a conflict-free rebase (2026-10-09 09:2x CDT):** main added one unrelated line to engine.reachable.test.js
(a #5628 seam excuse) above this branch's own excuse line, which moved the hunk's line offset; the walker's change is
byte-identical. Mortals full suite PASSED at the pre-rebase hash 80a03577feb0 (17817 tests, 0 fail); the five backup and
reachability test files pass on the rebased head (242, 0 fail).

**Iterations:** 40
**Converged:** Yes (round 40: no BLOCKER, no CONVENTION; its one WARNING, a missing ceiling on a granted chunk's
lock, is already enforced by uploadChunks' checkOne: a chunk grant's lock must be 29 to 39 days from its signed start,
backupupload.js line 220; its two NITs are a comment and a performance note)
**Reviewer models:** opus on odd rounds, sonnet on even rounds, alternating from round 1.
**Fixed:** every BLOCKER and every actionable WARNING of rounds 1 to 39, each in its own commit named
"(#5535 review N)". **Deferred, with reasons in the plan's Decided section:** the swap-and-back folder race (Node has
no openat), a Mac an hour ahead of the coordinator spending one manifest grant, partial index use, a pnpm tree never
backed up, memberKeyIdOf's home (beside namingKeyId, for the key-storage slice).

Validation, stated so it is not over-read: engine/backupsnapshot.test.js (79), engine.reachable.test.js,
engine/backupupload.test.js and engine/backuprestore.test.js pass together on the rebased head (204, 0 fail). The
Mortals full suite is queued after the 0.7.33 cut (one suite per Mac) and the PR waits for it. Every new test was
run against the module before its review's change; the plan records which failed there and which are guards.

### Per-Iteration Breakdown (one line each; the commit for each round carries the detail)

1 opus: deny-list after the read (BLOCKER-class), TOCTOU on the read, manifest unbounded before upload, bucket mismatch as retry, index unchecked: all FIXED.
2 sonnet: skipped not charged before the last batch, restore path rules, chunks dropped on a missing lock, old-bucket drop undocumented: FIXED.
3 opus: BLOCKER, measured: "so far" budget let chunks lock before tooLarge: FIXED by a per-file upper bound; key length undercharged; folder-prefix collisions: FIXED.
4 sonnet: long key drops chunks; index org/epoch unchecked; unbounded walk: FIXED.
5 opus: BLOCKER, measured: a file over maxFile counted at full size refused every snapshot: FIXED; ~20 GB limit stated; repeated keys: FIXED.
6 sonnet: growth misreported as redaction: FIXED.
7 opus: shrink below maxFile stored past its reserve (measured): FIXED; account and lock bounds on the index: FIXED.
8 sonnet: collision throw refused the whole snapshot: FIXED (skips); bucket-switch cost stated.
9 opus: weekly allowance unchecked; folder swap-and-back; growth during the read: FIXED.
10 sonnet: allowance double-counted earlier chunks (my review-9 fix): FIXED.
11 opus: device key checked only after uploads: FIXED; mounts not crossed.
12 sonnet: refusal wording (which limit, hard links, bucket loss): FIXED.
13 opus: epoch segment is constant at the coordinator: bound by memberKeyId instead; seal only uploads: FIXED.
14 sonnet: bucket-less answers recorded: FIXED.
15 opus: BLOCKER-class: '.ssh\\id_rsa' passed the deny-list (measured): FIXED; period re-check before the manifest: FIXED.
16 sonnet: index key length; POSIX-flag scope: FIXED.
17 opus: manifest after a boundary unrestorable by lookup: FIXED (never granted).
18 sonnet: invisible-character names: deny-list on collisionKey too: FIXED.
19 opus: manifest key unchecked after the grant; credential-shaped names: FIXED.
20 sonnet: comment-only items: FIXED.
21 opus: naming key id unchecked (stale id locks an unopenable manifest): FIXED; rebased.
22 sonnet: staleIndex without an index; stated residuals: FIXED.
23 opus: other-bucket refusal unflagged with every chunk reused: FIXED (otherBucket in backupupload).
24 sonnet: token split across a folder boundary: FIXED.
25 opus: outlastsChunks newPeriod unreachable; staleIndex without index: FIXED.
26 sonnet: three-way split: FIXED (windows of up to 8).
27 opus: other bucket with an index handed chunks back: FIXED.
28 sonnet: backslash-plus-invisible reading: pinned by a test; far-future clock: FIXED.
29 opus: read guarantee overclaimed: stated as a residual; bucket-switch signals: FIXED.
30 sonnet: message wording; newPeriod by sentence: FIXED.
31 opus: clock skew looped retries: FIXED (grantedPeriod, neighbour periods).
32 sonnet: context-period lock: FIXED.
33 opus: manifest backup_quota as retry: FIXED.
34 sonnet: event loop held; no exclude: FIXED.
35 opus: per-folder yield only; exclude matching: FIXED.
36 sonnet: hard links counted before skip: FIXED.
37 opus: skew hour reopened the crossing (my review-31 fix): FIXED.
38 sonnet: NITs only, plus the hard-link class (deduplicated against the plan): converged there; NITs taken, so re-run.
39 opus: BLOCKER, measured: secretmask over large text in the board's process: FIXED (64 MB file, 4 MB text caps).
40 sonnet: lock ceiling on chunk grants: already enforced by uploadChunks (no change); converged.

### Strengths (across rounds)
- Restore's own pathProblem, collisionKey and collidingPaths decide what is stored.
- Nothing is uploaded unless the finished manifest and the week's allowance are sure to fit.
- Every new test was run against the module before its change.

## Final Ledger

### Round 40 (sonnet), the converging round, as recorded above
[WARNING] engine/backupsnapshot.js - No ceiling on a granted chunk's lock. Already enforced by uploadChunks' checkOne: a chunk grant's lock must be 29 to 39 days from its signed start (backupupload.js line 220). No change; deduplicated as already handled.
[NIT] engine/backupsnapshot.js - A comment wording. Noted.
[NIT] engine/backupsnapshot.js - A performance note. Noted.
[STRENGTH] - Restore's own pathProblem, collisionKey and collidingPaths decide what is stored.
[STRENGTH] - Nothing is uploaded unless the finished manifest and the week's allowance are sure to fit.

### Round 39 (opus)
[BLOCKER] engine/backupsnapshot.js - secretmask over large text ran in the board's process (measured). FIXED: 64 MB per-file and 4 MB text caps.
