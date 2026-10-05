# msgcopy-5312: Copy message and Copy message id (kosmos#5312)

Josh, #admin, 2026-10-05 11:02 CDT: two buttons instead of the one "copy message reference", a "copy message" and a
"copy message id", so the whole message text can be copied. Splinter's calls on the card: Copy message first; the labels
are Josh's words; a long message copies in full; attachments copy as their file names.

## Finished looks like
- The hover bar (room and direct conversation; pointer and touch) starts Copy message, then Copy message id, then the
  emoji, the smiley, read aloud, Reply (Reply stays last, #4358).
- Copy message copies the message as written (its record's text, not the screen's tidied words), in full, then each
  attached file's name on its own line; a post that is only files copies the names once. Toast: "Copied the message."
- Copy message id copies #4631's reference ("message 530 in Kosmos Growth"), unchanged.
- Right-click (and ctrl-click on Windows) opens a menu with both, Copy message first and focused; the arrow keys move
  between them. An outside guest's row (no id) offers Copy message alone.
- On a touchscreen the bar keeps #4409's seven buttons: its Copy button opens the menu with both items (a phone has
  no right-click, and an eighth button made the DM's open bar cover the person's own message under it).
- render-msgref-4631.js asserts all of it (C1 to C6) on Windows and Mac platforms, a touchscreen, and real WebKit.

## Decided
- Copy message reads the RECORD (PJ_ROOM_POSTS, DM_ROWS), so what is copied is what was written: a leading
  "April:" the screen drops (#4873) is kept, and nothing is cut. A row with no kept record (an outside guest) copies
  what the row shows, without its name, tag, time and buttons.
- The copy icon (two sheets) moved to Copy message; Copy message id wears a # with its faint number.
- A failed copy's toast never shows the words (a message can be long); it says to select and copy instead.
- On a touchscreen Copy opens the menu (Copy message, Copy message id) and Copy message id is not in the bar. Tried
  first: eight buttons with the gap at 2px (308px, one line in a 375px thread), but the DM's open bar then covered the
  visible corner of the person's own message under it, so a tap meant to close the bar hit Reply
  (render-dm-tapreact-718). Rejected: smaller targets (the room's 36px is #3811's).
- A store is read only when it was painted for what is on screen (PJ_ROOM_POSTS_OF / DM_ROWS_OF, the reply code's own
  test): one left from another project or agent could hold a different message under the same key.
- A row a repaint detached (the menu was open), and a DM reply still on its way (pending:), have no record, so they copy
  their own words through the same screen fallback an outside guest's row uses (C4 pins it on the real renderer).
- The person's own rows in a direct conversation have no hover bar (never had, #4256), so on a touchscreen, where there is
  no right-click, they copy as before, by the system's long-press selection. Giving them a bar is out of this card.
- On a touchscreen Copy is named "Copy message or its id" with aria-haspopup="menu"; with a pointer it is "Copy message".
- "As written" includes markdown: a formatted message pastes with its marks (**bold**, [text](url), fences), which is
  what an agent reading the paste wants. Not a bug to file.
- A touchscreen with a keyboard (an iPad with one): Enter on Copy closes the bar before the menu opens, so Escape returns
  focus to the page, not the message. Accepted: rare, nothing is lost, and the bar it would return to is closed.
- Checked: the touch menu in the room (render-msgref-4631 C6) and in a direct conversation (render-dm-tapreact-718, four
  phone sizes), in Chromium touch emulation. Real iOS WebKit is not
  driven here; R12 covers WebKit's pointer menu.

## Weakest premise
That a phone user finds Copy message one tap further in (Copy, then Copy message) acceptable. Josh asked for two
buttons; on a phone it is one button and a two-item menu, so the bar does not cover the message under it.
