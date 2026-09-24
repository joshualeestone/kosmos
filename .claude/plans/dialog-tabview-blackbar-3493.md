# dialog-tabview-blackbar-3493 - Tab-view conversation column blacked (no gray seam)

## Card
kosmos#3493 (Josh, 2026-09-23): on the project TAB view there is still a light gray bar
between the dialog background and the input field (the area around/behind the input, between
the dialog bg and the input box bg). It must be black (#000), no gray seam; the whole
highlighted shape black. Continuation of #3462 dialog bg (#fff/#000).

## Done-condition
In dark mode on the project tab view, the conversation column is one uniform #000 ground with
no gray fill showing around or behind the dialogue; light mode unchanged; the paid Plus tier's
navy is untouched.

## Root cause (measured, not inferred)
The conversation column is `section.pjcol.pjmid`. `.pjcol` (base rule) sets
`background: var(--k-surface)`, which is #17191c in dark. #3462/#3267 blacked the INNER
dialogue (`.thread`, `.composer`) to #000 in the tab view, but the `.pjmid` column fill itself
stayed #17191c, so it showed as a gray seam framing the black dialogue. A headless probe of the
real DOM confirmed dark: pjmid #17191c, thread #000, composer #000, input(.composerbox) #17191c;
light: all #fff (no complaint, consistent). The consolidated view already blacks its `.pjmid`
in dark (line ~8058); the tab view was the gap.

## The change
- web/index.html: add, in the `@media (prefers-color-scheme: dark)` block, a rule blacking the
  tab-view column: `:root:not([data-theme="light"]) body:not(.consolidated):not(.plus-active) .pjmid { background: #000000; }`.
  Scoped to the tab view (consolidated handled separately) and excluding the paid Plus navy.
- Regenerated the forced-theme twin with `node tools/sync-forced-theme.js` (do not hand-edit the
  GENERATED block); `--check` is clean.
- The input (`.composerbox`) keeps its distinct #17191c field (#3369) - the card leaves the
  input-box background alone; only the fill BETWEEN the dialogue and the input goes black.

## Verification
- Headless probe: dark tab pjmid #17191c -> #000; light unchanged (#fff).
- docs/browser-checks/render-room-msgbox-2806.js: new tab-view arm asserts `.pjcol.pjmid` is
  #000 in dark, the light surface in light (non-vacuous control), and NOT blacked in dark+plus
  (the :not(.plus-active) exclusion). The fixture carries BOTH classes because the gray comes
  from the .pjcol base; a bare .pjmid would pass vacuously.
- Positive control: setting the rule back to #17191c reds the dark/tab arm (rgb(23,25,28));
  #000000 passes.
- render-plus-blue-1615.js still passes (the Plus blue skin is untouched by the exclusion).

## Rejected
- Blacking the input (.composerbox) too: #3369 makes it a deliberate distinct dark field the
  black ground surrounds, and the card's highlighted region is the fill AROUND/BEHIND the input,
  not the input itself.

## Weakest premise
That Josh wants the input to remain a distinct #17191c field rather than also #000. The card
says "matching ... the input-box background", which I read as the input being an accepted
reference, and the highlighted region being the fill between the dialogue and the input. If he
wants the input blacked too, that is a one-line follow-up on `.composerbox`.
