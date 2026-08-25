# Plan: consolidated-match-mock

Josh, #chaoskosmos-design, 2026-08-25 15:52 and 16:00, five screenshots
plus the real reference at installkosmos.com/consolidated-mock.

## Changes

1. **Right column reorder: tasks, project members, files.** #867
   shipped members-tasks-files; Josh corrected it against the real mock
   (whose own markup renders in exactly this order).
2. **The project cards get their real border and background back.**
   #867's own comment claimed the flat, borderless treatment "matched
   the mock" -- a citation nobody had actually checked. The real mock
   draws Tasks/Members/Files as white, bordered, rounded cards
   (`.rcard`) on a tinted column background (`.rcol`) -- the SAME
   relationship `.pjcard` already has to the page everywhere else in
   this app. The fix is to stop overriding `.pjcard` in consolidated
   (it already looks right without any override), and tint the ground
   behind it instead: the whole `.pj3` area gets the same `--k-sunk`
   tint the agents/projects rails already use, and `.pjmid` (the
   conversation) gets an explicit white panel treatment so it reads
   distinctly from the tinted cards beside it.
3. **Each project row in the rail shows its agent count** ("N agents",
   as a subtitle under the title) -- the mock's own project list
   subtitle. The count and the markup for it already existed
   (`.pjcount`, built for the tab view's project tiles); it was hidden
   in consolidated along with the face-icon avatars, which the narrow
   rail genuinely has no room for. Un-hides the count text specifically
   while keeping the face icons hidden.
4. **The "drop a file... type @" composer hint is stripped in
   consolidated only.** Josh: "this is kind of the power user mode.
   They're going to know what a + means or how to do an @ to mention
   agents." Tab view keeps it.

## Also fixed: two existing tests pinned the wrong-citation behavior

`web.layout-picker.test.js`'s "piece six" test and
`web.consolidated-867.test.js`'s "tasks are sorted above files" test
both asserted the flat-borderless-cards treatment and the old
members-tasks-files order as correct. Updated both to stop asserting
the superseded behavior; the corrected assertions live in the new
`web.consolidated-match-mock.test.js`, which also documents the
citation error in full so a future reader does not repeat it.

## Explicitly not built here

Two other items from the same feedback batch need their own live
repro before a fix, not a guess from static CSS reading: agent avatars
apparently still square in some states beyond the one already fixed
in #899 (unconfirmed at this batch's resolution), the agents-column
height jumping between projects, and "projects overlap outside its
bounding box" when the projects rail is narrow and the agents rail is
expanded. Filed separately.

## Verification

- [x] Reproduced against a real live server (sandboxed `./server.js`,
      not `pkill`-vulnerable): seeded two projects, one with an agent
      tied and one task, switched to consolidated, and screenshotted
      the right column directly. Confirmed via `getComputedStyle`:
      Tasks/Members/Files all render `background: rgb(255,255,255)`,
      `border: 1px solid rgb(227,225,220)`, `border-radius: 12px` --
      matching the real mock's `.rcard` exactly. Confirmed the "1
      agent" subtitle renders under a project with a tied agent, and
      that the composer hint text is absent from the rendered page in
      consolidated view.
- [x] `node --test web.consolidated-match-mock.test.js`: 5/5 pass.
- [x] `node --test web.consolidated-867.test.js web.layout-picker.test.js
      web.consolidated-avatar-crop.test.js`: 25/25 pass (the two tests
      touching the superseded behavior updated, not deleted).
- [x] `npm test` (full suite): 0 failures, exit 0.
- [x] `bash tools/browser-checks.sh` (full suite).
