# linuxopen-5881: opening things on a Linux board

Card: #5881 (Angel, found building #5865). Owner: April (night shift shard).

## Traced (main @ checkout)
`/usr/bin/open` callers (engine/*.js, server.js, tests excluded):
- engine/projects.js revealFolder (`open <folder>`), revealFile (`open -R <file>`), openFile (`open <file>`): every
  "Open in Finder" / "Show me where" and opening a listed file on the computer. Windows has its own arm (win32explorer);
  Linux falls into the Mac arm and fails ("Finder did not open").
- engine/machine.js: reveal the Kosmos app, the System Settings panes. Mac things; #5877 (Mona Lisa: first run and
  machine.js rows on Linux) owns them.
- engine/agysignin.js, engine/agystatus.js: Antigravity sign-in. Antigravity has no Linux package (engine/runners.js lists
  none), so a Linux board never reaches them.
- engine/remote.js already uses `xdg-open` off macOS and Windows (the company sign-in page).
- The page's three callers of POST .../open-file (web/index.html) already offer Download through Kosmos+ (kplusRemote,
  #5165), because the file is not on the viewing device.

## Decided, per route
1. Linux with a desktop (the board's own environment has DISPLAY or WAYLAND_DISPLAY): `xdg-open`, as remote.js does.
   revealFolder opens the folder; revealFile opens the file's folder (xdg-open cannot select a file); openFile opens the file.
2. Linux with no desktop (a server, the usual Linux board, run as a systemd user service): refused with a sentence that
   names the reason, never a failing `open`.
3. The page's file rows: on Linux they offer Download, as they do through Kosmos+ and as #5865 makes the preview do
   (pvOffersDownload): the file is on a computer the person is very likely not sitting at.
Rejected: refusing on every Linux board (a Linux desktop can open files); asking the person which (nothing to ask: the
board's environment says whether there is a desktop).

## Not here
machine.js (#5877), Antigravity (no Linux package), the buttons #5865 hides.

## Weakest premise
That DISPLAY/WAYLAND_DISPLAY in the board's own environment means a person is at that desktop. A board started from a
desktop session has them; a systemd user service usually does not, even on a desktop machine, so a desktop Linux user
whose board runs as a service gets the refusal and the Download. Wrong in the safe direction.

## Tests
engine (projects): each route with the platform set to linux, with and without a desktop, through the runner seam:
xdg-open and its arguments, or the refusal; Mac and Windows controls unchanged. Page: the three file-row callers offer
Download on a linux page, with a darwin control.
