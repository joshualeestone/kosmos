# acceptscreen-6596: #6596 step 8, slice 2, the screen

Card: joshualeestone/kosmos#6596 (security hardening O04-1, detail private). Stacked on acceptkey-6596 (the engine
and route), which is stacked on orgkeys-6596. Lands after both.

## The call
- The page carries `keyChanged.offered` from a refused registration (plusSiPostRaw kept only the error text).
- A refused sign-in that names a key shows one panel, `plus-si-keychanged`, in place of every other step: one line
  saying Kosmos+ answered with a different security key so this computer did not sign in; one line saying to accept
  it only if whoever runs the Kosmos+ service said the key was changing; the key itself, whole, in monospace,
  wrapping anywhere; two buttons, "Accept the new key" and "Do not accept". No foot link (plusSiWayOut '').
- Accept posts the key to /api/remote/accept-key and starts over on the email step with the email kept, saying the
  key is accepted for the next sign-in in the next hour and to send a new code. Do not accept starts over and says
  nothing was changed. Both start over because the code the refused sign-in used is spent.
- Focus lands on Do not accept, the choice that changes nothing.
- Both registration flows on the page show it: the email sign-in (owned address or typed name) and the company finish.

## Design review (Mona Lisa, card comment, approved with changes) and review 1 (fixed)
- Do not accept is the blue primary and holds the focus, so Enter and the blue button are the same press; Accept is
  the quiet secondary. (This was my weakest premise; she ruled the other way, with the reason that the screen only
  appears when something unexpected happened.)
- Title for the decision. She suggested "Kosmos+ has a new security key"; review 1 pointed out that states as fact
  what the panel asks the person to doubt (the key may not be Kosmos+'s). Used: "Kosmos+ offered a different security
  key". Told her, with the reason.
- Both paragraphs one size; a line saying what declining does ("If you do not accept, nothing changes: this computer
  keeps the key it trusts and stays signed out of Kosmos+"); full-width, equal, 44px+ buttons on a phone; the key in
  a subtle inset.
- Review 1: my edit left a stray closing div (the wizard's foot link fell outside the card; 11 layout reds in the
  sibling scenarios). Removed; divs balance 37/37.
- Review 1: Do not accept stayed live while Accept was out, so it could say "nothing was changed" after the board had
  taken the key. Both buttons are now locked until the answer.
- Review 1: after a company finish, Accept said to send a new code; it now says to sign in with the company again.
- Review 1: screen readers heard only "Do not accept, button". Each button is described by the explanation (and the
  key, for Accept); the never-changing live region is gone.
- Arms ($S/as-arms.py, the page mutated in place and restored): M1 Do not accept live during Accept, M2 the company
  flag dropped, M3 the primary moved off Do not accept, M4 the sign-in title kept: each red on its own check.

## Review 2: no real bug; design approved at bbe0d76ae1 (Mona Lisa)
- Mona Lisa kept the neutral title and gave the first sentence: "This computer does not recognise it, so it did not
  sign in." (the page's own copy spells it "recognise"); no reshoot needed for it.
- Taken from review 2's low notes: the decline message said the computer trusts "its own key" (it trusts the Kosmos+
  key it had); a refused Accept now puts the focus back on Do not accept (the pressed button was disabled under it);
  the check's refused arm fails with a message, not a TypeError, if the Accept never reaches the route.
- Kept: the typed-name register is not driven by the check (the owned-address and company paths are; all three share
  plusSiPost's epoch check and the same one-line call); the offered key stays in a hidden panel after Start over (the
  next refusal overwrites it and the engine accepts only the last offer); the inset colours are fixed values on the
  always-navy card, as the sibling rules are.
- Checks after: sign-in 206 pass 0 fail, company 22 pass 0 fail; divs 37/37.

## After the rebase onto main (acceptkey-6596 merged as #7058)
- Rebased; this branch's six files only. Checks on the new base: sign-in 206/0, company 22/0, both gates green.
- The #6022 teardown guard (browser-checks-teardown-guard-6022.test.js) went red on the key-changed section's route
  handlers: the held refusal answered outside a try, so a late answer after the page closed could crash the check.
  I had last run the guard tests before review 1 added that arm. Both handlers now answer inside a try, the held one
  catching its own late rejection; guards 154/0, sign-in check 206/0.

## CI on the PR (#7063): render-fields
- CI's browser-checks job (render-fields, which I had not run locally) failed on plus-si-keychanged-accept in the
  light scheme: fill 1:1, border 1.01:1. That button became the transparent secondary in the design review's swap, and
  render-fields measures the wizard's buttons off their real navy ground, which is why it already skips the wizard's
  other secondary buttons by name (PLUS_WIZARD_BUTTONS). Added it there, with what covers it on its real ground
  (render-plus-signin-3478's WIZ_SEP measures every secondary button's face and stroke against the navy card).
- Run locally against a sandboxed board: the failure reproduces with the entry removed (control) and is gone with it.

## Rejected
- Showing a short fingerprint: the person compares against what an administrator tells them, and a shortened key
  invites a match on the part shown. The whole key costs two lines at phone width.
- Accept retrying the sign-in itself: the code is spent; a retry would fail on the code and spend the acceptance.

## Weakest premise
Settled by design review: the safe answer is primary. What remains: a person can judge a key they are shown. The copy
says to accept only an announced change; nothing on this screen can do better than that.

## Proof
docs/browser-checks/render-plus-signin-3478.js, section "key-changed": both choices, the key shown, focus, no other
step or foot link or raw error, Accept sends exactly that key once, Do not accept sends nothing, both start over
with the email kept, the key and buttons inside the card with no sideways scroll at 1400 and 390 px in light and
dark. After review 1: sign-in check 205 pass 0 fail; company check 22 pass 0 fail (a company finish refused for a
changed key, and Accept's company wording).
web.plus-connect-5787.test.js: its control on the step list now allows steps after plus-si-expired.

## Progress
- [x] page, browser check
- [x] design review (approved at bbe0d76ae1), challenge-loop (2 rounds, the last with no real bug)
- [ ] validation, PR (after acceptkey-6596 merges)
