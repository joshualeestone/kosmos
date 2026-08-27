# filepicker-1032: the + button opens a file picker (kosmos#1032)

## Why

Josh, 2026-08-26 22:08 CDT: *"the plus button in the dialog box for projects doesn't
allow me to select a file to upload"*, and at 22:11, after being given a discriminator:
*"it's not working for the agent dialog box or for the project dialog box input +. Now
I can drag and drop an image in there and then submit/send it and it works but I just
can't hit the + button to get it to spawn the file selector"*.

## What was actually wrong

**A WKWebView does not open a file picker itself.** It asks the host app, through
`WKUIDelegate.webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:)`.
`native-app/main.swift` set `webView.navigationDelegate` and never set
`webView.uiDelegate`, and did not implement that method. So the click reached the
page, the page asked the app, and there was no receiver. No error, no console line,
no visible change.

That single cause explains every piece of evidence:

- **Both dialogs fail identically** because they share the app, not a stylesheet.
- **Drag-and-drop still works** because a drop delivers files through the DOM and
  never asks the host for a panel.
- **The console is clean** because nothing threw.
- **Every automated check passes** because they all run the page in a browser, where
  the picker belongs to the browser. The open-panel handshake only exists when a page
  is hosted by an app.

## The theory this replaces, and why it is recorded here rather than dropped

Two independent readings (Mona Lisa, Splinter) concluded that the five file inputs
carry a bare `hidden` attribute under `web/index.html:354`
`[hidden] { display: none !important; }`, and that WebKit refuses a picker for an
unrendered input. Both said plainly that nobody had run it.

**It is false, and it was measured twice:**

| engine | `hidden` + display:none | plainly visible |
|---|---|---|
| Playwright WebKit | picker opens | picker opens |
| a real WKWebView on this Mac | app is asked | app is asked |

Recorded because it is a plausible, well-argued theory that would have sent someone
to rewrite five inputs and change nothing. The release gate below keeps the `hidden`
row permanently so the next reader who reaches for it is answered by a measurement.

## Scope

1. `AppDelegate` conforms to `WKUIDelegate` and implements `runOpenPanelWith`,
   presenting an `NSOpenPanel` sheeted on the window the click came from, honouring
   `allowsMultipleSelection` and `allowsDirectories`, and **answering the completion
   handler on cancel** (an unanswered handler wedges the input for the session, so a
   cancelled pick would break the NEXT press).
2. `AppDelegate.makeWebView(frame:delegate:)`, both delegates assigned in one place,
   so a webView can never again be built with one wired and the other forgotten.
3. `AppDelegate.openPanelPresenter`, a nil-in-production seam so the gate can prove
   the delegate fires without a modal panel on a build machine.
4. `--kosmos-app-filepanel-selftest`, **five arms, not three**: `uiDelegate:set`;
   a press on a `hidden` input; a press on a visible one; a press **with the real
   presenter restored** requiring a *visible* `NSOpenPanel`; and **a press AFTER
   that panel is cancelled**, which is the one that proves the completion handler
   was answered. Waits for the probe page rather than sleeping at it, because a
   fixed delay on a busy build box accuses a good binary. Window offscreen so a
   release cut does not flash one, and the hatch `exit()`s like its four siblings
   rather than falling through into the real app.
5. A re-entrancy guard on `runOpenPanelWith`. A second request while a panel is
   up is answered `nil` immediately: measured on macOS 26, a second
   `beginSheetModal` on a window that already has a sheet is silently dropped and
   its handler is never called, and an unanswered handler terminates the app.
6. `tools.filepanel-gate.test.js` tests the bundle gate's verdict logic against
   the real output shapes. It exists because the first version tested the product
   arm before the timeout arm, and the hatch prints `uiDelegate:` first, so a
   genuine hang was reported as "the + button will do nothing". A dead branch that
   reads as a live guard is worse than no branch.
7. `tools/build-kosmos-bundle.sh` runs it beside the menu gate.

## Out of scope

- The five `hidden` file inputs in `web/index.html`. They are not the cause, and
  changing them would be a change with no effect made in the belief it was the fix.
- kosmos#975 "Change Picture does nothing". Very likely the same cause (`#you-file`
  goes through the same missing delegate) but it is a separate report and wants its
  own press before anyone closes it.
- The rest of `WKUIDelegate` (JS alert/confirm/prompt, `createWebViewWith` for
  `target=_blank`). The app has never had any of it; whether anything else in the
  product silently depends on it is a real question and a separate one.

## What finished looks like

Pressing + in either dialog on a real Mac opens a file picker, and a build in which
that is untrue cannot be published.

## Verification (done when)

1. `--kosmos-app-filepanel-selftest` exits 0 on the fixed binary. **MEASURED:**
   `uiDelegate:set`, both presses `asked-for-panel:yes`, `panel-on-screen:yes`.
2. **NEGATIVE CONTROL, run not assumed:** the same gate against a binary with
   `web.uiDelegate = delegate` removed exits 1 and reproduces Josh's symptom
   (`asked-for-panel:no` on both). **MEASURED.**
3. The gate skips loudly, never fails, on a machine with no console session.
4. Full suite green; challenge-loop to convergence; PR per house flow.
5. ⚠️ **A person presses the real + button in the shipped bundle.** The gate presses a
   real button in a real webView and a real panel appears, which is as far as a
   machine goes; it does not prove the page's own wiring behind `#pj-attach-file` and
   `#d-attach-file` is right, because the gate loads its own page. That last step is
   Josh's, and it stays written here until someone has done it.
