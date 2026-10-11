# linuxcopy-5862: Linux boards stop reaching three Mac-only restart sentences (kosmos#5862)

Follow-up to #5860 (April's branch uabortlinux-5860, the stuck-update toast). Same class: Mac words a Linux board can
reach, telling a person on a server to use a window or a folder it does not have.

## Measured (main, 2026-10-11 15:0x)
- **All three sentences are present.** `platformCopy(key, mac)` branches only on Windows, so Linux gets the Mac's words:
  - the world-switch fallback: "Quit and reopen Kosmos to finish switching to ...";
  - the offline note: "Open Kosmos from your Applications folder ...";
  - the #4343 restart screen's `restartHow`: "Open Kosmos again from your Applications folder."
- **`install/kosmos` `cmd_restart`** is `cmd_stop || true`, then `cmd_start`. So `kosmos restart` brings back a board
  that hung and one that stopped alike. The card's note ("a board that is not answering may need `kosmos start`") is
  answered by the code: restart covers both.

## Change
- An `onLinux()` arm before the Mac default in each place, as #5449 and #5860 do. Each names `kosmos restart` "on the
  computer running Kosmos ... (over SSH on a headless server)", in #5860's wording.
- World switch: `say()` writes `textContent`, so the command is plain text there. The other two are innerHTML, so
  the command is in `<b>`.
- The restart screen's step is now its own function, `restartHowText()`, so the per-platform harness can run it.
  web.firstrun-choice-4356 stubbed `platformCopy` and `restartHowMac` for that screen; it now stubs `restartHowText`.

## Decided
- **The command, not a window action.** Josh's #6 scrapped "run kosmos restart" in favour of a gentle window action,
  but that ruling is about boards that HAVE a window. A headless Linux server has none, so the command is the only
  step there is. This is #5860's reasoning, and only Linux gets it.
- **Inline arms, not a Linux copy table.** platformCopy has no Linux table, and building one for three strings is a
  wider change than the card. It would also have to decide every other key's Linux words.
- **Weakest premise:** that every Linux board is a server reached from elsewhere. A Linux desktop with a browser on
  the same machine also gets "over SSH on a headless server", which is parenthetical and still true advice there
  (it says "a terminal" first). The words also assume `kosmos` is on the PATH of the person's shell, which setup.sh
  arranges.
- Would change my mind: a Linux desktop app with a window. Then it needs a window action, like the Mac's.

## Verify
- web.win32-board-copy: a #5862 arm runs all three on linux and asserts the exact sentences, with no folder, window or
  .exe step. CONTROL: darwin and win32 never name the command, and the Mac's two sentences are unchanged.
- Mutants, each red: offline arm off, restartHowText arm off, world-switch arm off.
- web.firstrun-choice-4356 21/21 with the new stub.
- render-restart-screen-4343: a [linux] arm (page stamped linux), headless through queued-heavy, 78 passed (72 on
  every earlier run on record).
- Browser-check gates: coarse passes (a check updated); surface passes.

## Not covered
- None of these has been seen on a real Linux board (the card says so too). The browser check stamps the platform
  meta, which is what the server writes on Linux (`stampServedPlatform`).

## Review 1 (opus)
- **No blocker.**
- **SHOULD-FIX, taken.** The world-switch fallback named `kosmos restart`, but on Linux this line is reached only by
  a board that is NOT installed: an installed board restarts itself (engine/boardrestart.js linuxCanRestart, which
  I verified). There, `kosmos restart` is missing or restarts a different board. It now says "stop Kosmos and start it
  again the way you started it". I first wrote a cause ("not started by the installer") and took it out: a
  linuxboard require failure also reaches this line, on an installed board.
- **SHOULD-FIX, taken in part.** The two `worldswReconnect` lines (a self-restart slow to come back) said "quit and
  reopen" on every platform. Linux reaches them only through an installed board's self-restart, so `kosmos restart`
  is right there (`worldswStuckStep`). Tested by function and by source (both lines call it; a hard-coded-line mutant
  is red).
- **The rest of the class is on #5865:** the remote view's "Your Mac", the Dock lines, the first-run success
  screen, and Windows still getting "quit and reopen" in the reconnect lines.
- **NIT, taken:** the unit test now pins Windows' `restartHowText` (the reviewer's mutant passed before).
- **NIT, decided and kept:** the offline note's `kosmos restart` also restarts a HEALTHY board when only the path
  failed (a dropped SSH tunnel). Kept, because it is the one command that also clears a hung board, and agents survive
  it (KillMode=process, tmux). `kosmos start` would not clear a hang. What would change my mind: data showing tunnel
  drops are the common case.
- **NIT, not taken:** over an SSH tunnel the note's heading says "on this computer" (an older line) above the new
  "On the computer running Kosmos". They contradict only when the page is reached through a tunnel. Left for #5865's
  wording pass.
- **Mutants red:** worldswStuckStep's Linux arm off; the world-switch arm back to the command; a reconnect line hard-coded.
