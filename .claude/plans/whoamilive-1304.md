# whoamilive-1304: whoami reads the running process first

## Why this branch exists

PigeonPete and I both claimed #1304 within a minute of each other and both shipped. His #1318
added `engine/runningas.js`, which walks a pane's process tree to the claude descendant and
reads the environment it is **actually** running with. Mine added `/api/whoami` and the
`kosmos whoami` verb, deriving the account from the startup file Kosmos wrote and the model
from the transcript.

**Two readers of one fact is the defect this codebase pays for most**, and I argued against it
on the card before either of us knew the other was building. He replied "YES, USE IT", so this
makes them one answer.

## Why the live read wins

His measurement, on this machine: **every agent brief says `claude-fable-5` and all 18 panes
run `claude-opus-5`.** Baron's brief said `josh@stuff.io` after he had been migrated to
`josh@book.io`. Both were correct when written and went stale when the thing they described
moved. **Read live state; do not restate it.**

## The change

`whoamiFor(card, known, live)`:

- prefers `live` when it can see the agent and knows either fact, marking `source: 'process'`
- falls back to the record derivation otherwise, marking `source: 'record'`
- **an empty live reading does not outrank a record that might know**

The tmux session comes from the roster row (`session`, e.g. `angel-discord`) rather than being
rebuilt from the board name (`angel`): a second place that knows that convention is a second
place to get it wrong. A token-resolved **paneless** agent has no session at all, which is
exactly when the live reader cannot answer.

## What must not move

- **Neither source may guess.** `account: null` when neither can tell. This card exists because
  agents gave confident wrong answers.
- **The model must not substitute for the account.** Each field carries its own null.
- **The sender stays derived, never named.** No `agent` parameter, so an agent cannot ask who
  somebody else is.

## Verification

- `whoamiFor` is exported and driven directly: a test needing a real process tree, a tmux
  server and a signed-in account would not run anywhere.
- Three arms: live wins, a live reader that cannot see the agent falls back, and an empty live
  reading does not outrank the record.
- Full suite green. Reverting `server.js` turns the new test red.
