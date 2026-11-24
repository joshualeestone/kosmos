---
pre_challenge: true
method: challenge-loop
branch: unstarted-8951
diff_hash: 64d777f06c470f4d502345891ac4aa4eeb86a97758dfd5ec415ce2111a6502cc
validation: full suite PASSED on 55c936c954 (validation-log hash 64d777f06c47; node 30263 pass, 0 fail; test:shell 4 shards all green). The first run on 8863ae2b24 failed 6: five passed alone (load ~79, contention), one was the #1720 web-change guard, answered by the Browser-check trailer in 55c936c954 after render-onestep-8286 passed 20/20 on the branch.
subdir_audit: passed (rc 0)
timestamp: 2026-11-24T05:21:07Z
iterations: 20
converged: true
---

# Challenge-loop proof: unstarted-8951 (kosmos#8951)

Fresh blind read-only reviewers, alternating opus and sonnet, plus one outside read (PigeonPete). Every finding and fix is in .claude/plans/unstarted-8951.md; the shape of the loop:

- Iterations 1 to 5: [BLOCKER] a resume with nothing to resume erased the carried report; [WARNING] reports cleared before the sweep could show them, a restart read as a crash, pushes emailed after a clear, flags left behind after a report ended. All fixed.
- PigeonPete: [WARNING] a late start left a stale report on the card. Fixed.
- Iterations 6 to 9: [WARNING] narrower timing cases in four counters (in flight, turn opener, joined, after report). Fixed one at a time.
- Iteration 10: [WARNING] two joins a minute apart shared one clock. The counters were the wrong shape; redesigned to one record per message (msgs), all earlier tests passing unchanged.
- Iterations 11 to 13: [WARNING] the redesign batched waiting messages against the measured header, subagent events opened turns, a background subagent's busy state made messages wait, reported messages were dropped from the list. Fixed; main turns now tracked as mainTurnOpen.
- Iteration 13: my own regression to #7368's queue count, caught by the neighbour run and fixed at once.
- Iterations 14 to 19: [WARNING] counts after late starts, a resend's turn credited to the message it replaced, a carried report dropping a merged message, the unstarted report hiding #7368's stuck step, an opener guess that could under-report, a join clause that let reported messages back in. Fixed; the guess and the clause removed.
- Iteration 20: no new findings. Converged.

Decided costs, stated in the plan: no automatic resend (the message may be what kills the process); where the stream cannot say which waiting message a turn belongs to, the rules over-report rather than under-report.

Open items at BLOCKER or WARNING: none. Not covered here, and a device step: a live Windows check of an idle agent after a long quiet stretch, and why claude.exe died on the three messages (no stderr to work from).
