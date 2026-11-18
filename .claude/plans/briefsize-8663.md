# briefsize-8663: a BRIEF.md over 64 KB keeps its goal, and project show says why when no brief is read

Card: kosmos#8663 (daily feedback, one install). Night shift, Renet Tilley, routed by Splinter.

## Problem
engine/brief.js refused any BRIEF.md over MAX_BYTES (64 KB) and returned null, the same as a missing file. So
`kosmos project show` said "there is no readable BRIEF.md" and the Assigner (engine/assigner.js, which reads
brief.readGoal) lost the project's goal with nobody told. Measured on main: a 65,598-byte brief with Goal and Done at
the top read { found: false }; a 69-byte control read its goal.

The other brief reader, projects.readBriefSafely (doneSet, doneIsPending, fillDone), already read up to 256 KB, so
between 64 and 256 KB the two readers disagreed about the same file.

## Decision
- engine/brief.js: MAX_BYTES is 256 KB. projects.readBriefSafely reads that limit from brief.js (lazily: brief.js
  requires projects.js at load), so the two readers use one size limit. (They still check the file differently:
  readBriefSafely reads by path after an lstat, as on main, while brief.js reads through the descriptor it checked.) readBriefFile returns
  { text, why, size }; nothing read says why: missing | symlink | not_a_file | too_large | unreadable. readBrief adds
  why and size.
- engine/projectview.js: overviewOf passes briefWhy, and for too_large briefBytes and briefLimit. renderShow says which
  reason, and for too_large: "Brief: BRIEF.md is N KB, over the 256 KB Kosmos reads, so no goal or "done" is read.
  Shorten it, or move notes out of it into another file." An older board (no briefWhy) keeps the old sentence.

Rejected:
- Read the first 256 KB of a larger brief (built in review rounds 1 to 3, taken out in round 4): it made the two
  readers disagree above the limit (show and the Assigner saw a goal and done that doneSet and fillDone treated as
  unreadable), and could quote a Done cut partway through. Three reviewers in a row raised the disagreement.
- Make projects.readBriefSafely read only the head too: fillDone writes the brief back through it, so it must have
  the whole file or refuse.
- Keep 64 KB and only say why: the brief in the report still loses its goal.

## Weakest premise
That no real brief passes 256 KB. One that does now says so, with its size, instead of "no readable brief", but its
goal is still not read. Also: I could not measure the reporter's file (the report said "tens of KB" and "well under any
obvious limit"), so the 64 KB refusal is the cause I reproduced, not one I confirmed on their file.
