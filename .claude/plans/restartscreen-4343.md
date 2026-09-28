# restartscreen-4343: "Kosmos requires a full restart" screen (#4343)

## Goal
When this window's own board stops answering, replace everything with one clean centered screen:
the Kosmos K, "Kosmos requires a full restart" (Josh's words, verbatim), and how to do it.

## Done looks like
- After the board has not answered for 15 s, the real status poll draws `.restart-back`: opaque
  page ground, full window, centered, still K mark, headline, the platform's remedy (Mac: Command-Q
  then the Applications folder; Windows, Homer's wording: close the window, then open Kosmos again from the Start menu), and nothing else.
  The version and the address that did not answer go to the console log (Josh via Splinter, 10:39:
  "not show anything else but just a nice clean centered graphic").
- Everything behind it is inert; the first answering poll removes it and gives back exactly the
  inert state it took.
- Not shown for a Kosmos+ remote view, a device that is offline, a running update, a world switch, or a page no
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
- A parsed 200 now counts as answered in tick() (it used to be only a refusal), so a painter that
  throws on a good read can never put a person behind this screen. The small note follows the same
  flag, which matches #268's rule that a board that answered is not absent.
- While up: page scroll and the scrollbar gutter are off, nodes added to <body> are made inert, and
  focus goes back where it was on recovery. Both painter calls are try-isolated.
- Windows copy is a constant in windowsCopyTable (restartHow), Homer's wording; the check's baked
  Windows page (/win) asserts it.
- While it is up, one window capture keydown listener stops every key reaching the page behind it
  (first run, the update dialog, the notices, every modal and picker), without preventDefault, so
  Command-Q works. The notice (cnHeld), What's New (wnCovered) and tips (tipModalOpen) also treat it
  as covering, so none opens behind it.

## Timing, stated plainly
The 15 s clock starts at the first poll that RETURNS a failure. The poll's fetch has no timeout, so
a board that accepts the connection but never answers delays both the note and this screen until
the webview gives up (the #4342 side of this). With fast failures the screen appears 15 to 20 s
after the first failed poll.

## Weakest premise
The 15 s threshold. Too short and a normal board restart flashes the screen; too long and a person
stares at the busted page. It is one constant, RESTART_SCREEN_AFTER_MS.
