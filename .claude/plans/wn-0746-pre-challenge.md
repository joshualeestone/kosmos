---
pre_challenge: true
method: challenge-loop
branch: wn-0746
diff_hash: 9480939dd03a53ba0b1223ffaba81b5700564ff55f4fc79ab7927dab3ed2090b
validation: passed (Mortals at 0909c1666: 20114 tests, 0 fail, 0 cancelled, browser-check gates pass; recorded under the local helper's hash, the same diff spelled with abbrev 10 instead of Mortals' 9, #6002)
subdir_audit: passed
timestamp: 2026-10-13T17:02:30Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 raised NITs only)
**Total findings:** 15 (0 BLOCKERs, 6 WARNINGs, 1 CONVENTION, 8 NITs)
**Fixed:** 9 | **Deferred:** 6 | **Asked (awaiting user):** 0

Validation between rounds: the 66 What's New tests (engine/whatsnew, web.whatsnew-3955, tools.whats-new-check-3955,
tools.whats-new-pool-5711, tools.whats-new-pool-sync-5713) and `whats-new-check.js 0.7.46` after every rebuild. The
first Mortals run failed only on the #1720 browser-check gate (no `Browser-check:` trailer on a web/ change); a trailer
commit fixed it, both gates then passed locally, and the rerun was clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/whats-new.json: "Save diagnostics makes one file for the people who build Kosmos" reads as Kosmos sending it --> FIXED (1c3303d20: "saves one file on this computer for you to give")
- [NIT] "you can now remove that account" not true of the default Grok account --> FIXED ("an account you added")
- [NIT] subprojects line wrong for pickers --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] pending subprojects line still gave only the list form --> FIXED (8c86174b6: both forms, the PR's own examples)
- [CONVENTION] plan present --> no change needed
- [NIT] plan's left-out list had no card numbers --> FIXED; [NIT] 14-day threshold carried from the card --> DEFERRED (matches IDLE_DAYS = 14)

#### Iteration 3
**Reviewer model:** haiku
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] plan said the default account is never removable (true for Grok, false for OpenAI since #2684) --> FIXED (fc4739f4c)
- [WARNING] "Reply to Claude questions by number" narrower in code than in words --> DEFERRED: the line opens with "When a Claude agent asks you to pick one option", the needs-you case engine/chat.js lets a number through for
- [CONVENTION] plan file name has no timestamp --> DEFERRED: wn-0745.md and earlier What's New plans use the same name, and the gate accepts it
- [NIT] placeholder promote time --> FIXED (09:28, from the promote log)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

### NITs (non-blocking, iteration 4)
- [NIT] "Save diagnostics saves" repeats the verb
- [NIT] "with keys taken out" says less than the page (emails, user folders, computer names too); narrower, never wider
- [NIT] plan line 3 is long

### Strengths
- The built file reproduces byte for byte from the pool (a reviewer rebuilt it offline).
- The five 0.7.45 highlights are marked shown, lastProd moves to 0.7.45, and the window is the next five by rank.
- Every line was checked against the code and the PR it names; "messages are not collected" is left out because the page itself says a log line can quote a few words of one.
