# kosmos#8659: Windows Codex upgrade (#8593) follow-ups

## Finished looks like
On a Windows box where the check for a running agent is slow, the Codex upgrade's last look before the swap no longer
times out on every try; when it does run out of time the board log says that, not an ordinary "could not check". The
three code nits are closed. The cross-version resume check is recorded on the card as owed, with what it needs.

## Change
1. engine/runners.js: `lastLookDeadlineMs(slowestMs)` = three times the slowest earlier look on this machine that
   answered, at least 5 s, at most 20 s. `waitForAgents` measures each look; the marker-down look uses the result.
   A look that ran out of a deadline it was given ends the job with "the last check ... did not answer within N s".
2. Same file: when the marker cannot be put back after the last look, `console.error` and say the version reads absent
   until the next install (was a warn).
3. engine/runnerupgrade.js: a comment that the try is handed back only through `settled`, and that every job has it.
4. engine/codexhooks-5812.test.js: a content check of the Windows verified list (the identity check could not see a
   Mac-only version copied in).

## Decided, and rejected
- Rejected: keeping the unpacked `pkg.new` tree across a timed-out last look. It needs a lifetime for a ~300 MB tree
  across ticks and a second "reuse" path into the swap; an adaptive deadline removes the repeat at its cause.
- Rejected: counting repeated last-step waits. The runner-upgrade line already says each wait, and now its reason
  names the timeout.
- 20 s ceiling: while the last look runs, agent turns wait behind the swap lock. 20 s of held turns once per upgrade
  is acceptable; more is not.

## Weakest premise
That the earlier looks predict the last one. The last look runs with more of the machine busy (an unpack just
finished), so it could be slower than any earlier look; three times the slowest is the margin for that.

## Not done here
- The cross-version resume (0.169.0 resuming a 0.149.1 thread on Windows) needs a box with a signed-in Codex agent;
  stays owed on the card.
- writeUpgradeStamp's Windows reader: no card exists for a Windows port of the #8598 restart sweep yet.

## Tests
- engine/runners.win32-upgrade-8593.test.js: the deadline rule (every platform); Windows-only: slow earlier looks give
  the last look room; a last look with no answer names the timeout. The existing arm pinning 5 s after fast looks
  still holds.
- engine/codexhooks-5812.test.js: the Windows list's content.
