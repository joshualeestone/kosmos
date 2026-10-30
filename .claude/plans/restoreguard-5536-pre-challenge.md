---
pre_challenge: true
method: challenge-loop
branch: restoreguard-5536
diff_hash: a368a5af57d8d3e07f48589cd224c83c7d65660817631fd02b02f11125efd614
validation: passed
subdir_audit: passed
timestamp: 2026-10-30T01:44:49Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

Three blind review rounds, converged. The ledger, with every finding and the reason it was fixed or left, is in
`.claude/plans/restoreguard-5536.md`. Design call: kosmos#5536 comment 6511811154.

#### Iteration 1: 0 BLOCKER, 3 MAJOR, 3 MINOR, 1 NIT
- MAJOR fixed: a failed precondition (no engine, node or restoreworld.js) left the guard off. A named world now reads as
  restored then.
- MAJOR fixed: a launch whose environment names another base missed the world. The supervisor also reads the mark beside
  the agent's own folder (<world>/workers/<name>), which needs no base. The test uses a deliberately wrong base and goes
  red with the check off.
- MAJOR, claim narrowed: env config cannot switch off every command a restored .git/config can run (filters, textconv,
  pager, sshCommand, credential helpers, includes). The guard is hooks and fsmonitor only; the rest goes to 4c-2's screen.
- MINOR documented: an inherited GIT_CONFIG_COUNT is replaced; running sessions keep their environment.
- MINOR fixed: a control for an existing unmarked world folder; the export pin also refuses declare -x and set -a.

#### Iteration 2: 0 BLOCKER, 0 MAJOR, 4 MINOR, 2 NIT
- The git 2.31 floor is said in the comment. The workdir check takes absolute paths only and counts a link as present.
- restoreworld.js's header now says the Mac supervisor asks (Windows is #7593 for Homer).
- The tests hide the worlds they make; the export pin's comment says what it covers.

#### Iteration 3: 0 BLOCKER, 0 MAJOR, 2 MINOR, 2 NIT (converged)
- The first test's world is hidden on every path.
- The base-mismatch test has a control: a folder with no mark above it gets no guard.
- NITs left: the mark check is lexical (it is the second check); the source pins break on cosmetic refactors by design.

#### Measured
- Premise, git 2.53: a pre-commit hook fired 1 time without the env and 0 with it; an fsmonitor command ran 1 and 0.
- Mutations: the PANE_ENV push off reds the restored arm, and the workdir check off reds the base-mismatch arm. Each was
  restored byte for byte.
- All 41 test files that name agent-supervisor or restoreworld: 1327 tests, 0 fail.
- Full validation passed on the second run. The first run had three reds under load: #1704 at 20.2 s against its 20 s
  harness timeout, plus #3827 and #570 7c-3, both in code this branch does not touch. Measured alone, alternating main
  and this branch: #1704 takes 2515/2514 ms on main and 2531/2553 ms here.
