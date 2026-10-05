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
- On a 375px phone the touch bar stays one line inside the thread.
- render-msgref-4631.js asserts all of it (C1 to C6) on Windows and Mac platforms, a touchscreen, and real WebKit.

## Decided
- Copy message reads the RECORD (PJ_ROOM_POSTS, DM_ROWS), so what is copied is what was written: a leading
  "April:" the screen drops (#4873) is kept, and nothing is cut. A row with no kept record (an outside guest) copies
  what the row shows, without its name, tag, time and buttons.
- The copy icon (two sheets) moved to Copy message; Copy message id wears a # with its faint number.
- A failed copy's toast never shows the words (a message can be long); it says to select and copy instead.
- Touch bar gap 4px to 2px, and read aloud's 4px margin dropped on touch: eight 36px buttons are 308px, inside a 375px
  phone's 311px thread. Rejected: smaller targets (the room's 36px is #3811's), and hiding a button on a phone (Josh
  asked for both on the phone page too).

## Weakest premise
That 308px in a 311px thread is enough margin. A 360px phone's thread is narrower, and there the bar wraps to two rows
(pjRxnFitWidth's existing behaviour), which is usable but taller.
