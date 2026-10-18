# diagbtn-6514: Save diagnostics looks like the other buttons

Card: kosmos#6514 (found in the 0.7.57 noise read, Settings > Advanced).

## Finished looks like
On Settings > Advanced, the "Save diagnostics" button sits on one line with no underline, at desktop and phone sizes,
in light and dark, like every other `.btn-quiet` on the page. The Updates "Download" link gets the same look.

## Cause
`#diag-save` and `#upd-download` are `<a class="btn-quiet">` (they download or open a page). `.btn-quiet` was written
for `<button>`: it never removes a link's underline, and inside the `.setrow` flex row the link shrinks and its label
wraps. Only `.acct-help a.btn-quiet` had a reset.

## Change
- web/index.html: `.setrow > a.btn-quiet { text-decoration: none; white-space: nowrap; flex-shrink: 0; }` beside
  `.btn-quiet`, and at 480px and below `.setrow:has(> a.btn-quiet:not([hidden])) { flex-wrap: wrap; }` so on a phone
  the link goes under the row's words instead of squeezing them into a narrow column.
- Scoped to settings rows after review round 1: a global `a.btn-quiet` rule also stopped the Add a provider help
  links (inside `p.acct-help`, one about 46 characters long) from wrapping, so they would run past a phone dialog.
- docs/browser-checks/mobile-shots.js: a `settings-diagnostics` screen that scrolls the row into view.

## Rejected
- A `<button>` with a click handler that fetches the file: more code, and loses the plain download link.
- Scoping the rule to `#diag-save` only: `#upd-download` is the same shape and would stay broken.

## Weakest premise
`white-space: nowrap` on a narrow phone could push the button past the card edge. The phone shots check it.

## Verify
Four shots of settings-diagnostics, looked at; report.md shows 0 overflow. Design review by Mona Lisa.
