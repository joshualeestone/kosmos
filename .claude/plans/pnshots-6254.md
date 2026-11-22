# pnshots-6254: Phone notifications switches, the design read (kosmos#6254)

## Why
kosmos#6254's last open item was a person's visual check of the per-kind switch rows in Settings, Computer, Phone
notifications. Shot with `mobile-shots.js` and read by the design reviewer (Mona Lisa), it found four things to fix.

## What changes
1. Each kind switch (`pn-kind-*`) is filled gold (`btn uprime`) when on and outline (`btn`) when off, painted in
   `paintKinds` from the board's state; the word stays its state; `aria-pressed` unchanged.
2. The master button `#phone-notify-toggle` has `white-space:nowrap` ("Turn off" wrapped at 1280).
3. The master's state line `#phone-notify-msg` and the phone step `#phone-notify-step` sit under the master row,
   above the kinds (they read as belonging to the last row before).
4. A failed kind press (refused or offline) shows its error on an always-rendered, empty-by-default line under that
   row (`pn-kind-err-<kind>`, `role=status`) via `kindErr`, not on the master line five rows up. Any kind or master
   press clears every row; `paintKinds` clears them when the block hides.
5. The master toggle and a kind press do not start while the other is in flight; the return-to-tab reload waits
   for a kind press.
6. `mobile-shots.js`: a `settings-phone-notify-6254` screen (`noServiceWorker`, stubs `/api/phone-notify`).

## Decided, and rejected
- Lines always rendered, never `hidden` while written: a live region written while hidden is not reliably announced.
- `className` assigned, not `classList.toggle`: the page script runs in the test's fake DOM, which has no
  `classList`; assignment is exact on a real page too, and nothing else adds classes to these buttons.
- Not taken: disabling the master while a kind press is in flight (a design change, not asked); `aria-labelledby`
  for each kind button (older than this branch; a follow-up).

## Measured
- `web.phone-notify-718.test.js` 27 of 27; every `web*.test.js` on the branch passes (464 files).
- Mutations, each red: the className paint (2), each clear (press start, block hide, master press), each busy guard,
  the reload guard, the offline route back to the master line.
- `render-push-718.js` through `tools/browser-checks.sh`: PASS, 11 of 11 #6254 checks.
- Design shots `~/work/design-shots/kosmos-6254/`, desktop and iPhone 15, light and dark: 0 overflow, 0 errors;
  Mona Lisa's OK on the three fixes and on the per-row error placement.

## Weakest premise
The fake DOM in the unit test is not a browser: the row error's announcement by a screen reader is reasoned from the
live-region rule, not heard.
