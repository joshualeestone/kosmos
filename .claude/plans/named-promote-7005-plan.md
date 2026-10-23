# named-promote-7005 (kosmos#7005)

## Problem
The Mac promote (`tools/promote-channel.sh`) copies whatever `dist/latest-staging.json` names now onto
`latest.json`, and `setup-staging` onto `/setup`. While a prod GO for one build is pending, no staging cut
can run: it would replace the approved build. Measured 10-23: 0.7.64 approved-pending, ~20 merges behind,
Josh away until about Monday.

## Change
`--version <V>` (Mac only). The pointer and the installer pair come from the newest site commit on HEAD
whose `dist/latest-staging.json` names V (each staging cut commits its pointer + installer together).
Every existing check then runs unchanged on that snapshot and installer: artifact present + sidecar +
pointer sha, manifest + signature checks, installer sha + floor, all gates (experience gate expects V).
Skipped in named mode, by construction: the live working-tree `setup-staging` committed/unmodified checks
(the pair is read from a commit) and the staging-moved-during-gates check (the source is immutable).
Without `--version`, nothing changes.

## Tests
`tools/test-promote-named-7005.sh` (wired into test:shell): fixture site with committed cuts 9.9.8 then
9.9.9; named promote of 9.9.8 while staging names 9.9.9; controls on the default path; refusals.
Four mutants each red (installer from the working tree; no installer sha check; no version match; the
moved check left on). Neighbour tests green: 5032, 2036 channel/wire, 6149 floor, pointer-freeze,
deploy-site-promote, promote-channel-win.

## Rejected
- A pinned per-version pointer file written by the cut: needs a cut change and only helps future builds;
  git already holds every cut's pointer + installer.
- Reading origin/main instead of HEAD: the deploy serves the committed checkout; the promote recipe pulls
  the site first.

## Not done (stated on the card)
The experience and agent-spawn gates still need a board running V. After a later staging cut moves the
cut box's board, the gate says cannot-tell and the promote HOLDS (forceable after a hand check, as today).

## Merge hold
Do not merge before the 0.7.64 prod promote lands (Splinter 17:59): Baron's prepped promote scripts call
promote-channel.sh.

## Weakest premise
That the newest commit naming V is the cut's commit. A hand republish of V's pointer would also be a
commit naming V; it carries the same pointer fields, and the installer sha check refuses a pair that
does not match the pointer.
