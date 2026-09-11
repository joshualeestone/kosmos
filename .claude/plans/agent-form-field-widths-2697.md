# agent-form-field-widths-2697: size the agent Profile form fields (kosmos#2697)

Addresses kosmos#2697 (Josh, design channel 2026-09-10, a josh-review design-capture card).

## Problem

On the agent Profile tab (the detail panel's Profile section), the three fields ran the full container width. Josh's exact words, from the screenshot (agent-form-field-widths-2026-09-10.png, the Profile tab of agent "Kano"):

> All of these input fields and the dropdown should not be this gigantic. They're running the entire width of the whole container. The name one could be 25%, the reports two could be 25%, and what they do maybe would be 50% width. Additionally the "Reports to" title is too close to the "What they do" input box. We need some more [spacing].

Plus, from the card title: wrap the Name helper text at ~50% (it is the long one and runs the full width).

Note: the card TITLE says "Agent-creation form", but Josh's screenshot and words are the Profile/detail tab (fields Name / What they do / Reports to, in that order, matching the detail form `#d-rename` / `#d-role` / `#d-reports`, not the create form). The screenshot is the ground truth for intent, so this fixes the Profile/detail form.

## The fix (CSS + one id, scoped, no behavior change)

The three fields are `flex: 1; min-width: 220px` inside a flex `.frow` (inputs at the shared `.frow input[type=text]` rule; the `#d-reports` select in the shared id-list rule), so each fills its row. Size each by overriding its flex, scoped to the detail form's ids so no other form changes:

- `#d-rename { flex: 0 1 25%; }` (Name ~25%)
- `#d-role { flex: 0 1 50%; }` (What they do ~50%)
- `#d-reports { flex: 0 1 25%; }` (Reports to ~25%)
- `#d-reports-wrap { margin-top: 18px; }` spacing above "Reports to". `.detail .field` zeroes margin-top, and this wrap (unlike its Name/What-they-do siblings, which carry inline `margin-top:18px`) had none, so its title sat right under the What-they-do input. 18px matches the siblings.
- Added `id="d-rename-hint"` to the Name `.fhint` and `#d-rename-hint { max-width: 50%; }` so the long Name helper wraps at ~50% rather than running full width.

The shared `min-width: 220px` is left in place, so on a narrow panel (where 25% would be below 220px) the fields floor at 220px rather than becoming unusably small. Josh's complaint is the wide desktop layout, where 25%/50% resolve above the floor.

The `#2697` block is placed immediately after the shared `flex: 1; min-width: 220px` id-rule so that, for `#d-reports` (same single-id specificity), source order makes the new rule win. The input rules win on specificity (one id beats `.frow input[type=text]`).

## Rejected

- Styling `.frow input` / `.field` globally: rejected. Those classes are shared across every form (create, project, world, settings); a global width change would shrink fields Josh did not ask about. Scoped to the four detail-form ids instead.
- Removing the `min-width: 220px` floor to make 25% exact on every width: rejected. On a narrow panel that yields a ~150px Name field, unusable; the floor is a reasonable safety and only overrides the percentage where the percentage would be too small.
- Wrapping the What-they-do and Reports-to helpers too: rejected. Those helpers are short and already fit on one line; Josh named only the Name helper.
- Touching the create form (which has the same full-width fields): out of scope. Josh's screenshot and words are the Profile tab; the create form can get the same treatment as a separate follow-up if he asks.

## Verification

- `docs/browser-checks/render-profile-field-widths-2697.js` (new): hermetic file://, unhides `#panel-detail` + `#d-sec-profile` + `#d-reports-wrap` at a wide viewport (so 25% clears the 220px floor), and measures each field's width against its `.frow`: Name ~25%, What they do ~50%, Reports to ~25% (with tolerance), the What-they-do field wider than Name and Reports to, `#d-reports-wrap` margin-top > 0 (spacing restored), and the Name helper width at ~50% of the form. Proven can-fail by reverting each rule.
- Scoping NEGATIVE CONTROL (added after the first challenge-loop review flagged it): the whole safety of the change is that it narrows ONLY the detail-form ids. The create form is a separate hidden panel that neither lays out nor returns reliable computed flex values while hidden, so the control reads the CSSOM instead: it collects every rule with a 25%/50% flex-basis (the #2697 signature) and asserts each of `#d-rename`/`#d-role`/`#d-reports` has one (the change is present) and that no such rule's selector mentions a create-form id. Proven can-fail: widening a #2697 rule to `#d-rename, #create-name` reds it.
- The browser-check wiring guards reconciled (reason-grep counts, README index, browser-checks.sh loop).

## Weakest premise

The card title says "creation" but I built against the Profile/detail form because that is what Josh's screenshot shows. If Josh actually meant the create form (or both), this fixes the wrong-or-partial form. Mitigation: the screenshot is unambiguous (Profile tab, agent Kano, the detail-form helper strings), and the create form has the identical full-width issue so the same scoped pattern transfers trivially if he wants it too.

## Release-cut note

There is an active 0.6.55 cut (Baron) touching the render surface. This branch is built and PR'd but its MERGE is HELD until 0.6.55 is staging-ready, per the merges-pause-during-a-cut rule. Do not self-merge into the cut.
