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
  never past that size (a file still being written cannot overrun content-length). A read that ends SHORT (the file
  shrank) destroys the response, a reset, rather than ending it short. Rejected: strictContentLength (review 4): its
  mismatch throws inside an event handler, and server.js has no uncaughtException handler, so a shrinking file
  could take the board down. `pipeline` closes the descriptor on a cancel.
- The same-file decision is `projects.sameOpenedFile` (pure, so the win32 test drives it): with inodes on both sides,
  the same inode and, off Windows, the same device; where a file system reports no inode (FAT, exFAT, some network
  drives answer 0; Splinter 13:18, from Baron's review), the same size and modification time, and creation time
  when both report one. Weaker than an inode, so after opening the route also runs the gates on the name again and
  requires the same resolved place.
- A refused DOWNLOAD NAVIGATION (the anchor, Sec-Fetch-Mode: navigate) is answered 204 with no body, so no browser
  saves a JSON refusal as `gone.pptx` (review 5: WebKit decides on a download at the click). The page's look
  (?check=1) still gets the sentence. That holds for EVERY refusal on both download routes, the early ones too (a bad
  name or id, no such agent or project, a linked Files, a projects read failure), all through refuseDownload and
  all in one shape, { ok: false, because } (review 7). Weakest premise: that the relay forwards Sec-Fetch-Mode; if it does not, the
  refusal is a 404 JSON again, which Chromium shows as a failed download and WebKit may save.
- Content-Disposition carries an ASCII `filename=` (control characters, quotes and backslashes made `_`) before the
  exact RFC 5987 `filename*` (Baron).
- Only the latest download asked through a message line may write a refusal to it (KPLUS_LATEST), so a slow look
  for an earlier click cannot land under a later one.
- The PATHS and the refusal shape (404 `{ ok: false, because }`) are April's from #4997 (PR #5119, after Monday),
  which adds the same two download routes for the Files-list preview. Same URL, same shape, so when #5119 rebases
  onto this one route body survives and the page's calls keep working (April agreed, 13:01). Not taken from
  #5119: its body reads the whole file into memory.
- No `crossSiteRead` on these routes. April showed (relay proxy.rs rewrites Origin and Referer to loopback) that it
  would PASS a Kosmos+ page, so my first reason here was wrong. Kept out anyway: the board cookie is SameSite=Strict,
  so a request another site triggers carries no auth and is refused before the route; and adding it would make every
  Kosmos+ download depend on that rewrite, which nobody has measured end to end. A Sec-Fetch-Site: cross-site arm was
  considered and rejected for the same reason (the cookie already refuses that case). Matches /api/attachment.
- The look beside the download is `?check=1`: the same gates and open, then 204 with no body, so it never moves
  the file a second time (review 3: a full GET cut off by the page depends on the relay passing the abort upstream).
- A refusal after the gates says what is true: ENOENT is "not there any more, or it was moved", anything else
  (a lock, a permission) is "could not be read on the computer Kosmos runs on".
- Deliberately NOT done: opening with O_NONBLOCK against a FIFO swapped in after the gates (review 3). Only the
  agent can put one in its folder, and the agent already runs commands on that computer, so a held worker thread
  gives it nothing; openFile has the same exposure; and the flag is undefined on Windows (a #1732 inventory row).
- The download starts IN the person's click (the anchor is clicked synchronously, so no browser can call it a
  download nobody asked for). Alongside it the page looks with `?check=1` (above), and on a refusal shows the
  board's own sentence under the list, rather than leaving it to the browser's downloads. Rejected: HEAD-then-click (review 2): the click after an await has no user activation, which WebKit
  may refuse, and it depends on how the relay treats HEAD. The cost: a refused file may ALSO show as a failed item
  in the browser's downloads, beside the sentence.
- Every message line is written only while the person is still on the same project or agent (kplusSayer).
- Open Terminal over Kosmos+ (it opens a Terminal window on the board's computer) says where it opens and asks
  nothing (review iteration 1 found it). So do the sleep and Accessibility settings buttons (review 5): they open
  System Settings on the board's computer, the same class as a folder button.
- Folder buttons over Kosmos+ (project folder from Documents and settings, an agent's Files folder, the two
  conversations folders, the Kosmos folder from Settings and the update offer) ask the board for nothing and say
  "That folder is on the computer Kosmos runs on, not on this device, so it opens only there."
  Rejected: zipping a folder for download (new, large, and not asked for); hiding the buttons (a button that
  vanishes over Kosmos+ is a second layout to keep right; the sentence says why).
- Not changed: the attachment preview's reveal (already Download over Kosmos+, #4930).
- Known limit, not refused: a HARD LINK inside a folder to a file outside it downloads (realpath cannot see one).
  Only the same user can make one, and an agent that could make one can already copy the same file into its Files,
  so refusing nlink > 1 would buy nothing and would refuse legitimate files (Baron, NIT).

- Deliberately NOT done (review 7): a "Downloading <name>" sentence at the click for the Mac and iOS apps, where
  the download does nothing until #5167. In a browser the browser's own download is the feedback, and in those
  apps the sentence would be false; a wrong sentence is worse than none, and #5167 is the fix.

## Not covered, filed separately
- The iOS app has the same gap as the Mac app below (review 5): ios/Kosmos/ContentView.swift loads the board from a
  Kosmos+ address in a WKWebView with no download handling, so a tap most likely does nothing (no worse than before,
  when it opened on the host). Added to #5167.
- The Mac app in connect mode loads the board from a Kosmos+ address, so kplusRemote() is true there too, and its
  WKWebView has no download handling (native-app/main.swift: no WKDownload, no .download policy). A download link
  there most likely does nothing. #4930's attachment Download has the same gap. It is Swift and needs an app build,
  so it has its own card (#5167) rather than riding this day-one web fix.

## Not tested, stated so it is not read as covered
- A real Safari or iPhone over a live relay: Playwright WebKit with a stubbed route is the nearest arm.
- A cancelled download closing the descriptor (pipeline's documented behaviour, not exercised).
- A file that shrinks between the fstat and the read (the reset path), and a file swapped between the gates and
  the open (the identity refusal): both need a seam between two async steps to test, and neither has one.
- The identity check on a Windows mapped or network drive.
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
