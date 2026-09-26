# plus-gate-2036: the first Kosmos+ sign-in gate on the Mac promote (kosmos#2036, #1591)

Splinter handed #2036 and #1591 over on 2026-09-26 (both labelled needs-decision; the decision is mine). The decisions and their reasoning are on the two cards (05:35 CDT comments).

## The gap
kosmos#3827's parseSaid bug broke the FIRST in-app Kosmos+ sign-in (the first registration). Every check passed, because every checker's Mac was already signed in. The shipped Mac promote gates (#2063, a fresh browser; #2150, a fresh agent spawn) never touch Kosmos+.

## Built
- **tools/lib/plus-signin-record.js**: the record spec, defined once for the writer and the gate. Records live at `plus-signin-<sha256>.json`, one per artifact, in `$KOSMOS_PLUS_VERIFY_DIR` or `~/.local/state/kosmos/release-verify`, beside the Windows records. The steps are: fresh, start, code, verify, second, register, enrolled, forget. The code email's placement is INBOX, SPAM or OTHER (#1591). The result is `pass` only when every step passed. The same file holds the gate's CLI.
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
