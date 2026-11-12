# ownerscale-8464: the owner's file-owner notice says how big the change was (kosmos#8464, item 1)

The file-owner notice (#7989) is made from the PreToolUse hook, BEFORE the edit. The owner's own copy is handed over
later (engine/filenotices.js, through Kosmos's Claude Code hook), by when the edit has landed.

## Change
- filenotices.queue takes the file's absolute path and keeps a fingerprint made then: one 8-hex sha1 per line (a
  trailing \r dropped, so line endings alone are not a rewrite) and one of the whole file, only for a plain file under
  128 KB and 2,000 lines (about 22 KB per fingerprint, at most MAX_PENDING = 10 per owner). It also keeps the real path
  of the file's folder.
- Review 1, security: an agent controls the project folder. (1) At hand-over the folder must still resolve to the same
  real path, or no scale is given: a folder repointed to somewhere outside afterwards is never read through. (2) The
  file is opened ONCE without following a final link and without blocking, and every check (a plain file, the size) and
  a bounded read are made on that open file, so a FIFO or device swapped in cannot hang the board.
- At hand-over (handOver, and take for `kosmos file-notices`), the file is fingerprinted again and compared as
  multisets of lines: "So far, by anyone (you included), the file has N lines added and M removed, of X before" (review 7: it counts every change since the notice, the owner's own included), "(it was new)", "the file was made, empty",
  "the file changed, but no lines were added or removed (lines moved, line endings or the last newline)", "the file is gone", or,
  when nothing differs, "Kosmos found no difference in the file since this notice (it may have changed just before)",
  hedged because the edit can land before the first fingerprint. Nothing is said when either side cannot be measured
  or for a notice made before this change. The fingerprint never leaves the module.
- Review 2, security: filewriters passes the RESOLVED path (the one projectOf placed inside the project), never the raw
  one: path.resolve drops '..' before the kernel follows a link, so P/l/../x.md (l a link to outside) would otherwise be
  read outside. queue measures only a path whose folder is already its own real path, by that real folder and name, and
  checks the folder again after the read; the hand-over does the same. A file with more than one hard link is not
  measured (a hard link is not a link to O_NOFOLLOW and can name a file outside). A file that grows past the bounds says
  "now too large for Kosmos to count"; one never made says so.
- Review 3, security: noteWrite resolves the path ONCE and uses that result both to place it inside the project and for
  the notice (a second resolve let a link flipped in between send an outside folder through). And after the read, the
  name's device and inode must equal the open file's, so a folder swapped to a link for the moment of the open and back
  (which passes both folder checks) is not measured. The after-read folder checks are kept as a second line; the inode
  check is what a test pins.
- Review 4 added an identity pin (the same device and inode at both reads); review 6 measured that Claude Code's own
  Edit and Write save by writing a new file and renaming it over the old one (a new inode each time), so the pin made the
  common edit uncountable. REMOVED. Each read is still checked on its own: the folder inside the fingerprint after the
  read, and the name's device and inode against the file opened.
- Review 5: "too large" is said only after the folder and identity checks, and carries the file's identity, so not even
  a size is said about another file; the read is bounded by the buffer, not by the size fstat gave.
- filewriters passes the path through (noteWrite -> ownerNotice -> queue). The room note is unchanged.

## Rejected
- undo's pre-edit copy: kept only when the undo switch is on.
- Delaying the room note until after the edit: changes #7989's timing for every reader.
- A net line count: an edit replacing 50 lines with 50 others would read 0.

## Weakest premise
What remains after six rounds, stated rather than chased: a precisely timed double flip (a folder turned into a link
before the open and kept through the name check, then back), or a hard link made to an outside file between the open and
the name check, could have one read measure an outside file, at the notice or at the hand-over. Only line COUNTS (or
"too large") could reach the owner agent, about a file that agent, running as the same user, could read itself. The rule
kept is that the board never COUNTS or REPORTS a file outside the project except in that race, and it may OPEN one in it
(no openat in node, so a path is the only handle). A dead network mount can block a synchronous realpath or open on the
board's thread here, as noteWrite's own realpath already could. Also: the "before" fingerprint is taken on setImmediate
after the hook's answer, so the edit can land first; the no-change wording is hedged for that.
