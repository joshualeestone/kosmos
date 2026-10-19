---
pre_challenge: true
method: challenge-loop
branch: askbanner-6315
diff_hash: 7ac58291112c96cbe4248f84f43a034cafd9d45ca55be7e59f08edb2f086e6a2
validation: not-run (focused checks run instead; the shared local suite queue was backed up; PR CI runs the full suite)
subdir_audit: passed
timestamp: 2026-10-17T02:51:23Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12
**Converged:** Yes. Iteration 12 raised two WARNINGs, both duplicates of entries already decided in the plan (the
close moving on to a connected-here line; the first_seen premise, since checked in the coordinator), and NITs only.
**Total findings:** about 45 (0 BLOCKERs, about 28 WARNINGs, the rest NITs and CONVENTIONs)
**Fixed:** most | **Deferred (decided, in the plan):** about 7 | **Asked:** 0

**Validation, stated honestly:** the full local suite was NOT run. At the final rebased head (0 behind origin/main):
render-plus-asks-signin-4610.js (all arms, 1400 and 390), render-plus-panel-3829.js, render-connected-here-5786.js
and render-connect-sheet-4637.js all green; the browser-check surface gate green; every web.*.test.js (372 files,
2927 tests) 0 fail. Four mutants run by hand turned their arms red (ignore the dismissal; put away everything;
always move focus; the old key).

**Disclosed:** the iteration-10 commit's trailer said render-connect-sheet-4637.js ran green; it had not been rerun
there and would have failed (its span count read the new aria-hidden glyph). Found on the rebased run, fixed in the
check, and green now.

### Per-Iteration Breakdown (condensed)

#### Iteration 1
**Reviewer model:** sonnet
- [WARNING] web/index.html — a shrinking set brought the notice back --> FIXED (every key must be put away)
- [WARNING] web/index.html — a dismissal never cleared; same device asking again stayed hidden --> FIXED
- [WARNING] web/index.html — focus dropped to body after dismiss --> FIXED
- [WARNING] web/index.html — a failed setItem ignored the dismissal --> FIXED
- [NIT] focus ring, label --> FIXED

#### Iteration 2
**Reviewer model:** opus
- [WARNING] key on device id alone: a re-ask after a closed tab stayed hidden --> FIXED (device@first_seen)
- [WARNING] two tabs: in-memory record shadowed storage --> FIXED
- [NIT] the check raced the page's 5 s poll --> FIXED (served list + pollAsk)
- a reload's first paint wiped the record --> FIXED (found by the new reload arm)

#### Iteration 3
**Reviewer model:** sonnet
- [WARNING] an Allow in this tab cleared the record --> FIXED
- [WARNING] focus fallback could land on a hidden control --> FIXED
- [WARNING] the reload arm could pass before the list loaded --> FIXED
- [WARNING] storage failure untested --> FIXED (throwing-storage arm)

#### Iteration 4
**Reviewer model:** opus
- [WARNING] an empty (unreadable) list cleared the record --> FIXED (never cleared on an empty list)
- [WARNING] two tabs could undo each other --> FIXED (same change)
- [NIT] Review clears before a decision --> recorded as Josh's ruling

#### Iteration 5
**Reviewer model:** sonnet
- [WARNING] a returning notice named the dismissed requests, not the new browser --> FIXED (names what is fresh)
- [WARNING] first_seen 0 could never return --> FIXED (key adds denied_at)
- [NIT] record replaced not merged; another-tab write untested --> FIXED

#### Iteration 6
**Reviewer model:** opus
- [WARNING] dismiss put away a connected-here browser the line never named (its Undo) --> FIXED; mutant red
- [WARNING] here arm raced the poll --> FIXED

#### Iteration 7
**Reviewer model:** sonnet
- [WARNING] closing the request moves on to the here line --> DEFERRED (decided: its Undo must be seen); arm pins it

#### Iteration 8
**Reviewer model:** opus
- [WARNING] focus moved off a notice still showing --> FIXED; mutant red
- [WARNING] storage recovery dropped other tabs' dismissals --> FIXED
- [NIT] Review arm could pass without leaving Kosmos+ --> FIXED

#### Iteration 9
**Reviewer model:** sonnet
- [WARNING] recovery: tab ignored storage until the next write --> FIXED (storage and tab record always combined)

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] brief return after a denial in another tab --> DEFERRED (a deny-then-ask is shown on purpose)
- [NIT] glyph read aloud --> FIXED (aria-hidden span)

#### Iteration 11
**Reviewer model:** sonnet
- [WARNING] first_seen premise --> duplicate; later checked in coordinator/src/db.rs
- [WARNING] the tab record only grows --> comment says so

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 (two WARNINGs, both duplicates); NITs only
**Converged**

### Deferred / decided (see the plan)
- [WARNING] Closing a request line can move the notice on to a connected-here line it had not named.
- [WARNING] A device turned away elsewhere can bring the notice back for a poll or two.
- [NIT] A request whose first_seen and denied_at are both 0 cannot come back once put away.

### Strengths
- Only the compact off-Plus notice changed; the Kosmos+ cards, #3978 focus and #5786 connected-here card hold.
- Every hide arm has a control that shows; the check drives the page's own poll path.
