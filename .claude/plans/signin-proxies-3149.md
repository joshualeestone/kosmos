# signin-proxies-3149 — engine + server proxies for the in-app sign-in wizard

Kosmos #3149 increment 3a (the backend half). The app-side wizard UI (web/index.html)
is increment 3b and lands in its own claude-fe PR (it must be browser-verified); this
PR is the backend it drives, node-testable and shippable on its own — matching the
"each its own gated PR" split recorded on #3149.

## What this adds
`kosmos-tunnel signin {start,verify,second,register}` (merged in kosmos-relay PR #59)
gets its app-side proxies, so the in-app wizard can run journey 2 ("sign in THIS
computer to an existing account") natively instead of jumping to the web.

- **engine/remote.js**
  - `signinStart(email, deviceName)` → `signin start` → `{stage: 'code_sent'}`.
  - `signinVerify(email, code, deviceName)` → `signin verify` → stage `session` |
    `second` | `enrol_second_factor`.
  - `signinSecond(code)` → `signin second` (challenge held here) → stage `session`.
  - `signinRegister(name)` → `signin register` (token piped on stdin) → stage
    `registered` with `{address, name, standing}`; brings the tunnel up like
    `setupComplete`; #1010/#1003 same-name short-circuit so a re-sign-in never
    re-mints an identity or spends a certificate.
  - `signinDeviceId()` — a stable opaque device id, minted once and kept in
    remote.json (round-tripped via a new `device_id` field in `read()`).
  - `setupRun(args, stdin)` gains an optional stdin arg (backward compatible;
    null = the old 'ignore' behavior) so `register` can pipe the token off argv.
- **server.js** — `POST /api/remote/signin-{start,verify,second,register}`, mirroring
  the existing setup routes; each relays only the engine's `stage` (plus, for
  register, the public `address`/`name`/`standing`).

## The auth-safety decision (my #874 lane)
The coordinator's 30-day session token and the phone-code challenge are held in the
**engine** (`signinSession`, in-memory), never returned to the browser. The wizard
drives stages and holds no credential; `register` spends the token from the engine,
piped to the CLI on stdin (off argv, mirroring the CLI's own contract). This is
strictly better than round-tripping the token through the page.

- **Rejected:** returning the token to the wizard and taking it back on register
  (simpler, stateless engine) — puts a month-long bearer credential in page JS.
- **Weakest premise:** a single in-memory sign-in slot assumes one sign-in at a time
  on one board. True for the product (one person, one board); two tabs racing would
  make one tab's flow error and restart, which is safe. Memory-only means a board
  restart mid-flow drops it and the person restarts sign-in — also safe and quick.
- **What would change my mind:** if concurrent per-board sign-ins ever become real,
  key `signinSession` by a per-flow id instead of a single slot.

## Not in this PR (increment 3b, claude-fe)
The wizard UI in web/index.html and the "Join Kosmos" no-account nudge — frontend,
browser-verified. Second-factor *enrolment* verbs are deferred; `verify` surfaces
`enrol_second_factor` honestly so 3b can route it.

## Tests
engine/remote.test.js — the fake tunnel learns the four signin verbs (register reads
the token from stdin and records it so a test asserts it never appears in argv). New
cases cover: stable device id, the token/challenge never leaving the engine, all three
verify stages, second requiring a held challenge, the full phone-path register (token
on stdin, tunnel up), the session-only path, a failed register keeping the session for
a retry, and the #1010 same-name recognition. Full node suite green (7747 tests, 0
fail); `bash tools/run-tests.sh` is the shipped gate.
