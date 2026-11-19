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
- (a) After an unanswered ask, the board asks again BY ITSELF after 30 s, up to 20 times (10 to 15 minutes, with each
  ask's own limit), then falls back to the request-driven re-ask as before. Review 3: the count belongs to the connector
  BINARY (path, mtime, size), not the generation, so a tunnel that keeps restarting on one binary gets one budget; an
  update starts it again. A deliberate stop (stopChild) clears the timer. One unref'd timer, cleared by any answered ask and by a new
  generation (forgetConnectorCapabilities). Review 1: the timer used to re-check its generation and the kept answer as
  well; those were removed, so the clears are the one mechanism and a test can fail on them.
- (d) An ask after an unanswered one gets 15 s instead of 5 s.
- (c) Every ask writes one stderr line (the board's log): answered in N ms with what it listed, or not answered and what
  happens next (asking again in 30 s / asked 21 times, next request / dropped, a newer tunnel / the earlier yes kept);
  an answer from an older generation says it was dropped.
- (b) `connectorCapabilitiesPending()`: true when nothing is kept, the kept ask did not answer, no child runs, this
  child's status has not been read yet, or (review 1) the status file is held by a tunnel from an earlier board that
  is still being ended. Review 2: an unanswered ask counts as pending only while the board still asks by itself; after
  the 1 + 20 asks the update sentence comes back, so "still starting" is never a promise nothing keeps (a connector
  that cannot be started at all). One predicate, stillSelfRetrying, decides the retry, the log line and this. `remoteStepUpRefusal` then returns REMOTE_STEP_UP_STARTING ("Kosmos+ is still
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
`server.capask-8728.test.js`, eight tests, timings shortened through a test-only seam (`timings` on
resetConnectorCapabilitiesForTests, honoured only under NODE_TEST_CONTEXT): self re-ask with the longer limit and both
log lines; over HTTP the starting sentence while unknown; control, an old connector still gets "update Kosmos"; the cap
of 1 + 20 asks and the last line; a new generation (forget with no new ask) leaves the old timer silent; while an
earlier board's tunnel is being ended the sentence is "still starting", with a control that reaches the route; review
3: a restart on the same binary after the budget ran out asks once and no more; pending for no tunnel here, no child,
and the child's status not yet read, with the control that clears it.
Mutations, each red: no self-retry (2 red), no starting sentence (1), no longer retry limit (1), no cap (1), no clear in
forget (1), no foreign-window pending (1, set or read); review 3: forget resetting the count (1), the per-binary reset (1),
the log's per-binary count (1), the status-not-read arm (1). Two separate "no tunnel here" and "no child" lines were
removed rather than tested: each mutation left every test green because the status-not-read line already returns true
in both cases, which the comment there now says. Existing: server.remotestepup-6595.test.js and
server.stepupbutton-6616.test.js unchanged and green (47 with the new file).

## Known and left
- With no tunnel child running (between a crash and its relaunch, at most 60 s apart), pending is true and the sentence
  says "still starting". A tunnel that crashes forever keeps saying it. Not bounded here: the relaunch is real and
  close, and a request can only arrive then through an earlier board's tunnel that could not be ended.
- Before this board has started its own tunnel, pending is true, so the sentence says "still starting". A board that
  never starts one gets no remote request through Kosmos+ in the first place (no tunnel of its own forwards to it, and
  an orphan is ended), so this is not reached in practice; the sentence before this change was no truer there.
