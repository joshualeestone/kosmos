---
pre_challenge: true
method: challenge-loop
branch: scan-rescan-grant
diff_hash: 73d064bdec272bc6a6b30608f69e329338031d588b02f5587d0aee558edbe94f
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T08:02:38Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 found zero new BLOCKER / WARNING / CONVENTION; verdict "The branch is clean")
**Total findings:** 0 BLOCKER, 8 WARNINGs, 1 CONVENTION (clean), ~9 NITs, plus 1 self-inflicted test regression caught by the suite
**Fixed:** 8 WARNINGs + the regression + 3 NITs | **Deferred:** the rest of the NITs (non-actionable) | **Asked:** 0

### What this branch is (Josh 0.6.42 #3/#4, front-end half a)

On the first-run find-agents screen (S9), agents in ~/Documents, ~/Downloads, ~/Desktop were not
shown when the macOS file-access grant landed ASYNCHRONOUSLY: the person clicks Allow on S2, the
TCC write propagates a beat later, and they have already advanced to S9, so frScanAgents ran the
TCC-free /api/scan-agents route and their agents were missing (Josh: "it never showed me the agents
on the path"). This adds a light /api/file-access-status poll on S9 that re-runs frScanAgents on the
not-granted -> granted EDGE, on BOTH S9 disk-scanning arms (create and unknown), deferring while
focus is inside #fr-fleet, retrying on a transient granted-scan hiccup (stopping only when the
granted route DELIVERS), serialized by FR_RESCAN_BUSY, and bounded to S9 (frGo / frFinish retire it).
It is built against the EXISTING /api/scan-import; Ice Cream Kitty's engine half (b) (scanning:true
retry + routing the granted walk through the app-exe hatch identity) is a separate branch, so half
(a) inherits her fix behind the same endpoint.

### Validation basis

Final full-suite run (6j) bpjuz9ug5 on the converged HEAD f230cae6: tools/run-tests.sh =
**4989 tests, 4989 pass, 0 fail, VAL_EXIT=0** (node --test + yarn test:shell incl. the #1720
browser-check gate). The hermetic browser check docs/browser-checks/render-firstrun-scan-on-grant-1652.js
= 24/24, and render-firstrun-import-1652.js = 7/7, both on the converged HEAD. Every guard added this
branch was confirmed to red WITHOUT its fix and green with it (per-iteration below). One earlier suite
run showed 4 failures in tools.release-gate.test.js that were proven CONTENTION (unrelated to this
diff; that file passes 22/22 alone), per the "a red green-alone is contention" bulletin.

### Per-Iteration Breakdown

#### Iteration 1 (blindrescan1)
**New findings:** 0 BLOCKER, 3 WARNINGs, 1 NIT (+ CONVENTION clean, 2 STRENGTHs)
- [WARNING] a Back -> forward RETURN to S9 never re-armed the poll (armed only in frScanAgents, which runs only when FR_SCAN===null) --> FIXED 943bf51a (arm from frPaintFleet's create arm on every S9 render; frArmRescanOnGrant idempotent + S9-guarded)
- [WARNING] the grant-flip re-scan does a full #fr-fleet repaint that could wipe in-progress work --> FIXED 943bf51a (defer the re-scan while focus is inside #fr-fleet; resume on blur)
- [WARNING] / [NIT] a double /api/file-access-status read (poll + frScanAgents) with a consistency gap --> FIXED 943bf51a (frScanAgents(grantedHint) skips the second read)

#### Regression (self-inflicted by iter-1, caught by the full suite)
- Moving the arm into frPaintFleet made frArmRescanOnGrant an UNLIFTED reference in the two harnesses that lift frPaintFleet (web.found-every-path-1493 + server.test.js firstRunHarness) -> 7 first-run render tests threw ReferenceError --> FIXED 7d1d5acb (inject a no-op stub in both, like frScanAgents). Lesson: a shared-code change breaks contracts in EXISTING module tests; the full suite catches what the browser check cannot.

#### Iteration 2 (blindrescan2)
**New findings:** 0 BLOCKER, 1 WARNING, 2 NITs
- [WARNING] the UNKNOWN arm (tmux roster unreadable) also disk-scans but was NOT covered by the re-scan -- the more important case (disk is the only source) --> FIXED dd2b85a7 (arm the unknown arm too; guarded by scenario 7)
- NITs deferred (reviewer agreed): grantedHint microsecond-trust; brief FR_SCAN=null redundant-scan window (both negligible/generation-guarded)

#### Iteration 3 (blindrescan3)
**New findings:** 0 BLOCKER, 1 WARNING, 1 CONVENTION-clean, 3 NITs
- [WARNING] render-firstrun-import-1652.js drives frPaintFleet() directly on S9, so this branch's arm left a leaked setInterval firing background GETs --> FIXED beb02afc (frRescanStop() after each direct frPaintFleet())
- [NIT] server.test.js stub comment imprecise ("every render path errors") --> FIXED 20b038e2
- [NIT] adopt-with-fleet arm never disk-scans (pre-existing #1493 gap, out of #3/#4 scope) --> DEFERRED: follow-up card
- [NIT] ARM-RESCAN harness token unreferenced --> DEFERRED: consistent with harness token style

#### Iteration 4 (blindrescan4)
**New findings:** 0 BLOCKER, 2 WARNINGs, 2 NITs
- [WARNING] a transient granted-scan hiccup permanently foreclosed the retry: FR_SCAN_FULL was set true even when /api/scan-import failed (out=null), so every future frArmRescanOnGrant short-circuited --> FIXED 8507e5f2 (FR_SCAN_FULL = full && scanOk; the poll awaits the re-scan and stops only on success, retrying throttled on a hiccup; FR_RESCAN_BUSY serializes ticks; guarded by scenario 8, proven to red without the fix)
- [WARNING] test isolation: scenarios 2/3 armed ungranted polls that leaked into scenario 4, making its 20ms knob inert --> FIXED 8507e5f2 (frRescanStop() after scenarios 2/3; scenario 4's flip-wait tightened to 500ms so the fast poll is proven live)
- NITs deferred: reviewer's 2 verify-notes on the fix were already satisfied by the implementation

#### Iteration 5 (blindrescan5)
**New findings:** 0 BLOCKER, 1 WARNING, 3 NITs
- [WARNING] the "status of 500" console-filter was applied globally, blunting scenarios 1-7's ability to catch an unexpected 500 --> FIXED f230cae6 (scoped behind an expect500 flag set once at scenario 8's start)
- [NIT] redundant FR_SCAN=null in the poll (frScanAgents recomputes it) --> FIXED f230cae6 (dropped; removes the brief-null-window coupling)
- [NIT] retries-forever-while-stalled (documented, S9-bounded) and the exact-24 floor (intended skip-guard) --> no change

#### Iteration 6 (blindrescan6)
**New findings:** 0 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, 2 non-actionable NITs
**Converged** -- "The branch is clean." Six STRENGTHs confirmed the load-bearing FR_SCAN_FULL = full && scanOk semantics, both-arm placement, fully bounded lifetime, a protective (non-vacuous) console filter, test isolation, no TDZ risk, and clean conventions/stubs.
- [NIT] the count guard is a lower bound (`ran < 24`) rather than exact -- inherent to the pattern, message reads "expected 24", not worth changing
- [NIT] a poll comment mentions the create-arm re-arm no-op but not the (equally correct) unknown-arm one -- comment-completeness only

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | return-to-S9 never re-armed the poll | FIXED | 943bf51a |
| 2 | 1 | WARNING | web/index.html | re-scan repaint wipes in-progress work | FIXED | 943bf51a |
| 3 | 1 | WARNING/NIT | web/index.html | double file-access read | FIXED | 943bf51a |
| 4 | 1* | (regression) | *.test.js | unlifted frArmRescanOnGrant -> 7 fails | FIXED | 7d1d5acb |
| 5 | 2 | WARNING | web/index.html | unknown arm not covered by re-scan | FIXED | dd2b85a7 |
| 6 | 2 | NIT | web/index.html | grantedHint microsecond-trust | DEFERRED | negligible |
| 7 | 2 | NIT | web/index.html | brief FR_SCAN=null window | FIXED | f230cae6 |
| 8 | 3 | WARNING | docs/browser-checks/render-firstrun-import-1652.js | leaked poll interval in sibling check | FIXED | beb02afc |
| 9 | 3 | NIT | server.test.js | stub comment imprecise | FIXED | 20b038e2 |
| 10 | 3 | NIT | web/index.html | adopt-with-fleet arm never disk-scans | DEFERRED | pre-existing #1493, out of scope, follow-up card |
| 11 | 3 | NIT | web.found-every-path-1493.test.js | ARM-RESCAN token unreferenced | DEFERRED | harness token style |
| 12 | 4 | WARNING | web/index.html | transient hiccup forecloses retry | FIXED | 8507e5f2 |
| 13 | 4 | WARNING | docs/browser-checks/render-firstrun-scan-on-grant-1652.js | scenario test isolation | FIXED | 8507e5f2 |
| 14 | 5 | WARNING | docs/browser-checks/render-firstrun-scan-on-grant-1652.js | global 500 console filter | FIXED | f230cae6 |
| 15 | 5 | NIT | web/index.html | redundant FR_SCAN=null | FIXED | f230cae6 |
| 16 | 5 | NIT | docs/browser-checks/render-firstrun-scan-on-grant-1652.js | retries-forever (documented) | DEFERRED | S9-bounded, acceptable |
| 17 | 6 | NIT | docs/browser-checks/render-firstrun-scan-on-grant-1652.js | count guard is a lower bound | DEFERRED | inherent pattern |
| 18 | 6 | NIT | web/index.html | poll comment completeness | DEFERRED | comment-only |

### Outstanding questions (ASKED, still unresolved)
None.

### Deferred, needing a follow-up card
- The adopt-with-fleet arm (frPaintFleet, path==='adopt' with a running fleet) never runs the disk
  scan, so an adopt-path user with agents in ~/Documents never sees them, grant or not. This is a
  pre-existing #1493 gap, NOT introduced by this branch, and out of #3/#4 scope (Josh's #4 was the
  create path). File a follow-up card in the discovery lane.

### Half (b) (separate branch, after Kitty's scan-tcc-hatch-2125b merges)
- /api/scan-import will return scanning:true (partial; the hatch's TCC-root rows not yet ready).
  Half (b) = on scanning:true, re-call scan-import ~400-800ms later until scanning:false/absent,
  showing the non-TCC rows immediately. When that lands, half (a)'s scanOk should treat scanning:true
  as not-full so the poll does not stop on a partial.

### Strengths (across all iterations)
- FR_SCAN_FULL = full && scanOk: the poll stops only when the granted route DELIVERED, so a hiccup retries rather than foreclosing (iter 6)
- Arming from frPaintFleet's create AND unknown arms covers the return-to-S9 hole and the more-important unknown path (iter 6)
- Lifetime fully bounded to S9 (frGo + frFinish + per-tick self-retire + generation guard); FR_RESCAN_BUSY serializes ticks; no leak path (iter 5, 6)
- Console filter is genuinely protective, scoped to scenario 8 via expect500 (iter 6)
- Test isolation handled; scenario 4's 500ms-below-1500ms timeout proves the fast knob is live (iter 6)
- No TDZ risk; test stubs in the correct positional slots; no em dashes in any added line (iter 6)
