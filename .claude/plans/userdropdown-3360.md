# User-dropdown (userpop) redesign - #3360

Josh, #chaoskosmos-design 2026-09-21. Design/frontend lane (Mona Lisa). Repo joshualeestone/kosmos, single file web/index.html + its browser-check. Follow-up to the dropdown built in #3051. Ships in 0.6.85 (staged; 0.6.84 is held).

## Problem
People do not realize the user-dropdown items are clickable. "Settings" is styled like a section header, so the whole panel reads as a label for the two toggles (Appearance + Board view) rather than an active menu. Also a good place to promote Kosmos+.

## Target structure (Josh verbatim)
```
Log in to Kosmos+          (button; plus a logged-in member view)
--- hr ---
Your Profile
AI Models
Token Usage
View All Settings
--- hr ---
Appearance                 (light | dark toggle)
View                       (renamed from "Board view")
```
An icon on each item. Clicking ANY item takes its action AND closes the dropdown, including the Appearance toggle.

## What was built
- **Markup** (web/index.html, userpop-menu ~8200): three groups separated by `<hr class="userpop-sep">`. Every line is a real clickable row (`.userpop-item`) with a leading inline-SVG icon:
  - Kosmos+ group: `#userpop-plus` ("Log in to Kosmos+", gold star) and a dormant `#userpop-plus-member` ("Kosmos+ member", hidden by default).
  - Settings deep-links: `#userpop-go-you` (Your Profile), `#userpop-go-models` (AI Models), `#userpop-go-usage` (Token Usage), `#userpop-settings` (View All Settings, id preserved).
  - Toggle rows: Appearance (themepick) and the renamed "View" (laypick, aria-label updated), each given a leading icon; the agent-status stamp row kept last.
- **CSS** (~1346): `.userpop-settings` selector became `.userpop-item` (icon+label flex row, hover, focus). New `.userpop-ico`, `.userpop-sep`, `.userpop-plus` (gold star accent), `.userpop-plus-member`, `.userpop-plus-badge`. `.userpop-lbl` made a flex row so the toggle rows carry an icon.
- **JS** (wireUserpop ~21250): one `userpopSettingsGo(section)` helper mirrors #rail-me-go (consolidated → openConsolidatedSettings after setting SETTINGS_SEC; tab view → showTab('settings') + settingsOpen(section)), closing the menu either way. A `goMap` wires every item. The in-menu document click handler now closes on `[data-layout-switch], [data-theme-set]` (Appearance closes too). `syncUserpopPlus()` + `plusMember()` show exactly one of promo/member; called on open.

## Deep-link targets (verified against settings nav)
- Your Profile → data-go="you" (s-sec-you)
- AI Models → data-go="accounts" (s-sec-accounts, labelled "AI Models" in the nav)
- Token Usage → data-go="usage" (s-sec-usage)
- View All Settings → showTab('settings') with no sub-section (old #userpop-settings behaviour)
- Log in to Kosmos+ → data-go="plus" (s-sec-plus, the real in-app sign-in surface)

## Kosmos+ login, the one maybe-cross-lane piece (decided, reversible)
Sign-up happens on the site, not in the app, and there is **no membership signal in the app yet** (plus-state2 is explicitly reachable-by-design-not-by-signal). Decision: "Log in to Kosmos+" deep-links to Settings > Kosmos Plus (a real action, no dead button); the "member" line is built but dormant behind `plusMember()`, a stub returning false, so the promo shows for everyone until a real signal is wired. Weakest premise: Josh asked for a logged-in member state, which cannot be honestly driven today; building it dormant (matching the existing plus-state2 precedent) rather than faking a signal. Flagged: the membership signal is the engine piece (Splinter/Angel).

## Decisions made myself (reversible)
- Keep the #checked agent-status row (Josh did not ask to remove it; kept last so the theme-toggle/render checks that assert stamp-below-picker still hold).
- Icon choices are my pick (person / chip / gauge / sliders / star / contrast / layout). Swapped the settings gear for a sliders icon after a screenshot showed the gear read as a sun next to the Appearance sun.
- #userpop-settings id preserved so sibling checks that click it (#2842 consolidated-settings, #3053 new-agent) keep working.

## Browser-check
render-user-menu-3051.js rewritten to assert the new structure, deep-link routing (each lands on its section + closes the menu), the renamed "View", icons on every line, the dormant member line hidden, and the appearance-closes-menu behaviour. Surface header updated with the new ids. 60 assertions pass (both themes, pinned Playwright, HEADED=0).

## Validation
Full suite green: node tests 8000 / pass 7854 / fail 0; all shell arms 0 failures; render-user-menu-3051 green.
