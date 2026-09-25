# #3724: the Kosmos+ navy look pins its meaning colours

## Finished looks like
On the Plus tab (body.plus-active), --pj-mention, --gold-edge, --ok, --danger and --warn-ink are the dark look's values
whatever the Mac's mode. So on a light-mode Mac they read on navy (5.70 to 10.48:1), not the light-mode ones (2.30 to
3.03:1).

## Decided
- Pin to the dark values. Rejected: new navy-specific values. The dark ones already clear AA on navy, and a third
  set is more to keep in step.

## Weakest premise
That nothing on the Plus tab relies on the light-mode ones. Nothing does on purpose: they arrived by inheritance.

## Verification
render-plus-blue-1615: the meaning colours on Plus equal the dark set in light, dark and reduced motion. CONTROL:
off Plus in light mode they are the light set again. Without the fix, the light and reduced-motion arms fail.
