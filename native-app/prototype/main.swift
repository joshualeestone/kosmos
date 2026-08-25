// Kosmos native app prototype (#677).
//
// Phase 1 (done): the AppKit lifecycle mechanics (window, WKWebView, stay-
// running-on-close, the quit dialog) proven against a real running board.
//
// Phase 2 (this pass): the board-resolution and starting logic, reusing
// `bin/kosmos start`'s existing health-check-and-start-if-needed rather
// than reimplementing it -- this file stays DUMB about how a board comes
// up (retries, pidfiles, log tails, the "another process already owns
// this port" refusal) and only knows how to run that command and read
// its exit code, matching the app's whole reuse philosophy: the board
// itself is unchanged, this is a window pointed at it.
//
// NOT the shipped shape yet -- no signing, no notarization, no install-time
// config file wired from install/setup.sh yet (this reads one by hand for
// testing; see KosmosInstallConfig below). Run directly:
//   swiftc main.swift -o kosmos-app-prototype && ./kosmos-app-prototype
//
// Env overrides for testing (mirror the real launcher's own contract):
//   KOSMOS_HOME   where the install lives (default ~/.local/share/kosmos)
//   KOSMOS_PORT   the board's port (default 16180)
//   KOSMOS_APP_CONFIG   path to a kosmos-install.json to read instead of
//                       the bundle's own Contents/Resources copy (testing only)

import Cocoa
import WebKit

// MARK: - Install-time configuration
//
// The CURRENT bash launcher gets $KOSMOS_HOME/$owner_uid/$PORT baked in via
// heredoc string substitution at install time (install/setup.sh
// build_app_bundle). A compiled binary can't be re-baked that way without
// recompiling per install, and compiling on the user's own Mac is exactly
// the kind of surprise install/kosmos's own comments rule out (it can
// trigger an Xcode command-line-tools dialog). So: this binary is
// pre-built once, the same shape as the already-shipped Rust connector
// (kosmos-tunnel), and reads its install-time values from a small JSON
// file build_app_bundle will write into Contents/Resources/ (phase 3;
// not wired yet -- this struct and its fallback path are ready for it).
struct KosmosInstallConfig: Codable {
    let kosmosHome: String
    let ownerUid: UInt32
    let port: Int

    static func load() -> KosmosInstallConfig? {
        let path = ProcessInfo.processInfo.environment["KOSMOS_APP_CONFIG"]
            ?? (Bundle.main.resourcePath.map { $0 + "/kosmos-install.json" })
        guard let path, let data = FileManager.default.contents(atPath: path) else { return nil }
        return try? JSONDecoder().decode(KosmosInstallConfig.self, from: data)
    }
}

// MARK: - Resolving which install to open (#664: another account clicked
// the shared /Applications icon)
//
// The bash launcher compares the CLICKING account's uid against the
// baked owner_uid; a mismatch means someone else's icon. It then checks
// whether the clicking account has ITS OWN install at the well-known
// default home, and opens that if so -- never assumes, never guesses. In
// Swift, `getuid()` and NSHomeDirectory() are already resolved against
// the REAL running identity (not an inherited, spoofable $HOME the way
// the bash version reads it), so this is if anything more robust than
// the shape it replaces, not just a port of it.
struct ResolvedInstall {
    let kosmosHome: String
    let port: Int
}

enum InstallResolutionError: Error {
    case noOwnInstallForOtherUser
}

func resolveInstall(config: KosmosInstallConfig?) throws -> ResolvedInstall {
    let defaultHome = NSHomeDirectory() + "/.local/share/kosmos"
    // An explicit KOSMOS_HOME in the environment names the copy to open
    // outright (a self-host layout, or a harness pointing at a disposable
    // tree) -- same override contract as the bash launcher and `kosmos`
    // itself, checked FIRST so it can never be second-guessed by the
    // uid comparison below.
    if let overrideHome = ProcessInfo.processInfo.environment["KOSMOS_HOME"] {
        let port = ProcessInfo.processInfo.environment["KOSMOS_PORT"].flatMap { Int($0) }
            ?? config?.port ?? 16180
        return ResolvedInstall(kosmosHome: overrideHome, port: port)
    }
    guard let config else {
        // No baked config and no override: fall back to the well-known
        // default, same as a bare `kosmos` invocation would.
        let port = ProcessInfo.processInfo.environment["KOSMOS_PORT"].flatMap { Int($0) } ?? 16180
        return ResolvedInstall(kosmosHome: defaultHome, port: port)
    }
    if getuid() == config.ownerUid {
        return ResolvedInstall(kosmosHome: config.kosmosHome, port: config.port)
    }
    // A different account clicked the shared icon (#664). If THEY have
    // their own install at the default home, open that -- never the
    // installing account's private tree.
    let ownKosmosBin = defaultHome + "/bin/kosmos"
    if FileManager.default.isExecutableFile(atPath: ownKosmosBin) {
        logLine("resolveInstall: uid \(getuid()) != owner \(config.ownerUid), opening own install at \(defaultHome)")
        return ResolvedInstall(kosmosHome: defaultHome, port: 16180) // their own default; they have not shared this icon's baked port
    }
    throw InstallResolutionError.noOwnInstallForOtherUser
}

// MARK: - Starting the board (delegates entirely to `bin/kosmos start`)

enum StartResult {
    case alreadyRunningOrStarted
    case failed(String) // stderr, the die() message, same wording a terminal user would see
}

func startBoard(kosmosHome: String, port: Int) -> StartResult {
    let kosmosBin = kosmosHome + "/bin/kosmos"
    guard FileManager.default.isExecutableFile(atPath: kosmosBin) else {
        return .failed("Kosmos looks incomplete: \(kosmosBin) is missing.")
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: kosmosBin)
    process.arguments = ["start"]
    var env = ProcessInfo.processInfo.environment
    env["KOSMOS_PORT"] = String(port)
    process.environment = env
    let stderrPipe = Pipe()
    process.standardError = stderrPipe
    process.standardOutput = Pipe() // discarded; `say()` output is not shown, matching the bash launcher (>/dev/null 2>&1)
    do {
        try process.run()
        process.waitUntilExit()
    } catch {
        return .failed("Could not run \(kosmosBin): \(error.localizedDescription)")
    }
    if process.terminationStatus == 0 {
        return .alreadyRunningOrStarted
    }
    let errData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
    let errText = String(data: errData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return .failed(errText.isEmpty ? "kosmos start exited \(process.terminationStatus)" : errText)
}

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
    }

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
        // Testing shortcut, unchanged from phase 1: point directly at an
        // already-running board (a hand-booted sandbox), skipping the real
        // resolve/start path entirely. Not present in the shipped app's
        // decision tree -- KOSMOS_URL is never set by the installer.
        if let urlString = ProcessInfo.processInfo.environment["KOSMOS_URL"] {
            guard let url = URL(string: urlString) else {
                showStartupFailureAlert(detail: "The address \(urlString) is not a valid URL.")
                return
            }
            logLine("LOADING \(url.absoluteString) (KOSMOS_URL override, test path)")
            webView.load(URLRequest(url: url))
            return
        }

        let config = KosmosInstallConfig.load()
        logLine("KosmosInstallConfig.load() -> \(config == nil ? "nil (no baked config; using defaults/overrides)" : "loaded")")

        let resolved: ResolvedInstall
        do {
            resolved = try resolveInstall(config: config)
        } catch InstallResolutionError.noOwnInstallForOtherUser {
            // #664's dialog, bash launcher's wording verbatim.
            showForeignAccountAlert()
            return
        } catch {
            showStartupFailureAlert(detail: "Could not determine which Kosmos to open: \(error.localizedDescription)")
            return
        }
        logLine("resolved kosmosHome=\(resolved.kosmosHome) port=\(resolved.port)")

        switch startBoard(kosmosHome: resolved.kosmosHome, port: resolved.port) {
        case .failed(let message):
            logLine("startBoard failed: \(message)")
            showStartupFailureAlert(detail: "Something went wrong while Kosmos was starting. Installing it again usually fixes this: open installkosmos.com and click Download for macOS. Your agents and settings stay on this Mac; installing again does not remove them.")
        case .alreadyRunningOrStarted:
            let urlString = "http://127.0.0.1:\(resolved.port)"
            guard let url = URL(string: urlString) else {
                showStartupFailureAlert(detail: "The address \(urlString) is not a valid URL.")
                return
            }
            logLine("LOADING \(url.absoluteString)")
            webView.load(URLRequest(url: url))
        }
    }

    private func showStartupFailureAlert(detail: String) {
        let alert = NSAlert()
        alert.messageText = "Kosmos could not start"
        alert.informativeText = detail
        alert.alertStyle = .critical
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    // #664's dialog, bash launcher's wording verbatim (install/setup.sh):
    // never sends anyone to a terminal, always points at the .pkg for
    // their own copy.
    private func showForeignAccountAlert() {
        let alert = NSAlert()
        alert.messageText = "Kosmos is installed on this Mac for another user"
        alert.informativeText = "It was set up by a different account on this computer, and it runs for that account. To use Kosmos here, install your own copy: open installkosmos.com and click Download for macOS. Yours will be separate, with your own agents and settings."
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
