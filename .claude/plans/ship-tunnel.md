# ship-tunnel: the Plus connector ships inside the app bundle (#583, build half)

## Finished looks like
A Mac that installs Kosmos has app/bin/kosmos-tunnel present, remote.js finds
it without a PATH entry, and the release proves the SERVED connector is the one
the cut built (by checksum, named in the log) rather than skipping it. A build
with no connector input REFUSES rather than shipping a Plus that cannot turn on.
The connector is Developer ID signed in this build (the input arrives UNSIGNED from kosmos-relay); whole-app/DMG notarisation is the Apple lane's (Splinter).

## Why
The tunnel routes, the door opens, the screen exists, and the connector never
shipped: build-kosmos-bundle.sh's explicit list did not include it, so every
installed Kosmos failed Plus with "the connector is not installed on this Mac".
This is the last structural thing between the relay and a person (#583).

## Shape decision (A, ruled by Splinter)
IN the app bundle (app/bin/kosmos-tunnel), versioned WITH the app, because
remote.js DRIVES specific verbs of it and skew between them is a real failure,
the same reason kosmos-report-hook.sh rides in app/bin. Not its own served
tarball like tmux (tmux is a stable external dep; the tunnel is app
functionality). The DMG-as-thin-installer model fits A: one fetch of one
current artifact.

## Changes
1. build-kosmos-bundle.sh: stage the connector from KOSMOS_TUNNEL_BIN (default
   ~/work/kosmos-relay/dist/kosmos-tunnel), refuse a missing or non-universal
   input (lipo -archs: both x86_64 and a plain arm64 slice), Developer ID sign
   it in-build (Splinter's ruling; the input arrives UNSIGNED from kosmos-relay),
   verify the signature, run it (--help) to prove it loads, and log its sha +
   provenance. Fail LOUD if the cert is absent, no ad-hoc fallback: a nested
   ad-hoc binary makes the whole bundle's notarisation Invalid.
2. engine/remote.js: BIN() resolves __dirname/../bin/kosmos-tunnel when present
   (the installed layout, where the board's launchd PATH would not find a bare
   name), env override wins, bare-name PATH fallback for the source checkout.
3. tools/lib/release-freeze.sh: the connector is not a tree file, so 9b verifies
   it against the checksum of the tunnel THIS release built (passed as arg 3),
   NOT the tree and NOT skipped; a missing expected-sha is a failure.
4. tools/release.sh: capture the built connector's sha after the build, pass it
   to 9b, name it in the log beside the sha.
5. tools/test-release-detached.sh: the comparator's connector path both ways
   (matches, wrong sha caught, empty sha refused not skipped, changed caught).

## Not in this change
Notarisation of the whole app/DMG (Splinter's Apple lane; the connector itself
is Developer ID signed here so it is not the blocker). An automated check that
the INPUT connector matches a kosmos-relay-published checksum (kosmos-relay
does not publish per-commit shas yet); the input's sha + provenance are logged
for now, and served==built is proven. That completeness step is a follow-up.

## Measured
Frozen at the branch HEAD, built with the real universal binary as input:
app/bin/kosmos-tunnel is staged, is a universal x86_64+arm64 Mach-O in the
served tarball, and 9b matches on the right checksum, catches a wrong one, and
refuses an empty one. A build with the input absent refuses.
