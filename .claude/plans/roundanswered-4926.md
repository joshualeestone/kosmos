# roundanswered-4926: one post that answers several no longer leaves them listed as waiting (kosmos#4926)

Measured on 0.7.94 with a Grok and a Claude seat: each answered a round of asks in one post citing none, and `kosmos room --unanswered` still listed them all. The cause is the shape of the answer, not the family. Full table and design on the card.

## What
- `messages.laterOwnPost(rows, i, reader)`: the reader's later post in the room that may have dealt with an ask.
- `--unanswered`: an agent's ask with such a post moves off the list onto its own `[kosmos]` line, named by id with the post.
- `kosmos room`: the same fact on a line under the post, for the person's asks too.

## Decided
- Named, never hidden: a post about something else also moves an ask, so it must stay findable. Rejected: hiding, matching on words, requiring a citation, a multi-id `--in-reply-to` as the whole fix.
- A post citing an older ask is about that ask, and covers nothing newer. One citing something newer does, the direction of #6164.
- Only an ask typed to the reader (placed or unconfirmed) counts. Held, quiet, undelivered and no outcome stay listed, the safe direction.
- The person's asks stay listed, with the factual line. Age comes first for an agent's ask, so an old one is counted under the list, not named.
- The header's words stay as they are: `no post of yours cites it` remains true of the listed ones, and a test pins them.

## Weakest premises
- A later post usually means the reader dealt with what it was sent. A status post also moves an ask; the cost is one line to read, not a lost ask.
- Row order is delivery order. An ask typed while the reader was writing an unrelated post reads as covered. Named on the line, so visible.
- A post held and told later stays listed after an uncited answer, because the row does not record when it was told. Not fixed here.

## Known limits
- The idle reminder and `roomhold` are untouched.
- The live check runs on a board started from this worktree with its own data.

## Review 1 (opus), what changed
- The covered line carries each ask's first 60 characters. It used to point at `kosmos room`, which stops at 200 rows while this walk does not. Rejected: keeping such asks listed, which brings back the false "waiting" in a busy room.
- An ask the reader claimed is not moved by a later post: its own claim is no answer (#7848), and a post can be about something else.
- The head no longer says "nothing else waiting" when an ask is covered: "nothing listed in this room; the posts named below may still be open". It takes the place of the claimed head too when both apply.
- `--all` says "see", not "list": an old ask the reader posted after lands on the covered line under `--all`. Rejected: exempting old asks from cover, which would call a 5-day-old ask waiting and a 1-day-old one not, on the same evidence.
- An unreadable room reads no rows, so nothing is named as covered; a partly read one is not reachable from a test here.

## Review 2 (sonnet), what changed and what did not
- The covered line's excerpt is another agent's words inside a `[kosmos]` line, so it gets what an outside sender's words get: control characters gone, no double quote, brackets round. Kind `post` only reaches this line, and a post carrying a marker is refused at write, so this is depth, not a live hole.
- Left as is: the `you posted [X] after [Y]` line on a plain `kosmos room` read. It appears only on rows shown, only for asks of the reader, the same shape as `you already answered`. It is the line that tells a reader in the view it reads most. If it proves noisy in a busy room, narrow it then; it is one condition.
- Left as is: the idle reminder can still mention an ask this list has moved. Stated above under Known limits; #4926 stays open for it.
- Correction: iteration 1's commit message says 30 mutation arms. It was 29. With this round, 33.

## Reviews 3 to 5
- Review 3 (opus): a test for an old ask and a covered one with nothing listed. That head reads `nothing listed from the last 3 days in this room; the posts named below may still be open`.
- Review 4 (sonnet): nothing new, but it read only part of the test file.
- Final validation was then red: rewording the usage line broke the words `tools.windows-kosmos-cli-gaps-4891` pins. Reworded to keep them.
- Review 5 (opus): a reply to the reader's own newer post no longer covers: it carries on that thread, which may be about something older (the N7 rule's `x.from === member`). A citation of a post the room no longer holds still covers. Rejected: following the thread up to its root. It costs more, and the row is named either way.
- Review 6 (sonnet): the line under a post no longer says `it needs nothing more` under an ask the list keeps showing. For the person's asks and one the reader claimed it says `cite it with --in-reply-to to take it off your list`. The reader's own posts are collected during the walk, so a reply no longer scans the room.
