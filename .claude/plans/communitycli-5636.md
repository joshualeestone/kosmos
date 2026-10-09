# communitycli-5636: community CLI fixes from the 0.7.27 model feedback (F3b to F7)

Card: kosmos#5636 (Splinter, from Josh's multi-model pass on 0.7.27: one agent each on Claude, GPT, Grok and Meta).
Released to Angel by Ice Cream Kitty (not started), 2026-10-09 01:26 CDT. Order per Splinter: F6, F3b, F4, F5, F7.

## Done looks like

Each item is either changed on main with a test that goes red without the change, or recorded on the card as
decided with the evidence, the weakest premise and what would change the decision.

## Items

| Item | Outcome | Evidence |
|---|---|---|
| F6 comments cut in `read --post` | Already fixed and served, no change | #5461 (5ad3485de, 10-07) is not in archive/0.7.27-app-commit; the 0.7.28 board on this Mac has POST_COMMENT_CAP 4000 on every comment |
| F3b unconfirmed sends | Built | communitystatus.js words; communitysend.test.js holds the send layer to them |
| F4 sandboxed reads | Decided: already routed; pinned by a test | cli.busy-health-4466.test.js #5636 arm; red when the read calls curl directly (mutation) |
| F5 whoami Meta model | Traced, no change; needs a Meta seat | #4980 and #4603 R7 both in 0.7.27; path read end to end against a captured stream |
| F7 prompts | Built | communityturn.js one prompt per post once the floor is met; communityfollow.js posts before "Reply to:" entries |

## Decisions (reversible)

- **F3b, post:** "Kosmos asks again on its next pass, within 5 minutes, and this line changes once it knows". True
  because settleUnconfirmed runs first in every sweep, whatever the switch says, and the timer is 5 minutes.
- **F3b, refused agent:** a new state `unconfirmed_refused`, because settleUnconfirmed skips a refused agent, so the
  ordinary words would promise a check that never runs. Rejected: leaving it under `unconfirmed`.
- **F3b, comment:** says it will not change (sendComment is at most once, and the service has no lookup) and names
  `kosmos community read --post <id>`. Rejected: promising a later check.
- **F4:** no change to the route or the timeouts. Rejected: changing either with no evidence of which one fails.
  Weakest premise: the Meta seat was not run; its runner's own command time limit is the likeliest remaining cause.
- **F5:** no change. Weakest premise: a Meta agent started before 0.7.22 still runs the old Muse front, because an
  update does not restart the pane's process.
- **F7, prompts:** once an agent has posted in the last day, one prompt per post. Rejected: lowering
  PROMPTS_PER_DAY (it also governs the daily-floor path, which the block requires). The floor path is unchanged.
- **F7, feed:** posts first, then "Reply to:" entries, each part newest first; the heading names both only when both
  are there. Rejected: dropping reply entries (#5463 made them votable on purpose).

## Verification

- Focused: community suites, the Windows and file-scanning guards (762 tests, 0 fail), the #4933/#5636 CLI arm.
- Mutation checks: refused-agent settle guard, the read's kosmos_curl route, the feed order, the one-per-post gate.
- Full node suite and both browser-check gates before the PR.

## Review log

(filled in per round)
