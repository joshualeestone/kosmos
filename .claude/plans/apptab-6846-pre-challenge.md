---
pre_challenge: true
method: challenge-loop
branch: apptab-6846
diff_hash: 0a3178b7e3f56988d711f187b5e54c31bd57001cf95fb44fc448c7a98efd83e0
validation: passed
subdir_audit: passed
timestamp: 2026-10-21T17:25:29Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** yes. Iteration 6 (sonnet) returned no BLOCKER, WARNING or CONVENTION finding.
**Reviewer models:** 1 opus, 2 sonnet, 3 opus, 4 sonnet, 5 opus, 6 sonnet.

### Validation (6j)
Focused run, the files that read web/index.html plus the repo-wide guards: every web.*.test.js,
fixture-discipline, no-brand-refs, no-name-refs. 3175/3175, exit 0, at b051660a35 (before the rebase onto main).
The rebase brought 9 commits from main touching server code and plans only, none touching web/index.html;
after it, web.app-tab-6846.test.js plus the three guards ran again: 36/36. No visual change, so no
browser check (plan, Validation). Mutants each went red: showTab instead of the press; the inert refusal removed;
the backdrop refusal removed; showTab instead of the Your Profile press for Settings.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [WARNING] web/index.html: the door ran under first run, an update or a restart (board inert) and answered true --> FIXED (refuses on closest('[inert]'))
- [WARNING] plan: no contract for the app calling a door that may be absent --> FIXED (typeof check; false/undefined/error = not opened)
- [NIT] a refused name closed the phone menu --> FIXED
- [NIT] closing the phone menu dropped focus --> FIXED (focus back to its button)
- [NIT] Settings skipped burgerClose / consolidated --> superseded by iteration 5's fix

#### Iteration 2 (sonnet)
- [WARNING] web/index.html: a hidden Tasks button is still pressed --> DEFERRED, decided: the board hides Tasks on a fresh page until the first status poll and the app offers Tasks only from that poll's tasksTab, so refusing would make an earned tab a silent no-op (reasoning in the code comment and the plan's weakest premise; iterations 3 to 6 checked it and found it sound)

#### Iteration 3 (opus)
- [WARNING] web/index.html: the door changed the page under an open confirmation box (not inert) --> FIXED (the keystroke guard's backdrop test)
- [WARNING] web/index.html: Settings left the consolidated layout --> FIXED, then superseded by iteration 5

#### Iteration 4 (sonnet)
- [WARNING] web/index.html: an open header menu stayed open over the new page --> FIXED by a refusal, then reversed in iteration 5
- [WARNING] plan: did not say what the fake-driven test proves --> FIXED (plan, Validation)

#### Iteration 5 (opus)
- [WARNING] web/index.html: the open-menu refusal was wrong both ways (menus close on a click elsewhere; a sticky picker trigger left native tabs dead) --> FIXED (refusal removed; the press closes them)
- [WARNING] web/index.html: Settings skipped the page's click tidiers (a reaction picker stayed over it) --> FIXED (Settings presses the user menu's Your Profile; every path is now a real press)

#### Iteration 6 (sonnet)
No BLOCKER, WARNING or CONVENTION. Converged.

### Final Ledger

| # | File | Severity | Iteration | Status |
|---|------|----------|-----------|--------|
| 1 | web/index.html inert | WARNING | 1 | FIXED |
| 2 | plan app contract | WARNING | 1 | FIXED |
| 3 | web/index.html hidden Tasks | WARNING | 2 | DEFERRED (decided, reasoned) |
| 4 | web/index.html backdrop | WARNING | 3 | FIXED |
| 5 | web/index.html consolidated Settings | WARNING | 3 | FIXED |
| 6 | web/index.html header menus | WARNING | 4, 5 | FIXED |
| 7 | plan test scope | WARNING | 4 | FIXED |
| 8 | web/index.html Settings tidiers | WARNING | 5 | FIXED |

### Outstanding questions
None.

### NITs (non-blocking)
- web.app-tab-6846.test.js: the userpopSettingsGo pin is whitespace-sensitive; expect churn when that function is edited.
- web/index.html: the backdrop selector is duplicated from the keystroke guard; the test pins both, so drift goes red.

### Strengths
- Every path is a real press, so the page's own handlers and tidiers run rather than a copy of them.
- It answers false with no side effect before touching anything.
- The fake document throws on any unexpected selector or id, so an extra DOM access fails loudly.
