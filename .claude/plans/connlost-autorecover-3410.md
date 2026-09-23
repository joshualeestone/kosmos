# Plan — #3410 runtime auto-recover: CONNECTION_LOST detection + self-heal

Branch: `connlost-autorecover-3410`  ·  Card: joshualeestone/kosmos#3410  ·  Owner: Angel

## Problem
When an agent's Claude Code hits a transient network error (ENOTFOUND / "Can't reach the
API server"), the turn ends with the error on screen and the agent sits wedged. Today the
board classifies it `unknown` ("Can't tell") and the only recovery is the user opening a
terminal (`claude doctor` / manual restart). Josh: "I don't want to have to run Claude
Doctor. I want Kosmos to solve this issue for me." (0.6.88 testing, 2026-09-22.)

The manual Start button (#3433) + engine enablement (#3434 restartInner-starts-dead, #3456)
already shipped. The **runtime auto-recover** half is mine (claimed:angel) and unbuilt.

## Byte-exact signal (from the installed Claude Code 2.1.280 bundle error formatter)
For a `"Connection error."` with a network code, Claude Code renders on the pane:
- `Can't reach the API server — check your internet or DNS (ENOTFOUND|EAI_AGAIN|FailedToOpenSocket)`
- `No internet route — check your connection or VPN (ENETUNREACH|ENETDOWN|EHOSTUNREACH|EHOSTDOWN)`
- `Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED|ConnectionRefused)`
- `Connection dropped (ECONNRESET|EPIPE|...)`
- `Unable to connect to API. Check your internet connection` (code undefined)
- `Request timed out. Check your internet connection and proxy settings` (ETIMEDOUT)
- `Unable to connect to API: SSL certificate ...` (cert class — NOT auto-recoverable; excluded)
(These carry em dashes — Claude's own output; the regex tolerates them, my prose does not use them.)

## PR 1 — detection + surfacing (this PR)
1. `engine/status.js`: add `STATE.CONNECTION_LOST = 'connection_lost'`.
2. Add a `connectionLost(tail)` detector (module-level regex set + fn), mirroring `authFailed`:
   keyed on the byte-exact lines above (the recoverable network subset — EXCLUDES the SSL/cert
   class, which needs a CA fix, not a restart). Carries the matched line as `evidence`.
3. Wire into `classify()`:
   - Precedence: AFTER the live-working checks (SPINNER title, hasLiveInterruptLine) so an agent
     Claude is *actively retrying* stays `working` and is left alone; BEFORE the idle/footer
     fallback so a wedged agent sitting on the error stops reading "Can't tell".
   - After AUTH_FAILED (auth is terminal/more specific and checked early).
4. `web/index.html`: `STATE_COPY.connection_lost = { label: 'Connection lost', attn: true }`
   and `CARD_ST.connection_lost = { st: 'paused', pres: 'on' }` — mirroring `auth_failed`
   (process is up, it just can't reach the API). Graceful-fallback already exists
   (`STATE_COPY[state] || STATE_COPY.unknown`), so no other consumer breaks.
5. Tests: `status.js` classification test — a pane with the ENOTFOUND line → `connection_lost`
   with the line as evidence; CONTROL: a normal working/idle pane and an actively-retrying pane
   (spinner up) are NOT `connection_lost`. Plus a co-occurrence residual note (a card quoting the
   line, same residual as auth_failed).
6. Browser-check / render assertion for the new state if the gate requires one; else full node suite.

## PR 2 — self-heal (follow-on, same session)
Board-tick sweep mirroring `engine/class1-autohandle.js` (pure plan fn + DI executor calling
`remove.restart(name,'restart',{startIfDead:true})`, no send-keys). Gated strictly on
`CONNECTION_LOST`, connectivity-probe-verified before restart, bounded (attempt cap + backoff
window, resets on recovery). Never touches working/idle/needs_you. Follows class1-autohandle's
default-on-vs-gated posture.

## Safety / weakest premise
Claude Code retries network errors internally, so an agent may self-recover mid-retry. Mitigation:
the live-working checks precede CONNECTION_LOST, so an actively-retrying agent classifies `working`
and is never touched — we only act once retries are exhausted and it sits idle with the error.
Verified against the modeled retry chrome; if review shows the chrome differs, it's a one-line
precedence move + a fixture.

## Verify
- `node --test engine/status.test.js` (+ any connlost test file) green, real exit read.
- Full node suite via the repo runner; merge on CI green (local runLauncher tests are flaky).
- Browser-check for the render if gated.
