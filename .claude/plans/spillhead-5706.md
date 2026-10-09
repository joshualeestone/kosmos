# spillhead-5706: a long message's pane line says what it is about (kosmos#5706)

## Done looks like
When a long message (over 700 characters) to an agent is saved to a file, the line typed into the agent's pane gives
its first real sentence (or its opening cut at a whole word), always followed by an ellipsis, then
"(long message, N words; the full text is in your own folder at <file>)". The sender is already named ahead of it.

## Decided
- Sentence end: . ! ? followed in the whole text by a space and a capital, never after a list number, a dotted form,
  a single initial or a listed abbreviation, and at least 20 characters; else the opening at a whole word.
- Every head ends in an ellipsis (review 4), so a word the list misses can only make the head shorter; it can never
  pass a fragment off as the whole message. The list is best effort by design.
- Never splits an emoji; never a bare ellipsis.
- Weakest premise: that the first sentence is a useful summary. A message that opens with a greeting gives a weaker
  head, still bounded and still pointing at the file.
