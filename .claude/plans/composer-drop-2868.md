# Composer: whole input area is an image drop target (#2868)

## Ask
Josh, 2026-09-11: "can we make it such that if i drag an image and drop to send it that the input
area for the text and the +, like the whole thing is active to drop it in.. i tried to drop it in
the input area and it just pasted a file path".

## What finished looks like
Dropping a file onto the composer input area (the text field, the +, the whole bar) attaches the
file (the same as picking it with the +), instead of the browser pasting the file's path as text.
The composer shows a drop-active state while a file is dragged over it. Both composers behave this
way: the project post composer and the agent-dialogue composer.

## Root cause
The attach mechanism (`attachUploadAll`) and a drop target already existed, but the drop target was
the THREAD/room area (`pj-room` / `d-dmthread`), which sits above the composer. The composer input
area was never a drop target, so a drop there fell through to the text input's native behaviour,
which for a `<input type=text>` / `<textarea>` inserts the dropped file's path as text.

## Approach (web/index.html only, existing mechanism)
1. Refactor the existing drop-wiring loop into a helper `wireDropTarget(drop, where)` (identical
   dragenter/over/leave/drop logic, incl. the depth counter and preventDefault). No behaviour change
   to the thread target.
2. Call `wireDropTarget` a second time per context, on the composer's own `.composerbox`, resolved
   as `document.getElementById(where.textId).closest('.composerbox')`. This covers both composers
   without adding a markup id. preventDefault on dragover/drop is what stops the path-paste; the drop
   routes files to `attachUploadAll(files, where)`.
3. CSS: add `.composerbox.dragging` (same dashed-gold drop-active treatment as `.thread.dragging`),
   as a SEPARATE rule from the base `.composerbox` so the resting box is unchanged (its border/flex
   are guarded by web.focus-ring-1303d).

## Decisions / weakest premises
- Resolve the composerbox via `.closest('.composerbox')` from the text input rather than adding an
  id: both composers already wrap their controls in `.composerbox`, so one line covers both, and no
  markup id churn. WEAKEST PREMISE: a future composer variant without a `.composerbox` wrapper would
  silently not get the drop target; guarded by the wiring test asserting the closest('.composerbox')
  resolution.
- Kept the thread drop target working (Josh may still drop onto the thread); the composer is now an
  ADDITIONAL target, not a replacement.

## Verification
- New test web.composer-drop-2868.test.js pins the wiring + the drop-active CSS; it fails against
  origin/main (which lacks the feature) and passes here.
- Adjacent composer tests (file-pickers, focus-ring, composer-height) still pass.
- Behaviour (actual drop) cannot be rendered from this bot session; Josh reviews live. A browser
  check would exercise the computed drop behaviour; noted in the commit's Browser-check trailer.
