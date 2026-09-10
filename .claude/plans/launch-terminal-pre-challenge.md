---
pre_challenge: true
method: challenge-loop
branch: launch-terminal
diff_hash: b122e413c49d037132a04d2de8ee93b2fc9efdcfae8a40fc1274f340a6733387
validation: passed
subdir_audit: passed
timestamp: 2026-09-07T07:27:00Z
merge_note: origin/main merged in to resolve a server.js conflict after #2386 (the sibling trust-and-restart route) landed first; both routes and both requires kept. The launch-terminal code under review is unchanged; full suite re-validated green on the merged HEAD.
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes
**Total findings:** 8 (0 BLOCKERs, 0 WARNINGs, 3 CONVENTIONs (one recurring), 5 NITs)
**Fixed:** 3 | **Deferred:** 5 | **Asked (awaiting user):** 0

Change: a new engine module `engine/terminal.js` and route
`POST /api/agent/:name/launch-terminal` (a #2129 companion) that opens a
Terminal.app window attached to a live agent's tmux session via osascript, plus
`server.launch-terminal-2129.test.js`. A final full-suite run (6j) surfaced a
fixture-discipline violation (a hand-built roster row in the SAFE_SESSION test),
which was fixed and re-validated green.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 2 NITs
- [CONVENTION] .claude/plans/ -- no plan file --> DEFERRED at the time, later ADDED (the repo hook requires one).
- [NIT] server.js -- environment failures (tmux unaskable, osascript/headless) mapped to 400 --> FIXED (commit fbc3494d): openTerminal marks those `unavailable` and the route answers 503; a genuine refusal stays 400.
- [NIT] test -- a test titled "a name we cannot read never reaches the engine" actually drove the empty-name module path, overclaiming coverage --> FIXED (commit fbc3494d): renamed to say what it does; added a route-level 503 arm and asserted `unavailable` on the fail-closed arm.

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs
**Duplicates (confirmed):** the plan-file CONVENTION.
- [NIT] server.js -- the 500 fallback returns `detail` --> DEFERRED: matches the /restart sibling; openTerminal is documented never to throw (the catch is defensive), and the route is board-token gated.
- [NIT] test -- the shell/AppleScript quoting was only exercised on benign values; the one hostile input is caught by SAFE_SESSION first, so the quoting (the ONLY guard on tmuxBin) was unproven --> FIXED (commit 7b584da8): exported shellSingleQuote/appleScriptString and unit-tested them against quote/metachar/backslash input incl. the composition, asserted by reversing the AppleScript escaping. Verified red under a swapped escape order.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Duplicates (confirmed):** the plan-file CONVENTION.
- [NIT] engine/terminal.js -- the SAFE_SESSION comment claimed paneRoster marks a session ours only as <NAME_RE>-discord, but a @kosmos_agent claim also does, unbounded in shape --> FIXED (commit 6269a3b9, comment-only): corrected the comment and named the safe-by-design consequence (an unusually-named claimed session is refused, not shell-quoted).
- [NIT] engine/terminal.js -- appleScriptString does not escape a raw newline --> DEFERRED: fails closed (osascript errors -> 503) and cannot inject (all `"` escaped); tmuxBin is not attacker-reachable.
**Converged** -- no new actionable BLOCKER/WARNING/CONVENTION; only cosmetic NITs.

#### Final validation (6j)
The full suite flagged one synthetic finding:
- [BLOCKER] final-validation: fixture-discipline -- the SAFE_SESSION test hand-built a `{sessionName,...}` roster row --> FIXED (commit 98d8434c): the arm now gets a real "ours" row from fleet.install (strict:false) and overrides only its session to the hostile value; re-validated green, and the arm is still red when the guard is removed.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | CONVENTION | .claude/plans/ | No plan file | FIXED | plan added (hook requires it) |
| 2 | 1 | NIT | server.js | Env failures were 400 not 503 | FIXED | fbc3494d |
| 3 | 1 | NIT | test | Misleading test title | FIXED | fbc3494d |
| 4 | 2 | NIT | server.js | 500 returns `detail` | DEFERRED | Matches /restart sibling; catch is defensive |
| 5 | 2 | NIT | test | Quoting unproven under adversarial input | FIXED | 7b584da8 |
| 6 | 3 | NIT | engine/terminal.js | SAFE_SESSION comment imprecise | FIXED | 6269a3b9 |
| 7 | 3 | NIT | engine/terminal.js | appleScriptString no newline escape | DEFERRED | Fails closed; not attacker-reachable |
| 8 | 6j | BLOCKER (synthetic) | test | Hand-built roster row (fixture-discipline) | FIXED | 98d8434c |

### Strengths (across all iterations)
- Command-injection defense layered and verified by tracing a `'`-bearing path through both quoting layers; SAFE_SESSION rejects metacharacters; tmuxBin (the one un-allowlisted value) neutralized by the quoting, now proven directly. (iters 1-3)
- Auth inherited by construction: not in REMOTE_AGENT_ROUTES (network peers refused), board-token gated, CSRF-covered. (iters 1-3)
- Path traversal via :name closed: the raw name only FINDS a card; the value reaching the shell is the resolved, SAFE_SESSION-guarded session. (iters 1-3)
- 400-vs-503 mapping correct and tested on both axes; fail-closed on an unaskable tmux. (iters 1-3)
- Tests drive the real HTTP route with fake panes so paneRoster resolution runs for real; osascript intercepted so no window opens; the two security guards each verified red under a matching perturbation. (iters 1-3)
