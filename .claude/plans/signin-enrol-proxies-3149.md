# signin-enrol-proxies-3149 -- engine proxies for the in-app second-factor enrolment

Kosmos #3149 increment 4 (agent-workforce half). The tunnel CLI enrol verbs
(kosmos-relay PR #60) let the app enrol a second factor in-app when sign-in hits
`enrol_second_factor`; this wires the app engine to them, exactly as increment 3a
wired the signin verbs. It is the engine half; the wizard enrol screens are 3b
(browser-verified, claude-fe).

## What this adds
- **engine/remote.js**
  - `absorbSession`'s `enrol_second_factor` branch now HOLDS the enrol-only token
    (verify's answer carries it) instead of dropping it, so the enrol steps can
    spend it. The token stays engine-side (#874); the page gets only `sms_available`
    and the `why_authenticator` copy the enrol screen renders.
  - `signinEnrol(kind, phone)` -> tunnel `signin enrol` (enrol token piped on stdin,
    off argv). `kind` is totp|sms; phone required for sms. Returns the coordinator's
    start-of-enrolment answer: totp `secret`/`otpauth`, or the masked sms `sent_to`
    (never the full number).
  - `signinConfirmEnrol(code)` -> tunnel `signin confirm-enrol`; on success the
    coordinator issues the person's first session, which `absorbSession` captures
    (swapping the held enrol token for the session token, fail-closed on a malformed
    shape), so the wizard proceeds to the existing `register`.
- **server.js**: `POST /api/remote/signin-enrol` + `POST /api/remote/signin-confirm-enrol`,
  and the `signin-verify` route now relays `sms_available`/`why_authenticator` on the
  enrol stage (it previously relayed only `stage`).

Flow: verify -> (enrol_second_factor) -> enrol -> confirm-enrol -> register. The
enrol steps slot in beside second; register is unchanged.

## Security / #874
- The enrol-only token is held in the engine (`signinSession.enrolToken`), never
  returned to the browser; both enrol and confirm-enrol pipe it to the CLI on stdin.
- No account-creation or admit path: enrol operates on an existing account; the Mac
  still binds via `register` (keypair born locally) and a new device still needs the
  Mac's Allow.
- The full phone number never round-trips app-facing; only the coordinator's masked
  `sent_to` tail travels. The phone rides the tunnel's `--phone` argv (the tunnel's
  established contract), not the HTTP response.

## Depends on / not in this PR
- Depends on kosmos-relay PR #60 (the tunnel enrol verbs) for the real binary; the
  tests use a fake tunnel, so this does not require #60 merged first. It is
  auth-adjacent and goes to Pete for review like #3165/#60.
- The wizard enrol screens (3b, web/index.html) -- frontend, claude-fe.

## Tests
engine/remote.test.js: the fake tunnel learns enrol/confirm-enrol; verify's enrol
answer now carries a token. Cases: the enrol stage surfaces sms_available but not the
token; the full totp enrol -> confirm -> register flow (token off argv, on stdin); the
sms path (number on argv, only the masked tail back); and the refusals (no enrolment
held, bad kind, sms without a phone, a tokenless enrol answer failing closed).
server.test.js: an end-to-end enrol flow through the routes asserting no enrol/session
token crosses the HTTP boundary. Full node suite green.
