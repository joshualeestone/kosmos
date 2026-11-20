---
pre_challenge: true
method: challenge-loop
branch: handoverfix-8738
diff_hash: 1872050872de680271d06f700daa17a2ef9f7f0ec41589ae68f037c211d0861b
validation: passed
subdir_audit: passed
timestamp: 2026-11-20T03:02:31Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** two blind review rounds for each of the branch's two parts, on the whole branch each time.
**Converged:** Yes. Each part's round 2 found only minors, fixed in that round's commit.
**Validation:** the full kosmos validation on Agent1s at 278b1b931 (rebased onto main after #8775 merged), 2026-11-19 20:44 CST: 30120 node tests, 0 failed, 0 cancelled; test:shell as 4 shards, all green; the subdir CLAUDE.md audit passed.

### Part 1: three of #8710's deferred sender items (ccfd0b571f)
- Round 1 (e24a404b34): the registered-folder check compared workerDir with itself --> FIXED (dropped, replaced by the agent's own folder); a mixed-case agent's own folder is its own --> FIXED; the whole-tick backoff was too long --> FIXED (shorter)
- Round 2 (9855b850dc), converged, minor: a wait the clock was set back past --> FIXED (dropped)

### Part 2: the sender's stop (7438c3cc41)
- Round 1 (6ea13170da): the stop must be answered only by an accept or "already past this" --> FIXED
- Round 2 (278b1b931), converged: a dead not_open arm --> FIXED (removed); the notice ending with the part --> decided, written in the commit

### Left open, recorded on #8738 (not fixed here, each with its reason)
- Keep the sealed manifest across tries: a try whose manifest grant moved the record to packed cannot be finished by a new try; the receiver ends it failed after an hour today
- Whole pack per try: no index is kept, so every try uploads everything and the 500 MB cap counts every granted byte
- folderBytes walks up to 200,000 entries synchronously on the board's event loop; it should yield every few thousand
- tidyOrphans: closed as not applicable (nothing it would tidy can exist with the registered-folder rule)
