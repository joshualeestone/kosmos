---
pre_challenge: true
method: challenge-loop
branch: pkg-gate-1562
diff_hash: a88305e244965bcceba77ce1e359577f437ce6c0a65329a0cccbb468242b20c2
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T14:02:51Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 found zero actionable findings after deferral)
**Total findings:** 6 (0 BLOCKERs, 1 WARNING, 1 CONVENTION, 4 NITs)
**Fixed:** 4 | **Deferred:** 1 | **Asked:** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 (ITER_COMMITS empty on the first reviewer pass)
- [WARNING] tools/test-pkg-arch-gate-1562.sh, Origin BRANCH: the arch negative control tested the `has` substring helper, not the `grep/sed` extraction the assertion uses, so it proved nothing about the real pipeline. --> FIXED (ca3e7c7a): controls now run the same `xval` extraction on the old/ungated shapes.
- [NIT] tools/test-pkg-arch-gate-1562.sh, Origin BRANCH: the OS-gate assertions used a substring over the block, not value extraction. --> FIXED (ca3e7c7a): extract the `os-version min` value.
- [NIT] tools/build-installer-pkg.sh, Origin BRANCH: `allowed-os-versions` gates the target volume (= running OS only for a boot-volume install); note the cut must confirm the OS refusal fires. --> FIXED (ca3e7c7a): plan note added.
- [STRENGTH] `hostArchitectures="arm64"` is the correct declarative mechanism to refuse Intel at load; a separate arch installcheck is genuinely unneeded (validated the safe-native decision).

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 0 actionable
**Converged** - no actionable findings after the CONVENTION was deferred.
- [CONVENTION] .claude/plans/pkg-gate-1562.md, Origin BRANCH: plan filename lacks a `-timestamp` suffix. --> DEFERRED: the bare `<branch>.md` form is established repo practice (the reviewer itself lists untimestamped siblings; #2682's reviewer confirmed it is not a violation). The timestamped form is the master-plan-sequence shape, not required for a single-plan branch.
- [NIT] tools/test-pkg-arch-gate-1562.sh, Origin BRANCH: `xval` was "comment-immune" only by luck (a future editor writing a literal quoted attribute in the XML comment would be picked up first). --> FIXED (4655ca23): strip XML comments before extraction, with a control proving the strip works.
- [STRENGTH] fix well-targeted; no regression for supported Macs (min 13.5 inclusive both sides); the source guard is done right (value extraction, faithful controls, no vacuous pass, drift guard); plan weakest-premise honest.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/test-pkg-arch-gate-1562.sh | BRANCH | Arch control tested a different mechanism | FIXED | ca3e7c7a |
| 2 | 1 | NIT | tools/test-pkg-arch-gate-1562.sh | BRANCH | OS gate used substring not value | FIXED | ca3e7c7a |
| 3 | 1 | NIT | tools/build-installer-pkg.sh | BRANCH | target-volume nuance note | FIXED | ca3e7c7a |
| 4 | 2 | CONVENTION | .claude/plans/pkg-gate-1562.md | BRANCH | plan filename lacks timestamp | DEFERRED | established repo practice |
| 5 | 2 | NIT | tools/test-pkg-arch-gate-1562.sh | BRANCH | xval comment-immunity only lucky | FIXED | 4655ca23 |

### Outstanding questions (ASKED)
None.

### Strengths (across iterations)
- `hostArchitectures="arm64"` + `allowed-os-versions min 13.5` correctly move both refusals up front into native macOS Installer behavior, with no regression for supported (arm64, macOS 13.5+) Macs.
- The source guard reads attribute values, runs identical extraction on real + control inputs, cannot pass vacuously, and ties the pkg floor to setup.sh's floor as a drift guard.
- The plan honestly names the on-device-gating verification gap (Mona + a real Intel/sub-13.5 Mac at cut) as its weakest premise.
