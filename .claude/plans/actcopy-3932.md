# actcopy-3932: the project notice's file-fix rows go back to Mona's Act shape (#3932, page half)

## Why

#3932's server half (PR #4179, 86ee3f8e) re-tells an agent by itself once its instruction file
changes: a stopped agent at once, a running one after it restarts. So the four rows that ask the person
to fix the file no longer need "then try again" and a Try again button. That button was only there
because nothing else re-told the agent (#3923). Mona's design (#3923 card, table row "Act"): a sentence
only, "Give April some instructions and it will pick this up next time", with no button.

## The change

- web/index.html PJ_NOTICE: the four file-fix rows (no instructions file, several Kosmos project
  sections, too short, at the size limit) become shape `act`. Their fix now reads "..., and Kosmos will
  pick this up when <name> next starts." The renderer draws a button only for wait and retry, so act
  gets none. The header comment names the ACT shape.
- The two rows that are not file changes keep Try again ("Start X, then try again", "Restart X from
  Kosmos, then try again"): the sweep only acts on a file change.
- web.project-notice-3923.test.js: the Act row has no button and all four carry the promise; the
  several-agents count is 1 (leo), not 2.
- docs/browser-checks/render-projects.js: the #3923 retry pass branches on the row's shape. With
  claudebot running, the fixture's reason is "no instructions file", an Act row with no button. That
  branch is asserted by its promise text, never skipped. The #3948 rail must mirror the main notice's
  button count, which it already compares.

## Why the copy says "when <name> next starts"

It is true for both paths. A stopped agent is re-told at once and reads the file when it starts. A
running agent is re-told after it restarts, which is when it reads the change. "It will pick this up
next time" in the mock is vaguer; the card's decision says the copy must not promise that a running
agent's row clears by itself.

## Weakest premise

The promise depends on the live-execution opt-in: the sweep is inert before it. A board with live
execution off would show a row whose promise nothing keeps. Checked: the sibling sweeps and the whole
Act path share that gate, and live execution is on for any board that runs agents.
