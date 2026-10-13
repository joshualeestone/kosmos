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
  - A small line floats over the top edge of the thread only while a page loads ("Loading earlier messages…"), or to
    say a load failed, with Try again. It sits in a wrapper with no height, so it never moves a message.
  - `earlierMore` no longer scrolls the reader to the first new row. Nothing moves them: the thread's own paint
    (`setThread`) already keeps the message a scrolled-back reader is on where it was (#1926's anchor).
- `docs/browser-checks/render-dm-earlier-5841.js`: rewritten for scrolling. 41 arms. Its README row.

## Decided
- **The indicator floats; it does not take a row.** A line that appears above the thread and then goes would push
  every message down and back by its own height, which is a jump. Rejected: a row inside the thread (the thread's
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
- **A failed load is said only while the reader is at the top.** The line lies over the first message on screen.
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
- **The rewritten browser check, in a real browser, at 9fda34891 (15:05 CDT): exit 0, 41 arms passed, 0 failed.**
  Among them: opened at the newest message nothing is asked; the line is over the top of the thread while a page
  loads and not between the newest message and the composer; "THE VIEW DOES NOT JUMP: the message the reader was
  on is where it was" (within 2 px); showing and hiding the line does not move the thread.
- Its first run was red on 5 arms, and the fault was the check's: it opened another agent's conversation with a
  bare repaint, so the next agent inherited "scrolled to the top" and loaded at once. The app forgets the reader's
  place when it opens another agent (its agent-open block); the check now does the same.
- NOT RUN YET: the sixteen other checks the surface gate names for the conversation thread (queued as one turn),
  the full suite.

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
