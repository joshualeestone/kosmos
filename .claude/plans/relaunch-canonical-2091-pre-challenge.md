---
pre_challenge: true
method: challenge-loop
branch: relaunch-canonical-2091
diff_hash: eec2b980fb34a988202311e96e5c70f5eb45ac797a66078b15d010bad59504d5
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T02:00:35Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes — iteration 3 found zero BLOCKERs and confirmed the behavior correct in every scenario (4 STRENGTHs); its one WARNING and one NIT were documentation-only and are addressed.
**Total findings:** 1 BLOCKER, 1 WARNING, 1 NIT (all fixed).
**Fixed:** 3 | **Deferred:** 0 | **Asked:** 0

A native-installer change (highest blast radius: a broken relaunch could leave Josh
with NO Kosmos), so the blind reviews compiled + ran the swift selftest, not just read
source. Validation: `swiftc` compiles clean; `--kosmos-app-stale-selftest` = 39 checks,
exit 0; `native-app.stale-silences.test.js` 5/5; full JS suite green.

### Per-Iteration Breakdown

#### Iteration 1 — the 6.0 validation baseline: clean.

#### Iteration 2 — 1 BLOCKER (the dangerous one this gate exists for)
- [BLOCKER] main.swift — `createsNewApplicationInstance = relaunchingSelf` (my own
  instance-dedup optimization) is dangerous: the fresh copy shares this stale
  process's CFBundleIdentifier, and LaunchServices keys "already running" on the
  bundle id, not the path. `openApplication(at: freshPath, createsNewApplicationInstance:
  false)` would ACTIVATE this same stale instance instead of launching the fresh copy;
  the completion handler reads that as "replacement started" and terminates -- quitting
  to NOTHING, worse than before. --> FIXED: force a new instance unconditionally
  (`= true`). Targeting the FRESH bundle above already fixes the pile-up (it was
  relaunching the SAME stale bundle); self still exits once the new one is confirmed.

#### Iteration 3 — CONVERGED (0 blocking; 1 WARNING + 1 NIT, both doc-only, fixed)
Four STRENGTHs confirmed: `= true` is correct (fresh copy always launches, self exits
after the new one is confirmed); the `?? Bundle.main.bundleURL` fallback is byte-for-byte
the prior behavior (never worse); `pickFresh` cannot return a stale URL and the selftest
is non-vacuous (nil-return + unreadable-skip arms); the completion handler still
terminates self only after the new instance is confirmed; no other relaunch site
hardcodes Bundle.main.
- [WARNING] main.swift — `Bundle(url:)` hands back a CACHED Bundle for the running
  process's own path, so if this process launched from a candidate path that was updated
  on disk, freshAppURL reads the stale in-memory version and returns nil. NOT a regression
  (the fallback then relaunches that path with a new instance from the fresh on-disk
  bytes -- correct), but non-obvious. --> FIXED: added a load-bearing-fallback source note.
- [NIT] main.swift — "settles to one fresh window" was optimistic (two momentarily if a
  fresh one was already open; never zero). --> FIXED: softened the comment.

### Final Ledger
| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 2 | BLOCKER | createsNewApplicationInstance dedup activates the stale instance, quits to nothing | FIXED |
| 2 | 3 | WARNING | Bundle(url:) caching / load-bearing fallback undocumented | FIXED (source note) |
| 3 | 3 | NIT | "one fresh window" comment optimistic | FIXED |

### Outstanding questions (ASKED)
None.

### Strengths
- The fallback is provably never-worse-than-before (byte-for-byte the prior call).
- pickFresh cannot return a stale URL; the selftest is non-vacuous (kills first-regardless,
  last-match, and don't-skip-nil mutations) and runs green (39 checks).
- The behavioral correctness was compiled + executed by two independent blind agents.

### Residual (on #2094, does not gate this fix)
If /Applications itself is stale because make_app could not write it on Josh's new account
(per-executable TCC App-Management denial), there is no fresh copy to reach and this fix
falls back to the honest bounded behavior -- the deeper make_app-on-new-account fix is a
separate morning investigation. Copy tone of the dialog filed for Mona Lisa (#2101).
