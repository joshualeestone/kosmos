# linuxopen-6361: kosmos open on Linux (kosmos#6361)

Built on `boardproof-1765` (Renet Tilley, #1765), which rewrote `cmd_open`'s proof and nonce refusals; that landed
on main as 67c15b9192 (PR #6394), and this branch now sits on main. Renet handed the card over and reviews the PR. PigeonPete's
`boardsession-6358` also edits `cmd_open`'s comments; this change touches only its last lines (told, 07:21).

## The call
- The opener is chosen per platform, AFTER the #1765 refusals (a board that fails the proof or the nonce request is
  neither opened nor printed, unchanged):
  - `KOSMOS_OPEN_BIN` set: it wins (the test seam, or a person's own choice), as before.
  - Darwin: `/usr/bin/open`, as before.
  - Linux with `DISPLAY` or `WAYLAND_DISPLAY` and `xdg-open` on PATH: `xdg-open`.
  - Anything else: no opener.
- No opener:
  - a non-enforcing board (no nonce): print the plain address, exit 0;
  - with a nonce, on a person's terminal (`[ -t 1 ]` and not `_invoked_by_agent`, the CLI's own agent check): print
    the one-time sign-in address, say it works once within 2 minutes
    (NONCE_TTL_MS = 120000, engine/boardauth.js) and not to share it, exit 0;
  - with a nonce, not a person's terminal (a pipe, a log, or an agent, whose terminal is its transcript): do NOT
    print it, say why, and give the full-path command to run in a terminal (`$KOSMOS_HOME/bin/kosmos open`, since the
    bare name is not always on PATH), on stderr, exit 1. Not "go to the plain address and sign in": on an enforcing
    board that page has no way to sign in.
- The platform comes from `KOSMOS_PLATFORM` (the CLI's own seam, used throughout), else `uname -s`.

## Rejected
- Printing the nonce address whenever there is no opener: piped output lands in logs, and the address is a credential
  for its window (Renet's constraint).
- Writing it to /dev/tty when stdout is not a terminal: an agent's or a launchd job's /dev/tty is not a person, and
  the rule is simpler to check with `-t 1` alone.
- Minting the nonce only once an opener is known: the mint is inside Renet's refusal block, which this card does not
  move; an unused nonce expires in 2 minutes.

## Weakest premise
- An agent is detected the way the rest of the CLI detects one (`_invoked_by_agent`: its session or token variable,
  or its pane's supervisor claim). An agent started outside Kosmos's supervisor, with none of those, at a terminal,
  would be handed the address; it works once, within 2 minutes, and such an agent can already read `board.token`.
- On the no-terminal enforcing path a nonce is minted and thrown away each time (a launcher retrying would mint
  several); each expires in 2 minutes.
- `DISPLAY`/`WAYLAND_DISPLAY` as "there is a display". A forwarded `DISPLAY` that is dead makes xdg-open fail, so a
  failed opener takes the no-opener path: at a person's terminal it hands over the one-time address, and it still
  ends non-zero with "Could not open a browser from here." on stderr (#1957: a failed open never exits 0).
- Platforms other than Darwin and Linux (a BSD, Cygwin) get no opener now. Before, they ran a `/usr/bin/open` they
  do not have and failed; now they hand over the address, which is the better of the two.
- `xdg-open` can exit 0 while nothing opens (no handler); as on macOS (#1957), the words name the address.
- Not measured on a real Linux desktop: the arms run the CLI as Linux on macOS through `KOSMOS_PLATFORM`, with a stub
  xdg-open on PATH.

## Checks
- `cli.open-linux-6361.test.js` (6 tests): Linux with a display opens the nonce address with xdg-open; no display and
  no terminal prints no nonce and exits 1; no display at a terminal (script(1)) prints it; a non-enforcing board gives
  the plain address; a failed proof is neither opened nor printed even at a terminal with a display; the macOS opener
  is unchanged. Mutants: the original cmd_open reds 5 of 6; dropping the terminal guard reds the no-terminal arm.

## Follow-up copy (PigeonPete, 07:23)
boardsession-6358 (#6358) adds Linux copy to the not-signed-in panel in web/index.html: "Signing a local browser tab
back in is not available on Linux yet", pinned in web.win32-board-copy.test.js (a match on that sentence and a
doesNotMatch on /kosmos open/). This card makes that sentence false. Merge order is Renet, Kitty, then 6358: if #6361
lands after 6358, changing that copy and its pins (the full-path `kosmos open`, then Reload) is this card's; if it
lands first, tell PigeonPete and he updates it on his branch.
