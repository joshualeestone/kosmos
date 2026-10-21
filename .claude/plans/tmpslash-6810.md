# tmpslash-6810: the Codex isolation test passes when TMPDIR ends in a slash (kosmos#6810)

**Card.** tools/test-supervisor-codex-isolation-4592.sh failed 2 of 13 arms on a stock Mac, whose TMPDIR ends in "/".
The scratch root became `.../T//test-...`, every expected path carried the doubled slash, and the supervisor hands
the pane a clean path, so the exact-match (`grep -qxF`) arms failed with no fault in the product.

**The call.** Strip one trailing slash from the TMPDIR before `mktemp` (`TMPROOT="${TMPDIR:-/tmp}"; TMPROOT="${TMPROOT%/}"`),
defaulting to /tmp first: the card's literal `${TMPDIR%/}` would make an unset TMPDIR into "", and the scratch root
into a folder at the filesystem root. A guard right after names a doubled slash in the scratch root as its own FAIL.

**Rejected.** Normalising the compared paths instead (it would hide a real doubled slash the product produced);
stripping every trailing slash (one is what a Mac gives, and the guard names anything else).

**Scope.** 133 tools/test-*.sh files build a scratch root the same way (`grep -lF 'mktemp -d "${TMPDIR:-/tmp}/'`). The
doubled slash only matters where a test compares an exact path built from it; this card is the one measured failing.
Left as a note on the card, not a sweep.

**Done when.** The file passes with TMPDIR ending in "/", without one, and empty; the guard fails when the scratch root
has a doubled slash (TMPDIR ending in "//").

## Tests run
- TMPDIR=<dir>/ : 13 PASS, rc 0 (before the fix: 2 FAIL, rc 1, the card's two arms).
- TMPDIR=<dir> : 13 PASS, rc 0. TMPDIR empty (the /tmp fallback): 13 PASS, rc 0. No scratch folder left behind.
- Control, TMPDIR=<dir>// : the new guard FAILs first, by name, then the two exact-path arms; rc 1.

**Weakest premise.** That nothing else in the file builds a path from TMPDIR directly; it reads TMPDIR once, here.
