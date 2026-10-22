# projcost-6842: kosmos#6842 slice 2, a project's cost

Built on slice 1 (prreceipt-6842, merged as #6866); rebuilt on main after that merge.

## What
- engine/receipt.js `forProject(projectId, {limit=50, now, receiptOf})`: sums tokens per model over every agent on the
  project's newest 50 closed tasks, using forTask (the same receipts the task pages show). PRs once each with their
  task numbers; each agent's own prsMore carried as a count. Left out, and said: notCounted (older tasks), unread
  (agent not readable), partial (receipt read in part), failed (forTask threw).
  prsUnknown: agents whose receipt has no `prs` (kept at version 2 before slice 1, or not a Claude agent); the page
  says those parts do not record pull requests, so a total never reads "none" where the truth is "unknown" (raised by
  slice 1's iteration 9 review).
- GET /api/project/:id/receipts: refused to an agent's token (403), 404 no project, 400 bad name, 500 otherwise.
- Project settings: a field "What its finished tasks cost": one line (tasks, tokens, cost at API prices from the
  page's one price table, then what was left out), and the PR line reusing tkReceiptPrsHtml (20 named, rest counted).
  Fetched once per settings paint; a stale answer for another project is dropped.

## Decided
- Settings rather than the project head: the head is tight in all three looks; for Mona Lisa's design review.
- The newest 50, not all: an unkept receipt reads transcripts; older tasks are counted and said.
- Rejected: a stored per-project total (would drift from the task receipts; this sums the kept receipts instead).
- Residual, stated: an agent that holds parts of two tasks at the same time has those tokens on both receipts (each
  counts its transcript inside that task's hold spans), so a project total can count them twice. The page says so only
  when one agent's holds on two counted tasks really overlap (`overlapping`, review 3); de-duplicating spans per agent across
  tasks is a separate change (found in slice 3's review).
- PRs merge on repo#number (a receipt may keep a PR's url or not); each agent's unnamed count cannot be matched across
  tasks, so the page says "up to N more"; "the newest N" names the tasks looked at, even when some failed (review 1).
- The cost words come from tkTokensAndCost, shared with the task receipt, so the two cannot drift (review 1).
- Rebuilt on main after slice 1 (PR #6866) merged as a squash: only this slice's own commits, cherry-picked (four then; more since, from review).
- Weakest premise: that 50 receipts (3 at a time) answer quickly enough on a busy project. Kept receipts are one file
  read each; only unkept ones read transcripts, once.

## Verify
- engine/receipt-project-6842.test.js (10, incl. one through the real forTask and a real transcript); mutants caught:
  no newest-first order, no PR merging.
- server.receipt-5153.test.js: the route (empty, one closed task, 403, 404, 400).
- web.project-cost-6842.test.js (9); mutants caught over the review rounds: the could-not-be-read caveat, the unknown-PRs line, the newest-N count, the PR key, the overlap test, unreadable agents as unknown, in-flight sharing.
- engine prsUnknown test; mutant caught: not counting an agent with no prs.
- Settings-related web tests (5 files) pass.
