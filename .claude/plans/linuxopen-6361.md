# linuxopen-6361: kosmos open on Linux (kosmos#6361)

Built on `boardproof-1765` (Renet Tilley, #1765), which rewrote `cmd_open`'s proof and nonce refusals; that landed
on main as 67c15b9192 (PR #6394), and this branch now sits on main. Renet handed the card over and reviews the PR. PigeonPete's
`boardsession-6358` also edits `cmd_open`'s comments; this change touches only its last lines (told, 07:21).

## The call
- The opener is chosen per platform, AFTER the #1765 refusals (a board that fails the proof or the nonce request is
  neither opened nor printed, unchanged):
  - `KOSMOS_OPEN_BIN` set: it wins (the test seam, or a person's own choice), as before.
  - Darwin: `/usr/bin/open`, as before. Its FAILURE path is the shared one below, so on a Mac a failed open on an
    enforcing board now hands a person the one-time address (still exit 1), and not the plain address it gave before.
  - Linux with `DISPLAY` or `WAYLAND_DISPLAY` and `xdg-open` on PATH: `xdg-open`.
  - Anything else: no opener.
- No opener:
  - a non-enforcing board (no token, no nonce): print the plain address, exit 0;
  - an enforcing board that answered without a nonce: its plain page cannot sign in, so say the one-time address could
    not be made and give the command to try again, exit 1;
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
- An opener that fails may still have reached a browser that used the one-time address before failing, so after a
  failure the address is offered as "if no browser opened". On Linux over `ssh -X` with no desktop, xdg-open may hand
  it to a text browser in the terminal (www-browser), which would use it there.
- "A terminal" is `[ -t 1 ]`: a terminal that is itself recorded (`script -a`, tmux `pipe-pane`, a logged ssh
  session) keeps the one-time address in that record. It works once, within 2 minutes.
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
- `xdg-open` can exit 0 while nothing opens (no handler); as on macOS (#1957), the words name the address. In its
  generic fallback it runs `$BROWSER` in the foreground, so `kosmos open` can wait until that browser exits.
- Not measured on a real Linux desktop: the arms run the CLI as Linux on macOS through `KOSMOS_PLATFORM`, with a stub
  xdg-open on PATH.

## Checks
`cli.open-linux-6361.test.js` (13 tests, the CLI run as Linux through `KOSMOS_PLATFORM`, a stub xdg-open on PATH):
- Linux with DISPLAY opens the one-time address with xdg-open; Wayland alone counts as a display.
- No display, no terminal: no one-time address, exits 1, says why, gives the full-path command, never "sign in there".
- No display, at a terminal (script(1)): the one-time address is printed.
- A non-enforcing board: the plain address.
- A failed proof: neither opened nor printed, even at a terminal with a display.
- An agent at a terminal: not handed the address (CONTROL: a person at the same terminal is); an agent is told to ask
  the person.
- A failed xdg-open at a terminal still hands over the address and exits non-zero; a failed opener on an enforcing
  board as Darwin, not at a terminal, prints no address and exits non-zero.
- A platform that is neither: no opener runs.
- An enforcing board that answers without a nonce: no dead-end plain address (CONTROL: without a token it is).
- A source check that Darwin keeps /usr/bin/open and the old default is gone.
Mutants: the original cmd_open reds 5 of the first 6; dropping the terminal guard, the agent check, or the fallback
each reds its arm.

## Follow-up copy (PigeonPete, 07:23)
boardsession-6358 (#6358) adds Linux copy to the not-signed-in panel in web/index.html: "Signing a local browser tab
back in is not available on Linux yet", pinned in web.win32-board-copy.test.js (a match on that sentence and a
doesNotMatch on /kosmos open/). This card makes that sentence false. Merge order is Renet, Kitty, then 6358: if #6361
lands after 6358, changing that copy and its pins (the full-path `kosmos open`, then Reload) is this card's; if it
lands first, tell PigeonPete and he updates it on his branch.
