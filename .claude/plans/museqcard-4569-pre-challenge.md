---
pre_challenge: true
method: challenge-loop
branch: museqcard-4569
diff_hash: 9b6046acd0d89356eab27b70d22c1dc1b2c098bd4d55c1e92142ff3bda1d875f
validation: passed (Mortals full run, clean at this hash, recorded 2026-09-30T10:38:29Z)
subdir_audit: passed
timestamp: 2026-09-30T10:39:07Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5 blind reviews (opus, sonnet, opus, sonnet, sonnet). They reviewed this branch's own diff against museq-4569 (PR #4604), which is reviewed and proven separately.
**Converged:** Yes. Round 4 returned NO NEW BLOCKER/WARNING/CONVENTION, and so did round 5 after the fixture fix.
Every link was measured red with it removed: the page rule, status carry, selfreport read, route pass-through, bridge body, and each card builder.

## Iteration 1 (opus)
- [BLOCKER] The first version put the count in the report's free text. A working agent's reported reason is hidden on the card, list and agent page by ruling (#986, #3271), so it showed nowhere. It was redesigned as its own field, `waiting: { n, yours }`, worded by the page. Fixed in 88cb28efc.
- [WARNING] No test rendered anything. Added web.muse-waiting-4569.test.js, which calls the page's own taskLine with noQuote.
- [CONVENTION] Plan and comments reworded ("the write-up").

## Iteration 2 (sonnet)
- [WARNING] Neither card builder's `waiting` line was tested. Added engine/status.muse-waiting-4569.test.js, covering the pane card, the paneless card and a stale control. Fixed in 986d0117e.
- [NIT] A late working report can land after idle. Recorded in the plan as accepted.

## Iteration 3 (opus)
- [CONVENTION] Comments claimed the count cannot come from an agent. Reworded to what is true: it is checked, rendered from numbers only, and shown on the reporter's own card. Fixed in 684f46f65.
- [NIT] Now reads "1 message waiting, it's yours".

## Iteration 4 (sonnet)
- NO NEW BLOCKER/WARNING/CONVENTION.
- [STRENGTH] The shared bridge is unchanged for agy: its payloads never carry the count, and old throttle markers parse the same way.

## Iteration 5 (sonnet), after the fixture fix and the rebase onto main
The first full run (Mortals, 2026-09-29 21:51) failed render-talk-goldencard-2519: the recorded agent card lacked the new
`waiting` key. Re-captured with tools/capture-agent-card.js (the only change: `"waiting": null`, commit 73c5c4714), then
rebased onto main and later merged main twice (the #4609 queue fix). A full run at 01:55 then failed only the coarse
browser-check gate (#1720): once #4604 merged, this branch alone touched web/ with only a fixture under docs/browser-checks;
a `Browser-check:` trailer (empty commit 7ba97af3a) records why no assertion edit is needed.
- [WARNING] engine/projects.js:943 - project member rows do not carry `waiting` --> DEFERRED: the plan scopes the line to the card, list row and agent page (#4569 fix 4); member rows carry only fields they render, and they render no task line.
- [NIT] engine/musefront.js:126 - NOTE_EVERY_MS sits under the BUSY_RETRIES comment (not taken).
- [NIT] no browser render of a non-null waiting line; the fixture carries null (the plan states the gap; not taken).
- NO NEW BLOCKER/CONVENTION.

## Validation
- Full run on Mortals, clean at this hash (recorded 2026-09-30T10:38:29Z).
- After the fixture fix: engine/musefront, selfreport.waiting-4569, status.muse-waiting-4569, server.report-readback-2709,
  web.muse-waiting-4569 and render-talk-goldencard-2519, 81/81; the browser checks that read the card fixture
  (render-talk, render-waiting-phone-718, render-needsyou-dealarm-2808) pass; both browser-check gates pass.

## Weakest premise
- That the line reads right in the card's task slot at every width. This is measured on the page's own functions, not rendered in a browser.
