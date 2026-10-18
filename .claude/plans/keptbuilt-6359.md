# keptbuilt-6359: a kept built line is said as the built notice, not as a task message

Card: kosmos#6359, Baron Draxum's follow-up from #6330 (the built mark tells the people the work goes to). Stacked on
builttell-6330 and merged after it.

## What changes
A built line to an agent out of usage is kept by `messages.keepTaskLine` (#5805), as a task message is. Every notice
about it used to be a task message's words. Now `keepTaskLine` takes a kind (`where.kind: 'built'`), the queue keeps
the mark (`built: true`), and each notice says what it was:
- **the marker's answer** (`taskMessageSummary(..., 'built')`): "Kept, not typed yet: ..." without "Do not send it
  again", since a repeat mark with the same note tells nobody, so there is nothing to send again;
- **a drop**: the marker is told its built notice never reached the agent and that `kosmos msg <agent>` is how to tell
  it now. Review 1: not `kosmos task message`, which reaches only the task's own assignees and not a parent task's
  holder (the built notice goes to both), and nothing about the mark itself, which a day on may be cleared or closed;
- **the task's conversation** (`recordTaskLineOutcome`): the kept-sent and kept-dropped entries carry `built`, and the
  page and the CLI say "The built notice from Leo to Mara ...", never "A message from Leo", a message the
  conversation never showed (`web/index.html` tkActPhrase and `engine/taskactphrase.js`, kept word for word).

## Decided
- **A new built notice replaces the kept one for the same task** (same sender and recipient), once it is decided the
  new one is kept (review 1). So one mark takes one place, and a stale note is never typed ahead of the current one.
- **Otherwise the kept queue's places stay as they are.** A kept built line is a real line Kosmos will type into the
  agent, so it counts toward the per-sender and per-agent caps like a task message. Rejected: exempting built lines
  from the per-sender cap. A marker could then fill the recipient's whole queue (MAX_KEPT) with built notes, which
  moves the cost onto every other sender. Weakest premise: that markers rarely build many tasks for one capped agent
  in a day. What would change it: a measured case of a marker's real task message refused for the sender cap behind
  built notes.
- **The kind rides on `where`**, the existing options object, not a new positional argument.
- **Lines kept before this change** carry no mark, so they still read as task messages when sent or dropped. They
  drain within a day of their reset; not migrated.
- **Review 2:** the replace leaves an entry the sweep is typing (or has typed), and removes before it adds (frees the
  sender's place). If the add then fails, the old notice is gone without a drop notice; stated in the code.

## Tests
- `engine/limittask-5805.test.js`: a built notice is kept with its mark (CONTROL: a task message is not); typed after
  the reset it is recorded `built` on its task; dropped, its sender gets the built words and the `kosmos task message`
  pointer, and it is recorded `built` (CONTROL: a task message dropped beside it keeps its own words).
- `engine/taskactphrase.test.js`: built fixtures in the page-equals-CLI table; the exact words (CONTROL: no mark, a
  message).
- `server.task-message-summary-4540.test.js`: the built answer omits "Do not send it again" (CONTROL: a task
  message's still says it).
- `server.builttell-6330.test.js`: through the real route, the kept line carries the mark and the answer omits it.
- Review 1: a new built notice for the same task replaces the kept one (CONTROL: another task's notice and a task
  message on the same task stay).
- Mutants, each red: the route's kind, the summary's kind, the queue's whitelist line, the drop words, the record flag,
  the page phrase, the replace.
