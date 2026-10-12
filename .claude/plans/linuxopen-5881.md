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
   loop until that window closed). "ok" means started; a missing xdg-open (no xdg-utils) is said. No desktop: refused with
   a sentence.
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
That DISPLAY/WAYLAND_DISPLAY in the board's own environment means a person is at that desktop. A board run as a systemd
user service may or may not have them (a desktop session can pass them into the user's services; a lingering service can
keep a stale one). Missing one is the safe direction (the refusal); a stale one starts an xdg-open that fails unseen,
because it is not waited on.

## Tests
engine (projects): each route on linux with and without a desktop through the runner seam; the PRODUCTION xdg-open line
through a stand-in xdg-open on PATH that records its argument, and a missing xdg-open (skipped on Windows, where a shell
script cannot stand in); Mac and Windows controls unchanged. Page: the four handlers' Download branch comes before the
open request (source order), and the three project handlers RUN with onLinux true download and never ask to open, with a
Mac control.
