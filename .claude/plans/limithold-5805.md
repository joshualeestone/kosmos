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
- engine/chat.js: `limitHeldVerdict` (exported) returns the #4588 hold shape with heldBy 'limit', for an addressable
  Claude card (`limitable`) in rate_limited whose stateEvidence has a dated reset (status.limitResetAt): heldUntil the
  reset while it is ahead, and a minute on after it while the card still reads capped (status keeps a passed dated
  line while Claude Code's limit menu is on screen, or in its one-minute grace), for at most an hour past the reset
  (a capped card whose line status never retires, another limit wording, is then typed as before, never held for good). deliverAutomatic and
  deliverAutomaticAsync check it after the menu hold.
- engine/messages.js: a room post the limit held keeps its normal mark (addressed when it names the member, plain
  otherwise), and its reset is recorded with roomhold.noteLimit. staleHeld also reports `answered`.
- engine/roomhold.js: `<member>.limit` beside the held file records, per project, the posts a usage limit kept and the
  reset (noteLimit, at a post's arrival and at an idle flush the limit held; entries a day past their reset are pruned;
  forget removes it). withoutStale keeps such an ask that names the member until a day after the reset, unless the
  member answered it.
- engine/roomhold.js: flushReleased takes `isLimitable` and retries a non-Antigravity member only when that predicate
  passes and it holds an ask a usage limit kept (limitKept); flushOnIdle's `askedOnly` tells only such a project and
  never takes (or rewrites) any other.
- server.js: isLimitable = chat.limitable(card) (the hold's own test) and the card reads `idle` off its screen.
- engine/replynudge.js, agentnudge.js, firstreply-nudge.js, server.js (hello route): a 'limit' hold is logged as
  limit-held, "held while it is out of usage", never as the Google quota.

## Decided
- Hold only on a DATED limit line. A dateless one (the 5-hour form) stays on screen after its reset until something is
  typed; holding on it would mean nothing ever wakes the agent. The weekly form is the reported case. After a dated
  reset status drops the line by itself unless the limit menu is still up, where a typed line would land in the menu,
  so the hold lasts exactly as long as the card reads capped (looked at again every minute).
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
- Windows agents run headless; whether their cards ever read rate_limited is unmeasured (slices 2 and 3).

## Weakest premise
That a capped Claude card's stateEvidence is the limit line with its reset. It is the line classify() matched; if a
future Claude Code wording moves the reset to another line, limitResetAt finds nothing and nothing is held (the old
behaviour), never the reverse.

## Tests (engine/limithold-5805.test.js, plus a limit-held case in agyhold-4588 and replynudge-4951)
- Real limit screens: a dated reset ahead holds sync and async; a passed dated reset on a card still reading capped is
  held for a minute; a dateless line is typed; a reset status has retired is typed; a person's message is not held; a
  codex card is not held.
- Room: an ask to a capped Claude member keeps its addressed mark and is recorded; not retried while capped or without
  the predicate; told once when idle, with "names you"; a plain post waits; only a project with a surviving ask is told.
- withoutStale with the real staleHeld: a limit-kept ask survives its day, an answered one or one past its grace does
  not, another member's limit does not count; the flush path records the limit; noteLimit merge, prune, forgetProject.
- server.js wires isLimitable with chat.limitable.

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

## Review 3 (opus)
- FIXED: after a dated reset Claude's limit menu can stay up (status keeps the card capped for that reason); the hold now
  lasts while the card reads capped, looking again every minute, instead of ending at the printed reset (tested).
- FIXED: the Claude retry told every held project once any ask existed; it now tells only a project whose ask survives
  withoutStale and puts the rest back (askedOnly, tested).
- FIXED: an arrival limit-held now records every ask it put back, not only the new post.
- NITs taken: forgetProject clears its room's limit entries and an empty sidecar is removed; tests for merge and
  prune; stale comments ("the cap's mark") corrected; the server predicate is source-asserted; the two comment blocks
  above limitable merged.

## Review 4 (sonnet)
- FIXED: a dated limit line status never retires (another wording) could keep the post-reset re-look going for good; it
  stops an hour after the reset (tested both sides).
- FIXED: the Claude retry woke an idle member for any held ask; it now needs the ask's limit record, so other holds keep
  their #4624 behaviour (tested), and a project without one is not taken and rewritten every minute (#4797).
- NITs not taken: a lock on the sidecar (single board process, synchronous atomic writes, as the held file itself);
  driving the server predicate against a real card (it is chat.limitable plus the state, both tested; source-asserted).
