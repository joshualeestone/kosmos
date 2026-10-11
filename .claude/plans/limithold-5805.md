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
  (a capped card whose line status never retires, another limit wording, is then typed as before, never held for good),
  unless Claude's limit menu is still on screen (status.claudeLimitMenuUp). The verdict also carries `limitReset`, the
  printed reset, which the day rule counts from. deliverAutomatic and deliverAutomaticAsync check it after the menu hold.
- engine/chat.js: `limitReleased(card)`, the server's release test: a limitable card reading idle, or reading blocked
  under Claude Code's StopFailure limit report while its screen reads idle.
- engine/status.js: `providerLimitReport` (the StopFailure report: an automatic blocked on "provider api (rate_limit)").
  That report does not outrank a limit screen (the #3723 rule for Codex and Gemini), and under it a blocked card carries
  `screenState`, what its screen reads (a new pane-card field, null otherwise).
- engine/messages.js: a room post the limit held keeps its normal mark (addressed when it names the member, plain
  otherwise), and its reset is recorded with roomhold.noteLimit. staleHeld also reports `answered`.
- engine/roomhold.js: `<member>.limit` beside the held file records, per project, the posts a usage limit kept and the
  reset (noteLimit, at a post's arrival, at an idle flush the limit held, and in the minute sweep for an ask held
  before the limit while the member is limit-held; entries a day past their reset are pruned; forget removes it). withoutStale keeps such an ask that names the member until a day after the reset, unless the
  member answered it.
- engine/roomhold.js: flushReleased takes `isLimitable` and retries a non-Antigravity member only when that predicate
  passes and it holds an ask a usage limit kept (limitKept); flushOnIdle's `askedOnly` tells only such a project and
  never takes (or rewrites) any other.
- server.js: isLimitable = chat.limitReleased.
- engine/replynudge.js, agentnudge.js, firstreply-nudge.js, server.js (hello route): a 'limit' hold is logged as
  limit-held, "held while it is out of usage", never as the Google quota.

## Decided
- Hold only on a DATED limit line. A dateless one stays on screen after its reset until something is
  typed; holding on it would mean nothing ever wakes the agent. Dateless covers the 5-hour form AND a weekly limit in
  its last day (Claude Code prints a time with no date when the reset is under a day away), so slice 1 does not hold
  the weekly limit's final day; slice 3's first-seen time is what makes a dateless reset holdable. After a dated
  reset status drops the line by itself unless the limit menu is still up, where a typed line would land in the menu,
  so the hold lasts exactly as long as the card reads capped (looked at again every minute).
- A limit-held room post keeps its normal mark, so the agent is told it was named. The minute retry for a Claude
  member looks only for posts that name it, and only while its card reads idle off the screen; a member holding only
  posts that ask nothing of it waits for its next wake. An ask needs a limit record to be retried; a #4624 hold that a
  limit never touched waits for the next wake as on every other runner.
- A turn that fails on the limit ends with StopFailure, not Stop, so no idle flush runs and the card reads blocked
  after the reset. The release reads the screen under that one report instead of changing what the board shows (the
  board keeps showing the report; changing that is broader than this card).
- The day rule (#4926: a pause of days does not deliver days-old asks) is kept for every other hold. For a usage-limit
  hold, an unanswered ask that names the member is kept until a day after the reset, recorded beside the held file so
  it covers a post first held while the member worked and only limit-held at its turn-end flush (a post row is
  append-only and is written before that).
- The retry for Claude members runs only while the card reads idle off the screen, never while it reads capped or
  busy, so it does not rewrite the held file every minute of a pause (#4797) and never types into a working agent.
- A person's own message is not held here (slice 2).
- The StopFailure limit report never outranks a limit screen, dated or dateless: on the dateless form (not held) a
  fresh report used to make the card read blocked, and now it reads rate_limited with the screen's conflict note. The
  screen is the better witness there too; tested.

## Residuals, stated
- An ask's limit record is not removed when the ask is told; it lapses a day after the reset (or with the next write
  for that member). Until then a restored id keeps the day rule from the reset, which is the record's meaning.
- A limit menu nobody dismisses keeps the hold (typing would land in it) and the card capped, so its kept asks are
  dropped a day after the printed reset, logged by the board; nothing in this slice keeps them longer.
- Windows agents run headless; whether their cards ever read rate_limited is unmeasured (slices 2 and 3).
- A limit-kept ask whose try keeps coming back COULD_NOT for an idle, addressable member is retried each minute while
  its record lasts (a day past the reset). Unreachable members are skipped before the try, and an idle Claude card
  meets none of the holds, so what remains is a transient tmux failure, the same shape the Antigravity retry accepts.
- That StopFailure fires instead of Stop on a limit is from Claude Code's hook documentation, not measured on a live
  capped session.

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
- server.js wires isLimitable with chat.limitReleased.
- Real cards from a real self-report through the real snapshot: the fresh StopFailure report keeps the card capped and
  held; after the reset it reads blocked with an idle screen and is released; an agent-made blocked is neither.
- The menu keeps the hold past the hour cap (control: no menu, typed). The day counts from the printed reset, not
  the next look. An ask held before the limit is recorded while capped and told once idle; a plain post is not.

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

## Review 5 (opus)
- FIXED (BLOCKER): after the reset the card read blocked (the StopFailure report stands), so the idle-only release
  never fired; chat.limitReleased reads the screen under that report (screenState).
- FIXED: in its first five minutes that report outranked the limit screen, so nothing was held; it no longer does.
- FIXED: the hour cap ended the hold with the limit menu up; the menu keeps it.
- NITs taken: the past-reset test's idle is checked against the engine; an arrival records the new post only when it
  names the member.

## Review 6 (sonnet)
- FIXED: re-looks restarted the day grace from each look; the day counts from `limitReset`, the printed reset.
- FIXED: a failed limit record was silent; it is logged.
- DEFERRED: a test across the hold-to-release handoff; both sides are pinned by the real-card tests above.

## Review 7 (opus)
- FIXED: an ask held while the member worked got no limit record when the turn failed on the limit and nobody posted
  during the pause; the minute sweep records it while the member is limit-held (tested, with a plain-post control).
- DEFERRED: per-minute retry of a limit-kept ask whose try keeps failing (stated under Residuals).
- FIXED: this plan, which had stopped at review 4. NITs taken: the idle flush records addressed asks only; the menu
  helper no longer splits retireResetLimits from its comment. Not taken: a shared helper for the held-by wording, and
  one menu test for both readers (a quoted menu title past the cap would only hold lines longer, never type them).

## Review 8 (sonnet)
- FIXED: the minute sweep asked for the limit verdict before checking the member held anything; the held check is first.
- DEFERRED: past the hour cap a capped card's delivery reads the pane for the limit menu. Only a card whose dated line
  never retires reaches it, and the menu hold already reads the pane per delivery for needs-you and working cards.
- NIT taken: providerLimitReport no longer splits the #4588 part 3 comment from reconcileReport.

## Review 9 (opus)
- DEFERRED, by design (decided): the handoff-restart pickup sends with `{ cap: false }` and the limit holds it. The
  usage limit is the Claude form of the shared quota, which holds that route, not of the Gemini cap the person's click
  overrides: typed into a capped session the pickup lands on the limit screen and is lost, while the 409 shows the
  person the manual line. Weakest premise: a stale roster just after a restart could give a needless 409, which costs
  one manual line. What would change it: evidence that a restarted session often reads capped from an old roster.
  Pinned by a test.
- NIT taken: the staleHeld comment's broken wrap. Not taken: an injected clock for withoutStale's limitKept (tests
  pass explicit times to limitKept directly); the shared held-by wording helper (as before).

## After review 10 (found by the slice-2 survey, not a reviewer)
- FIXED: the page's wakeHeldLine had arms for cap and menu only, so a wake or handoff pickup held on a usage limit
  told the person "This computer's shared Google quota is out". It now says the agent is out of usage, until the
  printed reset while that is ahead (web.wake-hello-automatic-4959.test.js; Browser-check trailer on 72e4f5aff).

## Review 11 (opus)
- FIXED: the minute sweep's limit record (review 7) skipped the day rule, so an @ask held for days could be stamped
  with a fresh reset and delivered after it. It now records only asks `stale` would not already drop even when asked
  (answered, or a day old), without logging them as dropped (tested: a three-day-old ask is not recorded, a fresh
  one is).
- Not taken: one read of the limit file per sweep (a small JSON file; correctness unaffected); the shared held-by
  wording helper (as before); a long comment line.

## After review 12 (found by a full-suite run on a stacked branch, not a reviewer)
- FIXED: the golden agent card (docs/browser-checks/fixtures/agent-card.json, #2519) had no `screenState`, the pane
  card field review 5 added, so render-talk-goldencard-2519 failed on drift. Added as null, where the card builds it.

## Review 13 (opus)
- FIXED: past the printed reset the page told the person the agent was still out of usage, when the hold then lasts
  only while its limit screen is up; it now says the usage has reset and to answer the screen in its window (tested).
- FIXED: stale comments (flushReleased's header said only Antigravity cards are retried; three comments listing the
  hold kinds left out the usage limit).
- NIT taken: flushReleased reads the card's state before any file, so a card neither capped nor released costs nothing.
  Not taken: anchoring claudeLimitMenuUp below the limit row (it fails toward holding longer); the held-by wording
  helper (as before); stating that a second limit within a day carries a still-kept ask forward (it is the same ask,
  still unanswered).

## Review 14 (sonnet)
- FIXED: limitHeldVerdict's comment sat above the two constants instead of the function; it now sits on the function.
- Duplicates: the sidecar lock (reviews 4 and 10), the pane read past the hour cap (review 8).
- DEFERRED: flushReleased calls chat.limitHeldVerdict directly rather than through an injected option. It reads only
  the card unless the card is capped past the hour cap, and roomhold already requires chat lazily (addressable).

## Review 15 (opus)
- STATED (scope, not built): a weekly limit's last day prints a time with no date, so it is not held; the plan said
  "dateless" meant only the 5-hour form. Slice 3's first-seen time covers it.
- STATED (residual): a limit menu nobody dismisses ends with the kept asks dropped a day after the reset.
- FIXED: two more comments listing the hold kinds without the usage limit (messages reply nudge, missedtell).
- NIT taken: flushReleased's pre-filter passes only a capped card the limit hold applies to (a capped Codex or Gemini
  card costs nothing). Not taken: the held-by wording helper; one read of the limit file per sweep.

## Review 16 (sonnet)
- FIXED: flushReleased's pre-filter spelled the state as a literal; it reads status.STATE.RATE_LIMITED, and the lazy
  requires say why they are lazy.
- Duplicates of stated premises: the limit wording (weakest premise) and StopFailure not measured live (residual).

## Review 17 (opus)
- DECIDED and pinned: the report-under-screen rule applies to the dateless form as well (the card reads rate_limited,
  not blocked; nothing held; tested).
- STATED (residual): a told ask's limit record lapses rather than being removed.
- Not taken: hoisting the lazy requires; an injected clock for withoutStale; the held-by wording helper; the pane read
  past the cap (review 8).
