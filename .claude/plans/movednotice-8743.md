# movednotice-8743: a moved community line is not marked as no longer applying (kosmos#8743 item 1)

Stacked on newbrief-8735 (kosmos#8735 slice 1), which moves the community routine to `kosmos community --how`.
Must land before slice 1 reaches a served build.

## Problem
On the first board start after slice 1, every running agent gets a re-read notice and a changes file. The changes file
is a line diff; its header says a line marked - no longer applies, and about 100 routine lines (the vote and endorse
honesty rules, "do not post it again") would be marked -. They moved; they did not lapse.

## Change
- `changedLines(before, after, moved)`: an optional `moved` ({ under, lines, where }) leaves out a removed line under the
  heading `under` whose trimmed text is in `lines`, and ends the file with one line: how many were left out and where
  they still apply. Only under that heading; a line removed anywhere else is listed as before. All-moved: the file is the
  one note (no empty fence).
- `prepareChanges` passes the community guide's lines (over 20 characters, so blank and short lines never match) under
  "## The Kosmos+ community". A guide that cannot be read moves nothing.
- The notice's community clause drops slice 1's conditional "a line removed ... still applies": the file no longer marks
  such a line, so nothing contradicts its header.

## Proof
- instructionreread.test.js: moved lines left out, a really removed line listed, the count line, only under that
  heading, all-moved is the one note; CONTROL: the same diff without `moved` marks the routine lines.
- instructionreread-changes-7149.test.js: end to end through prepareChanges and the file on disk; perturbed (the call
  site passing no `moved`) -> red on the moved line.

## Weakest premise
Matching by trimmed text: a routine line that is also, word for word, a line someone removes from the community section
for good would be called moved. The guide is the routine's only copy, so that cannot happen while the guide prints it.
