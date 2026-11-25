# quoted-9083: "Not logged in" printed by a command is not the agent's own sign-in failure (kosmos#9083)

## Problem
#9031 made "Not logged in", with the remedy on the row, a sign-in failure. A command or tool that prints it (a `claude -p` in a folder
with no login, a log) left it in an agent's bottom rows, and the agent read auth_failed and its account got a refusal.

## What real screens show (Claude Code 2.1.332, 11-25, made-up token and none, inline as agents run; test-support/claude-screens/signin-*)
- Its own "Not logged in" is drawn with `⎿` under the prompt, the SAME mark output has. A refused token is a `⏺` row.
- Output sits under a `!` command or a `⏺ Tool(` head.
- While logged out Claude Code also ends a row by the box with "Not logged in · run /login", which the quoted screen does not have.

## Call
The row is output only for this one sentence, only in the FIRST `⎿` block of a `!` command or a `⏺ Tool(` row (a capital letter, or an
MCP tool), with nothing between (no blank row, no second `⎿`, no row at the left edge), and only with no "run /login" notice anywhere
on the screen in any form. Everything else, every other sentence, and no head in sight, are read as before: a real refusal dropped is
worse than a quoted one kept (#1884). Round 1's rule was looser and dropped refusals under other heads and after other rows.

## Rejected
- The card's fix (refuse `⎿` rows): it would have hidden the real refusal.

## Left, declared
- An agent's own prose quoting the whole line (`⏺ ...`), as #1884 pinned.
- The other sentences quoted by a tool, as before #9031.
- Part 2 of the card (usagepoll's identity check first): it asks Anthropic with the token, which an ended login does not have, so there
  is nothing to check it with. Left as it is.
- A tool drawn another way (`⏺ Running 1 shell command…`, an undrawn dot) keeps reading as a refusal, as today.
- A fresh session in a pane taller than 25 rows reads a refusal as unknown (the rows below the box are blank): not from this, seen
  while capturing; agents run in 24 rows.

## Weakest premise
That Claude Code does not draw its refusal as the first `⎿` of a tool block with no notice on the screen (a login lost while a tool
runs was not measured). Then a real refusal would read as output until the next prompt.

## Test
engine/signinquoted-9083.test.js, 5 tests on the real captures and shapes; 16 mutations, all red.
