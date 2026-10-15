# removedpush-6232: a removed member's board learns it within the hour, not the day (#6232)

## Finished looks like
After an admin removes a member, that member's board shows enrolled:false and has lifted the company policy within a
stated bound while online: an hour on the clock plus the five-minute check after an answered ask; each ask without an
answer is retried after 15 minutes, then 30, then the hour (sooner when its agents or projects change).
Not covered: an unreachable coordinator (nothing changes) and a board before live execution is allowed (nothing sent).

## What the code says (read, both repos)
- The coordinator has no channel to start a message to a Mac: every Mac route is one the board calls
  (kosmos-relay coordinator/src/org.rs PATH_*), and the tunnel is a local proxy that connects out. So "tell their Mac
  to refresh now" has no path to ride today.
- A rollup refused with org_not_member (mac_rollup checks membership first) makes orgrollup refresh at once, and agent
  events do the same. But a rollup goes out early only when its signature changes (agent names, project membership,
  policy version; orgrollup signature()), at most every 10 minutes; ordinary work on an unchanged roster sends
  daily. Agent events send only refusals or manipulation flags. So for almost every board the org refresh is the
  bound (review 1 corrected my first reading, which said any working board learned in ten minutes).

## The call
ORG_REFRESH_MS goes from 24 hours to 1 hour, measured on the clock: a check every five minutes (orgRefreshIfDue) asks
when an hour has passed since the last ask, or when the clock went back (review 3: a Mac's timers stop while it
sleeps, so a one-hour timer let a laptop asleep past the hour wait up to another hour after waking). A board in no
company still sends nothing (orgEnrollRefresh returns
before asking), so only enrolled boards (and a pending Leave or unknown join) make the extra calls.

## Rejected
- A push from the coordinator: needs a new coordinator-to-Mac channel in kosmos-relay; far larger than the gap.
- Ten-minute polling: the status answer carries the signed company policy (up to about 22 KB, signed fresh each
  call) and the coordinator asks to be polled "on the order of hours" (org.rs POLICY_TTL_SECS comment). An hour is
  24 answers a day per enrolled board.
- A cheaper status route without the policy: a coordinator change; worth a follow-up if a minutes bound is wanted
  for idle boards too.

## Weakest premise
That an hour is acceptable. The card asked for minutes "while online"; this gives an hour for almost every board
(sooner when its roster changes). Minutes for every board need a cheaper coordinator status route (no policy bundle)
or a push channel, both kosmos-relay changes: a follow-up if a company asks for it.

## Tests
server.orgenroll-5531.test.js, each measured to fail on the change it guards:
- #6232: the interval is at most an hour and at least 30 minutes; the check is a five-minute clock check, not a
  one-hour timer; a board in no company sends nothing.
- review 3: an answered ask waits the hour; a long sleep asks at the next check; a clock set back asks.
- review 4/5: a miss is retried after 15 minutes, a second miss after 30; an answered ask starts the misses over.
- review 5: an older ask ending late without an answer does not move the clock a newer, answered ask set.
- review 6: right after a miss, a clock set back by less than the retry wait still asks; each test starts the
  schedule over (_orgRefreshResetForTests).
- review 10 (replacing the review 7 to 9 tests): an enrollment ending tells onEnrollmentEnded once with that Kosmos's
  root, and not for a refresh or a Leave with nothing enrolled; the board's listener hands its own agents the change
  and ignores another Kosmos's ending; start() registers it.
Comments that called this refresh "daily" now say hourly (server.js, orgenroll.js, orgpolicy.js, orgrollup.js,
agentevents.js, two test files, CLAUDE.md).

## Not measured here
The real removal on a board (Kitty's #5622 harness) is not run in this change; the card's "observed on a real board"
is for the first run after merge.

## Review 1 (opus), and what changed
- My premise was wrong: the rollup goes out early only on a roster or project change, not for ordinary work, so the
  hourly refresh is the bound for almost every board. Comment, plan and weakest premise rewritten.
- Every "daily" that described this refresh (orgenroll.js 8 places, orgpolicy.js, server.js beside the timer) now
  says hourly; my first sweep matched one exact phrase only.

## Review 2 (sonnet), and what changed
- Four more places called this refresh daily (server.js beside the join, a test header, a test title, a test
  comment); a repo-wide search for every wording of it now finds none. The rollup's own "daily" sends are a different
  thing and stay. The server comment names the policy version among what sends a rollup early.

## Review 3 (opus), and what changed
- The hour was an hour of awake time (Node's timers stop while a Mac sleeps). Now a five-minute check asks when an
  hour has passed on the clock, or the clock went back. Tested: before the hour no ask, after a long sleep an ask, a
  clock set back an ask; removing the clock-back rule, asking every check, or the old one-hour timer each fail it.
- The unknown-join comment and test title say "not only hourly"; long comment lines re-wrapped; the comment names what
  the hour does not cover (an unreachable coordinator, a board before live execution).

## Review 4 (sonnet), and what changed
- A failed ask (no answer, an unclear one, a refused leave) reset the hour, so one missed ask could leave a removed
  member's policy for about two hours. Now an ask without a clear answer is asked again after ORG_REFRESH_RETRY_MS
  (15 minutes), not every five-minute check (a refused leave would be resent twelve times an hour). Tested; removing
  the retry fails it (measured).
- The unknown-join comment says each of its asks restarts the hourly clock; plan lines re-wrapped.

## Review 5 (opus), and what changed
- Retries without end: a state that never clears asked every 15 minutes (96 policy-carrying answers a day). Now the
  wait doubles with each miss in a row (15, 30, then the hour) and an answered ask starts it over.
- The bound in the plan and the comment includes the retries.
- Tested: doubling, the reset, and the overlap guard (each fails its mutation; the guard test first hung on the
  mutation instead of failing, fixed so any third ask answers at once). The review 3 test now awaits answered asks.

## Review 6 (sonnet), and what changed
- One stored time did two jobs (last ask, and due time moved earlier by a retry), so after a miss a clock set back by
  less than the wait was not seen. Now two values: ORG_ASKED_AT and ORG_NEXT_AT; due when now passes the due time or
  is before the last ask. Only the latest ask moves either (an older one answering late no longer resets the misses).
- Tests start the schedule over. The clock-back test is aimed after the first miss (a 15-minute wait): placed after
  the third miss it passed the old one-value logic too, because the wait there is the full hour (measured).

## Review 7 (opus), and what changed
- Older than this change, but inside the card's "has lifted the policy": a removal caught by a refused rollup or agent
  event clears the policy file (they call oe.refresh themselves), but nothing told the agents, and every later ask
  returns before companyPolicySync because nothing is enrolled; the agents kept the company's AI policy text until a
  restart. The five-minute check now runs companyPolicySync while the agents hold a company text (one small read when
  nothing changed), so they are told within five minutes. Tested by behaviour: dropping the call, or running it
  without the guard (a warning on every check for a board with no company text), each fail it (measured).
- Wording: the "sooner" sentence names agent events too; "in flight" wording; `now` is comparison-only.

## Review 8 (sonnet), and what changed
- The check re-ran the whole sync (a roster pass and a warning) every five minutes while an agent could not be told,
  where the comment said that retry stayed with the ask. Now each change is handed once from the check, and tried
  again only hourly while an agent stays untold; this also holds the "could not hand" courtesy lines to hourly.
  Tested; removing the limit fails it (measured).

## Review 9 (opus), and what changed
- The check looked only for a recorded text, so the boot's retry mark (some agent could not be told at start) skipped
  it, and a removal caught elsewhere left the healthy agents on the old text. It now runs while any company text or
  the retry mark is held (a board in no company records null and stays out).
- Every hand-over (the hourly ask's too) is recorded in companyPolicySync, so a stuck agent is retried once an hour,
  not by both paths. Both tested; each mutation fails (measured).
- Not changed: the "longer than the limit" courtesy line can print with each hourly ask on an enrolled board whose
  policy text is too long (24 a day at most). Bounded; printing once per policy version is a possible follow-up.
- This part (the agents' copy of the policy text) drew findings in reviews 7, 8 and 9; each was a real gap in a state
  the previous fix did not cover. The state is now: hand-over on change, recorded in one place, hourly retry.

## Review 10 (sonnet), and what changed: the review 7 to 9 approach was REMOVED
- Reviews 7, 8, 9 and 10 each found a real gap in re-handing the agents their policy text from the five-minute check
  (a no-company board, stuck agents retried every check, the boot's retry mark, retries doubled, a no-company board
  in the retry mark syncing hourly). A rule that draws a finding every round is the wrong rule, so it is gone: no sync
  from the check, no COMPANY_CHECK_* state, no boot-retry test hook.
- Instead the event that matters is told: engine/orgenroll.js clearEnrollment (which every end of an enrollment passes
  through, #5534) calls onEnrollmentEnded listeners with the root when a record was there; the board registers one at
  start that runs companyPolicySync for its own root. So a removal caught by a refused rollup or agent event reaches
  the agents at that moment, and nothing runs while no enrollment ends. companyPolicySync itself is unchanged (its
  retry for an agent that could not be told stays as it was: the next ask that reaches it, or a restart).
- Which ask is the latest is a counter, not a millisecond time (two asks in one millisecond are still two).
- Measured: never telling, telling with nothing enrolled, ignoring the root, and ignoring the counter each fail.

## Review 11 (opus), and what changed
- The ending was told from clearEnrollment, which a Leave also calls BEFORE the company answers; a Leave refused as
  the last admin then rewrote every agent's policy twice (cleared, then back). Now only a refresh's final endings tell
  listeners (the company's clear answer, or no id of its own); the Leave route already hands its outcome over.
- An ask that ended the enrollment no longer hands the policy over a second time after the listener did.
- Stated, older than this: an agent that cannot be told when the enrollment ends keeps the old text until a restart
  (a board in no company asks nothing more that would retry it); the companyPolicySync comment says so.
- Tests: a refused Leave tells no listener; a throwing listener does not stop an ending; no double hand-over. Each
  fails its mutation (measured). CLAUDE.md names the new pieces.
