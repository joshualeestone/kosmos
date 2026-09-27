# What's New 0.7.05: a fifth highlight for Tasks on a phone (#4226)

## Finished looks like
web/whats-new.json (0.7.05) carries a fifth highlight for #4226 (merged 60b98665f after the four were written), true
of the merged code, passing tools/whats-new-check.js 0.7.05, merged before Baron freezes 0.7.05.

## Decided
- Tasks icon, not phone: two phone items already lead, and the icon names the page it changed.
- Wording says what a person feels (no zoom on tap, easy-to-tap buttons), not pixel sizes.
- Weakest premise: "every button and link on the Tasks page is easy to tap" leans on the 44px touch rule covering
  them all; render-tasks-view-3559 measures each (targets, pills, and 0.5px edge taps).
