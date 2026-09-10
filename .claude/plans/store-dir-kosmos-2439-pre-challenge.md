---
pre_challenge: true
method: challenge-loop
branch: store-dir-kosmos-2439
diff_hash: 228b5bf080f804897de4950c6cf6a211e54820517f28b2adf99578a040f07dd4
validation: passed
subdir_audit: passed
timestamp: 2026-09-08T02:56:16Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 (5 blocker-free; findings stabilized to documented deliberate tradeoffs)
**Converged:** Yes
**Validation:** full suite GREEN on the current rebased HEAD — 5242 pass, 0 fail. (An earlier
inherited red, web.change-dialog.test.js from #2463, was fixed on origin/main by #2464 and is gone
after the rebase.) All shell suites 0 failures, incl. the release install-gate (test-install.sh:
102/0 via a real build) and the a11y-writer cross-language pin.
**Total findings:** 3 BLOCKERs, 6 WARNINGs, 8 NITs (+ many STRENGTHs)
**Fixed:** 3 BLOCKERs + 4 WARNINGs + 3 NITs | **Deferred (documented):** 2 WARNINGs + 5 NITs

### The two BLOCKERs (both real launch risks, both outside the unit suite, both verified)
1. **native-app/main.swift cross-language seam** (iter 1) — board.token / a11y-status / file-access
   IPC / relaunch-handoff hardcoded the AgentWorkforce leaf; after the rename the native app and JS
   engine resolved different dirs (fresh installs break immediately; a migrating update renames the
   dir out from under the still-running app). Fixed with a `storeLeaf(base:)` helper resolving the
   CURRENT leaf, routed through all four resolvers. Verified: test-a11y-writer-mock (compiles
   main.swift, runs the hatch) confirms the Swift writer and JS reader agree on the leaf (12/12).
2. **tools/test-install.sh release install-gate** (iter 4) — the gate release.sh runs on every cut
   still asserted the old leaf, so the .48 cut would ABORT. Not caught by run-tests.sh (bash -n only
   there). Fixed all leaf literals; verified via a real build + KOSMOS_INSTALL_GATE run (102/0).
   (The 3rd BLOCKER was a 6g synthetic: two Swift source-wiring guards pinned the old literal.)

### Fleet-safety incident + fix (surfaced live during the loop)
The migration is triggered by store.root(), so an un-sandboxed store.root() call migrates the
operator's REAL store. Measured on the shared box: full-suite runs from this worktree renamed the
live fleet store and a re-merge was undone by the next run — a loop. Fixed: a
`KOSMOS_NO_LEGACY_MIGRATION` opt-out (engine/store.js) that tools/run-tests.sh sets, so the suite
never renames the real store; a real end-user install never sets it, so it still migrates. Verified:
a full suite run leaves the real ~/Library/Application Support byte-counts unchanged. Surfaced to
Splinter/Angel for the one-time Kosmos->AgentWorkforce merge.

### Deferred, with reasoning (stable across re-flags)
- [WARNING] create.js supportDir() is a PURE resolver, not store.ROOT — routing it through the
  migration gives a read-only resolve a real-store mutation side-effect (the incident above); the
  orphan it would defend is not reachable (the board touches store.ROOT at boot before any create).
- [WARNING] the run-tests.sh opt-out is suite-level, so a single un-sandboxed `node --test <file>`
  run on the shared box that bypasses the harness could still migrate — a known, accepted tradeoff
  (per-file detection is version-fragile); mitigated operationally by a machine-wide opt-out on the
  shared box (recommended to Splinter). A real user install is never affected.
- [NIT] setup.sh uninstall fallback prefers AgentWorkforce (only on a consult timeout) and a
  dual-existing uninstall leaves the orphaned legacy dir — both non-destructive, rare, out of scope.
- [NIT] tools/browser-checks.sh + test-install.sh hardcode the Kosmos leaf (a shell script cannot
  cheaply require store.APP); they red loudly (file-not-found) on a future rename rather than pass
  vacuously.

### Strengths
- Migration is never-clobber / never-throw / atomic, keyed once-per-resolved-root.
- Cross-language orphan-prevention is consistent across all three writers (engine migrates first;
  installer + native app write the current leaf, never pre-creating Kosmos).
- All JS tests derive the leaf from store.APP; the Swift seam has hard cross-language pins.
- The uninstall rm-guard accepts both leaves while preserving all five safety refusals.
