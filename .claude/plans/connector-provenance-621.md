# connector-provenance-621: the connector's provenance is a property of the binary

## Finished looks like
build-kosmos-bundle.sh reads the two sidecars kosmos-relay's build writes beside the
connector (<bin>.commit, <bin>.sha256), refuses when either is missing, when the .sha256
names other bytes than the binary beside it, when the commit is -dirty, or when it is
malformed, and logs the binary's own commit as its provenance instead of `git describe` in
the checkout. tools/test-connector-provenance.sh proves each refusal and the happy path, and
reads the real connector on this Mac as an integration line. A real build with a mismatched
sidecar refuses (done by hand for the PR).

## Why
#621: the build logged the checkout's HEAD, not the commit the bytes came from; the one
bundle input that is not a tree file, so served == built could not see it (Splinter,
2026-08-24, the night the connector was rebuilt minutes before a cut). The relay half
(Baron, kosmos-relay bcd6b51) writes the sidecars; this is the kosmos half.

## Not in this change
Signing (unchanged, after the copy). kosmos-relay has no remote, so "the commit" resolves
on this Mac only, which is the relay's state, not this change's.
