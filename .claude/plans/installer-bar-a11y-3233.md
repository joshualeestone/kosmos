# Installer progress bar a11y polish (fast-follow to #3248, kosmos#3233)

## What and why

A small, additive accessibility fast-follow to the determinate installer progress
bar that shipped in PR #3248 (`install/pkg-scripts/installing.html`). Kept as a
SEPARATE PR from #3248 on purpose: adding it to #3248's branch would have staled
that PR's already-converged challenge-loop proof.

Two touches, both on the bar Baron built:

1. **aria-valuenow.** The determinate bar set its inline `width` from the live
   download bytes/total but never exposed the value to assistive tech, so a screen
   reader heard only "Installing" with no progress. Now:
   - static `aria-valuemin="0" aria-valuemax="100"` on the `role="progressbar"` element,
   - `aria-valuenow` set (0-100, rounded) in `apply()` as the bar fills,
   - `aria-valuenow="100"` in `__kpStop()` at settle (when `.settled` renders the bar full),
   - left UNSET while indeterminate (the swoosh, no known total), which is the
     correct ARIA signal for an indeterminate progressbar.

2. **reduced-motion.** The new `.bar.determinate>i` carries a `width .35s` transition.
   The existing `@media (prefers-reduced-motion:reduce)` rule only stopped the swoosh
   `animation`; it now also sets `transition:none`, so a reduced-motion user gets no
   moving width.

## Decision / alternatives rejected

- **Mirror 100 at settle vs. remove aria-valuenow at settle.** `.settled` already
  renders the bar visually full (`width:100%`), so removing `aria-valuenow` (=
  indeterminate) would make AT disagree with the visual. Mirroring 100 matches what
  is on screen. Chosen: mirror 100.
- **No indeterminate-revert in `apply()`'s no-total branch.** A download's
  content-length is stable once known, so the no-total -> total transition is
  one-way in practice; the no-total branch keeps Baron's "leave the swoosh as-is"
  intent rather than adding a revert path that cannot fire.

## Weakest premise

The settle=100 mirror is gated on the bar having gone determinate (`kpDeterminate`), so it
fires on a tracked-download success and NOT on the taken branch (a foreign board answered
first, nothing installed). The deliberate asymmetry that gate leaves, raised in the #3233
review: a NO-content-length success (the download reported no total, so the bar was the
indeterminate swoosh the whole run) ALSO stays ARIA-indeterminate at settle, even though
`.settled` fills it to 100% visually. This matches what the bar showed throughout and the
pre-#3233 behaviour (no aria-valuenow existed before), so it is not a regression, and the
sighted 100% is Baron's existing `.settled` visual either way. Announcing 100 on a genuine
success ONLY (including the no-total case) would require threading a success-vs-taken flag
through `settle()` (called on both the ready and taken branches, so it currently cannot tell
them apart), which is out of scope for this a11y pass and changes the shared `settle()`
contract Baron's tests pin. If that no-total-success AT signal is later wanted, that flag is
the clean fix.

## Verify

- `node --test install.installing-page.test.js` green (19 tests): updated the two
  pinned assertions (markup bounds + reduced-motion rule) and added a new test
  asserting the aria-valuenow wiring (markup bounds + the two `setAttribute` calls).
- No visual change to the bar's appearance (attributes + a reduced-motion CSS guard),
  so no render diff. Real-installer confirmation rides the next .pkg cut with #3248.

Addresses #3233 (a11y half; #3248 shipped the mechanism).
