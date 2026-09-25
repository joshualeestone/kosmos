# #3686: the #1782 concurrency test reads a busy refusal as a lost token

## Finished looks like
engine/sendertoken.test.js "#1782: N CONCURRENT PROCESSES" goes red only for a lost token (a mint that reported ok
missing from the store), or for a run that minted fewer than two, with a message saying which. A mint that safely
refused on a busy lock (ELOCKBUSY) is counted as contention, not as a loss.

## Decided
- Test-only change. Production already surfaces a refused mint: server.js answers 500, win32create.js returns
  tokenBecause, and adopt.js records "mint failed". bin/agent-supervisor.sh deliberately launches without a token,
  because a missing token costs attribution and a broken launch costs the fleet.
- Rejected: raising AGENT_WORKFORCE_LOCK_MS so refusals stop. That only moves the load at which it flakes and
  hides the distinction.

## Weakest premise
That ELOCKBUSY in `because` is the only busy refusal. Review read filelock.js: busy uses opts.busy (LOCK_BUSY);
the other refusal is cannot-access, which is a real failure and still reds.

## Verification
Negative controls on sendertoken.js, restored after each:
- The lock removed (the #1782 defect): red 3 of 3.
- Half the launches refused busy: green.
- Every launch refused: red, with the floor message.
