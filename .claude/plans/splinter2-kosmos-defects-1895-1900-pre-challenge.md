---
pre_challenge: true
method: challenge-loop
branch: splinter2-kosmos-defects-1895-1900
diff_hash: 5db69c2c437b16d37c5c3a44e2c032e1e445069865c1d7dfddb8a6ab70dea0e6
validation: passed (node suite 3815/0; the only red is a shared-Mac contention flake in an unrelated test - see Validation note)
subdir_audit: passed
timestamp: 2026-09-03T00:20:10Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 found 0 BLOCKER/WARNING/CONVENTION)
**Total findings:** 5 WARNINGs + several NITs
**Fixed:** 5 WARNINGs | **Deferred:** the NITs

Independent adversarial loop on a patch authored by Splinter2 (relayed; he cannot push
from the other Mac) and applied by Splinter via `git am`. His two commits keep his
authorship; the three fix commits below sit on top (no squash - his authorship is the
only record of his contribution). The loop found real issues in BOTH his work and my own
fixes; per Splinter, said plainly and fixed.

### Validation note (why the local suite exited non-zero)

The node test suite is **3815 / 3815 pass, 0 fail**, and every shell arm passes EXCEPT the
3 arms of `tools/test-browser-run-guard.sh`. Those failed solely because foreign
`tools/browser-checks.sh` (Playwright) runs were live on this shared Mac (verified: pid
71512 and, at re-check, ~23 concurrent browser-check processes from other agents). That
guard's job is to refuse when a concurrent Playwright run is present, so it reds under
contention by design - its own SKIP text says "Run it deliberately on an idle box." The
suite's own footer diagnoses it: "A red that is green alone is contention, not the change."
This change touches engine/messages.js, server.js, install/kosmos and two test files -
nothing in the browser-check path - so it cannot cause a browser-concurrency failure.
Isolated CI runners have no concurrent browser-checks, so CI is the clean authoritative run.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 2 WARNINGs
- [WARNING] engine/room-clock-1895.test.js - the new test REPLICATES server.js's line composition into a local postLine() and vouches for it in a docstring; it does not EXECUTE server.js, so a revert of either fix stays green (Splinter2 later proved it: reverting server.js left 7/7 green). --> FIXED: added an endpoint test (server.projects.test.js) that appends a to:[] post and reads the real ?as=text endpoint; verified it reds on a revert of either fix.
- [WARNING] install/kosmos - the new help copy "Add --help ... to see what that one takes" overpromises: adopt --help runs a read-only dry-run scan, not usage. --> FIXED (copy).

#### Iteration 2 (reviewing my iteration-1 fixes)
**New findings:** 2 WARNINGs, both in MY fixes
- [WARNING] server.projects.test.js - my endpoint test wrote settings.timezone and appended to messages.LOG without restoring either, leaking Asia/Tokyo into any later room-text test. --> FIXED: wrapped in try/finally that clears messages.LOG and resets the timezone, matching the #563 test's discipline.
- [WARNING] install/kosmos - my copy named only adopt; whoami --help also runs a live read-only query, so it was still a totalising overclaim. --> FIXED: named whoami too.

#### Iteration 3
**New findings:** 1 WARNING + 1 NIT
- [WARNING] install/kosmos - Splinter2's report usage gained "(--project applies to needs_you and blocked)", but selfreport.js:240-242 reads --project from ANY report and treats `started --project X` as the canonical way to set a run's project; the note would steer an agent into the exact missed-light the design prevents, and is out of this PR's scope. --> FIXED: removed the note (the --project flag stays in the usage string). The reply "up to 2000 characters" note was verified accurate and kept.
- [NIT] install/kosmos - the --help line still said "see what a command takes", overclaiming for the 7 no-argument verbs. --> FIXED: changed to "Add --help to any command"; it now claims only the verified-true safety property.

#### Iteration 4
**New findings:** 0 BLOCKER/WARNING/CONVENTION (only NITs). **CONVERGED.**
Reviewer confirmed: the endpoint test genuinely guards both fixes against revert; roomClock is throw-safe on every edge; and EVERY user-facing CLI copy string verifies against the code it describes.

### Deferred NITs (all minor, none blocking)
- engine/messages.js - the fix's comment attributes the two-surface parity to the page's toLocaleTimeString, but the page uses the viewing browser's zone while the fix uses the stored Settings zone; they agree for a single-machine operator and the choice is correct (it matches the delivery/quote path), only the comment's attribution is loose. (Splinter2's comment; code correct.)
- server.js - `(store.readSettings() || {})` is redundant (readSettings already returns {} on failure). Harmless. (Splinter2's.)
- engine/messages.js - roomClock builds a fresh Intl.DateTimeFormat per call (<=40/render); trivial. (Splinter2's.)
- server.projects.test.js - my finally resets timezone to null rather than the pre-test absent state; harmless, matches the neighboring #563 cleanup.
- engine/messages.js - roomClock relies on en-GB for a 24h cycle rather than explicit hourCycle:'h23', and guards `!at` rather than an emptiness check (epoch 0); correct in practice, guarded by the midnight test. (Splinter2's.)

### Strengths
- The endpoint test executes the shipped server render and reds on a revert of EITHER fix (the `&& m.to.length` room fallback and the roomClock wiring) - closing the replica-only gap the plan honestly flagged. Asia/Tokyo (no DST) + explicit zones make 04:50 non-flaky.
- roomClock never throws inside the render path; unknown/stale zone degrades to the machine zone rather than dropping the time; the empty-array guard is complete (`[]`/null/absent all reach "the room").
- The zone is read once per render; the two message surfaces now agree on the instant; no other slice(11,16) UTC render remains.
- The plan honestly disclosed the replica-only coverage limit rather than hiding it, which is what made the follow-up findable.
