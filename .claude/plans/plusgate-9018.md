# plusgate-9018: the first Kosmos+ sign-in release gate can say yes (kosmos#9018)

## Why
`tools/plus-signin-verified.sh` gates the Mac promote on a record that `tools/plus-signin-fresh.js` writes after a
real first sign-in on the staged build. No record had ever existed: the run needed a fresh board and a code read by
hand, so the gate only ever said "cannot tell" and every promote went out with that warning.

## What
- `tools/plus-signin-fresh.js`: `--board-kind sandboxed` drives a FULLY sandboxed throwaway board, which writes no
  board.token and checks none (engine/boardauth.js). Asked for by name, refused on a board that has a token, refused
  when finish names another kind than start, and recorded as `board_kind` (the record check ignores extra fields).
- `tools/plus-signin-auto.sh` (new): the whole run in one command. Seed guard first (a plus-tag address listed in a
  kosmosplus-test-*.meta header, else refused before any call), the pointer's own tarball (sha256 checked), booted
  sandboxed from a clean environment with auto-update off, anchor + start + code with its Gmail placement + finish,
  always torn down.
- The gate's no-record hint and promote-channel.sh's comment name the new driver.

## Proven
- By hand on the real 0.8.21 staging build, 11-24 18:13 CST: all nine steps pass, code in INBOX, the Mac forgotten
  after; the gate says 0 with the record and 2 on an empty record dir; on Mortals, unchanged main code reads PASS.
- Tests: 4 new arms in tools.plus-signin-2036.test.js, 7 in tools.plus-signin-auto-9018.test.js, fakes only.
  Mutants, each red with a pass count: sandboxed-with-token refusal removed (1 red), default kind flipped (20 red),
  seed guard skipped, sha check skipped, placement not asked for (1 red each), board left running (3 red).
- The 28 tree-sweeping guard tests pass (434 tests).

## Rejected
- A real, enforcing board under a fake HOME: it arms live launchd and tmux on the fleet Mac.
- A new dedicated seed alias: sign-in is create-free, so a new alias needs a signup, which the card rules out.

## Weakest premise
A sandboxed board signs in exactly as an installed one does. Board auth is off in it; the sign-in routes do not read
board auth, but that is not proved for every route.

## Limit, stated so nobody reads more into it
KOSMOS_PLUS_VERIFIED_SHA256 stops an ACCIDENTAL sandboxed record (a worktree fixture reporting the staged version). It
does not stop a deliberate one: whoever can set it can also write the record JSON by hand, as with any record on the
box. The bytes are proved by plus-signin-auto.sh's sha256 check, and only on runs it made.

## Depends on
Josh-Brain `signinplace-9018` (kosmos-signin-code's `KOSMOS_SIGNIN_PLACEMENT=1`), installed to ~/.local/bin.
