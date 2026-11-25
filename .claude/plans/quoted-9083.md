# quoted-9083: "Not logged in" printed by a command is not the agent's own sign-in failure (kosmos#9083)

## Problem
#9031 made "Not logged in", with the remedy on the row, a sign-in failure. A command or tool that prints it (a `claude -p` in a folder
with no login, a log) left it in an agent's bottom rows, and the agent read auth_failed and its account got a refusal.

## What real screens show (Claude Code 2.1.332, 11-25, made-up token and none, inline as agents run; test-support/claude-screens/signin-*)
- Its own "Not logged in" is drawn with `⎿` under the prompt, the SAME mark output has. A refused token is a `⏺` row.
- Output sits under a `!` command or a `⏺ Tool(` head.
- While logged out Claude Code also ends a row by the box with "Not logged in · run /login", which the quoted screen does not have.

## Call
The row is output when, for this one sentence, its nearest head is a `!` command or a `⏺ Tool(`, and that footer is not on the screen.
Every other sentence, and no head in sight, are read as before: a real refusal dropped is worse than a quoted one kept (#1884).

## Rejected
- The card's fix (refuse `⎿` rows): it would have hidden the real refusal.

## Left, declared
- An agent's own prose quoting the whole line (`⏺ ...`), as #1884 pinned.
- The other sentences quoted by a tool, as before #9031.
- Part 2 of the card (usagepoll's identity check first): it asks Anthropic with the token, which an ended login does not have, so there
  is nothing to check it with. Left as it is.
- A fresh session in a pane taller than 25 rows reads a refusal as unknown (the rows below the box are blank): not from this, seen
  while capturing; agents run in 24 rows.

## Weakest premise
That the footer is always drawn while logged out. If it were not, a real refusal under a tool head would read as output.

## Test
engine/signinquoted-9083.test.js, 4 tests on the real captures and shapes; 12 mutations, all red.
