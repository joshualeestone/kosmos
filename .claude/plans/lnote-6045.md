# lnote-6045: the list row's notes are the AI model column's size (Josh, 0.7.45 review)

**Branch:** `lnote-6045` · **Card:** kosmos#6045 (Josh via Splinter 10-13 08:47: "make that font the same size as AI Model").

## Cause
The #5957 notes ("Its working rules are N versions behind...", "Has not run in N days...") are drawn in the list row's
task cell, `.ltask` (.9375rem), beside `.lmodel` (.75rem); same muted ink.

## Change
- `lrowTask(text, note)`: the list task cell. When its text IS the note, it gets `.lnote` and the whole note as its title
  (the cell ends in an ellipsis); any other text (a task, a state sentence) is drawn exactly as before.
- Running row: `lrowTask(taskLine(...), rulesBehindLine(a, false))`. Not-running row: `lrowTask(offlineNote(a),
  offlineNote(a))` (unchanged when the job may be running unseen: an empty cell).
- CSS: `.ltask.lnote { font-size: .75rem; }`, the `.lmodel` size. Colour is already the same (`--k-ink-2`).

## Tests
- web.rulesbehind-render-5957: through the real lrow, a far-behind running row draws `.ltask.lnote` with its title; a
  row with none draws the plain cell (control). The CSS sizes: `.ltask.lnote` equals `.lmodel`, `.ltask` does not.
- Four tests that lift the page's helpers lift `lrowTask` too; three shape guards re-derived for the new cell
  (quoted-line-986, said-line's column order, not-running's slot strings). 551 tests across every file that renders
  lrow or the notes pass.
- In a browser: the computed font size of a note cell equals the model column's, and a plain task cell's does not.
