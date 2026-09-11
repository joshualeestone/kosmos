# tasks-copy-2708: state the honest task fact, do not promise "any tasks" when there are none

Card: joshualeestone/kosmos#2708 (josh-review, from the Mortals "Kosmos Inside Out"
dogfood). Branch: tasks-copy-2708.

## Problem

The "Your projects" hand-off promises the section includes "any tasks", but the
per-project block unconditionally teaches `kosmos task list <id>` "to see them" even
when the project has zero tasks. An empty result is then indistinguishable from a
broken promise. Two verified causes: (a) "including any tasks" copy shipped ahead of
the task verb on 0.6.54 (historical now: #2680 landed the verb on every build in
0.6.55), and (b) the project genuinely had zero tasks.

## The fix (engine/projects.js)

1. Per-project block (~2216, the block #2680 added): condition the task line on the
   honest count the board already has (`p.tasks`, populated from `project.tasks`):
   - has tasks: keep "Its tasks: `kosmos task list <id>` to see them, `kosmos task add
     <id> ...` to add one" (there ARE tasks to see).
   - zero tasks: "No tasks set for this project yet. Add one with `kosmos task add <id>
     \"what needs doing\"` (use this, not a hand-rolled task-board file)." - a fact, not
     a promise of something to see that is not there.
2. `membershipLine` (~2435): drop the generic "including any tasks" promise; the section
   now states the honest task state, so the one-time membership message just points at
   it ("The 'Your projects' section of your instructions has the details.").

The task verb is present on every current build, so no build-lacks-verb conditioning is
needed; the live defect is the count-0 copy.

## Verification (headless, no browser)

engine/projects.test.js already asserts the injected block teaches `kosmos task
list/add` for a project WITH tasks. Add an assertion for a project with ZERO tasks: the
block says "No tasks set for this project yet" and does NOT say "to see them". Plus a
membershipLine assertion that it no longer promises "including any tasks". Both are pure
engine tests (the block is composed server-side).

## Weakest premise

That `p.tasks` empty means "no tasks to point at" for the copy's purpose. If it holds
open+closed, empty is genuinely no tasks (correct). If it holds only open, a
closed-only project reads "no tasks set yet", which is still honest ("nothing to do")
and strictly better than promising a list that is empty.
