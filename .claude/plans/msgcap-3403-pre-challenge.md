---
pre_challenge: true
method: challenge-loop
branch: msgcap-3403
diff_hash: 2fedbc6fb5328b349bbcd0bf0d5b207b0d9ef037e357e6ca44410948d946ed39
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T11:43:50Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (iter 1 = initial validation 6.0; iters 2-3 = blind reviews, models rotated opus/sonnet)
**Converged:** Yes -- iteration 3 (sonnet) found zero BLOCKER/WARNING/CONVENTION findings.
**Total findings:** 6 (0 BLOCKERs, 1 WARNING, 4 NITs, 1 synthetic-validation)
**Fixed:** 2 | **Deferred:** 4 | **Asked (awaiting user):** 0

Notes on environment: local validation on this Mac initially failed because the Xcode license was
never agreed (xcode-select points at Xcode.app), which stopped the board-spawning tests. Worked
around per-session with DEVELOPER_DIR=/Library/Developer/CommandLineTools (license-free CLT
toolchain); flagged the proper one-time operator fix (sudo xcodebuild -license accept) to Splinter.
With that set, the full suite ran green: 8415 pass, 0 fail (validation-log PASSED, hash 2fedbc6fb532).

### Per-Iteration Breakdown

#### Iteration 1 -- initial validation (6.0)
**Reviewer model:** n/a (validation pass, no reviewer)
**New findings:** 1 synthetic-validation
**Self-generated:** 0 of the above (6.0 synthetic finding is BRANCH by instruction)
- [BLOCKER] initial-validation: server.supervisor-refresh.test.js:57 ENOTEMPTY on rmSync under load --> DEFERRED: contention flake, passes 4/4 in isolation (exit 0), file is unrelated to this change (chat cap + soft counter). Machine load 5.93, a live board sharing the box; the helper's own note: "a red that is green alone is contention, not the change."

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 3 NITs
**Self-generated:** 0 of the above (all cite pre-loop branch commits, not this loop's fix)
- [WARNING] engine/chat.js:132 -- the MAX_TEXT comment asserted "The UI maxlength on the agent-message composers must stay EQUAL to this" for all four agent-message composers, but #pj-say (web/index.html:12420) and #d-term-say (web/index.html:9590) deliberately stay at maxlength=2000 (plan-documented single-line follow-on). Comment overclaimed an invariant the code does not hold for half the composers. --> FIXED (commit 0e8fed23): scoped the comment to the two multi-line composers (#d-say, #pj-post) that ARE matched at 10000 and asserted by render-msg-counter-3403, and noted the two single-line inputs stay at 2000 as a documented follow-on.
- [NIT] engine/chat.js:133 -- the below/above rationale was worded backwards ("a client cap under this one silently saves less"). --> FIXED (commit 0e8fed23, folded into the same rewrite): a UI maxlength BELOW the engine cap is the #3403 cutoff (input stops, no warning); one ABOVE it lets the caller type past what the engine keeps.
- [NIT] web/index.html:9006,12283 (aria-live counter) -- the counter is aria-live=polite and its textContent is rewritten on every keystroke within the last 500 chars, so a screen reader announces a running countdown. --> DEFERRED: a11y refinement out of scope for the cap-raise fix; only fires in the last 500 chars (a rare state); worth a follow-on to announce on threshold crossings only.
- [NIT] web/index.html:44308 (SOFT_COUNT_AT=500) -- assumes the cap is much larger than 500; a future opted-in composer with maxlength<500 would show the counter permanently. --> DEFERRED: speculative, no composer under a 500 cap opts in today (both are 10000); a one-line guard is a clean follow-on.

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
**Converged** -- no new actionable findings. The sonnet pass independently confirmed the iter-2 comment fix is accurate (no overclaim), the pjGrowComposer merge resolution is clean (both #3403 counter and #2922 pjMentionPaint tail hooks present, braces balanced, guard justified against the isolation-lift test), threshold arithmetic correct at every boundary, and all four browser-check indices consistent.
- [NIT] docs/browser-checks/render-msg-counter-3403.js:194 -- chromium.launch() has no surrounding try/catch, so a browser-launch failure crashes with a raw unhandled rejection rather than a clean FAIL line. --> DEFERRED: diagnosability-only on a failure mode that does not occur here (pw-runtime chromium is installed); matches the check's own reason-grep accounting (no launch-catch site claimed), and adding a catch would require bumping the catch-site index for marginal benefit.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | VALIDATION | server.supervisor-refresh.test.js:57 | BRANCH | ENOTEMPTY rmSync under load | DEFERRED | Contention flake, green 4/4 in isolation, unrelated file |
| 2 | 2 | WARNING | engine/chat.js:132 | BRANCH | maxlength invariant comment overclaims all 4 composers | FIXED | 0e8fed23 |
| 3 | 2 | NIT | engine/chat.js:133 | BRANCH | below/above rationale worded backwards | FIXED | 0e8fed23 |
| 4 | 2 | NIT | web/index.html:9006 | BRANCH | aria-live counter announces every keystroke near cap | DEFERRED | a11y follow-on; only fires in last 500 chars |
| 5 | 2 | NIT | web/index.html:44308 | BRANCH | SOFT_COUNT_AT=500 assumes cap>>500 | DEFERRED | Speculative; no composer under 500 cap today |
| 6 | 3 | NIT | docs/browser-checks/render-msg-counter-3403.js:194 | BRANCH | chromium.launch has no try/catch | DEFERRED | Diagnosability only; matches reason-grep accounting |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
- [NIT] web/index.html:9006 -- aria-live counter announces a countdown on every keystroke near the cap (iteration 2).
- [NIT] web/index.html:44308 -- SOFT_COUNT_AT threshold assumes cap much larger than 500 (iteration 2).
- [NIT] docs/browser-checks/render-msg-counter-3403.js:194 -- unguarded chromium.launch (iteration 3).

### Strengths (across all iterations)
- The render-msg-counter-3403 browser-check is genuinely rigorous: a far-from-cap HIDDEN setup control before the "shows N" arms, a geometry arm that reds on the squished-inline bug a text-only check would miss, a real computed-colour amber check, and a real-keystroke arm proving the shipped input listener drives the counter (iterations 2, 3).
- The counter reads its cap from the element's own maxlength, so the threshold source and the UI cap cannot drift; UTF-16 counting agrees across maxlength, value.length, and the engine's MAX_TEXT check (iterations 2, 3).
- The pjGrowComposer merge resolution keeps both the #3403 counter and main's #2922 pjMentionPaint tail hooks, in order, braces balanced, with the typeof guard justified against the actual isolation-lift test (iterations 2, 3).
- The cap boundary is tested precisely at MAX_TEXT (accepted) and MAX_TEXT+1 (refused, message names 10000), reading the constant dynamically so the assertion cannot drift (iteration 3).
- All four browser-check indices (runner list, README, reason-grep count 128->129, EXPECTED_CATCH_SITES correctly unchanged) are consistent, and the two surface-gate override trailers are per-check scoped with non-empty reasons (iterations 2, 3).
- Scope discipline is verified in the code, not just claimed: the two single-line quick inputs stay at 2000 and #d-term-say's listener never calls pjGrowComposer, matching the plan's stated reason (iteration 3).
