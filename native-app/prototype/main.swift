// Kosmos native app prototype (#677), phase 1: prove the AppKit lifecycle
// mechanics against a real running board, before touching the installer.
//
// NOT the shipped shape yet -- no install-time config, no signing. Run
// directly with `swiftc main.swift -o kosmos-app-prototype && ./kosmos-app-prototype`.
//
// KOSMOS_URL env var overrides the URL (default http://127.0.0.1:16180),
// matching the way the real launcher's KOSMOS_PORT works, so this can be
// pointed at a real running board on any port.

import Cocoa
import WebKit

// MARK: - The one lifecycle seam (Splinter's explicit design requirement:
// window-close, Cmd-Q, and Dock "Quit" all route through ONE place, so
// Josh's still-open answer on "does closing the window quit" is a config
// change here, not a rewrite touching multiple call sites).
enum QuitBehavior {
    // Provisional (Splinter, pending Josh, 25 Aug): stay running, hide the
    // window on close -- the Mail/Slack pattern. Agents keep working while
    // the window is shut, which is the whole point of the product.
    static let closingWindowQuits = false
}

// Logs to a file rather than relying on stdout, which `open -a` detaches
// from the launching shell (testing-only path; the real app has no need
// for this once it's driven by the installer rather than by hand).
let logFilePath = ProcessInfo.processInfo.environment["KOSMOS_APP_LOG"] ?? "/tmp/kosmos-app-test/app.log"
func logLine(_ s: String) {
    let line = s + "\n"
    if let data = line.data(using: .utf8) {
        if let fh = FileHandle(forWritingAtPath: logFilePath) {
            fh.seekToEndOfFile()
            fh.write(data)
            fh.closeFile()
        } else {
            FileManager.default.createFile(atPath: logFilePath, contents: data)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    private var isActuallyQuitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()
        buildWindow()
        loadBoard()
        NSApp.activate(ignoringOtherApps: true)
        installTestSignalHooks() // TEST-ONLY: see the function's own comment
    }

    // TEST-ONLY, prototype phase only, never in the shipped app: this
    // session has no Accessibility or Screen Recording permission granted,
    // so a real click/keystroke on the window's close button or Cmd-Q
    // cannot be simulated to verify the lifecycle. SIGUSR1/SIGUSR2 trigger
    // the EXACT SAME AppKit entry points a real click would
    // (window.performClose(nil) is what a click on the red button calls;
    // NSApp.terminate(nil) is what Cmd-Q calls) -- this is not a parallel
    // path being tested instead of the real one, it is the real one,
    // triggered a different way. Removed entirely before Phase 2.
    private func installTestSignalHooks() {
        signal(SIGUSR1, SIG_IGN)
        let closeSource = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
        closeSource.setEventHandler { [weak self] in
            logLine("TEST SIGNAL: simulating window close click (performClose)")
            self?.window.performClose(nil)
        }
        closeSource.resume()
        self.testCloseSource = closeSource

        signal(SIGUSR2, SIG_IGN)
        let quitSource = DispatchSource.makeSignalSource(signal: SIGUSR2, queue: .main)
        quitSource.setEventHandler {
            logLine("TEST SIGNAL: simulating Cmd-Q (NSApp.terminate)")
            NSApp.terminate(nil)
        }
        quitSource.resume()
        self.testQuitSource = quitSource
    }
    private var testCloseSource: DispatchSourceSignal?
    private var testQuitSource: DispatchSourceSignal?

    // MARK: Window

    private func buildWindow() {
        let contentRect = NSRect(x: 0, y: 0, width: 1200, height: 800)
        window = NSWindow(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Kosmos"
        window.center()
        window.delegate = self
        window.isReleasedWhenClosed = false // we hide, never dealloc, on close

        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: contentRect, configuration: config)
        webView.navigationDelegate = self
        window.contentView = webView

        window.makeKeyAndOrderFront(nil)
    }

    private func loadBoard() {
        let urlString = ProcessInfo.processInfo.environment["KOSMOS_URL"] ?? "http://127.0.0.1:16180"
        guard let url = URL(string: urlString) else {
            showStartupFailureAlert(detail: "The address \(urlString) is not a valid URL.")
            return
        }
        logLine("LOADING \(url.absoluteString)")
        webView.load(URLRequest(url: url))
    }

    private func showStartupFailureAlert(detail: String) {
        let alert = NSAlert()
        alert.messageText = "Kosmos could not start"
        alert.informativeText = "Something went wrong while Kosmos was starting. \(detail)"
        alert.alertStyle = .critical
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    // MARK: WKNavigationDelegate -- instrumentation only, proves the request
    // actually landed rather than inferring it from process/network state.

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("document.title") { result, _ in
            logLine("PAGE LOADED, document.title=\(result ?? "<nil>")")
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        logLine("PAGE LOAD FAILED: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        logLine("PROVISIONAL LOAD FAILED: \(error.localizedDescription)")
    }

    // MARK: Window-close vs. quit -- the one seam

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if QuitBehavior.closingWindowQuits {
            // Closing the window IS quitting in this mode: run the same
            // quit-confirmation path as Cmd-Q, don't just let it close.
            logLine("windowShouldClose: closingWindowQuits=true, routing to quit")
            NSApp.terminate(nil) // enters applicationShouldTerminate, the one seam
            return false // that call decides; never let AppKit close it directly
        }
        // Stay-running mode: hide, don't destroy. The board and every agent
        // are completely untouched -- this app has no say over them either
        // way, but the point of hiding rather than closing is that re-showing
        // the window later doesn't need to reload or re-authenticate anything.
        logLine("windowShouldClose: hiding (stay-running mode)")
        window.orderOut(nil)
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows {
            logLine("applicationShouldHandleReopen: re-showing hidden window")
            window.makeKeyAndOrderFront(nil)
        }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // Only relevant if AppKit itself ever closes the window without going
        // through windowShouldClose (it always goes through windowShouldClose
        // for a user-initiated close, so this is a backstop, not the main path).
        return QuitBehavior.closingWindowQuits
    }

    // MARK: Quit -- Cmd-Q, the app menu's Quit item, and Dock "Quit" all land here

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if isActuallyQuitting {
            logLine("applicationShouldTerminate: already confirmed, terminateNow")
            return .terminateNow
        }
        logLine("applicationShouldTerminate: showing quit dialog")
        // NSAlert.runModal() is synchronous, so this blocks the call and
        // returns the real decision directly -- no need for the async
        // reply(toApplicationShouldTerminate:) pattern, and (bug fixed while
        // adding this logging) NOT a second NSApp.terminate() call, which
        // would just re-enter this method rather than complete the
        // in-progress .terminateLater the AppKit docs describe for the
        // async path.
        return showQuitDialog() ? .terminateNow : .terminateCancel
    }

    // MARK: The quit dialog, Mona Lisa's spec verbatim (24 Aug 20:50)
    //
    // Title: "Your agents keep running"
    // Sentence: "Quitting closes this window. Your agents keep working in
    // the background, and Kosmos is still in your Applications folder when
    // you want it back."
    // Buttons: "Close the app" (default, Enter) -- and, once fleet-stop
    // exists in the engine, "Close the app and stop every agent". THAT
    // SECOND BUTTON CANNOT SHIP YET (her spec: it would stop less than it
    // says), so this ships with the first button only.
    //
    // Returns true if the app should actually terminate.
    private func showQuitDialog() -> Bool {
        let alert = NSAlert()
        alert.messageText = "Your agents keep running"
        alert.informativeText = "Quitting closes this window. Your agents keep working in the background, and Kosmos is still in your Applications folder when you want it back."
        alert.alertStyle = .informational
        let closeButton = alert.addButton(withTitle: "Close the app")
        closeButton.keyEquivalent = "\r" // Enter lands on the harmless choice
        alert.runModal()
        // Only one button exists right now, so any return from runModal()
        // means "Close the app" -- when the second button is added, branch here.
        logLine("showQuitDialog: dismissed, confirming quit")
        isActuallyQuitting = true
        return true
    }

    // MARK: Menu (minimal: Quit needs a Cmd-Q accelerator to exist at all)

    private func buildMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(withTitle: "Quit Kosmos", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        NSApp.mainMenu = mainMenu
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
