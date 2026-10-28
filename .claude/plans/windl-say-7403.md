# #7403: the Windows app window says why a download was not saved (parity with the Mac's #7384)

**Posture:** production
**Branch:** `windl-say-7403` · **Card:** joshualeestone/kosmos#7403 · **Mac twin:** #7384 (#5167)

## Problem

Measured 2026-10-27 in the real `Kosmos.exe` window (installed 0.7.71, launcher identical to main), driven over
WebView2 remote debugging (`work\dlmeasure\` on the Windows box):

| Case | Before |
|---|---|
| 1. same-origin attachment | saved to Downloads, WebView2's panel |
| 2a. download link the board answers 404 | only WebView2's panel line "Couldn't download - No file" |
| 2c. plain navigation to a refused download (board answers 204, `refuseDownload`) | nothing at all |
| 3. unclicked cross-origin `download` link | nothing: `ConnectLink.Block` cancels it silently |

`KosmosLauncher.cs` never registered `DownloadStarting`, and `ConnectLink.Block` cancels with no word. The Mac says
"Kosmos did not save that file: <why>" for each (#7384).

## Design

All in `tools/windows/KosmosLauncher.cs`; decisions are pure statics on `KosmosLauncher`, the window only wires them.

1. **One guard, the Mac's.** `RefusalShouldShow(up, asking, lastAtMs, nowMs, windowMs, shownThisPage, perPage)` is
   `refusalShouldShow` rule for rule (asking is always false on Windows: there is no Allow question). `RefusalGate`
   holds its state (boxes up, last OK time, per-sentence count for the current page) so the probe can drive it with
   its own clock. Ten seconds after the last OK, two of one sentence per page; a page is a main-frame commit
   (`OnContentLoading` increments `pageCommits`, as the Mac's `pageCommits`). `TellRefusal` logs every refusal
   first, then asks the gate, then shows one `MessageBox.Show(this, ...)` (owned by the window, so modal to it) on
   the next turn via `BeginInvoke`; `finally` counts it down. Every box (download failures included) goes through the
   guard: a page retrying a failing download on a timer cannot stack modal boxes.
2. **(a) Downloads.** `ICoreWebView2_4.add_DownloadStarting`, reached by a cast (QueryInterface) in a try, so an old
   Runtime or a failure only loses the sentence. The handler only reads the operation and adds a `StateChanged`
   handler: it never cancels, handles or redirects, so a download goes exactly as before (WebView2's panel, saved to
   Downloads). On `INTERRUPTED`, `DownloadInterruptedSays(reason)` says the reason in plain words; USER_CANCELED,
   USER_SHUTDOWN, USER_PAUSED and NONE say nothing; every other value says something (unknown ones generically).
3. **(b) Refused links.** A `ConnectLink.Block` in `OnNavigationStarting` and in the connect `OnNewWindowRequested`
   path says `LinkBlockedSays(uri)`: "Kosmos did not open that link: this page tried to go to <host> on its own.
   Kosmos opens another site only when you click a link to it." (mail/phone/text and other schemes have their own
   words). The host is `IdnHost` (punycode), capped at 80 characters. Not said for a connect computer's refused first
   load, which already gets the Kosmos Plus unreachable box.
4. **(c) The 204 refusal.** MEASURED: WebView2 reports a 204 navigation as failed with WebErrorStatus
   CONNECTION_ABORTED (9) and HttpStatusCode 0 (not 204). A navigation that turned into a successful download is
   reported the same way, and its `DownloadStarting` arrives about 16 ms AFTER NavigationCompleted (measured). So
   `NoContentNavigationSays` picks a failed board (or Kosmos Plus computer) navigation to a board download route
   (`/api/agent/<n>/files/download`, `.../download-folder`, `/api/project/<id>/file-download`) with
   CONNECTION_ABORTED or 204, and `SayUnlessADownloadStarted` waits 1.5 s and says it only if no download of that
   address started (`DownloadCameOfNavigation`: from 2 s before the end to the end of the wait). Such a navigation is
   then not handed to the failed-board-load path (the board answered). The board's own `?check=1` path is unchanged:
   nothing on the board side changed at all.
5. **Logging.** The launcher keeps no log file, so every refusal goes to `OutputDebugStringW` ("Kosmos #7403: ..."),
   readable with DebugView. (`work\dlmeasure\dbwin.ps1` is a minimal reader.)

### COM interfaces added (WebView2.h from Microsoft.Web.WebView2 1.0.4191.47, build/native/include)

| Interface | GUID | Header lines | Declared slots |
|---|---|---|---|
| ICoreWebView2_4 | 20d02d59-... | ICoreWebView2 3019-3218 (58), _2 5318-5345 (7), _3 6130-6150 (5), _4 6891-6909 | all 70 inherited, then add_FrameCreated, remove_FrameCreated, add_DownloadStarting (73) |
| ICoreWebView2DownloadStartingEventHandler | efedc989-... | 7599-7607 | Invoke |
| ICoreWebView2DownloadStartingEventArgs | e99bbe21-... | 43885-43913 | get_DownloadOperation |
| ICoreWebView2DownloadOperation | 3d6b6cf2-... | 43345-43406 | first 15, through get_InterruptReason |
| ICoreWebView2StateChangedEventHandler | 81336594-... | 43799-43807 | Invoke(sender, IUnknown args) |
| ICoreWebView2NavigationCompletedEventArgs2 | fdf8b738-... | base 54616-54629, own 54722-54729 | the base's 3, then get_HttpStatusCode |

Enums: COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON 2524-2556 (USER_CANCELED = 26), COREWEBVIEW2_DOWNLOAD_STATE 2561-2563,
COREWEBVIEW2_WEB_ERROR_STATUS CONNECTION_ABORTED = 9 (2937).

## Rejected

- **A board change for 2c** (answer a refused navigation with a page saying why): it would replace the board page
  in a window with no Back button, and change what a browser sees. Rejected; the window detects it instead.
- **Reading the 204 from HttpStatusCode alone:** measured 0, not 204. Kept as a second signal for a Runtime that
  reports it.
- **Reading the board's reason** (WebResourceResponseReceived headers, or a `?check=1` fetch through ExecuteScript):
  more COM surface and a second request, for a sentence the generic one already covers. Possible follow-up.
- **Failures always shown, only refusals guarded (the Mac's split):** on Windows a modal box opened from
  `BeginInvoke` while another is up nests, so every box goes through the guard. The WebView2 panel still lists each
  failed download.
- **A log file for the launcher:** it deliberately keeps none; the debugger stream is the least new surface.

## Tests

- `tools.win-launcher-download-say-7403.test.js`: source checks of every new interface's GUID and slot order against
  the header's lists (with a swap control; a manual swap of get_State/get_InterruptReason was confirmed to fail it),
  the wiring (handler never cancels; registered before the first load in a try; both Block paths; 204 path waits for
  a download; log before guard; box owned by the window), no em dash; and a probe compiled beside the launcher,
  51 rows: the Mac's nine `refusalShouldShow` rows word for word (matched against main.swift), the gate over time
  with controls, every interrupt reason, link sentences (punycode, long host), the 204 decision with controls, the
  settle window with controls.
- `tools.win-launcher-native.test.js`: its WebView2 slot table now includes the six new interfaces.
- Real window (scratch `Kosmos.exe` from this branch, `--window`, live board on 16180, CDP on 9333, real clicks):
  case 1 saved, panel "3324-sleep-light.png, Open file", no box; 2a box "the file is not there"; 2c box "the board
  would not send it"; 3 box "this page tried to go to example.com on its own"; a successful download by navigation
  (the 2c control) saved with no box. Guard: a second refusal while a box is up, none; right after OK, none; after
  11 s, shown (second of that sentence); after another 11 s, none (third on the page); after a reload, shown again.
  Screenshots: `work\dlmeasure\f2a-win1.png`, `f2c-win1.png`, `f3-win1.png`, `f1-win1.png`, `n2a-win1.png`.

## Not covered

- A download from a connected Kosmos+ computer's board (this box has none); the code path is the same handler.
- Chromium's own "Download multiple files" prompt is unchanged.
- The 204 sentence cannot name the board's exact reason (gone, too big, busy, not allowed).
- A download Chromium interrupts that WebView2 can resume is still said as not saved (true at that moment).
- The last two source edits after the window measurement (an equivalent rewrite of the first-load condition and a
  comment) were not re-measured in the window; the tests cover both.
- `OutputDebugString` is not a log a person can send; the launcher has no log file.
