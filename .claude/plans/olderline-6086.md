# olderline-6086: earlier messages load by scrolling back (kosmos#6086)

## Why
In a long direct conversation the line "Showing the latest N. M older messages are still kept. [Show earlier
messages]" stood under the newest message, beside the composer, on every visit (from #5841 piece 1). A person read
it as a notice that would not go away. Josh, 2026-10-13 14:44: do it the way a chat does. Scroll back as far as is
loaded, a waiting indicator while the older batch loads, repeat to the first message. No button, nothing under the
newest message, and the view must not jump. The person who reported it is at message 721.

## Change (the smallest real slice; priority card)
- `web/index.html`
  - The line and both buttons under the thread are gone.
  - `earlierNearTop()`: when the reader is within 120 px of the top of what is loaded and there is more before it,
    it asks for the page before (the #5841 paging: `EARLIER`, `earlierMore`, the `thread/older?before=<n>` route,
    200 messages a page). Called on the thread's scroll and after each paint.
  - While a page loads, a small line floats over the top edge of the thread ("Loading earlier messages…"). It sits in
    a wrapper with no height, so it never moves a message.
  - A load that FAILED is said in a row of its own above the thread, with Try again, and stays until the person
    presses it.
  - `earlierMore` no longer scrolls the reader to the first new row. Nothing moves them: the thread's own paint
    (`setThread`) already keeps the message a scrolled-back reader is on where it was (#1926's anchor).
- `docs/browser-checks/render-dm-earlier-5841.js`: rewritten for scrolling. 42 arms. Its README row.

## Decided
- **While a page loads the indicator floats; it does not take a row.** A line that appears above the thread and then
  goes would push every message down and back by its own height, which is a jump. Rejected: a row inside the thread (the thread's
  markup is rewritten by its paint, and sixteen checks read its children).
- **One failed load stops the automatic asking.** A scroll event fires many times a second; a failing route must not
  become a stream of requests. The line says it failed and Try again is the way on. This is the one button left.
- **A thread too short to scroll loads earlier pages by itself.** It has no scroll to wait for, and without this
  its earlier messages would be unreachable now that there is no button. It is rare with 200 messages on screen,
  but real: after a rollover at the 1000 cap the newest file can hold a few rows with a long chain before it, and
  such a conversation loads a page each time it is opened.
- **One failed load stops the asking, and so does a thread that moves twice.** The older route can answer a
  different range than asked when the thread changed under it; the first time the page starts again, the second
  time running it is a failed load (review 1: with no button this would otherwise be asked on every scroll and
  every poll, for ever).
- **A failed load takes a row, and stands wherever the reader scrolls.** It stays until the person acts, so floating
  it would leave it lying over the first message (review 2). And it is not tied to being at the top: once it has a
  row, showing and hiding it with the scroll position would change the thread's height as the reader scrolls
  (review 3 found that this moves them, and near the 120 px line can show and hide without end). The one shift
  when "loading" turns into "failed" is the cost.
- **Not while a search is on.** A search shortens the thread; that is not a reader at the top.
- **No "hide".** Earlier messages stay loaded until another agent's conversation is opened, as before.

## Weakest premise
That keeping the reader's place is already done by `setThread`'s anchor and I have added nothing that breaks it.
I read that code; the check measures it (the row the reader was on, before and after a page lands, within 2 px),
but on a fixture of tall rows in a 300 px thread, not on 200 real messages with images that load late.

## Not in this slice (each is a real limit, found by review 1 or by me)
- **No keyboard-only way to load earlier messages.** The thread is not focusable, so PageUp does not reach it; the
  button was the keyboard's way and the ruling removes it. Try again, after a failure, is reachable.
- **Earlier messages cannot be loaded while a search is on,** and nothing on screen now says a search covers only
  what is loaded (the removed line was the only place that said so). A search that finds nothing at message 721
  reads as "not in this conversation" until the reader has scrolled back.
- **The reader's place is held when a page lands, not afterwards.** Pictures in the 200 new rows above them that
  finish loading later push them down, as late pictures always have for a scrolled-back reader.
- **Loaded rows only grow** until another agent's conversation is opened; each 5 s poll rebuilds the markup for all
  of them. Fine at 721 messages; a reader thousands back pays for it.
- The live region is toggled with `hidden`, which some screen readers announce unreliably.
- Screen capture of a 700-message conversation (the card's done-when). A browser check is the measurement here.
- Any change to the server route or the page size.

## Verify
- The page's main script parses (`node --check` on the extracted script). Every `web*.test.js`: 2773 pass.
- The source-sweep guards: 134 pass. Both surface-map tests pass.
- **The rewritten browser check, in a real browser: exit 0 at 9fda34891 (15:05 CDT, 41 arms) and again at 9bb44bc09
  (15:11, 42 arms, 0 failed).** Among them: opened at the newest message nothing is asked; the line is over the top of
  the thread while a page loads and not between the newest message and the composer; "THE VIEW DOES NOT JUMP: the
  message the reader was on is where it was" (top 117 before and after); showing and hiding the line does not move
  the thread (115 and 115).
- Its first run was red on 5 arms, and the fault was the check's: it opened another agent's conversation with a
  bare repaint, so the next agent inherited "scrolled to the top" and loaded at once. The app forgets the reader's
  place when it opens another agent (its agent-open block); the check now does the same.
- **The sixteen other checks the surface gate names for the conversation thread, each run in a real browser on this
  branch, each exit 0:** thread-steady-3966 (at 59c49dcf1) and, at 9bb44bc09, dm-sendjump-4639, dm-sideways-3969,
  dm-owes-4340, unread-edge-3743, dm-tapreact-718, newlook-4470, msgref-4631, dm-chatfirst-718 (413 arms),
  dm-reply-4256, signin-visible-3892, dm-reactions-3650, voice-4409, dm-phone-718, agentdm-3414, rename-4421.
  The per-check trailers are on an empty commit.
- **NOT run at the final head:** review 3's change (the failed row no longer tied to the top) came after all of
  the above. It touches only how a failure is shown, and changes two arms of this branch's own check. My rerun of
  that check was waiting behind a suite when the PR was opened, so CI's browser run on the PR is its measurement.
- NOT RUN: the full suite locally (CI runs it).

## Review 1 (2026-10-13, default model), at 9bf41ff76
0 BLOCKER, 8 WARNING, 2 CONVENTION, 5 NIT. Not converged.
- **WARNING, taken:** a "the thread changed under the page" answer had no bound once reaching the top asks by
  itself. Twice running is now a failed load.
- **WARNING, taken:** the failure line stayed over the top row wherever the reader scrolled. It shows at the top only.
- **WARNING, taken in part:** Try again hid itself and dropped keyboard focus to the page; focus goes to the
  conversation box. The other half (no keyboard-only way to load) is under Not in this slice.
- **WARNING, taken:** two arms rested on a 150 ms read inside a 500 ms delay. The fixture now holds its answer on a
  promise the check releases after it has measured.
- **WARNING, taken:** arms for near-the-top (60 px asks, 200 px does not), a search on, a moving thread, and
  another agent opened while a page is on its way.
- **WARNING x3, stated under Not in this slice:** search; pictures that load late; loaded rows only grow.
- **CONVENTION, both taken:** the check's README row; this file's claim that a short thread "does not arise".
- **NIT, taken:** taps pass through the line except on its button; a garbled comment.
- **NIT, not taken in this slice:** the live region's markup; the phone rule that hides the line while the keyboard
  is up; three comments elsewhere that still quote the old words; the retry button's id.
- The reviewer traced re-entrancy (one request from the three callers), the anchor that keeps the reader's place
  (it survives a prepend, and scrollTop 0 anchors the first row), and that the thread is height-bounded in every
  layout it found, so it cannot run to the first message by itself on open.

## Review 2 (2026-10-13, sonnet), at 59c49dcf1
0 BLOCKER, 3 WARNING, 0 CONVENTION, 3 NIT. Not converged. Asked whether anything left would harm a person using it:
"no wrong or lost message, no unbounded request loop, and no conversation that can't be used".
- **WARNING, taken:** the count of "moved" answers was never started again for another agent, so one later move
  could show as a failure at once. It starts again when another agent's conversation is opened.
- **WARNING, taken:** the failure line floated over the first message for as long as the reader stayed at the top.
  A failure has a row of its own above the thread.
- **WARNING, an observation, no change:** "Loading" shows wherever the reader is; it is short-lived.
- **NIT x3, no change:** where focus goes after Try again; the pointer-events pair works; the check's hold gate
  would hang a second held request (each arm holds one).

## Review 3 (2026-10-13, default model), at 9bb44bc09
0 BLOCKER, 2 WARNING, 3 CONVENTION, 4 NIT. Not converged.
- **WARNING x2, taken, and it was the last fix that caused them:** with its own row, the failure was still shown only
  near the top, so the thread's height followed the scroll position: a reader could be moved by it, and in a short
  thread near the 120 px line it could show and hide without end. The failure now stands wherever the reader
  scrolls, the scroll no longer repaints it, and the check measures that the line and the thread stay put.
- **CONVENTION x3, taken:** two comments that contradicted the code, and this file's stale statements.
- **NIT, taken:** the class is cleared where the line is hidden on a failed read; a redundant field removed.
- **NIT, not taken:** the gap fill's own "moved" path, which predates this branch.
- The reviewer checked the declaration order of the new counter (no use before it exists) and that asking is
  bounded on every path.

## Review 4 (2026-10-13, sonnet), at 2414678b6: converged
0 BLOCKER, 0 WARNING, 0 CONVENTION, 3 NIT, none taken (each is wording, and taking them would put a fifth commit
no reviewer has read on a change a person is waiting for): two places hide the line without clearing a class that
then has no effect; the check's header and one label still say "at the top"; one CSS comment says "takes no room"
of a line that takes a row when a load has failed. Asked first whether anything would harm a person using it: no
wrong or lost message, no unbounded request loop, no state the reader cannot get out of.
The reviewer confirmed the failed row now depends only on state, not on the scroll position, and that the two
changed arms fail if that dependence comes back.

## One more check the surface gate names: render-talk-fill-2622.js
Found when I ran the gate after the sixteen trailers: the Try again handler names the conversation box, a surface
that check claims. It is about the box filling its height, which this change's new wrapper sits inside, so it is a
real question and not only a word in a line. NOT RUN when the PR was opened (waiting behind a suite here); CI's
browser run measures it, and its trailer is added only after it has passed. Until then the PR's `test` workflow is
red on that gate, on purpose.

## Run at the final code head (2026-10-13, 15:59 and 16:00 CDT, at c847bc9eb), in a real browser
- This branch's own check, with review 3's change in it: exit 0, 43 arms passed, 0 failed. The failure still stands
  when the reader scrolls to the newest message, and neither it nor the thread moved with the scroll.
- `render-talk-fill-2622.js` (the conversation box filling its height, which the new wrapper sits inside): exit 0,
  59 arms passed, 0 failed. Its trailer is on an empty commit after this one.
So nothing under "NOT run at the final head" above is outstanding: both items have now run.
