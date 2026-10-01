# clihelp-4785: kosmos --help says what each command does; agent list points at kosmos agents

Card: kosmos#4785 (daily feedback, two installs, 2026-09-30).

## Finished looks like
- `kosmos --help` (Mac and Windows) prints one row per command with a few words on what it does.
- An agent that types `agent list` / `agent ls` after `kosmos` is told `kosmos agents` in the same answer.
- Exit codes unchanged: --help 0, bare `kosmos` 2, unknown command 2, unknown agent subcommand 2.

## Decisions
- **Pointer, not alias.** An `agent list` subcommand would have to exist on Windows too (the parity test), and the
  Windows command has no agent listing. Rejected: alias on Mac only (parity red, and two platforms answering the
  same words differently). Weakest premise: that one extra step (reading the pointer) is acceptable; the card's
  "sent to the right command in one step" is met by naming it in the answer.
- **One list, printed by --help and by an unknown command** (kosmos_command_list), so the two cannot disagree.
- **Windows rows use the Mac's words** for every shared verb; a test holds them equal.
- The parity test's help reader now reads the rows instead of the old `a | b | c` line.

## Validation
- cli.help-lines-4785.test.js (new), cli.help-flag-1674, parity, windows-cli-570, agent tests, test-kosmos-help-exit0-3036.
- Controls: dropping a row, removing the hint, hinting on every unknown, and a Windows word drift each red the new test.
