# spillinbox-4447: a long message spills into the recipient's own folder

Card: #4447 (claimed pigeonpete, from Splinter). Found in Baron's #4424 rehearsal, run 7.

## Built
- `engine/messages.js`
  - `spillInto(recipient, id, text)` writes `<recipient's worker folder>/Inbox/<id>.txt`. The folder is `dmfiles.ownDir(recipient, 'Inbox')`, the same derivation as the Files folder: beside the agent's instructions file, following a recorded folder.
  - DM: one file, in the recipient's Inbox.
  - Room post: one file per member, written inside the delivery loop, so each pane's pointer names its own file. A member whose delivery fails has its file removed.
  - Nothing writes the board-wide `messages/` folder any more. Its existing files stay until retention is decided. The unused `SPILL_DIR` constant is gone.
  - The pointer reads "(long message; the full text is in your own folder at <path>)".
  - The log keeps the full text as before.
- `engine/dmfiles.js`: `ownDir(sessionName, folder)`, extracted from `filesDir`, so Files and Inbox cannot name different folders.

## Decided
- **No fallback to the shared folder.** A recipient with no folder of its own is refused a long message with a reason ("...in <name>'s own folder"). Short messages still go.
  - Matches `instructions.write`, which already refuses an agent with no folder ("there is no agent by that name to write to").
  - In a room, that member is COULD_NOT and the others get theirs.
- **A spill never creates a worker folder.** It requires the agent's folder to exist, and creates only Inbox inside it.
- **The folder is the agent's, so the agent could plant a link there.**
  - A linked Inbox is refused (lstat).
  - The file is opened with O_NOFOLLOW, so a link planted at `Inbox/<id>.txt` cannot redirect the board's write. Same OS user, so this is defence in depth, not a privilege boundary.

## Rejected
- Keeping the shared folder and only changing permissions: every agent runs as the same OS user, so permissions cannot separate them. Only where the file sits can.
- One copy per post in the first member's folder, with the others pointed at it: that crosses folders, which is the bug.

## Weakest premise
That every real recipient has a worker folder. Kosmos-created agents always do. A hand-made tmux session the roster admits might not, and it now gets a refusal for a long message where it used to get a pointer into the shared folder. Short messages are unaffected.

## Not covered by a test (said plainly)
- Removal of a member's file when its pane delivery fails after the spill (`unspill` on COULD_NOT). The fake tmux cannot fail one target while passing the others without new harness work. The code path is two lines.

## Tests (engine/messages.test.js, workers root now sandboxed)
- A long room post to 3 members leaves exactly 3 files, one per member's Inbox. Each pane's pointer names its own file (checked against the pane typed into). The old folder gets nothing (control).
- A long DM leaves one file in the recipient's Inbox, none in the sender's, none in the old folder.
- A folderless recipient is refused and no worker folder is created. A short message to it still goes (control).
- A linked Inbox is refused, and a link planted at the file name is not followed.
- Mutants, each red and restored: the old shared folder (5 fails), one shared file per post (2), no O_NOFOLLOW (1), stat instead of lstat (1).
