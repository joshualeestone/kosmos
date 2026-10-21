# projcost-6842: kosmos#6842 slice 2, a project's cost

Stacked on prreceipt-6842 (slice 1). Opens as a PR only after slice 1 merges (rebase onto main then).

## What
- engine/receipt.js `forProject(projectId, {limit=50, now, receiptOf})`: sums tokens per model over every agent on the
  project's newest 50 closed tasks, using forTask (the same receipts the task pages show). PRs once each with their
  task numbers; each agent's own prsMore carried as a count. Left out, and said: notCounted (older tasks), unread
  (agent not readable), partial (receipt read in part), failed (forTask threw).
- GET /api/project/:id/receipts: refused to an agent's token (403), 404 no project, 400 bad name, 500 otherwise.
- Project settings: a field "What its finished tasks cost": one line (tasks, tokens, cost at API prices from the
  page's one price table, then what was left out), and the PR line reusing tkReceiptPrsHtml (20 named, rest counted).
  Fetched once per settings paint; a stale answer for another project is dropped.

## Decided
- Settings rather than the project head: the head is tight in all three looks; for Mona Lisa's design review.
- The newest 50, not all: an unkept receipt reads transcripts; older tasks are counted and said.
- Rejected: a stored per-project total (would drift from the task receipts; this sums the kept receipts instead).
- Weakest premise: that 50 receipts (3 at a time) answer quickly enough on a busy project. Kept receipts are one file
  read each; only unkept ones read transcripts, once.

## Verify
- engine/receipt-project-6842.test.js (6, incl. one through the real forTask and a real transcript); mutants caught:
  no newest-first order, no PR merging.
- server.receipt-5153.test.js: the route (empty, one closed task, 403, 404, 400).
- web.project-cost-6842.test.js (4); mutant caught: the could-not-be-read caveat dropped.
- Settings-related web tests (5 files) pass.
