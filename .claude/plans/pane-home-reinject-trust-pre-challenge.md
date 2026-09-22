---
pre_challenge: true
method: challenge-loop
branch: pane-home-reinject-trust
diff_hash: fc780f3558e8e1e6a0858937571dc2ad554f98bbe87e17defdd4dbf261e585c6
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T14:52:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (round 1: 2 reviewers on a FIRST fix that turned out wrong; round 2: re-measurement with controls after the catch; round 3: 1 reviewer on the corrected fix)
**Converged:** Yes
**Total findings:** 1 BLOCKER (the first fix was wrong — CAUGHT and the whole approach replaced), 0 open. Corrected fix proven with controls.
**Fixed:** 1 | **Deferred:** 0 | **Asked:** 0

This is the challenge loop doing exactly its job: it caught a WRONG fix before it shipped and forced a
re-derivation from the start.

### Per-Iteration Breakdown

#### Iteration 1 — 2 reviewers on the FIRST fix (moving the WRITE to ~/.claude/.claude.json)
**New findings:** 1 BLOCKER, 0 WARNINGs.
- [BLOCKER] engine/trust.js — the first fix changed `defaultAgentConfig()` to `~/.claude/.claude.json`,
  justified by an e2e that was CONFOUNDED: `CLAUDE_CONFIG_DIR=~/.claude` is set on the dev box (fleet
  bot scripts export it). With it set, the CLI reads `$CLAUDE_CONFIG_DIR/.claude.json` and ignores HOME,
  which made `~/.claude/.claude.json` look like the default. A reviewer flagged the confound and demanded
  a re-measure with `CLAUDE_CONFIG_DIR` explicitly UNSET. **Result: the first fix would REGRESS #2129 on
  every clean install** (a no-CCD agent reads `~/.claude.json`, not `~/.claude/.claude.json`). The
  config-path branch was ABANDONED.

#### Iteration 2 — re-measurement with CLAUDE_CONFIG_DIR explicitly UNSET, WITH CONTROLS
(the clean-machine case = Josh's GUI-launched laptop, where `launchctl getenv CLAUDE_CONFIG_DIR` is empty)
- Test A: trust seeded ONLY in `H/.claude.json`, pane `HOME=H`, CCD unset -> NO prompt. So a no-CCD agent
  reads `$HOME/.claude.json` (respects HOME). (Disproves the `~/.claude/.claude.json` premise.)
- Test C: server `HOME` wrong (no trust) + pane `HOME` re-injected to `H` (holds the trust), CCD unset ->
  NO prompt.
- Test D (CONTROL): identical to C but WITHOUT the HOME re-injection (pane inherits the server's wrong
  HOME) -> the trust PROMPT fires. So the read/write divergence is a HOME mismatch, and re-injecting HOME
  closes it. C vs D discriminates: the fix, and only the fix, clears the prompt.

#### Iteration 3 — 1 reviewer on the corrected fix (HOME re-injection)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 NIT (fixed). **No real defect found.** The reviewer verified
the PREMISE against the engine's own resolvers (not the plan's prose): the supervisor's `$HOME` really is
`homeDir()` (plist `plistFor` emits `HOME=homeDir()` into launchd EnvironmentVariables) and the
default-account WRITE target `defaultAgentConfig()` is `AGENT_WORKFORCE_HOME||os.homedir()/.claude.json`
— the SAME resolver, in the SAME board process, so read and write are byte-identical after re-injection.
It empirically confirmed the test is non-vacuous (drop HOME from the loop -> the `-e HOME=` assertion
fails). Safety cleared on every axis: empty HOME fails safe (loop guard skips it), named-account (CCD set)
is a harmless no-op (CLI ignores HOME), codex benefits (default codex reads `$HOME/.codex`, aligned to
board HOME), and — a BONUS — re-injecting board HOME also CLOSES a store/token misalignment (the pane's
store root fell back to the server's HOME, not the board's, when they differed — same class as KOSMOS_PORT
#577 / TMUX_TMPDIR #668), rather than opening one.
- [NIT] bin/agent-supervisor.sh — a comment said "HOME is FIRST and it is load-bearing", overstating
  ordering (tmux `-e` order is irrelevant). **FIXED** (reworded; behavior unchanged).

### Final Ledger
| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | correctness | engine/trust.js | first fix (move the WRITE path) rested on a confounded measurement; would regress clean installs | RESOLVED | abandoned that branch; re-measured with CCD unset + controls; replaced with HOME re-injection |

No open BLOCKER / WARNING / CONVENTION findings remain.

### Strengths
- [STRENGTH] The correct fix is proven WITH A CONTROL under the exact clean-machine condition (CCD unset):
  C clears the prompt, D (no re-injection) reproduces it.
- [STRENGTH] Minimal + pattern-matching: one variable added to the existing pane re-injection list, same
  mechanism as the CLAUDE_CONFIG_DIR re-injection beside it; no JS changed.
- [STRENGTH] Safe when CLAUDE_CONFIG_DIR IS set (the CLI ignores HOME then), so it is a no-op on the fleet
  and only helps the no-CCD default-account case.

### Validation
All supervisor shell tests pass (test-supervisor-env — which now asserts HOME reaches the pane's
`new-session -e` args — plus wait / model / retrust). No JS files changed, so the JS suite is unaffected.
The fix reproduces `tmux new-session -e HOME=...`, which test C proves clears the prompt on a real claude.

### Known gaps
- macOS launchd/tmux path only. Windows uses win32launch.js (no shared tmux server); if it shows the same
  symptom it is a separate item (flag Homer).
- Josh's experiential retest on 0.6.88 (his laptop) is the final ship gate; money/promote HELD until then.
