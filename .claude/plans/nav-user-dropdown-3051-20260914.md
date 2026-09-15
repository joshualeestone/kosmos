# nav-user-dropdown-3051 - upper-right user avatar+name dropdown (#3051)

## What / ruling (Josh, 6.63 testing, for 6.65, verbatim on the card)
Rework the upper-right nav for BOTH the tab view and the consolidated view:
- A user AVATAR in a circle with the NAME beside it, clickable -> a dropdown containing:
  the Settings link, the light/dark control, the tab/consolidated view toggle, and the agent-status line.
- REMOVE Settings from the top nav (top nav becomes just Agents + Projects). Settings is reached via
  the dropdown's Settings link.
- Consolidated view: move the user from the bottom-left (#rail-me) up to the top-right; show the avatar
  + username (NOT the word "Settings"); click -> the same dropdown (settings / light-dark / view toggle
  / agent-status).

## Current state (web/index.html, the pieces this touches)
- Tab-view header `<div class="apphead"><header>` (~7639). Upper-right `<div class="headright appright">`
  (~7737) holds: `#checked` (the status "stamp", ~7756), `.themepick` (light/dark radiogroup, 7757), and
  `.laypick` (board-view toggle tabs/consolidated, 7776). NO avatar/name today.
- Top nav `<nav class="tabs" id="tabs">` (7732): three `.tab` buttons -- agents / projects / settings (7733-7735).
- Consolidated user `#rail-me` (~13292, bottom-left): `.railme-go` button (avatar `.railme-face` "You" +
  `.railme-n` name + `.railme-s` "Settings"), plus `.themepick.railme-theme` and `.laypick.railme-lay`
  copies -- BOTH hidden in consolidated today (CSS #2282, line 3084). The header `.headright` is hidden
  in consolidated, which is why rail-me carries its own control copies.
- There is a `worldsw` menu (7660) that is a good REUSE PATTERN for the dropdown: a button with
  aria-expanded/aria-controls + a hidden `.worldsw-menu`, with a document-level click-to-close handler.
- The theme + view controls are driven by ONE document-level handler + paintThemePicker/applyLayout;
  BOTH the header and rail-me copies carry data-theme-set / data-layout-switch, so a new dropdown copy
  is served by the same handlers verbatim (no new JS store).
- Settings tab is opened by showTab('settings'); the settings PANEL (#panel-settings) stays -- only the
  TAB button is removed. Search `.tab[data-tab="settings"]` (e.g. 27538) for JS that references it.

## Design decisions (mine, per Josh's standing make-the-call ruling; he refines in the running app)
1. New component `.userpop` (reuses the worldsw popover pattern): a `<button class="userpop-btn"
   aria-expanded aria-controls>` = avatar circle (reuse `.railme-face` avatar source) + name; opens a
   hidden `.userpop-menu` with, in order: a Settings link (a `<button>` that does showTab('settings')
   and closes the pop), the `.themepick` (light/dark) verbatim, the `.laypick` (view toggle) verbatim,
   and the agent-status line (the `#checked` stamp's content, relabeled as a line). Keyboard-operable
   (native buttons; Esc/click-away closes), following worldsw's a11y shape.
2. ONE `.userpop` markup, placed so it renders in the tab-view header upper-right AND, in consolidated,
   in the top-right. Simplest: keep a single `.userpop` in `.headright` and make `.headright` (or just
   `.userpop`) VISIBLE in consolidated too, positioned top-right; retire `#rail-me`'s bottom-left slot
   (or repoint it). Decide during increment 2 by reading the consolidated header CSS.
3. Remove the Settings `.tab`; update any JS that assumed 3 tabs / referenced the settings tab button so
   it still routes to the settings panel (the dropdown Settings link becomes the entry).

## Sequence (increments, each harness-verified)
1. Tab view: add `.userpop` to `.headright` (avatar+name + dropdown with Settings link + move .themepick
   + .laypick + agent-status into it); remove the Settings `.tab`; fix showTab/tab-count JS. Add a
   browser-check (docs/browser-checks/) asserting: only Agents+Projects tabs; the userpop button shows
   avatar+name; the dropdown opens and contains the four items; Settings link routes to #panel-settings.
2. Consolidated view: surface `.userpop` top-right (retire rail-me bottom-left); assert via browser-check
   at consolidated layout.
3. Wire the browser-check into tools/browser-checks.sh + README + selectors (the #1720/#2617 gate family
   -- see the memory "browser-check wiring guards"); em-dash sweep; /challenge-loop; /create-pr
   (Addresses #3051 non-closing; 6.65). Kosmos beta -> merge on CI green per Josh's ruling.

## Weakest premise / open
- The dropdown's exact look + the "agent-status line" format are underspecified; I build the structural
  version (reusing existing controls verbatim) and Josh refines visually in the running app. If a design
  mock exists (installkosmos.com/... mocks are referenced elsewhere), prefer it.
- Consolidated placement (increment 2) depends on the consolidated header CSS -- confirmed during that
  increment, not assumed here.

## AS BUILT (both increments in one PR)
Increment 1 and 2 landed together because the premise "the header .headright is hidden in the
consolidated view" is STALE: since #2282 the one full-width header renders in EVERY view (only the
center tabs + h1 hide in consolidated). So a SINGLE `.userpop` in `.headright` already renders at the
top-right in both the tab and consolidated views -- there was no second placement to build.

- web/index.html: added `.userpop` (button = `#userpop-face` avatar + `#userpop-name` + chevron; menu
  = `#userpop-settings` link + the moved `.themepick` + `.laypick` + the moved `#checked` stamp).
  Removed the Settings `.tab`; added `'settings'` to `BUTTONLESS` (16958) so `showTab('settings')`
  still shows `#panel-settings`. `#rail-me-go` else-branch now calls `showTab('settings')` directly
  (the tab button it used is gone). `paintRailMe` paints `#userpop-face`/`#userpop-name` too (single
  source with the consolidated rail). `wireUserpop` IIFE: toggle + Escape/outside-click close; the
  Settings link calls `openConsolidatedSettings()` in consolidated (mirrors #rail-me-go, keeps #2842)
  else `showTab('settings')`. Boot now calls `refreshYouName()` so the always-visible name is not
  stuck on "You". CSS: `.userpop*` on the worldsw pattern; `.userpop-btn` height 32px to match
  `.worldsw-btn` (#2350). Increment 2: `#rail-me` is `display:none` in consolidated (the person moved
  up to the top-right; the rail's bottom-left slot is retired).
- New check: docs/browser-checks/render-user-menu-3051.js (hermetic file://; 30 assertions; 2-tab nav,
  avatar+name, the four dropdown items, Settings link -> #panel-settings with no tab lit, Escape +
  outside-click close). Wired into the line-1283 loop; README row; surface tokens
  (userpop-btn/userpop-menu/userpop-settings/BUTTONLESS).
- Reconciled the checks that encoded the old header layout: the 14 that navigated by clicking the
  now-removed Settings tab -> `evaluate(() => showTab('settings'))` (behavior-preserving; the tab
  click always ran showTab); render-theme-toggle + render-viewtoggle-header-2154 open the userpop
  before measuring and drop the retired header-geometry arms; render-worldsw-height-2350 now matches
  worldsw-btn to userpop-btn (themepick left the row); render-tophead-consolidated-2282 asserts the
  controls render inside the header user menu + #rail-me retired; render-consolidated-settings-2842 +
  render-consolidated-newagent-3053 drive #userpop-settings (the #2842/#3053 behaviour is unchanged,
  only the entry moved); render-update-toast + render-full-width drop #checked as a header-row peer.
- The reason-grep guard counts were bumped +1 each (one quotable finding-emit loop + one launch catch).

## Weakest premise (as built)
- Retiring the bottom-left #rail-me person in consolidated is my read of "move the user up"; it is one
  CSS rule and fully reversible if Josh wants the person kept in both places. What would change my
  mind: Josh saying the bottom-left person should stay.
