---
pre_challenge: true
method: challenge-loop
branch: pane-home-reinject-trust
diff_hash: a68494460090882991e31d47653e30b1502427f04a6da753f459f205c7938c0d
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T15:14:14Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (round 1: 2 reviewers on a FIRST fix that turned out wrong; round 2: re-measurement with controls after the catch; round 3: 1 reviewer on the corrected fix; round 4: CI caught a missed pinned-test index, fixed)
**Converged:** Yes
**Total findings:** 2 BLOCKER (the first fix was wrong — CAUGHT and replaced; then a missed pinned pane-env test — CAUGHT by CI), 0 open. Corrected fix proven with controls; all pinned tests updated.
**Fixed:** 2 | **Deferred:** 0 | **Asked:** 0

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

#### Iteration 4 — CI caught a missed pinned-test index (the pane-env list is asserted in create.test.js, not only test-supervisor-env.sh)
**New findings:** 1 BLOCKER (CI-caught), 0 WARNINGs. **FIXED.**
- [BLOCKER] engine/create.test.js — adding HOME to the re-injection loop broke THREE pinned assertions that
  exist precisely to force a new pane-env rider to be declared (#577/#1160/#1704 pattern): (1) the
  text-match loop regex at ~2996, (2) the actually-run `deepEqual` expected SET (HOME rides because the
  test process always has a $HOME), and (3) the unset/empty exclusion filter (+ a positive check). I had
  run ONLY the shell supervisor tests (test-supervisor-env.sh), not `node --test engine/create.test.js`,
  so the challenge loop's iteration-3 proof missed it and CI (the `test` job: node --test + yarn
  test:shell) went red. **FIXED**: declared HOME as an always-on rider in all three spots, mirroring how
  #1160/#1704 wrote their new riders INTO the expected set rather than filtering them out. Full
  create.test.js green locally (165/165); shell tests green; repo swept for any other copy of the old loop
  string (none). The FIX code (bin/agent-supervisor.sh) is unchanged — this iteration only updated the
  tests that pin the list. Lesson: the pane-env list has TWO test indices (the shell test AND
  create.test.js's pinned assertions); run the file the CI runs, not just the sibling shell test.

### Final Ledger
| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | correctness | engine/trust.js | first fix (move the WRITE path) rested on a confounded measurement; would regress clean installs | RESOLVED | abandoned that branch; re-measured with CCD unset + controls; replaced with HOME re-injection |
| 2 | 4 | test-coverage | engine/create.test.js | HOME rider broke 3 pinned pane-env assertions; missed because only the shell test was run, not the CI's node --test | RESOLVED | declared HOME in all 3 (regex, deepEqual set, exclusion filter + positive check); full file green; fix code unchanged |

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
