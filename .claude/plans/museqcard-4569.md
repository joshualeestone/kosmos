# museqcard-4569: a busy Muse agent's card says how many messages wait, and whether the person's is next

Card: joshualeestone/kosmos#4569, the 11:57 write-up's fix 4 ("Working, 14 messages waiting" on the card, and
where the person's own message sits). Built on museq-4569 (PR #4604), which gave the queue its order.

## Finished looks like
While a Muse turn runs with messages waiting, the agent's card, list row and agent page read Working with the line
"15 messages waiting, yours is next" (or "..., yours are next", "..., all yours", "..., it's yours", or just
"N messages waiting" when none are the person's). It updates within about 1.5 s of the queue changing and clears
when the queue empties or the agent goes idle.

## Decisions
- The count travels as its own field, `waiting: { n, yours }`: musefront -> bin/agy-report-bridge.js (payload
  `kosmosWaiting`, which agy's own hooks never send) -> POST /api/report -> selfreport (kept only on a working report,
  whole numbers, yours <= n) -> status (carried while that working report is fresh) -> the card field `waiting`.
- The page words it (web/index.html waitingLine), unquoted, in stateReason ahead of every other rule. Review round 1
  measured that a working agent's reported REASON is hidden on the card, list and agent page by ruling (#986,
  #3271), so the first version (the line as the report's text) showed nowhere; and the quote marks would have said
  the agent said it, when it is Kosmos's count.
- "yours is next" because the person's messages always run first (#4604), which answers "where does mine sit".
- One report per 1.5 s window at most (each report starts a node process); the bridge's once-a-minute working
  throttle compares the count too, so a new count is not held back as a repeat.
- Rejected: the report's free text (hidden by ruling, and wrongly quoted); a new board route (the report already
  goes to the board every turn).

- Known and accepted (review round 2): reports are separate processes, so a working report sent in the last
  milliseconds of a turn can land after the idle one and show a stale count until the working report decays
  (REPORT_WORKING_DECAY_MS). The heartbeat already had this window; the note timer adds at most one report per 1.5 s.

## Weakest premise
That the line reads right in the card's task slot at every width: measured on the page's own taskLine / stateReason
source, not in a browser (a stub harness for a Muse card with a queue does not exist yet).

## Tests
- engine/musefront.test.js: a burst of 14 posts and one of the person's is ONE report ({ n: 15, yours: 1 }), then
  each turn's own count, then idle; counts follow the person's messages; nothing after idle; the reporter's payload;
  the bridge carries the count on working only and throttles by count (controls).
- engine/selfreport.waiting-4569.test.js: kept and read back; idle, text, yours > n, zero, fraction not kept; an
  emptied queue clears; status carries it on a fresh working report only (control: no count; a stale report).
- server.report-readback-2709.test.js: the route passes the count through and drops a bad one.
- engine/status.muse-waiting-4569.test.js: status.snapshot() puts the count on the pane card and on the paneless
  card (a live agent with a token and no pane), and a stale report puts none (each builder's line measured red).
- web.muse-waiting-4569.test.js: the card / list / agent page line, called with noQuote as they call it, and without;
  no count, a nonsense count, or a non-working state shows nothing.
