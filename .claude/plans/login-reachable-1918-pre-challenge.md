---
pre_challenge: true
method: challenge-loop
branch: login-reachable-1918
diff_hash: 313925ee6a0808648fbce249caecc3efeed938a2f1b92eec76ae9fcb69c300ed
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T23:10:32Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 1 BLOCKER, 3 WARNINGs, 1 NIT
**Fixed:** 1 BLOCKER + 2 WARNINGs + 1 NIT | **Deferred/parked:** 1 WARNING (documented)

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 1 WARNING
- [BLOCKER] web/index.html - the "Sign in again" button called only settingsGo('accounts'),
  but it lives on the DETAIL panel and the top-level panels are mutually exclusive;
  settingsGo/settingsOpen only switch sections WITHIN the settings panel, so the click
  toggled an off-screen section and the user saw nothing: a dead control, the exact
  wording-only dead end #1918 forbids --> FIXED (showTab('settings') first, then
  settingsOpen('accounts'); commit 4e8b6648)
- [WARNING] web.reauth-reach-1918.test.js - the wiring test was vacuous for reachability
  (asserted the callee settingsGo, not that the settings PANEL becomes visible), so it
  stayed green while the button did nothing --> FIXED (observe showTab, assert
  showTab('settings') before settingsOpen('accounts') in order; proven red-capable by
  reverting the handler; 4e8b6648)

#### Iteration 2
**New findings:** 2 WARNINGs
- [WARNING] web/index.html - the click passed settingsOpen('accounts', {focus:false}),
  stranding keyboard/screen-reader focus on #d-reauth inside the now-hidden detail panel
  --> FIXED (dropped focus:false so settingsGo focuses the landed Accounts .dsec, as the
  Accounts nav pill does; commit be24b096)
- [WARNING] web/index.html - the auth_failed toggle runs at detail-open time, not on the
  5s poll --> PARKED with reasoning: consistent with the sibling evidence quote
  (d-said/d-why), which is also open-only, so button and quote appear/disappear together;
  refreshing only the button on the poll would create a NEW divergence. Documented in the
  plan's parked section (the open-only-vs-poll drift class the file already tracks).

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** - no new actionable findings.
- [NIT] plan file - the Fix step still described the wiring as settingsGo('accounts')
  (stale after the iter-1 panel-switch fix) --> FIXED (describe showTab+settingsOpen)

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html | Button switched section not panel (dead control) | FIXED | 4e8b6648 |
| 2 | 1 | WARNING | web.reauth-reach-1918.test.js | Wiring test vacuous for reachability | FIXED | 4e8b6648 |
| 3 | 2 | WARNING | web/index.html | Focus stranded on hidden button | FIXED | be24b096 |
| 4 | 2 | WARNING | web/index.html | Toggle open-only, not on poll | PARKED | Consistent w/ sibling quote; documented |
| 5 | 3 | NIT | plan file | Stale wiring description | FIXED | (plan commit) |

### Strengths (across all iterations)
- The navigation lands correctly and populates the surface: showTab('settings') reveals
  the settings panel and runs paintSettings -> paintAccounts, and settingsGo focuses the
  Accounts section (moving focus off the hidden button). No dead control, no focus trap.
- The test is RUN-not-GREP and red-capable in both directions: the toggle arms include a
  discriminating control (idle/working must hide), and the click test observes
  showTab-before-settingsOpen order. Proven red-capable by reverting the handler in-tree.
- No regressions: the reworded #1885/#1903 strings preserve "Re-authenticate"; full
  yarn test green (3805/3805 + test:shell ALL PASS). No em dashes in any added line.
- The auth-detection regex in engine/status.js is correctly left untouched (it must keep
  matching the CLI passthrough).

### Parked (documented, not shipped as wording-only)
- The usage-limit passthrough ("/usage-credits", "/model") has no in-product surface; it
  stays an attributed quote.
- Aiming the button at THIS agent's specific account depends on #1916/#1917; the account
  list is the honest floor.
- Whether the re-auth flow then SUCCEEDS is #1916, not this card (#1918 is reachability).
