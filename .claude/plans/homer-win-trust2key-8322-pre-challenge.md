---
method: challenge-loop
branch: homer-win-trust2key-8322
diff_hash: 997eaf9d6915f6e6b82907b2c44ac20592432c8309f407f18665d9e04387ecc6
rounds: 3
converged: true
blockers_open: 0
date: 2026-11-18T15:07:36Z
---

# Pre-PR review proof: homer-win-trust2key-8322 (#8322)

Three fresh blind CTO-lens review agents, each given only the diff, the issue and the plan.
- Round 1: 0 BLOCKER, 5 WARNING, 3 NIT. Fixed W1, W3, W5, N1, N2; W2, W4, N3 deferred to the card with reasons (plan).
- Round 2: 0 BLOCKER, 1 WARNING, 2 NIT. All fixed (take back in the recorded config file; a record with no config reads null; a removal arm across config files, mutation-checked).
- Round 3: 0 BLOCKER, 2 WARNING, 3 NIT, all leaving at most an inert leftover. Converged; listed on the plan for the card.

Hash taken against origin/main at 44a6f2c85a, HEAD 0ed54ba396.

## Findings, round 1
- W1 (fixed): the record did not name its config file; a board on another CLAUDE_CONFIG_DIR could edit a same-spelled line that was not ours. Entries now carry `config`.
- W2 (deferred): after a rollback to an older engine, a removal there leaves the also-record and a recreate there does not drop it. Needs an incarnation marker.
- W3 (fixed): a gone or empty config refused, keeping a red step forever. alsoOnly now answers ok there.
- W4 (deferred): other trustFolder callers (create.js trust-and-restart sweep, setAccount, worldstarts.js) can write a second key unrecorded. Inert, same as before.
- W5 (fixed): removal and launch wiring were pinned only by regex. Added behavioural remove.test.js arms.
- N1 (fixed): the forgettable:false arm ran against a malformed entry, so it could not fail.
- N2 (fixed): creation dropped the also-record AFTER the job's first launch could have written one. Drop moved before the start.
- N3 (deferred): first-write-kept erases a later false; drop by name not key; a re-aliased subst letter.

## Findings, round 2
- W-a (fixed): a config mismatch read as success and dropped the record over a line still there. forgetAlso now edits the recorded file under its own lock.
- N-a (fixed): an entry with no config fell back to this process's CONFIG(). recordedAlsoWrite now requires an absolute config.
- N-b (fixed): no removal arm could catch losing the config argument. Added the cross-file arm; mutation-checked.

## Findings, round 3 (converged, to the card)
- W1: first-write-kept compares key, not file. W2: a failed start does not drop a record its first launch wrote.
- N1: harden the recorded config path (.claude.json name, no UNC). N2: a corrupt also-record is moved aside silently. N3: the dry-run arm could assert the step is reported.
