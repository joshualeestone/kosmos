# askedcount-8389: a question waiting on the person says how many times it was asked (kosmos#8389, part 1)

## Already there (kosmos#8259)
A for-you hold records its first and latest tell, and the page and CLI say "It asked you X ago, and again Y ago" and "you told them <time>".

## Change
- Each tell is counted: `onHoldToldCount`, from 1 at the first tell, one more per tell, dropped with the other tell marks (a new question starts again).
- CLI (`task show` only; `task list` shows no tell at all, before or after this): "you told them N times, last <time>" from two tells; one tell reads as before.
- Page: from two tells, as the CLI, "It asked you N times, first X ago, last Y ago."
- The same message again (one id) is not counted twice. The count is every ask for this question, including ones before an answer.
- A hold told before the count existed has no count, and none is guessed.

## Decided
- Part 2 of the card, the suggested answer stored beside the question, is not built here: it needs a new option in both CLIs' hold parsers, the hold route, storage and its display on the card, row and task page, and I split it rather than rush it at the end of a session. The card stays open for it.
- Every tell counts, including a few messages in a row in the task's conversation: that is how the existing marks already define a tell.

## Weakest premise
That a tell is the right unit for "times asked". Several short messages in one sitting count as several.
