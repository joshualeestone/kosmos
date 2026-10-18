---
pre_challenge: true
method: challenge-loop
branch: askkey-6417
diff_hash: 584f395ab4fdd75ff7c08383a3a4d43fcbb6789fd689b0c96787eef74738f6e8
validation: passed
subdir_audit: passed
timestamp: 2026-10-17T23:04:33Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs)
**Total findings:** 0 BLOCKERs, 7 WARNINGs, 0 CONVENTIONs across 4 iterations (plus 8 NITs)
**Fixed:** 5 WARNINGs and half of a sixth | **Decided, recorded in the plan:** 1 WARNING and the other half (below) | **Asked:** 0

Validation (6j): docs/browser-checks/render-plus-asks-signin-4610.js through queued-heavy at 4bd2a53c, the reviewed
commit, rebased onto main after #6418 merged: CHECK_EXIT=0, all plus-asks-signin checks passed, all five #6417 arms
at both widths (1400 and 390). CI runs the full suite on the PR.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] a code lapsing after ten minutes brought a dismissed notice back, and the comment said otherwise --> FIXED
  (a computer row with no code counts as put away when any of its codes was; the comment names start, wait and lapse)
- [WARNING] a notice dismissed while an attempt starts (no code yet) shows again when the first code arrives -->
  DECIDED, not changed: the code is what the person needs to act on; recorded in the plan's Decided list
- [WARNING] the "waiting on a new attempt" arm served a sequence the tunnel does not produce --> FIXED (the arms are a
  lapse to an empty code and a wait with no code, labelled as such)
- [WARNING] code_wait in the key had no arm that could fail --> FIXED (code_wait dropped from the key, with the reason
  in the plan: waits would have brought the notice back with nobody asking)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] the ten-minute drop was not cited to the producer --> FIXED (the comment cites kosmos-relay
  crates/tunnel/src/pairing.rs, REVEAL_TIMEOUT_SECS, 600 s)
- [WARNING] the before-first-code case is untested, and the plan did not say Review puts away the same keys --> the
  Review half FIXED (the plan states it); the untested case left as the recorded decision above

#### Iteration 3
**Reviewer model:** opus
- [WARNING] the empty-code arms could not tell the rule from one where every computer row with no code is put away
  --> FIXED (an arm: another computer whose id starts the same way, with no code and never put away, shows the notice)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Converged**: no new actionable findings.

### Strengths
- Phones and browsers keep their key exactly; only a computer's row carries its code, and the empty-code match is a
  prefix of that same row's own dismissed keys, with a CONTROL and a prefix-sibling arm.
