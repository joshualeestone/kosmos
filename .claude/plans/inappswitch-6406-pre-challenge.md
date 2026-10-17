---
pre_challenge: true
method: challenge-loop
branch: inappswitch-6406
diff_hash: 313b4e97c663b4958f0b6d6fd57e32c72399bb5383e0c407fb541236ae595bc4
validation: pending (Mortals full run queued behind other branches; PR CI's full suite is the merge gate)
subdir_audit: passed
timestamp: 2026-10-17T17:00:06Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 30 (0 BLOCKERs, 14 WARNINGs, 1 CONVENTION, 15 NITs)
**Fixed:** 12 | **Deferred:** 2 | **Asked (awaiting user):** 0

Step 1 of #6406 (Josh 12:04: the other computer opens inside the app window). Step 2 (no sign-in, a pairing-key ticket)
follows #6404. Native follow-ups (a way back to this computer, Cmd-, guard, Windows unchosen mode) are #6411, which the
plan names as what completes "getting back must be possible" in every case.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (ITER_COMMITS was empty)
- [WARNING] web/index.html:20679 — the phone menu's computers copy hard-coded _blank --> FIXED (commit 59b2c112: copies the row's own target)
- [WARNING] native-app/main.swift:5510 — Cmd-, on a run/both Mac showing another computer opens that page's Settings --> DEFERRED to #6411 (needs the native app); stated in the plan
- [WARNING] plan:10 — "getting back" overstated (relay address, stranded if offline) --> FIXED (commit 59b2c112: limits stated, #6411 filed)
- [NIT] Windows unchosen mode wording; header comment and README row; other Open links still _blank; WebKit defineProperty --> FIXED (59b2c112: all four links follow the rule; docs updated)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] same-window switch loses unsent composer text --> FIXED as a stated call (commit 57aad900: plan "Call", helper comment; no beforeunload on the page today)
- [WARNING] three of five link sites untested --> FIXED (commit 57aad900: one helper computersLinkTarget for all sites; source test)
- [WARNING] comment silent on the Windows unchosen-mode exception --> FIXED (commit 57aad900)
- [WARNING] page guess vs native policy unpinned --> noted on #6411 (a native selftest row)
- [CONVENTION] surface gate for render-allagents-4812 --> checked: both gates 0

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the source scan written in iteration 2)
- [WARNING] web.computers-switcher-4648.test.js:84 — the source scan counted calls, could not catch a fifth bare _blank --> FIXED (commit 57b66600)
- [WARNING] index.html:30804 — agent card and Open links untested behaviourally --> FIXED (commit 57b66600: web.allagents-4812 tests in app and browser)
- [WARNING] plan:27 — way-back limit had no card --> FIXED (#6411 cited)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] source scan: two shapes only, fixed 4-line window --> FIXED (commit 0e1f69ca: any target / setAttribute within six lines of a line naming a computer's address)
- [WARNING] Windows unchosen-mode limit had no card --> FIXED (noted on #6411, cited in the plan)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] the way back also needs the other computer's board updated (version skew) --> FIXED (commit f93a0c63: plan limit; #6411 named as completing the ruling)
- [WARNING] the phone menu copy's browser side was untested --> FIXED (commit f93a0c63: browser CONTROL; mutant red)
- [NIT] Dock badge stale while away --> plan limit

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Duplicates of prior findings (confirmed resolved):** 2 (Windows unchosen mode: #6411; the way back: #6411)
- [WARNING] computersInApp would also be true for a future mobile app that registered kosmosBadge --> DEFERRED: no defect today (the iOS and Android trees do not register it, the reviewer grepped); a future bridge belongs with that app's own review
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html:20679 | BRANCH | phone menu copy hard-coded _blank | FIXED | 59b2c112 |
| 2 | 1 | WARNING | native-app/main.swift:5510 | BRANCH | Cmd-, opens other computer's Settings | DEFERRED | #6411 (native) |
| 3 | 1 | WARNING | plan:10 | BRANCH | getting back overstated | FIXED | 59b2c112 |
| 4 | 2 | WARNING | web/index.html:30638 | BRANCH | unsent text lost on switch | FIXED | 57aad900 (stated call) |
| 5 | 2 | WARNING | tests | BRANCH | three link sites untested | FIXED | 57aad900 |
| 6 | 2 | WARNING | web/index.html:30638 | BRANCH | Windows unchosen mode unstated | FIXED | 57aad900 |
| 7 | 3 | WARNING | web.computers-switcher-4648.test.js:84 | SELF | source scan could not catch a fifth link | FIXED | 57b66600 |
| 8 | 3 | WARNING | web/index.html:30804 | BRANCH | agent card / Open links untested | FIXED | 57b66600 |
| 9 | 4 | WARNING | web.computers-switcher-4648.test.js | SELF | scan shapes and window too narrow | FIXED | 0e1f69ca |
| 10 | 5 | WARNING | plan | BRANCH | version skew on the way back | FIXED | f93a0c63 |
| 11 | 5 | WARNING | render-computers-4648.js:167 | BRANCH | phone menu browser side untested | FIXED | f93a0c63 |
| 12 | 6 | WARNING | web/index.html:30595 | BRANCH | a future mobile bridge | DEFERRED | no defect today |

### Validation
- web.computers-switcher-4648 7/7, web.allagents-4812 38/38, web.otheraccounts-6178 27/27, browser-checks-reason-grep 7/7.
- render-computers-4648.js 100 passed (Chromium + WebKit, light + dark).
- Mutants, each red: always _blank on the row; pnav always _blank; a stray _blank / setAttribute on the agent card; pnav copy dropped.
- Both browser-check gates (#1720, #2518): 0.
- Full suite: Mortals queue backed up; PR CI's full suite is the gate before merge.
- No visual change (a link's target only), so no screenshot.

### NITs (non-blocking, across all iterations)
- duplicate bridge probes elsewhere in the page; noopener moot on a same-window link; typeof fallbacks exist for lifted tests

### Strengths (across all iterations)
- relies on the native apps' existing same-window policy for *.kosmosplus.com (Mac every mode; Windows once chosen), traced in code (iterations 1-6)
- one helper for every link to another computer; noreferrer kept; a browser keeps its new tab (iterations 2-6)
- every in-app assertion has a browser CONTROL that can fail (iterations 3-6)
