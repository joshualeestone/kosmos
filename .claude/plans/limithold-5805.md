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
- engine/messages.js: a room post the limit held is kept with the cap's mark (even when it names the member).
- engine/roomhold.js: flushOnIdle keeps that mark on a put-back; flushReleased takes `isLimitable` and retries a
  non-Antigravity member only when that predicate passes and it holds cap-marked posts.
- server.js: isLimitable = a Claude card of ours that reads `idle` off its screen.

## Decided
- Hold only on a DATED reset ahead. A dateless limit line (the 5-hour form) stays on screen after its reset until
  something is typed; holding on it would mean nothing ever wakes the agent. The weekly form is the reported case.
  status.retireResetLimits already drops a dated line after its reset, so the card leaves rate_limited by itself.
- A limit-held room post always takes the cap's mark, so the minute retry can find it. Rejected: keeping the
  "addressed" mark for posts that name the member, because the retry would then have to retry addressed posts on any
  idle Claude member, which on a member without hook reports could type into a busy agent. Cost: the later line does
  not single out the post that named the member.
- The retry for Claude members runs only while the card reads idle off the screen, never while it reads capped or
  busy, so it does not rewrite the held file every minute of a pause (#4797) and never types into a working agent.
- A person's own message is not held here (slice 2).

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
