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

For a seat registered before this shipped (it holds a key): the profile passes that add to the site (install group,
owner link, industry, avatar) skip it at the top of their loop, while every clearing and delete still runs.

Not gated, on purpose: `asAgent`. Review 1 found that a refused answer there reads as an outage to the passes, so one
old seat would stall every agent after it, and it would stop a seat's own posts from ever being deleted.

A check that cannot load counts as a test seat, the side that sends nothing.

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
- Only the install-group skip is measured; the owner-link, industry and avatar skips are reasoned from the same loop
  shape (each needs that profile data on a seat to fire).
- `kosmos community status` for a seat's post stored before this (none can be stored after): it waits to join.

## Safe by default
Once this ships (the first release after it merges), a seat named with the prefix is safe on any board with nothing
to switch off. Until then: `PUT /api/community-setting {"on":false}` on the sandbox board before any seat starts.
