---
pre_challenge: true
method: challenge-loop
branch: import-walk-1652
diff_hash: 57ea0191eb2e0d9504e5c59eb265dbdec5d2d67f2dadf426ed42056abb118e18
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T11:54:15Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 returned zero NEW BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 7 (1 BLOCKER, 2 WARNINGs, 1 CONVENTION, 3 NITs)
**Fixed:** 6 | **Deferred:** 0 | **Asked:** 0

The change adds a committed headless browser check (`docs/browser-checks/import-agent-flow.js`)
for the already-built kosmos#1652 import flow, plus its README index row and count
updates. No web/ or engine change.

### Baseline (6.0)

`node --check` on the new check (OK); `browser-checks-indexed.test.js` (the README
index invariant) passes; the check itself verified in-session against a sandboxed
board (8/8), and perturbation-checked (breaking the create-instr fill turns the
textarea assertion red, 7 passed 1 failed).

### Per-Iteration Breakdown

#### Iteration 1
- [BLOCKER] the check POSTs `/api/first-run/complete` to whatever BASE it is given, so a misaimed run could complete first run on a LIVE board --> FIXED (added `requireSandbox('import-agent-flow.js')` before the first POST, like render-accounts-openai.js; refuses unless the check's own AGENT_WORKFORCE_DATA is a temp root; run recipe updated to pass it).
- [WARNING] the negative arm used a fixed `waitForTimeout(2000)` that could read the transient "Reading it…" message with the form not yet applied and green vacuously --> FIXED (wait for the terminal refusal state: button re-enabled AND a message that is not "Reading it…").
- [WARNING] a `check(..., true, ...)` hardcoded pass inflated the tally --> FIXED (computed visibility read).
- [CONVENTION] stale argv[2]-POSTer / first-run-completer counts in the README and lib-sandbox-guard.js --> FIXED (6 POSTers, 2 first-run-completers; verified by grep in iteration 2).
- [NIT] inverted HEADED semantics (HEADED=0 example was a no-op) --> FIXED (hardcode headless:true; DOM-state assertions only; header corrected).

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs.
- [NIT] the negative "refused with a reason" assertion did not re-apply the transient-message exclusion --> FIXED (added `!/Reading it/i` to the assertion).
- [NIT] `/api/first-run/complete` was fire-and-forget --> FIXED (check `r.ok`, fail loud, like the sibling).
**Converged**. The reviewer verified the counts by grep (6 requireSandbox callers, 2 first-run-completers, accurate), the positive-arm values against the real parser (`importFromInstructions`/`identityFromText`: name=testy-mctest, label=Testy McTest, instructions substring), the negative arm race-free and non-hanging, and every DOM id the check waits on exists.

### Final Ledger

| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 1 | BLOCKER | POSTs to any BASE without a sandbox guard | FIXED |
| 2 | 1 | WARNING | negative arm fixed-sleep could green on the transient message | FIXED |
| 3 | 1 | WARNING | hardcoded `check(..., true)` vacuous | FIXED |
| 4 | 1 | CONVENTION | stale POSTer/first-run counts | FIXED |
| 5 | 1 | NIT | inverted HEADED default | FIXED |
| 6 | 2 | NIT | negative "reason" assertion unguarded vs transient | FIXED |
| 7 | 2 | NIT | first-run POST fire-and-forget | FIXED |

### Outstanding questions (ASKED)
None.

### Strengths
- The negative arm is a genuine control (empty textarea + stays on panel + a reason), and the positive arm keys on file-derived values verifiable against the parser, so both are non-vacuous; the perturbation that reddens the fill assertion is documented.
- requireSandbox() genuinely protects against a misaimed run completing first run on a live board; refusal proven (exit 2 without a sandbox env).
- Runs headless from a plain bot session (no MCP/claude-fe), verified in-session; DOM-state-only assertions make headless sound.
- Does not press Create (import parses, never creates), so it spawns nothing; the full create is render-create-made.js.
