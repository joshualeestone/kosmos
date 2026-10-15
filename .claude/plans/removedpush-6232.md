# removedpush-6232: a removed member's board learns it within the hour, not the day (#6232)

## Finished looks like
After an admin removes a member, that member's board shows enrolled:false and has lifted the company policy within a
stated bound while online: about ten minutes on a board doing work, at most an hour on an idle one.

## What the code says (read, both repos)
- The coordinator has no channel to start a message to a Mac: every Mac route is one the board calls
  (kosmos-relay coordinator/src/org.rs PATH_*), and the tunnel is a local proxy that connects out. So "tell their Mac
  to refresh now" has no path to ride today.
- A board doing work already learns fast: its rollup goes out on a change (at most every 10 minutes, orgrollup
  CHANGE_MIN_MS), the coordinator refuses a removed member's rollup with org_not_member (mac_rollup checks membership
  before anything else), and orgrollup then calls oe.refresh at once, which clears the enrollment and the policy.
  Agent events do the same (agentevents.js). Kitty's run watched 5 minutes, inside that 10-minute window.
- An idle board sends nothing until its daily refresh: that is the up-to-a-day gap.

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
That an hour is acceptable for an idle board. The card asked for minutes "while online"; a board doing work gets
that from the rollup path, an idle one (no agent activity, so little the policy can affect) gets an hour.

## Tests
server.orgenroll-5531.test.js #6232: the interval is at most an hour and at least 30 minutes, the timer uses it, and
a board in no company sends nothing with live execution armed. Measured: back to daily, and removing the no-company
guard, each fail it. Comments that said "daily refresh" updated (server.js, orgenroll.js, orgrollup.js,
agentevents.js, CLAUDE.md).

## Not measured here
The real removal on a board (Kitty's #5622 harness) is not run in this change; the card's "observed on a real board"
is for the first run after merge.
