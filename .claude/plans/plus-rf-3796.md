# plus-rf-3796: unblock the 0.6.95 cut from #3808's Kosmos+ wizard

## Why
The 0.6.95 staging re-cut (frozen 0da7100a4) stopped at 3b on render-fields, both engines,
after #3808 (the in-app Kosmos+ sign-in wizard matching login.kosmosplus.com) merged:
- seven wizard fields `recessed in light and raised in dark`;
- `#plus-si-enrol-sms` claims a boundary that does not separate it (border 1.01:1 in light).

## Call (final, after review)
The first version (per Splinter and the owner) exempted the fields as intended always-dark
design and changed the button's border as a real defect. The blind review found the premise
wrong: render-fields unhides the wizard in place and never sets body.plus-active, the class
that gives the wizard its navy card and navy --k-bg in BOTH themes. So both failures were the
check measuring against the bare page ground; on the real navy card the old border is about
2.2:1 (already past the check's 1.1 bar). Final: web/index.html is UNCHANGED; the seven fields
and #plus-si-enrol-sms are skipped by id from the cross-scheme and button-boundary checks, with
a comment giving that reason; render-plus-signin-3478 (which navigates to the tab for real)
covers the wizard on its real ground. Setting plus-active in render-fields would recolour the
whole page and falsify every other field.

## Weakest premise
That render-plus-signin-3478 is a sufficient stand-in on the real ground. It is not complete:
it runs chromium only, and it pins the fields' fill and text colour and that the secondary
button has a solid stroke, but does not measure the fields' border or the button's stroke
against the navy card. So a later restyle that makes either vanish on navy would pass every
check. Recorded as kosmos#3841; the #3796 rework (Pete) is the natural place for it.

## Proof
- Red: render-fields on main 0da7100a4 (Mortals): the 7 flips + the button.
- Green: render-fields on this branch (Mortals): PASS (re-run on the final version).
