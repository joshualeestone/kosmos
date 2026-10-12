---
pre_challenge: true
method: challenge-loop
branch: cutguard-flake-5914
diff_hash: acd2a1308e03bf0acd5bea90e650d601c9579e840b3f116e55242479a31dc4ad
validation: passed
subdir_audit: passed
timestamp: 2026-10-12T18:09:06Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

Three fresh reviewers (sonnet, opus, sonnet), none told what an earlier round had found.

**Iterations:** 3
**Converged:** Yes, at iteration 3 (no BLOCKER, WARNING or CONVENTION; NITs only)
**Total findings:** 14 (0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 10 NITs)
**Fixed:** 9 | **Deferred:** 5 | **Asked (awaiting user):** 0

**How reviewers were briefed.** The briefs were mine, not the skill's template. Each named the two changed files and
the product code they exercise, asked for the same hazard elsewhere in those files, and forbade running any test
file (the box's queue was busy and a release held it), so every reviewer result is from reading and small snippets.
Iteration 3's brief added one sentence: a limit of the new check that its comment states is not a finding, a limit
it does not state or a false statement is. That is the recorded wording decision of iteration 2, not a narrowing of
what the reviewer could read.

**What this change rests on.** The cause is a fork and exec race in the test, not in the queue. Measured by me: a
loop of `sleep 60 &` followed at once by `ps -o command= -p $!` read the forking script's command 0 times in 400 on
an idle box and 1 time in 600 with every core busy. I did not reproduce the whole control going red; the path from
that early read to the red (the guard deletes a marker whose recorded command differs from the live one) is read
from `_kosmos_suite_waiter_live`. The file already had the cure, `q_ready`, with a comment describing the race.

**Validation at d3f4fca27:**
- Full suite, run by me through the queue at d3f4fca27 (base 8c0702240): exit 0, 19,577 tests, 19,333 pass, 0 fail,
  244 skipped, shell 230 of 230 commands, validation hash acd2a1308e03.
- Two earlier runs were red and neither is evidence for this change. At cca2e126e (base 9ea673cd9) one test failed,
  main's own red test from before #5917, and the shell tests never ran. At fc319233a (base cc929514e) no test failed
  (19,521 node, shell 230 of 230) but the #3011 leak guard saw two agent files made on the live board during the run.
- The review ran before two rebases. Neither had a conflict, and the diff of my two files against the old head was
  empty after the first (checked by me with git diff). Main's change to `tools/test-cut-guard.sh` in between is the
  queue's default bound (#5907), not a stand-in site. Commit ids below are the rebased ones.
- The new check, run by me against main's copy of `tools/test-cut-guard.sh`: it names seven sites (p1, p2, wp three
  times, deep, wq), among them the line that went red on CI. Against this branch: none. With each wait removed in
  turn in a scratch copy (wp, p1, p2, deep, zp, zt, zd, wq) it names that site.
- Not run on Linux by me.
- Subdir CLAUDE.md audit: passed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/test-cut-guard.sh (deep stand-in): its command is recorded after a fixed one second sleep, the same race, and the check's comment claimed every site was covered --> FIXED (2d49131e4): q_ready takes a pattern and waits for it
- [WARNING] tools/test-cut-guard.sh (the awk check): it missed a read two lines on, a second start on a line, and other spellings --> FIXED in part (2d49131e4, 631009dee): the window is wider and the limits are stated
- [NIT] tools/test-cut-guard.sh (control): it demanded exactly three hits and tried one shape --> FIXED (2d49131e4): counts the waits, and a second mutation tries the same-line shape
- [NIT] tools/test-browser-run-guard.sh: the wait carried on silently when the stand-in never showed as sleep --> FIXED (2d49131e4)
- [NIT] tools/test-cut-guard.sh (comment): cites a measurement the repo does not hold --> DEFERRED: the measurement is on the card, which the comment names

#### Iteration 2
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/test-cut-guard.sh (canary stand-ins g1, g2, g3): guarded by a fixed 0.3 second sleep, and the top comment said every stand-in was waited for --> FIXED (631009dee): waited for with a pattern that needs the absolute tree
- [WARNING] tools/test-cut-guard.sh (the awk check): the waits for zp and zt could be deleted unseen, five and six lines from their starts --> FIXED (631009dee): the window is eight lines; both mutations now named
- [NIT] tools/test-cut-guard.sh (the awk check): a later start ends the watch on the one before, unstated --> FIXED (631009dee): stated
- [NIT] tools/test-cut-guard.sh (the awk check): the wait's text counts even inside a comment --> FIXED (631009dee): stated
- [NIT] tools/test-cut-guard.sh (p1, p2): the wait relied on a shell exec'ing the one command of a subshell --> FIXED (631009dee): `exec sleep`
- [NIT] tools/test-browser-run-guard.sh: the wait is a hand copy and the check does not read that file --> DEFERRED: one site, and it records no other command

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [NIT] tools/test-browser-run-guard.sh: the wait duplicates q_ready --> DEFERRED: duplicate of iteration 2
- [NIT] tools/test-cut-guard.sh (the awk check): `cmd && name=$!` would read as a start; errs toward a false alarm; no such line exists --> DEFERRED
- [NIT] tools/test-cut-guard.sh (controls): they mutate wp and p1 only --> DEFERRED: the other sites were mutated by hand (above) and by this reviewer, and each was named

### Decisions

- **The check is a tripwire, not a proof.** Its comment lists what it does not see: a read inside a helper, a read
  more than eight lines on, a second start on a line, the wait's text in a comment. Decided in iteration 2 and
  written there once. Weakest part: the three canary stand-ins are read through a helper, so their waits can be
  deleted without the check noticing.
- **Rejected: changing the product so a marker whose command differs is not dropped.** That rule is what stops a
  recycled pid being taken for a waiter. A real waiter marks its own pid long after its exec, so the race is the
  test's alone.
- **What would change my mind:** the control going red again on a run that has these waits. Then the cause is not,
  or not only, this race.
