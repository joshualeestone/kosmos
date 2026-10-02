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
- Both surfaces get it: the create form's import panel and the find-agents screen's loose-file rows
  (`frPaintScan` uses the same row builder and the same click handler).

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
- web.import-name-4962.test.js (9): the nameless row's field, label and helper (a named row has none); distinct
  ids for two paths sharing a 60-character tail; an empty field asks, sends nothing, focuses the field; a typed
  name is sent as name and label; a named row is unchanged (control); the typed name beats a parsed displayName;
  an engine refusal shows its reason and re-enables the field and button; Enter wiring.
- 7 sabotages, each red by rc: no field, empty not asked, cursor not placed, typed name ignored, typed label
  ignored, field left disabled on a refusal, colliding ids.
- web.import-found-1652.test.js and fixture-discipline.test.js unchanged and green.
- Browser check: an arm for the nameless row (both engines). Design shots for the new row.
