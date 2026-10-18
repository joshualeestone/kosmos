---
method: challenge-loop
branch: moveputback-6231-item7
diff_hash: d91f4595b6b1798b681e83b490fa3b3ac2bf66fc1b0f91aa8d39102d9a57dec7
validation: node suite passed on the converged tree (21503 tests, fail 0); sole red was the #1720 browser-check gate, fixed via branch-wide override trailer and verified exit-0 via the gate's own lib; ONE clean full-suite re-run at the exact PR head is queued and owed before merge per PM ruling (m5971) -- the re-run at the override head flaked only on fleet contention (load 71), not on the change
iterations: 5
converged: true
---

# Challenge-loop proof -- moveputback-6231-item7 (#6231 item 7 / #6183)

Windows account-move put-back converted from a SYNCHRONOUS loop inside `stop()`
(which froze the board thread; on Windows each put-back is several Task Scheduler
calls) to an ASYNC tail in the move's `start()` finally -- off the board thread,
each agent held until its own put-back settles, the move staying `busy()` true
until the last settles. Splinter's #6183 contracts preserved: (1) slow put-back
keeps Update refused until settled; (2) not-reached agents read `pending` in the
stop answer; (3) hand-change re-read stays SYNC before the write; (3b) each agent
held until its own put-back settles; (4) second stop is a no-op.

**Total findings:** 1 BLOCKER, 7 WARNINGs, 0 CONVENTIONs, 7 NITs (all resolved or
deliberately deferred). Reviewers alternated model across iterations (Sonnet /
Opus) per kosmos#2032, each fresh and blind.

#### Iteration 1 (Sonnet)
**New findings:** 1 BLOCKER, 4 WARNINGs, 3 NITs
- [BLOCKER] engine/accountmove.js (putBackOne catch) — the catch dropped `m.deps`,
  so an async put-back REJECTION skipped `leftOnOld`/the note; the agent could be
  left on the old account with nothing recorded --> FIXED + regression test added.
- [WARNING] engine/accountmove.js (putBackBefore) — 3 distinct put-back refusal
  messages (no putBack / no readAccount / unreadable from-to) had collapsed to 1;
  item 10 reads them apart --> FIXED (restored the 3 messages).
- [WARNING] sync-fallback honesty: `putBackOne` must fall back to the sync
  `putBack` where `putBackAsync` is absent so `canWrite` stays truthful --> FIXED.
- [WARNING] test coverage: the two on-main engine test files asserted put-backs
  right after `stop()`; async tail broke them --> FIXED (await `out.done`, assert
  `pending` after stop).
- [WARNING] dead `putBack(m,a)` wrapper left after the refactor --> FIXED (removed).
- [NIT] comment/wording touch-ups --> applied.

#### Iteration 2 (Opus)
**New findings:** 2 WARNINGs, 1 NIT
- [WARNING] engine/remove.js (putBackAsync) — could hang if a future generator
  returned falsy WITHOUT abandonment --> FIXED (falsy-without-abandon guard).
- [WARNING] plan-scope drift: two #6243-folded cleanups (exit-128 taskkill test,
  win32job.running() removal) belong to a follow-up, not this PR --> FIXED (split
  to item 8 / follow-up in the plan).
- [NIT] catch-comment clarity on RESTARTING left to `driven.then(release,release)`
  --> applied.

#### Iteration 3 (Sonnet)
**New findings:** 2 WARNINGs, 2 NITs
- [WARNING] engine/accountmove.js (putBackAfter) — abandon-AFTER-success used the
  wrong user message + note (said "still on the old account" when the put-back may
  have landed) --> FIXED (`back.capped` -> `putBackFailed(..., uncertain=true)`,
  "whether it is back ... is not confirmed -- check its account in Settings").
- [WARNING] two test gaps (rejection->noted; capped->unconfirmed-wording) --> FIXED
  (tests added).
- [NIT] stale comments --> applied.

#### Iteration 4 (Opus)
**New findings:** 1 WARNING
- [WARNING] web/index.html (stopAccountMove) — two comments went stale against the
  async conversion ("puts back inside this request" / "answers after the put-backs")
  and the 60s abort timer was undocumented --> FIXED (comment-only; the repo's most
  common defect class).

#### Iteration 5 (Sonnet) — CONVERGED
**New findings:** 0 actionable (3 NITs applied)
- One WARNING re-raised the async put-back DELAY; it dedups to the deliberate
  Splinter #6183 ruling, recorded as a "Known tradeoff" in the plan (not a defect).
- 3 NITs applied; no new BLOCKER/WARNING/CONVENTION after dedup --> 6d CONVERGED.

#### Final validation (6j)
- Run `btkext54a` on the converged HEAD (2479fbf9): node suite **21503 tests, pass
  21248, fail 0, skipped 255** (whole, accounted); shell shard **all 246 passed**.
  The SOLE red was the **#1720 browser-check gate**: the branch touches web/ (two
  comment blocks) with no docs/browser-checks assertion.
- [WARNING] final-validation: #1720 browser-check gate --> FIXED. The web/ change is
  comment-only (verified: 6 insertions / 4 deletions, all comment lines in
  stopAccountMove). Added the branch-wide `Browser-check:` override trailer (empty
  commit da0e8c0, tree byte-identical to the converged HEAD). Verified exit-0 by
  running the gate's own lib against the branch.
- Re-run `b0mxcoons` at the override head (da0e8c0): flaked on fleet contention
  (box load 71 / 12 cores, two other agents' suites running). 20 node tests timed
  out -- all SIGTERM / blown wall-clock ceilings (e.g. "must end inside 15s (took
  22608ms)") on unrelated cli/community/connections/feedback/projects files, NONE
  touching the Windows put-back path. The byte-identical tree passed all 21503 in
  run 1 at load ~10.
- PM ruling (Liu Kang, m5971): open the PR now (CI on dedicated runners is
  authoritative; Raiden can start reviewing); start ONE clean local full suite at
  the exact PR head once, let run-tests.sh queue it, and get it green before merge.
  That clean-at-head run is owed before merge and is queued accordingly.
