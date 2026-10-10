# #5743 and #5754: never type into Claude's question menu or permission prompt (rooms, timers, every sender)

Card: joshualeestone/kosmos#5743. Follow-up to #5406 slice A (merged #5746), which fixed the direct-message route only.

## Finished looks like

While Claude's question menu is on an agent's screen (any menu drawn with its "Enter to select · ... Esc to cancel"
footer: single-select, multi-select, multi-question), no path types a message into that pane:
- automatic deliveries that can reach a needs_you card (a colleague's room post, the unanswered-post nudge, the
  restart hello, the handoff pickup, the auto-handoff) are HELD (COULD_NOT, held: true,
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

- A post held for a Claude member is told at its idle flush (its idle report after the question is answered and the
  turn ends) or its next typed arrival; there is no timed release, unlike the quota hold.
- A post held behind a question left up for more than two hours ages out like any held room post (HELD_TELL_MAX_MS);
  the sender was told it was held. Same policy as the #4624 idle hold; not changed here.
- connlost-heal's nudge uses plain deliver and counts a try first; a connection-lost card is not expected to read
  needs_you on this menu, so it is not special-cased.
- The direct-message close-then-deliver path runs through this floor: server.question-menu-5406.test.js ("any other
  reply closes the menu with Escape first, then goes as a message") reads the screen again after the Escape and types.

- deliverAutomatic reads the screen in menuHeldVerdict and again at the floor; a menu drawn between the two reads is
  refused rather than held, so a room does not keep that one post.
- A paused-swarm Claude agent on its menu is logged as menu-held rather than paused; its later flush is refused as paused.
- The idle-only sweeps (assigner, agentnudge, firstreply, replynudge) never meet a menu hold; their menu-held wording is
  defensive.
- The recommender targets needs_you agents, so it does meet Claude agents on their menu. Its hold hook (heldUntil, the
  quota's) now also asks chat.menuHeld: a stuck agent on its menu is not convened, nothing typed and no attempt spent,
  and a peer on its menu is left out of the asks like any unreachable peer. The question is the person's to answer.

- #5754 (priority, Splinter 2026-10-09 23:51) rides this branch: Claude's PERMISSION prompt gets the same floor.
  Measured on 2.1.296 through the 0.7.35 delivery code into a real prompt: both delivery paths reported placed while the
  prompt approved Yes and the command ran. status.claudePermissionPromptUp (an "Esc to cancel" footer at the bottom, a
  "1. Yes" row and a "Do you want to" question just above it; both real captures plus the older select footer) feeds
  the same refusal and hold, with its own sentence (answer it in the window; the DM route cannot answer it).

## Weakest premise

The snapshot reads needs_you while the menu is up. Not caught, recorded rather than fixed here (each needs the board's
classifier to read the menu's footer as needs_you, which changes every agent's card; follow-up #5749):
- a menu drawn after the snapshot and before the paste (the request's own lifetime);
- the multi-select form with its highlight on the unnumbered Submit row, and the multi-question form's review tab (no
  numbered highlighted row for the classifier, and the review tab has no free-answer row for claudeQuestionMenuUp);
- a menu so tall that its highlighted row is more than 25 rows above the footer.
