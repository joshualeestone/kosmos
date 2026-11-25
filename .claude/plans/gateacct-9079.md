# gateacct-9079: the agent-spawn gate skips a Claude row the board itself marks dead

Card: kosmos#9079. Scope set by Splinter (fleetbuilders m6672, 2026-11-25 12:37 CST) after the 0.8.23 promote.

## What happened
The 0.8.23 prod promote's agent-spawn gate (tools/staging-agent-online-check.sh) refused the build: the board would
not create its Claude agent. That refusal was RIGHT. Renet Tilley measured that 0.8.23's create check (#9031) refused
every agent on the default Claude account, a real regression fixed by createdead-9031.

## The change
The gate picks one connected account per provider from GET /api/accounts. A Claude row the board itself already marks
dead can still read `connection.state: "connected"`: badge `rejected` (an expired sign-in) or `signed_out`, or
`connection.loginEnded: true` under any badge. The gate now skips such a row when it is a SECONDARY account, and
says in its log which one and why. If none is left for Claude, the existing "no signed-in account" arm answers
cannot-tell (2).

**The default row is never skipped (review 1 BLOCKER).** Its dead mark comes from the build under test: Check now
runs the same probe as the create, so on 0.8.23 a person pressing Check now would have marked the default rejected,
and a gate that skipped it would have passed on a secondary account. The default is tested exactly as on main.

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
- Review 1: the DEFAULT row marked dead (isDefault true, badge rejected) beside a working secondary is NOT skipped:
  its create refusal stands, exit 1, and nothing is logged as skipped. On the previous commit it read 0.
- Review 1: a skipped secondary row is named in the log, with its reason.
- Review 2: a signed_out secondary row that still reads state connected is skipped and named (the existing
  claude-signedout fixture has state none, so it never reached the skip).
- The existing "create refused (400, sign-in) -> do-not-promote (1)" case is unchanged and still passes: the strict
  arm stands.
- Result: 85 pass, 0 fail. Mutants, each on a scratch copy: the skip line removed turns the three skip cases red;
  the default guard removed (review 1) turns the default-row case red.

## Weakest premise
That a build defect never shows only as a false dead mark on a SECONDARY account. The default is safe by the rule
above. A build that wrongly marked a secondary dead would be tested on another account: a narrower gap than before
the skip existed (when the gate picked whatever row came first), and every such skip is now named in the log.
The same holds for `loginEnded`, which the board sets from the login date (review 2): a build that set it wrongly on
a secondary would see that secondary skipped, and named, not tested.
