# need-help-3881: the guide's nudge reads "Need help?"

Card: kosmos#3881 (Josh). Owner: me (the setup guide, #3034). Routed by Splinter 2026-09-25 22:10, ahead of #3860/#3823.

## Change
- web/index.html (the assistant layer, `#asb-nudge-go`): "Want help setting up Kosmos?" becomes "Need help?".
- No test or browser check asserted the old text (searched the whole repo, case-insensitive, for the phrase and its
  parts; the two browser checks that touch the nudge only test that it is visible).
- docs/browser-checks/render-assistant-bubble-3034.js now asserts the nudge says exactly "Need help?" (B2).

## Verification
- render-assistant-bubble-3034: all 83 checks pass (82 before plus the new one). With the old text put back, the new
  check fails ("Want help setting up Kosmos?"), so it can fail.
