---
pre_challenge: true
method: challenge-loop
branch: signinstall-7212
diff_hash: 3c59074d0175f42bd4544f06b369a10284df0355ffc4c33d84fcc74a955f77ca
validation: full suite (tools/run-tests.sh) on f6ab7a08b8, the branch with origin/main merged (58 commits; 3 additive conflicts resolved): EXIT 0, 24949 tests = 24545 pass + 0 fail + 0 cancelled + 404 skipped + 0 todo, shell suite all green (4 shards), tree unchanged before and after. Earlier on 894ad8c8b2 (pre-merge): 24803 / 24421 / 0 fail. Static guards in the suite: fixture-discipline, engine.reachable.
subdir_audit: passed (no CLAUDE.md in the diff)
timestamp: 2026-10-28T00:40:55Z
iterations: 8
converged: false (the round limit of 8 was reached; round 8 found no blocker and no major; its fixes have tests and mutants red, not put to a ninth round)
---

## [CHALLENGE-LOOP] Summary
**Iterations:** 8 blind reviewers (opus, sonnet alternating; round 8 whole-branch with nothing settled). Decisions,
rejections and the weakest premise: .claude/plans/signinstall-7212.md.

### Iteration 1 (opus)
[WARNING] the test seam replaced the whole check, so which account row a card matched was untested: seam moved to the list and the live call.
[WARNING] after signing in again the card said "Sign in again" for up to an hour: a connected answer is heard at once.
[NIT] a throw before the check left it running forever; the sweep could start a second check; a refused key said "sign in": fixed.

### Iteration 2 (sonnet)
[WARNING] the record was per agent, so N stuck agents on one account started N live checks an hour: per account now.
[NIT] only the accounts screen's check was heard: every subscription.checkLive caller is. [NIT] a late "none" overwrote a newer "connected": ignored.

### Iteration 3 (opus)
[WARNING] `claude auth status` is expiry-blind (#874): "signed out" is now decided as the AI Models badge decides it (observed.verdict).
[NIT] a key's verdict could be cleared by a reader that never tries the key; the wrapper was tested by reading source: fixed, behaviour tests.

### Iteration 4 (sonnet)
[WARNING] a fresh 401 outranked a sign-in heard after it (later reversed in iteration 5 for parity with the badge).
[NIT] tests mixed a fixed clock with real time where the code stamps real time: fixed.

### Iteration 5 (opus)
[WARNING] the card read only the stuck agent's own requests while the badge reads any agent's on the account: one shared join (claudeObservationsFor).
[WARNING] iteration 4's rule let an expiry-blind "connected" erase a real 401: removed; the card and the badge agree.
[NIT] an unknown answer kept an old "none"; the default folder named by path missed the default record: fixed.

### Iteration 6 (sonnet)
[WARNING] a "none" the AI Models screen just saw never reached the card: every heard answer is recorded, older checks lose.
[NIT] the join was built for a stuck Codex card; the join had no test on real jobs; a stale key flag: fixed.

### Iteration 7 (opus)
[NIT] a default-folder check by path (its decoy file) could accuse the default account: never heard. [NIT] the route's step untested: overlayStuckCards, tested.

### Iteration 8 (sonnet, whole branch, nothing settled)
[NIT] a hung check blocked re-checking: one running ten minutes is taken as hung. [NIT] a folder's path spellings were different keys: resolved.
No blocker or major. Stated: the join's file reads while a card is stuck; the live answer can be up to an hour old.

### Merge with main
#7368's stall (a step that never ends) is never relabelled a sign-out; test with a signed-out control, mutant red.
