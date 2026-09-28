# goldrevert-4059: take the gold reactive buttons out of the app (Josh, 2026-09-28 14:46)

Josh, #admin 14:46: "I dont want any of these gold reactive buttons in the app yet."

## Done looks like
- The app side of #4059 (PR #4311, 5d6f95d24) is reverted: no solid gold pills, no pointer-following
  light (the gold-light script, the gold layer, rehost(), their CSS variables), and primary buttons
  are back to the style they had before #4311.
- render-gold-buttons-4059.js, its README row and gated.txt entry are gone; web.gold-edge-1044.test.js
  is back to its pre-#4311 form.
- Kept: #4311's render-dm-reply-4256.js flake fix (unrelated to the buttons) with its README sentence,
  and the #4059 plan files.
- The work is kept for later on goldbtn-4059-later (5d6f95d24).
- (Still to happen when written) merged before the 0.7.07 freeze, and Baron told the sha.

## Checked
- No code left on main references the gold-light code or the variables #4311 introduced; the two
  variables #4311's lines also re-stated (--ok, --radius-control) were defined before it and still are.
- The website is out of scope (Splinter).
