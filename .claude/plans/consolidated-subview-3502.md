# #3502 / #3503 / #3504 - consolidated project sub-view cleanup

Josh, 2026-09-23 (design channel, 3 screenshots of the consolidated project view). Three
display-only fixes to the Documents / Tasks / Project Settings sub-views. All CSS + one class
swap, consolidated-scoped, no behaviour change.

## #3502 - remove the redundant "Back to <project>" buttons
The three sub-views each render a `.back` button (`#docs-back`, `#alltasks-back`,
`#pj-settings-back`). In the consolidated view the project is already open and its name is one
click away, so the back control is redundant. Hide all three, scoped to
`html[data-layout="consolidated"] body.consolidated`, so the TAB view keeps them (there the back
control is the way out).

Josh's explicit constraint: on Settings, removing the back button must NOT let "Project settings"
jump against the top rule. The back button was the first element and carried the top gap. Tasks
already had `padding-top: var(--space-8)` (#3133); give Documents and Settings the same, so every
heading keeps a normal top inset with the back button gone.

## #3503 - add a left inset to Documents + Tasks
The consolidated sub-views carried `padding-right: var(--space-8)` but no left inset, so content
sat flush against the left rule. Add `padding-left: var(--space-8)` to `#pj-docs-view` and
`#pj-alltasks-view` so left matches right. Settings is centered (`max-width` + `margin: auto`), so
it is deliberately excluded.

## #3504 - gold Finder button
`#docs-finder` ("Open this folder in Finder") was `class="linkish"` (a plain text link). Make it
`class="btn uprime"` (the gold primary button) so it reads as an easy, obvious action.

## Verification
Verified by a real consolidated render (pinned pw-runtime): back buttons `display:none`, headings
sit 24px below the view top, Documents/Tasks carry a 24px left inset (Settings 0, centered), and
the Finder button paints gold. New browser-check `render-subview-cleanup-3502.js` asserts all of
this with tab-view controls; positive-controlled (7 assertions fail on the pre-fix markup, all 14
pass on the fix).

## Rejected / decisions
- Not hiding the back buttons in every layout: the tab view needs the back control, so the rule is
  consolidated-scoped, with a tab-view control asserting they still render there.
- Not adding a left inset to Settings: it is centered, so a left inset would push it off-center.
- `render-alltasks.js` declares the `pj-alltasks-view` surface token, which this diff touches (the
  new consolidated padding rule). That check asserts the all-tasks CONTENT (count, rows), which is
  unchanged; the new consolidated inset + back removal for that view is covered by
  render-subview-cleanup-3502.js. Carried as a per-check surface override trailer, not a code change
  to render-alltasks.js.

## Weakest premise
The render is a headless boot with mocked APIs and force-shown sub-views, not a fully navigated
live build. The changes are pure CSS/class layout facts (display, padding, background) that do not
depend on the data or the navigation path, and each is measured against a tab-view control. What
would change my mind: the deployed 0.6.90 build shows a back button still present in consolidated,
or a heading touching the top rule.
