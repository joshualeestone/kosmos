---
pre_challenge: true
method: challenge-loop
branch: s7dc4-6590
diff_hash: 9ea43a62a31c505ad40c562af38783a3972efe78c6016d0e3a4691257c5fd7c2
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T02:33:09Z
iterations: 2
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (a blind review of the whole part, then a delta review of the waitSig fix made at the rebase), plus
Mona Lisa's design review of the screens (all six points taken).
**Converged:** No: the delta round had no BLOCKER or WARNING, and its one fixed NIT (T11d) was not re-reviewed; the
other three NITs are decided in s7dc4-6590.md.
**Validation:** the Mortals full suite on head 39ac66ac12, rebased onto main after c3 (#7012) merged:
**23636 tests, 0 failed** (hash 9ea43a62a31c, the diff this proof hashes).
**Inert:** nothing here changes behaviour until the board-v2 marker exists (c6 writes it, in a release of its own).

### Per-iteration breakdown (details in s7dc4-6590.md)
#### Iteration 1: 0 BLOCKER, 3 WARNING, 3 NIT
- [WARNING] the lost-ack used the report read after the tunnel call --> FIXED (read before; a different one refused)
- [WARNING] Got it during another action said nothing --> FIXED (says to wait; aria-busy; focus kept)
- [WARNING] no test pressed Got it with the alarm standing --> FIXED (browser check T11b; an engine test)
- [NIT] where the details are --> FIXED; two NITs DECIDED (see the plan)
#### Rebase onto main: c1's repaint gate missed the pause's finding and reason
- FIXED: both in waitSig; browser check T11c pins each, and each mutant fails only its own arm
#### Iteration 2 (delta): 0 BLOCKER, 0 WARNING, 4 NIT
- [NIT] T11c set WAIT.cw itself --> FIXED (T11d through the board's own answer); three DECIDED (see the plan)

### Weakest premise
That nothing else the waiting section draws changes without a poll. The delta review enumerated every field and global
it reads and found none missing; busy and typed are left out on purpose.
