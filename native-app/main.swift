// Kosmos native app (#677) -- the compiled binary tools/build-kosmos-bundle.sh
// stages at app/bin/kosmos-app and install/setup.sh's build_app_bundle()
// places at Contents/MacOS/Kosmos, replacing the old bash-heredoc launcher.
//
// Phase 1 (done): the AppKit lifecycle mechanics (window, WKWebView, stay-
// running-on-close, the quit dialog) proven against a real running board.
//
// Phase 2 (done): the board-resolution and starting logic, reusing
// `bin/kosmos start`'s existing health-check-and-start-if-needed rather
// than reimplementing it -- this file stays DUMB about how a board comes
// up (retries, pidfiles, log tails, the "another process already owns
// this port" refusal) and only knows how to run that command and read
// its exit code, matching the app's whole reuse philosophy: the board
// itself is unchanged, this is a window pointed at it.
//
// Phase 3 (this pass): installer integration. build_app_bundle() writes
// Contents/Resources/kosmos-install.json per install (KosmosInstallConfig
// below reads it); the binary itself is identical across every install and
// carries no baked values. See .claude/plans/native-app-677.md for why
// ownership-proof (bundle_is_ours in install/setup.sh) had to move off the
// executable and onto that config file for this to be safe to ship.
//
// For local iteration, run directly:
//   swiftc main.swift -o kosmos-app-prototype && ./kosmos-app-prototype
//
// Env overrides for testing (mirror the real launcher's own contract):
//   KOSMOS_HOME   where the install lives (default ~/.local/share/kosmos)
//   KOSMOS_PORT   the board's port (default 16180 for uid 501, a
//                 uid-derived value 16181-20179 for any other account --
//                 see kosmosDefaultPort() below)
//   KOSMOS_APP_CONFIG   path to a kosmos-install.json to read instead of
//                       the bundle's own Contents/Resources copy (testing only)
//   KOSMOS_APP_TEST_HOME   stands in for NSHomeDirectory() in the #664
//                       different-account fallback lookup (testing only --
//                       NSHomeDirectory() does not honor $HOME, so this is
//                       the only way to simulate a different account
//                       without a second real macOS account)

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
    // Wording parity with the bash launcher it replaces (#677 phase 3):
    // bash's own dialog says "your Kosmos" ONLY in the one branch below
    // where a different account is opening ITS OWN install, and the
    // generic "Kosmos" everywhere else, including a same-account
    // KOSMOS_HOME override. loadBoard() reads this to pick the wording.
    let isOwnAccount: Bool
}

enum InstallResolutionError: Error {
    case noOwnInstallForOtherUser
}

// 🔑 #910: PER ACCOUNT, NOT ONE VALUE FOR EVERY macOS USER ON THIS
// MACHINE. Every account defaulting to the identical port was the entire
// reason a second macOS account's Kosmos loaded the first account's real
// agents: 127.0.0.1 is machine-wide, so `install/kosmos`'s `healthy()`
// always found account A's board first and account B's install never
// needed a board of its own. Same formula as install/kosmos,
// install/setup.sh, and install/pkg-scripts/postinstall -- must move
// together, now four computing sites (server.js consumes an
// already-resolved port and never computes this formula itself). uid 501
// (the Setup Assistant's first created
// user account on every personal or family Mac -- macOS reserves
// anything below 500 for system accounts) is pinned to the LITERAL
// unchanged value: every real install today is hardcoded to exactly
// this, so the single most common Kosmos install on this planet changes
// zero observable bytes. Every other uid gets a deterministic, stable
// alternate -- `+1` on the modulo so it can never itself land back on
// 16180 by coincidence (uid % 4000 alone can be exactly 0). No probing,
// no persisted state: a pure function of the account's own uid.
func kosmosDefaultPort(uid: uid_t) -> Int {
    if uid == 501 { return 16180 }
    return 16180 + 1 + Int(uid % 3999)
}

// #965: the Reload decision as a pure function of the three observable
// facts, so the state machine is machine-checkable (the
// --kosmos-app-reload-decision-selftest hatch at the bottom prints the
// whole eight-row table) instead of living only inside an @objc method
// nothing outside a window server can call.
enum ReloadDecision: String {
    case ignore      // a board start is already in flight; drop (and beep)
    case reload      // a committed, un-failed page: plain page reload
    case startBoard  // no healthy page: re-run the resolve-and-start path
}

// Deliberately NOT an input: "a page load is in flight". A press landing in
// the ms-wide window between the start resolving and the first commit takes
// .startBoard while a healthy load is about to land -- costing one redundant
// `kosmos start` (its already-running path is a fast health-check) and a
// duplicate load whose superseded -999 the failure handler treats as benign.
// Accepted: a fourth input to guard a self-limiting cost buys complexity,
// not correctness.
func reloadDecision(startInFlight: Bool, hasCommittedPage: Bool, lastLoadFailed: Bool) -> ReloadDecision {
    if startInFlight { return .ignore }
    if hasCommittedPage && !lastLoadFailed { return .reload }
    return .startBoard
}

func resolveInstall(config: KosmosInstallConfig?) throws -> ResolvedInstall {
    // Test-only seam: NSHomeDirectory() reads the REAL account's passwd
    // record and does NOT honor an overridden $HOME (confirmed empirically
    // -- unlike the bash launcher it replaces, which read bash's own $HOME
    // variable directly). A genuinely different macOS account clicking the
    // shared icon gets ITS OWN true home this same way, with no override
    // needed -- this seam exists only so a test harness can simulate that
    // without provisioning a second real account.
    let realHome = ProcessInfo.processInfo.environment["KOSMOS_APP_TEST_HOME"] ?? NSHomeDirectory()
    let defaultHome = realHome + "/.local/share/kosmos"
    // An explicit KOSMOS_HOME in the environment names the copy to open
    // outright (a self-host layout, or a harness pointing at a disposable
    // tree) -- same override contract as the bash launcher and `kosmos`
    // itself, checked FIRST so it can never be second-guessed by the
    // uid comparison below. Bash applies the same override for the
    // OWNING account too (its own top-level `KOSMOS_HOME:-baked`), always
    // with the generic wording -- so this branch is "own account" unless
    // a baked config says otherwise.
    if let overrideHome = ProcessInfo.processInfo.environment["KOSMOS_HOME"] {
        let port = ProcessInfo.processInfo.environment["KOSMOS_PORT"].flatMap { Int($0) }
            ?? config?.port ?? kosmosDefaultPort(uid: getuid())
        let isOwnAccount = config == nil || getuid() == config!.ownerUid
        return ResolvedInstall(kosmosHome: overrideHome, port: port, isOwnAccount: isOwnAccount)
    }
    guard let config else {
        // No baked config and no override: fall back to the well-known
        // default, same as a bare `kosmos` invocation would.
        let port = ProcessInfo.processInfo.environment["KOSMOS_PORT"].flatMap { Int($0) } ?? kosmosDefaultPort(uid: getuid())
        return ResolvedInstall(kosmosHome: defaultHome, port: port, isOwnAccount: true)
    }
    if getuid() == config.ownerUid {
        return ResolvedInstall(kosmosHome: config.kosmosHome, port: config.port, isOwnAccount: true)
    }
    // A different account clicked the shared icon (#664). If THEY have
    // their own install at the default home, open that -- never the
    // installing account's private tree. #910: never the INSTALLING
    // account's baked port either -- that is `config.port`, a value THIS
    // account chose, not necessarily the well-known default. THEIR port
    // is their own uid's derived value, same formula as their own
    // `kosmos start` would compute.
    let ownKosmosBin = defaultHome + "/bin/kosmos"
    if FileManager.default.isExecutableFile(atPath: ownKosmosBin) {
        logLine("resolveInstall: uid \(getuid()) != owner \(config.ownerUid), opening own install at \(defaultHome)")
        return ResolvedInstall(kosmosHome: defaultHome, port: kosmosDefaultPort(uid: getuid()), isOwnAccount: false)
    }
    throw InstallResolutionError.noOwnInstallForOtherUser
}

// MARK: - Starting the board (delegates entirely to `bin/kosmos start`)

enum StartResult {
    case alreadyRunningOrStarted
    case failed(String) // stderr, the die() message, same wording a terminal user would see
}

// onSpawn hands the just-launched Process to the caller so the caller's
// watchdog can terminate a hung start (#965). Terminating a hung CHILD
// closes its stderr and unblocks the drain below via EOF; it cannot reach a
// GRANDCHILD holding an inherited fd (see the drain comment), where the
// caller's re-arm is the only guarantee. Called on the caller's queue,
// immediately after a successful run().
func startBoard(kosmosHome: String, port: Int, onSpawn: ((Process) -> Void)? = nil) -> StartResult {
    let kosmosBin = kosmosHome + "/bin/kosmos"
    guard FileManager.default.isExecutableFile(atPath: kosmosBin) else {
        return .failed("Kosmos looks incomplete: \(kosmosBin) is missing.")
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: kosmosBin)
    process.arguments = ["start"]
    var env = ProcessInfo.processInfo.environment
    env["KOSMOS_PORT"] = String(port)
    // install/kosmos self-resolves KOSMOS_HOME from its own script location
    // when this is unset, so it is not strictly required for the real
    // command to work -- set explicitly anyway, matching the bash launcher
    // it replaces, as a defense-in-depth against ever invoking the wrong
    // install's copy by accident, and so a test double can observe which
    // home resolveInstall actually decided on.
    env["KOSMOS_HOME"] = kosmosHome
    process.environment = env
    let stderrPipe = Pipe()
    process.standardError = stderrPipe
    // The null device, NOT a Pipe(): a Pipe nobody drains has a ~64KB kernel
    // buffer, and a chatty child blocks on write against it, deadlocking the
    // wait below forever (#965 review). /dev/null has no buffer to fill.
    // Output is still discarded either way, matching the bash launcher's
    // >/dev/null 2>&1 for `say()` chatter.
    process.standardOutput = FileHandle.nullDevice
    do {
        try process.run()
    } catch {
        return .failed("Could not run \(kosmosBin): \(error.localizedDescription)")
    }
    onSpawn?(process)
    // Drain stderr BEFORE waiting, for the same deadlock reason: this read
    // consumes as the child writes, so stderr can never fill either, and it
    // returns at the child's EOF -- after which the wait is immediate.
    // ⚠️ Cross-file dependency: "EOF at child exit" holds only while nothing
    // `kosmos start` spawns inherits this stderr and outlives it. Today that
    // is true because install/kosmos starts the board daemon with
    // `nohup ... >> "$BOARD_LOG" 2>&1 &` (its fds re-pointed at the board
    // log). A future long-lived child that inherits stderr would hold this
    // read open past the child's exit -- the caller's watchdog (loadBoard)
    // re-arms Reload if that ever happens, and this comment is the pointer.
    let errData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    if process.terminationStatus == 0 {
        return .alreadyRunningOrStarted
    }
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

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    private var isActuallyQuitting = false
    // #965: whether the most recent navigation ended in a delegate failure.
    // Read by reloadBoard() to decide between a plain page reload and a full
    // loadBoard() re-run; set/cleared ONLY in the three navigation delegate
    // methods below and at the top of loadBoard().
    private var lastLoadFailed = false
    // #965: set when a user-initiated reload takes the plain webView.reload()
    // branch, consumed by the shared failure handler to fall through to
    // loadBoard() ONCE -- so the "board died after a good load" case recovers
    // on a single Cmd-R instead of two. Cleared on any successful load.
    private var recoverOnReloadFailure = false
    // #965: the WKNavigation returned by that webView.reload(), so a failure
    // callback can be attributed: a failure OF the user's reload is not the
    // same event as a -999 for some navigation the reload just superseded,
    // and treating them alike either fires a surprise board restart or robs
    // the press of its single-press recovery.
    private var reloadNavigation: WKNavigation?
    // #965: the navigation loadBoard() itself started, so ITS failure also
    // counts as "the page on screen is not healthy" -- without this, a
    // recovery load failing over an old committed page left lastLoadFailed
    // false and the next press on the wrong branch.
    private var boardLoadNavigation: WKNavigation?
    // #965: after the first user reload, every board start is user-initiated
    // (nothing but launch and Reload call loadBoard). The failure alert
    // reads differently for a press than for a launch: a press suggests
    // retrying before it suggests reinstalling. Never reset -- launch
    // happens once, before any press can.
    private var boardRecoveryIsUserInitiated = false
    // #965: a board start is already running on the background queue; reload
    // requests are ignored until it resolves, so two Cmd-R presses (or the
    // test seam firing during a slow boot) cannot race two `kosmos start`
    // invocations. Guarded by a watchdog (see loadBoard) so a hung start can
    // never leave Reload permanently dead -- the generation counter ties each
    // watchdog to ITS start, so a stale watchdog cannot clear a newer one's
    // flag.
    private var boardStartInFlight = false
    private var boardStartGeneration = 0
    // #965: the live `kosmos start` Process of the current generation, kept
    // so the watchdog can TERMINATE a hung start rather than just abandon it
    // -- an abandoned start leaks its blocked drain thread and an orphan
    // child per attempt. Main-thread only, like every flag above.
    private var inFlightStart: (generation: Int, process: Process)?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()
        buildWindow()
        loadBoard()
        NSApp.activate(ignoringOtherApps: true)
        // #965 test seam, same testing-only contract as KOSMOS_APP_TEST_HOME:
        // fire reloadBoard() once after N seconds, so a harness can drive the
        // reload decision path end to end without Accessibility permission for
        // synthetic Cmd-R keystrokes. Never set by the installer.
        if let after = ProcessInfo.processInfo.environment["KOSMOS_APP_TEST_RELOAD_AFTER"] {
            if let seconds = Double(after), seconds >= 0, seconds.isFinite {
                logLine("KOSMOS_APP_TEST_RELOAD_AFTER=\(seconds): scheduling one test reload")
                DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
                    self?.reloadBoard(nil)
                }
            } else {
                // A bad value logs its rejection rather than vanishing, in the
                // file's observe-everything style -- a harness with a typo'd
                // value should see WHY nothing fired.
                logLine("KOSMOS_APP_TEST_RELOAD_AFTER=\(after): rejected (not a non-negative number of seconds)")
            }
        }
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

        webView = AppDelegate.makeWebView(frame: contentRect, delegate: self)
        window.contentView = webView

        window.makeKeyAndOrderFront(nil)
    }

    private func loadBoard() {
        // A fresh attempt starts with a clean slate; the delegate methods
        // below re-set these if THIS attempt fails too (#965). Disarming the
        // one-shot here matters: without it, an armed fall-through from a
        // reload could survive into a later, unrelated navigation failure and
        // fire a full board restart the user never asked for. Known cost of
        // the clean slate: if THIS attempt's `kosmos start` fails over a
        // stale committed page, the next press burns one doomed reload()
        // round-trip before its own fall-through lands back here -- still
        // one press per recovery, just a slower first hop.
        lastLoadFailed = false
        recoverOnReloadFailure = false
        reloadNavigation = nil
        boardLoadNavigation = nil
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
            boardLoadNavigation = webView.load(URLRequest(url: url))
            return
        }

        let config = KosmosInstallConfig.load()
        logLine("KosmosInstallConfig.load() -> \(config == nil ? "nil (no baked config; using defaults/overrides)" : "loaded")")

        let resolved: ResolvedInstall
        do {
            resolved = try resolveInstall(config: config)
        } catch InstallResolutionError.noOwnInstallForOtherUser {
            // Logged before the modal so a test double can observe the
            // refusal without needing to click the dialog it is about to
            // block on (see the modal note on showStartupFailureAlert below).
            logLine("resolveInstall: refused, no own install for this account")
            // #664's dialog, bash launcher's wording verbatim.
            showForeignAccountAlert()
            return
        } catch {
            showStartupFailureAlert(detail: "Could not determine which Kosmos to open: \(error.localizedDescription)")
            return
        }
        logLine("resolved kosmosHome=\(resolved.kosmosHome) port=\(resolved.port)")

        // #965: `bin/kosmos start` health-checks and, when the board is down,
        // runs a full boot -- seconds of wall clock. At launch that block was
        // invisible; now that Cmd-R re-enters this path mid-session, running
        // it on the main thread would beachball the app for the whole boot.
        // Run it off the main thread; every UI outcome marshals back.
        boardStartInFlight = true
        boardStartGeneration += 1
        let generation = boardStartGeneration
        // Captured NOW: the alert wording belongs to what triggered THIS
        // attempt, not to whatever the flag says when the start resolves.
        let userInitiated = boardRecoveryIsUserInitiated
        // Watchdog: if the start never resolves (the drain in startBoard can
        // block past the child's exit if a future grandchild inherits stderr
        // -- see the comment there), a permanently-true flag would make every
        // future Cmd-R a silent no-op, which is the exact hole #965 fixes.
        // 300s is a ceiling chosen to sit far beyond any plausible boot,
        // cold first start included -- asserted, not measured; firing is
        // LOUD (an alert below), so a too-small value gets noticed in the
        // field rather than silently eating slow boots.
        DispatchQueue.main.asyncAfter(deadline: .now() + 300) { [weak self] in
            guard let self = self else { return }
            if self.boardStartInFlight && self.boardStartGeneration == generation {
                logLine("watchdog: board start gen \(generation) unresolved after 300s; re-arming Reload")
                self.boardStartInFlight = false
                // Best-effort reap. Terminating a hung CHILD closes its
                // stderr, unblocks startBoard's drain, and frees the queue
                // thread. If the hang is instead an inherited fd held open by
                // a GRANDCHILD (the cross-file case named in startBoard),
                // this SIGTERM cannot reach it and one drain thread stays
                // leaked for that attempt -- the re-arm, not this kill, is
                // the user-facing guarantee. ACCEPTED including accumulation:
                // if the cross-file invariant regresses, EVERY start hangs
                // this way and repeated presses leak one thread per 300s
                // cycle toward GCD's ~64-thread pool. That is hours of
                // retrying against an already-broken install whose tripwire
                // comment (startBoard) is the fix pointer; a firing cap here
                // would be machinery for a regression two layers deep.
                if let s = self.inFlightStart, s.generation == generation {
                    if s.process.isRunning {
                        logLine("watchdog: terminating hung kosmos start (pid \(s.process.processIdentifier))")
                        s.process.terminate()
                    } else {
                        // The child already exited; the hang is the drain
                        // (a grandchild holding stderr). Nothing to kill
                        // safely -- the isRunning check narrows the
                        // recycled-pid window to microseconds (it cannot
                        // close a TOCTOU entirely; nothing in userspace can).
                        logLine("watchdog: hung start's child already exited; drain blocked by an inherited fd, leaving it")
                    }
                    self.inFlightStart = nil
                }
                // Bump the generation so the hung start, if it EVER resolves,
                // is stale and reports nothing. Without this, its minutes-old
                // failure could surface a "could not start" alert over a
                // page the user has long since reloaded to health. Cost: a
                // late lone SUCCESS is also dropped -- acceptable, the user's
                // next Cmd-R reaches the now-running board anyway.
                self.boardStartGeneration += 1
                // Say so; a silent blank window is the failure mode this
                // whole feature exists to end. Neutral headline: the start
                // did not conclusively fail, it is being given up on.
                self.showStartupFailureAlert(detail: "Kosmos is taking unusually long to start. Click OK, then press Cmd-R (View > Reload) to try again.", title: "Kosmos is still starting")
            }
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = startBoard(kosmosHome: resolved.kosmosHome, port: resolved.port) { process in
                // Register the live process for the watchdog, unless the
                // watchdog already gave up on this generation (spawn landing
                // that late is not a real timeline, but the guard is free).
                DispatchQueue.main.async { [weak self] in
                    guard let self = self, self.boardStartGeneration == generation else { return }
                    self.inFlightStart = (generation, process)
                }
            }
            DispatchQueue.main.async {
                guard let self = self else { return }
                // This generation's process is no longer the watchdog's
                // business once its start resolved, stale or not.
                if let s = self.inFlightStart, s.generation == generation {
                    self.inFlightStart = nil
                }
                // A start that resolves only after its watchdog re-armed (or
                // after a newer start superseded it) reports nothing: acting
                // on its outcome would race the newer attempt's load/alert.
                guard self.boardStartGeneration == generation else {
                    logLine("stale board start gen \(generation) resolved late; ignoring its outcome")
                    return
                }
                self.boardStartInFlight = false
                switch result {
                case .failed(let message):
                    logLine("startBoard failed: \(message)")
                    // Bash launcher wording verbatim, including its ONE distinction:
                    // "your Kosmos" only for a different account opening its OWN
                    // install (isOwnAccount == false); the generic "Kosmos" for
                    // every other failure, override included. A USER-INITIATED
                    // retry (Cmd-R, #965) suggests trying again before it
                    // suggests reinstalling -- a mid-session failure can be a
                    // moment's port conflict or an upgrade window, and
                    // "reinstall" as the first remedy is launch-path advice.
                    let whose = resolved.isOwnAccount ? "Kosmos" : "your Kosmos"
                    let remedy = userInitiated
                        ? "This can be temporary: click OK, then press Cmd-R (View > Reload) to try again. If it keeps failing, installing it again usually fixes this"
                        : "Installing it again usually fixes this"
                    self.showStartupFailureAlert(detail: "Something went wrong while \(whose) was starting. \(remedy): open installkosmos.com and click Download for macOS. Your agents and settings stay on this Mac; installing again does not remove them.")
                case .alreadyRunningOrStarted:
                    let urlString = "http://127.0.0.1:\(resolved.port)"
                    guard let url = URL(string: urlString) else {
                        self.showStartupFailureAlert(detail: "The address \(urlString) is not a valid URL.")
                        return
                    }
                    logLine("LOADING \(url.absoluteString)")
                    self.boardLoadNavigation = self.webView.load(URLRequest(url: url))
                }
            }
        }
    }

    private func showStartupFailureAlert(detail: String, title: String = "Kosmos could not start") {
        let alert = NSAlert()
        alert.messageText = title
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

    // MARK: The webView, and the file picker (kosmos#1032)

    /// Both delegates in one place, so a webView can never be built with the
    /// navigation one wired and the UI one forgotten. That is not a
    /// hypothetical tidiness: it is exactly the bug this constructor was
    /// extracted to close.
    static func makeWebView(frame: NSRect, delegate: AppDelegate) -> WKWebView {
        let config = WKWebViewConfiguration()
        let web = WKWebView(frame: frame, configuration: config)
        web.navigationDelegate = delegate
        // 🛑 WITHOUT THIS LINE EVERY + BUTTON IN KOSMOS IS DEAD AND SILENT.
        // On macOS a WKWebView does not open a file picker itself: it ASKS the
        // host app, through WKUIDelegate.runOpenPanelWith below. With no
        // uiDelegate there is no receiver, so the click is dropped with no
        // error, no console line and no visible change. The app shipped that
        // way, and the report that found it (Josh, 2026-08-26) was "I can't
        // hit the + button to get it to spawn the file selector" on BOTH the
        // agent and the project boxes -- one cause, not two bugs.
        //
        // ⭐ WHY NO TEST CAUGHT IT, and this is the part worth keeping: every
        // browser check runs the page in Chromium or Playwright's WebKit, and
        // in a BROWSER the picker is the browser's own. The open-panel
        // handshake only exists when the page is hosted by an app. So the
        // entire failure lives in the one seam the whole suite is structurally
        // blind to. Drag-and-drop kept working throughout, because a drop
        // delivers files through the DOM and never asks the host for a panel.
        web.uiDelegate = delegate
        return web
    }

    /// Swapped out by `--kosmos-app-filepanel-selftest` so the gate can prove
    /// the delegate fires without a modal panel appearing on a build machine.
    /// nil in every shipped run, which is the only state a person ever sees.
    static var openPanelPresenter: ((WKOpenPanelParameters, @escaping ([URL]?) -> Void) -> Void)?

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        if let present = AppDelegate.openPanelPresenter {
            present(parameters, completionHandler)
            return
        }
        let panel = NSOpenPanel()
        // The page decides these, not us: a composer that accepts several
        // files says so on its own input, and honouring the flag is what makes
        // `multiple` mean anything.
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories
        // Sheeted on the window the click came from, so it cannot end up
        // behind the board or on the wrong screen. Cancel MUST answer too:
        // an unanswered completionHandler leaves the input wedged for the rest
        // of the session, so a cancelled pick would break the NEXT press.
        let host = webView.window
        let answer: (NSApplication.ModalResponse) -> Void = { resp in
            completionHandler(resp == .OK ? panel.urls : nil)
        }
        if let host {
            panel.beginSheetModal(for: host, completionHandler: answer)
        } else {
            panel.begin(completionHandler: answer)
        }
    }

    // MARK: WKNavigationDelegate -- instrumentation only, proves the request
    // actually landed rather than inferring it from process/network state.

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Blanket-clear, deliberately NOT attributed like the failure side:
        // any finished main-frame navigation means a healthy screen, and a
        // navigation that superseded the reload already disarmed it via its
        // attributed -999. Do not "fix" this into identity-checking.
        lastLoadFailed = false
        recoverOnReloadFailure = false
        reloadNavigation = nil
        boardLoadNavigation = nil
        webView.evaluateJavaScript("document.title") { result, _ in
            logLine("PAGE LOADED, document.title=\(result ?? "<nil>")")
        }
    }

    // A cancelled navigation (NSURLErrorCancelled, -999) is delivered for
    // benign superseded loads -- a new request starting while one is still in
    // flight, some JS-driven redirects -- and says nothing about the page's
    // health. Counting it as a failure would leave a healthy page flagged,
    // and the next Cmd-R would take the heavy loadBoard() branch and throw
    // away the user's current place in the app (#965 review).
    private func isBenignCancellation(_ error: Error) -> Bool {
        let e = error as NSError
        return e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleNavigationFailure(navigation, error, stage: "PAGE LOAD FAILED")
    }

    // A crashed WebContent process leaves a blank window with no navigation
    // callback at all; log it so the field case is diagnosable. Cmd-R's
    // reload() branch recovers it (reload relaunches the content process).
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        logLine("WEB CONTENT PROCESS TERMINATED (blank window until reload)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleNavigationFailure(navigation, error, stage: "PROVISIONAL LOAD FAILED")
    }

    // ONE handler for both failure delegates -- they must never drift apart,
    // or single-press recovery quietly becomes two-press in whichever
    // delegate missed a future edit (#965).
    private func handleNavigationFailure(_ navigation: WKNavigation?, _ error: Error, stage: String) {
        logLine("\(stage): \(error.localizedDescription)")
        // Attribution: is this failure about the user's reload, about the
        // board load this app itself started, or about something else (most
        // often a navigation the reload superseded)? Identity against the
        // tokens the load calls returned answers it. The reload token is
        // always live while the one-shot is armed (the .reload branch
        // disarms immediately when reload() returns no navigation). A nil
        // navigation is treated as not-ours -- the safe direction.
        let isReloadNav = navigation != nil && navigation === reloadNavigation
        let isBoardLoadNav = navigation != nil && navigation === boardLoadNavigation
        if isBenignCancellation(error) {
            // -999 of the reload's OWN navigation means that reload is over,
            // disarm -- a stale one-shot would fire a surprise board restart
            // on some later unrelated failure. -999 of anything ELSE (the
            // navigation the reload just superseded) says nothing about the
            // reload still in flight, so the one-shot stays armed for it.
            if isReloadNav {
                recoverOnReloadFailure = false
                reloadNavigation = nil
            }
            return
        }
        // Flag the page only when this failure says something about what is
        // ON SCREEN: the reload's own navigation, the board load this app
        // started (a recovery load failing over an old committed page must
        // put the next press on the startBoard branch, not the reload
        // no-op), or a failure with no committed page behind it. An
        // unrelated navigation failing over a healthy committed page (a
        // JS-driven fetch of a dead endpoint) must not rob the next Cmd-R
        // of its plain reload -- the same user-cost the -999 carve-out
        // above prevents, for other codes.
        if isReloadNav || isBoardLoadNav || webView.backForwardList.currentItem == nil {
            lastLoadFailed = true
        }
        // One-shot fall-through: the user's reload hit a dead page (the
        // board died AFTER a good load, the likeliest field case). Recover
        // on THIS press instead of making them press twice, whichever
        // delegate delivered the failure. Consumed before the retry, so a
        // still-dead board cannot loop.
        if recoverOnReloadFailure && isReloadNav {
            recoverOnReloadFailure = false
            reloadNavigation = nil
            logLine("reload hit a dead page; falling through to loadBoard() once")
            loadBoard()
        }
    }

    // MARK: Reload (#965) -- Cmd-R / View > Reload

    // Two different kinds of "refresh", picked automatically:
    //   - The page is up and merely stale/stuck (a modal, an old screen):
    //     a plain webView.reload() is the browser-chrome behavior Josh
    //     asked for, and keeps the board process untouched.
    //   - Nothing ever loaded, or the last navigation FAILED (the board
    //     died, the install was mid-upgrade, the Mac just woke): reloading
    //     a failed page would only repeat the failure. Re-running
    //     loadBoard() retries the whole resolve-and-start path, so Cmd-R
    //     also RECOVERS a window whose board needs starting -- the actual
    //     "stuck in a spot" from the report, where relaunching the app was
    //     previously the only way out.
    //   - The page LOOKED fine but the board died after it loaded: the
    //     reload() branch runs, its navigation fails, and the provisional-
    //     failure delegate falls through to loadBoard() once -- so that case
    //     too recovers on a single press, not two.
    @objc func reloadBoard(_ sender: Any?) {
        boardRecoveryIsUserInitiated = true
        // backForwardList.currentItem, not webView.url: the url is non-nil
        // during an UNCOMMITTED provisional load too, where reload() is a
        // documented no-op -- a press in that window would silently do
        // nothing. A committed page is what "reload" means.
        let committed = webView.backForwardList.currentItem != nil
        switch reloadDecision(startInFlight: boardStartInFlight,
                              hasCommittedPage: committed,
                              lastLoadFailed: lastLoadFailed) {
        case .ignore:
            // Dropped, not queued, by design: the in-flight start will end in
            // a load or an alert either way, and a queued second start could
            // only duplicate it. The beep is the user-visible half -- the
            // press registered, something is already happening -- without
            // which a slow boot makes Cmd-R look broken, the very complaint
            // this feature answers.
            NSSound.beep()
            logLine("reload: ignored, a board start is already in flight")
        case .reload:
            logLine("reload: webView.reload() of \(webView.url?.absoluteString ?? "<committed page>")")
            recoverOnReloadFailure = true
            reloadNavigation = webView.reload()
            if reloadNavigation == nil {
                // reload() declined -- no navigation started, so there is
                // nothing to attribute and the one-shot must not survive to
                // claim some later unrelated failure. Effectively
                // unreachable (a committed page was verified by the check
                // just above, on this same runloop turn), but if it ever
                // happens the press must still DO something, so fall through
                // to the full path rather than dying silently.
                recoverOnReloadFailure = false
                logLine("reload: webView.reload() returned no navigation; falling through to loadBoard()")
                loadBoard()
            }
        case .startBoard:
            logLine("reload: no healthy page (committed=\(committed), lastLoadFailed=\(lastLoadFailed)), re-running loadBoard()")
            loadBoard()
        }
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

    // MARK: Menu

    /**
     ⚠️ THIS USED TO BE SIX SHORTCUTS AND THAT WAS THE WHOLE APP: Quit, Cut,
     Copy, Paste, Select All, Reload. Not six that worked out of a longer list
     -- six declared, in one function, and nothing else anywhere in the binary.
     So ⌘H did nothing, ⌘M did nothing, ⌘W did nothing, ⌘, did nothing, and
     ⌘Z did nothing in an app people type paragraphs of agent instructions
     into. Josh hit two of them in a row on 2026-08-26 and asked for "the most
     basic generic set of app features that have to exist" (#994).

     📌 CONSTRUCTED, NOT ASSIGNED, so it can be inspected without a window
     server: `--kosmos-app-menu-selftest` walks what this returns and prints
     it, and a release check diffs that against the expected table. The whole
     reason this card exists is that a nearly-empty menu bar is invisible
     until somebody presses a key, so the gate has to be machine-run.

     ⚠️ Most items here are AppKit-supplied ACTIONS with no code of ours
     behind them -- the item is only what carries the key equivalent. FOUR
     rows are not like that and each is flagged where it lives:
       · Reload   -- ours (#965), explicit target
       · Settings -- ours, drives the web page (see openSettings below)
       · Close    -- routes into OUR windowShouldClose, not AppKit's default
       · Undo/Redo -- reach the window's undo manager, and can be present and
                      inert; only a headed press settles them
     An earlier version of this paragraph named two, which would send a reader
     past exactly the rows the rest of this file says to check.
     */
    static func makeMainMenu(reloadTarget: AnyObject?, settingsTarget: AnyObject?) -> NSMenu {
        let mainMenu = NSMenu()

        // ── Kosmos ────────────────────────────────────────────────────────
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        // Titled "Kosmos" for the SELFTEST's benefit, not the screen's: AppKit
        // draws the application menu using the bundle name and ignores this
        // string, but an untitled menu dumps as `menu:` and a gate cannot diff
        // a blank name.
        let appMenu = NSMenu(title: "Kosmos")
        appMenuItem.submenu = appMenu
        /* About shows the bundle's CFBundleShortVersionString.
           📌 IT IS THE SAME NUMBER THE FOOTER SHOWS, and an earlier version
           of this comment said otherwise. Traced: install/setup.sh reads
           `app/package.json` `.version` into CFBundleShortVersionString, and
           tools/build-kosmos-bundle.sh reads the SAME field to substitute
           __KOSMOS_VERSION__ into web/index.html. `make_app` runs on every
           install, and the in-app update re-runs setup.sh, so it runs then
           too.
           ⚠️ SO A MISMATCH IS A DEFECT, NOT A SECOND QUESTION. The old
           comment told the next maintainer not to "fix" one, which would
           have suppressed the only signal that a make_app failed and left
           the previous bundle in place. If these two ever disagree, that
           IS the bug. */
        appMenu.addItem(withTitle: "About Kosmos",
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
                        keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        let settingsItem = NSMenuItem(title: "Settings…",
                                      action: #selector(AppDelegate.openSettings(_:)),
                                      keyEquivalent: ",")
        settingsItem.target = settingsTarget
        appMenu.addItem(settingsItem)
        appMenu.addItem(NSMenuItem.separator())
        let servicesItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        let servicesMenu = NSMenu(title: "Services")
        servicesItem.submenu = servicesMenu
        appMenu.addItem(servicesItem)
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Hide Kosmos",
                        action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: "Hide Others",
                                    action: #selector(NSApplication.hideOtherApplications(_:)),
                                    keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(withTitle: "Show All",
                        action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit Kosmos",
                        action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        // ── Edit ──────────────────────────────────────────────────────────
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenuItem.submenu = editMenu
        /* ⚠️ UNDO IS THE ONE ROW HERE THAT IS NOT A FORMALITY, and it is the
           one Mona Lisa said to fix first if only one got fixed: this is an
           app people type agent instructions and project descriptions into,
           and none of those fields could be undone.
           📌 There is no `NSText.undo:`. Undo inside a WKWebView comes from
           the WEB CONTENT's own undo manager, so these two are deliberately
           nil-targeted and travel the responder chain to the web view.
           🛑 A MENU ITEM THAT EXISTS IS NOT A MENU ITEM THAT WORKS, AND THERE
           IS NO SAFETY NET HERE. An earlier comment claimed that if nothing
           implemented `undo:` AppKit would grey the item out, so an inert Undo
           would at least be visible. MEASURED, and it is false:
           `WKWebView.instancesRespond(to: "undo:")` is FALSE while
           `NSWindow.instancesRespond(to: "undo:")` is TRUE. So the action
           always finds an implementor, the item never greys on that account,
           and its enabled state is driven by whichever undo manager the window
           returns. ⇒ These two rows can only be settled by a headed press. */
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redoItem = NSMenuItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redoItem)
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        // ── View ──────────────────────────────────────────────────────────
        // #965: standard macOS menu order puts View after Edit. The item
        // targets the delegate explicitly rather than relying on the
        // responder chain, so Reload works even when focus is inside the
        // web view (WKWebView swallows nil-targeted actions it doesn't
        // recognize on some macOS versions).
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        viewMenuItem.submenu = viewMenu
        let reloadItem = NSMenuItem(title: "Reload",
                                    action: #selector(AppDelegate.reloadBoard(_:)), keyEquivalent: "r")
        reloadItem.target = reloadTarget
        viewMenu.addItem(reloadItem)

        // ── Window ────────────────────────────────────────────────────────
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenuItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize",
                           action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom",
                           action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        /* ⌘W goes through `performClose:`, which fires `windowShouldClose` --
           the SAME path the red button takes. That is deliberate: this app
           deliberately distinguishes closing the window from quitting
           (QuitBehavior.closingWindowQuits), and routing ⌘W anywhere else
           would give the keyboard a different meaning from the button. */
        windowMenu.addItem(withTitle: "Close",
                           action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(NSMenuItem.separator())
        /* ⚠️ A WAY BACK, because this branch just added a way out.
           `Close` orders the window out rather than quitting, and an
           ordered-out window leaves AppKit's window list -- so after ⌘W the
           Window menu is empty and offers no route back. Recovery existed
           (clicking the Dock icon, and now ⌘,) but neither is IN the menu
           bar, and a Mac user who has just been given a Window menu will
           look there. The behaviour is not new; the reflexive keyboard route
           to it is, which is what makes the gap reachable. */
        let showItem = NSMenuItem(title: "Kosmos",
                                  action: #selector(AppDelegate.showBoardWindow(_:)), keyEquivalent: "0")
        showItem.target = reloadTarget
        windowMenu.addItem(showItem)
        windowMenu.addItem(NSMenuItem.separator())
        windowMenu.addItem(withTitle: "Bring All to Front",
                           action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")

        return mainMenu
    }

    private func buildMenu() {
        let mainMenu = AppDelegate.makeMainMenu(reloadTarget: self, settingsTarget: self)
        NSApp.mainMenu = mainMenu
        // Handed to AppKit by ROLE, not by title: it fills the Services
        // submenu and adds the window list, and it finds them by these
        // properties rather than by looking for a menu called "Window".
        if let appSub = mainMenu.items.first?.submenu {
            NSApp.servicesMenu = appSub.items.first(where: { $0.title == "Services" })?.submenu
        }
        NSApp.windowsMenu = mainMenu.items.first(where: { $0.submenu?.title == "Window" })?.submenu
    }

    /**
     ⌘, opens Kosmos's own Settings, which lives in the WEB app, so this is
     not an AppKit action and there is no standard one to borrow.

     ⚠️ IT MUST NOT DISCARD A DRAFT. The obvious implementation -- navigate to
     `/?tab=settings` -- would throw away whatever the person had typed into
     an instructions or description field, and this app is full of them. So it
     asks the PAGE to switch tabs in place first (the same function the tabs
     themselves call) and only navigates when that function is not there,
     which would mean the page is an older build than this binary.
     */
    /* The counterpart to Close. Same call `applicationShouldHandleReopen`
       makes when the Dock icon is clicked, so there is one way to bring the
       window back and the menu item is not a second implementation of it. */
    @objc func showBoardWindow(_ sender: Any?) {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func openSettings(_ sender: Any?) {
        /* ⚠️ THE WINDOW MAY BE HIDDEN. ⌘W (new on this branch) routes through
           `windowShouldClose`, which orders the window out and returns false --
           the app keeps running with no window on screen. Switching a tab on an
           invisible window and reporting success is the "looks answered and is
           not" failure this menu bar exists to remove. */
        window.makeKeyAndOrderFront(nil)
        /* 🛑 THE `try` IS AROUND THE LOOKUP ONLY, NOT THE CALL.
           An earlier version wrapped `showTab('settings')` itself, so ANY
           exception thrown INSIDE showTab -- it reaches a dozen elements by id
           on a partly-painted page -- fell through to the navigation and threw
           away whatever the person had typed into an instructions field. That
           is the exact harm the fallback's own comment claims to avoid. Now a
           throw from showTab propagates and is REPORTED; only a genuinely
           missing function navigates. */
        /* 🛑 CLICK THE REAL CONTROL, DO NOT CALL showTab DIRECTLY.
           An earlier version called `showTab('settings')` and its comment
           claimed that was "the same function the tabs themselves call". The
           FUNCTION is the same; the CALL is not. The page's own tab handler
           does `WATCH += 1; topLevelReset(tab); showTab(tab); … burgerClose()`,
           and two of those matter here:

           · `WATCH` is the page's "the person walked away" token. index.html
             carries a comment recording that this exact omission already
             shipped once: leaving a panel without bumping it left the page
             polling /api/status every two seconds and repainting a hidden
             panel. Pressing ⌘, mid-agent-creation would reintroduce that
             through a new door the existing guard does not cover.
           · `burgerClose()` — on the narrow layout the burger nav otherwise
             stays open over the Settings screen.

           The page states the rule itself: go through the real control "so
           aria-selected, WATCH, and everything else a tab change means stay
           in the one place that owns them."

           📌 GRADED, MOST-CORRECT FIRST. The control is absent during
           first-run, where `showTab` is still the honest second choice; the
           navigation is last because it is the only one that can discard
           typed text. */
        let js = """
        (function () {
          try {
            var tab = document.querySelector('.tab[data-tab="settings"]');
            if (tab) { tab.click(); return 'clicked'; }
          } catch (e) { /* fall to the next rung */ }
          var fn = null;
          try { fn = (typeof showTab === 'function') ? showTab : null; } catch (e) { fn = null; }
          if (fn) { fn('settings'); return 'in-place'; }
          location.assign('/?tab=settings');
          return 'navigated';
        })()
        """
        // logLine is a free function in this file, not a method: no `self`,
        // and so no capture list is needed either.
        webView.evaluateJavaScript(js) { result, error in
            if let error = error {
                /* ⚠️ NOT ONLY logLine. In a shipped install the log path
                   (/tmp/kosmos-app-test/app.log) does not exist and
                   FileManager.createFile fails, so a log-only failure is
                   invisible to the person AND to field diagnostics -- ⌘,
                   would silently do nothing on a window that never loaded
                   (about:blank after a startup-failure alert). The item is
                   enabled because THIS delegate implements the action, so it
                   never greys to warn anyone -- not the responder-chain
                   reason the Undo note gives, which is a different item's
                   story. A beep is what `reloadBoard`
                   already does for its own can't-act case. */
                NSSound.beep()
                logLine("openSettings: the page did not answer (\(error.localizedDescription))")
            } else {
                logLine("openSettings: \(result as? String ?? "no answer")")
            }
        }
    }
}

// Build-time self-test (tools/build-kosmos-bundle.sh): proves the signed
// binary loads and executes under hardened runtime -- the same purpose as
// kosmos-tunnel's `--help` check in that build script -- without needing a
// window server, which a build machine may not have. Exits before touching
// NSApplication/app.run() below, so it never opens a window.
if CommandLine.arguments.contains("--kosmos-app-selftest") {
    print("kosmos-app selftest ok")
    exit(0)
}
// #910: same shape as the selftest above, for a single pure function
// rather than the whole binary. Exists so a shell test can prove parity
// between THIS Swift formula and the identical one duplicated in
// install/kosmos / install/setup.sh / install/pkg-scripts/postinstall --
// the four shell sites can be cross-checked against each other by diffing
// their own output for the same $(id -u), but nothing outside a compiled
// Swift binary can invoke kosmosDefaultPort() directly to compare against
// THIS implementation, so it needs its own tiny, deliberate exit hatch.
if let uidArgIndex = CommandLine.arguments.firstIndex(of: "--kosmos-app-port-selftest"),
   CommandLine.arguments.count > uidArgIndex + 1,
   let uidArg = UInt32(CommandLine.arguments[uidArgIndex + 1]) {
    print(kosmosDefaultPort(uid: uidArg))
    exit(0)
}

// #965: same shape as the two hatches above, for the Reload state machine.
// Prints the whole eight-row decision table so a build-time check or a
// release walk can diff the machine at once, no window server needed.
if CommandLine.arguments.contains("--kosmos-app-reload-decision-selftest") {
    for startInFlight in [false, true] {
        for committed in [false, true] {
            for failed in [false, true] {
                let d = reloadDecision(startInFlight: startInFlight,
                                       hasCommittedPage: committed,
                                       lastLoadFailed: failed)
                print("startInFlight=\(startInFlight) committed=\(committed) lastLoadFailed=\(failed) -> \(d.rawValue)")
            }
        }
    }
    exit(0)
}

// #994: same shape as the three hatches above, for the MENU BAR. Prints every
// menu, every item and every shortcut so a build-time check or a release walk
// can diff the whole bar at once, no window server needed.
//
// 🛑 THIS GATE IS THE POINT OF THE CARD, not a nicety. The bar sat at six
// shortcuts for the life of the app and nobody noticed, because a missing menu
// item is invisible until somebody presses the key it does not have. A person
// remembering to check is exactly the mechanism that already failed.
if CommandLine.arguments.contains("--kosmos-app-menu-selftest") {
    // A SENTINEL, not nil: the dump records whether each item HAS a target,
    // and passing nil here would make every row read `-` and defeat the
    // column. Any object will do -- nothing is invoked.
    //
    // ⚠️ ONE LEVEL DEEP, and NSApp.servicesMenu / NSApp.windowsMenu are
    // assigned in buildMenu(), outside what this can see. So a DELETED
    // services/windows wiring, a future nested submenu, or buildMenu() not
    // being called at all, escapes this gate even though a rename would not.
    // Stated so the gate is not trusted for more than it checks.
    let sentinel = NSObject()
    let menu = AppDelegate.makeMainMenu(reloadTarget: sentinel, settingsTarget: sentinel)
    for top in menu.items {
        guard let sub = top.submenu else { continue }
        print("menu:\(sub.title)")
        for item in sub.items {
            // Separators are EMITTED, not skipped: their placement is part of
            // the bar a person reads, and skipping them let Quit land flush
            // against Show All without the gate noticing.
            if item.isSeparatorItem { print("  sep"); continue }
            var mods: [String] = []
            if item.keyEquivalentModifierMask.contains(.command) { mods.append("cmd") }
            if item.keyEquivalentModifierMask.contains(.shift) { mods.append("shift") }
            if item.keyEquivalentModifierMask.contains(.option) { mods.append("opt") }
            if item.keyEquivalentModifierMask.contains(.control) { mods.append("ctrl") }
            let key = item.keyEquivalent.isEmpty ? "-" : item.keyEquivalent
            let shortcut = key == "-" ? "-" : (mods.joined(separator: "+") + "+" + key)
            // ⚠️ `target:` IS THE POINT OF THIS COLUMN. Splitting buildMenu
            // into a constructor plus an assignment created a failure mode
            // that did not exist when the menu was built inline: the two
            // targets are now ARGUMENTS, and passing nil for either is a
            // silent regression -- ⌘R reverts to the nil-target behaviour
            // WKWebView swallows, and ⌘, resolves to nothing and greys out
            // permanently. Both are exactly the "appears and is inert"
            // failure this card exists to remove, and a target-blind dump
            // would stay byte-for-byte green through either. The selftest
            // passes a sentinel so this reads `set` for the rows that need
            // one and `-` for the rows that must not have one.
            let target = item.target == nil ? "-" : "set"
            print("  item:\(item.title)\tshortcut:\(shortcut)\taction:\(item.action.map { NSStringFromSelector($0) } ?? "-")\ttarget:\(target)")
        }
    }
    exit(0)
}

// kosmos#1032: the + button opens a file picker, proven by pressing it.
//
// 🛑 THIS GATE EXISTS BECAUSE THE STRUCTURAL VERSION WOULD HAVE PASSED THE BUG.
// "AppDelegate implements runOpenPanelWith" is true of a build where nobody
// assigns `uiDelegate`, and that build is precisely the one that shipped. So
// this drives the real constructor, loads a real page, presses a real button
// and reports whether the app was actually asked for a panel.
//
// ⚠️ IT ALSO PINS THE `hidden` ROW ON PURPOSE. Kosmos's five file inputs all
// carry the bare `hidden` attribute under a global
// `[hidden]{display:none !important}`, and the first explanation for this bug
// was that WebKit refuses a picker for an unrendered input. MEASURED HERE AND
// IN A STANDALONE WKWebView: it does not. Both rows fire. Keeping the hidden
// row means a future reader who reaches for that theory is answered by the
// gate instead of rewriting five inputs for no reason.
if CommandLine.arguments.contains("--kosmos-app-filepanel-selftest") {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let d = AppDelegate()
    let frame = NSRect(x: 0, y: 0, width: 600, height: 300)
    let web = AppDelegate.makeWebView(frame: frame, delegate: d)
    print("uiDelegate:\(web.uiDelegate == nil ? "MISSING" : "set")")
    print("navigationDelegate:\(web.navigationDelegate == nil ? "MISSING" : "set")")

    var fired: [String: Bool] = ["hidden": false, "visible": false]
    var current = "hidden"
    AppDelegate.openPanelPresenter = { _, done in
        fired[current] = true
        done(nil)   // answer, so the input is not left wedged
    }

    // OFFSCREEN ON PURPOSE: this runs inside a release build, and a window
    // flashing up mid-cut reads as the app launching by mistake. The press is
    // driven from JavaScript rather than from real input events, so nothing
    // here needs to be visible or focused.
    let win = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: frame.width, height: frame.height),
                       styleMask: [.titled], backing: .buffered, defer: false)
    win.contentView = web
    win.orderFrontRegardless()
    let probePage = "<!doctype html><meta charset=utf-8>"
        + "<style>[hidden] { display: none !important; }</style>"
        + "<button id=\"bhidden\">h</button><input id=\"fhidden\" type=\"file\" hidden>"
        + "<button id=\"bvisible\">v</button><input id=\"fvisible\" type=\"file\">"
        + "<script>for (const k of ['hidden','visible']) {"
        + "document.getElementById('b'+k).addEventListener('click',"
        + "() => document.getElementById('f'+k).click()); }</script>"
    web.loadHTMLString(probePage, baseURL: URL(string: "http://127.0.0.1/"))

    func press(_ k: String, then: @escaping () -> Void) {
        current = k
        web.evaluateJavaScript("document.getElementById('b\(k)').click()") { _, _ in }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: then)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
        press("hidden") {
            press("visible") {
                print("press:hidden-input\tasked-for-panel:\(fired["hidden"]! ? "yes" : "no")")
                print("press:visible-input\tasked-for-panel:\(fired["visible"]! ? "yes" : "no")")
                guard fired["hidden"]!, fired["visible"]! else { exit(1) }
                // ⭐ THE ARM THAT IS NOT A STUB. Everything above proves the app
                // was ASKED for a panel. It does not prove a panel appears,
                // because the presenter was swapped out. So: put the real one
                // back, press again, and look for an actual panel window. Without
                // this, a runOpenPanelWith that answered and then presented
                // nothing would pass every line above.
                AppDelegate.openPanelPresenter = nil
                current = "real"
                web.evaluateJavaScript("document.getElementById('bvisible').click()") { _, _ in }
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    let panel = NSApp.windows.first { $0 is NSOpenPanel }
                    print("press:real-presenter\tpanel-on-screen:\((panel != nil) ? "yes" : "no")")
                    if let p = panel as? NSOpenPanel {
                        // Dismiss it, or the build hangs behind a dialog.
                        if let host = p.sheetParent { host.endSheet(p, returnCode: .cancel) } else { p.cancel(nil) }
                    }
                    exit(panel != nil ? 0 : 1)
                }
            }
        }
    }
    // A hung run loop must fail, not hang a release cut.
    DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
        print("filepanel selftest TIMED OUT")
        exit(1)
    }
    app.run()
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
