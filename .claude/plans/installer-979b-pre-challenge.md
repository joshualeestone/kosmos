---
pre_challenge: true
method: challenge-loop
branch: installer-979b
diff_hash: 15347e72d294b2d4c20f796cd6c4c4e53eeaefdb53edab3f5945a4a18577ea45
subdir_audit: passed
timestamp: 2026-08-26T21:08:28Z
iterations: 2
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** No. Stopped after round 2 by judgment: round 2's findings were all in code round 1
prompted or in prose, none in the design, and the change is one shell function.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 2 BLOCKERs, 6 WARNINGs, 3 NITs

- [BLOCKER] tools/clean-machine.sh - the fresh-Mac release harness still asserted the CARRY
  behaviour this branch removes, so it would go red at release-verification time **against the
  served artifact**, telling an operator the installer was broken when the harness was stale
  --> FIXED (leg inverted with the product; its file header was two revisions stale as well)
- [BLOCKER] install/setup.sh - the sentence promised a link that **nothing in the repo performs**.
  I removed the link arm citing `engine/runners.js`'s linking phase; that phase was on an
  unmerged branch AND is reachable only through a route no screen calls, and `connect.js` looks
  only at the canonical path, never at `command -v claude`. So a person with Claude Code at
  `/opt/homebrew/bin` would have been told a link was coming and handed a fresh full download of
  what they already have --> FIXED (link arm restored; a symlink moves no bytes, so it never
  breached the ruling)
- [WARNING] install/setup.sh - the pre-existing header still said "CLAUDE CODE IS GATED HERE",
  three lines above the block announcing it is not --> FIXED
- [WARNING] install/setup.sh - the broken-path arm's remedy reaches nobody under the pkg path, and
  the arm got strictly worse than the `die` it replaced --> FIXED (elsewhere check first)
- [WARNING] tools/test-install.sh - stale carry claims and a control that now controls nothing
  --> RECORDED (not this branch's file to churn; named in the plan)
- [WARNING] install.claude-gate.test.js - the env-override test was deleted with the download it
  guarded, but the seam is still read by the shipped function and pins eleven sandbox homes
  --> FIXED (restored)
- [WARNING] install.claude-gate.test.js - the header overstates the safety net: only three of five
  cases arm the stub --> FIXED (stated accurately)
- [WARNING] install/setup.sh - the silent arm went silent in the install LOG too, and the log is
  "the one thing we ask a stranger to send us" --> FIXED (one line, with the run id)
- [NIT] engine/create.js - a refusal that used to be unreachable is now the common case and routes
  people to a website --> FIXED on `machine-check-979c`

#### Iteration 2
**New findings:** 2 BLOCKERs, 4 WARNINGs, 3 NITs

- [BLOCKER] tools/clean-machine.sh - **the new "said nothing about Claude Code" assertion is
  guaranteed red on a correct installer.** It grepped the whole transcript for `claude`, and
  setup.sh legitimately prints "(this answers Claude Code's one-time skip-permissions question"
  on the SUCCESS branch, which is the normal path on a clean home. It could only pass when an
  unrelated step FAILED --> FIXED (scoped to the retired sentences)
- [BLOCKER] engine/machine.js - the installer going silent **exposes** the machine check's
  provider-blind warning, and my comment claimed Kosmos raises it "on the Connect step and
  nowhere else", which is false --> FIXED on `machine-check-979c`; the ordering requirement is
  recorded in the comment rather than the claim narrowed
- [WARNING] install/setup.sh - the unrunnable arm returned before the elsewhere check, defeating
  the link arm in the exact case it exists for --> FIXED (one-shot replace restored, and tested)
- [WARNING] install/setup.sh - on a claude-less Mac the installer still writes a Claude Code
  config (permission merge, reporting hooks) --> RECORDED: "nothing installs" holds for bytes of
  software, not for config. Deliberate decision needed, not a side effect to bury.
- [WARNING] install.claude-gate.test.js - three states the old file covered are uncovered: link
  idempotence, symlink-to-a-directory, and the new non-fatal link failure --> FIXED (all three
  restored and tested)
- [WARNING] install/setup.sh - the silent arm's log line was the one line in the file with no run
  id, in the file whose invariant says every line carries one --> FIXED
- [CONVENTION] tools/clean-machine.sh - half a comment survived the edit, and the leg was still
  named after the retired ruling --> FIXED
- [NIT] install/setup.sh - "231MB" three times against 281MB elsewhere, both true when written
  --> FIXED (no size figure in this file; the manifest we already fetch is the source)
- [STRENGTH] - the load-bearing negative assertion is real: every case arms a stub that WOULD land
  a runnable claude, then asserts nothing landed. A test that only read the sentences would pass
  against code that still downloaded.
- [STRENGTH] - `gate()` lifts the SHIPPED function and asserts it is actually called;
  `CODE_LINES` strips comments before the never-come-back assertions and carries a positive
  control so they cannot go vacuous.
- [STRENGTH] - shell control flow clean under `set -euo pipefail`; every removed `die` is an
  explicit `return 0`, and the only pipe that `pipefail` could bite is gone.

### ⚠️ Recorded, not fixed

`tools/test-install.sh` still describes the deleted carry mechanism in four places. Its legs pass;
the prose is stale. Left for a pass that owns that file rather than churned from here.
