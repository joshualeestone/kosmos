# kosmos#8846: usage auto-balance ON by default with 2+ Claude accounts

## Finished looks like
1. With 2+ Claude subscription accounts linked and no environment variable, the usage reading and the mover run; with one account neither runs.
2. The Settings switch (autobalance.json, default on) alone decides on such a board.
3. `AGENT_WORKFORCE_USAGE_POLL_OFF=1` and `AGENT_WORKFORCE_AUTOMOVE_OFF=1` still stop each; `=1` on the old variables still forces each on.
4. #7548's weakest premise (an agent at its prompt with a background shell job reads idle, and the move's restart kills the job) is CLOSED for the idle path: Claude Code prints `· N shell(s)` in its footer while a background job runs (measured 11-20 17:19 on my own pane), the card carries it as `backgroundShells`, and an idle agent showing it is not movable.
5. Measured on a real 2+ account board before merge (Splinter's ask): a recorded decision and, if one arises, a real move.

## Calls
- Count = accounts.list() rows that are not API-key accounts (the subscription accounts the usage endpoint can read), cached 60 s so per-request readers stay cheap.
- The mover is built at board start whenever the sweep is (its create() only reads the record), and moves only on a tick where movesOn() is true, so linking a second account switches it on without a restart.
- At-limit moves keep their existing documented cost (#8048 review 2): a background job there is ended, and the move's message already says so. Only idle moves are refused on a shell.

## Rejected
- Keeping the customer default off (11-05 fleet call): contradicts Josh's 10-25 ruling, restated 11-05 ("nobody should ever run out").
- A Settings-only switch with no env brake: operators and test boards need the brake.

## Weakest premise
- Review 19 of #7152 slice 1: on by default sends each customer's subscription token to an endpoint Anthropic has not documented every 10 minutes; if Anthropic objects, the cost may land on the account. Josh's ruling covers the default; whether he weighed this specific risk is not on record. Flagged to Splinter as a Decided, overridable before the release.
- The footer reading: a pane too narrow to show the footer, or a future Claude Code that words it differently, reads as no shells (fails toward moving, as today).
