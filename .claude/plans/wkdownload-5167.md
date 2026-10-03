# wkdownload-5167: the macOS app saves a download the page asks for

Card: joshualeestone/kosmos#5167 (found by the blind review of #5165).

## Current behaviour (what holds now; the round sections below are history)
- Saved: a download (`<a download>`, a board attachment, a board file the window cannot show, a
  same-origin redirect) only while the committed page is a board (`isBoardPage`: a Kosmos+ computer
  whose name is not one the coordinator reserves (`kosmosPlusReservedLabels`, a copy of kosmos-relay
  RESERVED_NAMES, 45 names), or the board this app loaded) and the file is from its origin.
- Refused and said: a download from a page that is not the board (any mode), an attachment or an
  unshowable file from anywhere else (these, and a download WebKit stops, are not said while one is on screen or for 5 seconds after it is dismissed), a non-2xx answer, a failed save (these always).
- Asked first: a Kosmos+ computer's page saves only after the person allows downloads from that
  computer (once per run of the app, either answer). This computer's own board is never asked.
- Destination: ~/Downloads, safe unique name; quarantine mark with this app's agent name and no
  addresses; a file that
  cannot be marked is kept and the person is told.
- Measured live: `--kosmos-app-download-selftest`, 22 rows, run at bundle build (loud skip without
  a console). Pure rules: `--kosmos-app-mode-selftest`, 82 rows.
- Known and filed: on a computer that runs agents, a plain link or a refused cross-origin redirect
  still navigates the window (#5169).

## Problem
In connect mode the macOS app's WKWebView loads a board over Kosmos+, where the page hands files over
as downloads: #4930's attachment links (`<a href=/api/attachment/.. download>`) and, with #5165,
every file click in the Files lists (`kplusDownload`, a synchronously clicked `<a download>`).
native-app/main.swift had no download handling, so WebKit saved nothing and the click did nothing.

## Decision
- Action policy: `navigationAction.shouldPerformDownload` is decided first, on every computer mode
  (see "Current behaviour" for what is saved and what is refused).
- Response policy: see the review round changes below (board, same-origin attachment or
  unshowable file is saved; a foreign attachment is refused and said; otherwise shown if WebKit can
  show it, cancelled if not).
- `WKDownloadDelegate` on AppDelegate: destination is ~/Downloads via `downloadDestination`
  (separators and colon to `-`, control chars to space, leading dots stripped, empty/`..` to
  "Download", 200-byte cap keeping the extension, " (2)" numbering, UUID fallback after 10000;
  never an existing file). Finish bounces the Dock Downloads stack
  (`com.apple.DownloadFileFinished`); a failure is said to the person (see "Current behaviour").

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

## Review round 4 changes
- A board page on this computer is the board this app loaded (`badgeOrigin`, host and port), not
  any loopback server; a connect computer has none, only Kosmos+ computers.
- A non-2xx answer is not saved (an error page under the file's name looked like success).
- If the quarantine mark cannot be set, the file is removed and the person is told.
- Every refusal before a destination is marked said, so its cancel does not say it again; a
  cancel WebKit made on its own with no destination is said as "pointed somewhere Kosmos does not
  save from".
- Invisible characters (U+200B..U+200F, U+2060..U+2069, U+FEFF) are dropped from names.
- The live selftest counts its rows (11) and moved above the #1032 comment block it was splitting.
- Not changed: a release cut on a box with no console skips this gate loudly (stderr), the same
  bargain as the #1032 file-picker gate; the cut machines own a console.

## Review round 5 changes
- On a computer that runs agents, a download this app will not save is cancelled and said, not
  loaded in the window; an attachment from anywhere but the board is refused the same way (the board
  stays in the window; measured, and sabotage turns the row red).
- The quarantine record keeps origins only: the page address carries the board token.
- Switching to connect clears `badgeOrigin`.
- Build gate: a short selftest run is the gate's fault, not a product verdict.
- Measured: WebKit ignores `download` on a link to another origin, so that link is a plain
  navigation; with the redirect case, a run computer's window still loads it. Pre-existing for every
  link, filed as #5169, not changed here.

## Review round 6 changes
- A board file the window cannot show (a plain link to a .zip) is saved, as Safari does, instead of
  cancelled with nothing said. Not from the board, it is still cancelled (logged).
- A file whose quarantine mark cannot be set is KEPT and the person is told it is unmarked (Safari
  keeps such a file; deleting it would make downloads never work on a disk without the mark).
- The attachment token is read up to the first `;`, without dropping an empty leading piece.
- Not changed: in connect mode a cross-origin `<a download>` keeps the connect link policy (it opens
  in the browser, or on the other Kosmos+ computer), which is visible, not silent. (Round 8: a
  same-origin one on a non-board Kosmos+ page is now refused and said in every mode.)

## Review round 7 changes
- Kosmos+'s own sites (login, community, www) are not board pages. Every other Kosmos+ computer is:
  the tunnel only forwards for devices admitted to the person's own account (kosmos-relay
  crates/tunnel), so the computers this window can reach are the person's own. Reasoned, not
  measured; would change my mind: a Kosmos+ page reachable without admission.
- The unmarked-file message has its own title (it was saved).
- Live selftest: a page that is not the board (localhost) asking for its own same-origin download is
  refused, said, and stays (sabotage: board check removed turns 3 rows red); the board's real
  `filename*=UTF-8''` header is measured with a non-ASCII name. 15 rows.
- -999 is read only in NSURLErrorDomain; more invisible characters dropped; the selftest does not
  bounce the build box's Dock.
- Not changed: the redirect-then-navigate case (#5169).

## Review round 8 changes
- A download this app will not save is refused and said in every mode (on a connect computer a
  same-origin one on a non-board Kosmos+ page used to load in the window).
- The cross-origin-link row's label says what it proves (WebKit makes it a plain link).
- "Current behaviour" summary added at the top of this plan.

## Review round 9 changes
- WebKit marks every download itself (measured: its agent `com.apple.WebKit.Networking`), so the live
  row now reads THIS app's mark (agent `Kosmos`); sabotage (setResourceValues removed) turns it red.
  The "unmarked" alert is said only when the file carries no mark at all.
- Refusals are said at most once in 5 seconds (`downloadQuietSeconds`), the rest logged; live burst
  arm: three refusals, one said (sabotage: window off gives 6 said).
- Only main-frame responses can save or refuse; a frame loading cannot.
- Not changed: every Kosmos+ computer except its service sites counts as a board. The tunnel
  resolves the person's session before anything (kosmos-relay crates/tunnel/src/proxy.rs module doc,
  step 2: "No session, no board"), so another account's computer serves its gate page, not its board.
  Reasoned from source; an allowlist of the person's own computers would remove the premise.

## Review round 10 changes
- The quiet window applies only to the policy refusals (three since round 12); a failure of a download the app took on
  (save failed, unmarked, 404, no Downloads folder) is always said.
- A download asked for by a frame inside the page is cancelled and logged, never a sheet.
- The refusal names its cause: the page is not a board, or the file is not from this board.
- `committedPageURL` is cleared on the switch to connect and when the page process ends.
- "Not loaded in the window" is measured for the arms the live selftest drives (a not-the-board
  page's download, a foreign attachment); the plain link and the redirect-then-navigate case are
  #5169.
- Not changed: the local board check compares host and port, not scheme (the board is served over
  http; https on that port would be a different server, which cannot hold the board's port).

## Review round 11 changes
- A run where nothing saves is now judged, not timed out: file waits 5s, watchdog 150s, gate alarm
  180s. Measured with every save sabotaged: 9 rows FAIL with a product verdict in 81s.
- The Dock bounce is no longer skipped when only WebKit's mark is on a file.
- The selftest's server binds 127.0.0.1 explicitly.
- Stated: a CLICK on `<a download>` inside a same-origin frame on a board page does save (the action
  check is the page's, not the frame's); only a frame's LOAD cannot. The board's previews are served
  sandboxed (server.js content-security-policy), so no board frame runs script today.

## Review round 12 changes
- A file from another origin the window cannot show (a foreign .zip) is refused and said (quiet), not
  cancelled silently; the board stays. Live row added.
- Measured: a frame loading an attachment (board origin or another) saves nothing. Live row added.
- The no-destination cancel says "stopped before it began" (it was measured for the redirect, but
  any early cancel lands there, so no cause is claimed).
- The quiet window is one for all policy refusals, not one per cause (said in its comment).
- Not changed: the Kosmos+ service-host denylist (see round 9).
- Live selftest: 17 rows.

## Review round 13 changes
- Kosmos+ service sites: the hand list (login, community, www) is replaced by a copy of the
  coordinator's RESERVED_NAMES (45 names, diffed IDENTICAL against kosmos-relay origin/main c91521c1,
  with a control that a missing name is caught). It caught `coordinator.kosmosplus.com`, a live alias
  of sign-in. A test pins the count, so a change to the copy is seen. Residual: a computer that held a
  name before it was reserved keeps it, and its downloads are refused (said).
- Response refusals name the cause (not-a-board page vs a file from elsewhere), like the action's.
- The quarantine origin is the page the download came from (captured at its destination), not the
  page on screen when it ends.
- Selftest budget comment corrected; the temporary folder is removed on a timeout.

## Review round 14 changes
- Comments: the reserved-name copy says grandfathered holders are refused too; badgeOrigin's
  declaration says it is also the board downloads are saved from; isBoardPage has its own doc.
- A test pins every place badgeOrigin is set (four), so a badge change that moves it is seen.
- Not changed: a navigation that leaves the board and redirects back to a board attachment is judged
  on its final response URL. The file saved is the board's own, from the board's origin, and marked;
  nothing foreign reaches the disk.

## Review round 15 changes
- Names: leading dots and spaces are stripped until the name stops changing (". .zshrc" was
  ".zshrc", ". ." was "." the Downloads folder itself); two rows added (81).
- The no-destination cancel says "Kosmos did not save that file to Downloads." (true even when the
  window then shows the file, #5169) and is quiet, so one click cannot put up two sheets.
- The quiet window: nothing quiet is said while a refusal sheet is up, and the 5 seconds start when
  the person dismisses it (it started when the sheet appeared, so a quick dismiss left the next
  click silent).
- Wording: a non-2xx says "the answer was N" (over Kosmos+ the relay may answer, not the board).

## Review round 16 changes
- A refused download with no target frame (a new window) is said; only a frame inside the page stays
  silent (logged).
- Every early exit of the live selftest removes its temporary folder.
- Measured 2026-10-03 on macOS 26.7.1, WebKit 21624.5.1.11.3: a passing live selftest takes 25s
  (adds that to a cut on a console box); a run where nothing saves 81s (106s after round 18). The WebKit behaviours this
  plan cites as measured (download ignored on a cross-origin link, a cross-origin download redirect
  cancelled before the delegate) are as of that version.
- Not changed: the reserved-name copy is checked by count in this repo, not against kosmos-relay
  (no cross-repo check runs here); a skipped no-console run is said on stderr only (rounds 4, 7).

## Review round 17 changes (BLOCKER)
- The premise of rounds 7 and 9 was false: whoever holds a Kosmos+ name runs that name's tunnel
  client (the gate runs on the computer that holds the name, and kosmos-relay's README documents pointing it at your own
  relay), so a hostile holder serves any page under its name. That was the condition this plan said
  would change my mind. Now a Kosmos+ computer's page saves only after the person allows downloads
  from that computer, as Safari asks per site: Allow is kept (UserDefaults, per host), Don't Allow
  holds for this run, one question at a time per host. The loopback board is never asked.
- Live rows (driven directly, a throwaway defaults suite): own board not asked; a Kosmos+ computer
  asked once and a refusal holds; Allow kept for that computer only. Sabotage (always allow) turns
  two rows red.
- No page committed yet: an unshowable response is the app's own load, not reported as a file.
- Comments: the WebKit-cancel case is quiet; only blob:/data: reach the not-from-this-board refusal
  on a board page. The reserved-name test says what it checks (count and eight names).
- Rejected: requiring a user gesture (#5165's own download is a script click) and trusting only a
  computer reached from sign-in (reasoned from the open= intent, not measured).

## Review round 18 changes
- Allow is no longer kept past this run of the app (it was kept per host in UserDefaults): a Kosmos+
  name can pass to another account, which would have inherited the Allow, and two questions in a row
  could drop one Allow (a stale copy of the list). Cost: one question per computer per run.
- The question is driven through a real click (a selftest-only seam treats the probe page as a
  Kosmos+ computer): Don't Allow saves nothing, Allow saves. Sabotage (action path skips the
  question) turns it red. 21 live rows.
- The redirect hook's comment says it is a backstop (WebKit stops a cross-origin download redirect
  first, measured), live only for same-origin redirects.

## Review round 19 changes
- After Don't Allow, a later download from that computer in the same run is said (quietly): "not
  allowed, Kosmos asks again the next time it opens", instead of doing nothing.
- A refusal's sheet is titled "Kosmos did not save that file"; a failure keeps "could not".
- A name is taken if anything is at that path, a dangling symlink included (attributesOfItem, not
  fileExists, which follows links).
- Re-measured with every save sabotaged: 106s (the run grew in round 18). Watchdog 200s, gate alarm
  240s. A passing run: about 28s.
- Not measured: the quiet window with real sheets (start-on-dismiss); the burst row runs through the
  selftest presenter, which starts the window when said. The sheet path is pinned from source only.

## Review round 20 changes
- A 204 or 205 response is let through (WebKit leaves the page), never reported as a file; a live
  arm clicks one and the told count stays the same.
- The "sheet is up" mark expires after 60s, so a sheet whose dismissal never arrives cannot silence
  refusals for the rest of the run.
- The selftest presenter receives the title; a row checks a failure says "could not" and a refusal
  "did not" (sabotage: one title for both turns it red). 22 live rows.

## Review round 21 changes
- The per-computer question is a modal alert, not a sheet: every download from that computer waits
  on it, and a sheet over a sheet can be dropped (#2807), which would leave them waiting for good.
- Every download sheet (not only refusals) holds back the quiet ones, so a refusal cannot queue
  behind a failure sheet.
- A 204/205 is checked before the attachment branch (an empty 204 sent as an attachment is not
  saved; live row). The early-stop says "It stopped before it began." (it repeated its title).
- C1 controls in a name become spaces (82 pure rows); the selftest comment names the mode it runs in.

## Review round 22 changes
- Every download alert is modal (runModal), not a sheet: a sheet over another sheet can be dropped
  (#2807), and a failure must be said. The "alert up" mark is set before and cleared after it.
- Not changed: Don't Allow lasts the run and is said on each later click (round 19); connect mode is
  not driven live (weakest premise below).

## Review round 23 changes
- Return answers Don't Allow on the per-computer question (the page decides when it appears, so a
  keypress meant for the composer must never grant it); Allow needs a click.
- The question sets the "alert up" mark, so no quiet refusal opens over it.
- committedPageURL is read from the back-forward list's current item (moves only at a commit), not
  webView.url (which can already name a pending load).
- In-flight names are compared case-insensitively (Downloads is case-insensitive by default).
- Policy comments say a Kosmos+ computer's save waits for the person's Allow.

## Review round 24 changes
- The "alert up" mark is a count, not one timestamp: an alert opened inside another's modal loop
  (runModal keeps serving the main queue) no longer clears it while the outer one is still up. With
  every download alert modal, the 60s staleness guard is gone.
- The action comment no longer claims a no-target (new window) download is said: `target=_blank`
  never reaches this policy (createWebViewWith returns nil and opens it in the browser; existing
  behaviour, not changed here).
- Not changed (decided earlier): no user-gesture rule (round 2), Don't Allow lasts the run (rounds
  19, 22), one quiet window for all causes (round 12), the no-console skip (round 4).

## Review round 25 changes
- Measured (by the reviewer, LaunchServices' quarantine events, read only): the source and page
  addresses this app set on the mark never landed; only the agent name did. So the mark now carries
  no addresses at all (the token risk they were trimmed for goes with them), and rounds 3 and 13's
  "origin-only URLs" claims are withdrawn. The page bookkeeping that fed them is removed.
- Allow is disabled for the first second of the per-computer question: the page decides when it
  appears, so it can time it to meet a click (Return already answers Don't Allow).
- The attachment refusal is not said before a page is committed (the app's own load).
- Test titles and the selftest budget comment corrected; the gate's fallback names a missing
  listener.

## Review round 26 changes
- The "already said" record is a weak hash table of downloads, not a set of object identifiers: an
  entry goes with its download, so a later download allocated at the same address cannot inherit it
  and have its real failure swallowed.
- Not changed: a refused response's cancel (WebKit 102) reaching the reload recovery on a run
  computer. A reload or the board's own load navigates to the board page, never to an attachment or
  an unshowable file, so a refusal cannot be the cancel those paths see. The one quiet window for
  all causes (round 12) and the reserved-name copy's drift (round 16) stand.

## Review round 27 changes
- A failure of an accepted download that arrives while a download alert is up is counted and
  logged, not opened as another modal: a page looping failing downloads (the board, or a Kosmos+
  computer the person allowed) cannot stack alerts the person cannot get out of. The count is said
  as one alert ("N more downloads could not be saved") the quiet window's length after the open one
  is dismissed. Pinned from source only: the selftest's presenter never holds an alert open.
- The per-computer answer applies only if the page that asked is still on screen (a switch to
  connect clears it).
- "The probe page never loaded" is its own gate arm and says it can be this app's response policy
  (every page load passes it), not only the gate.
- Noted: each selftest run adds about 7 rows (agent "Kosmos", no addresses) to the build machine's
  LaunchServices quarantine history. Accepted: nothing sensitive, and it is what a real download does.

## Weakest premise
Measured in a real WKWebView on this computer, served over plain HTTP on 127.0.0.1. Not measured over a
live Kosmos+ tunnel in connect mode; the delegate path is the same, but the tunnel's own headers
(Content-Disposition passthrough) are reasoned, not observed.

## Tests (current)
- Pure functions: `--kosmos-app-mode-selftest`, 82 rows in all (the #5167 ones: same-origin, board
  page, destination name).
- Live: 22 rows in `--kosmos-app-download-selftest` (real WKWebView, loopback HTTP server, polled
  waits, a last-click sentinel), wired into tools/build-kosmos-bundle.sh.
- Wiring: `native-app.download-5167.test.js`.
