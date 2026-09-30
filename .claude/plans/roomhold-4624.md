# #4624: hold a colleague's un-addressed room post while the member is working

Card: joshualeestone/kosmos#4624 (from #4580 item 9). Owner: PigeonPete.

## Rule
An AGENT's room post that does not @-name a member, arriving while that member's latest self-report is a fresh `working` (within status.REPORT_WORKING_DECAY_MS), is held, not typed. The member is told in ONE line, at the first of: its next `idle` report (server /api/report flushes), or its next typed room arrival in that project (the line rides on it). A held post is never retyped on its own.

Unchanged: the person's posts, any post that @-names the member, and members whose latest report is anything else (idle, needs_you, blocked, stopped, never reported, stale working). Brake: AGENT_WORKFORCE_ROOM_HOLD_OFF=1.

## Files
- engine/roomhold.js (new): shouldHold, hold/heldIn/heldProjects/clear (one 0600 JSON file per member under store.ROOT/roomhold), clauseFor, flushOnIdle.
- engine/messages.js: deliverOne holds before typing; a typed arrival carries the held line and clears only on a typed outcome; the sender's aggregate counts HELD as placed (so the CLI says "do not re-post" semantics stay right).
- server.js /api/report: on body.state === 'idle' (recorded or not), setImmediate flushOnIdle via chat.deliverAsync.

## Tests
- engine/messages.roomhold-4624.test.js (8): held vs idle control, addressed and person posts pass, stale report types, brake, ride-on line and clear, failed arrival keeps, idle flush once and keep-on-failure, bracket-safe name and counting.
- server.roomhold-idle-4624.test.js (1): an idle report types one line into the agent's pane; a working report does not.
- Mutations (each restored, cmp-verified): never hold (3 fail), no ride-on line (1), aggregate ignores HELD (1), clear on failed arrival (1), no idle flush (1).
- Neighbours: engine/messages*, server.*room*, server.*post*, cli.*post* = 252/252.

## Residuals (reasoned, not measured)
- A runner that reports `working` but never `idle` (none known; Claude, Grok send idle at Stop) would be told only on its next typed arrival.
- An agent renamed while it holds posts loses the line; the posts stay in the room.
- The idle flush types a line, which is one turn. That is the point (one turn for N posts), not zero.

## Blind review round 1 (Opus, separate reviewer)
Three WARNINGs, all fixed with a test each that fails on revert (mutation, cmp-restored):
- A working member with no pane was held and counted as reached, hiding a refusal. Now held only when chat.addressable says the board can type to it.
- An idle flush racing a typed arrival could tell the same held posts twice. Both paths now TAKE the ids first and restore them only if their line was not typed (or the typing threw).
- A reply to the member's own post was held as "nothing is asked of you". A reply to a member's post is never held for that member.
NITs taken: removal forgets the held list (remove.js, tested); null-prototype store so any project id is an own key; the key-sharing limit (safeKey, same as the self-report) and the arrival-budget count are stated in the module header.
Tests now: messages.roomhold-4624 (12), server.roomhold-idle-4624 (1), remove.test #4624 (1). Neighbours incl remove.test: 339/339.

## Blind review round 2 (Sonnet, separate reviewer): nothing above NIT. Converged.
NITs, accepted and why:
- The web receipt sentence would call a `held` outcome "not confirmed", but only the person's own posts get that receipt and they are never held. Unreachable today; a UI that shows agents' per-recipient outcomes must map held to placed.
- hold() runs before appendLog, so a failed log write leaves an id held for a post that was not logged (the line's count reads one high). Needs a log-write failure; accepted.
- An interrupted turn (no Stop hook) keeps `working` fresh for up to REPORT_WORKING_DECAY_MS, so posts wait up to 5 minutes and then ride the next typed arrival; an auto idle refused over a standing needs_you still flushes. Bounded and stated.
- Past KEEP (200) the oldest ids drop, so the count undercounts. Bounded and stated.
Next: full validation after #4574 is on main (Splinter 12:50), then PR.
