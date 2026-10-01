# roomidle-4624: an idle member is not woken by a colleague's un-addressed room post either (#4624 follow-up)

Card: joshualeestone/kosmos#4624, comment of 2026-10-01 14:41 (0.7.15 diagnostic by five model families, H7):
"Claude, Grok and Gemini still see every room post wake every member on 0.7.15 ... Suggested again: do not redeliver
a post an agent has answered, batch background posts, and wake only when mentioned, assigned or asked."

## Measured first
- The first fix (#4715, bf91a912) IS in 0.7.15 (ancestor of b6effce46). It held an agent's un-addressed post only for a
  member whose latest report is a fresh `working`. An IDLE member was still typed every such post: one turn each,
  ending in "not addressed to me". That is the diagnostic's report, so the gap is the rule's scope, not a regression.

## What changes (engine/roomhold.js)
- shouldHold also holds for a member whose latest report is `idle`, at any age (its turn ended; nothing decays it).
- The told line reads "Since you last heard from this room, N room posts not addressed to you ..." (it said "While
  you were working", now wrong for an idle member).
- Unchanged: the person's posts, posts that @-name the member, replies to the member's own post, members whose report
  is needs_you, blocked, stopped, never reported or a stale working; the brake AGENT_WORKFORCE_ROOM_HOLD_OFF=1.

## How an idle member hears about held posts
On its next typed arrival in that room (the person, a post naming it, a reply to its post: the line rides on it), or
at the end of its next turn (the existing idle flush). So it is woken only when something is asked of it, which is the
diagnostic's ask. It can always read the room (`kosmos room <id>`).

## Decided, and rejected
- Rejected: a periodic digest typed to idle members (every N minutes). It is still a wake per window for posts that
  ask nothing, which is what the report complains about.
- Rejected: holding for never-reported members. A runner the board cannot read is typed as before (no change in risk).

## Weakest premise
That an idle agent needs nothing from a colleague's un-addressed post until something wakes it. A colleague who needs
an answer must @-name it (the room's existing rule, and what the Prompter and the Assigner already use to wake an
agent). What would change my mind: rooms where work stalls because an idle agent never saw an un-addressed question.

## Tests
engine/messages.roomhold-4624.test.js: a new arm (idle held, needs_you typed as control, an old idle report still
holds, the person's post carries the held line once); the controls that used an idle member as "typed" now use a
never-reported one; ride-on carriers are @-addressed posts. engine/roomhold-agyhold-4588.test.js: the line's wording.
