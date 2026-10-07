# topnotes-5443: the floating notices read as one column on desktop

Card: #5443 (found in the design review of #5359). Two notices showing at once in the #topnotes stack were each as wide as their own text, so their edges did not line up.

Built:
- `.apphead .topnotes` stretches its slots (`align-items: stretch`) instead of centring them. The stack was already `width: max-content` capped at `min(460px, 100%)`, so it is as wide as its widest notice and every slot now takes that width.
- `.utoast .utxt` takes a notice's spare width (`flex: 1 1 auto`), so a narrower notice's close X and buttons stay at its right edge instead of where its words end. A notice sized to its own content is unchanged by this.
- The update chip (`.uchip`, #3955) is a small pill by design and stays one: `#utoast-slot > .uchip` is centred in its stretched slot rather than widened (review 1 found the stretch had moved it to the column's left edge). Call: keep Josh's pill; rejected: stretching it into a wide bar. Would change my mind: Josh asking for the chip to match the cards.
- `.utxt` does NOT get `min-width: 0` (review 1): it keeps its old minimum width, so a long unbroken string (an email) still widens the card instead of running under the X.
- Phone rules (#5018, #5301) untouched; the arm measures the same line-up at 375.

Check (rewritten after review 1, rebased onto #5407, whose login card now has Refresh login): render-login-expiry-3532 gets an arm with the update-abort notice (long, wraps at the cap) and a short login notice in different slots. It asserts, each with a control in the same page that undoes the rule under test: both cards share left and right edges at desktop and at 375 (control: centred, they differ); the login card's Refresh login and X sit at its right edge (control: words not growing, the X moves in); the update chip beside the login card is a one-line pill centred under it (control: uncentred, it sits off-centre). The first version was proven red with the CSS reverted.

Run locally, each on a sandboxed board (the full browser-checks.sh run is CI's), at the iteration-3 head: render-login-expiry-3532 (77 pass), render-reload-toast (64), render-engine-restart-4408 (15), render-phone-taps-5218, render-update-toast, render-snav-head-4979, render-tophead-stable-2624, all green. Earlier in the loop also render-phone-offline-718 (16) and render-offline-note (11), not re-run after the chip change. The surface line declares `topnotes uabort-slot login-adv-slot utoast-slot uchip utxt` (review 3: the CSS comment says this check measures the chip and the words, so a change to either must route here).

Not measured: whether the chip's box change (inline-flex inside a line box to a block flex) moves `--topnotes-h` by a few pixels when the chip shows. render-update-toast (chip clear of the header controls) and render-snav-head-4979 (the nav clears the stack) both still pass, which bounds it but does not measure it.

Controls are derived from the widths the arm reads (review 3), not fitted numbers: the centred reading gives the narrower card's spare width, and the not-growing control expects the X to move in by that.
