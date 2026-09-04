---
pre_challenge: true
method: challenge-loop
branch: first-run-2124-2125
diff_hash: 03da2259aadb42693bc902aec39a52c68ab1e1a907a589be3bf7f7a92650e943
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T17:02:20Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5 surfaced zero new BLOCKERs/WARNINGs/CONVENTIONs; one NIT)
**Total findings:** 16 (1 BLOCKER, 6 WARNINGs, 0 CONVENTIONs, 9 NITs)
**Fixed:** 10 | **Deferred:** 6 | **Asked (awaiting user):** 0

Scope: kosmos#2124 ONLY (macOS single-instance guard in `native-app/main.swift`).
#2125 is described in the plan but deliberately NOT implemented in this branch.
Baseline (6.0) passed clean, so the first sub-agent review is iteration 1.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] main.swift relaunch-failure path — the fallback handoff token was written before `openApplication` but never removed if the open FAILED; the instance stays open, so a manual reopen within the 30s TTL could skip the single-instance guard and run as a duplicate (the exact bug #2124 fixes) --> FIXED (8c360f12): remove the token on the failure path, before the modal.
- [WARNING] main.swift:383 — the "always delete ... which is safe anyway" comment over-stated: a lingering token is NOT harmless when another instance is up --> FIXED (8c360f12): reworded to name the real risk and the failure-path cleanup.
- [NIT] main.swift consume doc — "CONSUMES both" over-stated (only the token file was removed) --> FIXED (8c360f12, refined in 3e42c72a).
- [NIT] main.swift constants — `k`-prefixed constant names diverge from the file's camelCase globals --> DEFERRED: `k`-prefix is idiomatic AppKit/Cocoa constant convention, reviewer rated low concern, renaming would churn the wiring test for zero behavioral gain.
- [NIT] main.swift top comment — "leaving the /Applications copy as THE app" over-stated (the guard makes the FIRST-launched instance canonical) --> FIXED (8c360f12): reworded to match the plan's install-location residual.

#### Iteration 2
**New findings:** 1 BLOCKER, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [BLOCKER] main.swift defer path — `NSApp.terminate(nil)` was called WITHOUT first setting `isActuallyQuitting = true`, so it re-entered `applicationShouldTerminate`, popped the "Your agents keep running" quit dialog on the duplicate, and a dismissal returns `.terminateCancel` leaving the duplicate OPEN, defeating #2124's main path --> FIXED (3e42c72a): set the flag before terminate, mirroring the #2094 relaunch path.
- [WARNING] instance-guard test — the wiring test pinned that terminate is called but not that it terminates CLEANLY (no `isActuallyQuitting` assertion), which is why the BLOCKER slipped through --> FIXED (3e42c72a): assert the defer block sets `isActuallyQuitting` BEFORE terminate.
- [WARNING] main.swift token — the GLOBAL token file can, in a sub-second manual-launch race during an auto-update, be consumed by an unintended process (its "either suffices" property cuts the wrong way) --> DEFERRED: inherent to any disk-based fallback (a process-targeted token needs a secret handed via env, which IS channel 1); channel 1 is process-specific and protects the intended fresh copy; harm is one recoverable window vs the quit-to-nothing the token prevents; documented in-code as an accepted residual.
- [NIT] main.swift env — the env handoff had no bound and merged onto the full environment, so `KOSMOS_RELAUNCH_HANDOFF` propagated to descendant processes (the engine `startBoard` spawns); a descendant that ever launched the GUI would carry a stale handoff and wrongly skip the dedup --> FIXED (3e42c72a): `unsetenv` the key after consuming it (corrects an earlier comment that wrongly claimed it could not be unset).
- [NIT] main.swift:491 — `other?.activate()` deprecation on recent SDKs --> DEFERRED: compiles warning-free at the repo floor (`arm64-apple-macos13.5`) and default target; the call was chosen to avoid a macOS-14 deprecation.

#### Iteration 3
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT (+ 3 STRENGTHs)
- [WARNING] main.swift otherRunningInstance — a runtime enumeration cannot close a truly simultaneous-instant double-launch (both enumerate before either registers) --> DEFERRED: does NOT affect the reported #2124 bug, which is SEQUENTIAL (installer copy, then a later user-launched /Applications copy); closing it needs an OS-level launch lock, out of scope for this launch-critical fix; documented in-code as an accepted residual (bacf2158).
- [NIT] main.swift token TTL — a backward clock jump makes the fallback token silently no-op --> DEFERRED: safe by design (the `>= 0` guard rejects negative deltas and falls back to the primary env channel); reviewer stated no change needed.

#### Iteration 4
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs (+ 7 STRENGTHs)
- [WARNING] main.swift defer/activate — `other?.activate()` (bare process activation) surfaces the survivor process but not its WINDOW; this app hides its window on close (`closingWindowQuits=false`), so a duplicate launch could exit with nothing coming forward (reads as broken) --> FIXED (4d5f5048): `activate(options: [.activateAllWindows])` raises the survivor's window; warning-free at the 13.5 floor; the remaining orderOut-hidden-window edge is documented as an accepted residual (needs a cross-process reopen/notify, a follow-up beyond the reported sequential bug).
- [NIT] main.swift — the `Bool` result of `activate()` was discarded (no diagnosis of a declined activation) --> FIXED (4d5f5048): log on a declined activation.
- [NIT] instance-guard test — the source is read via a cwd-relative path --> DEFERRED: matches the sibling native-app source-reading test convention (`native-app.stale-silences.test.js`); the suite always runs from repo root.

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT (+ 5 STRENGTHs)
**Converged** — no new actionable findings.
- [NIT] main.swift:329 — `kRelaunchHandoffTTL` (30s) could be tighter; reviewer framed it explicitly as "not a bug, a tightening suggestion" --> NOTED, not acted on: the actual manual-launch race window is the sub-second write-to-consume gap (unaffected by the TTL), and the iteration-1 failure-path token removal already closes the lingering-token-with-another-instance-up path, so tightening the TTL is marginal.

### Final Ledger

| # | Iter | Category | Location | Description | Status | Resolution |
|---|------|----------|----------|-------------|--------|------------|
| 1 | 1 | WARNING | main.swift relaunch-fail | token left on disk if relaunch open fails -> possible duplicate | FIXED | 8c360f12 |
| 2 | 1 | WARNING | main.swift consume | "safe anyway" reasoning over-broad | FIXED | 8c360f12 |
| 3 | 1 | NIT | main.swift consume doc | "consumes both" over-stated | FIXED | 8c360f12 / 3e42c72a |
| 4 | 1 | NIT | main.swift constants | k-prefix vs camelCase | DEFERRED | idiomatic AppKit convention |
| 5 | 1 | NIT | main.swift top comment | "/Applications wins" over-stated | FIXED | 8c360f12 |
| 6 | 2 | BLOCKER | main.swift defer | terminate without isActuallyQuitting -> quit dialog can cancel dedup | FIXED | 3e42c72a |
| 7 | 2 | WARNING | instance-guard test | did not assert quit-dialog suppression | FIXED | 3e42c72a |
| 8 | 2 | WARNING | main.swift token | global token manual-launch race | DEFERRED | inherent to disk fallback; documented; env protects intended copy |
| 9 | 2 | NIT | main.swift env | env unbounded, propagates to descendants | FIXED | 3e42c72a (unsetenv) |
| 10 | 2 | NIT | main.swift activate | activate() deprecation | DEFERRED | warning-free at floor; chosen to avoid deprecation |
| 11 | 3 | WARNING | main.swift otherRunningInstance | simultaneous-instant double-launch race | DEFERRED | out of scope; needs OS lock; documented residual (bacf2158) |
| 12 | 3 | NIT | main.swift token TTL | clock-skew token no-op | DEFERRED | safe by design; falls back to env |
| 13 | 4 | WARNING | main.swift defer/activate | bare activate() doesn't surface hidden window | FIXED | 4d5f5048 (activateAllWindows) + residual doc |
| 14 | 4 | NIT | main.swift activate | activation Bool discarded | FIXED | 4d5f5048 (log) |
| 15 | 4 | NIT | instance-guard test | cwd-relative source path | DEFERRED | matches sibling convention; suite runs from repo root |
| 16 | 5 | NIT | main.swift:329 | TTL could be tighter | NOTED | marginal; real race is write-to-consume gap, not TTL |

### NITs (non-blocking, across all iterations)
- k-prefix constant naming (iter 1) — deferred, idiomatic.
- activate() deprecation (iter 2) — deferred, warning-free at floor.
- clock-skew token no-op (iter 3) — deferred, safe by design.
- cwd-relative test source path (iter 4) — deferred, matches convention.
- TTL 30s tightening (iter 5) — noted, marginal.

### Strengths (across all iterations)
- Two-channel #2094 handoff: process-specific launch-env var (robust primary, no disk/timing) + short-TTL token file (belt-and-suspenders fallback); `.merging` preserves the parent env so the fresh copy keeps KOSMOS_HOME etc.
- One-shot consumption complete across every outcome: env `unsetenv`'d (no descendant inheritance), token always deleted, and removed on the relaunch-FAILURE path too; all three cleanup sites pinned by tests.
- Pure `shouldDeferToExistingInstance(handoff:otherRunning:) = !handoff && otherRunning` factored out and machine-checked at build by the `--kosmos-app-instance-selftest` hatch, diffed against a 4-row expected table (emission order matches byte-for-byte; hatch exits before app.run(); reuses the sibling reload/menu gate's perl alarm + stderr-capture pattern).
- `isActuallyQuitting = true` set before `NSApp.terminate` so the dedup cannot be cancelled by the quit dialog; ordering pinned by a test.
- TTL guards both directions (`<= TTL` and `>= 0`); source-reading tests guarded against false-pass (40000-byte instrument check, landmark-anchored defer-block slice).
- Accepted residuals (global-token manual-launch race, simultaneous-instant enumeration race, orderOut-hidden-window activation edge, install-location tangle) each documented in-code with accurate reasoning, distinguished from the reported sequential #2124 bug.
- No em dashes in any changed file (house rule upheld); typecheck clean at the repo floor `arm64-apple-macos13.5`.
