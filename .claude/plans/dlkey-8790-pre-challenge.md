---
pre_challenge: true
method: challenge-loop
branch: dlkey-8790
diff_hash: 7efa7e72984777d653ad5e8e2e6bb08bdd8bab34a6865209dc282c7fc2ff7688
validation: passed
subdir_audit: passed
timestamp: 2026-11-20T10:49:48Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes: round 5 found no BLOCKER and no SHOULD; its useful NITs are applied (an 8 s fallback when no key comes, a slow-key case, comments and plan).
**Design owner:** Baron Draxum, owner of the relay rule (#3838), accepted a one-use download key with six conditions (Fleet Builders m5149); each is held and tested (see the plan).
**Validation:** the full suite here (validation_log_run_or_skip), status clean, 30,301 node tests, 0 failed, all four shell shards. A first run found one red (browser-checks-pr-select-4119: the check's sample file name matched a hostile test name); fixed, then this clean run.

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] the capture-phase listener made an attachment card download instead of opening its preview --> FIXED: window, bubble phase, a click another handler took is left alone
- [SHOULD] the Mac app viewer's link was taken twice --> FIXED by the same change
- [SHOULD] keys left live on current browsers --> FIXED: a browser that sends Sec-Fetch-Site is told no key is needed
- [SHOULD] an encoded %62dl was read as bdl but not redacted --> FIXED: only a literal bdl= counts
- [SHOULD] a key beside another credential --> FIXED: refused
- [SHOULD] current browsers paid an extra wait --> FIXED in round 2

#### Iteration 2
- [SHOULD] a refused keyed download answered JSON WebKit could save --> FIXED: refuseDownload answers 204 for a key-opened request
- [SHOULD] the first download on a current browser started outside the click --> FIXED: one look at page load ({ask: true})
- [NIT] a key accepted beside cross-site; key read from the path; comments --> FIXED

#### Iteration 3
- [SHOULD] a refused look left current browsers asking on every click --> FIXED: 403/404 means no keys
- [SHOULD] a copied key opened in a current browser --> FIXED: refused with any Sec-Fetch-Site
- [SHOULD] Option-click (Safari download linked file) skipped --> FIXED
- [NIT] a test that could not fail; comments --> FIXED

#### Iteration 4
- [SHOULD] boardTokenOk answered yes for a key-opened request, unused and untested --> FIXED: removed, a key opens the gate only
- [SHOULD] the gate's own refusal of a keyed download answered JSON --> FIXED: 204, and for a gone attachment
- [NIT] Shift-click, README, a click-time not-needed test, the check's stand-in note --> FIXED

#### Iteration 5
- [NIT] a mint that never answers left the click doing nothing --> FIXED: 8 s fallback to the plain link
- [NIT] a slow key untested; stale comments and plan --> FIXED
- [NIT] accepted and written in the plan: a keyed attachment whose file cannot be opened still answers JSON; a non-enforcing board answers JSON; nothing to observe for round 4's removal
