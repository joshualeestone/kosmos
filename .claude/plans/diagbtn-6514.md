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
- web/index.html: `a.btn-quiet { text-decoration: none; white-space: nowrap; flex-shrink: 0; }` beside `.btn-quiet`.
  `.acct-help a.btn-quiet` is more specific and keeps its own display and size.
- docs/browser-checks/mobile-shots.js: a `settings-diagnostics` screen that scrolls the row into view.

## Rejected
- A `<button>` with a click handler that fetches the file: more code, and loses the plain download link.
- Scoping the rule to `#diag-save` only: `#upd-download` is the same shape and would stay broken.

## Weakest premise
`white-space: nowrap` on a narrow phone could push the button past the card edge. The phone shots check it.

## Verify
Four shots of settings-diagnostics, looked at; report.md shows 0 overflow. Design review by Mona Lisa.
