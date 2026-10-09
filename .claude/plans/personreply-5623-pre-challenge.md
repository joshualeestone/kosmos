---
pre_challenge: true
method: challenge-loop
branch: personreply-5623
diff_hash: 538d9b08e8d772937e1d41faee16bca6589f59ad2d2c77abb6b0a2b2ebfa3060
subdir_audit: passed
timestamp: 2026-10-09T00:27:51Z
converged: true
iterations: 18
reviewers: opus and sonnet alternating, blind
---

## [PRE-CHALLENGE] Challenge loop, 18 blind iterations, converged at 18

kosmos#5623 slice A (Rule 1): a person's comment on an agent's post is a must-answer. Every finding and decision, review by
review, is in `.claude/plans/personreply-5623.md`. Review 18 (sonnet) found nothing above NIT. Full suite at convergence:
17175 tests, 0 fail, 0 cancelled, END rc=0 (queued-heavy turn 18:57 to 19:27 CDT).

## Final Ledger

- [BLOCKER] r1: an answer the read could not see (a thread only partly fetched) read as none and invited a second public
  reply --> FIXED: owed only when the whole thread is in hand. Plant P4.
- [BLOCKER] r2: a re-tell pointed at read --replies, which no longer showed the comment --> FIXED: the read's own owed
  section (tested at r14, plant P10).
- [WARNING] r1-r3: person comments told twice via the regular line; the name typed into a Kosmos line; given-up entries
  starving newer ones; no rest for a pane that never takes a line --> FIXED (P5, tests).
- [WARNING] r4-r5: same-second answers; replies addressed to someone else; the answer must address the person --> FIXED.
- [WARNING] r6-r10: cap-full reads of the whole roster; the persons round and its reset; held/busy counted as fails;
  slots; book fields wiped by the regular path --> FIXED (round test r15, plants P11, P12; P7, P8).
- [WARNING] r11-r15: the matcher's blind spots (rename, unnamed, direct replies) could invite a duplicate --> FIXED:
  every tell, the read's mark and the managed block say to do nothing if already answered (P9); own-thread follow-ups
  owed (P13).
- [WARNING] r16-r17: own-thread rule only after the agent answered HER; a direct answer under its own comment counts
  --> FIXED, tested.
- [WARNING] stated, decided: a thread larger than the read pages stays unknown (never told); a deleted or out-of-view
  entry stays in /sent up to 14 days; agents idle 2-10 min are read every pass (extra service requests).
- [CONVENTION] doc comments rebound to their items (r7, r11); shared PERSON_MARK (r5, r6, r17).
- [NIT] left: personOwed computed twice per thread in the read; the dense person block left inline.
- [STRENGTH] fails toward a missed tell, never a duplicate public reply; clears only on positive evidence; write-ahead
  with a narrow rollback; the person's name never typed.

## Verification

- 795 tests across every file that mentions replynudge, communityread, communityblock or /api/community/sent: pass.
- engine/replynudge.person-5623.test.js and communityread.test.js's owed-section test; plants P1 to P13 each red one.
- Full suite at convergence: 17175 tests, 16943 pass, 232 skipped, 0 fail; shell suites pass; END rc=0.
- Windows: rides the agent's idle self-report, which #5618 (merged b59891fd2) fixes on Windows.
