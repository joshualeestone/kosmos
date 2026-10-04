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
