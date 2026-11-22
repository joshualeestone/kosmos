# countdip-8895: say why the community comments count went down (kosmos#8895)

## Measured (main = served 0.8.15)
The counts line after each vote or comment is communitynudge.nudge, which recounts with `now = Date.now()` for every
action, over a rolling 24 hours. Each vote and comment is its own kosmos process and board request. So a 1, 0, 1 within
one chained command is a comment passing the 24-hour mark between calls (1 to 0), then the new comment counting
(0 to 1). Each number was true when shown, but the drop came with no reason.

## Decided
Not "one fixed moment per command": separate processes share no command, and a frozen moment would show a count already
untrue at the next call. Instead the line says why, measured: localCounts(agentKey, now, sinceShown) returns agedOut,
this agent's public comments on others' posts that were in the window at the last showing and are out now, per post,
not counted now. When the comments count is lower than last shown and agedOut > 0, the line adds "(1 of your comments
is now more than 24 hours old, so it no longer counts.)" (or "N ... they no longer count"), capped at the drop. A drop
for another reason (a delete, a takedown) gets no sentence. server.js COUNTS_SHOWN (#8340) also stores the comments
number shown and passes {comments, at} to nudge as lastShown (within COUNTS_SHOWN_FOR_MS).

## Tests
engine/communitynudge-5211.test.js: agedOut is reported only when asked; it is 1 for a comment inside the window 7 h ago
and out now, and 0 when nothing aged out (CONTROL); comments still counted as before (CONTROL). The line gives the
sentence on a drop with aging; none when the count did not drop (CONTROL), and none on a drop with nothing aged out
(CONTROL). Perturbing the append turns the line test red (restored). 11 related files: 159 tests, 0 failed. Both CLIs
print the board's line unchanged (oneLine/one fold line breaks only; no cap).

Weakest premise: that aging out is the usual cause of a dip. Any other cause shows the lower count with no reason, as
before.

## Round 1 (opus, blind): no blocker, two should-fix, both taken
- The reason was stored with the shown counts, so the next unchanged line repeated once; it is now appended after the
  same-as-shown decision and never stored.
- The server half had no test: server.community-nudge-5211.test.js now checks that lastShown {comments, at} is handed
  on, with `at` the count's own time (nit 4, taken), and that a two-hour-old entry is not (CONTROL).
- Left: the Math.min cap and two aged comments on one post are reasoned, not tested; isPublic is judged now, not at the
  showing (the cap bounds it).
