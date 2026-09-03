---
pre_challenge: true
method: challenge-loop
branch: settings-unread-2047
diff_hash: e218a92bfc1948ee1adb2c7bdb013932d26d6d2f7b8ba1b1423e156f24102eee
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T20:15:56Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 8 (0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs, plus 2 synthetic initial-validation findings)
**Fixed:** 4 | **Deferred:** 4 (NITs) | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
Baseline validation (6.0) failed on two synthetic findings, both fixed:
- [BLOCKER] initial-validation: #1720 browser-check gate — web/index.html changed with no docs/browser-checks/ assertion --> FIXED (added render-settings-403-2047.js + README row; commit 538e27ec)
- [BLOCKER] initial-validation: #1864 emit-site counts + #1387 runner wiring for the new check --> FIXED (bumped EXPECTED_SITES 34->35, EXPECTED_CATCH_SITES 16->17; wired into tools/browser-checks.sh; commits 4675ac1b, 8769b60a)

First blind review:
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 1 NIT
- [WARNING] web/index.html — paintLimits/refreshEngMode catch blocks called paintSwitch(null) WITHOUT an epoch guard, unlike refreshAutoUpdate's guarded catch. `if (!res.ok) throw` now routes stale non-ok reads into these catches, so a late non-ok could hide a switch a newer read already painted --> FIXED (epoch-guarded both catches; commit 538e27ec)
- [CONVENTION] web/index.html — idiom uniformity (throw-into-catch vs inline) --> FIXED via the epoch-guard, keeping all three of this card's readers on the same throw-into-guarded-catch shape (which matches the card's own refreshAutoUpdate reader)
- [NIT] web.settings-unread-2047.test.js — no 200-{ok:false} corrupt-read arm locking that ok:false stays visible --> FIXED (added a corrupt-read arm per reader; commit 538e27ec)

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Converged** — no new actionable findings. Three NITs recorded and deferred (all called harmless / "not worth a change" by the reviewer):
- [NIT] eng-mode okFalseBody uses {on:true}; eng's real default is off. Deferred: kept uniform so the corrupt-read assertion is shared across the three readers; the invariant under test (switch KEPT, hidden===false) is independent of the on-value.
- [NIT] the pre-existing eng-mode catch comment "BEHAVIOUR still fails toward hidden" overstates for a re-read after ENG_ON=true. Deferred: pre-existing prose describing intended behavior; scoping it is outside this change.
- [NIT] stylistic: refreshAutoUpdate uses a positive `if (mine === X)` guard, paintLimits/refreshEngMode use a negative early-return. Deferred: reviewer said both correct, not worth a change; the added comments describe the semantic match (epoch-guarding the paint), not a syntactic one.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER(synthetic) | tools/browser-checks.sh | #1720/#1387/#1864 browser-check gate for the new check | FIXED | 538e27ec, 4675ac1b, 8769b60a |
| 2 | 1 | WARNING | web/index.html:15208,15314 | catch paint unguarded by epoch | FIXED | 538e27ec |
| 3 | 1 | CONVENTION | web/index.html | idiom uniformity | FIXED | 538e27ec |
| 4 | 1 | NIT | web.settings-unread-2047.test.js | no corrupt-read arm | FIXED | 538e27ec |
| 5 | 2 | NIT | web.settings-unread-2047.test.js:110 | eng okFalseBody {on:true} vs real default off | DEFERRED | harmless; invariant independent of on-value |
| 6 | 2 | NIT | web/index.html:15309 | catch comment overstates "fails toward hidden" | DEFERRED | pre-existing prose, intended behavior |
| 7 | 2 | NIT | web/index.html:15208 vs 15432 | positive vs negative epoch-guard style | DEFERRED | both correct; reviewer said not worth a change |

### Strengths (across all iterations)
- The fix uses the file's established already-safe sibling idiom (ah-toggle/hb-toggle: `if (!res.ok) throw` -> catch -> paintSwitch(null)); res.ok placed before res.json() so the 403 error body is never parsed; the 200-{ok:false} corrupt-read path left untouched (iteration 1, 2).
- The node test is genuinely red-capable and non-vacuous: lifts the REAL readers + real paintSwitch/autoPaint/paintLimitsFrom, the fetch stub RESOLVES with ok:false (the arm the bug lives on) rather than rejecting, and each 403 "absence" assertion is backed by a 200 control. Verified red-capable against pre-fix code (iteration 1, 2).
- The browser check's tab/route/msg mapping is fully correct against the markup and faithfully mirrors render-optout-403-2020.js; routes registered before goto so boot-time reads are intercepted (iteration 2).

### Note on validation contention
Two full-suite runs during the loop showed reds ONLY in tools.release-gate.test.js (git-state/timing-sensitive), on a machine sharing load ~4.5 on 10 cores with a live board and other agents. Those tests pass 22/22 in isolation, and the full JS suite passed 4135/0 directly on HEAD, including tools.release-gate.test.js, once load dropped. The final 6j validation-log run passed cleanly (hash e218a92bfc19). Per the #704 banner and the isolate-to-diagnose bulletin, a red green-alone is contention, not this change — which touches none of that logic.
