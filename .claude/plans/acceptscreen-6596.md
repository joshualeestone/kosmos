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

## Rejected
- Showing a short fingerprint: the person compares against what an administrator tells them, and a shortened key
  invites a match on the part shown. The whole key costs two lines at phone width.
- Accept retrying the sign-in itself: the code is spent; a retry would fail on the code and spend the acceptance.

## Weakest premise
Accept is the primary (blue) button while focus sits on Do not accept. Kept because accepting is the legitimate goal
whenever the person expected the change, and the copy says when not to; this is the open question for design review.

## Proof
docs/browser-checks/render-plus-signin-3478.js, section "key-changed": both choices, the key shown, focus, no other
step or foot link or raw error, Accept sends exactly that key once, Do not accept sends nothing, both start over
with the email kept, the key and buttons inside the card with no sideways scroll at 1400 and 390 px in light and
dark. Whole check: 196 pass, 0 fail (headless chromium).
web.plus-connect-5787.test.js: its control on the step list now allows steps after plus-si-expired.

## Progress
- [x] page, browser check
- [ ] design review (design-shots), challenge-loop, validation, PR
