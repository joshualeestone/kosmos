# clipipe-8714: a closed reader that surfaces as ENOTCONN or ECONNRESET is quiet too

Card: kosmos#8714 (Angel, from PR #8713's macOS CI run 44377549059). Follows kosmos#8599 (engine/clipipe.js).

## The defect
`guardStream` treated only `EPIPE` as "the reader went away". A child Node spawns gets a socket for stdout, and in macOS CI a write after its reader closed surfaced as `write ENOTCONN` (errno -57). A shell pipe (`kosmos ... | head` from a terminal) is a FIFO and still raises EPIPE; the real-use case this fixes is kosmos run by a Node parent (the board, an agent harness) that stops reading. The guard rethrew it: exit 1 with a stack trace, the exact output #8599 removes, and `engine/clipipe.test.js`'s server.js/other.js arm went red on timing.

## What changed
- `engine/clipipe.js`: `CLOSED_READER_CODES` = EPIPE, ENOTCONN, ECONNRESET; any of them on stdout or stderr exits 141. Every other code is still thrown (the EIO test is unchanged). Exported for the test.
- `engine/clipipe.test.js`: the spawn arms that expect a trace (unguarded control, the board) accept any of the three; the guarded arms assert none of them. A new unit test emits each code on each stream and asserts exit 141, plus the set's exact contents.

## Decided
- ECONNRESET is included with ENOTCONN: both are how a socket reports a peer that closed, and stdout/stderr are the only streams guarded. Rejected: ENOTCONN alone (the next flake would be ECONNRESET); a broad "any error on write" rule (EIO and others must still fail loudly).
- Not reproduced as ENOTCONN by a spawn here: on this Mac the spawn arm shows EPIPE. The new unit test forces each code instead of relying on timing.

## Proof
Status: mechanism built and unit-proven. Behaviour on a real socket-backed stdout raising ENOTCONN is NOT measured: it was seen once in CI and not reproduced here. The CI suite on macOS is where the next sighting would show, and it would now be exit 141.
- Mutant (the set back to EPIPE only): the new test fails, 7 pass 1 fail; restored, 8 pass.
- tools/test-cli-epipe-8599.sh passes (a real shell pipe: still EPIPE).

## Weakest premise
That ENOTCONN and ECONNRESET on stdout/stderr mean a closed reader. The residual: a stdout socket that was never connected or was misconfigured would now exit 141 quietly instead of throwing. Rare, and named here rather than guarded. (A dropped terminal is a tty and fails with EIO, which is still thrown.)

## Would change my mind
A real case where ENOTCONN on stdout means a failure the person needs to see.

## Review log
### Review 1 (opus): 1 WARNING fixed, 4 NITs (3 fixed, 1 left)
- WARNING fixed: the comment tied the socket to macOS; the reader's type decides it (a spawned child's stdout is a socket, a shell pipe a FIFO). Reworded to the measured case.
- NITs fixed: the guarded test's name says closed-reader trace; the WRITER comment sits above WRITER again; the weakest premise names the real residual (an unconnected socket), not a tty.
- NIT left: the exact-contents assertion checks a hand list; the loop above it is what proves behaviour, and nothing claims more.
### Review 2 (sonnet): 2 WARNINGs (1 recorded, 1 deferred), 4 NITs (3 fixed, 1 left)
- WARNING recorded: no measurement of a real ENOTCONN; the plan's Proof now says mechanism built, behaviour not measured.
- WARNING deferred: the unguarded control arms (bare, board) could miss a trace on timing. Not seen: the flake was the guarded arm's exit code, and an unguarded writer of 1 MB to a closed reader always errors; widening those arms to the three codes already removes the code-shape half of the risk.
- NITs fixed: the doc comment says which code was measured where (EPIPE shell pipe, ENOTCONN CI) instead of a reasoned mechanism; the long doc line rewrapped; tools/test-cli-epipe-8599.sh's guarded arm now refuses an ENOTCONN or ECONNRESET trace too.
- NIT left: the exact-contents assertion (review 1's left NIT).
### Review 3 (opus): no BLOCKER/WARNING/CONVENTION, 5 NITs fixed
- The ECONNRESET comment says it is included by reasoning, not seen; guardStream's doc says "a closed reader included"; the test header no longer says EPIPE only; the shell test's header and arm 5 refuse all three codes (arm 2 stays EPIPE: a shell pipe).
### Review 4 (sonnet): converged; its WARNING is review 2's deferred control-arm timing (duplicate), 5 NITs left
- NITs left: the test comment could mark ECONNRESET as reasoned (clipipe.js says so); the exact-contents assertion and the regex copies are hand-kept; install/kosmos:50 says EPIPE trace (true for a shell pipe); arm 2 stays EPIPE by design; the tty-EIO aside in the weakest premise is reasoned, not measured.
