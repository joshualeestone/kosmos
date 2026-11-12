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
  multisets of lines: "So far: N lines added and M removed, of X before", "(it was new)", "the file was made, empty",
  "the file changed, but no lines were added or removed (line endings or the last newline)", "the file is gone", or,
  when nothing differs, "Kosmos found no difference in the file since this notice (it may have changed just before)",
  hedged because the edit can land before the first fingerprint. Nothing is said when either side cannot be measured
  or for a notice made before this change. The fingerprint never leaves the module.
- filewriters passes the path through (noteWrite -> ownerNotice -> queue). The room note is unchanged.

## Rejected
- undo's pre-edit copy: kept only when the undo switch is on.
- Delaying the room note until after the edit: changes #7989's timing for every reader.
- A net line count: an edit replacing 50 lines with 50 others would read 0.

## Weakest premise
That the fingerprint is taken before the edit lands. noteWrite runs on setImmediate after the board answers the hook,
and the agent's edit runs after its hook process exits, so the board is very likely first; if the edit wins, the
change reads as smaller (or unchanged) than it was. Also: a multiset of lines ignores moves and counts a changed line
as one added and one removed. It is meant to tell a big change from a small one, not to be a diff.

## Not in this change
Item 2 of the card (structured acceptance checks) stays on #8464.
