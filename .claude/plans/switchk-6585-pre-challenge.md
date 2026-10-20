---
pre_challenge: true
method: challenge-loop
branch: switchk-6585
diff_hash: 332b7138eb5a264a6bd00acbfa05b8bb6e7ec36fefe76fb277bb24f243201abd
validation: passed
subdir_audit: passed
timestamp: 2026-10-19T16:14:13Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes
**Total findings:** 21 (0 BLOCKERs, 10 WARNINGs, 2 CONVENTIONs, 9 NITs)
**Fixed:** 9 | **Deferred:** 5 | **Asked (awaiting user):** 0

Validation note, stated plainly: 6.0's baseline run and iteration 1's 6g run were both queued behind another agent's machine claim and were stopped by me (exact pid) before they ran a test, so that fixes would not be committed under a pending validation; both recorded status=failed (killed), not a code failure. Per-iteration checks were the focused suites (engine/account-computers, web.computers-switcher-4648, native-app switchhome/computer-mode/download/backhome, the rebuilt app's --kosmos-app-mode-selftest) plus the full web.* suite (3051/3051) and the browser check render-computers-4648 (132/132, chromium + webkit). 6j's full validation ran on the converged HEAD 32f127b4cd: PASSED (22166 tests, 0 fail), audit clean.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/account-computers.js:102 - any non-405 answer (a relay 502) read as an older Kosmos and refused the click --> FIXED (9861c603f1): only 405 and 200 decide; any other answer leaves instant unknown; 502/404/403 test rows
- [WARNING] web/index.html switching screen - stranded over the page when the native app declines to go home --> FIXED (9861c603f1): screen removes itself after 15 s
- [WARNING] web/index.html refusal - no way in to an older computer --> FIXED (9861c603f1): toast names the browser sign-in as the way in
- [NIT] native-app/main.swift - address file read before the click check --> FIXED (9861c603f1)
- [NIT] native-app/main.swift - a start in flight fell through to the sign-in page --> FIXED (9861c603f1): reaches backToThisComputer, which beeps
- [NIT] web.computers-switcher-4648.test.js - pageshow teardown untested

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 1 (refusing an older computer, iteration 1)
- [WARNING] engine/account-computers.js:80 - plan said the 405 side was source-only --> FIXED (043ec88c12): plan records the live measurements (405 from two current gates, 200 from the older one)
- [WARNING] web/index.html:30896 - screen up to 15 s over a refused go-home --> DEFERRED: the page cannot be told (the app's bridges answer only its own board, by design); rare (an update or a start in flight); the cap bounds it
- [CONVENTION] .claude/plans/switchk-6585.md - no timestamp in the plan name --> DEFERRED: matches this repo's practice (backhome-6411.md), and the gate finds plans by branch
- [NIT] web/index.html - constant declared after its function --> FIXED (043ec88c12)
- [NIT] engine/account-computers.js - offline result carried instant --> FIXED (043ec88c12)
- [NIT] native-app/main.swift - two address-file reads per click --> FIXED (043ec88c12)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:30884 - on a phone the refusal toast sat under the open phone menu (a dead tap) --> FIXED (32f127b4cd): the phone menu closes first; unit test asserts it
- [WARNING] web/index.html:30884 - toast gone after 2.6 s, too short for words with an address --> FIXED (32f127b4cd): msgToast takes an optional hold; this one holds 9 s
- [WARNING] native-app/main.swift - going home depended on WebKit calling computersGo's script-made click a link click, never measured in the app --> FIXED (32f127b4cd): any main-frame navigation to the own address while on another computer goes home (10 selftest rows, expected 191); the wiring test pins that it is not keyed on linkActivated
- [WARNING] web/index.html:30880 - the home row could be refused if its own gate answered 200 --> DEFERRED: the Mac app and its tunnel ship in one bundle, so a computer running this app has a ticket-taking gate
- [CONVENTION] .claude/plans/switchk-6585.md:41 - wrong test count --> FIXED (32f127b4cd)
- [NIT] web/index.html:30858 - screen during a refused go-home (same as iteration 2's deferral)
- [NIT] web.computers-switcher-4648.test.js - no test for the pageshow teardown or the 15 s cap

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 new CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates:** 1 (plan name, deferred in iteration 2)
**Converged** - no new actionable findings.

#### Iteration 5 (after CI)
**Reviewer model:** sonnet
CI's browser-checks on Linux chromium found the switching screen short of the right edge by the page scrollbar gutter (covers: false). Fix 0604226d0a: one CSS rule adding #cswitch-screen to the html:has(...) { overflow: hidden; scrollbar-gutter: auto } rule the update overlay and first-run use. A fresh blind review of the whole diff after the fix: 0 BLOCKERs; 2 WARNINGs, both duplicates (the weakest premise, deferred in iteration 3; and a probe-per-open note the reviewer judged fine); 2 NITs.
**Validation on this HEAD:** web.* suite 3051/3051. The full suite PASSED on 32f127b4cd (22166, 0 fail); the only change since is the one CSS rule above. CI on Linux is the check that measures the fix.
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/account-computers.js:102 | BRANCH | non-405 read as older | FIXED | 9861c603f1 |
| 2 | 1 | WARNING | web/index.html (screen) | BRANCH | screen stranded on a declined go-home | FIXED | 9861c603f1 |
| 3 | 1 | WARNING | web/index.html (refusal) | BRANCH | no way in to an older computer | FIXED | 9861c603f1 |
| 4 | 2 | WARNING | engine/account-computers.js:80 | BRANCH | 405 evidence recorded as source-only | FIXED | 043ec88c12 |
| 5 | 2 | WARNING | web/index.html:30896 | BRANCH | screen up to 15 s over a refusal | DEFERRED | page cannot be told; rare; capped |
| 6 | 2 | CONVENTION | .claude/plans/switchk-6585.md | BRANCH | plan name without timestamp | DEFERRED | repo practice |
| 7 | 3 | WARNING | web/index.html:30884 | BRANCH | phone menu hides the toast | FIXED | 32f127b4cd |
| 8 | 3 | WARNING | web/index.html:30884 | BRANCH | toast too short | FIXED | 32f127b4cd |
| 9 | 3 | WARNING | native-app/main.swift | BRANCH | go-home keyed on an unmeasured navigation type | FIXED | 32f127b4cd |
| 10 | 3 | WARNING | web/index.html:30880 | BRANCH | home row refusable | DEFERRED | one bundle |
| 12 | CI | WARNING | web/index.html (gutter) | BRANCH | switching screen short of the edge on classic scrollbars | FIXED | 0604226d0a |
| 11 | 3 | CONVENTION | .claude/plans/switchk-6585.md:41 | BRANCH | wrong test count | FIXED | 32f127b4cd |

### NITs (non-blocking, across all iterations)
- [NIT] pageshow teardown and the 15 s cap have no automated test (iterations 1, 3)
- [NIT] screen shown during a refused go-home (iterations 3, 4)
- [NIT] a false 200 from a proxy would refuse a capable computer; recomputed on each menu open (iteration 4)
- [NIT] any navigation to the own address from another computer goes home, including a link in a message (iteration 4; deliberate)
- Fixed nits listed under their iterations.

### Strengths (across all iterations)
- probeReach learns online and instant-switch support from the one HEAD it already made; only measured answers decide (iterations 1-4)
- switchGoesHome is pure with selftest rows; the wiring test pins its order before the link rules (iterations 1-4)
- the browser check measures real rendering: coverage, z-order, inked canvas, opaque ground, exact toast (iterations 1, 2, 4)
- no new power for any page: remote pages still cannot mint tickets; the native intercept loads only the app's own board (iteration 4)
