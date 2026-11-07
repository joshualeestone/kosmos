# unmark-8158: the built row's undo says what it does (kosmos#8158)

## Problem
A built task's row reads "Marked built by you just now" and beside it, in bold, "Not built yet". That is the button taking the
mark off, labelled with the state it would set, so it reads as a second, opposite status. Two readers took it that way.

## Finished means
A person reading the row cannot take the control for a status, seen in a design shot.

## Change
The label is "Undo" (Mona Lisa's design call, on the card). The screen-reader name starts with that word ("Undo marking task 1 of Launch built"), so voice control
users can say what they see. Apart from that, a 44px minimum width on a phone, since "Undo" is narrower than that on its own, and the own line after a note (below). The message after pressing it already says "no longer marked built".

## Decided
- The commit line goes above the built sentence, so nothing follows Undo (Mona Lisa, chosen over "Undo built" on commit rows): otherwise Undo sat above "Saved as change abc1234" and could read as undoing the change, which it does not. Not in the shots. `replacedLine` is only on closed rows, which have no Undo.
- After an agent's note, Undo starts its own line, on a computer too (Mona Lisa's call, on the card): wrapped, it read as the note's last word. Rejected a separator dot, which still wraps with the note. Costs a row's height where the note would have fitted.
- "Undo" over my "Unmark built": it reads straight on from "Marked built by you just now", is an everyday word and is shortest on the phone.
  Her weakest premise: "Undo" days later; it stays attached to the sentence it undoes.
- Rejected: a button-shaped control. A heavier row for an action nobody needs often; the word alone may do it. Mona Lisa's to overrule.

## Named, not fixed
- Pressing Undo also takes the "Saved as change" line off the row (clearBuilt, a mark taken off means the work is not done), so its message says the change is not touched.
- After a note, Undo is alone on its line with nothing naming what it undoes; the spoken name does.
- The design screen's outside mark tells the sample agent and leaves history on its throwaway board.
- The shots show a row marked by the person and an unnamed one, not a named agent's or a Needs Your Decision row: a named mark needs an agent token.
- That a row with no note keeps Undo beside its sentence is checked only by the design screen's verify, which runs by hand: the Tasks check's fixture has one built row, with a note.

## Weakest premise
That the word alone is enough: the card allows either. Its readers were reading stills, and this is a still too. The design
review decides. A person who hovers sees it is a button either way, though on a phone there is no hover and only the weight says so.
