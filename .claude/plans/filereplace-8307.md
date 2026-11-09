# filereplace-8307: a rebuilt task file replaces the old fingerprint, on purpose and said

Addresses #8307 (split out of #8214). The shape was posted on the card first (issuecomment 6748069243).

## Finished means

1. A built mark whose file has a different fingerprint from the kept one records the old file as replaced (`builtReplaces`), and the task shows which file is current.
2. The checks of the old file read as out of date, and the new file starts unchecked.
3. The agents the built notice already reaches, plus whoever checked the old file, are told what it replaces and that a check of that file no longer counts.

## Decision

- **No `--replaces` flag.** Marking built again with a different file IS the replacement. An agent who forgot a flag would leave the replacement untold, which is the failure the card names.
- **A "review" of a file is the checker's mark.** Tasks have no file-review record. The nearest thing is another named agent's mark, or the person's, that keeps the fingerprint without sending one (`setBuilt`'s rule since #6330). It is recorded as `builtCheckedBy` (names, at most 20) and `builtCheckedByPerson`. The sender's own mark never counts.
- **Only the one previous file is kept** (`builtReplaces`: fingerprint, sender, when it was sent, path, who checked it). A third file replaces the second, not the first. Rejected: a history list. Nothing reads it, and it is one more thing to bound.
- **`builtFingerprintAt`** records when the file was sent. A checker's mark later does not move it (`builtAt` moves on every mark, so it cannot say when the file came).
- **A mark that drops the file withdraws it (review 1).** Since #6330, the sender's own mark without a file drops the fingerprint, and so does an unnamed agent's mark. That drop now keeps the dropped file as `builtReplaces` and tells its checkers ("it no longer names a file: the one sent earlier (X) is withdrawn"). A file sent after that replaces the withdrawn one, and its checkers are told again. The same file sent back is no replacement: it gets its checks and its sent time back. Rejected: dropping it all, as first built. That moved the card's failure one mark later, because the checker was never told. Only a clear drops it all.
- **The sender is never its own checker (review 1).** A checker who later sends the same file leaves the checker list.
- **`builtFingerprintAt` is stamped only for a file new to the task (review 1).** A fingerprint from before #8307 sent again gets no made-up time, and its replacement reports `at: null`.
- **A checker who has left the project** is in the recipients, and is said as not told, the same way as an assignee who left (review 1).
- **Paths.** The replaced file's path is kept for `task show`. Both views that leave paths out (the project rows in projects.js and the Tasks view in server.js) now strip it too, through one helper, `tasks.withoutFilePaths`. The typed notice never carries a path.
- **Notice.** `tellBuiltMark` gets `replaced` (with `kind`: replaced or withdrawn) from `setBuilt`'s answer. Each line adds "it replaces the file sent earlier (<old fingerprint>), so a check of that file no longer counts". The old file's checkers who are still on the project are added once, after the assignees and the parent's holders, and their line ends "you checked that one".

## Weakest part

- Treating the checker's mark as the review. An approval written elsewhere (a room post quoting the old sha256) is invisible to the board, so it is not marked out of date.
- The person's check of the old file is shown in `task show` but tells nobody: the notice reaches agents only, and the Tasks page does not show fingerprints today. Follow-up card after merge (review 1).
- Only one previous file is kept. A second replacement before anyone re-checks makes the first file's checkers' entry go away (they were told at the first replacement).

## Not done

- The Tasks page (no fingerprint shown there today) and `kosmos task files` (it checks the current file, which stays right).

## Tests

- `engine/tasks.filereplace-8307.test.js` (10), including review 1's withdrawal, sent-back, sender-as-checker, pre-#8307 time and withdrawn task show cases: first file not a replacement (control); checker and person checks recorded, the sender's never; a different file replaces it with its checks, starts unchecked, a resend is not a replacement, a third file replaces the second; drop and clear remove it all; a looping checker writes nothing and the list is bounded; no page view carries the replaced path; `task show` lines before and after.
- `server.filereplace-8307.test.js` (4), including review 1's withdrawal line, a checker who left said as not told, and the marker never told: the replacing line's words and recipients (the old file's checker who is not on the task is reached, no path typed); the same file again says nothing and reaches no checker (control); the CLI's list carries the replaced path, the Tasks view does not.
- Mutation checked: removing the checkers from the recipients, the `replaced` answer, the path strip, the withdrawal, or the sender filter each turns tests red.
