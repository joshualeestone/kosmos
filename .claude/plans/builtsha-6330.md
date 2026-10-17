# builtsha-6330: a built mark can carry the deliverable's fingerprint (#6330 slice 2)

#6330 (daily feedback 2026-10-16) asked for two things in a handoff between agents: the next agent hears that the earlier
step is built (slice 1, merged 34889e24b) and "a built-in way to hand over a finished deliverable with a fixed
fingerprint (for example a checksum), so the next agent can confirm it is checking the exact thing that was delivered".
This is that second part.

## What an agent sees
- `kosmos task built <project-id> <task-number> ["note"] --file <path>`: the CLI hashes the file on this computer (sha256)
  and sends `fingerprint: "sha256:<64 hex>"` with the mark. Mac (install/kosmos, shasum -a 256) and Windows
  (tools/windows/kosmos-cli.js, node crypto) alike. A missing or unreadable file is refused before the board.
- The board stores it on the task as `builtFingerprint` (with the mark: cleared with it, part of "the same mark again").
- The line slice 1 types to the next agents ends with the fingerprint, so they can compare it: `shasum -a 256 <file>`.
- `kosmos task list` shows it on a built task, so an agent who missed the line can still check.

## Rules
- Shape checked on the board: exactly `sha256:` and 64 lowercase hex; anything else is refused (400), never stored.
- Only an agent's mark carries one; the person's mark from the screen sends none, and a clear drops it.
- **Who sent it is recorded (builtFingerprintBy), and that decides what a later mark does.** Another named agent's
  mark without one (the checker's "1 met.") keeps it, and so does the person's mark from the screen (they did not
  change the file); the sender's own mark without one drops it, and so does an unnamed agent's (it cannot be told from
  an unnamed sender: review 6 found null matched null, so the person's mark kept or dropped by whether the sender had
  a name); the line typed to the next
  agents carries it only when that mark sent it, and the lists say "sent by <name>".
- Agents learn it from the rules (doctrine v33, logged in engine/defaults.js with its weakest premise).
- No board or agent-card UI: Josh's 11:16 ruling (no new visible lines until his clean-up ships). The Tasks page does
  not render it.

## Decided
- **The CLI hashes, the board never reads the file.** Rejected: the board hashing a path it is given (it would read any
  file an agent names, a path is not the deliverable once moved, and agents and the board may not share a folder).
- **sha256 only**, named in the value, so a later algorithm can be added without a format change.

- **This rule moved twice in review, so it is decided here, not per round.** Round 2 shipped "any mark without one
  drops it", and round 3 found the checker's own mark wiped the deliverable's fingerprint. Round 3 shipped "any mark
  without one keeps it", and round 5 found that the sender's re-mark after a fix presented the OLD fingerprint as current
  and the checker's line read as if the checker had hashed it. Both rules were one boolean for two different people.
  Keyed on the sender, each case is right: the checker never touched the file, the sender may have replaced it. What
  would change this: an agent legitimately re-marking its own unchanged file without --file and losing the
  fingerprint; that costs one re-send, while the alternative costs a false match.
- Deferred: a bad fingerprint shape is refused before the task is looked up (400 where a missing task would be 404).
  The CLIs never send a bad shape; only a hand-made request sees the order.
- Deferred: the CLI does not confirm the board kept the fingerprint. The CLI and the board ship in one release.
- Deferred: the task history does not record the fingerprint. History is drawn on the Tasks page, which is new UI
  under Josh's 11:16 ruling.

## Weakest premise
That the next agent has the same file to hash. A fingerprint proves sameness only against a copy; if the deliverable is
a folder or a deployed thing, a file's hash does not cover it (folders are out of scope here).

## Tests
- server.builtsha-6330.test.js (7): engine stores, clears, refuses bad shapes ('' and non-strings included); the sender
  rule (checker keeps, sender's own re-mark drops, an identical mark from another agent credits them); the person and
  unnamed cases; route 400 on a bad shape or a non-string, the screen ignored (control: its mark went through); the
  typed line carries it only when that mark sent it (control: a mark without one carries none); Mac --file end to end
  with a name holding a backslash and a leading dash, list naming the sender; Mac refusals (missing, no path, empty,
  with --clear, a hasher that fails) never mark the task.
- tools.windows-kosmos-cli-570.test.js (+2): --file sends the sha256 and keeps the path out of the note (control: none
  without it), four refusals with their own sentences never reach the board; task list prints a built task's
  fingerprint and sender, and none for an unbuilt task or a bad value.
- Red-capable: with the four changed source files reverted to origin/main, all the server tests and exactly the new
  Windows test failed; each later rule change was checked by a one-line mutant that fails exactly its test.
