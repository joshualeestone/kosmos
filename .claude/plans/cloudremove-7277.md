# cloudremove-7277: a Kosmos cloud machine offers no Remove this computer (kosmos#7277, #4903 S5 follow-up)

## Finished looks like
On a Kosmos cloud machine, Settings > Kosmos+ offers no "Remove this computer" and says why, beside View account; the
server refuses POST /api/remote/forget there too. A computer that is not a cloud machine offers Remove as today.

## Decided (option (a) on the card)
- No Remove on a cloud machine: Kosmos+ is the only way in, so removing it leaves no way back. Leaving is cancelling
  from the account (S6 tears the box down). Rejected (b), a warning: a destructive button whose only outcome is a
  lockout should not be offered. Rejected (c), Remove meaning cancel and delete: that is S6's flow and lives in the
  account, where billing is.
- The server refuses as well as the page hiding it, so a stale page or a script cannot do it. The cloud answer is
  otherwise words-only; this is the one action it stops, because a wrong "no" locks a person out for good while a
  wrong "yes" only hides Remove on a Linux box carrying the installer's latch.
- Weakest premise (the card's): that nobody needs to re-register a cloud box by hand (support moving it between
  accounts). That would be a support tool, not this button.

## Built
web/index.html: #plus-forget-cloud line, painted from onCloudMachine() each repaint. server.js: the forget route's
409 with cloud:true. Tests: server.remote-forget-6389 (refusal never reaches the engine, even with anyway; control),
render-plus-panel-3829 (no Remove, the line, View account, through a repaint, the real route refuses; every other
pane in the check is the control).

## Review
- Round 1 (cloudremove-7277-review1.md): 0 blockers, 1 warning, 3 nits. Fixed: the Kosmos+ switch is the same lockout
  (off stops the only way in): not offered while on, on a cloud machine, and PUT /api/remote refuses on:false there
  (browser check through the real route, server test with a control); the cloud branch also hides the not-removed-yet
  box; the Mac panes assert the cloud sentence stays hidden. OPEN, not a defect today: "cancel it from your account"
  and the name "Kosmos cloud machine" are to confirm with the account side (S1/S6) before switch-on (on the card).
- Round 2 (cloudremove-7277-review2.md): 0 blockers, 2 warnings, 1 nit. Fixed: the cloud block runs after the kept
  note, so nothing re-shows a box the server refuses. Filed as #7285 for the Kosmos Cloud lead, outside this change:
  removing your own browser in Devices (a lockout only if kosmos-tunnel's hosted gate does not let the owner back in;
  the tunnel is not in this repo) and an unreadable remote.json stopping the tunnel (older than this branch, no person
  triggers it).
