# kosmos#4962: a found agent file with no name gets a Name field on its row

Split from #2461's acceptance (Josh's 0.6.47 test, 2026-09-07): "the empty-name case lets the person type a
name as part of adding".

## Change (web/index.html only)
- `foundImportRowsHtml`: a row with no name gets a labelled Name field (`tk-inp fr-importinput`, the page's own
  field style) and the helper "What should we call it? You can rename it anytime." (the first-run adopt rows'
  words). The field id carries the row index as well as the path, since cssId keeps only 60 characters.
- `addImportedInPlace`: an empty field says "Give this agent a name first." and focuses it, sending nothing (the
  first-run adopt rows' rule). A typed name is sent as BOTH `name` (the engine folds it, "Claude Pip" becomes
  claude-pip, and refuses one it cannot use, with a reason the row shows) and `label`. The field is disabled while
  adding, re-enabled on a refusal, left disabled once added (like the button).
- Enter in the field presses that row's Add.
- Both surfaces get it: the create form's import panel (the one a person reaches today) and first run's
  find-agents loose-file rows (`frPaintScan`, same builder and handler; not reached during setup since #2497,
  but kept and live code, so it is made safe too).

## Decided, and rejected
- The typed name wins over anything the file parses to, because the row asked the person. Rejected: using the
  file's displayName when present (the row only shows a field when the scan found no name, and someone who typed
  a name expects to see it).
- Rejected: a separate slug field. The engine already folds a display name into a machine name and refuses an
  unusable one in words (create.js slugFor / nameProblem), so one field is enough.

## Weakest premise
That one field is enough on a phone through Kosmos+: the field is 13px (`.tk-inp`), and iOS zooms into a field
under 16px. The project page has a touch-only 16px rule (#718) that does not reach this panel; the first-run
adopt field is 14px and has the same exposure. Not fixed here; stated.

## Tests
- web.import-name-4962.test.js (12; review 1 added the Enter handlers run for real, the first-run exemption,
  per-surface ids, a typed name kept across a redraw, focus and aria-invalid after a refusal): the nameless row's field, label and helper (a named row has none); distinct
  ids for two paths sharing a 60-character tail; an empty field asks, sends nothing, focuses the field; a typed
  name is sent as name and label; a named row is unchanged (control); the typed name beats a parsed displayName;
  an engine refusal shows its reason and re-enables the field and button; Enter wiring.
- 7 sabotages, each red by rc: no field, empty not asked, cursor not placed, typed name ignored, typed label
  ignored, field left disabled on a refusal, colliding ids.
- web.import-found-1652.test.js and fixture-discipline.test.js unchanged and green.
- Browser check: an arm for the nameless row (both engines). Design shots for the new row.

## Review 1 (opus, blind, 2026-10-01 23:00): 1 blocker, 3 warnings, 5 nits, all taken
Blocker: Enter in the field on first run also pressed Continue (frEnterSubmit) and ended setup mid-add; that
handler now exempts `.fr-importinput` and `.fr-adoptinput` (the adopt field had the same problem), and the row's
Enter handler ignores an already-handled Enter. Warnings: a refusal puts the cursor back in the field, marks it
aria-invalid and ties the reason to it (aria-describedby -> the row's error line, which now has an id); the field
id carries the surface (cf / fr) so both lists in the page cannot share ids; a typed name and the cursor survive
a redraw (importNamesKept / importNamesRestore at both draw sites). Nits: the Enter tests run the handlers; maxlength
is the engine's 32; a row that was added names what was made; the keydown handler sits after the click handler
it no longer interrupts; the test count corrected. 7 more sabotages red, one of them the blocker itself.
