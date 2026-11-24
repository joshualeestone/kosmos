---
pre_challenge: true
method: challenge-loop
branch: waitwhy-8991
diff_hash: 5429651c5b7fefa46b5977aa24256b1c51ea14dfb0e425d6585c8186634f09fa
validation: passed
subdir_audit: passed
timestamp: 2026-11-24T20:27:26Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 blind review rounds (Opus and Sonnet alternating), plus one final-validation fix between rounds 2 and 3.
**Converged:** Yes. Round 5 raised no BLOCKER and no WARNING; its NITs were applied (three) or noted (one).
**Total actionable findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 1 synthetic final-validation BLOCKER, plus NITs
**Fixed:** all | **Declined:** 1 NIT (nameGoLabel's 'question' on a permission card: older, pinned in server.test.js, follow-up) | **Asked:** 0

## Validation
- Final validation on the rebased HEAD f21483359c: 30947 tests, 0 failures; build passed; subdir audit rc 0.
- First final validation (before the fix below) failed one test: server.test.js "the detail badge reads the card's own
  derivations" (#209: the agent page's #d-task line must be empty for needs_you; it was hidden but held the new sentence).
- Unit: engine/waitwhy-8991.test.js 5/5. Mutations: the needs_you block removed fails the sentence and pill-word tests;
  the taskLine guard removed fails the task-line test.
- Browser: render-waitwhy-8991.js 96 PASS headless (Chromium and WebKit, 1100 and 390 px). Mutation (block removed):
  every hover and hidden-text check FAILS.
- web*.test.js 3857/3857 and server.test.js 368 pass 0 fail on the final code; every browser-checks registry test passes;
  both browser-check gates rc 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 3 NITs
- [NIT] catch-all "see what it is asking" is false for a Codex hooks list or trust prompt --> FIXED ("see what it needs")
- [NIT] nameGoLabel says "question" on a permission card --> DECLINED (older, pinned in server.test.js; follow-up)
- [NIT] browser check's only negative arm is idle --> FIXED (working and usage-limited arms added)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs
- [NIT] the detail header's comment still said the line returns '' for the quote only --> FIXED
- [NIT] the test lifts stateReason alone --> NOTED (the page's Literals note already covers it)

#### Final validation (between iterations 2 and 3)
- [BLOCKER] final-validation: server.test.js #209 pin, #d-task held the sentence while hidden --> FIXED: taskLine returns
  '' for needs_you; the two older pins I had rewritten are restored to main's text and hold unchanged

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
- [WARNING] a screen-read needs_you stated as fact (#874 hedges screen reads) --> FIXED ("Looks like it is ..." when scraped)
- [CONVENTION] README overstated the browser check's coverage --> FIXED (card only; list row shares pillSay)
- [NIT] the stateReason comment said where the sentence shows wrongly; plan counts stale --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING
- [WARNING] awaitingApproval is a screen read even when the state is reported, so the permission sentence could state
  prose as fact --> FIXED (permission sentence always hedged)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 4 NITs
- [NIT] Browser-check-functions omitted pillSay and pillVh --> FIXED
- [NIT] fixtures used a confidence value the engine never sends --> FIXED (structured)
- [NIT] the unhedged catch-all never reached a browser --> FIXED (a reported, structured card added)
- [NIT] the leak test also passes on the old code --> NOTED (it is a guard, not proof; tests 1, 2 and 5 are the proof)

## Residuals (named, not fixed)
- Weakest premise: that "waiting for you" is true for every needs_you that is not a question or permission prompt.
- The sentence reaches the pill's hover and screen reader text only: a touch screen has no hover, so on a phone the pill
  word alone speaks (as for #8979's restart line).
