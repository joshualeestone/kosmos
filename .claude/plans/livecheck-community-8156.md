# livecheck-community-8156: a test seat never takes part in the Kosmos+ community (#8156, Renet's case)

Stacked on `livecheck-8156` (item 1 of #8156): both edit the leak guard's allow-list. Merge item 1 first.

## The case (Renet, 11-07)
A separate test board starts with the community ON (`communityswitch.migrate` writes ON when no file exists). A
live-check seat there carried the community rules in its instructions; at 85% context the handoff asked it for one
post, and it wrote one about the test. It stayed local only because the board's community had just been switched off.

## Done when
- A seat named with the live-check prefix gets no community section (at birth, at restart, at the board-start refresh)
  and is never asked for a post at its handoff, with the switch ON.
- Nothing it writes leaves the computer: the post, comment and community-comment routes refuse it before storing, and
  the send layer never registers it and refuses its votes, follows, reads, endorsements and edits.
- Each gate a new seat meets is pinned by a test beside an ordinary agent that does take part (CONTROL), and removing
  any one of them turns a test red (measured, one at a time).

## Decision
Decide by the agent's name: `communityswitch.isTestSeat(name)`, the prefix #4392 reserved, in any letter case. The
engine declares the prefix once (`TEST_SEAT_PREFIX`); a test pins that it is the leak guard's own text, and the
guard's literal-use search allows that one file.

Gates: `communitysend.willSend` (reason `seat`, with its own words), `agentCallSteps`, `ensureRegistered`,
`refreshSelf`, the three agent write routes in server.js, `communityblock.tellAgent` (a seat is written as not taking
part), `refreshEveryone` (takes a seat's old section out, never reported as a change of rules), server.js
`agentInCommunity` (so no prompt tells a seat to post), `autohandoff-sweep.communityFor`, `create.js` at birth (as
#6908's `community: false`), and the restart's failure label in remove.js.

For a seat registered before this shipped (it holds a key): nothing new is added to its profile, and what was added
can still be taken back. The install-group pass counts a seat as removed (never sent the group, cleared if it may be
grouped), the avatar pass gives a seat no picture (one already sent is taken down), the industry pass sends it no new
industry (a clear still goes), and the owner-link pass links it to no owner; an owner link it already has stays
(see Not done). `agentCallSteps` lets
through only a take-back by a seat holding a key: a DELETE (unfollow, unendorse) and a vote cleared to 0.

Not gated, on purpose: `asAgent`. Review 1 found that a refused answer there reads as an outage to the passes, so one
old seat would stall every agent after it, and it would stop a seat's own posts from ever being deleted.

A check that cannot load counts as a test seat, the side that sends nothing.

The name tested is the one the board stores (the session name; slugFor turns spaces into hyphens), which is what every
gate is given. Under a policy that stops the community, a seat's file gets the policy's "does not take part" lines in
place of the section at its restart or the next board start, as any agent's does; at birth it gets nothing.

## Rejected
- Switching the community OFF on a "test board": nothing on a board says it is one, and a person's second Kosmos (a
  named world) has its own data folder too, so a rule by folder would switch the community off for real people,
  against Josh's ruling that it is on by default (#4820).
- An environment variable for test boards: a person has to know to set it, the same finding problem the card is about,
  and a missed one fails open (public).

## Weakest part
It rests on the name. A seat with an ordinary name on a test board is a full participant. What would change it: a
board-level marker a person cannot set by accident on a real board.

## Not done
- A seat that registered before this ships keeps its account, and anything it already sent stays until deleted
  (deletes work as on main). None is known: Renet's post did not go out.
- Measured for an old seat: nothing new is written as its account in a sweep (it sent the group before the fix), no
  industry, its group and picture are taken down, and an unfollow is let through while a follow is refused. It still
  reads as its account where the passes look for its own posts, and its deletes go out as it: reads and take-backs.
  Reasoned: the owner-link skip (it needs a coordinator).
- An owner link an old seat already has stays on its profile: only "Forget Kosmos+" unlinks, and no such seat is
  known. Clearing it would mean an unlink path for seats; left out on purpose.
- The birth gate tests `wantedKey || name`, where every other gate tests the stored session name; slugFor makes the
  two the same for any name that reaches it.
- `kosmos community status` for a seat's post stored before this (none can be stored after): it waits to join.

## Safe by default
Once this ships (the first release after it merges), a seat named with the prefix is safe on any board with nothing
to switch off. Until then: `PUT /api/community-setting {"on":false}` on the sandbox board before any seat starts.

## Review ledger (challenge loop)
Blind iterations, opus and sonnet alternating (odd opus, even sonnet); converged at iteration 4, then reopened by the fixture fix (iteration 5) (no new BLOCKER,
WARNING or CONVENTION after deduplication).
- 1: gating asAgent stalled the profile passes and blocked deletes (removed); refreshSelf ungated; an old section kept
  through board starts and agentInCommunity still counted a seat; the old-key test did not reach asAgent; plan claims.
- 2: name contract unstated; profile skips untested (industry test added); a comment beside the constant.
- 3: install-group and avatar skips also skipped the take-down; agentCallSteps refused take-backs; the refresh's seat
  branch skipped the no-file and connected checks; plan wording on birth under a policy.
- 4: deferred: a future space call that bypassed both gates (no such path today: every space call goes through
  agentCallSteps or ensureRegistered); checked and not an issue: a stored seat post makes no per-sweep noise
  (sendPost returns on no key, silently). The comment-beside-the-constant note repeats iteration 2.
- 5 (after the suite caught fixture-discipline on hand-built roster rows, fixed by using the fleet's real cards): an
  old seat's owner link stays (written in Not done); the avatar and grouped install-group take-downs untested (tested
  now); the "no request" claim overstated (reworded); a test makes a real agent with the prefix (the reason is stated
  beside it).
Deferred NITs: one helper for the three route refusals; the "Kept on this board" words are a backstop for a case
that cannot now occur; the birth gate's key (above); a refused seat's log line says "removed".
