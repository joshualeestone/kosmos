# Plan: Trim the oversized "has not come up" agent error copy (kosmos#2193)

## Problem
Josh (0.6.30 test): the message shown when an agent was set up but has not come
online is "a big ass error message". Cut it to the essentials.

## Current copy (non-partial branch of made-warn, in watchForAgent)
"It was set up, but nothing is running under that name yet. The folder and the
instructions are on your computer either way. It may still appear under Agents on
its own: this screen stopped waiting, it did not stop it. It is set to keep trying
at every login. Its folder is <path>. If it appears under Agents, you can remove it
there. If it never appears, we cannot clear it out for you yet." (~5 sentences)

## Approach
Trim to 2 sentences, keeping only the essentials:
- KEEP: the bold status line Josh quoted; "it keeps trying at every login" (which
  ALSO conveys the agent was NOT stopped, so the old "this screen stopped waiting,
  it did not stop it" sentence is redundant); WHERE the folder is; how to remove it.
- DROP: "the folder and instructions are on your computer either way"; the
  stopped-waiting sentence; the "if it never appears we cannot clear it out yet"
  caveat.

New (with folder): "**It was set up, but nothing is running under that name yet.**
It keeps trying at every login. Its folder is `<path>`; if it appears under Agents,
you can remove it there."

## Constraints preserved (load-bearing)
- The PARTIAL branch is untouched -- it still shows its own reason (a prior bug
  overwrote a partial's true reason with the generic copy; must not recur).
- The folder comes from result.folder (the ANSWER), not a path built in the page.
- esc(result.folder) is kept (no XSS).
- Removal stays CONDITIONAL ("if it appears under Agents") because the board is
  built from live panes -- an agent that never came up has no card (kosmos#127).

## Scope
web/index.html (the non-partial made-warn copy + a nearby design comment that cited
the removed sentence). The browser check docs/browser-checks/render-made-endings.js
updated to assert the new copy and that the verbose lines are gone.

## Verification
- Browser check render-made-endings.js: asserts keeps-trying, folder named,
  conditional removal, and the three verbose phrases absent. It reds on the old
  copy and on a regression that drops the folder/removal. (It runs at the release
  browser gate against the driver's board; a standalone run needs that board's
  connected-account create flow.)
- Full test suite (node --test) unaffected -- no unit test pinned the old copy.

## Decisions
- Trim per Josh's directive; wording is a reversible call, documented here and in
  the code comment. Dropping the #127 "cannot clear it out" caveat is honest by
  omission (the copy never promises removal it cannot perform).

## Out of scope
- The kosmos#127 gap itself (no route to remove a never-appeared agent) is
  unchanged; only the copy about it is trimmed.
