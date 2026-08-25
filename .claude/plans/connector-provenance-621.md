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

## Review rounds 1 and 2 (blind), what changed

- The build logs both numbers, labelled: `signed <sha>` (the staged copy after Developer ID signing, what ships and what 9b compares) and `input <sha> (its .sha256)` (what the relay's build wrote beside the binary). They never match each other; the comment says so.
- The staged copy is hashed against the sidecar's sha before signing, so bytes changed between the check and the copy cannot ship.
- Round 2: the build read the commit and the sha in two separate calls, so a relay rebuild between them would log the old commit beside the new sha (the #621 shape again). The build now calls `_connector_provenance_check` once, directly, and reads both values from it; the library header says which surface is for whom.
- `connector_provenance_sha` (the input sha), a malformed or empty `.sha256` refused as malformed (not as a mismatch), a copied binary told to bring its sidecars, and fixtures in the relay's own bare-hex shape and in CRLF (the CRLF tolerance was unproven: a mutation removing it left the suite green).
- Real-build controls (transcript in the proof): the real build logs the sidecar's sha and commit; a copy whose `.sha256` names other bytes refuses before staging with no tarball; a copy without sidecars refuses and says to bring them.
- Deferred: the `NOTE` on a dirty real stamp keeps the suite green on purpose (the build is what refuses); four `shasum` passes per build at 0.07 s each.
