# owncodev3-4658: render-owncode-4649 makes its other-computer codes as version 3

## What broke
The 0.7.67 staging cut (pinned 01dbeaffd2) failed at step 3b on render-owncode-4649: 2 arms failed in each engine and width, failing twice. The check hand-builds the codes another computer would paste with `v: 1`. Since #4658 slice 2 (#7124), /api/federation/verify refuses version 1 as made by an older Kosmos. So "Verify of an own code says it is shared by your other computer" and "a code from a computer that is not on this account is refused" both got the old-code sentence instead.

## Decided
- The check builds `v: 3`, an unsealed room's code as a current board makes it. Nothing else changes: the same fields, and `from` is already set (v3 requires it).
- Searched every browser check, tool and test for hand-built own codes (`OWN_PREFIX` / `kosmos-own:`). This is the only v1 one: server.federation-3311.test.js already builds v3 and v2, and tools/fed-own-e2e.js reads a code the board made.

## Why CI did not catch it
render-owncode-4649 is not in PR CI's browser-check subset, so #7124 merged green. This is the lesson for the author of a change to a parser: grep for every hand-built input of that parser, in full-run checks too.
