# autobalance-7152: kosmos#7152 slice 2, the decision, with nothing moved

## Goal
A pure decision that, given the Claude accounts and the agents on them, says which agents WOULD move and where, and
a setting for it, so a person (and we) can read a day of decisions before slice 3 moves anything.

## The rule (from the card, slice 2)
- At risk: an account whose weekly usage is at or above 90% and does not reset within 6 h, or whose login has
  stopped working (rejected or signed out).
- Target: a measured (a current weekly reading), signed-in, offerable account with shared memory, not an API key,
  weekly under 70%, and not the same account. Lowest usage wins; ties go to the earlier reset; then the folder name,
  so the answer is stable.
- Movable: an agent on an at-risk account that is idle (safeRoster), with no commitment and no open task part.
- One target per decision run: every movable agent on an at-risk account is named against the best target; slice 3
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
- engine/autobalance.js: decide({ accounts, agents, nowMs }) -> { moves: [{ agent, from, to, why }], atRisk, target }.
  Pure: no fs, no clock beyond nowMs. targetOk(row, fromDir) is the one target test; web/index.html's acctBulkTarget
  is moved to read it from the route (`bulkTarget` per row) so the page and the decision cannot disagree.
- engine/autobalance-setting.js: the assigner-setting pattern. Missing reads ON; a corrupt file reads off. Effective
  only with two or more eligible accounts; with one it does nothing and says nothing.
- GET /api/accounts: `autobalance: { on, eligible, wouldMove: [...] }`. GET/PUT /api/autobalance-setting
  (screen-only PUT, as the assigner's).
- Settings > AI Models: the switch, and one "would move" line per agent: which agent, from which account to which,
  and why. Account labels as the page already shows them; no emails in anything that leaves the computer.

## Not in this slice
Moving anything (slice 3), the works-again check (slice 3), Codex (slice 4).
