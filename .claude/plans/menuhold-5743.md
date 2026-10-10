# #5743: never paste into Claude's question menu (room posts and automatic deliveries)

Card: joshualeestone/kosmos#5743. Follow-up to #5406 slice A (merged #5746), which fixed the direct-message route only.

## Finished looks like

While Claude's question menu is on an agent's screen (any menu drawn with its "Enter to select · ... Esc to cancel"
footer: single-select, multi-select, multi-question), no path types a message into that pane:
- automatic deliveries (a colleague's room post, task lines, the idle flush) are HELD (COULD_NOT, held: true,
  heldBy: 'menu'), so the room keeps the post and the next idle flush, after the question is answered, delivers it;
- every other sender (a person's room post, the task line, slash commands) is refused COULD_NOT with a sentence that
  says why and where to answer (the agent's direct messages, or its window). Nothing is typed, so re-sending is safe.
The direct-message route keeps slice A's behaviour (a number answers, other text closes the menu first, then delivers).

## Decided

- Hold for automatic deliveries, never close: closing would dismiss a question the person has not seen (card's own lean).
- A person's room post is refused, not auto-closed: a room post is not addressed to the menu, and closing from a room
  would dismiss a question from a place that does not show it as the agent's question. The DM is where it is answered.
  Rejected: the DM rule in rooms (digit answers) - a room post "1" is far likelier a list item than an answer.
- Where: one floor in deliverWithGap (every sender passes it, like the trust-dialog and Codex floors) plus the held
  verdict in deliverAutomatic(Async) (the existing #4588 hold shape, so rooms already keep and re-deliver it).
- The fresh screen read happens only when the roster snapshot already says needs_you (a Claude card on its menu reads
  needs_you, slice A's measured premise), so ordinary deliveries pay no extra capture.

- A failed screen read is not a refusal: needs_you covers every question (permission prompts too) and the DM route
  reaches the floor right after closing the menu, so failing closed would refuse ordinary replies on one bad capture.
- The floor reads the screen again right before typing even after menuHeldVerdict read it: a deliberate last look,
  paid only by a needs_you Claude card with no menu up.
- The refusal sentence points at the window first: the DM route answers only the single-choice form by number.

- A person's room post refused here does not carry this sentence to them: a room reports one aggregate outcome per
  post (unconfirmed, or could not reach anybody), not each member's reason. The direct, task and slash routes show it.
- Under the room brake (AGENT_WORKFORCE_ROOM_HOLD_OFF=1) a colleague's post goes through plain deliver, so a member on
  its menu is refused, not held and kept (before this card it was typed into the menu).

## Weakest premise

The snapshot reads needs_you while the menu is up. Not caught, recorded rather than fixed here (each needs the board's
classifier to read the menu's footer as needs_you, which changes every agent's card; follow-up #5749):
- a menu drawn after the snapshot and before the paste (the request's own lifetime);
- the multi-select form with its highlight on the unnumbered Submit row, and the multi-question form's review tab (no
  numbered highlighted row for the classifier, and the review tab has no free-answer row for claudeQuestionMenuUp);
- a menu so tall that its highlighted row is more than 25 rows above the footer.
