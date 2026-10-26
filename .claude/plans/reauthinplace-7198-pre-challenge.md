---
pre_challenge: true
method: challenge-loop
branch: reauthinplace-7198
diff_hash: 0e148ccc77c3f40cad6051c6ccb1d768c7f9ee8310e0f3c9654952cde0478ded
validation: passed
subdir_audit: passed
timestamp: 2026-10-26T23:58:48Z
iterations: 9
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 9 (iteration 1 is 6.0's fail-path; reviewers alternated opus and sonnet from iteration 2)
**Converged:** Yes (iteration 9, sonnet: no BLOCKER or WARNING; 2 NITs accepted below)
**Total findings:** 1 BLOCKER (6.0), 13 WARNINGs, 24 NITs across iterations 2 to 9 (numbered 1 to 39 in the ledger)
**Fixed:** every BLOCKER and WARNING except two deferred with reasons below | **Deferred:** 3 (#11 and #24 to card #7202; #12 cost) | **Asked (awaiting user):** 0
**Validation:** **Rebased onto main 17:30 CDT (base a2b2fe1c52); two conflicts with #7194 in engine/status.js computeLoginAdvisories resolved keeping both; full validation re-run on fede48950e PASSED (hash 0e148ccc77c3, node suite 24408 tests 0 fail, test:shell 4 shards green, audit 0).** Before the rebase: full validation PASSED on this head 7b1ac82255 (hash 0ce3396d2718): node suite 24283 tests (0 fail), test:shell 4 shards all green, type-check, lint, build. Validation 7 before it found the surface gate wanting two checks run (render-acct-stop-focus-4271, render-login-expiry-3532); both were run and pass.
**Browser-check gates:** render-refreshlogin-5407 (the branch's own check) 107/107 and render-login-expiry-3532 82/82 on this head 7b1ac82255; render-acct-stop-focus-4271 25/25 and render-disconnect-stop-2570 passed on the branch, recorded in trailers (45c0c0a1bf, 88102d3db7).

### Per-Iteration Breakdown

#### Iteration 1 (6.0 fail-path)
**Reviewer model:** n/a
- [BLOCKER] browser-check surface gate (render-disconnect-stop-2570.js) --> FIXED 45c0c0a1bf (check run, passed 10:04, trailer)

#### Iteration 2
**Reviewer model:** opus. **New findings:** 4 WARNINGs, 5 NITs. **Self-generated:** 0
- [W] focus lost to body after a notice repaints away; [W] Tab reached Refresh login behind the dialog (inert background); [W] a loose null assertion; [W] mobile-shots route.fetch --> all FIXED 89536d8ddf. NITs 5 to 8 applied; 9 noted in the plan.

#### Iteration 3
**Reviewer model:** sonnet. **New findings:** 3 WARNINGs, 3 NITs. **Self-generated:** 0
- [W] page fail-open when its account list is not loaded, unpinned --> FIXED 73f6797a79 (C4 arm)
- [W] the rest of the page Tab-reachable behind the dialog --> DEFERRED: pre-existing for every opener; follow-up card #7202 (being built)
- [W] accounts.list per recompute --> DEFERRED: a file read on an existing 5 s tick
- NITs 13, 14 FIXED; 15 no action

#### Iteration 4
**Reviewer model:** opus. **New findings:** 1 WARNING, 5 NITs. **Self-generated:** 2 (my iteration-2 code and plan)
- [W] production rowDirs untested --> FIXED f3c31ba6fa (temp-home arm; mutation red)
- NITs 17 to 20 FIXED; 21 not taken

#### Iteration 5
**Reviewer model:** sonnet. **New findings:** 3 WARNINGs, 2 NITs. **Self-generated:** 0
- [W] fail-open sign-in for a removed folder --> DEFERRED as a duplicate of #10's core: /api/connect/start refuses an unknown folder, never creates one
- [W] a non-notice opener ending on a hidden door --> DEFERRED: pre-existing, scoped to notices on purpose
- [W] inert covers the notice slot only --> duplicate of #11, card #7202
- NITs 25, 26 no action

#### Iteration 6
**Reviewer model:** opus. **New findings:** 2 WARNINGs, 4 NITs. **Self-generated:** 1 (my 44px rule)
- [W] the 44px rule hit every dialog button on touch --> FIXED 98b895093c (scoped to #acct-add)
- [W] API-key rows could open OAuth Sign in again --> FIXED 98b895093c (both sides; engine test, mutation red; C5 arm)
- NITs 29, 32 FIXED; 30, 31 deferred or not taken

#### Iteration 7
**Reviewer model:** sonnet. **New findings:** 2 WARNINGs, 3 NITs. **Self-generated:** 0
- [W] plan said the page list "closes" the removed-row window --> FIXED a0daa7da5e ("narrows"; the start request refuses an unknown folder)
- [W] a signed-out folder had no AI Models row and no words --> FIXED (plan and loginAdvGo comment)
- [N] loginAdvInert give-back rule untested --> FIXED (web.loginadvinert-7198.test.js; mutation red). 36 not taken; 37 FIXED

#### Iteration 8
**Reviewer model:** opus. **New findings:** 1 WARNING, 1 NIT. **Self-generated:** 0
- [W] the notices' repaint signature left out the folder, so a folder the board stopped naming stayed on Refresh login --> FIXED 7b1ac82255 (web.loginadvdir-7198.test.js runs the shipped paint: red before, green after)
- [N] plan named the 44px rule as every dialog button --> FIXED

#### Iteration 9
**Reviewer model:** sonnet. **New findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs. **Self-generated:** 0
- [N] a folder change while someone is tabbing through the notices drops focus on the repaint --> accepted: needs the board to change a folder at that moment; the dialog-open case is inert and covered
- [N] the new test's stubs skip the stop-time arm of the signature --> accepted: other tests cover it; this one claims only the folder
