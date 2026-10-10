# kosmos#5805 slice 1: hold automatic lines for a Claude agent paused on a dated usage limit

From feedback: an agent out of weekly usage kept getting messages marked delivered, and two days of requests were lost.
Kosmos already reads a capped Claude card (status.js RATE_LIMITED), but nothing held messages for it: automatic lines
(colleagues' room posts, the room's reply reminder, nudges) were typed into the limit screen and counted as delivered,
and the room reminder is sent once only.

## The slices (decided; this PR is slice 1)
1. Engine: a timer's or colleague's line to a Claude agent capped with a DATED reset ahead is held until the reset; a
   room post held this way is told once the member's card reads idle again.
2. A person's message and `kosmos msg` to a capped agent: held, the sender told, delivered on reset. (They bypass every
   hold today; the lost go-ahead in the report was one.)
3. The card says "out of usage until <time>", including the dateless 5-hour form (needs a first-seen time).
4. Reply reminder: let an agent declare its reply channel.

## What changes
- engine/chat.js: `limitHeldVerdict` (exported) returns the #4588 hold shape with heldBy 'limit' and heldUntil = the
  reset, for an addressable Claude card in rate_limited whose stateEvidence has a dated reset still ahead
  (status.limitResetAt). deliverAutomatic and deliverAutomaticAsync check it after the menu hold.
- engine/messages.js: a room post the limit held keeps its normal mark (addressed when it names the member, plain
  otherwise), and its reset is recorded with roomhold.noteLimit. staleHeld also reports `answered`.
- engine/roomhold.js: `<member>.limit` beside the held file records, per project, the posts a usage limit kept and the
  reset (noteLimit, at a post's arrival and at an idle flush the limit held; entries a day past their reset are pruned;
  forget removes it). withoutStale keeps such an ask that names the member until a day after the reset, unless the
  member answered it.
- engine/roomhold.js: flushReleased takes `isLimitable` and retries a non-Antigravity member only when that predicate
  passes and it holds a post that names it.
- server.js: isLimitable = chat.limitable(card) (the hold's own test) and the card reads `idle` off its screen.
- engine/replynudge.js, agentnudge.js, firstreply-nudge.js, server.js (hello route): a 'limit' hold is logged as
  limit-held, "held while it is out of usage", never as the Google quota.

## Decided
- Hold only on a DATED reset ahead. A dateless limit line (the 5-hour form) stays on screen after its reset until
  something is typed; holding on it would mean nothing ever wakes the agent. The weekly form is the reported case.
  status.retireResetLimits already drops a dated line after its reset, so the card leaves rate_limited by itself.
- A limit-held room post keeps its normal mark, so the agent is told it was named. The minute retry for a Claude
  member looks only for posts that name it, and only while its card reads idle off the screen; a member holding only
  posts that ask nothing of it waits for its next wake. This also retries an addressed #4624 hold an idle Claude member
  never had flushed (it is idle on screen, so typing is what the idle flush would have done).
- The day rule (#4926: a pause of days does not deliver days-old asks) is kept for every other hold. For a usage-limit
  hold, an unanswered ask that names the member is kept until a day after the reset, recorded beside the held file so
  it covers a post first held while the member worked and only limit-held at its turn-end flush (a post row is
  append-only and is written before that).
- The retry for Claude members runs only while the card reads idle off the screen, never while it reads capped or
  busy, so it does not rewrite the held file every minute of a pause (#4797) and never types into a working agent.
- A person's own message is not held here (slice 2).

## Residuals, stated
- In the minute after a printed reset, status may still read the card capped while the hold has lifted, so a line typed
  then can still land on the limit screen and count as delivered (about one minute per limit).
- Windows agents run headless; whether their cards ever read rate_limited is unmeasured (slices 2 and 3).

## Weakest premise
That a capped Claude card's stateEvidence is the limit line with its reset. It is the line classify() matched; if a
future Claude Code wording moves the reset to another line, limitResetAt finds nothing and nothing is held (the old
behaviour), never the reverse.

## Tests (engine/limithold-5805.test.js)
- Real limit screens: a dated reset ahead holds sync and async (heldBy limit, heldUntil the reset, nothing typed); a
  dateless line and a past reset are typed; a person's message is not held; a codex card is not held by this gate.
- Room: a colleague's post that names a capped Claude member is held with the cap's mark, not retried while capped, not
  retried without the predicate (CONTROL), told once when idle; a plain #4624 hold on an idle Claude member is not woken.
- Red without the change: 3 fail (the 3 controls pass).

## Review 1 (opus)
- FIXED (BLOCKER): a limit-held ask older than a day was dropped at the flush by staleHeld's day rule; it now counts
  from the reset for limit holds only (tested with the real staleHeld, and the quota control unchanged).
- FIXED (BLOCKER): the cap mark made a post that named the member read "Nothing is asked of you"; limit holds keep the
  normal marks and the retry looks for addressed posts (the told line is asserted).
- FIXED: four senders called a limit hold the Google quota; they say limit-held (tested for firstreply and agentnudge).
- FIXED: the retry no longer wakes a member for posts that ask nothing of it (those stay unmarked and wait).
- FIXED: the room test's stale stub bypassed staleHeld; it uses the real one. NITs taken: the same isNamedOurs test in
  the hold and the retry; the reset-grace minute is commented.

## Review 2 (sonnet)
- FIXED: a post held while the member worked and limit-held only at its turn-end flush had no record of the limit, so
  the day rule still dropped it. The limit is now recorded at both points in roomhold's `<member>.limit`, and
  withoutStale keeps back an unanswered ask until a day after the reset (tested: the flush path, answered, grace past,
  another member, a plain post). This replaced a `heldBy` field on post rows, which the flush path could not write.
- FIXED: replynudge's limit-held arm is tested. NITs taken: one `chat.limitable` test for the hold and the retry; the
  reset-grace minute is a stated residual. Not taken: a test of the hello route's text (one string beside the menu arm).
- Found in this round by the new flush test: an edit had referenced `sent` outside its block, which would have thrown
  on every idle flush; fixed before commit.
