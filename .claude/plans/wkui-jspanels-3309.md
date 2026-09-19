# Plan: Mac app implements the board's JS alert/confirm/prompt dialogs (#3309)

## Context

The Mac app's WKWebView (native-app/main.swift) already conforms to WKUIDelegate and wires
`web.uiDelegate` + a file-open panel, but it does NOT implement the three
`runJavaScript{Alert,Confirm,TextInput}Panel` methods. A WKWebView does not draw JS dialogs
itself; it asks the host through those methods, and with them unimplemented WebKit's default is
to dismiss the request with no UI: `alert()` shows nothing, `confirm()` returns false, `prompt()`
returns nil. Found cross-machine by the Windows box (Homer) building the Mac/Windows parity
checklist. So the card's "missing WKUIDelegate" is imprecise (the delegate exists and handles
file panels); the real gap is the three JS-panel methods.

## Change

`native-app/main.swift`:
- Add the three `runJavaScript{Alert,Confirm,TextInput}Panel` WKUIDelegate methods. Each presents
  a synchronous app-modal `NSAlert.runModal()` (which ALWAYS returns, so it always calls its
  completion exactly once - WebKit's CompletionHandlerCallChecker aborts the app otherwise) and
  answers the completion: alert -> (); confirm -> OK==true / Cancel==false; prompt -> field text on
  OK, nil on Cancel. NOT beginSheetModal, which #2807 showed can be silently dropped (then the
  completion never fires and the app aborts). A call-once `respond` wrapper is belt-and-braces.
- Add three presenter-stub statics (jsAlert/Confirm/PromptPresenter), nil in every shipped run,
  mirroring `openPanelPresenter`, so a build gate can drive the delegates headless without a modal.
- Add a `--kosmos-app-jspanels-selftest` in-process harness: builds a WKWebView, swaps in the
  presenter stubs (confirm -> true, prompt -> "typed"), loads a probe page that calls all three
  dialogs, and asserts each delegate fired AND the page observed the scripted return values.

`tools/build-kosmos-bundle.sh`:
- Add a #3309 gate mirroring the #1032 file-picker gate: console-session-guarded (a WKWebView needs
  a window server; SKIP loudly on a headless box), run the self-test, and require every arm in the
  output (verdict-is-the-output, not the exit status), with a TIMED-OUT arm tested first.

## Blast-radius audit (the card's second ask)

Measured: the board (web/, all files) makes ZERO native `confirm()`/`alert()`/`prompt()` calls. Its
"are you sure?" flows use a CUSTOM in-DOM modal (`kConfirm` / `showConfirm`, e.g. the restart
confirm), which works regardless of WKUIDelegate. So there is no CURRENT board flow the missing
delegate broke - the "silently does nothing today" consequence is LATENT, not live. The fix is
therefore PARITY (Windows shows these; Mac should too) + PREVENTIVE (covers any future board code
that uses a native dialog, and any embedded/third-party content in the WebView). Correct and worth
having - the Windows box flagged the parity gap explicitly - but not fixing a today-broken flow.

## Verification

- `swiftc -target arm64-apple-macos<floor> -O native-app/main.swift` compiles clean (no warnings).
- The built binary run with `--kosmos-app-jspanels-selftest` prints, and exits 0:
  `uiDelegate:set`, `delegate-fired:{alert,confirm,prompt}:yes`, `return-value:confirm-true:yes`,
  `return-value:prompt-typed:yes`. So all three delegates fire and the return values round-trip -
  real runtime verification, not just compile.

## Weakest premise / limit

Unlike the #1032 gate, this self-test has no "put the real presenter back and see a panel on
screen" arm. The production path is `NSAlert.runModal()`, a synchronous nested modal loop: once
entered it blocks the main thread, so a headless gate cannot drive-then-dismiss it the way the
async `NSOpenPanel.begin` path allowed, and a build box has no window server to present into. So
the self-test proves WIRING + RETURN-VALUE round-trip (the exact regression), and the real NSAlert
is standard AppKit exercised the first time a person hits a native dialog. If that residual matters,
a follow-up could add a manual/console-only arm. It does not affect the fix's correctness.
