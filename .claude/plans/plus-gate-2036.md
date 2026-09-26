# plus-gate-2036: the first Kosmos+ sign-in gate on the Mac promote (kosmos#2036, #1591)

Splinter handed #2036 and #1591 over on 2026-09-26 (both labelled needs-decision; the decision is mine). The decisions and their reasoning are on the two cards (05:35 CDT comments).

## The gap
kosmos#3827's parseSaid bug broke the FIRST in-app Kosmos+ sign-in (the first registration). Every check passed, because every checker's Mac was already signed in. The shipped Mac promote gates (#2063, a fresh browser; #2150, a fresh agent spawn) never touch Kosmos+.

## Built
- **tools/lib/plus-signin-record.js**: the record spec, defined once for the writer and the gate. Records live at `plus-signin-<sha256>.json`, one per artifact, in `$KOSMOS_PLUS_VERIFY_DIR` or `~/.local/state/kosmos/release-verify`, beside the Windows records. The steps are: fresh, start, code, verify, second, register, enrolled, up, forget. The code email's placement is INBOX, SPAM, OTHER, or NONE when no email was sent (#1591). The record also keeps the driven board's identity. The result is `pass` only when every step passed. The same file holds the gate's CLI.
- **tools/plus-signin-verified.sh**: the gate. It reads the version and sha from the pointer and exits 0 (pass), 1 (fail or ambiguous: refused, never forceable) or 2 (no record: HOLD, forceable after a hand check).
- **tools/promote-channel.sh**: the third Mac gate, after the experience and agent-spawn gates. It runs on the one SNAPSHOT of the staging pointer, and KOSMOS_PROMOTE_PLUS_GATE_CMD overrides it (a test seam, as for the others).
- **tools/plus-signin-fresh.js**: the agent-run procedure.
  - `start` refuses a board that already holds a Kosmos+ identity, because a first sign-in cannot be tested there. Otherwise it asks the board to email a code to the seed address.
  - The agent reads the code and its Gmail label with the connector, scoped to `to:josh+kosmos-seed@book.io from:kosmosplus.com`.
  - `finish` does verify, then the second step (TOTP from `kosmos-seed-totp` in the secrets map), then register `kseed-<sha8>`, then checks the board is enrolled, then ALWAYS forgets what it registered. Then it writes the record.
  - A seed with no second step yet enrols an authenticator on the first run. Its secret goes to a mode-600 file for `/add-secret --migrate`, never to the screen.

## Decided (reasons on the cards)
- **A record, not a live script:** only an agent can read the seed inbox (Gmail connector).
- **The seed is a plus address on the mailbox the connector already reads,** not a new mailbox (#3751). The Resend key is never used for reading.
- **Rejected:**
  - a coordinator test-code backdoor (it would weaken production sign-in);
  - skipping the email half (the bug sat after it, and it is #1591's only way to see placement);
  - a local fake coordinator (different bytes from the ones that ship).
- **Weakest premise:** that a register and forget of a real Mac per cut is cheap. It is one certificate per cut, well inside Let's Encrypt's weekly limit.

## Not settled here
Whether a staging pass is MANDATORY before every prod cut (#2036's item 1) is still a ruling. This gate makes such a pass cover Kosmos+.

## Tests
- **tools.plus-signin-2036.test.js:**
  - the record's validation arms;
  - the gate's three exits, including another build's record reading as HOLD;
  - the TOTP against RFC 6238's vectors;
  - the runner end to end against a fake board: a pass that retires the Mac, a refusal on an enrolled board, a failed step recorded by name, and first-run enrolment with the secret never printed.
- **tools/test-staging-channel-2036.sh:** the promote with the third gate: 1 refuses and is not forceable; 2 HOLDs and --force promotes; 0 promotes on the snapshot.
- **Controls, each failing by name:** pass over a failed step; no forget; no fresh check.

## Round 1 review (opus): 2 BLOCKERs, 4 WARNINGs, 3 NITs, all taken
- [BLOCKER] the pass condition was `enrolled`, which is true in exactly the #3827 state (identity written, switch left off), so the gate could not see its own bug. FIXED: new step `up`. After the register the switch must be ON and the tunnel `up`, polled for up to 2 minutes. Test: a register that leaves the switch off fails on `up`. Control (enrolled is enough) fails by name.
- [BLOCKER] nothing tied the driven board to the pointer's build, so a staging Mac still on the previous build could write a pass for the new sha. FIXED: at both start and finish the board's own `x-kosmos-board` identity must report the pointer's version (else exit 2, nothing recorded), and `finish` refuses a board that changed since `start`. The record keeps the identity and `validate` checks it. Test and control. Residual: on macOS the identity carries the version, not the artifact sha, so two builds with one version string would pass. Every cut bumps the version.
- [WARNING] forget ran only after a 200 from register, but a register that timed out client-side or failed after writing the identity leaves a Mac behind. FIXED: forget runs whenever a register was TRIED (the engine's forget also retires a half identity); earlier exits cancel the half sign-in. Test and control.
- [WARNING] no timeouts. FIXED: 15 s on every call, 7 minutes on register and forget (the engine's own bound plus its half-identity clearing).
- [WARNING] setup mistakes (no code, KOSMOS_SEED_TOTP unset) recorded an unforceable FAIL. FIXED: they exit 2, record nothing and cancel the half sign-in. Only a board or coordinator refusal records a fail. Test.
- [WARNING] the register name ignored the seed's owned address, which the coordinator would refuse on every cut. FIXED: it uses `account_address` from the second-step or verify answer when present. Test.
- [NIT] a failed start recorded placement OTHER though no email was sent. FIXED: NONE.
- [NIT] an older record for this sha stood beside a new attempt. FIXED: start deletes it. Test.
- [NIT] the first-run TOTP secret went to a temp dir a reboot clears, which would lock the seed. FIXED: ~/.cache/claude-handoffs, mode 600, with a stated consequence. Test.

## Round 2 review (sonnet): 1 WARNING, taken
- [WARNING] a verify that answered `session` directly let `second` record a pass with no second-factor check (a coordinator regression dropping require_second would pass the gate). FIXED: any stage other than `second` or `enrol_second_factor` after the code, `session` included, fails `second` ("no second step was asked for after the code"); nothing is registered. Test; control (session accepted) fails by name.

## Round 3 review (opus): 1 BLOCKER, 1 WARNING, 2 NITs, all taken
- [BLOCKER] `start` deleted this build's record up front, so one more `start` (then a setup exit, or an abandoned finish) turned an unforceable refusal (e.g. the #3827 `up` fail) into a forceable HOLD. FIXED: nothing is deleted. The new attempt's record replaces the old one atomically when it finishes. The gate reads an attempt in flight (the progress file): it HOLDs over an old pass, but an old FAIL still refuses. Tests (a refused start leaves the FAIL standing and the gate at 1; the in-flight rules); controls (delete up front; ignore in flight) fail by name.
- [WARNING] things that say nothing about the build became an unforceable FAIL, and the header claimed otherwise. FIXED: a board call that times out (status 0) and a seed whose second step is not an authenticator are setup (exit 2, the half sign-in cancelled, nothing recorded). The header now says a refusal that was the operator's own mistake (a stale or mistyped code, an old secret) is cleared by running again, because the new record replaces it. `start` prints its time and the agent reads the NEWEST code after it. Tests; control (timeout as refusal) fails by name.
- [NIT] forget's detail claimed a Mac was left when the register had written nothing. FIXED: "nothing to retire" after a register that wrote nothing is a pass with that detail. Test.
- [NIT] the plan's Built section missed `up` and `NONE`. FIXED.

## Round 4 review (sonnet): 1 BLOCKER, taken
- [BLOCKER] round 3's "a timeout is setup" path also caught a REGISTER that timed out, exiting before the forget: a register that finished on the board after the client gave up left a Mac, with nothing recorded. FIXED: once a register was tried, a timeout is a recorded register FAIL ("a Mac may have been registered anyway") and the forget still runs; the setup exit applies only before any register. Test (a register that finishes on the board but never answers: fail recorded, forget called, board not enrolled); control fails by name.

## Round 5 review (opus): 1 WARNING, 1 NIT, both taken
- [WARNING] a signin-start that timed out was recorded as an unforceable FAIL that replaced the build's record. FIXED: no answer from signin-start is setup (the half sign-in cancelled, nothing recorded). Test (the earlier PASS stands); control fails by name.
- [NIT] the forget was bounded at the register's 7 minutes though the engine's forget can take about 8, so a slow retire read as "not retired". FIXED: its own 9-minute bound, and no answer is worded "the retire may still complete: check the seed account".
- The reviewer traced every exit of `finish`: setup throws all come before `registerTried`, refused steps are recorded, and the forget runs after any register.

## Round 6 review (sonnet): NO FINDINGS, converged
