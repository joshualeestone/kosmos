# #5732: a post from your OWN other computer tells the project's agents to read the room

**Ask:** Splinter, 2026-10-09 18:48. Build it on a branch, off by default, and do not merge it. He puts it to Josh as a
one-line yes/no during the "Kosmos as main comms" pilot (Josh-Brain/Projects/kosmos-as-primary-comms-plan-2026-10-09.md).

## Why
A shared-room post is recorded as an `external` row and nothing else happens (engine/fedseats.js header, Josh's #3311
guardrail: "a message from outside can never arrive as an instruction"). So in the pilot, Josh's post from his own
computer tells no agent on the agents Mac. For tomorrow, Splinter checks the room on a timer.

## What changes
- **engine/fedseats.js:** a message event's relay stamp `same_account: true` (kosmos#4657) is passed to
  `recordExternal` as `sameAccount: true`.
  - That stamp is set by the relay from the two members' verified room tickets, and sits BESIDE `data`, so a sender
    cannot write it.
  - A `same_account` inside `data`, or one that is not exactly `true`, is not passed.
  - The stored row is unchanged, because `externalPost` keeps only its named fields.
- **server.js:** the `recordExternal` wrapper stores the post as before, then calls `messages.nudgeOwnComputerPost`.
  It does so only when the stamp is set and `KOSMOS_OWN_ROOM_NUDGE=1`. It never throws into the seat's data handler.
- **engine/messages.js:** `nudgeOwnComputerPost(projectId, projectName, postId, members, roster, now)`.
  - It types ONE line into each member agent's pane through `chat.deliverAutomatic`, the #185 nudge's path:
    `[a new post from your other computer is in the room <name>; read it with: kosmos room <id>]`.
  - The line carries NO post text. The words still arrive only when the agent reads the room, marked external.
  - Removed agents get nothing, and an unreadable removed list tells nobody (`_roomMembers`, the post gate's
    fail-closed rule).
  - At most one line per agent per room every 2 minutes (`OWN_POST_NUDGE_GAP_MS`).
  - Only an addressable roster card is typed into.
  - A quota-held agent is skipped without spending its gap.
  - Each line is recorded as a `nudge` row (`reason: 'own-computer'`, `post`: the external row's id). The #185 sweep's
    at-most-once check matches only operator post ids (`m...`), so an `x-` id cannot collide with it.

## Decisions
- **Off by default, by an environment variable** rather than a setting on a screen. Splinter asked for off, and Josh's
  yes/no is pending. A screen switch would be built only after a yes.
- **No post text in the nudge.** That is how it stays inside the substance of #3311 even for an own post.
- **The weakest premise:** that the relay sets `same_account` only when the poster really is this account. That is the
  relay's job (crates/relay/src/federation.rs `same_account`, from verified tickets), not re-checked here.
- **Not done:** an own post from another computer that was then removed from the project. The relay stops delivering
  from it, and that is not re-checked here either.

## Tests
- **engine/fedseats.test.js `#5732`:** the stamp is passed; one a sender wrote inside data is not; a non-`true` stamp
  is not.
- **engine/messages.test.js `#5732`:** one line per member with no post text, recorded as a nudge; a burst is one line
  per agent until the gap; a non-member is never typed into; the server wiring is gated on the stamp and the switch.
- **Red by mutation**, each on valid code (an earlier attempt broke the syntax and was redone):
  - the post's words in the line
  - the gap removed
  - the pass-through removed
  - the switch removed
- **engine.reachable.test.js:** `_resetOwnPostNudgesForTests` is excused as a test seam.

## Validation
- engine guards plus both touched files: 512 tests, 1 failure (the export guard), fixed by the excuse. engine.reachable
  then passes 7/7.
- The 75 files that read server.js: the same 6 failures as on main's base (unrelated files), none new.
- No full suite or challenge loop yet. Both are for after a yes, before a PR.
