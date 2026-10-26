# autobalance-7152: kosmos#7152 slice 2, the decision, with nothing moved

## Goal
A pure decision that, given the Claude accounts and the agents on them, says which agents WOULD move and where, and
a setting for it, so a person (and we) can read its current decision before slice 3 moves anything. (Review 9: it shows
the current decision only; a day's record is slice 3's, below.)

## The rule (from the card, slice 2)
- At risk: an account whose weekly usage is at or above 90% and does not reset within 6 h, or whose login has
  stopped working (rejected or signed out).
- Target: a measured (a current weekly reading), positively signed-in (badge working or signed_in_unverified, review
  1) account the page's bulk move would also offer (shared memory, not refused or signed out, not an API key, not at
  its weekly or five-hour limit), weekly under 70%, and not the same account (folder, or the same email in the same
  organization by name). Lowest usage wins; ties go to the earlier reset; then the folder name, so the answer is
  stable.
- Movable: an agent on an at-risk account that is idle (safeRoster), with no commitment and no open task part.
- One target per at-risk account: every movable agent on it is named against that account's best target; slice 3
  moves at most one at a time anyway.

## Where it runs (the call, and why)
Inside GET /api/accounts, on the rows that route already builds (login state, weekly, memoryShared, offerable,
agentsHere), plus the idle test. Rejected: a timer sweep in slice 2. The rows need live login checks (listLive), which
must never run on a timer (engine map; server.js comment near listLive). Slice 3's sweep will need its own cheap
inputs; that is its problem, stated here so it is not assumed solved.
Weakest premise: that the Settings page polls /api/accounts often enough for "a day of decisions" to be visible.
It shows the CURRENT decision only; a history is not kept in slice 2. If a day's record is needed before slice 3,
the decision is logged once per change (a line in the board's log), which is the smallest thing that keeps one.

## Pieces
- engine/autobalance.js: decide({ rows, movable, nowMs }) -> { moves: [{ agent, from, to, why }], held: [{ from, why }],
  short: [dir], atRisk: [{ from, why, kind }] }. Pure: no fs, no clock beyond nowMs. bulkTargetable(row, nowMs) is the page's old row rule, moved;
  markTargets puts it on every Claude row the route sends, and web/index.html's acctBulkTarget reads that field, so
  the page and the decision cannot disagree. movableFor composes the Assigner's three free tests.
- Review 1: the switch and the account count are read before the decision, so a failure says "could not work out"
  instead of hiding the row; an at-risk account whose agent list may be short is named (`short`); the held line does
  not claim a reason the engine does not give. The browser checks that stub /api/accounts (6108, 6214, 6176) now
  carry bulkTargetable computed by the engine function itself. mobile-shots' account shot draws no move control (no
  agents on its rows), so it is unchanged. Not taken: rounding the at-risk and target tests as the page rounds (the
  raw figure is the truer one). (Lazy reads: taken in review 3.)
- Review 2: the route marks its rows with the clock as the answer is sent, not as the request started (its live checks
  can take a while), so a paint, and the click-time re-read, are as current as the page's own Date.now() was. A guide
  is never movable (the bulk move never moves one), and an agent already mid-move is not named again. A failed read
  takes the earlier lines away with the list. server.autobalance-7152.test.js drives the real routes: the switch's
  default, its screen-only and boolean-only PUT, bulkTargetable on every Claude row, and the decision only with
  ?agents=1 (with no email in it).
- Review 3: no second roster snapshot: the walk that lists each account's agents already read the roster
  (claudeAgentsByAccount now passes it on), and the projects are read only when an agent on an at-risk account is
  asked about. A roster that could not be read is "could not work out", never "nothing to move". One clock for the
  marks and the decision. The decision also names every at-risk account (`atRisk`), so one whose agents are all busy
  is said on the page, not silent. On the page: pressing the switch never starts a read over one that is out (it
  waits for it, bounded, then reads once), switching off clears the lines at once, and a switch that could not be read
  says so. The route test now has two accounts, one at 95%, so the real route works out a decision. The earlier "lazy
  reads, not taken" line is withdrawn: the reads were not cheap (a pane capture).
- Review 4: the switch's wait-then-read stops once the list is off screen, as the list's other timers do, so a wait
  that outlives the page starts no live-check read; and there is one wait at a time. Accepted, stated: a target whose
  limit resets between two reads stays off the bulk-move menu until the next read (the old page rule re-checked the
  clock at each paint); that errs toward not offering, and the reset timers already re-read any row with a reset line.
- Review 5: the route sends the setting's `ok`, and a setting file that could not be read shows as unknown (no switch,
  "We could not read this setting just now."), not as a confident Off; the engine still treats it as off. An at-risk
  account whose agent list is short still says why it is running out. Accepted, stated: a read that was already out
  when the switch was pressed, and that read the setting before the save, can paint the old switch position until the
  read the switch waits for replaces it (the route reads the setting after its live checks, so this is rare).
- Review 6: a route test now drives one agent built by the real producers (test-support/fleet) on the at-risk
  default account: idle, it is found movable (held, since the sandbox's second account shares no memory and so may
  not take it, asserted as the control); working, it is not. The guide check in movableFor is a backstop: the walk
  already leaves the guide out. Slice 3 must re-check that an agent is idle at the moment it moves; this slice reads
  the roster a few seconds before the answer is sent.
- Review 7: the new browser check is in docs/browser-checks/gated.txt, so the runner runs it (tools.browser-checks-wired
  refused it before: measured, red without the line, green with it). The reset is said with its hours rounded up, so a
  reset just past 6 h never reads "6 h" beside the 6-hour rule, and past two days in days. A held and short account
  says its reason once. Accepted, stated: a failed follow-up read (the switch's re-read) keeps the lines, as every
  follow-up keeps the list; only a read the person started clears them.
- Review 8: the movable test is built only when an at-risk account has agents on it, so an unreadable roster says
  "could not work out" only when it matters. For slice 3, stated so it is not assumed: a target's room is not counted
  across at-risk accounts (two at-risk accounts both name the same emptiest target, each with all its agents), so slice
  3 must pick the target again before each one-at-a-time move.
- Review 9 (no new warning; its nits taken, then reviewed again): one bad entry in the projects file is skipped, as
  the Assigner skips it, not a failed decision; a stopped login reads "cannot be used right now", not "running out"
  (atRisk carries kind); the page keeps each read's decision to that read; the route test has a row it marks true (a
  spare account that shares memory, held because its login is unchecked); 6108's "gone full" row is worked out by the
  engine; the fsync guard lists the new setting writer.
- engine/autobalance-setting.js: the assigner-setting pattern. Missing reads ON; a corrupt file reads off. Effective
  only with two or more eligible accounts; with one it does nothing and says nothing.
- GET /api/accounts?agents=1: `autobalance: { on, ok, eligible, moves, held, short, atRisk, unreadable? }`; every Claude row also
  carries `bulkTargetable`. GET/PUT /api/autobalance-setting
  (screen-only PUT, as the assigner's).
- Settings > AI Models: the switch, and one "would move" line per agent: which agent, from which account to which,
  and why. Account labels as the page already shows them; no emails in anything that leaves the computer.

## Not in this slice
Moving anything (slice 3), the works-again check (slice 3), Codex (slice 4).
