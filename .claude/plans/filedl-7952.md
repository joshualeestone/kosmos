# filedl-7952: downloads from another computer's board (kosmos#7952)

Josh, 11-04 10:10 CST: on a remote board an agent's Files screen offered only Download folder; then the folder
download failed with 403 ("the answer was 403"). Splinter: fix the 403 first.

## 1. The 403 (Mac app)
Cause, measured: a download the Mac app's `.download` policy makes carries no Sec-Fetch-* headers (WKWebView harness,
http and https; the page load does carry them). The Kosmos+ tunnel presents the board's token only for Sec-Fetch-Site
same-origin or none (kosmos-relay board_token_allowed, fail closed). A board request with no token is 403 (measured
with curl). So every download over Kosmos+ from the Mac app reached the board with no token.

Fix (review 4: on a Kosmos+ computer's page only; this computer's own board keeps WebKit's download, as before):
a board download the person allowed AND that the board page's own main frame asked for, at its own origin
(downloadAskedByPage), is cancelled from WebKit's `.download` and started by the app (startDownload) marked
`Sec-Fetch-Site: same-origin` (sameOriginDownloadRequest). Measured: WebKit keeps that header, the Referer and the
cookie on startDownload, and starts nothing from inside its own policy callback (so it starts on the next turn).
A frame inside the page (another site's, a sandboxed preview, or a board-origin frame) keeps WebKit's own unmarked
download. Splinter's rule: the app marks only downloads the board page started, never a URL a page hands it.

Consequences handled:
- such a download carries no `download` name from the page, so a web page answered for it counts as the file only
  when sent as an attachment (downloadsStartedHere); every board file route sends an attachment name, so no saved
  name changes;
- review 3/4: a refusal (401, 403) of a download the app started is always said by the app, even on a Files list (a
  double with the page's line remains when both are refused, accepted): the page's
  look is a fetch, which the tunnel can let in where it does not let the download in, so the look may say nothing.
  Without that, the weakest premise below failing would turn Josh's "the answer was 403" into silence;
- Download folder's refusals stay the app's to say, as on main (review 3 undid a review 1 change that left a busy
  answer after the Allow question unsaid); a folder that is busy (the board's ZIP_BUSY, on the folder route only) is said in its own words;
- review 2: an allowed download whose page commits before its start on the next turn is not started, and said.

Rejected: changing the tunnel's fail-closed rule (right for browsers; a relay release); fetching into a blob (whole
folder zips in memory, and the app refuses blob downloads by design).
Weakest premise: Josh's desktop WebKit sends downloads as this Mac's does; his own request was not seen (no log on
either side records it).

## 2. A download button per file (web)
On the Files screen (View All) of a board reached through Kosmos+ (or a Linux board), each file row has a download
button at its right (agentFileWithDownload); it downloads even a picture, PDF or text file the row itself previews.
Folder rows have none; at the computer itself nothing changes. Not on the narrow Files panel, where a click on any file
that is not previewed already downloads (kept small on purpose).

## 3. The Allow wording (Mac app)
"Neither answer is permanent: each lasts until you quit Kosmos, and after Don't Allow, View > Reload asks you again."

## Tests
- mode selftest +12 rows (226), live download selftest +3 rows (35, the loopback page standing in for a Kosmos+
  computer's through markBoardDownloadsForSelftest): the page's own download says same-origin, a
  frame's is never marked, a commit before the start voids it; each red under its mutation (header not set; page
  check forced true; the start's page check removed).
- native-app.download-5167.test.js: a source pin that the one startDownload sits after the page check, from the
  source frame.
- web.filebrowser-6724.test.js: the button over Kosmos+, none at the computer, the click handler order, rowKey.
- docs/browser-checks/render-file-dlbutton-7952.js (chromium and webkit): placement, the click downloads and opens no
  preview, CONTROL at 127.0.0.1; red against main's page.

Reaches Josh only in a Mac app release (the 403 is in the app, not the board).
