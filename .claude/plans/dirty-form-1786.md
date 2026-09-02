# dirty-form-1786: a dirty create-agent form persisted across role re-picks

kosmos#1786. In Create-an-agent, a dirty form (typed instructions/role, OR an imported agent's
pre-filled fields) persisted across a role re-pick: picking a different role should show the new
role's template, but hand-entered values stayed.

## Mechanism (traced in the code, not guessed)
- Step two of the create flow (`cstep('name')`) has TWO entries: the `role-next` (Continue) handler,
  which computes `roleChanged = FILLED_ROLE !== PICKED` and calls `refillDetails(roleChanged)`; and
  the import handler, which reaches `cstep('name')` directly and manages its own state (it sets
  `FILLED_ROLE = PICKED = 'own'` and lays the imported fields on top). So `refillDetails` is the
  single RESET choke-point (only the role-next entry resets), not the single ENTRY. Import never
  resets, which is correct.
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

## Provider: deliberately out of scope, and why (matches openCreate)
`create-provider` is NOT reset on a role change here, because `openCreate` does not reset it either
(verified). This branch matches `openCreate`'s reset set exactly (name/label/instructions/avatar/
projects/dirty), so open and role-change stay consistent. Resetting the provider ONLY on a role
change would make the two paths inconsistent; resetting it everywhere (openCreate too) plus undoing
its change-handler side effects (the model picker's disabled state, the OpenAI account menu) is a
separate, broader decision. A reviewer noted a real latent mismatch (provider OpenAI while the
rebuilt model menu lists Claude models) but it is pre-existing, not introduced here, and bounded by
the reachability caveat below. Carding it as a follow-up rather than making this fix inconsistent.

## Reachability caveat (honest, unverifiable on this fleet)
A blind review could not find a user-facing path in the CURRENT build from step two back to step one
to re-pick a different role: `cstep` only toggles panel visibility (headers are not clickable),
`#create-back` leaves the create flow entirely, and the only in-flow `cstep('role')` is create-go's
bail-out, which fires only when `!role` (unreachable once a role is picked). The card was reproduced
by Shredder in a browser during the #1652/#1785 verify, so a path existed for him; I cannot confirm
it statically, and the fleet cannot run a browser check (#1769). The fix is therefore DEFENSIVE:
correct where it fires, harmless where it does not, and complete for whenever the re-pick path is
reachable (e.g. if a Back button is restored, which the code comments anticipate). This is stated
rather than hidden so the filer can confirm the exact repro path.

## Not in scope
The a11y/other create-flow concerns; the provider reset (follow-up above); the exact browser repro
path (unverifiable on this fleet, but moot for the reset: it is at the sole reset choke-point every
role change flows through).
