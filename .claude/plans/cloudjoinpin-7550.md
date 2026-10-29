# cloudjoinpin-7550: the cloud join pins the board's coordinator keys and does not wait on setOn's refresh (kosmos#7550)

Follow-up from Kitty's review of cloudjoin-4903r (#7549). Both changes are in install/setup.sh's kosmos-cloud-join block.

## What
1. Before registering, the block asks the engine for the keys the board pins (`remote.setupEnv()`, now exported) and
   hands them to `kosmos-tunnel setup cloud` as KOSMOS_EXPECT_COORDINATOR_KEYS, in a subshell, so they reach only the
   tunnel. With no pin, an inherited value is removed, as setupEnv does. An engine that cannot answer stops the join
   before the token is sent.
2. Both `setOn(true)` node -e calls exit once setOn has answered, so the standing refresh it starts (askAfterFlip)
   cannot hold the installer for up to the 20 s signed-call bound.

## Tests
install.cloud-join-4903.test.js: four new tests (the pin reaches the tunnel; an inherited pin is removed; a failed
setupEnv stops before the token is sent; setOn's leftover work does not hold the join, on a first run and a rerun).
Each one was shown to go red under its own mutation (no exit, pin not exported, inherited kept, failure ignored).
The real engine's setupEnv was run against an empty data root: it answers "" at once and writes nothing.

## Weakest premise
Only a release that ships a service key set makes the pin non-empty. If that set did not match the live coordinator,
the join would now refuse where it used to succeed. The board's own Mac registration makes the same check with the
same set, so a mismatch would already break every Mac sign-in.
