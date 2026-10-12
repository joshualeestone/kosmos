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
- The page's four file-row handlers (web/index.html: an agent's Files, and three that call POST .../open-file) already
  offer Download through Kosmos+ (kplusRemote,
  #5165), because the file is not on the viewing device.

## Decided, per route
1. A FOLDER (revealFolder; revealFile opens the file's folder, xdg-open cannot select a file): on Linux with a desktop
   (the board's own environment has DISPLAY or WAYLAND_DISPLAY) `xdg-open` is STARTED, detached, never waited on (review 1:
   on a desktop it does not know, it runs the file manager in the foreground, and waiting would hold the board's event
   loop until that window closed). "ok" means started; a missing xdg-open (no xdg-utils) is said. It is given only what it
   needs to reach the desktop (HOME, PATH, LANG, the display and its X cookie XAUTHORITY, XDG_RUNTIME_DIR, the session
   bus, the desktop's identity (XDG_CURRENT_DESKTOP, XDG_SESSION_TYPE, DESKTOP_SESSION, XDG_SESSION_DESKTOP,
   KDE_FULL_SESSION, KDE_SESSION_VERSION (Plasma's opener depends on it), GNOME_DESKTOP_SESSION_ID) and where its choices live (XDG_DATA_DIRS, XDG_CONFIG_HOME, XDG_CONFIG_DIRS), so xdg-open
   finds the desktop's file manager rather than a browser), never the board's own environment and its tokens. Only an
   absolute path reaches it: xdg-open reads a leading "-" as an option and takes no "--". No desktop: refused, "Kosmos cannot open it on this computer: it is not running
   in a desktop session". Whether an INSTALLED board has a display depends on when its service started (review 3): its
   unit sets none itself, but GNOME and KDE pass the session's display into the user's services at login, so a board
   started or restarted after the person logged in to a desktop has one, and one started before does not. The same
   machine can therefore refuse before a restart and open after one. Making that reliable is the Linux port's call
   (#4916); suggested there.
2. A FILE (openFile) is never opened on a Linux board (review 1): xdg-open would hand an agent-written .desktop file or
   script to whatever the desktop runs it with, a type Windows refuses (SAFETY 1); and the page downloads files there
   anyway. Refused after resolveListedFile's gates, with "download it instead".
3. The page's FOUR file-row handlers (an agent's Files, docs-list, pj-docs, pj-room) download on a Linux board, as they do
   through Kosmos+ (#5165) and as #5865 makes the preview do: the page cannot know whether the board has a desktop, and a
   download works either way.
This changes behaviour on Linux only, and it is reversible: a person at a Linux desktop gets a download, not the file
opening. Flagged on the PR for anyone who wants it the other way.
Rejected: opening files with xdg-open on a desktop (the page never asks, and the type gate Windows has would be needed);
telling the page whether there is a desktop (more surface for a case the download already covers); refusing folders on
every Linux board (a Linux desktop can open a folder, and opening a folder runs nothing).

## Not here
machine.js (#5877), Antigravity (no Linux package), the buttons #5865 hides.
engine/remote.js's company sign-in opener, which hands xdg-open the board's whole environment: follow-up #5889.

## Weakest premise
That a refusal is the right answer whenever the board's environment has no display (it is true then: the board is not in
a desktop session, and the sentence says exactly that). Unseen failures, because xdg-open is started and not waited on:
a stale display, and a binary that vanished between the lookup and the start. "ok" means started.

## Tests
engine (projects): each route on linux with and without a desktop through the runner seam; the PRODUCTION xdg-open line
through a stand-in xdg-open on PATH that records its argument, and a missing xdg-open (skipped on Windows, where a shell
script cannot stand in); Mac and Windows controls unchanged. Page: the four handlers' Download branch comes before the
open request (source order), and the three project handlers RUN with onLinux true download and never ask to open, with a
Mac control.
