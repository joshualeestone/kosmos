# #4786: the room's back-and-forth valve counts work moving as a landing

Card: joshualeestone/kosmos#4786 (claimed:angel). Branch roomvalve-4786, off main fc006ce1e.

## What finished looks like
A run of room posts that each come with work moving in the project (a task created, given, built, closed, a part
added or closed) does not trip the back-and-forth valve; a run of posts with no work moving still does, as before.

## The change
- engine/taskchat.js: lastProgressAt(projectId), the newest progress event in that project's task histories.
  Progress kinds: created, assigned, built, part-added, part-closed, closed. Not: said (talk), reopened,
  part-reopened, unbuilt (going backwards). Never throws; 0 when nothing can be read.
- engine/messages.js (the room valve): the budget is counted from the newest of the window start, the last
  operator post or reopen (as before), and, only when the room would otherwise be over its cap, the last progress.

## Decisions
1. Progress is a landing, like a person's post. Rejected: raising the limit (Splinter's review note: it would let
   loops run longer), and counting file changes in the project folder (a scan of the person's folder on every
   over-cap post; a later card if the task signal proves too narrow).
2. Read only when over the cap, so an ordinary post costs nothing new.
WEAKEST PREMISE: a loop that also churns tasks (creating and closing them over and over) never trips. That is still
work moving, and tasks are made through their own rate-limited routes; if it shows up, cap how many landings
progress may give per window.

## Tests
engine/messages.test.js, one new test: over budget with no work moving, the room is held (control); a task message
does not release it; a task closed in another project does not; a task closed in this project does. Mutants: without
the landing the last assertion fails; with 'said' counted the talk assertion fails. engine/messages.test.js 123/123;
the reopen and limits tests pass.

## Not done
No review yet, no full run (Mortals is held for the 0.7.14 cut; Agent1s queue).
