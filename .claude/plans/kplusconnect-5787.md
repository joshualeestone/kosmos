# kplusconnect-5787: Kosmos+ connect block; sign-in lands on the connected pane (#5787)

**Finished means:** after any Kosmos+ sign-in the person lands on the connected pane (no "You're signed in / Done" card), and its top box is the connect block: device line art, Josh's #4744 sentence with Copy on one line, a Scan to connect code for the login.kosmosplus.com address, and App Store / Google Play greyed with "Coming soon" until PLUS_STORE_LINKS names each store page.

## Steps
- [x] Remove the landing (#plus-si-done, PLUS_SI_LANDED, its Done, its heading); an owned address ends like a typed one.
- [x] Connect block in #plus-chip (navy pane only); the one-line rule moved to .plus-chip-line; QR drawn inline (qrcode, v3 M, no margin), pinned by hash.
- [x] PLUS_STORE_LINKS + plusStoresPaint (https only, noopener noreferrer).
- [x] Checks restated: render-plus-signin-3478, render-plus-bought-4756, render-plus-asks-signin-4610; render-plus-panel-3829 measures the block; web.plus-connect-5787.test.js guards the removal.
- [x] Blind review: 0 blockers, 4 warnings (3 fixed, 1 shown green), nits fixed.
- [x] Browser: the three restated checks pass; render-plus-panel-3829 128/128 on the final ribbon.
- [x] mobile-shots plus-connected screen for design review.
- [ ] PR, CI, merge.

## Decided
- Josh's 09-30 sentence kept word for word; my mock's heading dropped (his copy is verbatim).
- QR beside the stores, under the sentence, so the sentence keeps its one line at 544px.
- The QR is drawn, not generated at runtime: the address is fixed; a runtime encoder becomes worth it only when each store gets its own code.
- Ribbon placed by measuring the real page (32 deg, top 20, right -34: 3 to 4px inside every edge).

## Surface gate (#2518)
- render-plus-company-5628, render-plus-stars-3778, render-plus-gate-1615 share tokens with this diff (the step list line, #s-sec-plus CSS, a read of #plus-flow). Per-check trailers give the reason; GitHub CI runs all three, and they were also queued locally.
