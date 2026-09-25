# wiz-contrast-3841: the in-app Kosmos+ wizard's separation, measured on its real navy card (kosmos#3841)

render-fields cannot measure the wizard where it sits (the navy card is scoped to body.plus-active and paints a
gradient its ground() cannot read), so the 0.6.95 unblock (plus-rf-3796) exempted the wizard there. This adds
the missing measurement to render-plus-signin-3478, which navigates to the real tab, in both themes:
- every wizard field's border (7), the secondary button's stroke, and every primary button's fill and edge
  (the card's 7, plus Start over and Done from #3796 addenda 4 and 9), each composited over BOTH card
  gradient stops (#1b2c50, #0f1d38), at least 1.1:1 (render-fields' bar).
Docs-check only; no page change.
