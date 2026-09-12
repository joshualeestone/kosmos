# 2842 consolidated view: open user settings inside the display area

## The problem (Josh, 0.6.57 review)

On the consolidated view, hitting user settings (bottom-left, `#rail-me-go`) jumps
the user OUT to the tab view. The only way back is a top tab. Josh wants settings to
open IN PLACE in the display area, the way View-All for tasks/files does: keep the
agents column and the projects column, and use the display area to render the
settings.

## Root cause

`#rail-me-go`'s click handler does `document.querySelector('.tab[data-tab="settings"]').click()`,
which runs `showTab('settings')`. `showTab` computes `cons = layoutConsolidated() && (tab === 'agents' || tab === 'projects')`, so `settings` yields `cons = false` and
`body.consolidated` is removed, dropping the whole consolidated layout.

## Key structural fact that makes this "relatively easy" (Josh's words)

In the consolidated view `#panel-projects` is a 2-column grid: `#pj-list-view` (the
projects list) at column 1, and everything else at column 2 via the existing rule
`html[data-layout="consolidated"] body.consolidated #panel-projects > :not(#pj-list-view) { grid-column: 2 }`.
So ANY child of `#panel-projects` except the list auto-places in the display column.
`#panel-settings` is a top-level `<section>` sibling of `#panel-projects`; moving it
into `#panel-projects` lands it in the display area with no new placement CSS. This is
the same reuse the View-All views (`#pj-alltasks-view`, `#pj-docs-view`) already rely on.

## The fix

1. `placeAppSettings(consolidated)` (new, mirrors #2848's `placeSubProjects`): in the
   consolidated view it moves `#panel-settings` into `#panel-projects` (a display-area
   child); in the tab view it restores it to its original top-level slot (captured
   lazily on the first move). Reversible and idempotent. Called from `showTab`, keyed on
   the same `cons` flag that toggles `body.consolidated`, so a resize or layout switch
   moves it back.
2. `#rail-me-go` routes by layout: in the consolidated view it keeps `body.consolidated`,
   ensures `#panel-projects` is shown, moves settings in, shows it via `pjView('appsettings')`,
   and paints the settings + the current section; in the tab view it keeps the existing
   behavior (click the settings tab).
3. `pjView` learns the `appsettings` view: it shows `#panel-settings` when
   `which === 'appsettings'` and hides it otherwise (guarded to when the panel is actually
   relocated into `#panel-projects`), exactly like the `pj-*-view` divs. The projects
   list stays visible beside it (the existing `which !== 'list'` rule). Navigating to a
   project (`pjView('one')`) hides settings, so the projects list is the natural way back.
4. `syncUrl` treats `appsettings` like `list` (writes no project sub-view), so the URL
   does not falsely claim a project view while settings is showing.
5. CSS (consolidated only): fit `#panel-settings .dbody` into the display column width
   (its tab-view layout is a fixed 34rem centered column, too wide for the column), and
   give it the same scroll treatment as the other display views.

## Scope and known limitation

Consolidated view only; the tab view is unchanged (settings stays a full-page tab there).
`URL_TAB` is deliberately left as `projects` in the consolidated settings mode rather than
set to `settings`, because the resize handler keys on `URL_TAB` to decide whether to stay
in the consolidated view, and `settings` would make a resize kick back to the tab view.

Consequence (documented, minor): a few settings behaviors gate on `URL_TAB === 'settings'`
(most visibly the Plus section's decorative canvas animation). In consolidated settings
mode the Plus section still renders its static content but its canvas does not animate.
This is a decorative edge, not core settings functionality; the account/machine/skills/
policy/usage sections all render and are navigable.

## Weakest premise

That keeping `URL_TAB = projects` does not break any load-bearing settings behavior beyond
the Plus canvas. Verified by browser-testing that the main settings sections render and the
section nav works inside the relocated panel.

## Coverage

New browser-check `docs/browser-checks/render-consolidated-settings-2842.js`, wired into
`tools/browser-checks.sh` (the batch `for n in` loop, beside `render-subprojects-1994`),
driving the shipped `showTab` + `#rail-me-go` handler + `openConsolidatedSettings` + `pjView`
against a real fixture in the real page, in both themes. It asserts:
- `body.consolidated` stays on when settings opens (does NOT kick to tab view) -- the fix;
- `#panel-settings` is relocated into `#panel-projects` and visible in the display column;
- `#pj-list-view` (the projects list) stays visible beside it, project view hidden;
- settings FILLS the display column (its left sits just past the list, near-full column
  width) -- guards the `margin: 0` fix, since without it the panel centers and shrinks;
- clicking a project restores the project view and hides settings;
- leaving the consolidated view restores `#panel-settings` to the top level;
- a CONTROL: in the tab view `#rail-me-go` does not enter the consolidated view (unchanged).

Proven red-capable by two perturbations: neutering the `#rail-me-go` consolidated branch
reddens the four core behavior assertions per theme; removing the `margin: 0` reddens the
fills-the-column assertion (observed `leftGapPastList: 180, settingsWidth: 554`).
