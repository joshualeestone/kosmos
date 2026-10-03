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
- Response policy: see "Review round 1 changes" (same-origin attachment only; otherwise
  `canShowMIMEType ? .allow : .cancel`).
- `WKDownloadDelegate` on AppDelegate: destination is ~/Downloads via `downloadDestination`
  (separators and colon to `-`, control chars to space, leading dots stripped, empty/`..` to
  "Download", 200-byte cap keeping the extension, " (2)" numbering, UUID fallback after 10000;
  never an existing file). Finish bounces the Dock Downloads stack
  (`com.apple.DownloadFileFinished`); failure is logged.

Rejected: asking where to save (an NSSavePanel per click). Safari's default is Downloads with no
prompt, and the page already tells the person the file went to their device.
Rejected: blob:/data: downloads. Nothing in the page builds one to download today.

## Review round 1 changes
- Response policy now requires the same origin as the COMMITTED page (`committedPageURL`, set in
  didCommit), and its default is WebKit's own (`canShowMIMEType ? .allow : .cancel`).
- A download's redirect to another origin is refused (`willPerformHTTPRedirection`).
- A saved file gets the quarantine mark (Gatekeeper checks it on open).
- `downloadDestination` no longer crashes on an extension of 200+ bytes.
- `--kosmos-app-download-selftest`: a real WKWebView with this delegate against a local HTTP server.
  7 rows, run at bundle build (skipped loudly without a console). Sabotage measured by hand
  2026-10-03 13:2x CDT on a scratch copy: (A) action check disabled -> 3 rows FAIL (same-origin
  download, quarantine, folder contents); (B) response origin check removed -> 2 rows FAIL (foreign
  attachment saved, folder contents).

## Review round 2 decisions
- No user-gesture requirement on a same-origin download. Rejected: the same origin IS the board, and a
  script running there already holds the board token and can do far more than save a file; #5165's
  own download is a script click, which a gesture rule would have to special-case. Would change my
  mind: the board ever serving agent- or attachment-authored HTML on its own origin.
- committedPageURL moves only on a main-frame commit, so during a navigation a download is judged
  against the page still on screen. Intended: a response for an in-flight foreign navigation must not
  be judged against its own origin.

## Review round 3 changes
- Downloads are saved only while the committed page is a board (`isBoardPage`: a Kosmos+ computer
  or loopback http), so a foreign site that ends up in the window cannot save its own files.
- Two same-named downloads at once get different names (in-flight destinations count as taken).
- A download that does not save is said to the person once (`tellDownloadFailed`, a sheet).
- Names lose bidi direction controls; the attachment token is matched exactly; the quarantine mark
  records the page as its origin.
- Measured: WebKit itself refuses a download's redirect to another origin before
  `willPerformHTTPRedirection` runs (sabotage: method removed, row still passes; the -999 cancel
  arrives at didFail with no destination). The method is live for same-origin redirects (sabotage:
  forced cancel turns "a same-origin redirect is followed and saved" red). It stays as defence.

## Weakest premise
Measured in a real WKWebView on this Mac, served over plain HTTP on 127.0.0.1. Not measured over a
live Kosmos+ tunnel in connect mode; the delegate path is the same, but the tunnel's own headers
(Content-Disposition passthrough) are reasoned, not observed.

## Tests
- Pure functions: 24 rows in `--kosmos-app-mode-selftest` (64 total).
- Live: 7 rows in `--kosmos-app-download-selftest`, wired into tools/build-kosmos-bundle.sh.
- Wiring: `native-app.download-5167.test.js`.
