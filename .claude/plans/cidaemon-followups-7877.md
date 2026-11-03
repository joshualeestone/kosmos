# cidaemon-followups-7877: round 8's warnings on the ci-runner daemon stage

Card: kosmos#7877 (follow-up to #7001, PR #7878 merged as 7a37ec1c3e). Per-item decisions are on the card
(comment 6616421782).

## Done
- W1: stand-in mkdir hook (FX_LINK_ON_MKDIR) and arm `mkdirlink` for the second agent_file_ok. Mutation reds.
- W2: printed move: the CI user reads the agent, root writes the copy, checked not empty and the same before the
  CI user's rm; put_back_cmd and put_back remove the retired copy only after cmp;
  newest_retired skips empty files. Arms emptyret, pbfail, pbok. Mutations red.
- W3: runner_plist reads only a regular file that is not a symlink (-f and ! -L); arm pllink checks root never runs
  plutil on a symlinked plist. Measured: plutil refuses a FIFO itself (rc 1, no hang),
  so arm plfifo uses a plutil stand-in that blocks on a FIFO; the mutation of -f reds it.
- W4: closed with the round-2 measurement.
- NITs: parent-dir check (arm gwdir, mutation reds); no-pid message; FileVault and ps -U wording; test runs a 755
  copy; signals arm `sigs` (mutation reds). %Lp NIT measured false (775 for 4775), arm `suid` pins it, no code.
  4601 stat stand-in NIT closed: test-only, fails loud as root.

## Validation
- tools/test-ci-runner-daemon-7001.sh: all passed after every review round; each new arm reds under a mutation of
  the code it guards (plfifo only with the blocking plutil stand-in, suid pins a measured fact).
- tools/test-ci-runner-setup-4601.sh: all passed (268 ok, rc 0) on 46cfb3aae6, 2026-11-03 16:01. It does not read the
  daemon stage's printed commands; rerun at the end if runner_plist changes again.

## Weakest premise
The printed commands are checked by string and one `sh` run with stand-ins, never by an operator on the runner Mac.

## Stopped at round 8 (Splinter's rule: 8 rounds, no BLOCKER open)
Round 8's two wording WARNINGs (a failed sudo probe reads as "already done"; an empty retired file passed by hand is
named as a different agent) are on a follow-up card, not fixed here.
