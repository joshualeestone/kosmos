# #7046: iPhone slice 5c, set up a required second step natively (authenticator app)

Split from #7045 (Splinter 08:23). No new Apple capability needed.

## Measured (kosmos-relay origin/main)
verify answers `{enrol:true, token, sms_available}` when the account must have a second step and has none; the token is
enrol-only. `POST /v1/second/enrol {kind:"totp"}` with it as Bearer gives `{kind, otpauth, secret}`;
`POST /v1/second/confirm {code}` with it gives the first real session (second.rs confirm, issue_session_proven_at).

## Finished looks like
The enrol answer leads to a native "Set up a second step" screen; "Set up an authenticator app" enrols and shows
"Add to my authenticator app" (opens the otpauth link), the key in groups of four with Copy, and a code field. The
confirm's session goes through #7042's own steps (handed over, the Mac's Allow). A wrong code stays on the screen.
Text-message setup goes to the web sign-in page. Logic tests; shots light, dark, largest.

## Rejected
- Native text-message setup now: the country and number entry (the page's cleanPhone) is its own piece of work.
- A QR code: on the phone that holds the authenticator, the link is what works; the key covers an app on another device.

## Weakest premise
That an authenticator app on the phone handles the otpauth link. If none is installed the button does nothing, and the
key is there to type.
