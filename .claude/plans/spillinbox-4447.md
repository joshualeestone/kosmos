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

## Review round 1 (opus, blind): 0 BLOCKERs, 3 WARNINGs, 3 NITs
- **WARNING** O_NOFOLLOW does not stop a HARD link (and O_TRUNC wipes its target), and O_NOFOLLOW is undefined on Windows.
  - Fixed: whatever sits at `Inbox/<id>.txt` is unlinked first, then the file is created fresh with O_EXCL (plus O_NOFOLLOW where it exists). A planted link of either kind only loses its name, on every platform.
  - Tested for both a symbolic and a hard link; the no-unlink mutant is red.
  - The swap-the-Inbox race between check and create is stated as not closed (same OS user).
- **WARNING** A long DM to a misspelt name refused as a folder problem. Fixed: `chat.addressable` is checked before any file is written, in both the DM and the room paths.
  - Tested: the real reason is given and nothing is written, even when a folder by that name exists. The mutant is red.
- **WARNING** For a connected agent the folder is the person's project, often a git repo, so `git add .` could carry colleagues' messages out. Fixed: `Inbox/.gitignore` is `*`.
  - Measured with real git (and a control that sees a file beside the Inbox). The mutant is red.
- **NIT** A linked worker folder is refused, unlike Files. Now written in the comment.
- **NIT** A crash between the spill and the log can leave a stale `Inbox/mN.txt` that a reused id later replaces for its own recipients only. KEPT: rare, and the stale file is still that agent's own message.
- **NIT** The retention comment pointed at a note about log rotation. Fixed: it now says what is true.

## Validation (2c5850d0): 1 red, mine
- The #1732 Windows-coupling audit flagged my hand-rolled `fs.constants.O_NOFOLLOW` open as an unclassified Windows-hostile site.
- The codebase already has ONE audited link-safe writer, `engine/securewrite.js` (`writeSecret`: a 0600 temp created `wx`, renamed over the name, with win32 handled and pinned). I should have used it from the start. The spill now goes through it; the audit passes (8/8).
- The planted symbolic and hard link tests still pass (a rename only replaces the name). A mutant with a plain writeFileSync, which follows links, turns the planted-link test red.

## Review round 2 (sonnet, blind; it reviewed the pre-securewrite version): 0 BLOCKERs, 2 WARNINGs
- **WARNING** A pre-existing `Inbox` (a connected agent's folder is the person's project, which may already have one) was used silently, and its own `.gitignore` left in place. Sharper than stated: Kosmos must never write messages into the person's own folder at all.
  - Fixed: the `.gitignore` is written only when the spill CREATES the Inbox, and its exact words (`*`) mark the folder as Kosmos's.
  - An `Inbox` without that marker, whether it has a different `.gitignore` or none, is the person's. It is refused and left byte-for-byte unchanged.
  - Tested, with a control showing Kosmos's own Inbox takes repeated messages. A mutant dropping the marker check is red.
- **WARNING** The git test ran `git init` and removed `.git` with no sandbox-containment assertion. Fixed: it asserts the folder is inside SANDBOX first.
- Focus 2 (addressable before deliver) and focus 3 (nothing reads the pointer from the log) were confirmed clean.
