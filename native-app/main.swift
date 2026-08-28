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
            resolvedPort = resolved.port
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

    /// One open panel at a time, because a second one is not queued -- it is
    /// dropped, and a dropped request is a crash.
    private var openPanelOutstanding = false

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        /* 🛑 A RE-ENTRANT REQUEST IS ANSWERED IMMEDIATELY, NOT IGNORED.
           MEASURED on macOS 26: a second `beginSheetModal(for:)` on a window
           that already has a sheet is SILENTLY DROPPED. The panel never becomes
           a sheet, it is not queued, and its completion handler is never
           called -- which, by the rule two comments down, TERMINATES THE APP.
           Refusing the second request with nil costs the person nothing (the
           first panel is still up and still theirs) and removes the whole
           class. Narrow today, because clicking a second + through a sheet is
           hard; free to close. */
        /* ⚠️ SAID, NOT SILENT. This branch introduces the one state in the class
           (`openPanelOutstanding`) that could strand: if a future path ever
           presents without going through one of the two closures that clear it,
           every later + press is refused forever with no diagnostic -- #1032
           reproduced by the code that fixes it. Nothing exercises this branch,
           so a line in the log is the only thing that would ever name it.
           Main-thread only, like every other flag on this delegate: WebKit
           calls this method on the main thread and both sheet completions are
           main-thread, so the flag needs no synchronisation. */
        if openPanelOutstanding {
            logLine("runOpenPanelWith: refused, a panel is already up")
            completionHandler(nil)
            return
        }
        openPanelOutstanding = true
        if let present = AppDelegate.openPanelPresenter {
            present(parameters) { [weak self] urls in
                self?.openPanelOutstanding = false
                completionHandler(urls)
            }
            return
        }
        let panel = NSOpenPanel()
        // The page decides these, not us: a composer that accepts several
        // files says so on its own input, and honouring the flag is what makes
        // `multiple` mean anything.
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories
        /* Sheeted on the window the click came from, so it cannot end up behind
           the board or on the wrong screen.

           🛑 CANCEL MUST ANSWER, AND THE COST IS WORSE THAN IT LOOKS. MEASURED
           by building this delegate with the cancel arm dropped: WebKit does
           not wedge the input quietly, it raises
           NSInternalInconsistencyException, "Completion handler passed to
           -[main.AppDelegate webView:runOpenPanelWithParameters:...] was not
           called", and the app TERMINATES. So a person who opens the file
           picker and presses Cancel would lose Kosmos, mid-conversation, with
           no warning. An earlier version of this comment said it merely broke
           the next press; that was a guess and it was wrong in the direction
           that matters. */
        let host = webView.window
        let answer: (NSApplication.ModalResponse) -> Void = { [weak self] resp in
            self?.openPanelOutstanding = false
            completionHandler(resp == .OK ? panel.urls : nil)
        }
        if let host {
            panel.beginSheetModal(for: host, completionHandler: answer)
        } else {
            panel.begin(completionHandler: answer)
        }
    }

    /* 🛑 EVERY EXTERNAL LINK IN KOSMOS OPENED NOTHING IN THIS APP (#1416),
       INCLUDING FIRST RUN'S "Get a key".

       The board's outward links carry `target="_blank"` -- eleven of them,
       counted on web/index.html. WebKit hands a `_blank` navigation to THIS
       method so the host can decide where a new window goes. The method was
       not implemented, and the default is not "open it here": it is to DROP
       the navigation. No window, no in-place load, no error, no log line.

       ⚠️ WHY IT SURVIVED THIS LONG, and it is the part worth keeping: IT
       WORKS PERFECTLY IN A BROWSER. Anyone testing the board on localhost
       clicks the link and watches it open. Only the app a person actually
       runs is affected, so the environment that would reveal the bug is the
       one nobody tests in.

       📌 `NSWorkspace.shared.open` rather than loading it in the board's own
       web view: these are other people's sites (platform.openai.com,
       installkosmos.com). Navigating the board away from itself to reach one
       would strand the person outside Kosmos with no way back -- this window
       has no address bar and no Back button.

       🔑 THE SCHEME GUARD IS NOT DECORATION. A `_blank` is a request made by
       PAGE CONTENT, and `NSWorkspace.open` will act on any scheme the system
       knows, `file:` included. The eleven real links are all https, so the
       guard costs them nothing and closes the general case rather than the
       instances. Refusing is silent to the person by design; the log line is
       what makes it diagnosable.

       Returning nil tells WebKit no new web view was created, which is
       correct: the navigation has been handled somewhere else entirely. */
    /* 🔑 THE SELECTOR IS PINNED, AND THIS LINE IS THE ACTUAL GUARD.
       `WKUIDelegate`'s methods are OPTIONAL @objc requirements, so a method
       with a slightly wrong Swift signature COMPILES CLEANLY and is simply
       never called -- which is indistinguishable from the bug being fixed
       here. Measured, both arms: dropping `windowFeatures` still typechecks
       exit 0 WITHOUT this line, and fails with it, "'@objc' method name
       provides names for 4 arguments, but method has 3 parameters".
       ⇒ Without the pin, the compiler cannot tell a working fix from a
       decorative one. The selector is the SDK's own, from
       WebKit.framework/Headers/WKUIDelegate.h. */
    @objc(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:)
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else {
            logLine("createWebViewWith: a target=_blank navigation carried no URL")
            showLinkRefusedAlert(detail:
                "A link on this page had no address behind it, so there was nothing to open.")
            return nil
        }
        let scheme = url.scheme?.lowercased() ?? ""
        guard scheme == "http" || scheme == "https" else {
            logLine("createWebViewWith: refused a non-web scheme, " + scheme)
            showLinkRefusedAlert(detail:
                "Kosmos only opens web links, and this one is a \(scheme) link, so it was not "
                + "opened.\n\n\(url.absoluteString)")
            return nil
        }
        NSWorkspace.shared.open(url)
        return nil
    }

    /* 🛑 THE REFUSAL SPEAKS, AND THAT IS THE WHOLE POINT OF IT (Baron Draxum,
       reviewing #1416).

       A guard that drops a click SILENTLY is not a safer version of this bug,
       IT IS THIS BUG. The defect being fixed here is "the person clicks and
       nothing happens, with no error and no log line the person can see", and
       a scheme guard whose only output is a log line reproduces that exactly,
       for whoever meets it first.

       ⚠️ Measured today: every link the app can reach is https, so nothing
       hits this path now. That is precisely why it must speak: a branch that
       nothing exercises is one nobody will think to check, and the FIRST
       person to meet it would otherwise meet the original silence.

       📌 The address is in the alert on purpose, so a person who wanted that
       page can still get to it by copying the line, rather than being told
       only that they cannot. */
    private func showLinkRefusedAlert(detail: String) {
        let alert = NSAlert()
        alert.messageText = "Kosmos could not open that link"
        alert.informativeText = detail
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }


    // MARK: The app and the board are different processes (kosmos#1042)

    /* 🛑 THERE IS NO SINGLE "VERSION OF KOSMOS", AND THAT IS THE WHOLE CARD.
       Measured by Ice Cream Kitty on the coordinator, 2026-08-26:

         an update           restarts the BOARD and leaves this app running
         a quit-and-reopen   restarts this APP and leaves the board running

       Neither half ever restarts the other, so the two can be, and normally
       are, different versions. Josh spent an hour on it: the page was current,
       the menu bar was a week old, and every version on screen was the BOARD's,
       so nothing he could look at would have told him.

       ⚠️ AND IT IS WHY THIS CANNOT SAY "RELOAD". Reloading updates one half.
       The remedy for a stale app is to quit and open it again, which Kitty also
       measured as a non-event on the coordinator: same mac id, every paired
       device stays paired, nothing to sign in to again. So it is safe advice,
       which is the only reason it is offered here. */
    /* 🔑 THE BUTTONS AS DATA, so a gate can read which one holds Return WITHOUT
       a window server. This file already argues the case at the menu bar: a key
       equivalent is invisible until somebody presses it, so the check has to be
       machine-run. The notice's own buttons were the one thing in this change
       no selftest could reach, because they were built at the use site.
       ⚠️ Kept PURE deliberately. Constructing an NSAlert here would make the
       #1042 gate need a window server, and it would then SKIP on a headless
       build box, which is exactly the property that makes this gate better than
       its sibling. */
    static let relaunchButtons: (titles: [String], returnIndex: Int, destructiveIndex: Int) =
        (["Quit and Open Again", "Not Now"], 1, 0)

    /// The key equivalent for each button, DERIVED from the spec.
    ///
    /// 🛑 THIS FUNCTION EXISTS BECAUSE THE GATE WITHOUT IT COULD NOT FAIL. An
    /// earlier version assigned the key equivalents to hardcoded locals and had
    /// the selftest assert `returnIndex != destructiveIndex` -- a property of
    /// the tuple literal, not of the alert anyone sees. Measured by mutation:
    /// swapping the two hardcoded assignments makes a reflexive Return QUIT THE
    /// APP, and the gate printed "Return lands on Not Now" and passed. So did
    /// inverting the spec, and so did swapping the two titles. The only mutant
    /// it caught was a degenerate one nobody would write.
    /// ⭐ A check that reads one thing and vouches for another is worse than no
    /// check: it is a reassuring sentence over the defect it names.
    static func relaunchKeyEquivalents(_ spec: (titles: [String], returnIndex: Int, destructiveIndex: Int)) -> [String] {
        spec.titles.indices.map { $0 == spec.returnIndex ? "\r" : "" }
    }

    /* 🛑 THE QUIT DIALOG'S BUTTONS (#1316). Josh, 2026-08-28: "we also need a
       Cancel here, probably below Close the App... Right now I hit it and if I'm
       like 'Oh crap, I didn't mean to quit the app,' I'm stuck."

       It shipped with ONE button, and `showQuitDialog`'s own comment said the
       second was expected: "when the second button is added, branch here." It
       never was, and the code returned true for ANY dismissal.
       ⚠️ SO ESCAPE QUIT THE APP. Not "Escape did nothing" -- an NSAlert with one
       button returns on Escape too, and every return was read as confirmation.
       The only way out of a dialog about quitting was to quit.

       ⭐ ENTER STAYS ON THE DESTRUCTIVE BUTTON HERE, AND THAT IS A DELIBERATE
       DIVERGENCE FROM `relaunchButtons`, WHICH PUTS IT ON THE HARMLESS ONE.
       The difference is bidden versus unbidden. The relaunch notice ARRIVES over
       whatever the person was doing, so a reflexive Return must not quit. This
       dialog only appears because the person just pressed Cmd-Q, so Return
       confirming what they asked for is the expected thing, and moving it would
       silently break the deliberate quit that works today.
       ⇒ ESCAPE is what answers Josh's case, and it is the right key for it: he
       hit Cmd-Q, so his hands are already on the keyboard. */
    static let quitButtons: (titles: [String], returnIndex: Int, destructiveIndex: Int, cancelIndex: Int) =
        (["Close the app", "Cancel"], 0, 0, 1)

    /* The key equivalents, DERIVED, for the same reason `relaunchKeyEquivalents`
       exists: hardcoded assignments made the gate unable to fail. A separate
       function rather than a parameter on that one because this alert needs a
       SECOND key (Escape) that the relaunch alert has no button for. */
    static func quitKeyEquivalents(
        _ spec: (titles: [String], returnIndex: Int, destructiveIndex: Int, cancelIndex: Int)
    ) -> [String] {
        spec.titles.indices.map {
            if $0 == spec.cancelIndex { return "\u{1b}" }
            if $0 == spec.returnIndex { return "\r" }
            return ""
        }
    }

    /* 🛑 #1182: "QUIT AND OPEN AGAIN" LOOPS FOREVER WHEN THE BUNDLE IS THE STALE
       THING. Josh, 2026-08-27, on a fresh second macOS user: "I keep hitting Quit
       and Open Again and it just gets caught in a loop: it'll quit, it'll open
       again, and it'll pop up this message again. Eventually I just have to hit
       Not Now, which, as a user, makes me think I'm indicating I don't want to do
       the update."

       The notice above was already honest about this in its comment -- `make_app`
       failing is non-fatal to an install, "which leaves the icon on the old
       version while the board moves on. In that state reopening changes nothing,
       and this notice returns on every launch." THE CODE KNEW. It just kept
       offering the action anyway, because nothing carried the knowledge across
       the relaunch it had just performed.

       🔑 THE ONE FACT THAT SETTLES IT, AND THE APP CAN OBSERVE IT ALONE: if we
       relaunched because of this notice and the replacement came up at the SAME
       version, reopening demonstrably does not work HERE. That is measured on
       this machine, not inferred from a cause we cannot see -- which matters,
       because the three documented causes (a foreign app home, a failed bundle
       build, a TCC denial on /Applications) are indistinguishable from inside the
       app and we must not name one we have not established.

       ⚠️ SO THE SECOND NOTICE PROMISES NOTHING AND OFFERS NO ACTION THAT LOOPS.
       It says what is true, says the person is not losing anything, and stops. */
    enum StaleAdvice: Equatable {
        /// Not behind, or nothing we have a remedy for: the person is told nothing.
        case silent
        /// First time: reopening has not been tried at this version, and it usually works.
        case offerRelaunch
        /// We already reopened at this exact version and came back to it. Reopening
        /// is not the remedy and must not be offered a second time.
        case cannotSelfHeal
    }

    /// The whole #1182 decision, PURE so the headless gate can reach it.
    ///
    /// ⚠️ KEYED ON `mine`, NOT ON A BARE "we relaunched once" FLAG. The board
    /// moving 0.5.88 -> 0.5.89 while this window sits at 0.5.87 is the expected
    /// case, not an edge one, so a flag keyed on `theirs` would re-arm the loop
    /// on every board release. What we learned is about THIS bundle: reopening
    /// did not move `mine`. That stays true whatever the board does next.
    static func staleAdvice(mine: String, theirs: String,
                            relaunchedAt: String?) -> StaleAdvice {
        guard isBehind(mine, theirs) == true else { return .silent }
        return relaunchedAt == mine ? .cannotSelfHeal : .offerRelaunch
    }

    /* ⚠️ A SEPARATE SPEC, NOT A REUSE WITH A SWAPPED TITLE. This notice has NO
       destructive button: nothing here quits, because quitting is the action
       that did not help. `destructiveIndex` is deliberately -1 so that any code
       or gate that reaches for "the button that quits" finds nothing rather than
       finding the wrong one -- the exact failure the sibling spec's own comment
       records, where swapping two titles moved the quit and every index-only
       check still passed.
       🔑 AND THE DISMISS IS NOT "Not Now". That was the whole second half of the
       complaint: it is the only exit and it reads as declining the update. */
    static let cannotSelfHealButtons: (titles: [String], returnIndex: Int, destructiveIndex: Int) =
        (["Keep Working"], 0, -1)

    private var staleAppNoticeShown = false
    /* #1182. The version this app was running when the person last accepted
       "Quit and Open Again". Survives the relaunch it describes, which is the
       whole point: the loop is only visible ACROSS a restart, so the one fact
       that breaks it has to outlive the process that learned it.
       ⚠️ UserDefaults, not the diagnostic log. The log is prose for a human to
       read after the fact; this is a value the next launch has to branch on, and
       parsing our own log back would make a sentence load-bearing. */
    private static let relaunchedAtKey = "kosmos.relaunchedAtVersion"
    private var relaunchedAtVersion: String? {
        get { UserDefaults.standard.string(forKey: Self.relaunchedAtKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.relaunchedAtKey) }
    }
    /// The app-AHEAD-of-board case says nothing to the person, so nothing
    /// latches -- and the request repeats on every navigation, so without this
    /// the log line repeated with it, forever, in the app's single diagnostic
    /// file. Logged once, like the notice.
    private var loggedVersionMismatch: String?
    /* 🛑 ONE LINE PER REASON PER LAUNCH, NOT ONE PER NAVIGATION. `didFinish`
       fires on every main-frame navigation -- Cmd-R, the Settings item's
       location.assign, the board's own reloads -- so the check below repeats
       until the notice fires. Logging each quiet exit unlatched would bury the
       diagnostic file under the same sentence. Keyed like
       loggedVersionMismatch above rather than a bare flag, so a DIFFERENT
       reason later still gets its line. */
    private var loggedQuietStaleReasons = Set<String>()
    /// The port the board was resolved to, kept so the #1042 check can ask it
    /// its version after the page loads. Written once, where the install is
    /// resolved; nil until then, and the check simply does not run.
    private var resolvedPort: Int?

    /// This app's own version, from the bundle it was LAUNCHED from.
    /// ⚠️ MEASURED AGAINST THE MECHANISM THAT ACTUALLY HAPPENS, which is not a
    /// plist rewrite. `install/setup.sh` moves the whole bundle aside, moves a
    /// freshly built tree into place, and removes the aside: rename-and-replace.
    /// An earlier version of this comment claimed a measurement against an
    /// in-place rewrite, which is a different filesystem event and proved
    /// nothing about the shipped path. Both are now measured, in a real .app,
    /// in both read orders: `Bundle.main` reports the code actually RUNNING,
    /// never the newer bundle at the same path. That is the whole reason the
    /// comparison below means anything.
    private func runningAppVersion() -> String? {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
    }

    /// `a.b.c` as integers, or nil when it is not that shape.
    /// 📌 No semver cleverness: a prerelease suffix or a hand-edited value gives
    /// nil, and nil means "differ, direction unknown", which shows nothing. An
    /// invented ordering would produce a confident instruction in the one case
    /// we cannot read.
    private static func versionParts(_ s: String) -> [Int]? {
        /* ⚠️ `omittingEmptySubsequences: false`, AND A DIGITS-ONLY CHECK, because
           the promise above is "nil, never a guess" and the obvious version was
           not keeping it. Measured on the same function: `.0.5.73`, `0..5.73`,
           `0.5.73.` and `0.5.73..` all parsed confidently as [0,5,73] (split
           drops empty pieces by default), and `0.5.-1` parsed as [0,5,-1],
           which then answers BEHIND. A promise a caller relies on has to be
           true for the inputs nobody expects, or it is decoration. */
        let bits = s.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard bits.count == 3 else { return nil }
        /* ⚠️ `isNumber` IS THE ONLY CLAUSE THAT DECIDES ANYTHING, and it is here
           alone for that reason. An earlier version also required non-empty and
           ASCII. Both were DEAD, proven by mutation: removing either, or both,
           leaves the selftest fully green, because `omittingEmptySubsequences:
           false` already turns a dotted edge case into four pieces that the
           count guard rejects, and Swift's `Int(String)` already accepts ASCII
           digits only. What `isNumber` catches that `Int` does not is a SIGN:
           `Int("-1")` and `Int("+5")` both succeed, and `0.5.-1` then answered
           BEHIND. Guards nothing can detect the removal of are not protection,
           they are decoration that makes a reader stop looking. */
        guard bits.allSatisfy({ $0.allSatisfy(\.isNumber) }) else { return nil }
        let nums = bits.compactMap { Int($0) }
        return nums.count == 3 ? nums : nil
    }

    /// The hatch's only door in. `private` otherwise: nothing in the product
    /// calls this except the check above.
    static func isBehindForTest(_ mine: String, _ theirs: String) -> Bool? { isBehind(mine, theirs) }

    /* 🛑 THE VERDICT IS THREE-STATE AND THE LOG USED TO BE TWO. `isBehind`
       returns `Bool?` on purpose -- the selftest below has an explicit row for
       it, "a shape we cannot read is UNKNOWN, never a guess" -- and then its
       ONLY caller wrote `== true` and sent both `false` and `nil` down one
       branch, which logged "not the behind case" either way.
       ⚠️ SO THE DIAGNOSTIC CLAIMED A COMPARISON THAT NEVER HAPPENED. A version
       neither side could parse was recorded as a measured not-behind, in the
       one file somebody reads when the notice failed to appear. The care taken
       to preserve UNKNOWN was undone one line after it was computed.
       📌 The BEHAVIOUR is unchanged and deliberately so: both cases still say
       nothing to the person, because we have a measured remedy for neither.
       Only the record of why becomes true.
       🔑 A PURE FUNCTION SO IT CAN BE TESTED. The caller is a URLSession
       callback and no selftest can reach it; this is the part that was wrong,
       and it is now the part that is reachable. Same trick as the hatch above. */
    /* The stale check's quiet exits, said once each.
       🛑 WHY THIS EXISTS AT ALL. #1042's symptom is "the notice did not
       appear", and this function had SIX ways to return having said nothing:
       no readable app version, an unbuildable URL, no answer from the board,
       an answer with no readable version, the versions being equal, and the
       notice already shown. Only the last two are correct silences. The other
       four left no trace, so a person debugging a missing notice could not
       tell WHICH of them happened -- or whether the check had run at all.
       ⚠️ A SILENCE WITH FOUR CAUSES AND ONE APPEARANCE is the same defect the
       fleet spent 2026-08-27 finding in its own instruments, and this one is
       in the product, on the card whose whole difficulty is that it cannot be
       tested on this machine.
       📌 Says the reason, never a remedy. We have no measured fix for any of
       these, and inventing one is the defect the card is about. */
    private func sayQuietStaleReason(_ reason: String) {
        DispatchQueue.main.async {
            guard self.loggedQuietStaleReasons.insert(reason).inserted else { return }
            logLine("stale check said nothing: " + reason)
        }
    }

    static func staleLogSentence(mine: String, theirs: String, verdict: Bool?) -> String {
        if verdict == nil {
            return "version mismatch, app \(mine) board \(theirs), COULD NOT COMPARE the two versions; saying nothing"
        }
        return "version mismatch, app \(mine) board \(theirs), not the behind case; saying nothing"
    }

    private static func isBehind(_ mine: String, _ theirs: String) -> Bool? {
        guard let a = versionParts(mine), let b = versionParts(theirs) else { return nil }
        for (x, y) in zip(a, b) where x != y { return x < y }
        return false
    }

    /// Ask the board what version it is, once, after the page has loaded.
    private func checkWhetherThisAppIsBehind(port: Int) {
        guard !staleAppNoticeShown else { return }
        guard let mine = runningAppVersion() else {
            sayQuietStaleReason("this app carries no CFBundleShortVersionString, so there is nothing to compare")
            return
        }
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/status") else {
            sayQuietStaleReason("could not build the status URL for port \(port)")
            return
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = 8
        req.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let self else { return }
            guard let data else {
                self.sayQuietStaleReason("the board did not answer /api/status")
                return
            }
            guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let theirs = obj["version"] as? String, !theirs.isEmpty else {
                self.sayQuietStaleReason("the board's answer carried no readable version")
                return
            }
            /* The two CORRECT silences are left silent on purpose: equal
               versions below, and the notice already shown above. Logging a
               non-event is how a diagnostic file stops being read. */
            guard theirs != mine else { return }
            /* ⚠️ ONLY THE DIRECTION WE HAVE A MEASURED REMEDY FOR. A board that
               is BEHIND this app is a real mismatch and we have no verified fix
               for it, so it is logged and the person is told nothing. Inventing
               an instruction for the case we have not measured is how a screen
               starts saying things that are not true, which is the defect this
               card is about. */
            let verdict = Self.isBehind(mine, theirs)
            guard verdict == true else {
                /* ⚠️ ONTO THE MAIN THREAD TO LOG. `logLine` is open, seek, write,
                   close with no lock, and every other one of its ~30 call sites
                   is main-thread. This callback is a URLSession one, so writing
                   here directly made this the file's only concurrent writer to
                   the app's single diagnostic file: the file every other fault
                   would be read from. */
                DispatchQueue.main.async {
                    /* ⚠️ KEYED ON THE PAIR, not a bare flag. A plain latch also
                       silenced every LATER mismatch with a different board
                       version -- and the board restarting into a new version
                       while this app keeps running is this card's own premise,
                       so the second and third are the expected events, not edge
                       cases. The diagnostic file would have frozen on a pair
                       that had stopped being true. */
                    let pair = "\(mine)|\(theirs)"
                    guard self.loggedVersionMismatch != pair else { return }
                    self.loggedVersionMismatch = pair
                    logLine(Self.staleLogSentence(mine: mine, theirs: theirs, verdict: verdict))
                }
                return
            }
            DispatchQueue.main.async {
                guard !self.staleAppNoticeShown else { return }
                self.staleAppNoticeShown = true
                self.offerRelaunch(mine: mine, theirs: theirs)
            }
        }.resume()
    }

    private func offerRelaunch(mine: String, theirs: String) {
        /* #1182. Reopening was already tried at this exact version and we are
           still here, so it is not the remedy. Say so, offer nothing that loops,
           and do not quit: the person keeps the working window they have. */
        if Self.staleAdvice(mine: mine, theirs: theirs,
                            relaunchedAt: relaunchedAtVersion) == .cannotSelfHeal {
            logLine("relaunch: already reopened at \(mine) and came back to it; "
                    + "reopening is not the remedy, showing the honest notice instead")
            showCannotSelfHeal(mine: mine, theirs: theirs)
            return
        }
        window?.makeKeyAndOrderFront(nil)
        let alert = NSAlert()
        alert.messageText = "Kosmos updated while this window was open"
        /* ⚠️ "SHOULD", NOT "DOES". `make_app` failing is NON-FATAL to an install
           (a foreign app home, a failed bundle build, a TCC denial on
           /Applications), which leaves the icon on the old version while the
           board moves on. In that state reopening changes nothing, and this
           notice returns on every launch. Saying "catches it up" as flat fact
           would be the screen asserting something it cannot know, which is the
           defect this card is about. The last sentence is the one that IS
           measured (Kitty, on the coordinator) and it is what makes the advice
           safe to give at all. */
        alert.informativeText = "This window is still running version \(mine). The rest of "
            + "Kosmos is on \(theirs). Opening it again should catch it up. Your agents keep "
            + "running and nothing needs signing in to again."
        alert.alertStyle = .informational
        let spec = AppDelegate.relaunchButtons
        let keys = AppDelegate.relaunchKeyEquivalents(spec)
        for (i, title) in spec.titles.enumerated() {
            alert.addButton(withTitle: title).keyEquivalent = keys[i]
        }
        /* 🔑 ENTER LANDS ON THE HARMLESS CHOICE. This notice arrives UNBIDDEN
           over whatever the person was doing, so a reflexive Return must not
           quit their app. `showQuitDialog` states this rule for itself, though
           it does not demonstrate it (its only button is the one that quits),
           so this is the rule applied rather than a pattern copied.
           ⚠️ THE BUTTONS ARE CAPTURED, NOT LOOKED UP. `alert.buttons.first?`
           no-ops if the array is ever empty, and the failure mode is BOTH
           buttons holding Return with the destructive one winning: silent, and
           in the dangerous direction. */
        /* ⚠️ THE ACCEPT BRANCH IS DERIVED TOO, not a literal
           `.alertFirstButtonReturn`. With the literal, swapping the two TITLES
           inverted the product silently: the person clicking "Not Now" got the
           quit. The button that quits is the one at destructiveIndex, by
           definition, and that is now what is asked. */
        let clicked = alert.runModal().rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
        guard clicked == spec.destructiveIndex else { return }

        /* 🛑 #1182: WRITTEN BEFORE THE RELAUNCH, NOT AFTER IT. There is no after:
           this process calls NSApp.terminate a few lines down, so anything
           recorded "once the replacement is up" is recorded by nobody. If the
           relaunch fails instead, the value is still correct -- we DID try at
           this version -- and the failure path below tells the person directly. */
        relaunchedAtVersion = mine

        /* 🛑 NEVER QUIT UNTIL THE REPLACEMENT IS ACTUALLY COMING. Terminating
           first and hoping is how a person ends up with no Kosmos at all, which
           is far worse than the stale menu bar this fixes. The new instance is
           launched FIRST, and this one only exits once macOS confirms it. */
        let conf = NSWorkspace.OpenConfiguration()
        conf.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: conf) { app, err in
            DispatchQueue.main.async {
                if app != nil, err == nil {
                    logLine("relaunch: replacement started, this instance is exiting")
                    /* 🛑 THE PERSON HAS ALREADY ANSWERED. `NSApp.terminate` re-enters
                       `applicationShouldTerminate`, which shows the quit dialog unless
                       this flag is set -- so without it they click "Quit and Open
                       Again" and are handed a SECOND, unrelated modal asking whether
                       to close the app, with the replacement's window already on
                       screen behind it. Two windows, one of them modal, over a
                       question they did not ask. The file names this seam at the
                       Cmd-Q site; this call site is the one that did not. */
                    self.isActuallyQuitting = true
                    NSApp.terminate(nil)
                    return
                }
                logLine("relaunch FAILED: \(err?.localizedDescription ?? "no app handle"); staying open")
                let f = NSAlert()
                f.messageText = "Kosmos could not open a new window"
                f.informativeText = "This window is still working and still on version \(mine). "
                    + "Quit Kosmos and open it from your Applications folder when you get a moment."
                f.alertStyle = .warning
                f.addButton(withTitle: "OK")
                f.runModal()
            }
        }
    }

    /* 🛑 #1182: THE NOTICE FOR WHEN REOPENING HAS ALREADY BEEN TRIED AND FAILED.
       Three rules, each of them a thing the looping notice got wrong:

       1. IT PROMISES NOTHING. The first notice says reopening "should" catch it
          up, hedged deliberately. By the time we are here that hedge has resolved
          the wrong way ON THIS MACHINE, so there is nothing left to hedge and no
          instruction we have measured. Saying "reinstall and it will be fixed"
          would be the screen asserting an outcome it cannot know -- the same
          defect, one step further along.

       2. IT NAMES NO CAUSE. `make_app`'s three documented failure causes are
          indistinguishable from inside this app. A sentence blaming permissions
          would be a guess printed as a finding, and a person acting on the wrong
          one is worse off than a person told plainly that we cannot tell.

       3. IT SAYS WHAT IS NOT BROKEN, because that is the part the person cannot
          see and the part they are actually worried about. Their agents are
          fine; this window is a stale viewer of a board that is up to date.

       ⚠️ AND IT SHOWS ONCE. `staleAppNoticeShown` already latches per launch, but
       the complaint was that the notice "returns on every launch" -- true, because
       every launch is a new process. Once we know reopening cannot fix it, saying
       so again next time is nagging about something the person cannot act on from
       here, so the marker is CLEARED after telling them once and the notice does
       not come back for this version pair. */
    private func showCannotSelfHeal(mine: String, theirs: String) {
        window?.makeKeyAndOrderFront(nil)
        let alert = NSAlert()
        alert.messageText = "This window cannot update itself"
        alert.informativeText = "It is running version \(mine) and the rest of Kosmos is on "
            + "\(theirs). Opening it again has already been tried and did not change that, so "
            + "Kosmos will stop asking. Your agents are running normally and nothing needs "
            + "signing in to again. Installing Kosmos again is what replaces this window."
        alert.alertStyle = .informational
        let spec = AppDelegate.cannotSelfHealButtons
        for (i, title) in spec.titles.enumerated() {
            alert.addButton(withTitle: title).keyEquivalent = (i == spec.returnIndex) ? "\r" : ""
        }
        /* 🔑 CLEARED BEFORE THE MODAL, NOT AFTER. `runModal` blocks, and a person
           who force-quits the app while this is on screen would otherwise be told
           the same thing again next launch -- the nagging this exists to end. */
        relaunchedAtVersion = nil
        logLine("relaunch: told the person this window cannot self-update (\(mine) vs \(theirs)); not asking again")
        alert.runModal()
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
        /* #1042: asked after the board has answered, and the NOTICE is shown at
           most once per launch.
           ⚠️ NOT "once", which an earlier version of this comment claimed.
           `didFinish` fires on every main-frame navigation -- Cmd-R, the
           Settings item's location.assign, and the board's own reloads -- so
           the REQUEST repeats until the notice fires. That is cheap next to the
           board's own five-second poll of the same route, and it is stated
           rather than implied because the next reader will trust the sentence
           and not the code. */
        if let port = resolvedPort { checkWhetherThisAppIsBehind(port: port) }
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
        let spec = AppDelegate.quitButtons
        let keys = AppDelegate.quitKeyEquivalents(spec)
        for (i, title) in spec.titles.enumerated() {
            alert.addButton(withTitle: title).keyEquivalent = keys[i]
        }
        /* ⚠️ THE ACCEPT BRANCH IS DERIVED, not a literal `.alertFirstButtonReturn`,
           the same discipline the relaunch alert states: with the literal,
           swapping the two TITLES inverts the product silently and the person
           pressing Cancel gets the quit. The button that quits is the one at
           destructiveIndex, by definition, and that is what is asked. */
        let clicked = alert.runModal().rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
        guard clicked == spec.destructiveIndex else {
            logLine("showQuitDialog: cancelled, the window stays open")
            return false
        }
        logLine("showQuitDialog: confirmed quit")
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
    /* ⚠️ `d` IS THE ONLY STRONG REFERENCE, AND BOTH DELEGATE PROPERTIES ARE
       WEAK. Nothing reads `d` after the webView is built, so at -O the
       optimizer is entitled to release it before the first press -- and the
       failure would be `asked-for-panel:no` on a GOOD build, stopping a
       release and blaming the product. It survives on Apple Swift 6.3.3 /
       macOS 26 today, which makes this latent rather than live, and a gate
       whose correctness depends on optimizer behaviour is not a gate.
       `withExtendedLifetime` around the run loop removes the dependence. */
    let d = AppDelegate()
    let frame = NSRect(x: 0, y: 0, width: 600, height: 300)
    let web = AppDelegate.makeWebView(frame: frame, delegate: d)
    print("uiDelegate:\(web.uiDelegate == nil ? "MISSING" : "set")")
    print("navigationDelegate:\(web.navigationDelegate == nil ? "MISSING" : "set")")

    var fired: [String: Bool] = ["hidden": false, "visible": false, "again": false]
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
        + "() => document.getElementById('f'+k).click()); }"
        // ⚠️ SET LAST, AND POLLED INSTEAD OF THE BUTTON. The button exists in
        // the DOM before this script runs, so polling for it opens a window
        // where a press lands on a control with no listener -- and the gate
        // would report asked-for-panel:no, which is a false accusation.
        + "window.__probeReady = 1;</script>"
    web.loadHTMLString(probePage, baseURL: URL(string: "http://127.0.0.1/"))

    func press(_ k: String, then: @escaping () -> Void) {
        current = k
        web.evaluateJavaScript("document.getElementById('b\(k)').click()") { _, _ in }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: then)
    }
    /* ⚠️ WAIT FOR THE PAGE, DO NOT GUESS AT IT. A fixed sleep here is a race
       the gate loses by ACCUSING A GOOD BINARY: measured, at 0.05s an
       otherwise-unmodified build prints asked-for-panel:no and the shell
       renders that as "the + button will do nothing". This gate runs mid-build,
       after a Node download and a codesign, on whatever the box is doing. So
       it polls for the button the presses need and only then starts. */
    /* 🛑 THE GIVING-UP MESSAGE CARRIES THE WATCHDOG'S OWN TOKEN, AND THAT IS THE
       POINT OF IT. Exhausting this poll means the gate could not get started,
       not that the + button is dead -- and the previous version of this line
       said something the bundle gate classified as a PRODUCT failure, which is
       the exact defect the commit that added this poll set out to remove. The
       fix removed one instance and shipped another. `filepanel selftest TIMED
       OUT` is the unique string the shell keys its gate-fault arm on.
       Budget: 150 x 0.1s = 15s, inside the hatch's own 25s watchdog and the
       shell's 40s alarm. The page loads in well under half a second here, so
       this is ~30x the observed margin rather than the ~12x it was. The whole
       run is about 7s, so there was budget going spare. */
    func whenReady(_ go: @escaping () -> Void, tries: Int = 150) {
        web.evaluateJavaScript("window.__probeReady === 1") { r, _ in
            if (r as? Bool) == true { go(); return }
            guard tries > 0 else {
                print("filepanel selftest TIMED OUT: the probe page never finished loading")
                exit(1)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { whenReady(go, tries: tries - 1) }
        }
    }
    whenReady {
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
                    /* `isVisible`, not merely present in NSApp.windows: the
                       line is called panel-on-screen and it should mean it. A
                       panel constructed and never presented IS in that array. */
                    let panel = NSApp.windows.first { $0 is NSOpenPanel && $0.isVisible }
                    print("press:real-presenter\tpanel-on-screen:\((panel != nil) ? "yes" : "no")")
                    guard let p = panel as? NSOpenPanel else { exit(1) }
                    // Dismiss it, or the build hangs behind a dialog.
                    if let host = p.sheetParent { host.endSheet(p, returnCode: .cancel) } else { p.cancel(nil) }

                    /* ⭐ AND THEN PRESS AGAIN, because the one behaviour the fix
                       singles out is the one nothing here was watching. An
                       `NSOpenPanel` that is dismissed without calling the
                       completion handler leaves the file input WEDGED: WebKit
                       is still waiting for the last answer, and the NEXT press
                       does nothing for the rest of the session. So a cancel is
                       not the end of the check, it is the setup for it. This
                       arm fails if the cancel arm is ever dropped. */
                    AppDelegate.openPanelPresenter = { _, done in
                        fired["again"] = true
                        done(nil)
                    }
                    current = "again"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                        web.evaluateJavaScript("document.getElementById('bvisible').click()") { _, _ in }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                            let again = fired["again"] ?? false
                            print("press:after-a-cancel\treaches-the-app-again:\(again ? "yes" : "no")")
                            exit(again ? 0 : 1)
                        }
                    }
                }
            }
        }
    }
    // A hung run loop must fail, not hang a release cut.
    DispatchQueue.main.asyncAfter(deadline: .now() + 25) {
        print("filepanel selftest TIMED OUT")
        exit(1)
    }
    withExtendedLifetime(d) { app.run() }
    /* 🛑 EVERY OTHER HATCH IN THIS FILE ENDS IN exit(). Without this, a run
       loop that ever returns falls straight through into the real app below --
       launched .accessory, and with `openPanelPresenter` still pointing at the
       stub that answers nil, which is this bug reproduced silently by the code
       that fixes it. I could not make app.run() return here, so this is latent
       rather than live; it is one line and the blast radius is the whole
       product. */
    exit(1)
}

// #1042: the version comparison that decides whether a person is TOLD anything.
//
// 🛑 IT IS TESTED BECAUSE GETTING IT WRONG IS SILENT IN BOTH DIRECTIONS. Too
// eager and the app nags about a mismatch that is not there; too shy and it
// stays quiet on exactly the state that cost an hour. Neither shows up on any
// screen as a fault.
//
// ⭐ THE ROW THAT EARNS THIS FILE IS 0.5.9 vs 0.5.10. A string comparison says
// "0.5.9" > "0.5.10", because "9" sorts after "1". So a lexical check goes
// SILENT at exactly the version where the minor number gains a digit, and it
// would have looked correct on every version we have shipped so far.
if CommandLine.arguments.contains("--kosmos-app-stale-selftest") {
    var bad = 0
    var ran = 0
    var sawLexicalRow = false
    var sawUnknownLogRow = false
    func check(_ mine: String, _ theirs: String, _ want: Bool?, _ why: String) {
        ran += 1
        if mine == "0.5.9" && theirs == "0.5.10" { sawLexicalRow = true }
        let got = AppDelegate.isBehindForTest(mine, theirs)
        let ok = got == want
        if !ok { bad += 1 }
        let show = { (v: Bool?) in v == nil ? "unknown" : (v! ? "behind" : "not-behind") }
        print((ok ? "PASS  " : "FAIL  ") + mine.padding(toLength: 12, withPad: " ", startingAt: 0)
              + "vs " + theirs.padding(toLength: 12, withPad: " ", startingAt: 0)
              + "-> " + show(got).padding(toLength: 12, withPad: " ", startingAt: 0) + why)
    }
    check("0.5.71", "0.5.73", true,  "the reported case: the app is a release behind")
    check("0.5.73", "0.5.73", false, "same version is not behind")
    check("0.5.74", "0.5.73", false, "AHEAD is not behind, and gets no dialog")
    check("0.5.9",  "0.5.10", true,  "NUMERIC, not lexical: a string compare says otherwise")
    check("0.5.10", "0.5.9",  false, "and the inverse of that row")
    check("0.6.0",  "0.5.99", false, "the major-minor beats the patch")
    check("1.0.0",  "0.9.9",  false, "same, one level up")
    check("0.5.73-rc1", "0.5.73", nil, "a shape we cannot read is UNKNOWN, never a guess")
    check("nonsense", "0.5.73", nil,  "and so is a value nobody parsed")
    check("0.5.73", "",       nil,   "an empty answer from the board is unknown too")

    /* 🛑 THE SENTENCE THE DIAGNOSTIC GETS, which is where the three-state
       verdict used to die. These rows are not about the comparison -- the rows
       above already prove that -- they are about whether the RECORD of it
       distinguishes "we compared and it is not behind" from "we could not
       compare at all". It did not, and both read as the former. */
    func checkSentence(_ mine: String, _ theirs: String, _ mustSay: String, _ mustNotSay: String, _ why: String) {
        ran += 1
        let verdict = AppDelegate.isBehindForTest(mine, theirs)
        let line = AppDelegate.staleLogSentence(mine: mine, theirs: theirs, verdict: verdict)
        if mustSay == "COULD NOT COMPARE" { sawUnknownLogRow = true }
        let ok = line.contains(mustSay) && !line.contains(mustNotSay)
        if !ok { bad += 1 }
        print((ok ? "PASS  " : "FAIL  ") + "log ".padding(toLength: 4, withPad: " ", startingAt: 0)
              + mine.padding(toLength: 12, withPad: " ", startingAt: 0)
              + "vs " + theirs.padding(toLength: 12, withPad: " ", startingAt: 0)
              + "-> " + why)
        if !ok { print("      got: " + line) }
    }
    checkSentence("0.5.74", "0.5.73", "not the behind case", "COULD NOT COMPARE",
                  "a real not-behind still says not-behind")
    checkSentence("0.5.73-rc1", "0.5.73", "COULD NOT COMPARE", "not the behind case",
                  "an unreadable version must NOT be recorded as a measured not-behind")
    checkSentence("nonsense", "0.5.73", "COULD NOT COMPARE", "not the behind case",
                  "and neither must a value nobody parsed")
    checkSentence("0.5.73", "", "COULD NOT COMPARE", "not the behind case",
                  "nor an empty answer from the board")
    /* ⭐ THE ROWS THE PROMISE WAS FALSE ON, and stated exactly rather than
       broadly, because an earlier version of this comment claimed more than was
       measured. Run against the pre-fix parser:
         .0.5.73  0..5.73  0.5.73.   parsed as [0,5,73], answering NOT-BEHIND
         0.5.-1                      parsed as [0,5,-1], answering BEHIND
         0.+5.9                      parsed as [0,5,9],  answering BEHIND
         0.5.٧                       ALREADY nil before the fix
       So five were guesses, two of those were wrong in the dangerous
       direction, and the last row is a control rather than new coverage: it
       passes on the old parser too, and it is kept to pin that behaviour. */
    check(".0.5.73", "0.5.73", nil,  "a leading dot is not a version")
    check("0..5.73", "0.5.73", nil,  "nor is an empty middle")
    check("0.5.73.", "0.5.73", nil,  "nor a trailing dot")
    check("0.5.-1",  "0.5.73", nil,  "a NEGATIVE part used to answer behind")
    check("0.+5.9",  "0.5.10", nil,  "and a signed one used to parse")
    check("0.5.٧",   "0.5.73", nil,  "CONTROL: already nil before the fix, pinned so it stays nil")
    /* The notice's buttons, asserted through the SAME function the alert uses,
       so a change to either is visible here. Its own counter and its own token,
       because a button fault is not a wrong version comparison and was being
       reported as one. */
    var buttonsBad = 0
    let btn = AppDelegate.relaunchButtons
    let keys = AppDelegate.relaunchKeyEquivalents(btn)
    func btnCheck(_ ok: Bool, _ what: String) {
        if !ok { buttonsBad += 1 }
        print((ok ? "PASS  " : "FAIL  ") + "buttons: " + what)
    }
    btnCheck(btn.titles.indices.contains(btn.returnIndex)
             && btn.titles.indices.contains(btn.destructiveIndex),
             "both indices name a real button")
    btnCheck(keys.count == btn.titles.count, "every button gets a key equivalent")
    if keys.count == btn.titles.count, btn.titles.indices.contains(btn.destructiveIndex) {
        btnCheck(keys[btn.destructiveIndex] == "",
                 "the button that QUITS does not answer to Return (it is \"\(btn.titles[btn.destructiveIndex])\")")
        btnCheck(keys[btn.returnIndex] == "\r",
                 "Return reaches \"\(btn.titles[btn.returnIndex])\"")
    }
    /* ⚠️ THE TITLE IS PINNED BY NAME. Without this, swapping the two strings
       moves the quit onto the other button and every check above still holds,
       because they only compare indices to each other. Measured: that mutation
       inverted the product and the old gate passed. */
    btnCheck(btn.titles.indices.contains(btn.destructiveIndex)
             && btn.titles[btn.destructiveIndex] == "Quit and Open Again",
             "the destructive button is the one titled \"Quit and Open Again\"")
    if buttonsBad > 0 {
        print("\nstale-check: the relaunch notice's buttons are wrong, which is not the version comparison")
        exit(1)
    }
    ran += 5

    /* 🛑 #1182: THE LOOP, AS ROWS. Josh hit "Quit and Open Again", got the same
       notice, hit it again, and the only exit was a button that reads as
       declining the update. These rows are the loop and its exit.

       ⚠️ ROW 2 IS THE ONE THAT FAILS ON THE OLD CODE, and rows 1 and 3 are what
       stop somebody "fixing" it by never offering the relaunch at all -- which
       would trade a loop for a window that can never catch up even when
       reopening WOULD have worked. */
    var adviceBad = 0
    func advCheck(_ got: AppDelegate.StaleAdvice, _ want: AppDelegate.StaleAdvice, _ what: String) {
        let ok = got == want
        if !ok { adviceBad += 1 }
        print((ok ? "PASS  " : "FAIL  ") + "advice: " + what + " -> \(got)")
    }
    advCheck(AppDelegate.staleAdvice(mine: "0.5.87", theirs: "0.5.89", relaunchedAt: nil),
             .offerRelaunch, "first sight of a newer board offers the reopen")
    advCheck(AppDelegate.staleAdvice(mine: "0.5.87", theirs: "0.5.89", relaunchedAt: "0.5.87"),
             .cannotSelfHeal, "reopened at this version and came back to it: STOP OFFERING IT")
    advCheck(AppDelegate.staleAdvice(mine: "0.5.87", theirs: "0.5.89", relaunchedAt: "0.5.80"),
             .offerRelaunch, "a relaunch recorded at a DIFFERENT version does not gag this one")
    /* 🔑 THE BOARD MOVING AGAIN IS THE EXPECTED CASE, NOT AN EDGE ONE. Josh's
       own screenshots show 0.5.88 then 0.5.89 against a window stuck at 0.5.87.
       Keyed on `theirs`, this row would re-arm the loop on every board release. */
    advCheck(AppDelegate.staleAdvice(mine: "0.5.87", theirs: "0.5.90", relaunchedAt: "0.5.87"),
             .cannotSelfHeal, "the board moving on again does not re-arm the loop")
    advCheck(AppDelegate.staleAdvice(mine: "0.5.89", theirs: "0.5.89", relaunchedAt: "0.5.89"),
             .silent, "not behind stays silent even with a relaunch recorded")
    advCheck(AppDelegate.staleAdvice(mine: "0.5.90", theirs: "0.5.89", relaunchedAt: nil),
             .silent, "AHEAD of the board still says nothing, the untouched direction")
    if adviceBad > 0 {
        print("\nstale-check: the #1182 relaunch advice is wrong, which is the loop Josh hit")
        exit(1)
    }
    ran += 6

    /* 🛑 #1182: THE ESCAPE MUST NOT BE THE MISLEADING BUTTON. "Not Now" was the
       only way out of the loop and it reads as declining the update. This spec
       is checked BY TITLE, not by index: the sibling spec's own comment records
       that index-only checks passed while a swapped title inverted the product. */
    var exitBad = 0
    func exitCheck(_ ok: Bool, _ what: String) {
        if !ok { exitBad += 1 }
        print((ok ? "PASS  " : "FAIL  ") + "cannot-self-heal: " + what)
    }
    let cs = AppDelegate.cannotSelfHealButtons
    exitCheck(!cs.titles.contains("Not Now"),
              "the escape is not \"Not Now\", which read as declining the update")
    exitCheck(!cs.titles.contains("Quit and Open Again"),
              "the action that looped is NOT offered again")
    exitCheck(cs.titles.indices.contains(cs.returnIndex) && cs.titles[cs.returnIndex] == "Keep Working",
              "Return lands on the harmless dismiss")
    /* ⚠️ -1 ON PURPOSE. Nothing here quits, so anything reaching for "the button
       that quits" must find nothing rather than find the wrong one. */
    exitCheck(!cs.titles.indices.contains(cs.destructiveIndex),
              "there is no destructive button, because nothing here quits")
    if exitBad > 0 {
        print("\nstale-check: the #1182 exit notice would leave the person in the loop")
        exit(1)
    }
    ran += 4

    /* 🛑 A POPULATION FLOOR, because `bad == 0` is ALSO true of zero checks.
       An edit that deletes every row would print "all good" and pass the
       release gate having proved nothing: an instrument for silent failures
       with the exact failure mode it exists to catch. Mona Lisa found this
       shape in her own gate tonight and the lesson is hers.
       ⭐ And the load-bearing row is named, not merely counted: 0.5.9 vs
       0.5.10 is the one the whole file is justified by, so its absence must be
       a failure rather than a smaller number. */
    if ran < 35 { print("\nstale-check: only \(ran) checks ran, so this proved nothing"); exit(1) }
    if !sawLexicalRow { print("\nstale-check: the 0.5.9 vs 0.5.10 row is gone, which is the row this file exists for"); exit(1) }
    /* ⚠️ A COUNT FLOOR DOES NOT PROTECT A SPECIFIC ROW, which is why the line
       above exists and why this one has to. Deleting the four log rows and
       adding four others anywhere else leaves `ran` untouched and the floor
       satisfied. This pins the one the fix exists for: that an UNKNOWN verdict
       is recorded as unknown rather than as a measured not-behind. */
    if !sawUnknownLogRow { print("\nstale-check: the COULD NOT COMPARE log row is gone, and it is the row that keeps a three-state verdict from being logged as two"); exit(1) }
    print(bad == 0 ? "\nstale-check: all good, \(ran) checks" : "\nstale-check: \(bad) FAILED")
    exit(bad == 0 ? 0 : 1)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
