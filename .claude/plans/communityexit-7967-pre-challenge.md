---
pre_challenge: true
method: challenge-loop
branch: communityexit-7967
diff_hash: 469f92f6432d9082e46314defabf50b46264875e5e3535190785673a3f43b24d
validation: passed
subdir_audit: passed
timestamp: 2026-11-04T22:10:53Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No: stopped at the 8-round cap (Splinter's 10-22 usage rule: past 8 only for a BLOCKER, leftovers to a
follow-up card). Rounds 6, 7 and 8 raised no BLOCKER; round 7 raised nits only. Round 8's two WARNINGs went to #7980 (one
repeats the documented weakest premise).
**Total findings:** 22 actionable (6 BLOCKERs, 15 WARNINGs, 1 CONVENTION), about 20 NITs
**Fixed:** 18 | **Deferred:** 2 | **To follow-up #7980:** 2 | **Asked (awaiting user):** 0

Baseline (6.0): the full suite passed on the first commit (27053 tests, 0 fail). Closing gate (6j): the first run failed
one guard, cli.exit-code-mapping-3628 (two new spawn calls lacked its exit-code check marker); fixed with the guard's own
marker (7591fdac82, comments only); the rerun passed, 27063 tests, 0 fail.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty)
- [BLOCKER] install/kosmos:4366 - exit 1 suffix "nothing was done" false after a cut post (duplicate public post risk) --> FIXED (050df53eba)
- [WARNING] install/kosmos:4364 - exit 3 suffix pointed at community status, which cannot answer for votes --> FIXED (050df53eba)
- [WARNING] install/kosmos:4358 - `( ) || rc` turned errexit off for every subcommand --> FIXED (050df53eba)
- [WARNING] install/kosmos:4357 - temp file left on an interrupt --> FIXED (050df53eba)
- [WARNING] plan:16 - plan asserted "nothing was done" --> FIXED (050df53eba)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 2 of the above (the wrapper placement and the signal test, written by 050df53eba)
- [WARNING] install/kosmos:4337 - wrapper landed between cmd_community's doc comment and the function --> FIXED (b0b74f4da6)
- [WARNING] install/kosmos:4357 - only INT tested --> FIXED (b0b74f4da6)
- [WARNING] install/kosmos:4435 - the first line said is the reason (weakest premise) --> DEFERRED: every failure path traced says its reason first; stated in plan and PR

#### Iteration 3
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 4 of the above (traps and tests from 050df53eba and b0b74f4da6)
- [BLOCKER] install/kosmos:4361 - a trap made a TERM to the CLI wait for the whole request (57 s, measured) --> FIXED (5bf66d34ac)
- [WARNING] install/kosmos:4355 - the trap's line contradicted a finished result --> FIXED (5bf66d34ac)
- [WARNING] test:135 - signal tests never checked promptness --> FIXED (5bf66d34ac)
- [WARNING] install/kosmos:4351 - comment and plan claimed a prompt stop --> FIXED (5bf66d34ac)
- [WARNING] install/kosmos:4374 - exit 2 suffix overclaimed for _read_piped_message --> FIXED (5bf66d34ac)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] install/kosmos:4374 - a TERM killed the outer shell but left the subshell able to post --> FIXED (575223bb4f)
- [WARNING] install/kosmos:4367 - "stopped without saying why" after a die --> FIXED later (4fbd661016: die records its line)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 2 BLOCKERs, 1 WARNING, 1 CONVENTION, 2 NITs
**Self-generated:** 4 of the above (the background job of 575223bb4f)
- [BLOCKER] install/kosmos:4371 - a background job cannot take Ctrl-C on bash 3.2; curl and its token file outlived the command --> FIXED (ca7fbeda3a: no subshell at all; an exit function)
- [BLOCKER] test:160 - the Ctrl-C test could not fail on that --> FIXED (ca7fbeda3a: hanging-request group-empty test; fails on 575223bb4f's code, passes on main)
- [WARNING] install/kosmos:4359 - KILL and QUIT left the subcommand running --> FIXED (ca7fbeda3a)
- [CONVENTION] install/kosmos:4356 - false comment about resetting INT --> FIXED (ca7fbeda3a)
- found while fixing: --help re-dispatch wrote a failure line in every design --> FIXED (ca7fbeda3a)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] install/kosmos:4366 - a failed stderr write under set -e turned exit 3 into 1 --> FIXED (4fbd661016, test with stderr closed)
- [WARNING] install/kosmos:437 - first line said (premise again) --> DEFERRED (duplicate of iteration 2)
- [WARNING] install/kosmos:4372 - die recorded nothing --> FIXED (4fbd661016)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 2 of the above
- [NIT] exit 1 and 3 suffixes promised more than every line says --> fixed (e887bf1426)
- [NIT] plan said 5 s, tests allow 10 s; closed stdout; Windows stderr difference --> fixed in the plan (e887bf1426)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] install/kosmos:4376 - first line said (premise) --> DEFERRED (duplicate of iteration 2), and on #7980
- [WARNING] install/kosmos:5636 - KOSMOS_HELP_REDISPATCH inherited by the help child's children and by a user's environment --> FOLLOW-UP #7980 (cap)
- [NIT] no test pins the BASH_SUBSHELL guard --> FOLLOW-UP #7980

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | install/kosmos:4366 | BRANCH | "nothing was done" after a maybe | FIXED | 050df53eba |
| 2 | 1 | WARNING | install/kosmos:4364 | BRANCH | exit 3 advice wrong for votes | FIXED | 050df53eba |
| 3 | 1 | WARNING | install/kosmos:4358 | BRANCH | errexit off under `||` | FIXED | 050df53eba |
| 4 | 1 | WARNING | install/kosmos:4357 | BRANCH | temp file left on interrupt | FIXED | 050df53eba |
| 5 | 1 | WARNING | plan:16 | BRANCH | plan premise wrong | FIXED | 050df53eba |
| 6 | 2 | WARNING | install/kosmos:4337 | SELF | doc comment displaced | FIXED | b0b74f4da6 |
| 7 | 2 | WARNING | install/kosmos:4357 | SELF | only INT tested | FIXED | b0b74f4da6 |
| 8 | 2 | WARNING | install/kosmos:4435 | BRANCH | first line is the reason | DEFERRED | documented premise |
| 9 | 3 | BLOCKER | install/kosmos:4361 | SELF | TERM waits for request | FIXED | 5bf66d34ac |
| 10 | 3 | WARNING | install/kosmos:4355 | SELF | trap line contradicts result | FIXED | 5bf66d34ac |
| 11 | 3 | WARNING | test:135 | SELF | no promptness check | FIXED | 5bf66d34ac |
| 12 | 3 | WARNING | install/kosmos:4351 | SELF | comment claimed prompt stop | FIXED | 5bf66d34ac |
| 13 | 3 | WARNING | install/kosmos:4374 | BRANCH | exit 2 overclaim | FIXED | 5bf66d34ac |
| 14 | 4 | WARNING | install/kosmos:4374 | SELF | killed command still posts | FIXED | 575223bb4f |
| 15 | 4 | WARNING | install/kosmos:4367 | BRANCH | die gets "without saying why" | FIXED | 4fbd661016 |
| 16 | 5 | BLOCKER | install/kosmos:4371 | SELF | Ctrl-C cannot reach the job | FIXED | ca7fbeda3a |
| 17 | 5 | BLOCKER | test:160 | SELF | Ctrl-C test cannot fail | FIXED | ca7fbeda3a |
| 18 | 5 | WARNING | install/kosmos:4359 | SELF | KILL/QUIT leave it running | FIXED | ca7fbeda3a |
| 19 | 5 | CONVENTION | install/kosmos:4356 | SELF | false INT comment | FIXED | ca7fbeda3a |
| 20 | 6 | WARNING | install/kosmos:4366 | SELF | closed stderr changes exit code | FIXED | 4fbd661016 |
| 21 | 8 | WARNING | install/kosmos:5636 | SELF | help variable inherited | FOLLOW-UP | #7980 |
| 22 | 6j | BLOCKER | final-validation: yarn test | BRANCH | #3628 guard: spawn marker missing | FIXED | 7591fdac82 |

### NITs (non-blocking, across all iterations)
- `kosmos community bogus` repeats post's usage line (iterations 1, 5; also stdout's behaviour)
- the line repeats on a terminal that joins stdout and stderr (iteration 1; stated in the code comment)
- POSIX mode keeps the builtin exit (iterations 6, 8; stated in the code comment)
- no BASH_SUBSHELL guard test (iteration 8; #7980)

### Strengths (across all iterations)
- One wrapper, stdout byte-for-byte unchanged, cmd_community keeps its name for the Windows parity guard (all)
- The final shape adds no subshell, background job or trap, so every signal behaves as on main; each signal is tested (iterations 5 to 8)
- Each guard was shown to fail with its fix removed, including a test run against round 4's code (iterations 1 to 6)
