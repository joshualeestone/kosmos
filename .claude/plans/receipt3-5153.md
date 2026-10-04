# receipt3-5153: an agent's recent work on its page (#5153 slice 3)

Card: kosmos#5153. Slice 3 of the LOE ("a receipts history on the agent's page"); I told Splinter at 19:07 I was taking
it after slice 2. Stacked on slice 2 (receipt2-5153, PR #5198). Merges after Monday.

## What finished looks like
An agent's Profile section ends with "Recent work": its newest 10 closed tasks, each a row with the task's sentence over a
muted line "closed <date> · <n> files · <n> commands · <tokens> tokens · about $<x> at API prices"; a row opens the task's
page (its full receipt, slice 1). More than 10: "Open the Tasks page" (Mona Lisa 19:12: not "See all", since the page takes no agent filter and
would show everyone's; back to "See all", filtered, when it does). None: "Nothing finished yet."

## Placement: Mona Lisa's call (her reply 2026-10-03 19:08)
Inside Profile, a block at its bottom, not a nav entry: the nav pack is a deliberate pair (a third tile breaks it; a
full-width button weighs a read-only history like Direct Message; a tab in Direct Message is conversation). Same .dbox
surface, no new colours, no left accent bar. Her weakest premise: 10 rows may make Profile long on a phone (cap at 5 if
so): the phone shots decide.

## Design calls (mine)
- engine/receipt.js forAgent(who, {limit}): every closed task on any project whose activity shows the agent holding a
  part, newest close first; its own part of the SAME receipt the task page shows (forTask), so the two never disagree.
  At most `limit` (default 10, 1..50) receipts are worked out per call; `more` says older ones exist.
- GET /api/agent/:name/receipts?limit= ; an agent's token is refused (as on the task receipt route).
- Painted on open (openDetail), not on the poll: work changes when a task closes, rarely. "See all" opens the Tasks
  page; it takes no agent filter today (Mona: "if that view takes a filter"), so not filtered.
- A row for an agent that cannot be read or did nothing says so ("not available for <provider> agents yet",
  "no activity found"), never zeros.

## Weakest premise
That reading the activity file of every closed task on every project on each open is cheap (they are small, one line
per event, and only `limit` receipts are worked out). A board with thousands of closed tasks would want an index.

## Review 1 (opus): 3 WARNINGs, taken
- "Open the Tasks page" used showTab directly, skipping the Tasks page's own door (an unloaded or misplaced panel in the
  consolidated layout, a project scope left from an earlier visit): it goes through openProjectTasks(null), and shows
  only while the Tasks tab is in the bar. Source-pinned in the page test.
- Opening Profile worked out up to ten receipts one after another with a blank list: three at a time, in order, and
  "Reading this agent's work..." while the first read runs. Not taken: a per-agent cache of the closed-task scan (the
  activity files are small; recorded as the weakest premise).
- Tests that could not fail on the risky paths: a task put back (open again) and an unreadable close time are left out
  (engine); the route carries a real receipt (server). Mutants for each.
- NITs taken: an unreadable close time is dropped, not sorted as NaN; the date in the page test is this machine's own
  wording. Not taken: archived projects are listed (a finished task on an archived project is still work done; a row
  opens it); a deleted task opens its project; holds match the agent's name, as slice 1's do.

## Review 2 (sonnet): 1 WARNING, taken; NIT taken
- One task whose receipt could not be worked out failed the whole list (500, every row lost): each row catches its own
  failure and is shown as unreadable; the rest stay. Test: five held tasks, the slowest newest, one failing: order by
  close, the failed one a row with no receipt, never more than three at once (mutants: no catch, ten at once, one at a
  time each fail it).
- NIT taken: the read gives up after 20 seconds, so the reading line becomes the could-not-read line instead of
  staying. Not taken: the Tasks tab check is made at paint time (a tab revealed later shows the link on the next open;
  fails safe); the source-pinned link test (the file's house pattern).

## Review 3 (sonnet): CLEAN (no BLOCKER, no WARNING)
- NITs not taken: a failed row click's message stays until the next repaint; HEAD runs the full read (as the task
  receipt route); the concurrency test would also pass at two at a time (it pins "a few, never more than three").
