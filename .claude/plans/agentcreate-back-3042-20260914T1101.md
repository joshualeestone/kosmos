# Plan: remove "All agents" back button on the agent-creation progress screen (#3042)

Branch: `agentcreate-back-3042`
Card: #3042 (enhancement). Source: Josh 6.63 testing, 2026-09-14, filed by Splinter, for 6.65.

## Goal / done condition
On the agent-creation PROGRESS screen (`#cstep-made`, the "Making it" step with the dot-mark and
the making-folder / writing-instructions / say-hello ticks), the "All agents" back button
(`#create-back`, "<- All agents") is removed, so a person cannot accidentally leave while an agent
is being created. The button STAYS on the form steps (`#cstep-role`, `#cstep-name`), where leaving
before submit is safe. The top tab bar remains the way out on the progress screen (same pattern as
the removed in-project back arrow, #2711 item 17). Verified headless by render-createnav-2190.js.

## Mechanism
`cstep(which)` toggles the `[hidden]` attribute on `#cstep-role|name|made` so only the active step
is visible. `#create-back` is a direct child of `#panel-create`, outside the step divs, so it shows
on every step today. A single scoped CSS rule keys the removal off the active step:

```css
#panel-create:has(#cstep-made:not([hidden])) #create-back { display: none; }
```

`:has()` is already used elsewhere in this file, and it tracks cstep()'s existing toggle with no JS
change. CSS-only, so the button reappears automatically on the form steps.

## Files
- `web/index.html`: the one CSS rule + its comment, in the create-step CSS block (near #cstep-name).
- `docs/browser-checks/render-createnav-2190.js`: added a `backVisible` computed-style capture and
  two arms - created (progress screen) -> back HIDDEN; refused (routes back to the form) -> back
  VISIBLE (the control proving the removal is scoped, not blanket). Surface annotation updated to
  add `create-back`.

## Verification
- render-createnav-2190.js (hermetic, chromium): PASS with the fix. Negative control (selector
  neutralized): the created arm FAILS ("back still visible on progress screen"), the refused arm
  still passes - proving the check discriminates and the removal is scoped.
- Regression: web.create-ids / web.full-width / web.consolidated-980 (markup balance) 21/21 pass.
- No `<tag>`-like tokens in the new comment (the markup-balance-parser lesson from #3031).

## Weakest premise
That `#cstep-made` is the only state where leaving is unwanted. If a future step is added where the
person also should not leave, this rule would need to extend to it. Today the three steps are
role / name / made, and only made is the in-flight state. Josh's in-app pass on 6.65 is the final check.

## Decision recorded
Chose CSS `:has()` scoped to the made step over a JS toggle in cstep(): no behavior code touched,
the button self-restores on the form steps, and it tracks the existing hidden-attribute toggle.
Rejected hiding it for the whole `#panel-create` (would remove it from the safe form steps too).
