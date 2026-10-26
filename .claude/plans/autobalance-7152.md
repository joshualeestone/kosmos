# autobalance-7152: kosmos#7152 slice 2, the decision, with nothing moved

## Goal
A pure decision that, given the Claude accounts and the agents on them, says which agents WOULD move and where, and
a setting for it, so a person (and we) can read a day of decisions before slice 3 moves anything.

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
  short: [dir] }. Pure: no fs, no clock beyond nowMs. bulkTargetable(row, nowMs) is the page's old row rule, moved;
  markTargets puts it on every Claude row the route sends, and web/index.html's acctBulkTarget reads that field, so
  the page and the decision cannot disagree. movableFor composes the Assigner's three free tests.
- Review 1: the switch and the account count are read before the decision, so a failure says "could not work out"
  instead of hiding the row; an at-risk account whose agent list may be short is named (`short`); the held line does
  not claim a reason the engine does not give. The browser checks that stub /api/accounts (6108, 6214, 6176) now
  carry bulkTargetable computed by the engine function itself. mobile-shots' account shot draws no move control (no
  agents on its rows), so it is unchanged. Not taken: rounding the at-risk and target tests as the page rounds (the
  raw figure is the truer one), lazy reads of the roster when nothing is at risk (cheap; reads only on Settings).
- Review 2: the route marks its rows with the clock as the answer is sent, not as the request started (its live checks
  can take a while), so a paint, and the click-time re-read, are as current as the page's own Date.now() was. A guide
  is never movable (the bulk move never moves one), and an agent already mid-move is not named again. A failed read
  takes the earlier lines away with the list. server.autobalance-7152.test.js drives the real routes: the switch's
  default, its screen-only and boolean-only PUT, bulkTargetable on every Claude row, and the decision only with
  ?agents=1 (with no email in it).
- engine/autobalance-setting.js: the assigner-setting pattern. Missing reads ON; a corrupt file reads off. Effective
  only with two or more eligible accounts; with one it does nothing and says nothing.
- GET /api/accounts?agents=1: `autobalance: { on, eligible, moves, held, short, unreadable? }`; every Claude row also
  carries `bulkTargetable`. GET/PUT /api/autobalance-setting
  (screen-only PUT, as the assigner's).
- Settings > AI Models: the switch, and one "would move" line per agent: which agent, from which account to which,
  and why. Account labels as the page already shows them; no emails in anything that leaves the computer.

## Not in this slice
Moving anything (slice 3), the works-again check (slice 3), Codex (slice 4).
