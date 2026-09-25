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

## Review record
- Round 1: WARNING, pinning --danger would have failed the white sign-in fields' error border. Fixed with a carve-out
  (as #firstrun has) and an arm that reads the painted border.
- Round 2: nothing introduced. Two WARNINGs of the same class, already broken before this branch, taken in:
  - the update toast's --utone on navy is restated per severity;
  - #firstrun pins --ok too.
  NITs taken: the carve-out skips selects, the check reads the painted border and the toast tone, and the success
  line says more.
- Round 3: no BLOCKER. Its WARNING (drop :not(select), since a select would sit on white) is declined. body.plus-active
  DOES set --k-surface to #1c2c4f, so a select in the pane sits on navy, where coral is right. NIT taken: a comment on
  the dark-mode coupling of the toast rules. NIT left: no arm for #firstrun --ok, which changes no pixel (its only
  consumer already fell back to #1f7a4d).
