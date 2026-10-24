# startmenu-6985: the Windows board sends a person to the Start menu (kosmos#6985, board half)

## Finished means
No Windows board message tells a person to double-click Kosmos.exe "in your Kosmos folder" to open, restart or sign in
Kosmos (that read as the extracted zip). Each says to open Kosmos from the Start menu, whose entry runs the copy Kosmos
runs from (the installed one once it has installed itself), matching the zip read-me (#6984). Tests pin it both ways.

## The change
web/index.html `windowsCopyTable`: restartKosmos, settingsOpenKosmos, updateSlowRemedy, the manual update's last step,
signinSentence, signinPanel, offlineRemedy. Tests: web.win32-board-copy, web.update-settle-win32,
web.win32-update-offer; browser check render-win32-board-copy. Each now refuses Kosmos.exe / Kosmos folder.

## Decided, and why
- Split with Homer (confirmed via Splinter 08:31): he keeps KosmosLauncher.cs (needs a rebuild and re-sign).
- Left alone per the card: engine/win32apply.js and engine/win32update.js, which point at a newly unpacked copy.
- The manual update's step 5 says the Start menu: "Open my Kosmos folder" reveals windowsKosmosFolder (the running
  root), and the Start menu runs that same root's Kosmos.exe, so the swapped build is what opens.
- Weakest premise: worldSwitchRestart's remedy was already untrue when the logon job is missing or Kosmos was started by
  hand (pre-existing; written on the card for Homer, not invented here).

## Order and rollback
Independent of the launcher half. Rollback: revert.
