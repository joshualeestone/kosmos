# toldheld-4926: a held ask told later counts from the moment it reached the reader (kosmos#4926)

Seen live on 0.7.96, 11-07: a real Haiku seat answered seven held asks after they were told, without citing them, and `kosmos room --unanswered` kept all seven listed for good. A held post keeps the outcome `held` on its row after it is told, and `messages.laterOwnPost` counts only `placed` and `unconfirmed`. The card named this limit on 11-06.

## What
- `roomhold.noteTold(name, project, ids, at)` and `roomhold.toldIn(name, project)`: when each held post reached its member, kept in `roomhold/<name>.told.json`. Earliest wins. Pruned after `TOLD_KEEP_MS` (4 days, past the 3-day age rule), at most `TOLD_MAX` (500) per room, the newest.
- Recorded on the three paths a held post reaches its member: the idle flush and the timed retry (`flushOnIdle`), a typed arrival that carries it (`messages.js` finish), and the member's own `kosmos room` read that shows it (`server.js`, beside `dropShown`). Only on `placed` or `unconfirmed`.
- `laterOwnPost(rows, i, reader, toldAt)`: a held ask with a told time counts only the reader's posts made strictly after it. Both server callers pass it, read once before this read records its own.
- `forget` and `forgetProject` drop the record.

## Decided
- A side file, not a new row kind or a rewrite of the row: every reader of `messages.jsonl` would otherwise have to learn it, and the row is append-only.
- Time, not row order: the telling is not a row. A post with no readable time counts nothing, the safe direction.
- A read that shows the held post counts as reaching the reader, the same fact `dropShown` already acts on. A read without the agent's own token records nothing.
- `deletePostAsync`'s "held and no longer held means given" rule left as it is: it also fires for a stale drop, which tells nobody, so it could not supply a time.

## Weakest premises
- That a post made after the telling may be about the told post. The same premise the covered line already rests on, named on that line, not hidden.
- The told time is taken when the line is handed to the pane, not when the agent reads it. A post the agent was already writing then can count. One more line to read, not a lost ask.

## Known limits
- A post told before this change has no record, so it stays listed as before.
- The "may have" arrival (typing threw after it started) records nothing: the post stays listed.
