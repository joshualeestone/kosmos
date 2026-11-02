---
pre_challenge: true
method: challenge-loop
branch: chipshapes-6249
diff_hash: 647e64fddedd24d51bfc40fb7174b3122979c169c8b742cb651e4b69691a3ce2
validation: passed
subdir_audit: passed
timestamp: 2026-11-02T05:32:05Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes (iteration 10 raised only repeats of recorded deferrals)
**Total findings:** 22 actionable (1 BLOCKER, 20 WARNINGs, 1 CONVENTION), plus NITs
**Fixed:** 14 | **Deferred:** 8 | **Asked (awaiting user):** 0

Validation: the full sequence (`validation_log_run_or_skip`) failed twice during the loop, at the base and at the
iteration 3 head, only on slow, timing-sensitive tests in files this diff does not touch. Every one of those files
passed alone: remote, provider-key-inject-3296, build-linux-7281, plus-signin-2036, prove-it-fails-restore-7619,
run-tests-file-timeout-6668, run-tests-only-4929 and create.test.js. The final run at `bd75dfd8cd`, with nothing
else of mine on the box, passed: node 26303 tests, 0 fail; every shell shard passed; hash 647e64fddedd.

Every new test was run against the code before its fix (or against main) as a control and failed there.

Origin: the 6c-bis blame lookup was not run per finding. Every finding is recorded BRANCH (the fail-safe default),
so the Self-generated counts below are 0 by default, not by measurement.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 (not classified; see Origin above)
- [WARNING] engine/chat.js:939: unanchored isChipBox refused a short message that only mentions a chip in its words --> FIXED (cc103c87d3: a chip box is a lone chip or shows a chip that is not words of our line)
- [WARNING] engine/chat.chipshapes-6249.test.js:173: no test of a line that merely reads like a chip --> FIXED (cc103c87d3)
- [NIT] dead `last === 0` arms in foldedFromOurs; composerHolds doc comment stale; plan example wrong; redundant isChipBox in pin --> first three applied

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 (not classified)
- [WARNING] engine/chat.js:1086: mixed text-plus-chip box after Enter read as 'other' instead of judged by our end --> FIXED (cef94a2335)
- [WARNING] engine/chat.js:960: very short text pieces beside our chips accepted --> DEFERRED: same window main accepts for a lone chip; a floor would refuse real short fold remainders (plan, Decided)
- [WARNING] engine/chat.js:2688: pin taken from one read while a fold may still be drawing --> FIXED (cef94a2335: pinned once two reads agree)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 (not classified)
- [BLOCKER] engine/chat.js:954: a person's chip beside our whole visible line counted as ours and would be pressed --> FIXED (d4b7f8a24f: each chip must hide CHIP_HIDES_MIN of our line)
- [WARNING] engine/chat.js:2696: settle loop refused cases main pressed (failed re-read) --> FIXED (d4b7f8a24f: falls back to the latest good read)
- [WARNING] engine/chat.js:2711: never-settled case left unremembered (moved the jam) with a false reason --> FIXED (d4b7f8a24f: same fallback, no new refusal path)
- [WARNING] engine/chat.chipshapes-6249.test.js:153: no control for a person's chip beside our full text --> FIXED (d4b7f8a24f)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 (not classified)
- [WARNING] engine/chat.js:1097: no pin, blind Enter, several chips left: said as sent --> FIXED (b70beb850e)
- [WARNING] engine/chat.js:2703: a fold that pauses then continues can be pinned part-drawn --> DEFERRED: fails safe (read as unsent, never pressed again); widening acceptance after Enter would let a person's paste in (plan, Not done)
- [CONVENTION] new test file discovery and Windows lists --> DEFERRED: found by node --test default discovery; Windows job selects win32 files and a named ALSO list, and this file does neither

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 (not classified)
- [WARNING] engine/chat.js:2706: a first read mid-draw that does not yet look ours got no second look --> FIXED (e05d1e2e96)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (not classified)
- [WARNING] engine/chat.js:2706: a plain-text first read skips the settle loop --> DEFERRED: identical to main, and only our own text can be in that box
- [WARNING] engine/chat.js:947: isChipBox depends on the wire --> DEFERRED: the comment on isChipBox already states it (iteration 1)
- [WARNING] engine/chat.js:1100: no test of unpinned someone-else's chips after Enter --> FIXED (1702eaf1f8; writing it exposed that a short line's case regressed from main, also fixed there)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 (not classified)
- [WARNING] engine/chat.js:2707: settle looks blocked the event loop on the async path (#4468) --> FIXED (ea193685f0: finishSubmit is a generator; async driver awaits)
- [WARNING] engine/chat.js:956: multi-chip acceptance widens the person-paste window for long lines --> FIXED in the plan's Decided section (ea193685f0), accepted with reasoning

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 (not classified)
- [WARNING] engine/chat.js:2700: a paste during the looks lands in the settled form --> DEFERRED: the documented window; a fresh read just before Enter does not close it
- [WARNING] engine/chat.js:1096: chips-only box after a long line's Enter reads as not sent even if ours went --> FIXED in the plan (5507583eb9), later narrowed in code at iteration 9
- [CONVENTION] engine/chat.js:1060: FOLD_STABLE_LOOKS path untested --> DEFERRED: covered by "still changing after its looks"

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 (not classified)
- [WARNING] engine/chat.js:2690: settle looks sat between verifyAtSend and the Enter, so a pane fallen to a shell could get an Enter --> FIXED (bd75dfd8cd: re-verified after the looks)
- [WARNING] engine/chat.js:1096: with a pin present and none of its chips there, chips-only box should be sent --> FIXED (bd75dfd8cd)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0
**Duplicates of prior findings (confirmed resolved or deferred):** 3 (iteration 8 trade-off, iteration 4 part-drawn pin, iteration 2 chip-words edge)
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/chat.js:939 | BRANCH | chip-like words refused | FIXED | cc103c87d3 |
| 2 | 1 | WARNING | chipshapes test:173 | BRANCH | no chip-words test | FIXED | cc103c87d3 |
| 3 | 2 | WARNING | engine/chat.js:1086 | BRANCH | mixed box after Enter | FIXED | cef94a2335 |
| 4 | 2 | WARNING | engine/chat.js:960 | BRANCH | short pieces accepted | DEFERRED | plan Decided |
| 5 | 2 | WARNING | engine/chat.js:2688 | BRANCH | pin from one read | FIXED | cef94a2335 |
| 6 | 3 | BLOCKER | engine/chat.js:954 | BRANCH | person chip beside our line | FIXED | d4b7f8a24f |
| 7 | 3 | WARNING | engine/chat.js:2696 | BRANCH | settle refused main's cases | FIXED | d4b7f8a24f |
| 8 | 3 | WARNING | engine/chat.js:2711 | BRANCH | never-settled jam moved | FIXED | d4b7f8a24f |
| 9 | 3 | WARNING | chipshapes test:153 | BRANCH | missing control | FIXED | d4b7f8a24f |
| 10 | 4 | WARNING | engine/chat.js:1097 | BRANCH | blind Enter chips said sent | FIXED | b70beb850e |
| 11 | 4 | WARNING | engine/chat.js:2703 | BRANCH | part-drawn pin | DEFERRED | plan Not done |
| 12 | 4 | CONVENTION | chipshapes test | BRANCH | discovery / Windows lists | DEFERRED | not needed |
| 13 | 5 | WARNING | engine/chat.js:2706 | BRANCH | mid-draw first read | FIXED | e05d1e2e96 |
| 14 | 6 | WARNING | engine/chat.js:2706 | BRANCH | plain-text first read | DEFERRED | as main |
| 15 | 6 | WARNING | engine/chat.js:947 | BRANCH | isChipBox wire-dependent | DEFERRED | commented |
| 16 | 6 | WARNING | engine/chat.js:1100 | BRANCH | unpinned chips test | FIXED | 1702eaf1f8 |
| 17 | 7 | WARNING | engine/chat.js:2707 | BRANCH | blocking looks (async) | FIXED | ea193685f0 |
| 18 | 7 | WARNING | engine/chat.js:956 | BRANCH | wider paste window | FIXED | ea193685f0 (plan) |
| 19 | 8 | WARNING | engine/chat.js:2700 | BRANCH | paste during looks | DEFERRED | documented window |
| 20 | 8 | WARNING | engine/chat.js:1096 | BRANCH | chips-only not-sent trade-off | FIXED | 5507583eb9 |
| 21 | 9 | WARNING | engine/chat.js:2690 | BRANCH | verifyAtSend gap | FIXED | bd75dfd8cd |
| 22 | 9 | WARNING | engine/chat.js:1096 | BRANCH | pinned foreign chips | FIXED | bd75dfd8cd |

(Iteration 8's CONVENTION is counted with #12's kind: deferred, covered by an existing test.)

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- Duplicate driver loops (finishSubmitSync/Async beside confirmSync/Async) could share one helper (iteration 9)
- `else if (!runner)` arm in finishSubmitAsync never runs, kept for parity with confirmAsync (iteration 9)
- foldedFromOurs greedy earliest match could carry a one-line comment (iteration 10)
- the #6717 test assertion flip for a short line is deliberate; a positive control was added beside it (iterations 5, 9)

### Strengths (across all iterations)
- Every widening needs the existing tie (empty box under the delivery lock, line long enough to fold) or the exact pinned form in the same pane process
- Each accepted shape is paired with a control that must be refused, and each test was shown to fail on the code before its fix
- The plan records decisions, rejected options, the weakest assumption and what is not done
