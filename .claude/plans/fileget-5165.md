# fileget-5165: over Kosmos+, a file click downloads to the device you are on

Card: joshualeestone/kosmos#5165 (a Kosmos+ user, via Josh 12:33; Splinter: day-one, can ride 0.7.22).

## Decisions
- The page decides, with the predicate #4930 already uses: `kplusRemote()` (reached by any name other than
  127.0.0.1 / localhost / ::1). At the computer nothing changes.
- File clicks over Kosmos+ (project rail, Documents view, a cited file in the thread, an agent's Files) become a
  download: an `<a download>` to a new GET route, the way an attachment card is (#4930).
- New routes: `GET /api/project/:id/download?name=` and `GET /api/agent/:name/files/download?name=`. Both pass
  `projects.fileInFolder`, the gates `openFile` used (moved out of it, so open and download share ONE copy), and
  stream the file as `application/octet-stream`, `content-disposition: attachment`, nosniff, sandbox CSP, no-store.
- Folder buttons over Kosmos+ (project folder from Documents and settings, an agent's Files folder, the two
  conversations folders, the Kosmos folder from Settings and the update offer) ask the board for nothing and say
  "That folder is on the computer Kosmos runs on, not on this device, so it opens only there."
  Rejected: zipping a folder for download (new, large, and not asked for); hiding the buttons (a button that
  vanishes over Kosmos+ is a second layout to keep right; the sentence says why).
- Not changed: the attachment preview's reveal (already Download over Kosmos+, #4930); the sleep and accessibility
  settings buttons (setup steps at the computer, not files).
- No cross-site check on the GET routes, matching `/api/attachment/:id`: `crossSiteRead`'s referer arm only knows
  loopback and AGENT_WORKFORCE_ALLOWED_HOSTS, so it would refuse the very page this is for.

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
