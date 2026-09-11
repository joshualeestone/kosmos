# #2807: file-picker crash when the host window already has a sheet

Branch: `openpanel-crash-2807`
Card: kosmos#2807 (priority prod crash Josh hit on 0.6.56 changing a profile picture).

## The crash

SIGABRT from WebKit's `CompletionHandlerCallChecker`, raised **synchronously inside
`runOpenPanel`** at `_Block_release` (confirmed in Josh's crash report). WebKit requires the
`runOpenPanel` completion handler to be called EXACTLY once; it aborts the whole app on zero OR
multiple calls.

## Root cause

`native-app/main.swift`'s `WKUIDelegate` `webView(_:runOpenPanelWith:...)` calls
`panel.beginSheetModal(for: host)` whenever `host` is non-nil. But `beginSheetModal` is **silently
dropped** when the host window ALREADY HAS A SHEET (measured on macOS 26): the panel never presents,
the `answer` closure never fires, and at method-return the local `panel` + `answer` +
`completionHandler` are released **un-called**, so the checker raises and the app aborts. The
existing `openPanelOutstanding` re-entrant guard only covers a second OPEN PANEL, not a sheet from
any other source, so it does not close this path.

Pre-existing: the handler last changed 2026-08-26 and is byte-identical across 0.6.54/0.6.55/0.6.56,
so this is NOT a promote regression and a rollback would not fix it. Fix-forward via a new cut.

## The fix

1. **Guard the sheet presentation:** only `beginSheetModal(for: host)` when `host.attachedSheet ==
   nil`; otherwise (no window, OR the window already has a sheet) fall back to the app-modal
   `panel.begin`, which does not attach to the window and so always presents and always calls its
   completion. The common case (a sheet-free window) keeps the nicer attached sheet.
2. **Call-once wrapper (`respond`):** the handler is invoked exactly once on every path of this
   invocation (a repeat call is a no-op) -- WebKit aborts on multiple calls too. It clears the
   `openPanelOutstanding` flag THIS call set; the re-entrant-refusal path (which never owned the
   flag) is left untouched and still answers with a single direct `completionHandler(nil)`.

## Test

New `--kosmos-app-filepanel-selftest` arm (`press:with-a-sheet-up`): puts a sheet on the host, fires
the file input on the REAL panel path (presenter nil), and requires the app to survive AND a panel
to present via the `begin` fallback, with a setup-control that the sheet is actually attached (so
it cannot false-pass). Verified: fixed build passes all arms (RC=0); reverting only the delegate
guard makes the arm report `panel-presented:no` (RC=1), and the build's exit-code gate
(build-kosmos-bundle.sh:428) reds the cut if the fix is dropped.

## Ships via a new cut

Compiled native Swift, so the fix reaches users only in a new cut (0.6.57): build + cut to staging +
promote. The native selftest runs at cut time (the build gate); local verification was compile +
run the unsigned selftest + red-capability.
