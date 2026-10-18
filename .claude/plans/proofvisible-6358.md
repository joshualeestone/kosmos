# proofvisible-6358: kosmos status says when this install cannot run the board check

Card: kosmos#6358 (Renet's part: the visible fallback). Follows #1765 (boardproof-1765, merged 0d2ce792).

## What changes
- `install/kosmos`: `kosmos_proof_runnable` is the one rule for "this install can run the board proof" (the bundled
  node present and executable, and app/engine/boardproof.js present). `kosmos_board_proven` reads it (unchanged
  behaviour: when it cannot run, the call is sent as before), and `kosmos status` reads it too.
- `kosmos status` in an installed Kosmos (app/server.js present) that cannot run the check prints a short note
  first, then its usual line and exit code. Most status branches exit, so the note goes first rather than last. A
  person is given the reinstall command; an agent is told to tell its person (changing the install is the person's
  call, as with the restart advice #4466 keeps from agents and this file's exit-96 wording).

## Decided
- The fail-open itself is unchanged: an install that cannot run node cannot check, and refusing every board call
  there would break a Kosmos whose only fault is a damaged install. This makes the state visible, not closed.
- Where it shows: `kosmos status`, the command agents and people run to ask "is my Kosmos all right". Not the board
  or agent cards (board text is on hold until a pending clean-up of the board ships), and not every call
  (callers discard stderr, and a line on every report would be noise).
- A source checkout never proves (by design, #1765), so status says nothing there: the note is about a broken
  install, and in a checkout nothing is broken.
- Not in this change: the Windows CLI (it has no board proof yet; Homer's spec covers it); the report bridges'
  own fail-open (bpbridges-1765, Ice Cream Kitty's PR); sends on one connection (needs the bridges first for node).
- The note is worded "when it sends a token" (a board token or an agent's own): a board that enforces none is sent none, so an
  unconditional "it sends without the check" would be false there.
- The remedy is a reinstall (the same curl command the CLI gives for a missing runtime elsewhere; it repairs the
  default location, as that advice does), which writes the whole bundle (runtime and app) again; that is reasoned, not tested here.
- Reasoned, not measured: that agents run `kosmos status` often.
- The rule checks presence and the exec bit, as the proof always did: a present but broken node is not named here
  (the proof itself then fails closed with 96, so nothing is sent unproven in that case).
- Weakest premise: that someone reads `kosmos status` at all. The note says what to do when they do.

## Tests
- cli.proof-visible-6358.test.js sources the real CLI with a throwaway KOSMOS_HOME: no runtime, no proof module,
  and a runtime that is not executable each print the note; a whole install (CONTROL) and a source checkout do not;
  the note shows on the not-running branch too (exit 1); a person and an agent get different advice; both callers
  read the shared rule and one path; and kosmos_board_proven itself returns 0 with no runtime but tries the proof
  (exactly curl's 7 on a closed port; its stand-in node refuses --verify, so a stray listener cannot read as proven)
  on a whole install. CLAUDE.md's board-proof row names this test.
