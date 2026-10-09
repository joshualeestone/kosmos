# builtnote-5705: a "built" mark on a checked task says how the checks went (kosmos#5705 part 1, slice 2)

## Done looks like
An agent's built mark on a task with done-when checks (#5152) is refused unless it carries a note, with a sentence
naming the exact command (single-quoted example, readable on both the Mac and Windows commands). Nothing is written by
a refused mark. The person's mark from the screen is never refused; a task with no checks takes a bare mark.

## Decided
- Refuse a bare mark, rather than read the notes for words like "pending" to flag contradictions: that guesses at
  meaning and would flag honest notes.
- After the person-mark refusal, so an agent hears the real answer first (review 1).
- KNOWN GAP, not closed here (review 1): an agent can clear checks that it or another agent set
  (`kosmos task done-when ... --clear`) and then mark bare. Checks the person set cannot be cleared by an agent.
  Closing it means refusing a bare mark after an agent cleared checks, which needs a reading of the history; left
  for a follow-up if it is seen.
- Weakest premise: that requiring a note is enough. A note can still be untrue; it is a stated claim the person can
  read, which is what the feedback asked for ("a visible reason on built").
