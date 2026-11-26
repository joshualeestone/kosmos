# cmdoutage-9090: compact, clear and the handoff routes during a `claude agents --json` outage (kosmos#9090)

## Decided (on the card, 11-26 09:5x)
- commandGate tries outageChannelCard (kosmos#9087 Part B's evidence) before the 409; with a card, compact, clear,
  handoff-restart ask and pickup hand delivery that one card (commandRoster), never padding a roster read.
- handoff-restart/status takes its session from sendGate's card or the outage card; unreadable without evidence is a
  409 to retry (a read's words), never the 404 the dialog cannot tell from "not written yet".
- No Windows-only idle check: on a good read a Windows command already skips it (the supervisor queues the text).

## Files
- server.js: noteOutageSend(name, what), commandGate, commandRoster, the four routes, the status route.
- server.command-outage-9090.test.js: each route through the pipe, the status poll seeing a handoff written during
  the outage, and controls (no evidence: 409; no folder: 404; the outage evidence's refusals; Muse still refused).

## Order
1. Code + test (done). 2. Focused tests (#9087's two neighbours too), queued. 3. Gates, blind review (8 max, one at a
time, alternate models, last whole-branch). 4. Validation. 5. PR. 6. Windows steps for Homer via Splinter: /compact
through the pipe compacts (compact_boundary in the stream), measured on the box.
