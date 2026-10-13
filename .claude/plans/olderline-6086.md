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
- `docs/browser-checks/render-dm-earlier-5841.js`: rewritten for scrolling. 32 arms.

## Decided
- **The indicator floats; it does not take a row.** A line that appears above the thread and then goes would push
  every message down and back by its own height, which is a jump. Rejected: a row inside the thread (the thread's
  markup is rewritten by its paint, and sixteen checks read its children).
- **One failed load stops the automatic asking.** A scroll event fires many times a second; a failing route must not
  become a stream of requests. The line says it failed and Try again is the way on. This is the one button left.
- **A thread too short to scroll loads earlier pages by itself.** It has no scroll to wait for, and without this
  its earlier messages would be unreachable now that there is no button. With 200 messages on screen this does
  not arise in a real conversation; it does in a small window with a short tail, and in the check.
- **Not while a search is on.** A search shortens the thread; that is not a reader at the top.
- **No "hide".** Earlier messages stay loaded until another agent's conversation is opened, as before.

## Weakest premise
That keeping the reader's place is already done by `setThread`'s anchor and I have added nothing that breaks it.
I read that code; the check measures it (the row the reader was on, before and after a page lands, within 2 px),
but on a fixture of tall rows in a 300 px thread, not on 200 real messages with images that load late.

## Not in this slice
- A keyboard-only way to load earlier messages other than scrolling the thread (PageUp works where the thread has
  focus). The button was that way, and the ruling removes it.
- Screen capture of a 700-message conversation (the card's done-when). A browser check is the measurement here.
- Any change to the server route or the page size.

## Verify
- The page's main script parses (`node --check` on the extracted script). Every `web*.test.js`: 2773 pass.
- The source-sweep guards: 134 pass. Both surface-map tests pass.
- NOT RUN YET: the rewritten browser check (waiting for a light-lane turn), the sixteen checks the surface gate
  names for the conversation thread, the full suite.
