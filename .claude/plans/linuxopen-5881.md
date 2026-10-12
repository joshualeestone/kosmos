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
1. A FOLDER (revealFolder; revealFile opens the file's folder, xdg-open cannot select a file): on Linux with a desktop
   (the board's own environment has DISPLAY or WAYLAND_DISPLAY) `xdg-open` is STARTED, detached, never waited on (review 1:
   on a desktop it does not know, it runs the file manager in the foreground, and waiting would hold the board's event
   loop until that window closed). "ok" means started; a missing xdg-open (no xdg-utils) is said. It is given only what it
   needs to reach the desktop (HOME, PATH, LANG, the display, XDG_RUNTIME_DIR, the session bus), never the board's own
   environment and its tokens (review 2). No desktop: refused, "Kosmos cannot open it on this computer: it is not running
   in a desktop session". Review 2: the board's own systemd unit sets no display, so an INSTALLED Linux board always
   takes this refusal, even on a desktop machine; only a board started by hand from a desktop opens folders. Giving the
   unit the session's display is the Linux port's call (#4916); suggested there.
2. A FILE (openFile) is never opened on a Linux board (review 1): xdg-open would hand an agent-written .desktop file or
   script to whatever the desktop runs it with, a type Windows refuses (SAFETY 1); and the page downloads files there
   anyway. Refused after resolveListedFile's gates, with "download it instead".
3. The page's FOUR file-row handlers (an agent's Files, docs-list, pj-docs, pj-room) download on a Linux board, as they do
   through Kosmos+ (#5165) and as #5865 makes the preview do: the page cannot know whether the board has a desktop, and a
   download works either way.
Rejected: opening files with xdg-open on a desktop (the page never asks, and the type gate Windows has would be needed);
telling the page whether there is a desktop (more surface for a case the download already covers); refusing folders on
every Linux board (a Linux desktop can open a folder, and opening a folder runs nothing).

## Not here
machine.js (#5877), Antigravity (no Linux package), the buttons #5865 hides.

## Weakest premise
That a refusal is the right answer for an installed board on a desktop machine (it is true there: the service is not in
the desktop session, and the sentence says exactly that), until #4916 decides whether the service gets the display. A
stale display starts an xdg-open that fails unseen, because it is not waited on.

## Tests
engine (projects): each route on linux with and without a desktop through the runner seam; the PRODUCTION xdg-open line
through a stand-in xdg-open on PATH that records its argument, and a missing xdg-open (skipped on Windows, where a shell
script cannot stand in); Mac and Windows controls unchanged. Page: the four handlers' Download branch comes before the
open request (source order), and the three project handlers RUN with onLinux true download and never ask to open, with a
Mac control.
