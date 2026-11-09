# listone-8304: kosmos agent list shows the one-step wait from #8286

Card: joshualeestone/kosmos#8304 (follow-up to #8286 and #8288).

## What

`kosmos agent list` (#8288) prints an indented line under an agent that is stuck. It now also prints #8286's wait, a
working Claude agent on one tool call for 5+ minutes: "  on one step since 2026-11-09 10:12: Bash".

## How

- `engine/clilists.js` rosterRow: `longStepSince` (and `longStepTool` only when the name is plain, [A-Za-z0-9_.-]{1,64})
  from the card's `oneStep`, for a working card only, as the page says it. stateLines: one line for it.
- Kept apart from `oneStepSince`, which is #7368's Windows turn stall with its own words ("no activity on its current
  step ..., with messages waiting behind it").
- Both CLIs' help names it ("any unsent text or long tool call (Claude agents only), ...").
- #8288's pin test now also requires the page's rule "a.state === 'working' && a.oneStep".

## Not done, decided

- No server change: GET /api/agents/list already maps every card through rosterRow.

## Proof

- engine/clilists.test.js: three new tests; server.agent-token-gate-4491.test.js: one route-level test (exact keys, a
  name that is not plain never reaches the response). Nine mutation arms red, each with the file loading. A sweep of 99
  CLI and help test files green. Two blind review rounds (opus, sonnet), the second clean.
- What the list now sends, stated in the three comments that describe it: a long tool call's tool name, only in the
  PLAIN_TOOL shape, checked where the row is made and where it is printed.
