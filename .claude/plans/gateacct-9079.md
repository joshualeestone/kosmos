# gateacct-9079: the agent-spawn gate skips a Claude row the board itself marks dead

Card: kosmos#9079. Scope set by Splinter (fleetbuilders m6672, 2026-11-25 12:37 CST) after the 0.8.23 promote.

## What happened
The 0.8.23 prod promote's agent-spawn gate (tools/staging-agent-online-check.sh) refused the build: the board would
not create its Claude agent. That refusal was RIGHT. Renet Tilley measured that 0.8.23's create check (#9031) refused
every agent on the default Claude account, a real regression fixed by createdead-9031.

## The change
The gate picks one connected account per provider from GET /api/accounts. A Claude row the board itself already marks
dead can still read `connection.state: "connected"`: badge `rejected` (an expired sign-in) or `signed_out`, or
`connection.loginEnded: true` under any badge. The gate now skips such a row, so it tests on an account the board
says works. If none is left for Claude, the existing "no signed-in account" arm answers cannot-tell (2).

## Rejected, and why it matters
- **Trying the next Claude account when a create is refused on its sign-in.** Built and reverted before any commit:
  it would have made this gate PASS on 0.8.23, the exact broken build (default account refused, a secondary tried,
  green). A create's answer is the build's answer and is never skipped.
- **Reading a sign-in refusal at create as cannot-tell.** Same reason: it would turn a proven regression into a
  forceable hold.
- **KOSMOS_PROMOTE_AGENT_GATE_CMD to run a patched gate by hand:** it goes around the gate.

## Tests (tools/test-staging-agent-online-check.sh)
- The fake board now refuses a create on `/x/.claude-dead` with the board's sign-in sentence, as the real one did.
- A rejected Claude row listed first is skipped: exit 0, and the output never says "create REFUSED".
- A loginEnded Claude row (badge working) listed first is skipped: exit 0, likewise.
- Only a dead Claude row: no signed-in Claude, cannot-tell (2).
- The existing "create refused (400, sign-in) -> do-not-promote (1)" case is unchanged and still passes: the strict
  arm stands.
- Result: 83 pass, 0 fail. Mutant (the skip line removed, on a scratch copy): all three new cases red.

## Weakest premise
That the board's own badge and loginEnded can never mark a working account dead in a way that hides a build
defect. They are part of the build. A build that wrongly marked every Claude account dead would read cannot-tell (2),
not pass, so it is held rather than promoted; one that marked only the first account dead would be tested on the next.
