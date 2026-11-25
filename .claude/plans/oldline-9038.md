# oldline-9038: an old sign-in line on an idle screen stops recording refusals for a repaired account (kosmos#9038)

## Problem
An agent repaired off-screen keeps Claude's old sign-in line in its bottom rows until its next turn. The account check reads
HEALTHY, so the card is calm, but a HEALTHY is kept 30 s: every re-check tick reads UNCHECKED, the card reads Sign-in Issue
for a moment, and a refusal is recorded against a working account (about every 35 s).

## Call
Two times, never the screen's text (engine/oldsigninline.js):
- when the agent was last refused: the last conversation row of the session its own process names
  (<config folder>/sessions/<pid>.json, then that session's transcript), and only when that row is Claude Code's own
  `authentication_failed`. A new turn, a new refusal, a /clear or a restart changes it at once;
- when a person last signed in: the login's own date moved LATER; the moment kept is the start of the last read that gave the
  earlier date (claudeloginlive.signedInAfter).
Refused before that moment, and the last settled check HEALTHY within one re-check: the re-check tick reads HEALTHY.
Every doubt is as before. The process, its pid and its CLAUDE_CONFIG_DIR are read from tmux and `ps` once per run of the
agent, asynchronously; another login (#2129, #6095), a credential that outranks the login, or no environment shown: never.

## Rejected
- Trusting the last HEALTHY: took the badge off a revoked account (#9031, round 2).
- The line's text, its neighbours and their count (built, two reviews): two refusals can be the same on a screen, one
  unread capture ended it for good, and each guard left another way through.
- Skipping the rows `/login` typed in the pane leaves: a refused command leaves the same shape.

## Left, declared
- A repair typed in the agent's own pane (its rows follow the refusal), or a turn since: as on main.
- A sign-in before the board has read the earlier date, or before a restart of the board: as on main.
- A date that could not be read once is asked for again after 10 minutes (claudeloginlive's MISS_CACHE_MS).
- Credentials swapped by hand to a later date and back read as a sign-in.
- macOS only, where the login date is read (the Keychain). A session with no run instance: as on main.
- A refused agent costs one `security` read a minute, and one tmux and two ps calls a run (a minute, while its login
  cannot be told), and a look in each project folder on a re-check tick once a sign-in has been seen.
- A token or key set in a settings file's `env`, or an `apiKeyHelper` set there by hand: not looked for, as the account check does not.

## Weakest premise
That a renewal never moves the login date later (Math.min in Claude Code 2.1.327 to 2.1.332, not guaranteed by Anthropic). If one did, a
refusal from before it would read old while the check says HEALTHY. Second: that Claude Code goes on writing
sessions/<pid>.json; without it nothing is cleared. Measured 11-25: 21 of 21 live panes here have it, and 27 real
transcripts end in a refusal this reads.

## Test
engine/oldsigninline-9038.test.js, 28 tests, most through the real snapshot(); 55 mutations, all red.
