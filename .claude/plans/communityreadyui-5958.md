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
- **A summary says only what was looked at.** "Nothing found in its way", not "ready". What a row reads is listed
  under Review 3. What it does NOT read: whether the community service answers; whether this computer is allowed to
  run agents at all right now; the reminder pass's own limits (a few a day, an hourly limit on messages to agents, only
  agents that have gone quiet). So an agent with "Nothing found in its way" may still go unreminded for a while, and
  its reminder line is where that shows. When something a row does read could not be read, the summary says so and a
  line says which.
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
written down once, here: **a row's summary may say "Nothing found in its way" only if each of these was read and is
open**: the community switch, the address, the reminder pass's own switch, the section in the instructions, the
account. A new one belongs in that list and in `ownerView`'s `unread` and trouble rules, not in a note on the page.
(Narrowed in review 6: the first wording said "every gate Kosmos itself applies", which this row does not read.)
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

## Review 4 (2026-10-12, sonnet)
The same rule as review 3, from the page's side: **any control whose setting a row names reads the list again when it
is saved.** Those controls are the community switch and "Check on your agents"; Release, Discard and Delete change
what is held and the newest post.
- **WARNING, taken:** saving "Check on your agents" did not read the list again, so the rows kept the opposite claim.
  It does now, and the check's FRESH arm presses it.
- **WARNING, taken:** the community switch's refresh sat behind its stale-read guard, so a save that landed while a
  newer read of the switch was in flight left the rows unread. Both switches refresh on a saved answer, before the
  guard.
- **WARNING, taken:** with the community off, the closed row said nothing of items waiting for the person. What waits
  for them is added to whatever else the summary says.
- **NIT, taken:** a held newest post said where it waits twice. The count line says it once.
- **NIT, not taken:** each repaint sets `open` on a row, which queues a toggle event whose handler writes the same
  value; the "Looking at your agents" line has no timeout and no live region, as the two lists above it have none.
- **CONVENTION, not a change:** this file's "not run" list is still true and stays until those runs happen.

## Review 5 (2026-10-12, default model)
- **WARNING, taken by deleting the claim:** review 3's own line for the reminder switch ended "What it writes is still
  sent", which is false beside a refused account. That sentence is gone; the line says only what that switch does.
- **WARNING, taken:** a summary could say something was not checked while no line under it said what. An unreadable
  reminder setting and an unreadable held count each have a line, and a test requires one for every unread state.
- **WARNING, a duplicate:** the browser check, the wider web tests, the full suite and design shots have not run.
  True, recorded above, and the reason this branch has no proof file yet.
- **CONVENTION, taken:** this file said the row does not know the reminder pass's switches. It reads them now.
- **NITs, taken:** the open set is read from the page's rows at the start of a repaint; focus goes to the heading when
  a good read no longer has the focused agent; the TIME arm runs in a fixed zone that is not UTC and has a control for
  it; the no-agent-voice walk covers signed-out, delivered and unconfirmed and more phrases; a row with only held
  items gives the count; the chevron comment; the README row names the arms.
- **NITs, not taken:** the three refreshes after a release, a discard and a delete have no arm of their own (stated
  under Review 2); the list is read at page load as its two neighbours are.

## Review 6 (2026-10-12, sonnet). Its brief carried one line the standard brief does not
I told this reviewer not to report "the browser check and the full suite have not run" as a finding. That narrows a
blind reviewer's brief, which the loop does not allow, so this round does not count toward convergence whatever it
found. The next round uses the plain brief.
- **WARNING, taken:** a row with held items and something unread said only what waits. The summary says both.
- **WARNING, taken by narrowing the claim:** review 3's rule here said the row reads every gate Kosmos applies. It
  does not (see the call above for what it does not read). The rule now lists what is read, and no more.
- **NIT, taken:** an unreadable "re-read owed" and an unreadable "whose folder" each made a claim-free row look fully
  read. Each has its own words and counts as unread.
- **NITs, not taken:** the toggle event (review 3's nit again); the KEYS arm leans on the row being closed, which the
  ROWS arm asserts; the check's year comes from the runner and the page's from Tokyo, which differ for nine hours a
  year.
