---
pre_challenge: true
method: challenge-loop
branch: board-watchdog-recover-2955
diff_hash: 3161109ac9f0b8cf35a4a7ef104462354a2c4bc3baf486b15f185c30622f8a90
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T21:15:23Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (across 2 models: sonnet, opus, sonnet, opus)
**Converged:** Yes
**Total findings:** 1 BLOCKER (iter-1), 1 BLOCKER (iter-3), several WARNINGs, NITs
**Fixed:** all BLOCKERs + all code-defect WARNINGs + the actionable NITs.

This is a LIVE all-users installer/CLI change (kosmos#2955), so it was reviewed hard.
Requirements also evolved mid-loop from Josh's actual affected box (relayed by
Splinter): the settings-gate, the crash-loop guard, and the port-vs-supervision
health-check question were all added/resolved during the loop, each re-reviewed.

### Per-Iteration Breakdown

#### Iteration 1 (sonnet + the 6.0 validation gate)
**New findings:** 1 BLOCKER, 2 WARNINGs, NITs.
- [BLOCKER] tools/build-windows-570.test.js parity: the Mac bundle staged
  board-watchdog.sh but the Windows one did not, breaking the two-builders parity
  test. --> FIXED (recorded macOS-only in DELIBERATELY_MAC_ONLY with a reason).
- 6.0 validation also caught the same parity failure independently.
- [WARNING] test-install.sh #918 count via `com.kosmos.board*` glob would read 8 not
  4 once each install writes a watchdog plist. --> FIXED (count board labels excl.
  watchdog; assert 4 watchdog plists). VERIFIED by running test-install.sh with the
  #918 scenario (CI only syntax-checks it): both counts PASS.
- [WARNING] the orphan sweep's bare-default-watchdog exposure. --> FIXED (explicit
  skip of the bare-default watchdog label restores the two-layer protection).
- [WARNING] failed-stop leaves the marker set with the board alive. --> FIXED
  (remove the marker on a failed stop).

#### Iteration 2 (opus)
**New findings:** WARNINGs + NITs.
- [WARNING] grace deferral defeated by a stale down_since across a reboot. --> FIXED
  (reboot-reset: discard state older than `sysctl kern.boottime`).
- [WARNING] failed-stop path untested (genuinely hard: needs a SIGKILL-resistant
  process) --> documented as a known-untested critical path.
- [NIT] non-numeric state values --> FIXED (num()/numdef() guards).
- [NIT] StartInterval literal vs constants --> FIXED (heredoc comment on the 30/45
  coupling).

Also in this window: Josh's live box drove two new requirements (settings-gate on
the existing "come back after restart" control -> board-login-job presence; crash-
loop guard: bounded restarts + backoff + alert), both built and covered by tests.

#### Iteration 3 (sonnet)
**New findings:** 1 BLOCKER, WARNINGs, NITs.
- [BLOCKER] the two gate tests (stop-marker, board-plist) were VACUOUS: no state
  seeded meant only the harmless first-observation branch ran, so they passed even
  with the gates deleted (proven by mutation). --> FIXED (seed a down_since past
  GRACE so the assertion is contingent on the gate). Mutation-verified: a script
  with the gates removed now starts in those scenarios.
- [WARNING] setup.sh watchdog block missing ok() in sandbox/later branches. --> FIXED
  (ok() called unconditionally, matching the board block).
- [WARNING] boot_epoch fallback comment overclaimed. --> FIXED (comment corrected).
- [NIT] env-var numeric guard, MAX_FAILS-1 boundary. --> env guard FIXED.

Also in this window: the wedged-port escalation (from the Mortals-box clue: the board
exits "clean" while a detached child holds 16180) was added: when a prior restart did
not hold, escalate to `launchctl kickstart -k`, falling back to `kosmos start`.

And the port-vs-supervision question: Splinter relayed "assert a live launchd PID"
from the live box; I HELD it and flagged that the board orphans by design (nohup
daemonise + launcher returns, install/kosmos:491), so no-launchd-PID is the healthy
normal state and a supervised-PID check would thrash every board. Splinter confirmed
and RETRACTED the requirement -> detection stays PORT-based, the plist-presence gate
is the supervision signal, true supervision is Baron's foreground-mode follow-up.

#### Iteration 4 (opus)
**New findings:** 0 BLOCKERs, 0 code-defect WARNINGs.
- [WARNING] the kickstart-k escalation's value (does it vacate a wedged port?) is
  proven only by the one live observation, and never worse than the kosmos-start
  fallback -> carried into the reboot-verification prod gate, NOT a code change.
- [NIT] launchctl-fails fallback untested --> FIXED (test 6c: launchctl exits 1 ->
  falls back to kosmos start).
- [NIT] reboot-reset did not clear the alert marker --> FIXED (clear it; test asserts).
- STRENGTHs: gate tests confirmed non-vacuous; state machine sound (no thrash,
  off-by-one, or permanent-suppression); setup.sh + packaging parity faithful.
**Converged** — no actionable BLOCKER/WARNING/CONVENTION remained.

### Outstanding questions (ASKED, still unresolved when the run ended)
None. The one design question (supervised-PID vs port-based) was resolved with
Splinter mid-loop: port-based confirmed.

### NITs / follow-ups (non-blocking)
- MAX_FAILS-1 boundary not directly unit-tested (traced correct by the iter-3
  reviewer; fail=0/1/2/5 and cooldown paths are covered).
- Minor UI-honesty follow-up (Splinter): make the "come back after restart" machine-
  check read as status rather than a checkbox - a separate card.

### Strengths (across iterations)
- Additive design: never touches the fragile stop/start/updater rearchitecture that
  foreground-mode would; delegates recovery to the idempotent kosmos start.
- Port-based detection avoids the nohup-fakes-launchd-state trap by construction.
- Three-way packaging parity (bundle, deploy, windows map) all test-backed.
- Uninstall + orphan sweep faithfully extend the hardened board-plist model.

## Reboot-verification gate (prod)
Baron Draxum owns the 4-arm reboot procedure on the Mortals box. It must LOG IN (the
watchdog is a GUI-login-scoped LaunchAgent) and should explicitly confirm that
`launchctl kickstart -k` vacates a wedged 16180 (iter-4 WARNING), not merely that the
board eventually recovers. Staging -> Josh-approval -> prod.
