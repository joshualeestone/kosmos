---
pre_challenge: true
method: challenge-loop
branch: kplusconnect-5787
diff_hash: e420774294f14974e0ca3c2a6b82f1abe507af0fe7635c696335d6e3e9982638
validation: Scoped, stated plainly. Browser, run on the box as queued turns: render-plus-panel-3829 128/128 on the final ribbon placement (the connect block at 1400 and 390, Josh's #4744 sentence one line at 640 and 600, the store link switch); render-plus-signin-3478, render-plus-bought-4756 and render-plus-asks-signin-4610 (each restated for the removed landing) all passed. Unit: the 14 Kosmos+ test files 81/81 including web.plus-connect-5787.test.js, the selector guard and web.plus-route. render-plus-company-5628, render-plus-stars-3778 and render-plus-gate-1615 (named by the surface gate) were queued locally but the box was held for over an hour; GitHub CI's browser-checks job runs them. REBASED onto main (kosmos#5786 changed render-plus-asks-signin-4610; both sides kept), so the browser runs above are on the pre-rebase commits: the 85 Kosmos+ unit tests pass on the rebased head, and all seven Kosmos+ checks are queued to re-run on it. The full node and shell suites were NOT run locally; the merge is gated on all-green GitHub CI.
subdir_audit: passed
timestamp: 2026-10-10T22:47:04Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (one blind review; fixes; two browser rounds that caught the ribbon)
**Converged:** Yes
**Total findings:** 0 BLOCKERs, 4 WARNINGs, 7 NITs from review; 1 defect found twice by the browser check
**Fixed:** 3 WARNINGs, 1 WARNING shown green, 5 NITs; the browser-found ribbon clip. 2 NITs left. | **Asked (awaiting user):** 0

The change (#5787, Josh 2026-10-10 14:07/14:15, "we just combine these pages so you just land here after logging in"): the "You're signed in / Done" landing is gone and every sign-in ends on the connected Kosmos+ pane, whose box is now the connect block (device line art; Josh's #4744 sentence with Copy, still one line; a Scan to connect code for the login.kosmosplus.com address; App Store and Google Play greyed with Coming soon until PLUS_STORE_LINKS names each store page).

### Per-Iteration Breakdown

#### Iteration 1 (blind review)
- [WARNING] focus dropped to the page after an owned-address sign-in (Done used to take it) --> FIXED: focus moves to the Kosmos+ section once the connected pane shows.
- [WARNING] a successful Try again left its button up, a second press re-registering --> FIXED: the register button hides after success (plusSiRegisterMode shows it again on the next sign-in).
- [WARNING] the unit test pinned only the QR's finder corner --> FIXED: the whole path by sha256, regenerated independently; a trailing-slash control hashes differently.
- [WARNING] the one-line rule has 6px less room --> SHOWN GREEN: render-plus-panel-3829 one-line arms pass at 640 and 600.
- [NIT] greyed store text 3.64:1 --> FIXED (#A3ADC6, 4.67:1 on the lightest navy). [NIT] rel noopener only --> FIXED (noopener noreferrer). [NIT] stale comments --> FIXED.
- [NIT] aria-disabled on a span is inert --> LEFT: the visible "Coming soon" carries the state; a span is not a control.
- [NIT] the block appears only once connected --> LEFT: by design, it describes a connected computer.

#### Iteration 2 (browser)
- render-plus-panel-3829 caught the Coming soon ribbon's words past the 60px button's edge (top, then right) --> FIXED by measuring this page's own styles: 32 deg, top 20, right -34 keeps them 3 to 4px inside every edge.

#### CI round (PR #5806)
- [found by CI browser-checks] render-plus-panel-3829: at a 600px window Josh's #4744 sentence wrapped. The review's W4 had named this 6px; it passed locally, so the margin is that thin --> FIXED by giving the block #4744's 6px right padding back: the one-line container measures 596/556px at 640/600, identical to main (compared on both pages).

#### Iteration 3 (re-check)
- render-plus-panel-3829 128/128; unit 23/23 on the final head; surface gate rc 0 with per-check reasons.
