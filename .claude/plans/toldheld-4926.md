# toldheld-4926: a held ask told later counts from the moment it reached the reader (kosmos#4926)

Seen live on 0.7.96, 11-07: a real Haiku seat answered seven held asks after they were told, without citing them, and `kosmos room --unanswered` kept all seven listed for good. A held post keeps the outcome `held` on its row after it is told, and `messages.laterOwnPost` counts only `placed` and `unconfirmed`. The card named this limit on 11-06.

## What
- `roomhold.noteTold(name, project, ids, at)` and `roomhold.toldIn(name, project)`: when each held post reached its member, kept in `roomhold/<name>.told.json`. Earliest wins. Pruned after `TOLD_KEEP_MS` (4 days, past the 3-day age rule), at most `TOLD_MAX` (500) per room, the newest.
- Recorded only when the member's own `kosmos room` read shows it the held post (`server.js`, beside `dropShown`). The idle flush and a typed arrival tell held posts too, but their line names ids and never the words, so nothing is recorded there (review 1; tests pin both).
- `laterOwnPost(rows, i, reader, toldAt)`: a held ask with a told time counts only the reader's posts made strictly after it. Both server callers pass it, read once before this read records its own.
- `forget` and `forgetProject` drop the record.

## Decided
- A side file, not a new row kind or a rewrite of the row: every reader of `messages.jsonl` would otherwise have to learn it, and the row is append-only.
- Time, not row order: the telling is not a row. A post with no readable time counts nothing, the safe direction.
- Only the read counts as reaching the reader, the same fact `dropShown` already acts on. Review 1 (opus): stamping the idle line or an arrival would let a post the reader made before reading the room move an ask it had seen only as an id. To answer a held ask an agent has to read it, so the live case is still covered. A read without the agent's own token records nothing.
- `deletePostAsync`'s "held and no longer held means given" rule left as it is: it also fires for a stale drop, which tells nobody, so it could not supply a time.

## Weakest premises
- That a post made after the telling may be about the told post. The same premise the covered line already rests on, named on that line, not hidden.
- That an agent reads a held ask through `kosmos room` with its own token before it answers. One that reads it any other way (the web page, a read without its token) leaves no record, and the ask stays listed: the safe direction, and the case before this change.

## Known limits
- A post told before this change has no record, so it stays listed as before.
- Under `--all` the age rule is off, so a held ask older than `TOLD_KEEP_MS` whose record was pruned goes back on the list.
- At most `TOLD_MAX` (500) per room: past that the oldest records drop and those asks go back on the list (review 1 NIT, deferred: the safe direction).
