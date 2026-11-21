# wakelabel-8864: a line sent automatically is not the person's (kosmos#8864)

## Measured first (installed 0.8.13 on this Mac, and main): not fixed
- The board's wake 'hello' posts `/api/agent/<name>/thread {text: 'hello', automatic: true}` (web/index.html
  sendWakeHello). The reporter's line was a different sender: its own listener script POSTs a boot notice to the same
  route after a reboot (Homer, via Splinter). Both reached the agent under `[message from your operator ...]` and were
  stored as the person's row, so `kosmos feedback day` counted them as the person's words.

## Built
- messages.automaticWake(): the bracket `[sent automatically on this computer, not typed by your person · to tell your
  person something, run: kosmos reply]`. It names neither sender, does not say "nothing to answer" (a script's line can
  ask for work), and does not open with the operator marker, so the MARKERS forgery guard is untouched.
- server.js thread route: an `automatic: true` send is typed under that bracket, and its row is stored with
  `automatic: true` (the held and duplicate paths are already `!automatic`, so only the final write is reached).
- chat.appendMessage keeps `automatic: true` only on the person's side (a row with no `from`).
- engine/feedbackday.js and engine/awaydigest.js skip automatic rows (neither the person's words nor a person message
  that failed to reach the agent).

## Decided not to change
- chat.dmOwes and firstreply-nudge: a restart hello has always been something the board expects an answer to; leaving
  that behaviour alone keeps this card to labelling and counting.
- `kosmos inbox`: it lists the whole conversation, the agent's side included, so it is not a count of the person's words.
- The handoff-restart pickup has its own route and is not touched here.

## Tests
server.automatic-label-8864.test.js: the bracket; the board hello and a script's boot notice both typed under it and
stored as automatic; CONTROL, the person's message keeps the operator bracket and no mark; the day summary drops both
automatic lines and keeps the person's; an agent row cannot carry the mark. Perturbing the envelope and the day-summary
skip each turns it red (restored). 164 related files: 4,578 tests, 0 failed.

Weakest premise: that a local script will send `automatic: true` (Homer said he will switch once it is served). A script
that does not keeps the old behaviour; nothing here can tell its POST from the person's.
