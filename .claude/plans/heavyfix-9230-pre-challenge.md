---
pre_challenge: true
method: challenge-loop
branch: heavyfix-9230
diff_hash: 81d5d93c317a425410b3a620a196e0064ac4fda0c5a8baa9abfcb998249084d9
validation: passed
subdir_audit: passed
timestamp: 2026-11-28T03:58:59Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped after iteration 8 by Splinter's standing usage rule (Fleet Builders m510, 2026-10-26: stop
at 8 unless a BLOCKER is open). No BLOCKER was found in any round. Round 8 found no WARNING; its NITs were taken.
**Total findings, rounds 4 to 8:** 0 BLOCKERs, 1 WARNING, 12 NITs. Rounds 1 to 3: the per-severity counts were not
recorded when they ran (an earlier session); what each round changed is taken from its own commit, below.
**Fixed:** every WARNING; NITs fixed or answered as listed | **Deferred:** card item 4 (Windows parity) to Homer | **Asked:** 0

Code fixes with arms measured red by mutation (focused file, engine/heavyjobs-9217.test.js): removing `at` from
live()'s drop key reds the #9230 inside-a-read arm; removing the carry-over reds three arms; removing the equal-`at`
step in start() reds exactly the same-millisecond arm. Not pinned by any test, by design (see the plan): that the
carry-over read is inside the lock.

**Closing validation.** Full validation of 23439dd3ba passed: 31884 node tests, 0 failures, the shell part in 4 shards all green, rc 0, audit rc 0, clean tree, head unchanged. Main had moved on, touching none of this branch's files (merge-base overlap empty, measured 21:59 CST).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** counts not recorded at the time
**Self-generated:** 0
- A re-announce made from inside a read could be removed by that read's drop; no arm reached it --> FIXED (49df643787, an arm that reds without `at` in the key)
- The GET comment did not say what a pane-named listing shows beyond end --> FIXED (49df643787)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** counts not recorded at the time
**Self-generated:** 0
- The carry-over and the since check read the file twice under the lock --> FIXED (c33ab025ae, one read)
- The comment above `unread` and the timing arm's title overstated or misplaced what they pin --> FIXED (c33ab025ae)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** counts not recorded at the time
**Self-generated:** 0
- The race arm did not assert its own premise (only `at` differs) --> FIXED (acbd362a62, a control assertion)
- The cap check still read the file separately --> FIXED (acbd362a62, one read serves cap, carry-over and since)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [NIT] engine/heavyjobs.js drop key: say it narrows the race --> FIXED (c6e49489e2)
- [NIT] engine/heavyjobs-9217.test.js:456 title hard to read --> FIXED (c6e49489e2)
- [NIT] plan silent on card item 4 --> FIXED (c6e49489e2, named and left for Homer)

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0
- [NIT] no arm pins the carry-over read being inside the lock --> ANSWERED (9ed98ab647, the plan says why no seam reaches it)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [NIT] drop-key comment wording --> FIXED (5a1b6b2a0a)
- [NIT] doubled trailing comment on the since line --> FIXED (5a1b6b2a0a)
- [NIT] the unpinned in-lock read --> AGREED, no change

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [WARNING] engine/heavyjobs.js:254 - a same-millisecond re-announce shared the dropped record's key; the plan said "never" --> FIXED (6389bd4fdc, start() never gives a re-announce a replaced record's `at`; new arm measured red without it)
- [NIT] three: the unpinned read and item 4 go in the PR body; round 7 of #9222 is the record for pane-named listing --> ANSWERED

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0
- [NIT] engine/heavyjobs.js:202 - the bump inherited a record stamped ahead of this clock, stretching the 12 h ceiling --> FIXED (23439dd3ba, bump only on an equal `at`; the same-millisecond arm still reds without it, measured)
- [NIT] comments said "always later" --> FIXED (23439dd3ba)
- [NIT] the ceiling arm is weaker than before --> AGREED, by design (plan item 3)

### Final Ledger

| # | Iter | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | 1 | not recorded | re-announce inside a read dropped; no arm | FIXED 49df643787 |
| 2 | 1 | not recorded | GET comment vague | FIXED 49df643787 |
| 3 | 2 | not recorded | two reads under the lock | FIXED c33ab025ae |
| 4 | 2 | not recorded | comments overstated | FIXED c33ab025ae |
| 5 | 3 | not recorded | race arm did not assert its premise | FIXED acbd362a62 |
| 6 | 3 | not recorded | cap check read separately | FIXED acbd362a62 |
| 7 | 7 | WARNING | same-millisecond key collision | FIXED 6389bd4fdc |
| 8 | 8 | NIT | future `at` inherited | FIXED 23439dd3ba |

### NITs (non-blocking, across all iterations)
Rounds 4 to 8 NITs are listed under each iteration above.

### Strengths (across all iterations)
One read under the lock serves every decision start() makes; every code fix has an arm proved red by mutation, and
the one property that no test can reach is named as such in the plan.
