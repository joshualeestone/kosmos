# clipipe-8714: a closed reader that surfaces as ENOTCONN or ECONNRESET is quiet too

Card: kosmos#8714 (Angel, from PR #8713's macOS CI run 44377549059). Follows kosmos#8599 (engine/clipipe.js).

## The defect
`guardStream` treated only `EPIPE` as "the reader went away". On macOS, Node's child stdio is a socket, and a write after the reader closes surfaced as `write ENOTCONN` (errno -57) in CI. The guard rethrew it: exit 1 with a stack trace, the exact output #8599 removes, and `engine/clipipe.test.js`'s server.js/other.js arm went red on timing.

## What changed
- `engine/clipipe.js`: `CLOSED_READER_CODES` = EPIPE, ENOTCONN, ECONNRESET; any of them on stdout or stderr exits 141. Every other code is still thrown (the EIO test is unchanged). Exported for the test.
- `engine/clipipe.test.js`: the spawn arms that expect a trace (unguarded control, the board) accept any of the three; the guarded arms assert none of them. A new unit test emits each code on each stream and asserts exit 141, plus the set's exact contents.

## Decided
- ECONNRESET is included with ENOTCONN: both are how a socket reports a peer that closed, and stdout/stderr are the only streams guarded. Rejected: ENOTCONN alone (the next flake would be ECONNRESET); a broad "any error on write" rule (EIO and others must still fail loudly).
- Not reproduced as ENOTCONN by a spawn here: on this Mac the spawn arm shows EPIPE. The new unit test forces each code instead of relying on timing.

## Proof
- Mutant (the set back to EPIPE only): the new test fails, 7 pass 1 fail; restored, 8 pass.
- tools/test-cli-epipe-8599.sh passes (a real shell pipe: still EPIPE).

## Weakest premise
That ENOTCONN and ECONNRESET on stdout/stderr never mean anything but a closed reader. On these two streams I know of no other cause, but a person's terminal dropping mid-write would also exit 141 quietly now; that is the same outcome as EPIPE.

## Would change my mind
A real case where ENOTCONN on stdout means a failure the person needs to see.

## Review log
