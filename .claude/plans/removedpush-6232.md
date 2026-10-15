# removedpush-6232: a removed member's board learns it within the hour, not the day (#6232)

## Finished looks like
After an admin removes a member, that member's board shows enrolled:false and has lifted the company policy within a
stated bound while online: at most an hour (sooner when its agents or projects change).

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
ORG_REFRESH_MS goes from 24 hours to 1 hour. A board in no company still sends nothing (orgEnrollRefresh returns
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
server.orgenroll-5531.test.js #6232: the interval is at most an hour and at least 30 minutes, the timer uses it, and
a board in no company sends nothing with live execution armed. Measured: back to daily, and removing the no-company
guard, each fail it. Comments that said "daily refresh" updated (server.js, orgenroll.js, orgrollup.js,
agentevents.js, CLAUDE.md).

## Not measured here
The real removal on a board (Kitty's #5622 harness) is not run in this change; the card's "observed on a real board"
is for the first run after merge.

## Review 1 (opus), and what changed
- My premise was wrong: the rollup goes out early only on a roster or project change, not for ordinary work, so the
  hourly refresh is the bound for almost every board. Comment, plan and weakest premise rewritten.
- Every "daily" that described this refresh (orgenroll.js 8 places, orgpolicy.js, server.js beside the timer) now
  says hourly; my first sweep matched one exact phrase only.
