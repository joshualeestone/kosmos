---
pre_challenge: true
method: challenge-loop
branch: cidaemon-7001
diff_hash: c9c469faf2f60c530b6ad54e9f39651bbdcc45e074dc967ea098d7f2347b211f
validation: targeted (daemon test 60/60, test-ci-runner-setup-4601 268/268, four test-source guards, shell-shard 24/24, all on 990d7c47d0); full node suite left to CI
subdir_audit: not run (the diff changes no subdirectory CLAUDE.md)
timestamp: 2026-11-03T21:10:18Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No. Stopped after iteration 8 under Splinter's standing review rule (2026-10-22, restated 2026-10-26
m510): "A review loop stops at 8 rounds unless a BLOCKER is still open. Past 8, WARNINGs go to a follow-up card, not
another round." Iteration 8 raised no BLOCKER; its WARNINGs go to a follow-up card.
**Total findings:** about 52 (9 BLOCKERs, 30 WARNINGs, 2 CONVENTIONs, the rest NITs)
**Fixed:** all BLOCKERs and every WARNING of iterations 1 to 7 | **Deferred:** listed per iteration | **Asked:** 0
**Open at the stop:** iteration 8's four WARNINGs and its NITs, to the follow-up card.

Each iteration's full list, what was fixed and what was not, is in `.claude/plans/cidaemon-7001.md` under "Challenge
round N". The short version follows.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 6 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 (first reviewer pass)
- [BLOCKER] tools/ci-runner-setup.sh build_daemon: the daemon plist was a cp of the job-writable LaunchAgent, loaded
  as root --> FIXED 13dc3dec12 (written whole from a template, compared exactly, root:wheel 0644)
- [BLOCKER] GroupName planned, never written --> FIXED 13dc3dec12
- [WARNING] x6 (retired name on the load-only path, restarting wording, signals and a pre-bootstrap re-check, sudo
  rollback text, post-bootstrap wait, the test's pgrep stand-in) --> FIXED 13dc3dec12
- [CONVENTION] plan said a dry run runs as anyone --> FIXED 13dc3dec12
- StandardOutPath/StandardErrorPath: dropped rather than path-checked (a later symlink beats a path check)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
- [WARNING] verify and keepalive did not know the daemon --> FIXED 978663c001
- [WARNING] the listener half of the late re-check had no arm --> FIXED 978663c001
- [WARNING] load-only late refusal said "put everything back" --> FIXED 978663c001
- [WARNING] a power cut between plist rename and agent move --> FIXED 978663c001 (agent moved first)
- [NIT] KOSMOS_CI_DAEMON_DIR honoured as root --> DEFERRED: sudo scrubs it unless the operator passes it on purpose

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 6 WARNINGs, 1 CONVENTION, 5 NITs
**Self-generated:** 1 (newest_retired, written in iteration 1's fix)
- [BLOCKER] a job-planted name beside the retired agent was printed into a sudo rollback line --> FIXED cf3aa37c01
  (retired agent in /var/db/kosmos-ci-retired, root:wheel 0700; only stamp-named regular files are named)
- [WARNING] root mv through a job-writable path; launchd scan of .retired-*; bootstrap-failure text; no arm for
  the ancestry check; the setup test read the host's LaunchDaemons; an untested refusal and a rollback-less exit
  --> FIXED cf3aa37c01
- [CONVENTION] header lists --> FIXED cf3aa37c01
- [NIT] no log file in a root-owned dir --> DEFERRED: whether launchd opens it as root is unmeasured

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 5 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 2
- [BLOCKER] tools/test-ci-runner-daemon-7001.sh: bare mktemp -d, refused by test-mktemp-template-4298 --> FIXED 459933e062
- [WARNING] agent-back hint into the job-writable dir; halfway-stopped state said "register"; CI-user dry run blind
  to the retired dir; header said nothing about where to run it; check-then-mv comment overstated --> FIXED 459933e062
- [CONVENTION] plan design drifted from the code --> FIXED 459933e062

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 2
- [BLOCKER] the agent-back branch would print a sudo mv of the daemon plist through a symlinked LaunchAgents
  --> FIXED 2b0edc5ef0 (agent_file_ok: no symlink on the path, a regular file, not the daemon plist by -ef)
- [BLOCKER] a pgrep failure just before the bootstrap said only "refused" while the plist was written and the agent
  parked --> FIXED 2b0edc5ef0
- [WARNING] root writing the agent back into the CI home; the race comment ignored relay jobs; supplementary admin
  --> FIXED 2b0edc5ef0 (put-backs written by the CI user via tee)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2
- [WARNING] verify's daemon branch could not fire as the owner and was untested --> FIXED 5f2da2eaee (daemon_set,
  a NOT-checked note, five arms in test-ci-runner-setup-4601)
- [WARNING] "never run from the CI home" was only a comment --> FIXED 5f2da2eaee (enforced for --apply)
- [WARNING] CI-user halfway message; a restarting daemon's Listener called foreign --> FIXED 5f2da2eaee
- [NIT] unquoted seam dirs; only admin and wheel refused --> DEFERRED (operator-set; the two root-equivalent groups)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 3
- [WARNING] contradictory put-back messages; a foreign Listener named before a loaded agent; test uids fixed at
  501/502; the script-owner check too loose --> FIXED 990d7c47d0
- [NIT] FIFO reads, false "replacing" note, agent-back hint race, comment overstatement --> FIXED 990d7c47d0
- [NIT] no arm for the ignored signals --> DEFERRED: a trap cannot be observed through these stand-ins without racing

#### Iteration 8 (whole branch)
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 1 CONVENTION (clean), 6 NITs
**Self-generated:** not classified (open, not acted on)
- [WARNING] the agent_file_ok re-check right before the mv has no arm of its own --> OPEN, follow-up card
- [WARNING] the printed agent-back command runs without pipefail in the operator's shell, so a failed copy can
  still remove the agent; newest_retired accepts an empty file --> OPEN, follow-up card
- [WARNING] runner_plist can still read a FIFO named by .service --> OPEN, follow-up card
- [WARNING] print-disabled as non-root unmeasured --> already measured: rc 0 as a non-root user on this Mac,
  2026-11-03 (plan, round 2); recorded on the follow-up card
- [NIT] four-digit modes, the script's parent dir, a no-pid message, stale LaunchAgent text in machine_settings and
  verify, the test's dependence on the checkout's file mode, the setup test's stat stand-in --> OPEN, follow-up card
- Disclosure: the round-8 prompt let the reviewer read the plan's design sections (nothing in it was marked
  settled). Splinter's rule 4 asks for no plan file in the last round.

### Final Ledger (by iteration; detail in the plan)

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | tools/ci-runner-setup.sh build_daemon | BRANCH | cp of the job-writable agent loaded as root | FIXED | 13dc3dec12 |
| 2 | 1 | BLOCKER | tools/ci-runner-setup.sh daemon_set | BRANCH | GroupName never written | FIXED | 13dc3dec12 |
| 3 | 3 | BLOCKER | tools/ci-runner-setup.sh newest_retired | SELF | planted name printed into sudo | FIXED | cf3aa37c01 |
| 4 | 4 | BLOCKER | tools/test-ci-runner-daemon-7001.sh:15 | SELF | bare mktemp -d | FIXED | 459933e062 |
| 5 | 5 | BLOCKER | tools/ci-runner-setup.sh agent-back | SELF | sudo mv through a symlink to the daemon plist | FIXED | 2b0edc5ef0 |
| 6 | 5 | BLOCKER | tools/ci-runner-setup.sh pre-bootstrap | SELF | pgrep failure, no recovery text | FIXED | 2b0edc5ef0 |
| 7 | 8 | WARNING | tools/test-ci-runner-daemon-7001.sh | BRANCH | re-check before mv untested | OPEN | follow-up card |
| 8 | 8 | WARNING | tools/ci-runner-setup.sh agent-back hint | BRANCH | no pipefail in the pasted copy | OPEN | follow-up card |
| 9 | 8 | WARNING | tools/ci-runner-setup.sh runner_plist | BRANCH | FIFO read via .service | OPEN | follow-up card |

### NITs (non-blocking, across all iterations)
- Listed per round in the plan; iteration 8's go to the follow-up card.

### Strengths (across all iterations)
- The daemon plist is written whole and compared to the stage's own XML after plutil normalises both, so a planted
  key of any type reads as not this stage's; there is no key list to drift (iterations 2 to 8).
- Agent parked in a root-only dir before the plist appears; every partial state has a re-run path; put-backs are
  written by the CI user (iterations 5 to 8).
- 60 arms with permanent decoys (the relay's Listener, a same-path other-uid Listener), uids derived from the
  runner, and every new guard perturbed red on a copy (iterations 1 to 8).
