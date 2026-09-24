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
- Agents first, ranked by the four-class total the table shows (the engine
  sends them by output), by shown name. Then "Sessions outside any agent's
  folder" and, when present, "Folders shared by more than one agent", both in
  the muted Other color with a lighter label, so neither reads as an agent.
- "% total" is of the page's grand total, as in the model table, so unmatched
  tokens leave the rows short of 100%.
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

## Phone width
Below a 420px container the shared table grid drops the share-bar column and the
name takes the width. Before this, both the per-model and per-agent tables
overflowed at 390 wide (names cut to "A..", "% total" clipped), the defect the
0.6.90 closeout recorded on this card for the model table. The % column carries
the same fact as the bar, so nothing is lost.

## Verification
- web.token-usage-2617.test.js runs the real renderers: rows, ranking by the
  shown total (not the engine's output order), the four-class total, share of
  the grand total, muted color, title, escaping, the note, paintUsage wiring.
- docs/browser-checks/render-token-usage-2617.js asserts the rendered block
  (rows, header, bars paint, no overflow, note, placement), the 390-wide fit of
  both tables, and that the block stays hidden without byAgent. Run in full with
  no board process, through a session-local preload (not checked in) that gave
  each browser context routing to serve web/index.html, because starting a
  board was refused in my session. Checked in, the check runs against a board
  as documented in its header. All assertions
  pass on this branch; against origin/main's page, 14 fail, including the
  per-model 390-wide fit. The hide path is checked by repainting a shown block
  in the same page life (a reload would hide it by markup alone), and breaking
  that path fails the check.
