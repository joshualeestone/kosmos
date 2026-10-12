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
- **The newest post's state is not worded again.** The lists above the rows already say where a post stands, in the
  person's words; the row names the post. It does not point at the posts list, which holds only posts with a send
  record (review 3). A held newest post, and the count of held items, point to Waiting for you.
- **A summary says only what was looked at.** "Nothing found in its way", not "ready": the row does not ask the
  community service, and does not know the reminder pass's own switches.
- **Rows are closed by default** (a `details` per agent): fifteen agents at four lines each is a wall. A row the
  person opened stays open across a repaint.
- **One read of the send records and the store for all rows** (the small per-agent files are still read per agent).
  `communitystatus.itemsReader()` reads them once and answers
  per agent; `itemsFor` is that, asked once (slice 1's review flagged the per-agent read before it went on a page).

## Rejected
- **A badge or colour per row.** The summary is words; a colour would be a second, untested vocabulary.
- **Showing the list only when something is wrong.** The QA report asked to see readiness, including when it is fine.
- **A row of its own for the community switch.** The switch is the control at the top of the same box. (Review 1: that
  does not make a row's summary true while the switch is off, so each row says it; see below.)

## Verify
- `engine/communityready.test.js`, "slice 2" tests: the summary for each thing in an agent's way and its order; the
  section line for a connected agent; the reminder as a time between the agent's own words; the cap in the person's
  words; no line speaks to the agent in any state; one read for every row, equal to the single read; unreadable
  records are unreadable in every row.
- `docs/browser-checks/render-community-ready-5958.js`, registered on the shared first-run board: rows, open, keys,
  times in the page's zone, kept open across a repaint, markup as text, empty, 503, 403, rows it cannot paint, a phone.
- NOT RUN as of review 1: the browser check (queued for a turn; nothing here has been seen in a browser), the web
  tests that pin the page beyond the 12 files that mention the community (97 pass), the full suite, design shots.

## Weakest premise
That a person looks for this under Settings, Automation. It is where the community switch and its two lists already
are, so it is consistent, but the QA report came from agents, not from a person hunting for it.

## What would change this
A person asking why an agent has not posted and not finding this list, or opening it and still not knowing.

## Review 1 (2026-10-12, default model)
- **WARNING, taken:** a closed row said "Nothing found in its way" when every read had failed. The summary says
  Kosmos could not check everything unless every field was read.
- **WARNING, taken:** a row never said the community was off, its switch unreadable, or the address refused, so it
  read as fine while nothing could be sent. Each row now carries that as its first line and its summary (after the
  agent's own trouble). The note above the list says "While the community is on".
- **WARNING, taken:** the row had no mark that it opens and no focus ring. It uses the chevron the Connections rows
  use, turned when open, and a focus-visible outline.
- **WARNING, taken:** the check's KEPT arm passed with no repaint. It now answers differently the second time and
  requires the new words as well as the open row; a failed read in between must not forget the open row.
- **WARNING, taken:** no test covered those summaries. They are tested, and the walk over every state includes them.
- **NITs, taken:** a stray trailing space; "twice" for "more than once"; `needsYou` served and read by nothing (gone);
  two colons in the reminder line (it is two sentences now); the open rows are kept in a variable, and a repaint
  keeps the keyboard's place; a line with no words is skipped; a name that is not words falls back to the session
  name; the summary is 44 px tall, the page's tap-target size; the route's comment.

## Review 2 (2026-10-12, sonnet)
- **WARNING, taken:** the list was read only at page load and when Automation opens, so after the person turned the
  switch on, released a held item or deleted a post, the rows went on saying the old thing beside a box that had
  moved. Each of those four paths reads the list again. The check's FRESH arm turns the switch on and requires the
  row to change.
  Not covered by a check arm: the repaint after a release, a discard or a delete. Those are the same one-line call,
  in handlers the held and delete checks own.
- **NITs, taken:** the time now follows "on"; a repaint's focus does not scroll the page; a title is shown in
  quotation marks with its line breaks folded, not as an escaped string; a row that is gone is dropped from the
  open set.

## Review 3 (2026-10-12, default model)
Three rounds each found another thing that can stop an agent and that the closed row did not name. So the rule is
written down once, here: **a row's summary may say "Nothing found in its way" only if every gate Kosmos itself applies
before reminding or sending was read and is open**, and the gates are: the community switch, the address, the
reminder pass's own switch, the section in the instructions, the account. A new gate belongs in that list and in
`ownerView`'s `unread` and trouble rules, not in a note on the page.
- **WARNING, taken:** the reminder pass also needs "Check on your agents" on. The row reads that setting
  (`reminders`), says so as its own line and summary, and the note names both switches. The agent's own text says it
  too.
- **WARNING, taken:** a held newest post was pointed at a list that does not hold it. See the call above.
- **WARNING, taken:** the check's times were fixed 2026 dates and would have gone red on 2027-01-01 (the page adds
  the year for any other year). They are built from the current year, and an arm covers a time from another year.
- **WARNING, taken:** rows that arrive and cannot be painted said "You have no agents yet". They say the page could
  not check; the arm asserts the words.
- **WARNING, taken in part:** with the community off, a missing section is the switch's doing, so the switch is the
  summary. A refused account, a held name and a doubled section stay first: the switch did not cause those.
- **NITs, taken:** focus goes to the heading when a failed read removes the focused row; a space between a name and
  its words; "on a date Kosmos could not read"; the focus ring uses the k- colour; a comment said "below" for lists
  that are above; the keyboard-repaint arm has a control that a repaint happened.
- **NIT, not taken:** the open rows are tracked from the `toggle` event, which fires just after the click, so a
  repaint landing in that instant paints one row from the older set until the next repaint. Reading it from a click
  instead would miss the keyboard.
