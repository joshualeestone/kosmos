# fieldtap-6707: both invite-sheet text fields are 44 px tall on phones

Card: kosmos#6707 (from Mona Lisa's design review of #6681 slice 2). Stacked on boundtext-6708 (#6723), which carries
the email field.

## What changes
- web/index.html: `@media (max-width: 40rem) { #fedinv-label, #fedinv-email { min-height: 44px; } }`, the board's
  breakpoint for phone tap targets.
- docs/browser-checks/render-federation-invite-4649.js: an arm measures both fields at 393 px (at least 44) with a
  CONTROL at 1280 px (they keep their own height, under 44). Mutant: the rule removed, the phone arm red (34 px).

## Decided
- Portrait phones only, as the card asks ("at the iPhone 15 size") and as the board's other width-only tap rules do
  (#restart-wrap, the files button). Review 2 noted a phone held sideways (about 844x390) keeps its unfixed fields
  (34 px as measured here; the card said 36). The
  board's landscape-phone idiom keys on `hover: none`, which this harness cannot emulate, so such a rule would ship
  unmeasured. Left for a card of its own if landscape matters.

## Measured
The fed-invite design shots: taps under 44 went from 16 to 14 on the phone, exactly the two fields.

## Weakest premise
That nothing later sets a height on `.tk-inp` inside the sheet; the arm would catch it.
