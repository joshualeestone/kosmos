# museqcard-4569: a busy Muse agent's card says how many messages wait, and how many are the person's

Card: joshualeestone/kosmos#4569, Priya's second write-up, fix 4 ("Working, 14 messages waiting" on the card,
and where the person's own message sits). Built on museq-4569 (PR #4604), which gave the queue its order.

## Finished looks like
While a Muse turn runs with messages waiting, the agent's card and page read Working with the line
"N messages waiting" plus ", K of them yours" / ", all yours" / ", it is yours" when the person's messages are among
them (they always run first, so the count of theirs says where their message sits). The line updates within about
2 s of the queue changing and clears when the queue empties or the agent goes idle.

## Decisions
- The front reports it the way Muse already reports working/idle: through bin/agy-report-bridge.js, in a
  `kosmosNote` payload field agy's own hooks never send. The board shows a working report's reason as the card's
  quoted line (engine/status.js keeps `reported.because`), so no page change is needed.
- One report per settled burst (NOTE_EVERY_MS 1.5 s): each report starts a node process, and 14 room posts arrive
  in a burst.
- The bridge's once-a-minute working throttle now compares the line too, so a new count is not held back as a
  repeat; a marker from before this change (no text) compares as an empty line.
- Rejected: a new board route or card field (a second path for one sentence the report already carries).

## Weakest premise
That the quoted line reads right on the card for Muse (the quote style means "the agent said this"; here the Muse
front says it on the agent's behalf). Not browser-checked: the line is the existing report-reason slot.

## Tests
engine/musefront.test.js: a burst of 14 posts and one of the person's is ONE report ("15 messages waiting, 1 of
them yours"), then each turn's own count, then idle; "all yours" / "it is yours"; nothing after idle; the reporter's
payload; the bridge puts the note on working only (control: agy's payload says nothing) and throttles by text
(control: the same line within a minute is held).
