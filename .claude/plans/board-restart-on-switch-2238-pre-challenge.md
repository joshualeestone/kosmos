---
pre_challenge: true
method: challenge-loop
branch: board-restart-on-switch-2238
diff_hash: a62b0f6c0a97b0c01ec4400c1b4ec599564eab9696f4d5cd6a51e42ab4788eed
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T17:01:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (plus the 6.0 baseline validation pass)
**Converged:** Yes — iteration 3 produced zero new actionable findings.
**Total findings:** 10 (2 BLOCKER/validation-class, 3 WARNINGs, 5 NITs)
**Fixed:** 4 | **Deferred:** 6 | **Asked:** 0

kosmos#2238: multi-Kosmos switch was broken — POST /api/worlds/active flipped the registry pointer but the running board froze its world env at boot (worlds.applyActiveWorldEnv runs once at start()), so it served the stale world until restart. This branch adds a fail-safe board self-restart primitive (engine/boardrestart.js), a booted-world capture reported on /api/status (engine/worldenv.js + server.js), and the route wiring in POST /api/worlds/active. The final suite is fully green (4911/4911) on the merged tree (origin/main merged in for Renet's connect-confirm fix #2344).

### Per-Iteration Breakdown

#### 6.0 baseline validation
**New findings:** 1 (validation-class BLOCKER)
- [BLOCKER] engine/windows-coupling-audit-1732.js — boardrestart.js's `process.env.HOME` LaunchAgents path was an unclassified Windows-hostile env-home coupling --> FIXED (3c4ca565): added the classified macos-only-branch inventory row. Genuinely macOS-only (on Windows HOME is undefined, canSelfRestart returns false, fail-safe manual restart). The ratchet caught a real cross-platform-classification requirement my change introduced.

#### Iteration 1
**New findings:** 1 WARNING, 2 NITs
- [WARNING] engine/boardrestart.js canSelfRestart — read KeepAlive from the DISK plist, but relaunch depends on the LOADED launchd job config; a plist edited-without-reload or a `launchctl disable`d job leaves disk saying KeepAlive while the live job will not relaunch --> a FALSE POSITIVE that bricks the board --> FIXED (d348e99f): now also require the LOADED job (`launchctl print` `properties = ... keepalive ...`) to have keepalive active AND run this exact pid; kept the disk unconditional-`<true/>` check to reject a conditional KeepAlive. New test covers the divergence case.
- [NIT] server.js — isNoop compared the raw request id, not the canonical world.id --> FIXED (d348e99f).
- [NIT] server.js — synchronous execFileSync (launchctl) on the request path blocks the event loop up to 5s --> DEFERRED: a rare operator-initiated switch, 5s-timeout-bounded, and it mirrors machine.js's existing execFileSync pattern.

#### Iteration 2
**New findings:** 1 WARNING, 2 NITs
- [WARNING] engine/boardrestart.js loadedJob — the `properties = ... keepalive ...` format was only stub-validated, and the loaded check detects keepalive PRESENT but not UNCONDITIONAL (a conditional loaded KeepAlive also shows `keepalive`), leaving a disk-unconditional-but-loaded-conditional residual --> FIXED (3038713d, documentation): verified the format against the LIVE com.kosmos.board (`properties = keepalive | runatload | inferred program | managed LWCR | has LWCR`), and bounded the residual by MEASURING that com.kosmos.board is always written unconditional (`<key>KeepAlive</key><true/>` in the live plist; restart-local-board.sh documents it), so the divergence never exists — and even in the impossible case the failure is a recoverable manual restart, never data loss.
- [NIT] server.js — restarting computed at request time vs the +500ms selfRestart re-check can disagree with reality --> DEFERRED: benign over-signal, the comment acknowledges it, restartRequired stays honest, and it degrades to the manual path (Angel's reconnect has a ~150s timeout fallback).
- [NIT] tests — no end-to-end test of the fired-restart (setTimeout --> selfRestart) branch --> DEFERRED: composed of tested primitives (selfRestart's guarded stop + the asserted restarting field) and exercised by the release gate on a real board.

#### Iteration 3 — CONVERGED
**New findings:** 0 actionable (1 WARNING is a confirmed-resolved duplicate; 2 NITs are refinements of deferred items).
- [WARNING] engine/boardrestart.js — the conditional-KeepAlive residual, re-raised. DEDUPED / confirmed-resolved: the reviewer explicitly stated the header documentation covers it and it is "a bounded, documented risk resting on an external invariant, not a live defect."
- [NIT] server.js — restarting:true-then-stop-fails leaves the client's manual fallback ungated --> DEFERRED: covered by Angel's reconnect contract (a ~150s timeout falls back to the manual banner); the server cannot notify the client after the response is sent.
- [NIT] server.js — canSelfRestart runs twice per switch (request + inside selfRestart) --> DEFERRED: intentional TOCTOU defense, and cheap.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 6.0 | BLOCKER | windows-coupling-audit-1732 | unclassified macOS LaunchAgents coupling | FIXED | 3c4ca565 |
| 2 | 1 | WARNING | boardrestart.js | disk-plist vs loaded-config KeepAlive false-positive brick | FIXED | d348e99f |
| 3 | 1 | NIT | server.js | isNoop used raw id not world.id | FIXED | d348e99f |
| 4 | 1 | NIT | server.js | sync execFileSync on request path | DEFERRED | rare/bounded, matches machine.js |
| 5 | 2 | WARNING | boardrestart.js | loaded-keepalive format + conditional residual | FIXED (documented) | 3038713d, verified + bounded |
| 6 | 2 | NIT | server.js | restarting vs +500ms divergence | DEFERRED | benign over-signal, degrades to manual |
| 7 | 2 | NIT | tests | no e2e fired-restart test | DEFERRED | tested primitives + release gate |
| 8 | 3 | WARNING | boardrestart.js | conditional residual (dup of #5) | DEFERRED | reviewer: "not a live defect" |
| 9 | 3 | NIT | server.js | restarting:true-then-fails fallback | DEFERRED | Angel's 150s reconnect timeout |
| 10 | 3 | NIT | server.js | double canSelfRestart | DEFERRED | intentional TOCTOU defense, cheap |

### Strengths (across iterations)
- The pid-equality gate is the load-bearing proof and is sound (two processes cannot share a pid); every uncertainty biases to canRestart:false (manual path).
- Defense in depth: selfRestart re-invokes canSelfRestart, so a launchd state change in the 500ms window degrades to a no-op, never a brick.
- worldenv.bootedWorld captures the boot-time world and never re-reads the registry, closing the reconnect-poll false-success race; the load-bearing property is directly tested.
- Test coverage exercises every fail-safe branch and asserts selfRestart issues no stop when refused (the highest-consequence assertion); server.test asserts restarting:false for a non-board process, which also keeps the suite from stopping the operator's real dev board.
