---
pre_challenge: true
method: challenge-loop
branch: no-settings-tip-3574
diff_hash: 53b4419b4929698fdf2a15d4ea197ee5c17d7a11d380b159b0786e8e60248f01
validation: passed
subdir_audit: passed
timestamp: 2026-09-25T14:06:20Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 had nothing at WARNING or above; both NITs taken)

#### Iteration 1 (opus)
- [WARNING] T14, moved to New agent, could no longer catch a card that fails to follow the scroll: its side placement measures only the horizontal gap, and a heading scrolled off screen goes flat and passes. Fixed: T14 asserts the card moved by the scroll and keeps the heading on screen. Control: without the scroll relayout listener, T14 fails.
- [WARNING] On Settings, keyboard focus did not enter the ? menu, because the first item is now hidden. Fixed: focus goes to the first shown item; T19 asserts it.
- [NIT] T19 does not open Settings in the consolidated column. Noted: tipVisible holds there too.
- [NIT] Menu item state painted only on open. Taken as is.

#### Iteration 2 (sonnet)
No BLOCKER or WARNING.
- [NIT] T19's comment still called "this screen" the Settings tip. Fixed.
- [NIT] T31's comment still described the removed Settings > Updates case. Fixed.

## Validation
Full suite clean (6j, 2026-09-25T14:04:28Z, hash 53b4419b4929698fdf2a15d4ea197ee5c17d7a11d380b159b0786e8e60248f01). The suite found engine/tips.js still allowing 'settings'; dropped (4bbad4833). render-help-tips-3574 passes.
