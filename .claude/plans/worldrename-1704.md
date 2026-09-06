# Plan: rename a Kosmos via a cog (#1704 item 14.1)

## Context
Josh's #1704 item 14.1 (2026-09-05): "Rename via a settings cog. A little cog to the far
right of each world in the list; tapping it re-opens the modal so they can change the
world's name. Requires renaming a Kosmos WITHOUT breaking its file/folder/project/
document structure." Josh offered a fallback ("you can't change the name once created")
only if it's too hard. It is NOT too hard, so we build the real rename.

## Why it is safe (no data migration)
A world resolves BY id, never by name: `worldBaseDir` derives `worlds/<id>` from the
immutable id (= `safeKey(originalName)`) and ignores the stored `base` field; the
switcher renders `w.name`. So a rename updates ONLY the display `name`; id/base/data are
untouched and every project/document keeps its home. That is exactly what Josh asked for.

## What "done" looks like
- Engine `renameWorld(base, id, newName)`: updates the name; refuses the default
  (ERESERVED -- its name is the fixed "Kosmos 1", #2317), empty/whitespace (EBADNAME),
  unknown id (ENOWORLD); trims; atomic via withRegistryLock. Id/base immutable.
- Route `POST /api/worlds/rename` { id, name }: classified like the active route
  (missing id 400, reserved 400, empty 400, unknown 404, held lock 409, else 500/200).
  No restart needed (display-only).
- UI: a rename cog on every NON-default world row in the switcher (a sibling of the row,
  since a non-active row is a <button> and a button cannot nest a button). Tapping it
  opens a rename modal pre-filled with the name; Save posts the rename, refetches, and
  reopens the menu so the new name lands visibly (mirrors the create flow).

## Decisions (decide-and-document)
- **Default is NOT renamable** (no cog on its row). Its name is the "Kosmos 1" constant
  (#2317, re-applied by readRegistry), so a rename could not persist. Josh said "each
  world"; the default is the one exception, because 14.2 fixes its name. If Josh wants
  the default renamable too, that is a follow-up: change #2317's readRegistry force to a
  "default when unset" so an explicit rename can override -- flagged, not done here (it
  would revisit merged #2317 and widen this PR).
- **No duplicate-display-name check.** Ids are the unique key (immutable); two worlds may
  share a display name harmlessly. createWorld does not dedup display names either;
  parity kept.
- **Name length**: the input is maxlength=60 (matching the create input). The engine is
  uncapped, matching createWorld (which relies on the input cap). Parity kept.

## Verification
- Engine: `engine.worlds-rename-1704.test.js` (5 arms: rename keeps id/base + data dir,
  default reserved, empty refused, unknown refused, trimmed).
- Route: `server.test.js` #1704 14.1 (rename ok + default/empty/unknown/missing-id
  classifications + the refusals do not corrupt the valid rename).
- UI: `docs/browser-checks/render-worldrename-1704.js` (HERMETIC file://): the cog is on
  the named world and NOT the default, opens the pre-filled modal, and Save posts
  /api/worlds/rename {id,name}. Run GREEN headless; perturb-verified red-capable (0
  entries + no cog against origin/main). Wired: browser-checks.sh hermetic loop, README
  row, reason-grep counts 52->53 / 30->31. Existing switcher checks
  (render-worlds-switcher-1704, render-worldswitch-2238) still pass (my entry-wrapper
  uses descendant selectors they already rely on).

## Visual-fidelity limit (honest)
The UI wiring is verified structurally (computed DOM + a driven click/submit), not pixel
layout. A headed pass should confirm the cog reads right on the row (placement, the gear
glyph rendering) and the modal looks right -- same limit as #2282/#2326. Not launch-
blocking; a future cut.

## Weakest premise
That a non-default world's id stays derivable/valid after its display name diverges from
it. Checked: worldBaseDir resolves by the stored id (not by re-deriving from the name),
and createWorld dedups by id, so a post-rename id/name mismatch is fine.
