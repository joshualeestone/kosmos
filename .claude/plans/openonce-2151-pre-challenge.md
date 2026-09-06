---
pre_challenge: true
method: challenge-loop
branch: openonce-2151
diff_hash: a8c59d0da4bf59fe666fa76a1a457139ee0e4b7521f6bc6dcab0ed38afd7853f
validation: passed
subdir_audit: passed
timestamp: 2026-09-06T19:37:52Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (blind review)
**Converged:** Yes (the blind review surfaced no BLOCKER/WARNING/CONVENTION)
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Fixed:** 1 NIT | **Deferred:** 1 NIT

Full suite (run-tests.sh: JS 4927/0 + shell test:shell incl. bash -n setup.sh,
test-block-delivery, test-sweep-leaked) ran green after the fix.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
The blind reviewer independently constructed the dangerous cases and PROVED both
guard refinements still trip on a real install-path board bootout (they are safe),
and that the self-bootout pin is non-vacuous (removing the bootout fails it).
- [NIT] install.board-job.test.js — the #2151 positive pin sliced a fixed +1500 chars
  --> FIXED (c4da619f): anchored to the plist heredoc's closing PLIST marker.
- [NIT] install.uninstall-sweep.test.js — the `<string>`-skip is a blanket rule across
  setup.sh, not just the open-once plist --> DEFERRED: it affects exactly one site today
  (the only launchctl-in-plist-data line), the open-once plist WRITE is sandbox-gated
  (the enclosing pkg-mode `if` requires AGENT_WORKFORCE_LAUNCH unset), and the sibling
  "sandboxed run reaches launchd in neither direction" test independently asserts that
  gate appears in the block. A future ungated embedded-launchctl plist would still be
  caught by that sibling test, so narrowing the line-based sweep to re-verify
  plist-write-gating is disproportionate.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | NIT | install.board-job.test.js | fixed-char pin slice | FIXED | c4da619f |
| 2 | 1 | NIT | install.uninstall-sweep.test.js | blanket <string>-skip | DEFERRED | mitigated by sibling gate test |

### Strengths
- The self-bootout is correct: order open;rm;bootout (app launched + file removed before
  the self-terminating bootout race), uid/label baked at plist-write time, `\$0`/`\$1`
  literal for login-time sh -c, gui/<uid>/<label> matches the bootstrap form, only in the
  pkg-mode branch. Worst case is the pre-fix lingering entry, never a regression.
- Both launchd-safety guard refinements are SAFE (reviewer-verified dangerous cases): a
  bare install-path `launchctl bootout` of the board still reds the no-bootout claim and
  the sandbox-sweep; only plist-`<string>` DATA (login-time, not run by the installer) is
  excluded. shared runs() left markup-preserving so the board-plist-shape claims still hold.
- The self-bootout is separately + non-vacuously pinned. No em dashes.

### Deferred (weakest premise)
The self-bootout's registry-cleared effect and the two guard-refinement premises are only
fully checkable on a fresh Mac (launchd state is not observable in the JS suite). LOW
severity, NON cut-gating; rides an operator/native verify.
