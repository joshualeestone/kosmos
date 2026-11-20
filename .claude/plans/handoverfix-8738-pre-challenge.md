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

### Per-Iteration Breakdown

#### Iteration 1 (part 1: three deferred sender items, ccfd0b571f)
- [WARNING] the registered-folder check compared workerDir with itself, so it passed every folder --> FIXED (e24a404b34): dropped, the agent's own folder is the rule
- [WARNING] a mixed-case agent's own folder was not read as its own --> FIXED (e24a404b34)
- [NIT] the whole-tick backoff was longer than it needed to be --> FIXED (e24a404b34)

#### Iteration 2 (part 1)
- [NIT] a wait the clock was set back past stayed waiting --> FIXED (9855b850dc): dropped. Converged (minors only).

#### Iteration 1 (part 2: the sender's stop, 7438c3cc41)
- [WARNING] the stop could be answered by something other than an accept or "already past this" --> FIXED (6ea13170da)

#### Iteration 2 (part 2)
- [NIT] a dead not_open arm --> FIXED (278b1b931): removed
- [NIT] whether the notice ends with the part --> decided in 278b1b931 (it does). Converged.

### Left open, recorded on #8738 (not fixed here)
- [WARNING] keep the sealed manifest across tries: a try whose manifest grant moved the record to packed cannot be finished by a new try; the receiver ends it failed after an hour today
- [WARNING] whole pack per try: no index is kept, so every try uploads everything and the 500 MB cap counts every granted byte
- [NIT] folderBytes walks up to 200,000 entries synchronously on the board's event loop; it should yield every few thousand
- tidyOrphans: closed as not applicable (nothing it would tidy can exist with the registered-folder rule)
