# foundagents-banner, clean up the found-agents banner controls

## What Josh asked (#chaoskosmos-design, 2026-09-10)

The found-agents banner ("We found agents on this computer we have not seen
before") has everything underlined and it "looks freaking terrible." Specifically:

- Kill every underline: the descriptive line, "Show them", "Dismiss this forever",
  and "Show removed agents".
- "We found agents..." becomes plain quiet text.
- "Show them" becomes a real button (the primary action).
- "Dismiss this forever" moves to the far right as a circle-X, so it reads as the
  quiet opt-out, not a peer link.
- "Show removed agents (N)" becomes a plain control, no underline.

Preview shared and this is the agreed direction (my recommendation; Josh can
adjust the stacked-vs-one-line layout).

## Done-condition

The found-agents banner and the disk-scan banner render with: plain descriptive
text, a "Show them" button, a far-right circle-X dismiss that keeps the existing
two-click "forever" confirm, and no underlines anywhere; the "Show removed agents"
toggle is a plain control; the shared `.linkish` class (24+ other uses) is
untouched; the full suite stays green with the found-* tests updated.

## The constraint: .linkish is shared

`.linkish` (underlined link-button) is used in ~28 places across the app. This
change must NOT alter `.linkish` globally. The found-agents controls get their
own classes instead, and `.linkish` is dropped only from these specific controls.

## The surfaces (two instances, same shape)

- `#found-wrap` (found-toggle / found-dismiss): agents Claude has a record of.
- `#scan-wrap` (scan-toggle / scan-dismiss): the #1938 disk-scan panel.
- The "Show removed agents (N)" toggle (separate control).

Each banner's `.found-head` is currently a flex row of a composite `.linkish`
toggle (descriptive text + "Show/Hide them") and a `.linkish found-dismiss`
"Dismiss this forever". The toggle text is set by JS (two builders, ~25795 the
found variant and ~25920 the scan variant).

## Changes (web/index.html)

1. Markup: split each banner's composite toggle into a plain `<span>` (description)
   plus a real `<button>` ("Show them"), and turn the dismiss into an icon
   `<button>` (circle-X SVG) sitting on the far right of `.found-head`.
2. JS: the two toggle builders set the description span and the "Show/Hide them"
   button separately; the dismiss two-click confirm handler is preserved, re-aimed
   at the icon button (armed state shown on the icon).
3. The "Show removed agents" toggle: new plain-control class, no underline.
4. CSS: new classes for the description text, the "Show them" button (the app's
   `.btn` idiom), the circle-X, and the plain removed-toggle; `.linkish` untouched.
5. Tests: update web.found-board / web.found-scale / web.found-undo /
   web.found-every-path-1493 / web.import-found-1652 / web.ask-first-1683 for the
   new structure and text split.

## What I rejected / weakest premise

- Rejected editing `.linkish` globally: it is shared by 24+ unrelated controls.
- Weakest premise: that the two toggle builders (25795 / 25920) are the only
  writers of the toggle text. Verify before splitting; a third writer would leave
  a stale composite string.

## Not this change

The banner's behaviour (what it lists, the dismiss-forever persistence, the
add/skip rows) is unchanged. This is presentation only.
