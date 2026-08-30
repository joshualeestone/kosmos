---
pre_challenge: true
method: challenge-loop
branch: acctadd-gate-1587
diff_hash: be156ae86b16bb8e522c1659d076744030fc5efef29b8004788403cc38e7dd51
validation: passed
subdir_audit: passed
timestamp: 2026-08-30T13:26:44Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (a clean 6.0 baseline + 3 independent blind review passes)
**Converged:** Yes
**Total findings:** 3 WARNINGs, 2 NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** 3 WARNINGs + 1 NIT | **Deferred:** 1 NIT | **Asked:** 0

The change gates the Settings > Accounts acct-add sign-in behind the install
confirm (#1587): it was a second, ungated entry into /api/connect/start that
could begin a ~231MB Claude Code download with no warning. web/index.html plus
its tests only; no other production code touched.

### Per-Iteration Breakdown

#### Iteration 1 (blind review 1)
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT
The security gate itself was confirmed airtight (both /api/connect/start entries
gated, fail-safe correct, double-submit guarded, tests genuine controls). Two
accessibility/UX parity gaps against the first-run confirm it mirrors:
- [WARNING] web/index.html - the Confirm handler dropped keyboard focus to
  <body> when it hid the panel while the button held focus --> FIXED (ffd7a9f3):
  focus moves to the visible status line, matching the first-run #fr-sub move.
- [WARNING] web/index.html - dismissing the accounts modal mid-confirm left a
  disabled Start button behind a stale panel on reopen --> FIXED (ffd7a9f3):
  closeAcctAdd (the single dismiss path) resets the confirm via a new
  acctAddConfirmReset helper, placed on close (not open) to avoid disturbing the
  doors() test harness that lifts only the open functions.
- [NIT] web/index.html - #acct-add reveals the confirm without aria-controls/
  aria-expanded --> FIXED (ffd7a9f3): disclosure-pattern parity added.

#### Iteration 2 (blind review 2)
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
- [WARNING] web/index.html - REGRESSION from iteration 1: acctAddConfirmReset
  re-enabled Start unconditionally, and closeAcctAdd calls it on every dismiss,
  so closing mid-sign-in-flow (where acctFlowPaint owns the disabled state and
  dedups its repaints) left Start clickable on reopen, a second
  /api/connect/start --> FIXED (ed9fe04f): the reset re-enables Start ONLY when
  no flow is active (#acct-flow hidden). Pinned by a test proven to red when the
  guard is removed.
- [NIT] web/index.html - Confirm focused #acct-add-note, which acctAddStart
  clears and which sits after the flow in the DOM --> FIXED (ed9fe04f): final
  focus now follows the news to #acct-flow-say after the flow paints, while the
  synchronous #acct-add-note focus still bridges the await so focus never drops
  to <body>. tabindex=-1 added to #acct-flow-say.

#### Iteration 3 (blind review 3)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
- **Converged** on actionable findings. 5 STRENGTHs (gate unbypassable,
  fail-safe correct, double-submit guard sound, copy-fns backward-compatible,
  tests genuine controls).
- [NIT] web/index.html - on the direct willInstall===false path, if the first
  POST returns a terminal phase synchronously, acctFlowPaint hides #acct-flow so
  say.focus() is a no-op and focus can remain on <body> --> DEFERRED: this
  EXACTLY matches the first-run flow's unconditional #fr-sub focus (consistent,
  not a new defect); the confirm path parks focus on #acct-add-note first so it
  is unaffected; fixing it in isolation would break the consistency the codebase
  values. The reviewer's own recommendation was not to change it unless the
  first-run pattern is revisited too.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | Confirm dropped keyboard focus to <body> | FIXED | ffd7a9f3 |
| 2 | 1 | WARNING | web/index.html | Stale confirm panel + disabled button on reopen | FIXED | ffd7a9f3 |
| 3 | 1 | NIT | web/index.html | Missing aria-controls/aria-expanded on #acct-add | FIXED | ffd7a9f3 |
| 4 | 2 | WARNING | web/index.html | Double-submit: reset re-enabled Start mid-flow | FIXED | ed9fe04f |
| 5 | 2 | NIT | web/index.html | Confirm focus on a cleared, mispositioned line | FIXED | ed9fe04f |
| 6 | 3 | NIT | web/index.html | say.focus no-op on synchronous terminal phase | DEFERRED | Matches first-run pattern; confirm path unaffected |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking)
- [NIT] Direct-path focus edge case on a synchronous terminal phase (iteration
  3) - deferred, consistent with the first-run flow.

### Strengths (across all iterations)
- The gate is unbypassable: /api/connect/start is reached only through
  acctAddStart, whose two callers (Confirm button, and the willInstall===false
  branch) both pass the willInstall check. No third ungated path; the reauth
  flow reuses the same gated button.
- Fail-safe by construction: only a definite willInstall === false skips the
  confirm; null conn, a fetch failure, a non-boolean, or true all confirm. A
  silent download is impossible even when /api/first-run cannot be read.
- The double-submit guard is right and closes a real window: the reset re-enables
  Start only when #acct-flow is hidden, so a dismiss mid-flow cannot re-arm it.
- Copy-fn parameterization is backward-compatible (conn || FR.connect), one
  sentence source, no copy drift (the #1579 lesson).
- Tests are genuine controls: the #1587 test strips comments, pins the gate (no
  /api/connect/start in the click handler), the confirm plumbing, and the
  flow.hidden guard, each proven to red when its guard is removed.
