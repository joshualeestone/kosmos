# whatsnew-0829: What's New for 0.8.29

The gap alarm (kosmos#1050), 2026-11-27 13:26 CST: main 72 commits past staging 0.8.28.

## The change
- Adds the window line for #9217 (PR #9225, slice 1): the board's top notes now name a heavy job an agent said is
  running on this computer, whose it is and since when (`paintHeavyJobs`, web/index.html). Title "The board says when
  a heavy job is running" (42), line 120 characters, rank 10.8, since 0.8.29, untagged: web/index.html is the board
  page every platform serves, and `kosmos heavy` is in both CLIs (install/kosmos and tools/windows/kosmos-cli.js).
- A notes-only line for the agent command itself, `kosmos heavy start | end | list` (rank 158).
- Shortens a title I added in #9215 from 54 to 47 characters ("kosmos project show says when no agent is on it"). The
  window's title limit is 48, and `build` checks every pending line against it, notes-only ones too, so the 54-character
  title refused this build. #9215's checks never ran `build`, which is how it merged.
- Builds the 0.8.29 window: one highlight (the heavy-job line). Prod and Windows prod 0.8.28 were already recorded
  (#9215), so nothing is newly marked shown.

## Checks
- `whats-new-check 0.8.29`: mac 1, windows 1. prod-check exit 0. `notes 0.8.29` exit 0 on mac, linux and windows.
- What's New tests by name (check-3955, pool-5711, pool-sync-5713, pool-win-8924, web.whatsnew-3955,
  web.whatsnew-phone-7839): 74 pass, 0 fail.

## Rejected
- Cutting 0.8.29 with no window again: #9217 is a board change people will see, so it gets its line.
- Waiting for #9217's author to write the line: the line is mine, from the PR body and the code; they can reword it.

## Weakest premise
That the note reads the same on Windows. It is the shared board page and both CLIs have the verb, but no Windows run
of the note is recorded on the card.
