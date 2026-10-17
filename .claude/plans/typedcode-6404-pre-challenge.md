---
pre_challenge: true
method: challenge-loop
branch: typedcode-6404
diff_hash: bb8d81d8fea66c94bd382229f28a21998afda1d0d153762ff1dd49d135fc346a
validation: pending (render-connect-sheet-4637 starts a board; the local heavy queue is 5 deep, so PR CI's browser-checks job runs it and the merge waits on it)
subdir_audit: passed
timestamp: 2026-10-17T18:56:18Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes
**Total findings:** 63 (5 BLOCKERs, 19 WARNINGs, 3 CONVENTIONs, 36 NITs)
**Fixed:** 27 | **Deferred:** 3 | **Asked (awaiting user):** 0

Card #6404 part 1 (Josh's 0.7.55 pairing test: tmnt was let in with nobody comparing the codes). Part 2 (an
already-allowed pair finishes its check once) rides with #6406 step 2; written on the card.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [BLOCKER] web/index.html:50486 — a click on the code field or its label went through askAct as Not me (data-ask="code" fell to deny) --> FIXED (commit 284b13a6: own data-askcode marker; askAct ignores any act but allow/deny)
- [BLOCKER] render-connect-sheet-4637.js:196 — the check used fill() (no click) and logged no denies, so it could not see that --> FIXED (284b13a6: label and field clicks, keyboard typing, deny log)
- [WARNING] typed digits in the markup rebuilt the live region every poll --> FIXED (284b13a6: digits kept in ASK.typed, put back by askWrite)
- [WARNING] wrong-code message not tied to the field --> FIXED (284b13a6: aria-invalid + aria-describedby)
- [CONVENTION] a trailer reason says grid-area for a display:grid token --> noted in the plan (conclusion right; pushed commit left)
- [NIT] maxlength, autocomplete, placeholder contrast --> FIXED (284b13a6)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] Enter path untested --> FIXED (d746728e: Enter arm, 5 / 6 wrong / 6 right)
- [WARNING] #askcard host not driven --> FIXED as a stated call (d746728e: the full card renders only on the Kosmos+ sheet)
- [WARNING] two computer rows untested --> FIXED (d746728e: two rows keep their own typing)
- [NIT] askDigits tied to the tunnel's six-digit code (comment); markup assertion wording --> FIXED

#### Iteration 3
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (the check's selector, the comment)
- [BLOCKER] render-connect-sheet-4637.js:199 — '#askcode-' + PC_ID has the id's colon (invalid CSS; every arm after it would throw) --> FIXED (d082561e: [id="..."] form)
- [BLOCKER] web/index.html:51678 — the joining computer still said "Check it shows this same code" and shrank its code --> FIXED (d082561e: type this code there; code stays large; checks and shots updated)
- [WARNING] the comment claimed typing never rebuilds --> FIXED (d082561e)
- [WARNING] a code changed between typing and the press read as wrong --> FIXED (d082561e: code_new)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html:51676 — matched-while-held repeated the steps to someone who had done them --> FIXED (66dfab7c)
- [NIT] dead small-code CSS; IME Enter --> FIXED (66dfab7c)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:50501 — disabled Allow left Tab landing on Not me --> FIXED (f4567a02: aria-disabled; a press says type all six)
- [WARNING] Allow sent this computer's copy, not what was typed --> FIXED (f4567a02: typed digits in the tunnel's form)
- [WARNING] a correct code typed from a newer screen was called wrong --> FIXED (f4567a02: the list is read once more first)
- [NIT] code_changed wording for computers; stale comment; check label; dead assert --> FIXED (f4567a02)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (the d-nw arm and the hidden-digits read, both from iteration 5)
- [BLOCKER] render-connect-sheet-4637.js:333 — the code_new arm could never reach code_new (the page had not read the new code) --> FIXED (88b9c6b9: the page reads it first)
- [WARNING] the press read old digits the blank field no longer showed --> FIXED (88b9c6b9: only what the field shows)
- [WARNING] label contrast unmeasured --> FIXED (88b9c6b9); dimmed Allow and placeholder stated in the plan

#### Iteration 7
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 1 of the above (the comma, from iteration 4)
- [BLOCKER] web/index.html:51699 — "your other computer to allow" lacked its comma, so the check and the shot could never match --> FIXED (ced17322)
- [WARNING] step 3 let The codes match be pressed before Allow succeeded --> FIXED (ced17322: once <name> says this computer is connected)
- [WARNING] the re-read arm could pass without re-reading (the page's own poll) --> FIXED (ced17322: one page step, re-read counted)
- [NIT] maxlength, wording for too many digits, stale comments --> FIXED; no in-flight guard --> DEFERRED (stated in the plan, as before the change)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs, 1 CONVENTION, 3 NITs
**Duplicates of prior findings (confirmed resolved or decided):** 2 (the button keeps "The codes match": a decided call in the plan; no in-flight guard: stated)
- [NIT] dimmed Allow cue; matched line when not held (pre-existing); a mismatch-plus-changed re-read arm
**Converged** — no new actionable findings. Every expected string traced against what the page renders, punctuation included.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html:50486 | BRANCH | field click sent Not me | FIXED | 284b13a6 |
| 2 | 1 | BLOCKER | render-connect-sheet-4637.js:196 | BRANCH | check could not see it | FIXED | 284b13a6 |
| 3 | 1 | WARNING | web/index.html:50485 | BRANCH | digits in markup | FIXED | 284b13a6 |
| 4 | 1 | WARNING | web/index.html:50488 | BRANCH | error not tied to field | FIXED | 284b13a6 |
| 5 | 2 | WARNING | render-connect-sheet-4637.js | BRANCH | Enter untested | FIXED | d746728e |
| 6 | 2 | WARNING | render-connect-sheet-4637.js | BRANCH | two rows untested | FIXED | d746728e |
| 7 | 3 | BLOCKER | render-connect-sheet-4637.js:199 | SELF | selector with a colon | FIXED | d082561e |
| 8 | 3 | BLOCKER | web/index.html:51678 | BRANCH | joining words contradicted | FIXED | d082561e |
| 9 | 3 | WARNING | web/index.html:50576 | BRANCH | changed code read as wrong | FIXED | d082561e |
| 10 | 4 | WARNING | web/index.html:51676 | SELF | repeated steps | FIXED | 66dfab7c |
| 11 | 5 | WARNING | web/index.html:50501 | BRANCH | Tab reached Not me | FIXED | f4567a02 |
| 12 | 5 | WARNING | web/index.html:50590 | BRANCH | sent own copy | FIXED | f4567a02 |
| 13 | 5 | WARNING | web/index.html:50576 | BRANCH | stale page code | FIXED | f4567a02 |
| 14 | 6 | BLOCKER | render-connect-sheet-4637.js:333 | SELF | arm could not reach code_new | FIXED | 88b9c6b9 |
| 15 | 6 | WARNING | web/index.html:50577 | SELF | hidden digits read | FIXED | 88b9c6b9 |
| 16 | 7 | BLOCKER | web/index.html:51699 | SELF | missing comma | FIXED | ced17322 |
| 17 | 7 | WARNING | web/index.html:51707 | BRANCH | step 3 order | FIXED | ced17322 |
| 18 | 7 | WARNING | render-connect-sheet-4637.js:343 | SELF | re-read arm flaky coverage | FIXED | ced17322 |
| 19 | 7 | NIT | web/index.html askAct | BRANCH | no in-flight guard | DEFERRED | plan Calls |

### Validation
- Node (from the worktree): web.allow-card, web.plus-tab, web.plus-stale, web.task-say-outcome-5842, engine/remote.test.js (227): 0 failing.
- node --check on render-connect-sheet-4637.js and mobile-shots.js.
- Both browser-check gates (#1720, #2518): 0 (five surface trailers, each check confirmed to have no joining-computer row).
- render-connect-sheet-4637.js has NOT run yet: it starts a board; queued locally (5 ahead) and run by PR CI's browser-checks job, which the merge waits on.
- Screenshots (file:// render of the real page functions): ~/work/design-shots/kosmos-6404/allow-card-{empty,typed}--{desktop,phone}--{light,dark}.png and joining-{held,matched}--{desktop,phone}--{light,dark}.png; the rendered words matched the checks' strings.

### NITs (non-blocking, across all iterations)
- see the per-iteration lists above

### Strengths (across all iterations)
- this computer's own code is gone from everything a computer's card shows or speaks (iterations 1-8)
- the press is checked twice: the page compares, then sends what was typed for the tunnel's own check (iterations 5-8)
- phones and browsers unchanged, with a control arm (iterations 1-8)
