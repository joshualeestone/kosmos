---
pre_challenge: true
method: challenge-loop
branch: machine-check-979c
diff_hash: 7a7feadb6c35c53188d132eb6eebb7b86fc9853ddb25607ab18fde2965960f16
subdir_audit: passed
timestamp: 2026-08-26T21:05:59Z
iterations: 1
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** No. One pass, and it found a genuine sequencing hazard that is now fixed. Stopping
here is a judgment: the pass found nothing wrong with the design, the fixes it prompted are small
and each is covered by a test, and the branch is one function.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 7 WARNINGs, 5 NITs

- [WARNING] engine/machine.js - **"Everything it needs is installed" becomes a promise for no
  provider in particular.** `createAgentInner` requires tmux PLUS the runner for the chosen
  provider, so a Mac with tmux and no Claude gets a clean row and a refusal on the next screen.
  Masked today only by the installer gate that `installer-979b` removes --> FIXED at the honest
  end: `present` now answers for BOTH runners, and `create.js`'s refusal points at Connect
  rather than sending a person to a website to do by hand what Connect does with a checksum.
- [WARNING] engine/machine.js - the `present` map omitted **codex**, the runner #979 was actually
  filed about --> FIXED
- [WARNING] engine/machine.js - the map's keys were **display labels**, so a copy edit silently
  renames a JSON key and the consumer reads `undefined`, which is falsy, which reads as absent,
  collapsing the null-vs-false distinction the change exists to protect --> FIXED (stable ids,
  asserted on the wire including that `'Claude Code' in present` is false)
- [WARNING] engine/machine.js - the dead-machinery cost is **larger than the plan admitted**: the
  output is unobservable, not merely untested, and the plural title branch and every multi-item
  join are unreachable too --> FIXED (plan corrected; machinery kept deliberately)
- [WARNING] engine/machine.test.js - two test names overclaim after being re-aimed --> FIXED
- [WARNING] engine/machine.test.js - an assertion message no longer describes what it guards --> FIXED
- [WARNING] engine/machine.js - **the only attention headline this row can now print is "tmux is
  not where we can use it"**, and two rulings in this codebase say that word must not reach a
  person --> HANDED TO MONA LISA (copy is hers; flagged rather than rewritten)
- [NIT] engine/machine.js - two worked examples in comments are stale, one of which would have a
  reader run its own repro and conclude the fix regressed --> FIXED
- [NIT] engine/machine.js - `present` had no consumer and no wire test --> FIXED (route test)
- [NIT] engine/machine.test.js - a vestigial fixture --> FIXED
- [STRENGTH] - the required/informational split is correct against the code it vouches for:
  `createAgentInner` resolves `runnerBin` per provider and checks only that plus tmux.
- [STRENGTH] - one probe loop rather than two, so there is no second definition of "is it
  installed" to drift, which is this function's own stated thesis.
- [STRENGTH] - `present` is set on every exit of the loop body and every return, with
  `null` vs `false` correct in each case (verified across all six paths).
- [STRENGTH] - both new #979 tests are revert-sensitive, and the control on `present` is
  load-bearing: without it, the `false` assertions would pass against a map answering false for
  everything.

### ⚠️ Stated cost, not hidden

With a single required part, two simultaneous required findings cannot be constructed, so the
three-bucket "every bucket gets said" machinery is **unobservable**, not merely untested. It is
kept because it is correct code that three separate incidents paid for and a second required part
is plausible. The test that guarded it now asserts the half that is still reachable and records
what it lost.
