# rnquote: decode apostrophes in the release-note social preview (#5775)

**Finished means:** the X and LinkedIn preview text for any versions-page entry reads exactly as the page does, apostrophes and curly quotes included, and a test goes red if the decoder ever breaks the shell quoting again.

## Steps
- [x] Reproduce: run the decoder block alone on the 0.7.37 entry; it printed "agent).replace(/&#821[67];/g,s window".
- [x] Root cause: literal ' inside the single-quoted node -e program ends the shell quote.
- [x] Fix: write '; add named and hex apostrophe and double-quote forms.
- [x] Test: two arms in tools/test-post-release-notes.sh, red against main, green here.
- [x] Field check: all 359 real entries decode with no entity left.
- [x] Blind review; findings fixed (see the pre-challenge proof).
- [ ] PR, CI green, merge.

## Decided
- Scoped validation (this test plus bash -n), not the full suites: nothing else reads this script. CI gates the merge.
- &larr; stays undecoded: it never appears inside a release note.
