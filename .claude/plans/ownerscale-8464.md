# ownerscale-8464: the owner's file-owner notice says how big the change was (kosmos#8464, item 1)

The file-owner notice (#7989) is made from the PreToolUse hook, BEFORE the edit. The owner's own copy is handed over
later (engine/filenotices.js, through Kosmos's Claude Code hook), by when the edit has landed.

## Change
- filenotices.queue takes the file's absolute path; it keeps a fingerprint made then (one 8-hex sha1 per line), only
  for a plain file under 256 KB and 5,000 lines, refusing a link. A missing file is "did not exist" (a create).
- At hand-over (handOver, and take for `kosmos file-notices`), the file is fingerprinted again and compared as
  multisets of lines. The notice gains "So far: N lines added and M removed, of X before", "(it was new)", "the file is
  unchanged since this notice" or "the file is gone". Nothing is said when either side cannot be measured, or for a
  notice made before this change. The fingerprint never leaves the module (stripped from what is handed over).
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
