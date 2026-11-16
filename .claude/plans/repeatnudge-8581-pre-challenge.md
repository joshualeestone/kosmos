---
pre_challenge: true
method: challenge-loop
branch: repeatnudge-8581
diff_hash: 55f0eae9b6a6fa4570ea1ce0cb216f8a0104655a879c50095d5e06c2592a6aea
validation: passed
subdir_audit: passed
timestamp: 2026-11-16T19:05:17Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped at the 8-round review cap, a standing usage rule from Splinter (2026-10-22): past 8 rounds only with a BLOCKER, and leftovers go to a follow-up card. Round 8 raised no BLOCKER. Its new warnings were deferred with reasons below, and the leftovers were filed as #8586.
**Total findings (actionable, before dedup):** 2 BLOCKERs (1 baseline-validation, 1 review), 22 WARNINGs, 6 CONVENTIONs, plus NITs
**Fixed:** 21 | **Deferred:** 9 | **Asked (awaiting user):** 0

**Validation:**
- Baseline (6.0): full suite red with 3 failures, all from this branch:
  - two #1732 Windows-coupling guards tripped on a stray `split(':')`;
  - the web/ browser-check gate wanted a trailer.
  Both were fixed in iteration 1.
- Final (6j) on head 85c721bb49: a full run that PASSED.
  - node: 29296 tests, 0 fail;
  - shell shards: 2/4 (75), 3/4 (77) and 4/4 (79) all passed;
  - test-shell-parallel: all arms passed;
  - subdir audit passed.
  The log entry was a real run, not a skip (status passed, hash 55f0eae9b6a6).

### Per-Iteration Breakdown

#### Iteration 1 (with the 6.0 baseline)
**Reviewer model:** opus (default)
**New findings:** 1 BLOCKER (baseline validation), 3 WARNINGs, 3 CONVENTIONs, 4 NITs
**Self-generated:** 0 (no loop commit before this pass)
- [BLOCKER] initial-validation: yarn test failed (#1732 guards on engine/repeatdue.js `split(':')`; browser-check gate on web/index.html) --> FIXED 9aa83ac93d (split removed; Browser-check trailer)
- [WARNING] server.js repeatDueTick: no source pin for the wiring --> FIXED 9aa83ac93d
- [WARNING] engine/repeatdue.js: untested branches (held/busy, throw, unreachable, second holder, minutes throttle) --> FIXED 9aa83ac93d
- [WARNING] server.js: roster read on most minutes --> FIXED 9aa83ac93d (only when an owed holder is on its project)
- [CONVENTION] plan file name lacked a timestamp --> FIXED 9aa83ac93d
- [CONVENTION] first commit subject not in `<branch> -- msg` form --> DEFERRED: the commit is pushed and carries #8581, and rewriting it costs a force push for no reader benefit. Every later commit uses the form.
- [CONVENTION] CLAUDE.md Where to Find Things had no pointer --> FIXED 9aa83ac93d
- [NIT] recordBy ignored the injected now --> FIXED 9aa83ac93d
- [NIT] filter tests could pass on the one-line-per-agent rule --> FIXED 9aa83ac93d (distinct holders)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the hourly-throttle line came from the iteration-1 code)
- [WARNING] ios/Kosmos/TaskPageLogic.swift: due-told not worded on iOS --> FIXED 27581c3757 (plus two Swift logic checks, 121/121)
- [WARNING] engine/repeatdue.js: a stalled hourly repeat told every hour --> FIXED 27581c3757
- [WARNING] engine/repeatdue.js: one holder per slot --> DEFERRED: by design. One `kosmos task ran` answers the slot for the whole task.
- [WARNING] engine/repeatdue.js: a burst after deploy with the limit off --> DEFERRED: each stale repeat is told once (its latest slot), one line per agent per pass. "Limit off" is the person's choice.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 2 of the above (stall gap and its comment, both from iteration 2)
- [WARNING] engine/repeatdue.js: on the spring-forward day a stalled daily repeat was skipped (elapsed-ms gap) --> FIXED 0bc60675cd (counts the rule's own slots; new TZ-pinned test file)
- [WARNING] server.js: the missed-run and due-run tells could type into one agent in the same minute --> FIXED 0bc60675cd (TELL_TYPED)
- [WARNING] tests: no DST, twice-daily or rule-change cases --> FIXED 0bc60675cd
- [NIT] a rule change kept the old stall --> FIXED 0bc60675cd
- [NIT] the record-by guidance differed from the Prompter nudge --> FIXED 0bc60675cd
- [NIT] owed() was computed twice --> FIXED 0bc60675cd
- [NIT] CLAUDE.md said prompterTick has its own timer --> FIXED 0bc60675cd

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 1 of the above (CLAUDE.md row)
- [WARNING] server.js: the TELL_TYPED hold-off worked one way only --> DEFERRED then, FIXED in iteration 7 (85c721bb49)
- [WARNING] engine/repeatdue.js: the weakest premise (a schedule counts as asking to be reminded) is not a ruling --> DEFERRED: it is decided and documented on #8581 and in the plan, under the standing ruling that the agent decides, documents and continues.
- [CONVENTION] CLAUDE.md:126 lead sentence --> FIXED 428f8e5273

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 2 of the above (stallSlots period and the hold-off comment, both from iteration 3)
- [WARNING] engine/repeatdue.js: stallSlots measured one gap, so uneven daily times were spaced wrongly --> FIXED 692bf4dbb7 (counts slots in 24 h)
- [WARNING] engine/repeatdue.js: a healthy short-period repeat got a line every slot --> FIXED 692bf4dbb7 (told only once overdue by the miss grace)
- [WARNING] server.js: a holder who is the reviewer got two lines about one run --> FIXED 692bf4dbb7 (the holder is left to the missed-run tell)
- [CONVENTION] the weakest premise needs confirming --> DEFERRED: same as iteration 4.
- [NIT] the unreachable check came after the allowed check (missedtell's order is the reverse) --> FIXED 692bf4dbb7
- [NIT] the DST test did not sandbox its roots --> FIXED 692bf4dbb7
- [NIT] the docstring missed items and recentTyped --> FIXED 692bf4dbb7

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (plus 1 duplicate of a deferred one), 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (reviewer exclusion, from iteration 5)
**Duplicates of prior findings:** 1 (TELL_TYPED one way)
- [WARNING] engine/repeatdue.js: the holder-reviewer may be told by neither sweep --> DEFERRED: missedtell's other gates are covered here as well:
  - a departed holder is skipped by this sweep too;
  - a switched-off holder is filtered by this sweep too;
  - a person reviewer is not filtered at all.

  What remains is one slot missed before the reviewer was named, which matches missedtell's own rule. Filed as #8586 item 2.

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs (one a re-raise), 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the grace gate, from iteration 5)
- [BLOCKER] engine/repeatdue.js:64-69: dueSlot disagreed with missedRuns about a run reported early (hourly at 8:50 for 9:00 was told "not reported") --> FIXED 85c721bb49 (gates on taskrepeat.missedRuns; early-run arms for hourly and 15-minute rules with controls)
- [WARNING] TELL_TYPED one way (re-raised) --> FIXED 85c721bb49 (missedtell reads it; test plus source pin)
- [WARNING] server.js: the Prompter switched off between a prompterTick nudge and this sweep gives a second line --> DEFERRED: the window is one interval, it costs at most one extra line, and nothing records prompterTick's nudge per slot.
- [NIT] the stallSlots comment claimed DST-correct counting --> FIXED 85c721bb49 (claim deleted)
- [NIT] no person-reviewer test --> FIXED 85c721bb49

#### Iteration 8 (last under the cap, whole branch, nothing pre-cleared)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs (plus 1 duplicate of a deferred one), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 acted on (all deferred)
- [WARNING] engine/repeatdue.js:77 holder-reviewer gap --> duplicate of iteration 6, DEFERRED (#8586 item 2)
- [WARNING] engine/repeatdue.js:74: "once per due slot" wording; an unreachable holder writes one row per slot --> DEFERRED:
  - the wording is literally true (a slot is told at most once);
  - the per-slot row is #8586 item 1.
- [WARNING] server.js: hold-stale is not on TELL_TYPED --> DEFERRED: hold-stale needs the Prompter on and this sweep needs it off, so they never both run. #8586 item 4.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | initial-validation | BRANCH | full suite red (#1732 guards, browser-check gate) | FIXED | 9aa83ac93d |
| 2 | 1 | WARNING | server.js repeatDueTick | BRANCH | wiring unpinned | FIXED | 9aa83ac93d |
| 3 | 1 | WARNING | engine/repeatdue.js:117 | BRANCH | untested delivery branches | FIXED | 9aa83ac93d |
| 4 | 1 | WARNING | server.js:29914 | BRANCH | roster read too often | FIXED | 9aa83ac93d |
| 5 | 1 | CONVENTION | .claude/plans | BRANCH | plan name lacks timestamp | FIXED | 9aa83ac93d |
| 6 | 1 | CONVENTION | commit 901a18eab9 | BRANCH | subject format | DEFERRED | pushed; rewriting needs a force push |
| 7 | 1 | CONVENTION | CLAUDE.md | BRANCH | no Where to Find row | FIXED | 9aa83ac93d |
| 8 | 2 | WARNING | ios TaskPageLogic.swift:435 | BRANCH | due-told unworded on iOS | FIXED | 27581c3757 |
| 9 | 2 | WARNING | engine/repeatdue.js:55 | SELF | hourly stall nags hourly | FIXED | 27581c3757 |
| 10 | 2 | WARNING | engine/repeatdue.js:65 | BRANCH | one holder per slot | DEFERRED | by design |
| 11 | 2 | WARNING | engine/repeatdue.js:70 | BRANCH | post-deploy burst with limit off | DEFERRED | once per stale repeat |
| 12 | 3 | WARNING | engine/repeatdue.js:62 | SELF | DST day skipped | FIXED | 0bc60675cd |
| 13 | 3 | WARNING | server.js:29911 | BRANCH | two timers, one agent, one minute | FIXED | 0bc60675cd |
| 14 | 3 | WARNING | tests | BRANCH | no DST/twice-daily/rule-change | FIXED | 0bc60675cd |
| 15 | 4 | WARNING | server.js:29886 | SELF | hold-off one way | FIXED | 85c721bb49 |
| 16 | 4 | WARNING | engine/repeatdue.js:3 | BRANCH | weakest premise not a ruling | DEFERRED | decided and documented |
| 17 | 4 | CONVENTION | CLAUDE.md:126 | SELF | lead sentence | FIXED | 428f8e5273 |
| 18 | 5 | WARNING | engine/repeatdue.js:38 | SELF | one-gap period | FIXED | 692bf4dbb7 |
| 19 | 5 | WARNING | engine/repeatdue.js:73 | BRANCH | healthy repeat told every slot | FIXED | 692bf4dbb7 |
| 20 | 5 | WARNING | server.js:29902 | BRANCH | holder-reviewer told twice | FIXED | 692bf4dbb7 |
| 21 | 6 | WARNING | engine/repeatdue.js:76 | SELF | holder-reviewer gap | DEFERRED | one slot; #8586 item 2 |
| 22 | 7 | BLOCKER | engine/repeatdue.js:64 | SELF | early run read as not reported | FIXED | 85c721bb49 |
| 23 | 7 | WARNING | server.js:29914 | BRANCH | Prompter toggled mid-slot | DEFERRED | one interval, one line |
| 24 | 8 | WARNING | engine/repeatdue.js:74 | SELF | unreachable row per slot | DEFERRED | #8586 item 1 |
| 25 | 8 | WARNING | server.js:29968 | BRANCH | hold-stale off the map | DEFERRED | cannot co-run; #8586 item 4 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- Several NITs were fixed in place (iterations 1, 3, 5 and 7).
- Unfixed:
  - the server wiring test is source-text, not behaviour (iterations 2 and 8);
  - `plain()` requires agentnudge on each call (iterations 7 and 8);
  - an unreachable row names holders[0] (iteration 8);
  - TELL_TYPED is never pruned (bounded by sessions, iteration 6).

### Strengths (across all iterations)
- Every "not told" test has a control in the same test that is told. Filtered fixtures use a different agent from the live one.
- The slot comes from taskrepeat.missedRuns, so this tell, the missed-run tell and the missed count agree about one run.
- The due-told kind is worded the same in the engine, the web page and iOS. Each has a parity arm, and it is excluded from last activity, with a control.
- Each fix was mutation-checked: the gate removed or inverted, the test went red, and the gate was restored.
