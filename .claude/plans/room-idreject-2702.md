# Plan: #2702 / #3035 -- reject invalid project ids instead of stripping them

## What finished looks like
`kosmos room <id>`, `kosmos room reopen <id>` and `kosmos task list <id>` REJECT an id that
carries any character outside the slug set (exit 1, "there is no project by that name"),
instead of stripping the bad characters and looking up whatever remains. A valid id still
works exactly as before.

## The bug (Casey + Rocky fresh-install QA, 0.6.63)
`cmd_room` (and `cmd_task`, which deliberately shared its sanitizer) ran the id through
`sed "s/[^A-Za-z0-9._-]//g"` before lookup, so `qakosmos663!!!` became `qakosmos663` and
opened the REAL qakosmos663 room -- a PRIVACY leak (a garbled/mistyped id silently opens a
DIFFERENT real project's contents). `kosmos post` never stripped and correctly rejects.

## Fix
A shared `require_valid_project_id` helper rejects (exit 1, the same sentence the board's 404
uses) any id with a disallowed character, used in cmd_room (read), cmd_room (reopen), and
cmd_task. Matches cmd_post's exact-lookup behavior. Empty ids have no bad character and are
caught by each caller's own usage check, as before. Rejecting (not rewriting) also keeps the
id path/query-safe without a urlencoder (bash 3.2).

## Files
- `install/kosmos`: the helper + three call sites converted from strip to reject; the stale
  cmd_task comment ("uses cmd_room's EXACT sanitizer -- strip disallowed") updated.
- `cli.room-idreject-2702.test.js`: red-capable -- the stub board returns a real room/task
  list for ANY id, so a still-stripping CLI would exit 0 on the bad id; the fix rejects it
  client-side (exit 1, board never hit). CONTROL: a valid id reaches the board, unstripped.

## Verify
- `bash -n install/kosmos` clean; `node --test cli.room-idreject-2702.test.js` 4/4 (3 reject
  arms + the discriminating CONTROL).

## Note
Closes both #2702 (room) and #3035 (task list) -- one shared helper across three call sites,
so fixing them together avoids leaving cmd_task's comment claiming it mirrors cmd_room's
(now-changed) sanitizer. Splinter to confirm #3035 assignment.
