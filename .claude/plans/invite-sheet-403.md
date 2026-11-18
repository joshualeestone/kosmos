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
Weakest premise: that every refusal the federation step-up routes send carries a remote_step_up* code
(remoteStepUpRefusal does today); a new refusal without one would still show the catch-all. An invite secret
matching the prefix could not leak: fedRemoteSays returns `error`, never `code`, and callers ask it only on failure.

Round 1 (review): the sheet is now tested by running fedInviteMake on a 403, not by a text pin.

Round 2 (review):
- Wider effect, intended: pjFedMessage serves the create screen's mint, verify and join. Join is also a step-up
  route (server.js gated list), so Join now shows the sign-in-again sentence too; verify is not gated, no change.
- Deferred: Remove and Withdraw keep `403 ? fallback`. Neither is a step-up route (the gated list names join,
  invite, own-code, own-allow, own-confirm; "Removing and withdrawing take away"), so no remote refusal reaches
  them today. Would change my mind: either route joining the gated list.

Round 3 (review):
- One test for one fact: fedRemoteSays matches /^remote_step_up/, as the page's four other step-up readers do.
  remote_not_allowed is never sent to a federation route, so it is not matched (the unit test pins that).
- Browser check: render-federation-invite-4649.js gains two arms (a step-up 403 shows its sentence; a 403
  with no code keeps the catch-all). Ran it: 182 PASS, all arms passed; with the sheet fix reverted, the
  8700 arm FAILs with the catch-all.
- render-agentdm-3414.js and render-unread-edge-3743.js match the diff only on the local name `msg`:
  surface overrides in the commit.
