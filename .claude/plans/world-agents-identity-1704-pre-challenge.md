---
pre_challenge: true
method: challenge-loop
branch: world-agents-identity-1704
diff_hash: 20a47f84525dd3a58b2901a0aabd560a7440e065372b45994a52183b4bbddec2
validation: passed
subdir_audit: passed
timestamp: 2026-09-11T22:45:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, then sonnet).
**Converged:** Yes. Round 2 (sonnet) returned "NO NEW FINDINGS" and verified every
round-1 fix.
**Fixed:** every round-1 finding. Nothing was deferred in this slice. The Mac
counterpart (PR1m) is flagged to Angel per her decision.
**Asked (awaiting user):** the live check needs a world switch on Josh's running
board, which is pending his go. It is recorded in the PR. Merge waits for it and
for Angel's review.

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- .
':!.claude/plans/world-agents-identity-1704-pre-challenge.md'`, computed with node
over git's own output (87,202 bytes). That was after rebasing onto origin/main
`0efc126c`. The pre-challenge-gate hook is not installed on this Windows box, so
the recipe is written out here.

**Validation of record (Windows box):**
- The world and win32 suites plus reachability and one-derivation: 445/446.
- The one failure (`worlds.registry-1704`: a darwin path over a Windows temp
  path) also fails on main.
- The wider run's other pre-existing Windows failures are identical on main: 5 in
  reporthook and 10 in register/delete-leftover.
- macOS CI is the full-suite gate.

**Real-OS proof in the tests:**
- The anchored boot shim runs in a child process against a stand-in engine built
  from the REAL worlds, store, launchidentity and win32argv files. The world's
  roots, including `store.ROOT` itself, are in place before the supervisor loads.
- An unsafe world id exits 3.
- A named task on an engine too old for worlds exits 3, while a default-world task
  on that engine still runs.
- On Windows, a real named pipe with `+` in its name serves and connects.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- `install` could name the task by one world while its line carried another.
- The old-engine fallback ran a named task silently in the default world.
- Comments claimed hooks, the CLI and the Mac mint call the bootstrap.
- The marker did not record its world.
- The boot test did not check `store.ROOT`.
- A test enshrined the name/line split.

All of these are fixed and tested.

#### Iteration 2 (sonnet)
**NO NEW FINDINGS.** It verified:
- the one-world `install`;
- the parity of the field-7 check with win32argv;
- every marker transition;
- the copy semantics;
- every win32job verb's world;
- the pipe separator;
- test isolation;
- macOS compatibility.
