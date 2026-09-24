# Token Usage page: the "By agent" block (kosmos#2617, page slice)

The engine and route slice merged as #3587: `/api/usage` returns `byAgent`
({ agents, elsewhere, shared, unattributed, overcount, rosterRead }, or null).
This slice shows it on Settings > Token Usage.

## Call
- A "By agent" block under the per-model table and donut, as a sibling of the
  usage-history block (same h4 and spacing).
- The table reuses the per-model table's markup and classes (`tv-mrow`, share
  bar, tokens, % total) with an "Agent" column, so the page speaks one visual
  language and needs no new component. Tokens are the four-class total, as
  every other figure on the page.
- Agents first, most tokens first, by shown name. Then "Not an agent (your own
  sessions)" and, when present, "A folder two agents share", both in the muted
  Other color with a lighter label, so neither reads as an agent.
- A plain sentence under the table says what it cannot show: an unread roster,
  tokens whose transcripts are gone, or the reverse. Silent when there is
  nothing to say.
- Hidden when `byAgent` is null or absent (an older board, a failed split), and
  reset by the page's shared clear path.

## Rejected
- A second donut for agents: the model donut already carries the share view,
  and two donuts side by side invite comparing unlike things.
- Folding "not an agent" into the agent list with an agent color: it would read
  as a named agent.

## Weakest premise
That the model table's layout suits agent names. Agent display names can be
longer than model ids; the name cell truncates with an ellipsis, as model names
do. Mona reviews styling before merge.

## Verification
- web.token-usage-2617.test.js runs the real renderers: rows, ordering, the
  four-class total, muted color, escaping, the note, and paintUsage wiring.
- docs/browser-checks/render-token-usage-2617.js asserts the rendered block
  (rows, header, bars paint, no overflow, note, placement) and that it stays
  hidden without byAgent. Not run by me: starting a board was refused in my
  session, so the live render and screenshots are for the styling review.
