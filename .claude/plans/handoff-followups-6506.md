# Plan: the three deferred #6506 follow-ups (one small PR)

## Goal (what is true when done)
The follow-ups deferred from the two #6506 PRs are shipped as one small PR:
1. An unreadable self-report reads "could not read the self-report (<reason>)", not the
   self-contradictory "never reported (<reason>)" (Raiden's #6532 note 1, his wording).
2. The instruction freshness line is reliable when an agent's tmux session name differs from its
   sessionName: `instructionFact` passes the real tmux session as `exactSession` to
   `instructions.staleness`, the way the roster passes `card.session` (Raiden's #6532 note 2).
3. `kosmos handoff` passes the tasks response body to node on stdin, not an environment variable, so
   a large task list never rides an env var (Liu Kang's #6544 note).

## Why
All three are non-blocking points raised in the #6506 reviews and deferred to keep those PRs to
their reviewed scope. Liu Kang asked for them as one small follow-up PR, still on #6506.

## What changed
- `engine/handoff.js`: `stateFact` distinguishes a never-reported agent from a record that exists
  but cannot be read. `instructionFact(session, now, exactSession)` passes `exactSession` to
  `staleness`; `render` threads `opts.exactSession`. The CLI entry reads the tasks body from fd 0
  (stdin) rather than `KOSMOS_HANDOFF_TASKS_BODY`, and reads `exactSession` from
  `KOSMOS_HANDOFF_TMUX_SESSION`.
- `install/kosmos` `cmd_handoff`: resolves the real tmux session from `$TMUX_PANE` (pinned with
  `-t`) and passes it by env; pipes the task body on stdin; keeps `reached`/`status` as small env
  scalars.
- Windows `verbHandoff`: unchanged, correctly omits `exactSession` (no tmux) so the reader falls
  back to the name-derived spellings, and still passes `tasks` through render opts (note 3 is the
  Mac stdin path only).

## Finished looks like
- `node --test engine/handoff.test.js cli.handoff-6506.test.js tools.windows-kosmos-cli-handoff-6506.test.js server.tasks-mine-6506.test.js` green, with the three new cases (unreadable self-report wording, exactSession threading, a large task list over stdin).
- help-lines + verb-parity + #3628 stay green.
- Full local `tools/run-tests.sh` green on the PR head; CI green by name.
- Raiden's review, no blocker.

## Weakest part of my own reasoning
Note 2's fix resolves the tmux session from `$TMUX_PANE`; if that env is absent or tmux is not
present, it falls back to `undefined` (the name-derived `[name-discord, name]` spellings in
`sessionStartedAt`), which still will not match a tmux session whose name is neither of those. That
residual is inherent to what the CLI can know without the roster, and matches Raiden's own note that
"the CLI environment may not carry the precise session id"; the `editedAt` fact (the card's actual
ask) is correct regardless, and the freshness line is a secondary precision nicety.
