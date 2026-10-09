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
| F3b unconfirmed sends | Built | communitystatus.js words ("within a few minutes"); communitysend.test.js holds the send layer to them |
| F4 sandboxed reads | Decided: already routed; pinned by a test | cli.busy-health-4466.test.js #5636 arm; red when the read calls curl directly (mutation) |
| F5 whoami Meta model | Traced, no change; needs a Meta seat | #4980 and #4603 R7 both in 0.7.27; path read end to end against a captured stream |
| F7 prompts | Built | communityturn.js one prompt per post once the floor is met; communityfollow.js posts before "Reply to:" entries |

## Decisions (reversible)

- **F3b, post:** "Kosmos asks again on its next pass, within a few minutes, and this line changes once it knows".
  True because settleUnconfirmed runs first in every sweep, whatever the switch says, on a 5-minute timer.
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

- **Round 1 (opus):** 0 blockers, 1 warning, 6 NITs.
  - W fixed: the refused-agent test's request check matched the api key, which no request carries (requests use a session token), so it could never fail. It now matches the lookup itself (GET /agents/me/posts, /agents/login), with a CONTROL in the switch-OFF test that the settle is seen asking; mutation: dropping the k.refused skip turns it red on its own.
  - N1 taken: "within a few minutes" (as `queued`), since a long pass or a retirement being applied can put the next look past 5.
  - N2 taken: unconfirmed_refused reads the record's agentRefused only (the key settleUnconfirmed checks), not the reader's.
  - N3 taken: a note in the #5296 loop test that the new gate stops it first; workedSince keeps its own tests.
  - N4 left: a try that did not reach the agent uses up that post's prompt. The floor is met, so the cost is one optional prompt, and an unreachable pane being retried is what the book's "reached or not" rule exists to stop.
  - N5 taken: a heading for a feed with only "Reply to:" entries.
  - N6 taken: the read --post hint says a long thread may show it past the comments listed.
- **Round 2 (sonnet):** 0 blockers, 2 warnings, 1 convention, 3 NITs.
  - W1 fixed: settleUnconfirmed also skips an agent with no key (none kept, or a held name), and the sweep sends nothing to an address it does not send to, so "asks again" was false there too. A new state `unconfirmed_unasked` promises no check ("cannot ask about it just now; this line changes once it can"); a test covers no key, an empty key and an address Kosmos does not send to, with a CONTROL (red by mutation).
  - W2 recorded, not fixed here: the withdraw reply ("on its next send it takes it down") and the edit refusal ("try again after its next send") for an unconfirmed post predate this change and say nothing about a refused agent. Whether the delete pass can reach a refused agent's unconfirmed post is a question about the delete pass, not these words; noted on the card as a follow-up.
  - C fixed: the communityturn comment above TURN_TEXT no longer says a woken turn can earn another prompt the same day.
  - NITs: COMMENT_WORDS for the two post-only states are explained (the coverage test needs words for both kinds); the #5296 tick tests' note stands; the owner-facing page's "Sent, not confirmed yet" is a different surface and stays.
- **Round 3 (opus):** 0 blockers, 2 warnings, 3 NITs. stateOf checked against settleUnconfirmed and every early return in sweepOnce.
  - W1 fixed: `unconfirmed_unasked` read the reader's key, while the settle asks with the record's own agent's (a retired account's post keeps the retired key). statusOf now reports `agentKeyless` for an attempted record whose own agent has no key (only then, so other statuses keep their shape), and stateOf reads it as it reads agentRefused; a test covers both directions.
  - W2 fixed: the replies-only heading claimed "no new posts" from one page of the feed. Both headings now speak of the newest items read and "posts not shown here".
  - NITs: the unreadable-retirement-folder case is named in the comment (a damaged-file state, words unchanged); the other two were notes, no change.
- **Round 4 (sonnet):** nothing above NIT. Converged. Both NITs taken: an inverted fixture message in the review 2 test; a comment on why agentKeyless is not gated on the state.
