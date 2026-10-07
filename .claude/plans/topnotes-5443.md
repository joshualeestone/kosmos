# topnotes-5443: the floating notices read as one column on desktop

Card: #5443 (found in the design review of #5359). Two notices showing at once in the #topnotes stack were each as wide as their own text, so their edges did not line up.

Built:
- `.apphead .topnotes` stretches its slots (`align-items: stretch`) instead of centring them. The stack was already `width: max-content` capped at `min(460px, 100%)`, so it is as wide as its widest notice and every slot now takes that width.
- `.utoast .utxt` takes a notice's spare width (`flex: 1 1 auto; min-width: 0`), so a narrower notice's close X and buttons stay at its right edge instead of where its words end. A notice sized to its own content is unchanged by this.
- Phone rules (#5018, #5301) untouched: at phone widths the stack is capped at the header's width, and the same one-column rule applies.

Check: render-login-expiry-3532 gets an arm with the update-abort notice (long, wraps at the cap) and a short login notice in different slots. It asserts both share left and right edges, and that the login notice's X sits at its right edge; CONTROL in the same page: centred, the same two are different widths. Proven red with the CSS reverted. The check now declares `topnotes uabort-slot login-adv-slot` as its surface.

Run locally on a sandboxed board: render-login-expiry-3532 (70 pass), render-snav-head-4979 (131), render-phone-offline-718 (16), render-update-toast, render-tophead-stable-2624, render-offline-note (11). All green.
