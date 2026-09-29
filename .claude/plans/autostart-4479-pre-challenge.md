---
pre_challenge: true
method: challenge-loop
branch: autostart-4479
diff_hash: 8e21ea973d1343843ac0a32d32937dc0df596b92c4a9a78e98f1575d96868025
validation: passed
subdir_audit: passed
timestamp: 2026-09-29T04:33:53Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (blind reviews alternating opus and sonnet, starting with opus)
**Converged:** Yes (iteration 4: no BLOCKER, WARNING or CONVENTION; NITs only). Iteration 2 had converged; the first validation then failed #3071 (the fixture used the tester's own agent name), and the rename re-opened the loop for iterations 3 and 4
**Deferred:** 0. **Asked:** 0.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] engine/machine.js - the shown name came from the profile only, while the board also reads the identity line, so an older or adopted agent was named two ways --> FIXED (create.spokenName, the board's own derivation, exported; test: no profile name, identity line "Neo" -> "Neo"; red with the profile-only read)
- [WARNING] engine/machine.js - "an unreadable plist check counts the agent as live" was false: fs.existsSync never throws, so an unreadable check hid the agent --> FIXED (create.jobPresence, only ENOENT is "not there", 'unknown' counts as live; test; red with existsSync)
- [WARNING] engine/machine.agentautostart-3182.test.js - the aggregation arms read the host's real profiles --> FIXED (shownName injected beside live)
- NITs applied: the removed agent in the fixture has a plist, so the removed-list filter is tested on its own (red without it); the plan's "exists" premise restated precisely

#### Iteration 2
**Reviewer model:** sonnet
- no BLOCKER / WARNING / CONVENTION (NITs only). Final validation then FAILED #3071 (an external person's agent name in the test fixture) --> FIXED (neutral name), and the loop re-opened.

#### Iteration 3
**Reviewer model:** opus
- [WARNING] engine/machine.js - two agents sharing a display name read as "Twin, Twin" --> FIXED (each carries its job name; test; red without it)
- [WARNING] engine/machine.js - the row named agents by board names and pointed at Login Items, which does not list them by those names --> FIXED (the sentence says they may not be listed by these names; claims no particular name)
- NITs applied: header comment reworded; the per-agent disk read noted; the Neo test cleans up its folder; the jobPresence stub says why it works

#### Iteration 4
**Reviewer model:** sonnet
- no BLOCKER / WARNING / CONVENTION (NITs only)
**Converged.**

### NITs (non-blocking)
- The default live / shownName closures wrap already-safe calls in try/catch and log nothing (as the removed-list catch above them); jobPresence is passed 'darwin' as a literal (the function returns null on any other platform first).

### Strengths
- The card's done criteria through the DEFAULT reads (a sandboxed LaunchAgents folder with real plist files, real profiles and instruction files): the fixture shows exactly one agent, "Harbor"; the old rule shows 3 (CONTROL); only leftovers is the all-clear; Windows is unchanged. The new tests are red on the old code.
- Read-only on a health-tick path: stale overrides are left, not written.
