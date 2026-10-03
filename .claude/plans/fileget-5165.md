# fileget-5165: over Kosmos+, a file click downloads to the device you are on

Card: joshualeestone/kosmos#5165 (a Kosmos+ user, via Josh 12:33; Splinter: day-one, can ride 0.7.22).

## Decisions
- The page decides, with the predicate #4930 already uses: `kplusRemote()` (reached by any name other than
  127.0.0.1 / localhost / ::1). At the computer nothing changes.
- File clicks over Kosmos+ (project rail, Documents view, a cited file in the thread, an agent's Files) become a
  download: an `<a download>` to a new GET route, the way an attachment card is (#4930).
- New routes: `GET /api/project/:id/file-download?name=` and `GET /api/agent/:name/files/download?name=`. Both pass
  `projects.fileInFolder`, the gates `openFile` used (moved out of it, so open and download share ONE copy), and
  stream the file as `application/octet-stream`, `content-disposition: attachment`, nosniff, sandbox CSP, no-store.
  The file is opened ONCE, before the headers go out; the descriptor must be the same file the gates passed (dev and
  inode, so a link swapped in after the gates is refused), and it is sized and streamed from that descriptor to
  exactly that size (a file still being written cannot overrun content-length). `pipeline` closes it on a cancel.
- The PATHS and the refusal shape (404 `{ ok: false, because }`) are April's from #4997 (PR #5119, after Monday),
  which adds the same two download routes for the Files-list preview. Same URL, same shape, so when #5119 rebases
  onto this one route body survives and the page's calls keep working (April agreed, 13:01). Not taken from
  #5119: its body reads the whole file into memory.
- No `crossSiteRead` on these routes. April showed (relay proxy.rs rewrites Origin and Referer to loopback) that it
  would PASS a Kosmos+ page, so my first reason here was wrong. Kept out anyway: the board cookie is SameSite=Strict,
  so a request another site triggers carries no auth and is refused before the route; and adding it would make every
  Kosmos+ download depend on that rewrite, which nobody has measured end to end. A Sec-Fetch-Site: cross-site arm was
  considered and rejected for the same reason (the cookie already refuses that case). Matches /api/attachment.
- The download starts IN the person's click (the anchor is clicked synchronously, so no browser can call it a
  download nobody asked for). Alongside it the page sends one GET to the same address, cut off once its headers
  arrive, and on a refusal shows the board's own sentence under the list, rather than leaving it to the browser's
  downloads. Rejected: HEAD-then-click (review 2): the click after an await has no user activation, which WebKit
  may refuse, and it depends on how the relay treats HEAD. The cost: a refused file may ALSO show as a failed item
  in the browser's downloads, beside the sentence.
- Every message line is written only while the person is still on the same project or agent (kplusSayer).
- Open Terminal over Kosmos+ (it opens a Terminal window on the board's computer) says where it opens and asks
  nothing (review iteration 1 found it).
- Folder buttons over Kosmos+ (project folder from Documents and settings, an agent's Files folder, the two
  conversations folders, the Kosmos folder from Settings and the update offer) ask the board for nothing and say
  "That folder is on the computer Kosmos runs on, not on this device, so it opens only there."
  Rejected: zipping a folder for download (new, large, and not asked for); hiding the buttons (a button that
  vanishes over Kosmos+ is a second layout to keep right; the sentence says why).
- Not changed: the attachment preview's reveal (already Download over Kosmos+, #4930); the sleep and accessibility
  settings buttons (setup steps at the computer, not files).
- No cross-site check on the GET routes, matching `/api/attachment/:id`: `crossSiteRead`'s referer arm only knows
  loopback and AGENT_WORKFORCE_ALLOWED_HOSTS, so it would refuse the very page this is for.

## Not covered, filed separately
- The Mac app in connect mode loads the board from a Kosmos+ address, so kplusRemote() is true there too, and its
  WKWebView has no download handling (native-app/main.swift: no WKDownload, no .download policy). A download link
  there most likely does nothing. #4930's attachment Download has the same gap. It is Swift and needs an app build,
  so it has its own card (#5167) rather than riding this day-one web fix.

## Not tested, stated so it is not read as covered
- A real Safari or iPhone over a live relay: Playwright WebKit with a stubbed route is the nearest arm.
- A cancelled download closing the descriptor (pipeline's documented behaviour, not exercised).
- The route glue on a real Windows board (the win32 test covers the gate, not the HTTP path).

## Weakest premise
That `kplusRemote()` is true exactly when the person is on another device. A person at the computer who opens the
board by its LAN name or a Kosmos+ address on that same computer gets downloads instead of opens; that is the
#4930 rule already, and the download still works.

## A Windows board (Splinter 12:48: the user was on Windows)
The page's rule is platform-free (kplusRemote), and the routes add nothing platform-specific on top of
`projects.fileInFolder` plus a byte stream. So the Windows proof is:
- engine/projects.download.win32-5165.test.js, selected by the windows CI job ("win32" in the name): the list's own
  name for a file in a subfolder resolves and reads back exact bytes, Windows-form names are refused, resolving a
  download opens nothing, and open at the computer still goes to File Explorer (that arm runs on the runner only).
- the browser check runs every arm again with the page served as a Windows board serves it (platform marker win32).
Rejected: a server-booting win32 test. No test the windows job runs boots server.js today, so a first one could
go red on the runner for reasons unrelated to this card and block a day-one fix I cannot run on Windows from here.
Weakest premise: that the route glue (query parsing, createReadStream piped to the response) behaves the same on
Windows; it is platform-free Node, and the Mac server test covers it.

## Tests
- server.file-download-5165.test.js: bytes and headers for a project file and an agent file; HEAD; every open
  gate refuses on download too (escape, a link out, absolute path, a folder, missing, no name) without leaking;
  POST is 405; open at the computer still calls the opener.
- docs/browser-checks/render-remote-file-download-5165.js: R1/R2 over Kosmos+, L1 control at the computer;
  against origin/main's page R1 and R2 fail.
