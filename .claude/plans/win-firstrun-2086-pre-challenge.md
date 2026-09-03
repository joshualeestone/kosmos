---
pre_challenge: true
method: challenge-loop
branch: win-firstrun-2086
diff_hash: 858c505eb954d821b30c635f49239015790978fbf1da92d729660f5774681a82
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T23:42:36Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 blind independent review passes.
**Converged:** Yes - iteration 2 produced zero BLOCKER/WARNING/CONVENTION findings.
**Total findings:** 1 BLOCKER, 1 NIT (0 WARNINGs, 0 CONVENTIONs). BLOCKER fixed; NIT is a documented scope flag.
**Validation:** full suite passed (exit 0, hash 69b1de88e910); server.test.js 255/0; engine/machine.test.js 37/0. (A release-gate contention flake on an unrelated file cleared on re-run, standard tonight.)

### Per-Iteration Breakdown

#### Iteration 1 (blind review)
- **[BLOCKER]** server.test.js: `frPaintReturn`'s could-not-ask fallback now calls `frFindAppHint()` (web/index.html:35718), but `firstRunHarness` lifts only the single named page function and never defined `frFindAppHint`/`frIsMac`, so the "return step" tests red with `ReferenceError: frFindAppHint is not defined`. --> FIXED: added `frIsMac`/`frFindAppHint` to both harness preludes via `pageFnSource` (the same way it supplies esc/frCheckRow). The tests assert the fallback's title/state/no-dock, not the Spotlight detail, so they pass whether the harness resolves mac or neutral wording. (This same regression was independently caught by the baseline validation.)
- STRENGTHs: scope discipline sound (only WORDING gated, app-location LOGIC left to #570); the #2086 machine.test controls are real; the no-arg server.js:4507 caller stays correct.

#### Iteration 2 (blind review) - CONVERGED
- **[NIT]** two sibling macOS-only surfaces outside first-run (Settings Dock :9528, the Applications-folder toast :12592). --> DOCUMENTED as the wider class in the plan (a follow-on that can adopt this PR's helper). The reviewer confirmed they are correctly out of #2086's first-run scope, not a defect.
- Zero actionable findings -> converged.
- STRENGTHs (six): the harness fix is correct and non-vacuous (both harness sites); the BLOCKER is FULLY fixed (every caller of the three new page functions checked - frApplyPlatformCopy's test only string-matches, never executes); frIsMac's Node-harness behavior is fail-safe both directions; server threading correct (probed appLocationCheck({platform:'win32'}) -> ATTENTION + neutral, no Spotlight/Dock/Applications); the machine.test controls can return the dangerous answer; no em dashes; node --check clean.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | server.test.js | frPaintReturn->frFindAppHint undefined in harness | FIXED | 0922f58e (prelude via pageFnSource) |
| 2 | 2 | NIT | web/index.html:9528,12592 | sibling macOS surfaces outside first-run | DOCUMENTED | plan "wider class" note; out of scope |

### Not verified here (flagged, leave-for-review)
The Windows CLIENT render is reasoned + Mac-transparent (the macOS static markup is preserved so render-first-run.js's Dock-line browser check stays green) but NOT run-verified: it needs a Windows machine (windows-orchestrator has one and verified the original bug) or a Playwright check overriding navigator. The SERVER half - the primary Spotlight source a Windows user normally hits - is fully unit-tested (both platform branches). Per the Renet Tilley brief, the parts not needing a Windows machine are done; the Windows-render confirm is windows-orchestrator's. Coordinated with PigeonPete (#2007, same file, agents pane).
