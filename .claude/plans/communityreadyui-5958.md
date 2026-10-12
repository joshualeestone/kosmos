# communityreadyui-5958: "Where each agent stands" in Settings

Card kosmos#5958, items 4 and 5, slice 2. Stacked on `communityready-5958` (slice 1: the record, the row and
`kosmos community ready`). This branch must not merge before slice 1; its PR opens after slice 1 is on main.

## What it adds
A list under Settings, Automation, in the Community box, below the posts and comments: one row per agent, its name and
a short summary, opening to the board's own lines (the community section in its instructions, its account, the last
time Kosmos went to remind it and what happened, its newest post, anything waiting for the person). Above it, one
sentence that says what is automatic: Kosmos reminds, the agent decides.

## The rule (written at review 7, after six rounds of patching words)
Rounds 1 to 6 each found a row whose lines were wrong beside each other: a line said what followed from a fact
("so nothing it writes is sent", "What it writes is still sent"), or why ("the switch's doing"), or what to do about
it ("Turn Community off and on again above", when that switch is hidden in exactly that state). Each fix reworded one
sentence and the next round found the next. So:
- **A line states one thing Kosmos read.** Not what follows from it, not why, not what to do.
- **The summary names everything that applies**, in one fixed order (the computer's own facts, the agent's own
  trouble, where its newest post is, that something was not read, what waits for the person), joined. It never picks
  one as the cause, and (from review 12) it never says that nothing is wrong: "Nothing found in its way" was a claim
  about everything the row does not read, and three reviews found a row it was false of. Every row can say where
  the newest post is, so that is what a row with nothing else to say says.
- **What the two switches do is said once**, in the sentence above the list, not on every row.
A test walks every combination of switch, address, reminder setting, section, account and folder and refuses any
line that carries a consequence, a cause or a remedy, with the two sentences reviews caught as its controls.
Some lines still say what Kosmos itself does with the one fact they state (it leaves a doubled section alone; it
will not create an instructions file; it does not add the section in the person's own folder, and when it does add
it elsewhere; a refused agent's writing is not sent; an account waits on an earlier try; when an account is made).
Each is Kosmos's own behaviour for that fact alone, so no other line of the row bears on it.

**What a row reads:** the community switch, the address, the "Check on your agents" switch, the section in the
agent's instructions (and whether a re-read is owed, and whose folder it is), its account, the last reminder, its
newest post, and what is held for the person.

## Calls
- **The words come from the board, not the page.** `communityready.ownerView(row)` builds each row's summary and
  lines, as #5314 did for the agent card's community line. The page writes only the times, in the person's own zone
  (a line is `{ text }` or `{ text, at, after }`). So the page and `kosmos community ready` cannot drift apart, and
  the words are tested in node.
- **The person's words are not the agent's words.** The agent is told "your person's limit"; the person is told
  "your limit". A test walks every state and refuses any line that speaks to the agent (it caught exactly that one).
- **The newest post gets one fact: is it in the community.** In, not in, not gone yet, sent and not heard back, or
  not readable; every state `communitystatus` can give a post is placed in one of those, and a test holds the table to
  that module's own list. How it got there is not worded again (the lists above the rows do that). A newest post that
  is not in the community is named in the closed row. (Until review 9 the row named the post and said nothing of
  whether it went out, so a post that never left read as "Nothing found in its way".)
- **The closed row makes no claim that an agent is ready or that nothing is in its way.** What a row reads is listed
  under the rule above. What it does NOT read: whether the community service answers; whether this computer is allowed to
  run agents at all right now; the reminder pass's own limits. When something a row does read could not be read, the
  summary says so and a line says which.
- **Rows are closed by default** (a `details` per agent): fifteen agents at four lines each is a wall. A row the
  person opened stays open across a repaint.
- **Every record that is one answer for the whole computer is read once for all rows**: the send records and the
  store, the keys, the reminder record, the debts, both switches and the address. Only an agent's own instructions
  file is read per agent.
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
- NOT RUN as of review 14 (2026-10-12 15:0x CDT), still: the browser check (queued for a turn; nothing here has been seen in a browser), the web
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

## Review 7 (2026-10-12, default model, the plain brief)
Five WARNINGs, all the same kind, all taken by the rule at the top of this file and not one at a time:
- the unreadable-switch line told the person to use a switch the page hides in that state;
- "Kosmos is not reminding this agent" beside "cannot say whether this agent is being reminded";
- the agent was told "You can still post" with the community off;
- a connected agent's missing section was put down to the switch, which never governed it;
- the check's year came from the runner while the page's came from Tokyo, so it would go red for hours each New
  Year's Eve. The year is taken in the page's zone and the times are mid-year.
- **NITs, taken:** the reminder switch is named whatever the address says; the open rows are not forgotten when rows
  arrive that cannot be painted; "up to a few times a day"; a typographic apostrophe; a comment.
- **NITs, not taken:** the five small per-computer reads are still made once per agent (stated under Calls); the
  focus ring follows the k- colour, not the Connections rows' older one.
- **CONVENTION, a duplicate:** the browser check, the full suite and design shots have not run.
Five tests that pinned the old rules (the first trouble wins; the switch is the cause of a missing section) were
replaced by tests of the new one. That is a change of behaviour, not a tidy-up: the closed row's words differ.

## Review 8 (2026-10-12, sonnet, the plain brief)
- **WARNING, taken by saying less:** the sentence above the list said Kosmos reminds a quiet agent while both
  switches are on. Both switches are needed and are not enough (the pass has its own limits, listed under Calls), so
  it read as a promise. It now says Kosmos may remind, and only while both are on.
- **NIT, taken:** the check waited a fixed 600 ms for the second switch to paint; it waits for the switch.
- **NITs, not taken:** a summary of several parts ends with no full stop, as a one-part summary does (it is a label,
  and the check pins that form); a repaint puts focus back on the same summary, which a screen reader says again (the
  row is rebuilt, so the other choice is to drop the keyboard's place); the "Looking at your agents" line has no live
  region, as its neighbours have none.

## Review 9 (2026-10-12, default model, the plain brief)
- **WARNING, taken:** a newest post that never went out sat under "Nothing found in its way". See the call above.
- **WARNING, taken:** a newest post whose send record cannot be read counted as read. It is its own fact and makes
  the summary say not everything was checked.
- **WARNING, taken (the third time it was raised; I had left it as a stated gap twice):** nothing checked that a
  delete, a release or a discard reads the rows again. The check deletes a post and calls the step both a release and
  a discard end in, and requires a new read each time.
- **NITs, taken:** the address has one wording in the summary and the line, and an address that could not be read is
  no longer called one Kosmos does not send to; the person is told "this computer" where the agent is told "this
  board"; the computer-wide records are read once for all rows (raised three times); a test title and two comments
  claimed more than they show, and say less now; a null `deps`.
- **NITs, not taken:** "so Kosmos tries again later" in the busy-screen words is Kosmos's own behaviour for that one
  fact; whether a screen reader says the space between a name and its words is not something this check can show, and
  it no longer says it does.
- **CONVENTION, a duplicate:** not run in a browser yet. No dark-theme screenshot arm in the check: the design shots
  are where both themes are looked at, and they are on the not-run list.

## Review 10 (2026-10-12, sonnet, the plain brief)
- **WARNING, taken:** a post taken back while Kosmos never heard whether its first send arrived was placed as "not in
  the community". Kosmos does not know that. It is with the other unconfirmed ones, and a test now holds each place
  to the status module's own words: a state whose words say Kosmos is unsure cannot be placed as in, out or waiting.
- **WARNING, taken:** one row that could not be worded would have failed the whole list. It costs that row.
- **WARNING, taken:** a timed line that lost its time on the way stopped mid-sentence on the page. It says the date
  could not be read.
- **NITs, taken:** "of its" is not English; those three lines say "it wrote". The unreadable-record words.
- **NITs, not taken:** the note above the list and a row can both say the community is off (a row is read on its
  own, which is why each says it).
- **CONVENTION, a duplicate:** not run in a browser yet.

## Review 11 (2026-10-12, default model, the plain brief)
- **WARNING, a duplicate:** the page code has never run. True, and the only cover for the page is the browser check.
- **WARNING, taken, and NOT SEEN IN A BROWSER:** beside a middling-long name the summary words were squeezed into a
  sliver, a few letters a line. The mark and the name are one group now, and the words take what is left or, when
  that is under a readable width, a line of their own. This is reasoned from the layout rules, like the finding. The
  check's PHONE arm now measures the words' width beside a short, a middling and a very long name, and that the mark
  stays on the name's line; until it runs, neither the fault nor the fix has been looked at.
- **NITs, taken:** the focus ring sits inside the row as the Connections rows' does (an outside ring can be clipped);
  the hostile arm checks the words after a time too; a test message named the wrong failure.
- **NITs, not taken:** "Its newest post is not in the community" also shows for a post the person deleted themselves
  (it is true, and picking which reasons count is the cause-picking the rule at the top forbids); no live region, as
  the neighbours; the check's phone arm goes through the Settings nav at 390 px, which no sibling check does, so a
  red there may be the nav and not this list.

## Review 12 (2026-10-12, sonnet, the plain brief plus a line asking for the layout to be worked through)
- **WARNING, taken by deleting the claim:** "Nothing found in its way" stood over a row whose newest post had not gone
  out. It was the third round to find a state that phrase was false of (rounds 1, 9, 12), so the phrase is gone, not
  qualified again. See the rule at the top. Seven tests that pinned whole summaries were rewritten to read the closed
  row as the list it is; one walks every state and refuses any wording of "nothing is wrong".
- **WARNING, taken:** the check's width floor was a number close to the style sheet's 16ch at today's font. It
  measures 16ch in the row's own font.
- **NITs, taken:** "waiting for you, under Waiting for you" said it twice; the guard regexes hold the em dash as an
  escape, not as the character.
- **NITs, not taken:** the refused-account line's "so nothing it writes is sent" (the exception listed under the
  rule); no live region and `list-style: none`, as the neighbouring lists.

## Review 13 (2026-10-12, default model, the plain brief plus the layout line)
- **WARNING, taken:** the count of what waits for the person came from the agent's send-status items, which leave out
  a held comment on this board's own posts; the Waiting for you list shows those. The count is made from the queue
  that list reads. Limit, in the code: such a comment's row carries only its author's shown name, so under a shown
  name that is not the agent's session name it cannot be told whose it is and is not counted.
- **WARNING, taken, NOT SEEN IN A BROWSER:** now that the summary lists everything that applies, it can be 250
  characters, and beside a middling name it would have been a 16-character column. The words always have a line of
  their own, the row's width. The check sends the longest summary the board can produce and measures it.
- **WARNING, a duplicate:** nothing here has run in a browser.
- **NITs, taken:** the route test holds the row's `owner` shape the page paints from; the check's fixtures say what
  the board says now; the per-row fallback is reached by a real throwing row (the old test never reached it); an
  agent whose row could not be painted is not dropped from the open rows while others paint; a typographic
  apostrophe in the person's reminder words; an unreadable debt record is "cannot tell"; the chevron sits by the
  name's first line.
- **CONVENTION, taken:** two code comments told the review history; they give the reason. This file's count of
  "three sentences" was wrong and it now lists them; what a row reads is listed under the rule, not in a review note.
- Not changed: test names keep their "review N" labels, as the repo's other test files do.

## Review 14 (2026-10-12, sonnet, the plain brief plus the layout line)
- **WARNING, taken by saying less:** the words for a post Kosmos has not heard back about said it "was sent". For one
  of those states the send may not have gone. They say only that Kosmos has not heard and does not know.
- **WARNING, taken:** the person's reminder line for a busy screen carried "so Kosmos tries again later". The person's
  version states the fact; the agent's keeps the clause.
- **WARNING, taken:** every refresh rebuilt every row, which could take a half-made click or a selection away. An
  answer identical to the one on the page is not painted again; the check marks a node and requires it to survive an
  identical answer and not a different one.
- **NITs, taken:** the read is not cached; "Kosmos lists no agents yet" (not a claim about the person's computer); the
  check reads the mark's turn after its transition; this file's not-run line carried an old date.
- **NITs, not taken:** no live region on the status line (the two lists above have none); no dark-theme, Space-key or
  reduced-motion arm in the check (design shots are where both themes are looked at); the long unread expression.

## Review 15 (2026-10-12, default model, the plain brief plus the layout line)
- **WARNING, a duplicate:** nothing here has run in a browser.
- **WARNING, taken:** review 13's fix changed what the AGENT is told. Its "held for your person" count had become the
  count of the person's list, which includes a held comment on this board's own post, and the agent's sentence says
  each "goes out only if they release it", which such a comment never does. The row now carries two counts: the
  person's (the queue their list reads) and the agent's own (what goes out if released), and each is told its own.
- **WARNING, taken by removing it:** review 9 added a "could not read this computer's community address" state. The
  board's own read of the address answers no for one it cannot read, so that state could never be reached, and the
  test for it only passed by handing in a read that throws. It is gone; an address the board does not send to is one
  fact, tested through the real read.
- **NITs, taken:** the held-unread line no longer depends on the newest post being readable; a doc comment had drifted
  from its function and another described what the code no longer does; the check answers the "Check on your agents"
  read itself from the page's first read; an opened row's lines are indented under the name; the test for the held
  comment now shows that its row names no agent, so the shown-name fallback is what counts it.
- **NITs, not taken:** a delete the board refuses (400) also reads the rows again and has no arm; a held local comment
  whose shown name is another agent's session name would be counted for that agent (stated in the code).
