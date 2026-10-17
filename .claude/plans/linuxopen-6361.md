# linuxopen-6361: kosmos open on Linux (kosmos#6361)

Stacked on `boardproof-1765` (Renet Tilley, #1765), which rewrites `cmd_open`'s proof and nonce refusals. Rebase
onto main once that lands; never merge first. Renet handed the card over and reviews the PR. PigeonPete's
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
  - with a nonce, on a terminal (`[ -t 1 ]`): print the one-time sign-in address, say it works once within 2 minutes
    (NONCE_TTL_MS = 120000, engine/boardauth.js) and not to share it, exit 0;
  - with a nonce, not a terminal: do NOT print it (it would land in a file or a log), say why and what to do
    (run it in a terminal, or go to the plain address and sign in), exit 1.
- The platform comes from `KOSMOS_PLATFORM` (the CLI's own seam, used throughout), else `uname -s`.

## Rejected
- Printing the nonce address whenever there is no opener: piped output lands in logs, and the address is a credential
  for its window (Renet's constraint).
- Writing it to /dev/tty when stdout is not a terminal: an agent's or a launchd job's /dev/tty is not a person, and
  the rule is simpler to check with `-t 1` alone.
- Minting the nonce only once an opener is known: the mint is inside Renet's refusal block, which this card does not
  move; an unused nonce expires in 2 minutes.

## Weakest premise
- `DISPLAY`/`WAYLAND_DISPLAY` as "there is a display". A headless box with a forwarded `DISPLAY` that is dead makes
  xdg-open fail; that path dies with "Could not open a browser. Go to the dashboard yourself: <plain URL>", which,
  on an enforcing board, gives no way in. Not handled here: the fallback could print the nonce address on a
  terminal there too. What would change my mind: a report from a Linux person who hits it.
- `xdg-open` can exit 0 while nothing opens (no handler); as on macOS (#1957), the words name the address.
- Not measured on a real Linux desktop: the arms run the CLI as Linux on macOS through `KOSMOS_PLATFORM`, with a stub
  xdg-open on PATH.

## Checks
- `cli.open-linux-6361.test.js` (6 tests): Linux with a display opens the nonce address with xdg-open; no display and
  no terminal prints no nonce and exits 1; no display at a terminal (script(1)) prints it; a non-enforcing board gives
  the plain address; a failed proof is neither opened nor printed even at a terminal with a display; the macOS opener
  is unchanged. Mutants: the original cmd_open reds 5 of 6; dropping the terminal guard reds the no-terminal arm.
