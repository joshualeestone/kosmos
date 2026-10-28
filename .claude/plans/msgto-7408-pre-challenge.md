---
pre_challenge: true
method: challenge-loop
branch: msgto-7408
diff_hash: 7417ac25e6c4e0c9491755e66d472d7366a22f4b5d8b412fcf65304b45380e82
validation: focused (cli.task-message-to-7408 17/17 with server.task-msg-valve-768; the 25 test files that touch task messages or the limit: 1094/1094 after the rebase onto main); node --check and bash -n on every changed file; full suite left to CI
subdir_audit: passed (no subdir CLAUDE.md in the diff)
timestamp: 2026-10-28T03:27:38Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** Yes (round 8: no BLOCKER; its one WARNING fixed with a test and a mutant; 8-round cap reached)
**Fixed:** every BLOCKER and WARNING | **Deferred:** listed below with reasons | **Asked (awaiting user):** 0
From round 2 on, each new test was mutation-checked (mutant confirmed applied, the expected test red, file restored from a copy).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] an older board ignoring `to` read as if the names were told --> FIXED (the route answers `to`; both CLIs detect its absence)
- [WARNING] a sender naming only itself on an unassigned task heard "Nobody else" --> FIXED
- [NIT] tests read the summary rather than `delivered` --> FIXED

#### Iteration 2
**Reviewer model:** opus
- [WARNING] an agent stored under its key was refused as not on the project --> FIXED (key match when exactly one agent has the key)
- [WARNING] an unnamed sender could reach the whole project --> FIXED by a 403, REVERSED in round 3 (it shut out the person at a terminal)
- [WARNING] delivery tests passed with nobody told --> FIXED (assert delivery reached the named agent)
- [NIT] constant between a doc comment and its function; one stream for the older-board line; control-character wording --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [WARNING] the hint led an unnamed sender into a 403 --> FIXED (any sender may use `to`)
- [WARNING] `to` multiplied the limit's reach --> FIXED (each agent `to` adds is counted)
- [WARNING] the unnamed-sender guard was advisory but claimed otherwise --> FIXED (guard removed; the limit bounds it)
- [NIT] ambiguous name read as absent; missing project dropped names in silence --> FIXED (both refused)

#### Iteration 4
**Reviewer model:** opus
- [WARNING] the check counted one while the record counted more --> FIXED (the list counted before sending)
- [WARNING] a screen claim with `to` was never limited --> FIXED (limited; refused outright in round 8)
- [NIT] C1 on Windows; 64-character wording; naming yourself cost a slot; the hint after "Nobody else"; older-board words; stale test titles --> FIXED

#### Iteration 5
**Reviewer model:** opus
- [WARNING] check and record disagreed for an assignee named in `to` --> FIXED (one count from the task before recording)
- [WARNING] the refusal sentence counted placeholder sends --> FIXED (its own words)
- [WARNING] sends were counted only after delivery was awaited --> FIXED (counted right after the record)

#### Iteration 6
**Reviewer model:** opus
- [WARNING] at the limit a `to` message was quoted one slot's wait, then refused again --> FIXED (always its own cost)
- [WARNING] older-board words false for a named assignee --> FIXED
- [NIT] plurals, "adds", cap 0 with `to`, both name refusals in one answer, C1 in the error text --> FIXED
- [NIT] Mac/Windows check order on a malformed command --> DEFERRED: both exit 2, wording only

#### Iteration 7
**Reviewer model:** opus
- [WARNING] the count was called "task messages" though it holds agents named too --> FIXED (a separate message count for the words)
- [WARNING] never-fits hid its arithmetic --> FIXED
- [WARNING] the `to` words did not say the limit is shared --> FIXED
- [WARNING] the wait was untested to the second --> FIXED (seeded test pins 10 and 20 minutes; mutant on the index red)
- [NIT] a screen claim with `to` told to use the screen --> FIXED
- [NIT] the Mac C1 check depends on the locale --> DEFERRED: the board refuses such a name anyway
- [NIT] at the limit a missing task reads 429, not 404 --> DEFERRED: pre-existing order

#### Iteration 8
**Reviewer model:** opus
- [WARNING] at the limit, "name fewer agents" cannot help --> FIXED (only the wait; advice says how many fit below the limit; mutant red)
- [NIT] cap 1 read "name at most 0 agents" --> FIXED ("send it without --to")
- [NIT] cap-0 words for a message with `to` --> FIXED
- [NIT] a screen claim with `to` typed "The person said" to agents --> FIXED (refused: the screen names nobody)
- [NIT] the CLI "once" test did not count --> FIXED
Converged.
