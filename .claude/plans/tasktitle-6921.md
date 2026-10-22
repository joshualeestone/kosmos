# tasktitle-6921: an over-long task title is shortened, not refused (part 2 of #6921)

Card: joshualeestone/kosmos#6921 (agent feedback 2026-10-22 13:14). Part 2 ships alone, as the card allows.

## Done means

`kosmos task add` (or the API) with a title over 200 characters adds the task: the title is shortened, the whole
original title is first in the detail, and the answer carries a note saying so. A test fails if the add goes back to
refusing.

## Decision

Shorten and move rather than warn before submitting. A warning still costs the agent a retry, which is what the
report asked to stop; moving loses nothing, because every word is kept in the detail.

- Cut at the last space that leaves room for "...", or hard-cut when one word is longer than the cap; by code point,
  so a surrogate pair is never split.
- Whole original title first in the detail, then a blank line, then any detail that was given.
- If that makes the detail pass its 2000 cap, the add is still refused, with a message naming both caps.
- In tasks.create, so the CLI and API paths get it. The screen's box already stops at 200. The webhook route keeps
  its own refusal (server.js, before tasks.create; pinned by server.webhooks-1307.test.js): a webhook caller gets clear
  wording and has no note channel to hear that a title was shortened.
- A detail that is not text stays refused, whatever the title's length.
- A title whose only space comes early is hard-cut instead, so the cut never leaves a near-empty title.
- The note goes first in the add's answer, so #5319's copyable command stays the end of the line. No double quote or
  backslash in it (the macOS CLI lifts it with sed).

Rejected: truncating silently (the agent would not know words moved), and raising the cap (the board, room lines
and cards are laid out for a short title).

## Weakest premise

That an agent reads the detail. A long title usually means the agent put the instructions in the title, and they are
now in the detail, where an assignee may not look first.

## Part 1, not built here

The card's other ask, warning when an open task or a recent claim already matches, is mostly already built:
#5319 names an open task with the same text, and #6083 names a near title added in the last 10 minutes, for the same
parent and people. What is missing is a match against a claim that is not a task. That needs a definition of a
claim, recorded on the card as the open half.
