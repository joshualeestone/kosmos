---
pre_challenge: true
method: challenge-loop
branch: sandbox-4636
diff_hash: bb9874fbe778f6ddd8c28b996fd160d43b80818069bb7b6aa622418988fbb0f5
validation: light run on Mortals (cli.sandbox-4636.test.js: 29 passed; tools/test-board-watchdog-2955.sh: 0 failures; bash -n clean)
subdir_audit: clean
timestamp: 2026-10-02T21:43:23Z
iterations: 26
converged: true
---

## [CHALLENGE-LOOP] Summary

Run BY HAND (this account has no pre-challenge-gate hook). Blind reviewer subagents, Opus and Sonnet alternating, one per iteration.
Iterations 1-22 were rebuilt on 2026-09-30 from the 22 subagent records on disk (session 450cf1de, subagents/) and the 21 fix commits, not from memory. Iterations 23-26 are from this session's reviewer reports (session e1bf434a), fixed in commit 9907e8f0a.
Counts are the bracket tags as each reviewer wrote them.

**Iterations:** 26 (converged at 22; reopened for NEW code after Sonya's m3799 stricter-sandbox finding; re-converged at 26)
**Converged:** Yes: zero findings needing a change at iteration 26.
**Total tagged:** 1 BLOCKER, 70 WARNINGs, 5 CONVENTIONs, 105 NITs.
**Fixed:** the BLOCKER (iteration 5) and every finding judged real, commit per iteration | **Written down:** the plan's Decided and Weakest part | **Deferred:** #4651, #4655 | **Asked:** 0

#### Iteration 1
**Reviewer model:** opus (started 2026-09-29T20:19Z; record agent-a04264b00de594cab.jsonl)
- Tagged: 0 BLOCKER, 5 WARNING, 1 CONVENTION, 8 NIT
- --> FIXED in the iteration-1 commit: honest listener, loud watchdog start, restart guard

#### Iteration 2
**Reviewer model:** sonnet (started 2026-09-29T20:27Z; record agent-a497ef8fd34f56994.jsonl)
- Tagged: 0 BLOCKER, 3 WARNING, 1 CONVENTION, 3 NIT
- --> FIXED in the iteration-2 commit: Kosmos only for the recorded pid; re-probe once

#### Iteration 3
**Reviewer model:** opus (started 2026-09-29T20:31Z; record agent-a2b350924c5511d38.jsonl)
- Tagged: 0 BLOCKER, 3 WARNING, 0 CONVENTION, 6 NIT
- --> FIXED in the iteration-3 commit: a blocked shell's start of a stopped board ends honestly

#### Iteration 4
**Reviewer model:** sonnet (started 2026-09-29T20:37Z; record agent-ae78eab7dec38974a.jsonl)
- Tagged: 0 BLOCKER, 4 WARNING, 0 CONVENTION, 4 NIT
- --> FIXED in the iteration-4 commit: the supervised start, the re-probe tested

#### Iteration 5
**Reviewer model:** opus (started 2026-09-29T20:43Z; record agent-af0291eddc8ba4cae.jsonl)
- Tagged: 1 BLOCKER, 3 WARNING, 0 CONVENTION, 6 NIT
- --> FIXED in the iteration-5 commit: never leave a board launched from a blocked shell

#### Iteration 6
**Reviewer model:** sonnet (started 2026-09-29T20:49Z; record agent-a725bcef5e3b7898e.jsonl)
- Tagged: 0 BLOCKER, 5 WARNING, 0 CONVENTION, 4 NIT
- --> FIXED in the iteration-6 commit: stop the launched board for sure; keep a person's stop

#### Iteration 7
**Reviewer model:** opus (started 2026-09-29T20:52Z; record agent-a54e75b73eb492f4e.jsonl)
- Tagged: 0 BLOCKER, 3 WARNING, 1 CONVENTION, 6 NIT
- --> FIXED in the iteration-7 commit: stop's words, lsof bounded, a wedged board measured

#### Iteration 8
**Reviewer model:** sonnet (started 2026-09-29T21:00Z; record agent-ae8725ff350a8ab42.jsonl)
- Tagged: 0 BLOCKER, 4 WARNING, 1 CONVENTION, 3 NIT
- --> FIXED in the iteration-8 commit: restart's marker, two readings, a queue that is full

#### Iteration 9
**Reviewer model:** opus (started 2026-09-29T21:05Z; record agent-a1a6b3a2c63d60c2f.jsonl)
- Tagged: 0 BLOCKER, 4 WARNING, 0 CONVENTION, 5 NIT
- --> FIXED in the iteration-9 commit: stop a launched board only on evidence of a sandbox

#### Iteration 10
**Reviewer model:** sonnet (started 2026-09-29T21:11Z; record agent-ab68c6a7309f75252.jsonl)
- Tagged: 0 BLOCKER, 3 WARNING, 0 CONVENTION, 4 NIT
- --> FIXED in the iteration-10 commit: launchd wait, restart only refused in a sandbox

#### Iteration 11
**Reviewer model:** opus (started 2026-09-29T21:15Z; record agent-a6dcdb08a03a83e23.jsonl)
- Tagged: 0 BLOCKER, 3 WARNING, 0 CONVENTION, 8 NIT
- --> FIXED in the iteration-11 commit: test the kill-or-keep decision; the detector's reason

#### Iteration 12
**Reviewer model:** sonnet (started 2026-09-29T21:22Z; record agent-a484f6d49c9cfcfd3.jsonl)
- Tagged: 0 BLOCKER, 2 WARNING, 0 CONVENTION, 3 NIT
- --> FIXED in the iteration-12 commit: real pauses in the kill arm; a sandbox that runs

#### Iteration 13
**Reviewer model:** opus (started 2026-09-29T21:26Z; record agent-aebf8b1fe90ad5537.jsonl)
- Tagged: 0 BLOCKER, 2 WARNING, 0 CONVENTION, 8 NIT
- --> FIXED in the iteration-13 commit: lsof cost measured; pidfile only if still ours

#### Iteration 14
**Reviewer model:** sonnet (started 2026-09-29T21:34Z; record agent-afb6370462e733ae1.jsonl)
- Tagged: 0 BLOCKER, 4 WARNING, 0 CONVENTION, 3 NIT
- --> FIXED in the iteration-14 commit: ps denied twice; launchd words; a queue that will not fill

#### Iteration 15
**Reviewer model:** opus (started 2026-09-29T21:39Z; record agent-a300bd55302486978.jsonl)
- Tagged: 0 BLOCKER, 2 WARNING, 0 CONVENTION, 4 NIT
- --> FIXED in the iteration-15 commit: an unconfirmed launchd start is no success for the watchdog

#### Iteration 16
**Reviewer model:** sonnet (started 2026-09-29T21:48Z; record agent-a7052e54b3e7e2d59.jsonl)
- Tagged: 0 BLOCKER, 5 WARNING, 1 CONVENTION, 3 NIT
- --> FIXED in the iteration-16 commit: gone means gone from lsof too; a local re-probe flag

#### Iteration 17
**Reviewer model:** opus (started 2026-09-29T21:51Z; record agent-af25ec4ab31485347.jsonl)
- Tagged: 0 BLOCKER, 1 WARNING, 0 CONVENTION, 6 NIT
- --> FIXED in the iteration-17 commit: the stuck-stop branch tested; state that never lingers

#### Iteration 18
**Reviewer model:** sonnet (started 2026-09-29T21:59Z; record agent-ad24fee29ed728376.jsonl)
- Tagged: 0 BLOCKER, 3 WARNING, 0 CONVENTION, 4 NIT
- --> FIXED in the iteration-18 commit: no launchd success for a reclaim start, ours or not

#### Iteration 19
**Reviewer model:** opus (started 2026-09-29T22:03Z; record agent-a9da7bf15a3a80100.jsonl)
- Tagged: 0 BLOCKER, 3 WARNING, 0 CONVENTION, 5 NIT
- --> FIXED in the iteration-19 commit: a fresh reading before the kill; ours checked by ps where it runs

#### Iteration 20
**Reviewer model:** sonnet (started 2026-09-29T22:13Z; record agent-a2d7256ab8b895713.jsonl)
- Tagged: 0 BLOCKER, 3 WARNING, 0 CONVENTION, 3 NIT
- --> FIXED in the iteration-20 commit: no refusal advises starting or restarting

#### Iteration 21
**Reviewer model:** opus (started 2026-09-29T22:17Z; record agent-af018179f4ca5aab9.jsonl)
- Tagged: 0 BLOCKER, 2 WARNING, 0 CONVENTION, 6 NIT
- --> FIXED in the iteration-21 commit: an unconfirmed launchd start fails; the other sandbox named

#### Iteration 22
**Reviewer model:** sonnet (started 2026-09-29T22:25Z; record agent-a0a1f197fed440646.jsonl)
- Tagged: 0 BLOCKER, 3 WARNING, 0 CONVENTION, 3 NIT
- Zero NEW findings after dedup. CONVERGED (first time). Its 3 WARNINGs: setup.sh pause check (pre-existing, card #4651, in the plan); board-run's silent KeepAlive relaunch under a persistent fault (accepted, in the plan); the exit-5/watchdog contract test is source-regex only (accepted: behaviour covered by watchdog arm 6u; recorded here, not in the plan).

#### Reopened: new code (Sonya m3799: a seatbelt that also denies process-info kills curl (exit 133) and refuses lsof; status said "another app")

#### Iteration 23
**Reviewer model:** opus
- [WARNING] the lsof-refused route had no arm that could fail (STRICT kills curl first) --> FIXED (LISTPIDS profile arm, `deny process-info-listpids`: curl 7, lsof refused; LSOFLESS control red)
- [WARNING] stop in a "cannot check" shell said "not started by this command" --> FIXED (the "cannot be stopped from here" words; asserted)
- [CONVENTION] stale exit-5 contract comments (install/kosmos header, watchdog) --> FIXED
- [NIT] x2: leftover python names --> FIXED; a signalled SECOND (page) curl --> see iteration 24

#### Iteration 24
**Reviewer model:** sonnet
- [WARNING] the page-fetch "cannot check" hook had no arm (it runs only after the health curl connected) --> FIXED by REMOVING it: a shell that just connected is not blind
- [NIT] x3: no STRICT arm for restart/open --> FIXED (arm added); `_await_board_up` with a pid-less reading --> FIXED (comment: never a kill, ends in "did not come up"); comment wrap --> FIXED

#### Iteration 25
**Reviewer model:** opus (9 mutations on a scratch copy)
- [WARNING] the lsof route's `_shell_is_sandboxed` guard was untested (mutation M1 stayed green) --> FIXED (stub arm both ways; red on M1, checked)
- [NIT] the per-probe `_UNREACH_BLIND` reset untested (M6) --> FIXED (arm; red on M6, checked)
- [NIT] "Operation not permitted" match is broad --> KEPT, written down: it needs ps denied too and errs toward "cannot check"
- [NIT] "cannot check" words claimed both blocks on the curl route --> FIXED ("or", not "and")

#### Iteration 26
**Reviewer model:** sonnet (10 mutations, all red)
- Zero findings needing a change. CONVERGED. One cosmetic NIT (watchdog log words for a blind reading, unreachable under launchd) left as is.
