# capask-8728: a slow first capability ask no longer refuses the first remote action, and the refusal tells the truth

Card: kosmos#8728 part 1. Josh, 11-19 08:20 CST, from his laptop through Kosmos+, viewing a Mac that had restarted at
08:13: Sign in again on a Claude account was refused with "This computer's Kosmos+ connector cannot vouch for a fresh
sign-in right now ... if this keeps happening, update Kosmos." Nothing was out of date.

## Cause (by elimination; the board logged nothing on this path)
- The running tunnel was the board's own child (one pid since 08:14:21) and listed `session-headers` in its status file.
- The bundled connector answers `capabilities` with `session-headers device-proof-v2` in under 10 ms.
- So the kept BINARY answer was empty at 08:20. With that binary, the only way is an unanswered ask: the one made at
  tunnel start (08:14:21, board-logged load 151.8 at 08:14:37, 5 s limit). An unanswered answer is re-asked only when a
  gated remote request arrives (binaryCapabilities), so Josh's press was the first request: refused, and it started the
  re-ask. Weakest premise: the timeout itself was not recorded anywhere.

## What changes (engine/remote.js, server.js)
- (a) After an unanswered ask, the board asks again BY ITSELF after 30 s, up to 20 times (about ten minutes), then
  falls back to the request-driven re-ask as before. One unref'd timer; cleared by any answered ask and by a new
  generation (forgetConnectorCapabilities). The timer also checks its generation and the kept answer when it fires;
  those two checks are belts only (the clears above already cover both cases), so no test can fail on them alone.
- (d) An ask after an unanswered one gets 15 s instead of 5 s.
- (c) Every ask writes one stderr line (the board's log): answered in N ms with what it listed, or not answered and what
  happens next (asking again in 30 s / asked 20 times, next request / dropped, a newer tunnel / the earlier yes kept).
- (b) `connectorCapabilitiesPending()`: true when nothing is kept, the kept ask did not answer, no child runs, or this
  child's status has not been read yet. `remoteStepUpRefusal` then returns REMOTE_STEP_UP_STARTING ("Kosmos+ is still
  starting on this computer ... Try again in a minute"), same code `remote_step_up_unavailable`, so every page that
  reads the code is unchanged. A connector that ANSWERED without the capability keeps the update sentence. A caller
  passing its own caps (tests) is treated as answered.
- Nothing trusted widens: the decision to refuse is unchanged; only which sentence, and when the board asks again.

## Rejected
- Letting the first gated request wait for the ask. The design says a request never waits on the connector (#6595),
  and a refused request with an honest sentence plus a self-retry gets the same result without that change.
- A page auto-retry after "still starting". Worth doing, but it is a web/ change with its own gates; part 2 of the card
  redesigns that dialog anyway.

## Tests
`server.capask-8728.test.js`, five tests, timings shortened through a test-only seam (`timings` on
resetConnectorCapabilitiesForTests, honoured only under NODE_TEST_CONTEXT): self re-ask with the longer limit and both
log lines; over HTTP the starting sentence while unknown; control, an old connector still gets "update Kosmos"; the cap
of 1 + 20 asks and the last line; a new generation leaves no stray ask. Mutations, each red: no self-retry (2 red), no
starting sentence (1), no longer retry limit (1), no cap (1). The generation/answered checks inside the timer survive
mutation alone and together with the clear in forget, as said above. Existing: server.remotestepup-6595.test.js and
server.stepupbutton-6616.test.js unchanged and green (44 with the new file).
