# #2618: remove the Settings > Styles tab entirely

Source: Josh. "remove the Settings > Style tab entirely. We have the tab-view /
consolidated-view flipper, and we don't want to mess with other style themes right
now, so delete the whole settings Style tab. One less thing."

## The scope call (decided; not a Josh question)

The card conflates three surfaces that all get called "the style/theme picker":
- (A) the header/rail light/dark toggle (`.themepick`, sun/moon) - NOT in the Settings
  tab. OUT OF SCOPE, left untouched. Removing it would be scope creep beyond "the tab".
- (B) the Settings Styles tab's palette Theme `<select id="style-theme">` (server-backed
  /api/style) - this is the "other style themes" Josh does not want. REMOVE.
- (C) the tab/consolidated layout flipper, which exists in TWO places: the header/rail
  one-press toggle (`data-layout-switch`, #2154) AND the in-tab tiles+Activate
  (`data-layout-pick` + `#layout-activate`, #1216).

Josh says "we HAVE the flipper" as the justification for deleting the tab. That only
holds if a flipper survives the deletion - i.e. he means the HEADER flipper. So: remove
the whole `s-sec-styles` section (its palette select AND its in-tab layout tiles), and
keep the header flipper as the surviving flipper. This is a real UX reduction (the
tiles+Activate chooser goes), authorised by his explicit "delete the whole tab".

## Load-bearing constraint: layout-on-load must survive

`paintStyles(true)` (boot call, ~29568) fetches /api/style and does applyStyle(tokens)
+ **applyLayout(r.layout, true)** - it is how the SAVED layout (tab vs consolidated) is
applied on page load. It is NOT part of the tab UI and must stay. It already self-guards
its `#style-theme` / `#style-msg` lookups (`if (sel)` / `if (smsg)`), so removing the
section leaves it applying tokens+layout on load with no throw. Keep paintStyles and its
boot call untouched; keep applyStyle (a user's saved look is not ripped away - Josh asked
to remove the picker, not to reset themes).

## The 7 removal sites (a removal is two changes: the element AND what leaned on it)

MANDATORY (page throws on load otherwise):
1. `#s-sec-styles` section (web/index.html ~12768 to its `</section>` before
   `s-sec-advanced`) - the h2, the layout tiles, Activate, layout-msg, the Theme select,
   style-msg.
2. The `#layout-activate` click handler (~29375-29401) - it does an UNGUARDED
   `getElementById('layout-activate').addEventListener(...)`; with the button gone that
   is `null.addEventListener` -> throws on load, killing the whole script. This is the
   trap the section's own #style-msg comment warns about.

CLEANUP (dead but self-guarded, removed for hygiene):
3. Nav button `data-go="styles"` (~11745).
4. `'styles'` in `SETTINGS_SECTIONS` (~24317). The settingsGo guard (24319) redirects an
   obsolete `#styles` URL to `you`, so no dead route.
5. settingsGo hook `if (section === 'styles') paintStyles(true);` (~24347).
6. `data-layout-pick` tiles click handler (~29361-29374) - querySelectorAll, empty/safe
   but dead.
7. `#style-theme` change handler (~29569-29581) - guarded by
   `if (getElementById('style-theme'))`, so it never attaches once the select is gone;
   removed for hygiene.

KEEP: header `.themepick` light/dark (A); header `data-layout-switch` flipper (C-header);
`applyLayout`; `paintStyles` + its boot call; `applyStyle`.

## Tests

- `render-settings-nav.js`: remove `'styles'` from its `SECTIONS` list (line 46), fix the
  "other N sections" count (10 -> 9) and the header-comment section count. Add an ABSENCE
  assertion (a-deletion-ships-with-an-absence-assertion): the settings nav has no
  `[data-go="styles"]` button and no `#s-sec-styles` section.
- `render-theme-toggle.js`: UNAFFECTED - it tests surface (A), which stays. Leave it.
- New/updated coverage that the header layout flipper still works and the saved layout is
  applied on load, so the removal did not take the flipper or layout-on-load with it.

Weakest premise: that the header one-press flipper fully covers the need the in-tab
tiles+Activate served, so removing the tiles loses no capability Josh wants. His "we have
the flipper" supports it; if he actually wanted the tiles kept, this is a one-section
revert.
