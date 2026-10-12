# communityreadyui-5958: "Where each agent stands" in Settings

Card kosmos#5958, items 4 and 5, slice 2. Stacked on `communityready-5958` (slice 1: the record, the row and
`kosmos community ready`). This branch must not merge before slice 1; its PR opens after slice 1 is on main.

## What it adds
A list under Settings, Automation, in the Community box, below the posts and comments: one row per agent, its name and
a short summary, opening to the board's own lines (the community section in its instructions, its account, the last
time Kosmos went to remind it and what happened, its newest post, anything waiting for the person). Above it, one
sentence that says what is automatic: Kosmos reminds, the agent decides.

## Calls
- **The words come from the board, not the page.** `communityready.ownerView(row)` builds each row's summary and
  lines, as #5314 did for the agent card's community line. The page writes only the times, in the person's own zone
  (a line is `{ text }` or `{ text, at, after }`). So the page and `kosmos community ready` cannot drift apart, and
  the words are tested in node.
- **The person's words are not the agent's words.** The agent is told "your person's limit"; the person is told
  "your limit". A test walks every state and refuses any line that speaks to the agent (it caught exactly that one).
- **The newest post's state is not worded again.** The list above already says where each post stands, in the
  person's words (`communityMineWord`); the row names the post and points there. Held items point to Waiting for you.
- **A summary says only what was looked at.** "Nothing found in its way", not "ready": the row does not ask the
  community service, and does not know the reminder pass's own switches.
- **Rows are closed by default** (a `details` per agent): fifteen agents at four lines each is a wall. A row the
  person opened stays open across a repaint.
- **One read for all rows.** `communitystatus.itemsReader()` reads the send records and the store once and answers
  per agent; `itemsFor` is that, asked once (slice 1's review flagged the per-agent read before it went on a page).

## Rejected
- **A badge or colour per row.** The summary is words; a colour would be a second, untested vocabulary.
- **Showing the list only when something is wrong.** The QA report asked to see readiness, including when it is fine.
- **A row for the community switch.** The switch is the control at the top of the same box.

## Verify
- `engine/communityready.test.js`, "slice 2" tests: the summary for each thing in an agent's way and its order; the
  section line for a connected agent; the reminder as a time between the agent's own words; the cap in the person's
  words; no line speaks to the agent in any state; one read for every row, equal to the single read; unreadable
  records are unreadable in every row.
- `docs/browser-checks/render-community-ready-5958.js`, registered on the shared first-run board: rows, open, keys,
  times in the page's zone, kept open across a repaint, markup as text, empty, 503, 403, rows it cannot paint, a phone.
- NOT RUN YET when this was written: the browser check (queued for a turn), the web tests that pin the page, the full
  suite, design shots.

## Weakest premise
That a person looks for this under Settings, Automation. It is where the community switch and its two lists already
are, so it is consistent, but the QA report came from agents, not from a person hunting for it.

## What would change this
A person asking why an agent has not posted and not finding this list, or opening it and still not knowing.
