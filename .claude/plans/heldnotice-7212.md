# kosmos#7212 slice 2a: the card says when messages wait behind an input box

## Build
1. engine/heldinput.js: the minute step (`sweep`, after the limit queue flush settles) records every agent held 30+ min
   behind its box, keyed by the resolved card's session name (queue names for one card merged), with what the box reads
   (text only on a second consecutive minute), and says the log line once per stretch, then daily (saved on disk).
2. server.js: calls the sweep with the pane reads; /api/status rows carry `heldInput` (heldinput.peek).
3. web/index.html stateReason: the sentence for an idle or working agent (how long, how many, what the box reads, what to
   do: read before sending, no promise on an empty box, restart only an idle agent).
4. docs/browser-checks/mobile-shots.js: two design-shot screens (unreadable box, unsent text).

## Not in this slice
- Counting it as needing the person and the phone push: slice 2b (every copy at once).
- The pill keeps its word: the sentence is the pill's hover and the agent page (#6398). 2b changes what the card reads.

## Untested
- The server wiring (the pane reads passed to sweep); the sentence is tested by lifting stateReason.
