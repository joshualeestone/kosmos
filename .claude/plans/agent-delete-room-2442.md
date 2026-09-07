# agent-delete-room-2442: a deleted agent must lose its project-room access

Josh, 2026-09-07: "apparently if you delete an agent, he still has access to a project room."
Security-adjacent, pre-launch (routed by Splinter). Removal-lifecycle lane.

## Root cause (traced on origin/main)
`remove.js` (agent delete) is a SOFT removal: it kills the tmux session, disables the launchd
job, files a record in `removed.json`, and (per #2323) revokes the agent's sender token. It does
NOT touch `project.agents` (the per-project membership record), and the room-post path
(`messages.js` sendPost / react) does NOT filter removed agents from the `members` it gates on.
So a removed agent stayed a room PARTICIPANT: `members.includes(from)` still admitted it as a
sender, and `members` still listed it as a recipient.

## What was already handled (so the fix is scoped to the real residual)
- #2323 revokes the removed agent's sender token -> the SUCCESS-case sender path is closed at
  identity.
- `tellAgent`/`isNamedOurs` refuses typing into an agent with no live ours-pane -> a killed
  removed agent cannot be a live recipient.
- #166 already makes the board's project ROW show a removed agent as `present:false` (a
  member-of-record display), tested in server.projects.test.js.

## The residual this closes (a real security gap, not just cleanup)
1. #2323's token revoke is BEST-EFFORT and can fail (a throw / busy lock leaves the token alive).
   If it fails, the room-post membership gate (`members.includes(from)`) is the only thing left --
   and it PASSED, because the removed agent was still in `members`. A removed agent whose revoke
   failed could still POST to the room.
2. A PARTIAL removal (the session kill failed, agent still running) keeps a live ours-pane, so an
   operator room post would still be typed INTO it as a recipient.

## The fix (guard at the access boundary, not a delete-cascade, not the display)
`remove()` is restorable ("Nothing on disk is deleted, ever"): `restore()` re-admits the agent to
exactly the projects it was on because `project.agents` still lists it. Deleting membership on
remove would strand restore. So this filters removed agents from the room's EFFECTIVE membership
at read time.

`engine/messages.js`: a `_roomMembers(members)` helper drops removed agents (record kept), applied
in `sendPost` (right after the members-shape validation, so it gates BOTH the agent-sender check
and the recipient list) and in `react` (the agent-reactor membership gate). Both room-post routes
and the react route derive `members` from `describe()` and pass it to these two functions, so this
is the one place the room ACCESS decision is made. Details:
- FAIL CLOSED on an unreadable removed list, via `remove.removedNames()`. remove.js documents the
  split: `readRemoved()`/`isRemoved` fail OPEN (right for the board display), while `removedNames()`
  answers `{ok:false}` so "a caller that is about to ACT gets the failure ... and can refuse". A room
  post/react/nudge ACTS (admits a sender, types into a pane), so on `{ok:false}` the caller REFUSES
  ("we could not check which agents have been removed") rather than silently re-admitting every
  removed agent -- and it does NOT lean on #2323 (whose best-effort revoke this fix exists because it
  can fail) as the backstop. `removedNames()` on a MISSING file is `{ok:true, names:[]}` (ENOENT is
  the ordinary no-removals case), so fail-closed fires only on a genuinely unreadable/corrupt list, a
  rare, transient, self-healing window.
- The MATCH is `create.cleanName`, the same key `isRemoved` uses, on the same record's names, so the
  room can never disagree with the fleet's one removal check. `addAgent` stores a member name
  un-cleaned, so it is cleaned before the compare or the filter silently misses. Lazy requires are
  cycle-safe (remove/create do not require messages at load).

Also `sweepUnanswered` (the #185 room-nudge sweep, another pane-write path into agents): it
re-nudges agents named in a pre-removal operator post's `mentioned` array. A killed removed agent
is already skipped (no roster card), but a PARTIAL removal (still running) would be nudged, so the
same `isRemoved` skip is applied before the at-most-once card check. The nudge is inert (the post
it invites is refused by the membership gate now), but it is still room traffic into a cut agent.

## Why NOT filter in describe() (an approach tried and reverted)
Filtering in `describe()` also drops the removed agent from the board's project-row DISPLAY, which
broke the deliberate #166 contract (server.projects.test.js: a removed agent stays on the row as
`present:false`) and the member-fixture-shape test. "Access" is the ability to post/receive, not
the display listing -- so the guard belongs at the room-post/react access boundary, leaving the
`present:false` member-of-record display intact.

## Scope boundary (decided, documented)
- IN: the shared project ROOM -- posting and reacting (`sendPost`/`react`). The card's surface.
- OUT: the 1:1 operator<->agent THREAD (`/api/project/:id/thread/:agent`). The send is already
  gated on `isNamedOurs` (a killed removed agent has no ours-pane), and reaching a STILL-RUNNING
  removed agent there is the operator's own action (they may want to tell a not-yet-dead process
  to stop) -- not the removed agent's access. History reads (thread + room GET) deliberately keep
  a removed agent's PAST posts; history should not vanish.
- OUT, same rationale: the task-assignment pane write (`server.js` `heardBy`/`tellEveryoneOn`,
  #761/#327 -> `chat.deliver`). It is not a room-participation surface (it announces a task to a
  `who`), and like the 1:1 thread it is `isNamedOurs`-gated, so a fully-removed agent is
  unreachable; only a still-running partial removal is, matching the thread carve-out. So
  "sendPost + react + sweepUnanswered" is the complete set of ROOM-write paths, not of every
  pane-write path -- the others are covered by `isNamedOurs`.
- The board's `present:false` row display is left as #166 designed it. If Josh wants a removed
  agent to VANISH from the room's member list entirely (not just show present:false), that is a
  separate DISPLAY-contract change from #166 -- flagged for his call, since it overrides a
  deliberate prior decision about what the operator sees.

## Tests
- engine/messages.test.js `#2442`: a removed agent cannot POST (refused at the membership gate,
  nothing typed); an operator room post is not typed into a removed member (row.to excludes it);
  CONTROL: an unreadable removed list filters nobody (fail-open).
- engine/reactions-2255.test.js `#2442`: the same member, once removed, can no longer REACT
  (control: a live member can). All perturbation-verified (disabling `_roomMembers` reds them).

## Known minor edge (deferred, not fixed here)
When EVERY member of a project has been removed, an operator room post falls through to the existing
#172 refusal "nobody is on that project yet, so there is no room to post to." After filtering,
`recipients` is empty, so the operator sees a "no members yet" message when the accurate statement is
"the members have all been removed." Deferred: it is a rare edge (whole team removed), operator-facing
and harmless (the message still conveys the operative fact -- there is no agent to receive the post),
and an accurate new sentence is user-facing COPY, which is Mona's / Josh's lane rather than something
to invent inside a security fix. Flagged for a copy pass if wanted.

## Validation
Fast: `node --test engine/messages.test.js engine/reactions-2255.test.js engine/projects.test.js
server.projects.test.js`. Full suite via the box at merge time.
