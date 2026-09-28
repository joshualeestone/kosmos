# restartscreen-4343: "Kosmos requires a full restart" screen (#4343)

## Goal
When this window's own board stops answering, replace everything with one clean centered screen:
the Kosmos K, "Kosmos requires a full restart" (Josh's words, verbatim), and how to do it.

## Done looks like
- After the board has not answered for 15 s, the real status poll draws `.restart-back`: opaque
  page ground, full window, centered, still K mark, headline, the platform's remedy (Mac: Command-Q
  then the Applications folder; Windows: close the window, then Kosmos.exe), and a small details
  line (version, the address that did not answer).
- Everything behind it is inert; the first answering poll removes it and gives back exactly the
  inert state it took.
- Not shown for a Kosmos+ remote view, a device that is offline, a running update, or a page no
  board served (file://).
- render-restart-screen-4343.js asserts all of that in light and dark, wired in gated.txt with a
  README row.

## Decisions
- A separate painter (paintRestartScreen), not a change to paintOfflineNote: the note keeps its
  no-cause, no-"restart" rule and its tests; this screen is Josh's ruling to say "restart" as the
  remedy.
- No "Restart Kosmos" button: the page has no native hook to restart the board (the Mac shell
  exposes only kosmosBadge). Adding one is native/engine work; noted on the card as a follow-up.
- 15 s before taking over (three polls): one dropped poll during a launchd restart should not flash
  a full-screen alarm. The small note still shows from the first failure.
- A still K (startKLoader's reduced-motion frame via { still: true }), because an animating mark
  would say something is working.

## Weakest premise
The 15 s threshold. Too short and a normal board restart flashes the screen; too long and a person
stares at the busted page. It is one constant, RESTART_SCREEN_AFTER_MS.
