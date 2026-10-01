# idlefresh-4581: a summary current when its agent went idle is not "behind" (#4581 N10)

Card: joshualeestone/kosmos#4581, 0.7.15 diagnostic (2026-10-01): "N10 (Claude): freshness counts idle overnight hours,
so a quiet night marks three of five agents as behind. Suggested: measure against working time, or show 'idle since'
beside it."

## Measured first (origin/main 0a7157d41)
engine/projectview.js summaryFreshness compares the newest summary's write time with now: stale past four hours. The
rhythm it measures is "a summary every four hours WHILE WORKING" (roles.js SUMMARY_RHYTHM), so an agent idle since
evening reads stale by morning.

## What changes (engine/projectview.js only; both CLIs render through it)
- overviewOf passes each member's summary through idleExcused: a stale summary of a member that is present, tied and
  idle now, whose latest self-report is `idle` dated no later than now, written within four hours before that idle
  report, becomes state `idle` with idleSince/idleMinutes.
- renderShow says: "summary: current when it went idle (<file>, <age> ago; idle since <age> ago)".
- Unchanged: current, none, nofolder, future, unreadable; a stale summary of a working, asking or not-running member;
  a summary already over four hours old when the member went idle.

## Decided, and rejected
- Rejected: subtracting idle time from the age (measuring working time). It needs every idle stretch, which the board
  does not keep; the latest idle report is what it has, and saying "idle since" is the diagnostic's other suggestion.
- The idle moment is the latest report's time. Every turn end writes one, so a member idle since evening reads its
  evening time.

## Weakest premise
That the latest idle report's time is when the member stopped working. A member woken overnight for a short turn has a
later idle time; its summary from the evening then reads stale if that wake was more than four hours after it. What
would change my mind: PMs reading such members as behind on a quiet night.

## Tests
engine/projectview.test.js: idle 3h after the summary reads "current when it went idle"; idle 8h after reads stale; a
working report, no report, and an idle report dated in the future read stale; a current summary is untouched.

## Review 1 (Sonnet, blind, source-only): 0 blockers, 2 warnings, 4 nits
- W1 a summary written AFTER the idle report was excused and printed an idle time before the summary: FIXED, it stays
  stale; arm added (and the exact four-hour edge pinned).
- W2 any repeated idle report while parked moves the idle time forward and the feature quietly stops excusing:
  ACCEPTED as part of the weakest premise (a wake that ends in idle is a real turn; a PM reading "stale" for a member
  that worked without summarising is right). Taking the first idle of the current run needs a new field from
  selfreport.read; noted on the card.
- N3 the documented premise; no change. N4 garbage report time: arm added (stays stale). N5 edges: consistent.
- N6 the PM role text does not mention the new phrase: kept (it raises "stale" only, which is the intended outcome);
  a roles.js change rewrites every PM's boot text.

## Review 2 (Opus, blind, source-only): 0 blockers, 2 warnings, 4 nits
- W1 Claude reports `started` at launch where Antigravity and Muse report `idle`, so a member restarted and given no
  turn read differently by family: FIXED, a latest `started` counts like idle (same gap rule). A member not running is
  unchanged on purpose: it is gone, not idle; stated in the comment. Arm added.
- W2 an operator's clear (state idle, by operator) was read as when the agent stopped: FIXED, never excused. Arm added.
- N3 every arm injected readReport: ADDED an arm through the real selfreport.read.
- N4 the edge comment overstated the match with summaryFreshness: softened. N5, N6: kept.

## Review 3 (Sonnet, blind, source-only): 0 blockers, 1 warning, 3 nits
- W1 a `started` (a restart with no turn since) read "current when it went idle": FIXED, its own words, "current when
  this session started (...; started <age> ago, idle since)". Arm added.
- N2 `by` on older lines reads null and is excused: correct (the operator clear and the field shipped together).
- N3 a non-idle member with a started or idle report: ADDED an arm (stays stale). N4 the end-to-end arm: confirmed.

## Review 4 (Opus, blind, source-only): 0 blockers, 1 warning, 5 nits
- W1 Codex reports idle and never working, so after a turn that never completed (interrupted, errored, restarted) its
  latest report is an older idle and hours of unsummarised work read "current when it went idle": FIXED, a Codex member
  is never excused until its bridge reports working. Arm added (a real idle Codex member stays stale).
- N2 Antigravity and Muse report launch as idle, so a restarted one reads "went idle" where Claude reads "started":
  DOCUMENTED (cannot hide a gap).
- N3 controls not labelled: FIXED. N4 the end-to-end arm's file: commented. N5 idleKind in the JSDoc and the two
  "idle" words told apart: FIXED. N6 an older renderer's fallback words: kept (needs version skew).
