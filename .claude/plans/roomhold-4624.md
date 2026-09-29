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
