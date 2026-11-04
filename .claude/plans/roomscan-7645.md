# roomscan-7645: the trace privacy scan reads the room's traces too

Card: kosmos#7645. Found while building roomtrace-7645 (PR #7925, which this branch stacks on): the room check in
ios/LogicTests/room/main.swift that keeps the diagnostic record to numbers and yes/no values (traceLines, allowedInTrace)
reads only ChatView.swift. RoomView writes through ChatView.trace too, so a room trace that put a message, a project
name or any other words into the record would pass.

## What finished looks like
The scan reads RoomView.swift as well, every value a room trace writes is on the allowlist, and a control shows a stray
room value fails the check.

## Change
ios/LogicTests/room/main.swift: traceLines is built from ChatView.swift plus RoomView.swift; the room's will-show values
(keepNewestOnKeyboard, visible, holdAtEnd, searchMode, all Bool) are admitted. The room's other interpolated value
(`now ?? "none"`, a row id) was already admitted for the chat.

## Measured
- Before: 67-ish values, room lines unscanned. After: 72 values, none stray, room suite 812/812.
- Control (committed first, then reverted): `ChatView.trace("room: end gone \(project.name)", ring: false)` in RoomView
  turns the check red: `not allowed: ["project.name"]`.

## Decided
- Read the room's source here rather than move roomSource up: roomSource is declared further down for other checks,
  and moving it would touch unrelated lines.
- Checked 11-04: only ChatView.swift and RoomView.swift in ios/Kosmos call ChatView.trace(. Weakest premise: that no
  future file starts writing through it; this check would not see one (the list of files is fixed).
