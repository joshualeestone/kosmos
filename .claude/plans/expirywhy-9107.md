# expirywhy-9107: follow-ups to #9097's off-macOS login expiry reader (kosmos#9107)

**Posture:** production (the board on Windows and Linux). **Status:** what has run is on the card (kosmos#9107).

**Finished looks like:** off macOS, a board that shows no Claude login warning says why in its log, once per kind, with
no path or name; and the #9097 guards test's control finds the real file however the home is spelled in case.
Items 3 and 4 are NOT in this branch (below).

## Decided
- Item 1, the words: four kinds (a named account with no folder, a sandboxed board, no readable home, a folder outside
  the home), each said once per board run through `console.error` like communitysend's `logOnce`. No path in any line,
  since a path can carry the user's name. The `node --test` refusal says nothing: only a test run meets it, and nobody
  reads a board log there. Under `node --test` the default log is silent; tests set their own.
- The "account" line cannot be reached through the board's own calls, which derive the account from the folder; it
  covers a direct caller that names an account, as the #9097 review asked. Kept for that.
- Item 2: the guards test compares the real file resolved, and without case on Windows and macOS (case-insensitive
  file systems), instead of by the exact string.

## Item 4 taken out (decided 11-26, after five review rounds)
A background read of the credentials file (so the snapshot never waits on a stalled network home) was built and
reviewed five times. Each round found a real defect in it: a sign-in kept the old notice (#5018 again), a torn or
locked file hid the warning, a read slot could be counted out twice, and in round 5 that with three or more accounts
the ones after the first two were never read again, because reads start only when the advisories recompute (every
5 minutes) and the first files in pane order always took the two slots. The loop was finding defects in its own fixes.
**So item 4 is not in this branch: the read stays synchronous, as on main.** It is right for a local disk; it blocks
only on a home on a stalled share, which nothing here has measured on a real board.
A version that works needs, at least: reads started from the completion of the last one (a queue, not the recompute's
order); a time bound that frees a stalled read's slot; a recompute when a read lands, not at the next 5 minute tick;
and a test that drives `computeLoginAdvisories` with more accounts than slots across several rounds. Left on the card.

## Weakest premise
- That a stalled network home on Windows is rare enough for item 4 to wait. If one is seen, the card lists what the
  fix needs.

## Not done here
- Item 3 (compare the launch job's folder with a running Windows agent's own CLAUDE_CONFIG_DIR) needs a Windows box with
  one agent per account. Not measured; it stays open on the card.
