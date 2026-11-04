# donewhencheck-7990: edit one done-when check by number

Card: #7990, split from #7978 item 3. Replacing the whole set to fix one check blurs which one changed.

## Change
`kosmos task done-when <project> <n> --check <k> "<wording>"` on both CLIs. `POST .../done-when {check, text}`. `tasks.setDoneWhenCheck` changes that one inside the same write and under the same guards as `setDoneWhen`. The transcript's `done-when-set` row gains `changedCheck` and `was`, and the page and engine phrases name the check.

## Decisions
- **What a mark says after a check changes: nothing changes.** A built mark's note is free text tied to no check by number, and nothing reads the wording back. So the transcript carries which check changed and from what. Rejected: clearing or flagging a built mark, for a tie that does not exist.
- **Same kind, extra fields,** so an older reader (iOS `TaskPageLogic.swift`) still shows the whole set rather than an unknown row. Rejected: a new kind in three renderers.
- **Person-set checks stay the person's,** as for the set.

## Weakest premise
That nobody reads a check's position as identity across edits. Read for, not exhaustively.

## Not measured
A browser run of the transcript line; a source match covers the two phrase copies. iOS keeps the old wording.
