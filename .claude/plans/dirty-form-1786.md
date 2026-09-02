# dirty-form-1786: a dirty create-agent form persisted across role re-picks

kosmos#1786. In Create-an-agent, a dirty form (typed instructions/role, OR an imported agent's
pre-filled fields) persisted across a role re-pick: picking a different role should show the new
role's template, but hand-entered values stayed.

## Mechanism (traced in the code, not guessed)
- Step two of the create flow (`cstep('name')`) is reached ONLY through the `role-next` (Continue)
  handler, which computes `roleChanged = FILLED_ROLE !== PICKED` and calls `refillDetails(roleChanged)`.
  There is no other path into step two, so `refillDetails` is the single choke-point for a reset.
- `refillDetails(resetDirty=true)` (a role change) reset only the two dirty-guarded fields: it
  cleared `INSTR_DIRTY`/`LABEL_DIRTY` and refilled `create-label`/`create-instr` from the template.
- `create-name`, `AVATAR_FILE` (+ its input and hint) and `CREATE_PROJECTS` were reset in
  `openCreate` and NOWHERE ELSE, so a role re-pick left them carrying the previous role's entries
  while label/instructions refilled -- a HALF-reset form. That is the whole-form scope the card
  warns about (a fix limited to the measured fields would look complete and leave the rest).

## The fix
Extend `refillDetails`'s `resetDirty` branch (the role-change branch) to reset the whole form:
`create-name` -> '', `AVATAR_FILE` -> null (+ clear `create-avatar` input and `genav-hint`),
`CREATE_PROJECTS` -> []. model/account/reports are already reset on a role change by role-next's
`loadCreateExtras()`; the mark is redrawn by role-next's `drawCreateMark()` after refillDetails
returns. The name is cleared BEFORE `instrTemplate()` so the refilled template's `{{NAME}}` reads
the default rather than the previous role's typed name.

## Import is safe (verified)
Import sets `FILLED_ROLE = PICKED = 'own'`, so a later Continue sees `roleChanged = false` and calls
`refillDetails(false)`, which does NOT enter the reset branch -- the imported words are preserved.
The whole-form reset fires only on a genuine role CHANGE.

## The decision the card asked for
"Should re-picking a DIFFERENT role discard entered values, or keep them? Decide per field, uniform
across the whole form." Decided: a different role resets the WHOLE form to that role's template,
uniformly (name, label, instructions, avatar, projects, model/account/reports). This matches the
repro's user expectation, the `role-next` comment's stated intent ("a different role is a different
template and resets the form on purpose"), and the card's whole-form requirement.
- Weakest premise: clearing a typed NAME on a role change. A name is the person's, not the role's,
  so one could argue it should persist. I chose uniform reset because the repro explicitly cites the
  persisted name as the bug and the comment says a different role resets the form.
- What would change my mind: Josh preferring the name (and only the name) to survive a role change.
  That is a one-line carve-out (leave `create-name` out of the reset branch) and reversible.

## Verification (no browser -- the fleet cannot run one, #1769)
`web.create-role-reset-1786.test.js` runs the SHIPPED `refillDetails` against a fake document:
resetDirty=true resets name/avatar/projects/label/instr; resetDirty=false preserves them (the
same-role return). Proven to go red when the reset branch is removed (perturbation). The behaviour
is reachable only via role-next -> refillDetails, so this choke-point test covers the whole class.

## Not in scope
The a11y/other create-flow concerns; the exact browser repro path (unreachable on this fleet, but
moot: the fix is at the sole choke-point every role change flows through).
