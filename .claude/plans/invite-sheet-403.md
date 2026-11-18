# invite-sheet-403 (kosmos#8700)

Goal: from a remote session, the project page's "Make an invite code" sheet and the create screen's invite door
show the board's remote-session refusal (kosmos#6595 remote_step_up*, remote_not_allowed) instead of the
catch-all "Kosmos could not make a code just now."

Change:
- web/index.html: fedRemoteSays(body) returns body.error for a remote refusal code, else ''.
  pjFedMessage asks it first; fedInviteMake's 403 branch uses it before the fallback.
- web.federation-3312.test.js: pjFedMessage behaviour on step-up / not-allowed / an invite secret in `code`
  (control) / a step-up with no sentence (control); a source pin on the sheet's 403 branch.

Not in scope: the policy-stop 403 (no code field); showing every 403's text would surface the board-token
sentence, which is not for a person. Noted on the card.

Decided: match on the code prefix, not the status, because `code` is the invite secret on success and every
caller reaches pjFedMessage only on a failure; the prefix keeps a real code from ever reading as a refusal.
Weakest premise: that every remote-session refusal the board sends carries a remote_* code. server.js does today
(REMOTE_STEP_UP*, REMOTE_NOT_ALLOWED); a new refusal without one would still show the catch-all. An invite secret
matching the prefix could not leak: fedRemoteSays returns `error`, never `code`, and callers ask it only on failure.

Round 1 (review): the sheet is now tested by running fedInviteMake on a 403, not by a text pin.
