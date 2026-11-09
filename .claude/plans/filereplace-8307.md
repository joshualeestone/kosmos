# filereplace-8307: a rebuilt task file replaces the old fingerprint, on purpose and said

Addresses #8307 (split out of #8214). The shape was posted on the card first (issuecomment 6748069243).

## Finished means

1. A built mark whose file has a different fingerprint from the kept one records the old file as replaced (`builtReplaces`), and the task shows which file is current.
2. The checks of the old file read as out of date, and the new file starts unchecked.
3. The agents the built notice already reaches, plus whoever checked the old file, are told what it replaces and that a check of that file no longer counts.

## Decision

- **No `--replaces` flag.** Marking built again with a different file IS the replacement. An agent who forgot a flag would leave the replacement untold, which is the failure the card names.
- **A "review" of a file is the checker's mark.** Tasks have no file-review record. The nearest thing is another named agent's mark, or the person's, that keeps the fingerprint without sending one (`setBuilt`'s rule since #6330). It is recorded as `builtCheckedBy` (names, at most 20) and `builtCheckedByPerson`. The sender's own mark never counts.
- **Only the one previous file is kept** (`builtReplaces`: fingerprint, sender, when it was sent, who checked it; never its path, review 4). A third file replaces the second, not the first. Rejected: a history list. Nothing reads it, and it is one more thing to bound.
- **`builtFingerprintAt`** records when the file was sent. A checker's mark later does not move it (`builtAt` moves on every mark, so it cannot say when the file came).
- **A mark that drops the file withdraws it (review 1).** Since #6330, the sender's own mark without a file drops the fingerprint, and so does an unnamed agent's mark. That drop now keeps the dropped file as `builtReplaces` and tells its checkers ("it no longer names a file: the one sent earlier (X) is withdrawn"). A file sent after that replaces the withdrawn one, and its checkers are told again. The same file sent back is no replacement: it gets its checks and its sent time back. Rejected: dropping it all, as first built. That moved the card's failure one mark later, because the checker was never told. Only a clear drops it all.
- **The marker hears a withdrawal (review 2).** A mark without a file from its sender now tells the old file's checkers, so its answer says so: "This mark sent no file, so the file the task named before is withdrawn. To keep it, mark it again with --file and its path." Review 3: it claims no delivery; the sentence before it says who was told, or that nobody was.
- **The sender is never its own checker (review 1).** A checker who later sends the same file leaves the checker list.
- **`builtFingerprintAt` is stamped only for a file new to the task (review 1).** A fingerprint from before #8307 sent again gets no made-up time, and its replacement reports `at: null`.
- **A checker who has left the project** is in the recipients, and is said as not told, the same way as an assignee who left (review 1).
- **Paths.** The replaced file's path is never stored (review 4): only `task show` would read it, and storing it put a second local path on every route that answers with a whole task. The current path is stripped, as before, from both list views (the project rows in projects.js and the Tasks view in server.js) through one helper, `tasks.withoutFilePaths`, and now also from the built route's answer to the page's own mark (review 3). The typed notice never carries a path.
- **Notice.** `tellBuiltMark` gets `replaced` (with `kind`: replaced, withdrawn or restored) from `setBuilt`'s answer. Each line adds "it replaces the file sent earlier (<old fingerprint>), so a check of that file no longer counts". The old file's checkers are added once, after the assignees and the parent's holders (one who left is said as not told), and their line ends "you checked that one". A withdrawal's line says "it no longer names a file: the one sent earlier (X) is withdrawn" instead.

## Weakest part

- Treating the checker's mark as the review. An approval written elsewhere (a room post quoting the old sha256) is invisible to the board, so it is not marked out of date.
- The person's check cannot go out of date through the board: once the person marks a task built, the route refuses every agent mark on it (403, `refusePersonMark`), so an agent who rebuilds a file the person checked is refused, not recorded. The engine still carries `checkedByPerson` into `builtReplaces` for a direct caller; no route reaches it (review 5, pinned by a route test).
- Only one previous file is kept. A second replacement before anyone re-checks makes the first file's checkers' entry go away (they were told at the first replacement). So A, then B, then A again is a new file with no checks, while A, withdrawn, then A again gets its checks back (review 3), and since review 5 its checkers are told the check counts again. A note-only re-mark that forgets `--file` therefore sends checkers two lines (withdrawn, then restored) once the sender fixes it.
- Any change in the fingerprint string is a replacement, including a change of kind only (an older CLI's `sha256:` and a #7213 CLI's `pdf-normalized:` for the same PDF). Its checkers are then told a check no longer counts when the bytes did not change. That errs toward telling (review 3).
- At most 20 checkers are kept; the 21st pushes out the oldest, who is then not told of a replacement (review 3).
- Other routes that answer the page with a whole task (hold, done-when, assign) still carry `builtFilePath`, as before this branch. This branch adds no path to them (review 4). The class predates it (#8214); follow-up card with the person's-check one.
- The task's history records a replacing mark as a plain built mark; only the notice and `task show` say a file was replaced.
- An unnamed agent's mark without a file withdraws the file too (the #6330 drop rule for unnamed marks), and so tells its checkers. The same mark again changes nothing, so a looping unnamed mark sends one notice, not many (review 4).

## Not done

- The Tasks page (no fingerprint shown there today) and `kosmos task files` (it checks the current file, which stays right).

## Tests

- `engine/tasks.filereplace-8307.test.js` (11):
  - first file not a replacement (control); checker and person checks recorded, the sender's never;
  - a different file replaces it with its checks and starts unchecked; a resend is no replacement; a third file replaces the second;
  - a drop withdraws it, a later file replaces the withdrawn one, a clear removes it all;
  - a withdrawn file sent back is said as restored and gets its checks and sent time back;
  - a checker who sends the file is no longer its checker; a pre-#8307 fingerprint gets no made-up time;
  - a looping checker writes nothing, and the list is bounded;
  - the replaced path is never stored, and the page view strips the current one;
  - `task show` before and after a replacement, and for a withdrawn file.
- `server.filereplace-8307.test.js` (7):
  - the replacing line's words and recipients (the old file's checker not on the task is reached, no path typed);
  - the same file again says nothing and reaches no checker (control);
  - the CLI's list carries what it replaced, never its path; the Tasks view leaves the current path out;
  - the withdrawal line, the marker's answer (no delivery claimed), a checker who left said as not told, the marker never told;
  - the page's own mark gets no path back;
  - a withdrawn file sent back tells its checker the check counts again;
  - once the person marks the task built, an agent's new file or withdrawal is refused (403) and the file stays.
- Mutation checked, each turning tests red: the checkers in the recipients, the `replaced` answer, the path strip, the withdrawal, the sender filter, storing the replaced path, the restored notice.
