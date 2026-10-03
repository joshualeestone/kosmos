# wkdownload-5167: the Mac app saves a download the page asks for

Card: joshualeestone/kosmos#5167 (found by the blind review of #5165).

## Problem
In connect mode the Mac app's WKWebView loads a board over Kosmos+, where the page hands files over
as downloads: #4930's attachment links (`<a href=/api/attachment/.. download>`) and, with #5165,
every file click in the Files lists (`kplusDownload`, a synchronously clicked `<a download>`).
native-app/main.swift had no download handling, so WebKit saved nothing and the click did nothing.

## Decision
- Action policy: `navigationAction.shouldPerformDownload` from the page's own origin
  (`isSameOriginDownload`: scheme, host, port with default ports, no user part) returns `.download`,
  on every computer mode, BEFORE the connect-only policy. A cross-origin download falls through to
  the policy it had.
- Response policy: `Content-Disposition: attachment` returns `.download`; everything else `.allow`
  (identical to having no such method).
- `WKDownloadDelegate` on AppDelegate: destination is ~/Downloads via `downloadDestination`
  (separators and colon to `-`, control chars to space, leading dots stripped, empty/`..` to
  "Download", 200-byte cap keeping the extension, " (2)" numbering, UUID fallback after 10000;
  never an existing file). Finish bounces the Dock Downloads stack
  (`com.apple.DownloadFileFinished`); failure is logged.

Rejected: asking where to save (an NSSavePanel per click). Safari's default is Downloads with no
prompt, and the page already tells the person the file went to their device.
Rejected: blob:/data: downloads. Nothing in the page builds one to download today.

## Weakest premise
Not measured on a running app in connect mode. A browser check cannot cover it (Playwright WebKit is
not this WKWebView with this delegate). Needs a run of the real app against a Kosmos+ board.

## Tests
- Pure functions: 22 new rows in `--kosmos-app-mode-selftest` (62 total), run at bundle build.
- Wiring: `native-app.download-5167.test.js` reads the delegate methods, pinned selectors, ordering
  before the connect guard; sabotage of the check and the conformance turns it red.
