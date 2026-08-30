# Plan: #1595 publicView carries canRunClaude so the stuck hatch renders

## Problem

The STUCK screen's one way out ("open Terminal, type claude, follow its
sign-in", web/index.html ~30732) is gated on `st.canRunClaude`. becomeStuck
(engine/connect.js) computes and writes that flag, but `publicView` (the object
/api/connect serves, via state() -> publicView(mem)) returned only
configDir/phase/before/progress/url/plan/because/tail. So the page always read
`undefined` and the hatch has never rendered. Silent in both directions: the
engine records a true canRunClaude, so a state dump looks healthy, while the
person on the stuck screen sees no way out. Same class as #1585 (tail) and #1556.

## Fix

Add `canRunClaude: s.canRunClaude || false` to publicView, so the field is
always a real boolean (false when unset, since becomeStuck is the only writer)
and never undefined. Export publicView for a direct unit test. No route change:
/api/connect already serves state() -> publicView.

## The card's suggested sweep (which other st.<field> does the client read that
## publicView drops)

Ran it, scoped to the connect flow (web/index.html 30250-30760). The client
reads: because, before, canRunClaude, error, phase, progress, tail, url.
- All except canRunClaude and error are in publicView.
- canRunClaude: the drop this card is about. Fixed.
- error: NOT a publicView field. It is read as `st.error` on `!res.ok` from a
  /api/connect/start POST, i.e. the error-response body shape, not the state
  contract. Correct as is.
So canRunClaude was the only genuine drop.

## Tests

engine.publicview-canrun-1595.test.js: publicView serves canRunClaude true/false
when set, and false (never undefined) when unset; the pre-existing fields are
intact. The client half is already pinned (server.connect.test.js:797 asserts
the stuck screen reads `st && st.canRunClaude`); this is the server half that was
missing, which is why the client test passed while the feature was dead end to
end. Control reds on revert.

## Collision

Disjoint from Kitty's #1592 (runnable-dir-1592): her connect.js hunks are
431-439 and 2074-2081; mine is publicView at ~493 plus the export line. She
touches no web/index.html. merge-tree --write-tree against her current branch
reports CLEAN. Either order lands.
