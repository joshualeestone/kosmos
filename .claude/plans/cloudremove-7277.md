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
