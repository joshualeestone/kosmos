# plus-rf-3796: unblock the 0.6.95 cut from #3808's Kosmos+ wizard

## Why
The 0.6.95 staging re-cut (frozen 0da7100a4) stopped at 3b on render-fields, both engines,
after #3808 (the in-app Kosmos+ sign-in wizard matching login.kosmosplus.com) merged:
- seven wizard fields `recessed in light and raised in dark`;
- `#plus-si-enrol-sms` claims a boundary that does not separate it (border 1.01:1 in light).

## Call (Splinter 17:15, owner ICK busy on #3837)
- The always-dark fields are INTENDED (#3796: Josh wants the Kosmos+ look in both themes):
  exempt them by name from the cross-scheme check, like #pj-say and #pj-thread-who, no wider.
- The button outline is a real defect: the wizard's secondary-button border becomes a mid
  blue-grey (the Kosmos+ pill's colour family) that separates on light and navy grounds.
Minimal on purpose: #3796's rework (Pete) revisits both.

## Weakest premise
That the flip is exactly the intended design and nothing else: the exemption is per id, so a
new wizard field is still checked, and the other assertions (same fill, boundaries) still run
on these seven.

## Proof
- Red: render-fields on main 0da7100a4 (Mortals): the 7 flips + the button.
- Green: render-fields on this branch (Mortals): 0 flips, PASS. render-plus-signin-3478 (the
  surface-map owner of the changed CSS lines): PASS on this branch.
