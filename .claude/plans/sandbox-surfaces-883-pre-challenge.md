---
pre_challenge: true
method: challenge-loop
branch: sandbox-surfaces-883
diff_hash: 5c48eebf0f180f7f88a5549221e954fce001c58904ade1b7627207ca48248833
subdir_audit: passed
timestamp: 2026-08-26T01:50:56Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes
**Total findings:** 8 real findings across the loop (2 BLOCKER-equivalent bugs that would have broken the card's own target scenario, 1 lower-stakes cosmetic bug, 1 design-tradeoff named but deliberately not code-fixed, 4 NITs)
**Fixed:** 7 | **Deferred:** 1 (documented, not a code defect)

This is the longest of the three challenge-loops run today (#874: 3 iterations,
#891: 2 iterations, #883: 6 iterations) -- proportionate to the actual risk:
this card changes what a real, currently-shipping installer does for every
non-default install, and two of the findings (iterations 3 and 4) were of the
"would have broken the exact scenario the card exists to fix" severity, not
cosmetic misses. Each was caught by a genuinely independent blind reviewer,
not by re-reading the same round's own work.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 2 NITs
- [NIT] `_kosmos_home_default` was built from raw `$HOME` while `$KOSMOS_HOME`
  itself was already slash-normalized (`tr -s '/'`, strip trailing `/`) a few
  lines above -- a `$HOME` with a trailing or doubled slash would misclassify
  a genuinely-default install as non-default, violating the card's own
  critical byte-identical invariant. This file's own header had already
  measured the identical bug class once, for a different comparison. -->
  FIXED (commit `45ac8b4`): normalized `_kosmos_home_default` the same way,
  in both places it's computed (install path and `uninstall()`'s
  independent copy).
- [NIT] The plan's own verification section overstated its test coverage
  (claimed a full byte-for-byte plist diff against a captured reference;
  what shipped is four targeted assertions plus a structural code-path
  argument). --> FIXED (commit `45ac8b4`): corrected to the measured claim.

#### Iteration 2
**New findings:** 2 NITs
- [NIT] The trailing-slash fix from iteration 1 had no dedicated regression
  test -- nothing in the suite used a `$HOME` with a trailing slash. -->
  FIXED (commit `82e041f`): new scenario, confirmed discriminating (reverted
  the fix, watched it fail; restored, confirmed green).
- [NIT] The plan's "Done" section documented the other iteration-1 findings
  but never mentioned the trailing-slash defect itself. --> FIXED (commit
  `82e041f`): added.

#### Iteration 3
**New findings:** 1 BLOCKER-equivalent BUG
- [BUG] The fix, as it stood, would have broken Pete's real walk convention
  outright. `engine/sandbox.js`'s `audit()` (#634) refuses to start the
  board whenever ANY of `{DATA, PROJECTS, WORKERS, LAUNCH}` + tmux-inertness
  is sandboxed while ANY is not, symmetric either direction. This card
  derives only three of those four by design (LAUNCH and tmux deliberately
  left untouched); Pete's real convention never sets `AGENT_WORKFORCE_LAUNCH`
  and needs real tmux to be a usable walk -- exactly the half-sandboxed
  shape #634 refuses. The board would not have started at all for the
  scenario this card exists to fix. The test suite never caught it: the
  test's own "Pete's exact convention" scenario always explicitly set
  `AGENT_WORKFORCE_LAUNCH` (for the test's own file-write safety,
  contradicting its own comment), and `AGENT_WORKFORCE_DRY_RUN=1` is
  exported globally for the whole test file, keeping tmux permanently
  inert throughout -- both incidentally satisfied #634's bar and hid the
  gap. --> FIXED (commit `be8c0b6`): export `AGENT_WORKFORCE_HALF_SANDBOX_OK=1`
  alongside the three derived vars, #634's own named escape hatch for a
  deliberate choice. Verified with a precise unit test against `audit()`
  directly (`engine/sandbox.test.js`) rather than a full end-to-end run
  with real tmux, deliberately, to avoid touching this shared dev
  machine's other agents' real tmux sessions for marginal added confidence.
- Also fixed the same round, lower stakes: the three new plist keys were
  landing on one squished physical line instead of one per line (command
  substitution strips trailing newlines at every level of nesting). Fixed
  with the standard sentinel-character trick for preserving a trailing
  newline through command substitution.

#### Iteration 4
**New findings:** 1 BLOCKER-equivalent BUG, found by direct reproduction
- [BUG] Iteration 3's `AGENT_WORKFORCE_HALF_SANDBOX_OK` fix only exported
  the override into the installing shell's own session, never into the
  persisted launchd plist. A real reboot or self-update runs `kosmos start`
  as a fresh process whose entire environment IS the plist's
  `EnvironmentVariables` dict -- so the #634 refusal this whole card exists
  to clear would recur at the very next restart, just deferred past the
  initial install. Reproduced directly (not inferred): invoked `bin/kosmos
  start` with only the plist's own environment, watched it die with the
  identical refusal sentence. --> FIXED (commit `66b6172`): added
  `AGENT_WORKFORCE_HALF_SANDBOX_OK` as a fourth `_env_kv` call in the plist-
  writing block, same gate as the other three.
- New regression test reproduced the review's own method: stop the board
  first (a first version skipped this and passed vacuously regardless of
  the fix, caught by testing against a deliberately-reverted copy), start
  under `env -i` with only the plist's keys, assert clean exit and no
  refusal in `board.log` (a first version checked the wrong log file and
  also passed vacuously, caught the same way). Confirmed discriminating
  both times.

#### Iteration 5
**New findings:** 0 BUGs, 2 NITs, 1 named-not-fixed design tradeoff
- Tried specifically to find a fourth defect in the
  `AGENT_WORKFORCE_HALF_SANDBOX_OK` area (three consecutive prior findings
  there) and could not.
- [NIT] No test proved an explicit `AGENT_WORKFORCE_HALF_SANDBOX_OK="0"`
  from the caller survives rather than being silently overwritten with the
  derived `"1"`. --> FIXED (commit `11651ac`): new assertion; confirmed the
  underlying logic was already correct by reading, closed the test gap.
- [NIT] The reboot-simulation's `board.log` check scanned the whole
  (append-only) file rather than just that run's output -- true by
  construction so far, a weaker guarantee than it looked like. --> FIXED
  (commit `11651ac`): truncated immediately before the simulated start.
- [BUG -- design gap, not regression] This card's fix trades one
  collision-prone shared board-plist label for unbounded accumulation:
  every distinct `KOSMOS_HOME` now gets a permanent, uniquely-labeled
  launchd job, and nothing sweeps for one whose `KOSMOS_HOME` no longer
  exists if the scratch directory is abandoned without an explicit
  `--uninstall`. Real, but not a regression (nothing is broken today, no
  test fails) -- a genuine architectural tradeoff. --> DOCUMENTED, not
  code-fixed (commit `11651ac`): added to the plan's "deliberately not
  touched" section with the same explicit reasoning already given the
  agent-job-label gap, naming it as a decision for whoever picks up the
  "fuller shape" follow-up work the issue itself already calls for.

#### Iteration 6
**New findings:** 0 BUGs, 0 NITs
**Converged** -- tried explicitly to find a new defect (concurrent/racy
installs, hash collisions, the sentinel trick, slash-normalization edge
cases, `audit()` reread fresh) and found nothing. One informational note
(an unrelated, structurally-disconnected `/Applications unchanged` check
failed once on a shared, heavily-loaded machine; explicitly not attributed
to this branch, no code touches that surface).

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|--------------|--------|------------|
| 1 | 1 | NIT | `install/setup.sh` `_kosmos_home_default` (x2) | Missing slash-normalization, real bug class this file already measured once | FIXED | `45ac8b4` |
| 2 | 1 | NIT | plan file | Overstated verification claim | FIXED | `45ac8b4` |
| 3 | 2 | NIT | `tools/test-install.sh` | No regression test for the trailing-slash fix | FIXED | `82e041f` |
| 4 | 2 | NIT | plan file | Trailing-slash fix undocumented in "Done" | FIXED | `82e041f` |
| 5 | 3 | BUG | `install/setup.sh` env-derivation | Board refuses to start at all for Pete's real convention (#634 collision) | FIXED | `be8c0b6` |
| 6 | 3 | NIT | `install/setup.sh` `_extra_env_kv` | Three plist keys squished onto one line | FIXED | `be8c0b6` |
| 7 | 4 | BUG | `install/setup.sh` plist-writing block | HALF_SANDBOX_OK fix didn't survive a reboot/self-update | FIXED | `66b6172` |
| 8 | 5 | NIT | `tools/test-install.sh` | No explicit-"0"-override test for HALF_SANDBOX_OK | FIXED | `11651ac` |
| 9 | 5 | NIT | `tools/test-install.sh` | Reboot-sim board.log check not scoped to its own run | FIXED | `11651ac` |
| 10 | 5 | BUG (design gap) | `install/setup.sh` label scheme | Unique labels now accumulate as orphans if abandoned without --uninstall | DOCUMENTED | `11651ac` |

### NITs (non-blocking, across all iterations)
- [NIT] Slash-normalization missing (iteration 1, fixed)
- [NIT] Plan overstated verification (iteration 1, fixed)
- [NIT] No trailing-slash regression test (iteration 2, fixed)
- [NIT] Plan missing trailing-slash documentation (iteration 2, fixed)
- [NIT] Squished plist lines (iteration 3, fixed)
- [NIT] No explicit-"0"-override test (iteration 5, fixed)
- [NIT] Reboot-sim log check not scoped (iteration 5, fixed)

### Strengths (across all iterations)
- Every reviewer independently re-verified the byte-identical-for-default-installs invariant from first principles rather than trusting the plan's claim, and it held at every round.
- Iterations 3 and 4 were both caught by DIRECT REPRODUCTION (invoking the real installer/board with constructed environments and reading the actual error), not by inference from reading -- the standard this whole session's work has tried to hold to.
- Iteration 4's own first regression-test attempts were themselves caught as vacuous TWICE (board not stopped first; wrong log file checked) by deliberately reverting the underlying fix and confirming the test failed for the right reason before trusting it -- the same discipline applied to the tests as to the product code.
- Iteration 5, tasked with finding a fourth bug in an area that had failed three times running, found none and said so plainly rather than manufacturing a finding.
- The one true architectural tradeoff found (iteration 5's orphan-accumulation gap) was named explicitly rather than fixed reflexively or silently ignored -- consistent with the issue's own "smallest first... a fuller shape is one explicit sandbox switch" framing.

## Validation

- Full local install harness: `tools/test-install.sh` -- 249 passed, 0 failed (final commit `11651ac`), confirmed clean on at least two separate runs across iterations 4, 5, and 6, by three different reviewers plus the author.
- Unit suite: `node --test engine/*.test.js` -- 1176 passed, 0 failed, including the new `engine/sandbox.test.js` case pinning the exact derived-environment shape.
- Canonical validation helper (`validation_log_run_or_skip`): PASSED for stack=typescript, hash `5c48eebf0f180f7f...` (matches this proof's `diff_hash`).
- Subdir CLAUDE.md audit: passed (no subdir CLAUDE.md files touched by this branch's diff).
- One known-flaky, unrelated pre-existing scenario ("== update ==", far earlier in `tools/test-install.sh`, touching a different `$SB/home` KOSMOS_HOME this card's diff never references) intermittently failed with a missing pidfile during this work; confirmed unrelated and pre-existing by reproducing the identical failure, at the identical point, on completely unmodified `main`, on this same machine, in the same time window.
