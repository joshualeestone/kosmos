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
import Network
import ApplicationServices  // #2125 slice 3: AXIsProcessTrusted / AXIsProcessTrustedWithOptions
import UserNotifications    // #3996: whether the person turned Kosmos's badges off
import Speech               // #4409: dictation, on-device only
import AVFoundation         // #4409: the microphone, while the mic button is on

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

// MARK: - #4356: whether this computer runs agents, or connects to agents on another computer
//
// Josh chose one app with a first-screen choice (#4356, option A). The choice is stored per
// computer, in the install (KOSMOS_HOME), not per Kosmos instance: the instances of #1852 share one
// install, and the installer and the updater read this same file (install/setup.sh) so an update
// never starts a board on a computer that connects elsewhere. One word:
//   (no file)  never chosen: a fresh install (asked), or an install from before #4356 (an update of
//              one whose first run is done records `run`, install/setup.sh, so it is not asked).
//   run        this computer runs agents.
//   connect    this computer opens Kosmos Plus sign-in, and never starts its own board.
//   both       runs agents, as run does (the app, the installer and updates treat it as run), and
//              first run ends at Kosmos Plus sign-in (Josh's third button, 10:31 on the card).
//   anything else, or a file that cannot be read: UNREADABLE. The app asks again (the first screen);
//   it never quietly becomes one of the three. The app starts the board at launch so its page can
//   ask; the installer, which cannot ask, does not start it (an update's pause stops it), and an
//   answer of run or both starts it again if an update stopped it meanwhile (ensureBoardRunning).
enum ComputerMode: String {
    case unset, run, connect, both, unreadable
}

/* 🚦 KOSMOS_FIRSTRUN_CHOICE: the release switch for the whole of #4356 (Liu Kang m2647). OFF, first
   run is exactly today's: the app never asks, never reads a choice, never connects, so nothing
   below this line changes a Mac. ON, the full three-button screen Josh approved. It was held off
   until a connect Mac could update itself; #4382 (startUpdateLooks: `kosmos update --if-newer` at
   launch and daily, with no board) is what turns it on. Windows keeps its own switch
   (KosmosLauncher.cs FirstRunChoice) off until a connect Windows computer can update (#4381). */
let kosmosFirstRunChoice = true

func computerModePath(kosmosHome: String) -> String { kosmosHome + "/mode" }

/// PURE, so --kosmos-app-mode-selftest can drive it. nil is "no file". Trailing newlines are
/// dropped and nothing else, which is what the installer's `$(cat ...)` does, so the app and the
/// installer never read the same bytes two ways.
func computerMode(fromFile data: Data?) -> ComputerMode {
    guard let data else { return .unset }
    guard var text = String(data: data, encoding: .utf8) else { return .unreadable }
    while text.hasSuffix("\n") { text.removeLast() }
    switch text {
    case "run": return .run
    case "connect": return .connect
    case "both": return .both
    default: return .unreadable
    }
}

func readComputerMode(kosmosHome: String) -> ComputerMode {
    do {
        return computerMode(fromFile: try Data(contentsOf: URL(fileURLWithPath: computerModePath(kosmosHome: kosmosHome))))
    } catch {
        let ns = error as NSError
        if ns.domain == NSCocoaErrorDomain && ns.code == NSFileReadNoSuchFileError { return .unset }
        logLine("#4356: could not read \(computerModePath(kosmosHome: kosmosHome)): \(error.localizedDescription)")
        return .unreadable
    }
}

/// Only the three real choices can be written. Atomic, so a reader never sees half a word.
func writeComputerMode(_ mode: ComputerMode, kosmosHome: String) -> Bool {
    guard mode == .run || mode == .connect || mode == .both else { return false }
    do {
        try Data((mode.rawValue + "\n").utf8).write(to: URL(fileURLWithPath: computerModePath(kosmosHome: kosmosHome)), options: .atomic)
        return true
    } catch {
        logLine("#4356: could not save this computer's choice (\(mode.rawValue)): \(error.localizedDescription)")
        return false
    }
}

/* #4356: where a connect computer goes. The same origin the phone apps load (#2854): Kosmos Plus
   sign-in, which after sign-in hands the person on to their Mac's board at <name>.kosmosplus.com
   with a short token (#3837), and which also takes Sub-Zero's ?open=<address> for slice 2. */
let kosmosPlusSignIn = URL(string: "https://login.kosmosplus.com/")!

enum ConnectLink: String {
    case inApp, browser, block
}

/// Kosmos Plus itself or one of the person's computers, over https: the plain host, no user part,
/// no port but 443. A computer is one label directly under kosmosplus.com, never login itself, by
/// the iOS app's own rule (ios/Kosmos/ShellLogic.swift isOurs, PushBridgeLogic.swift isMacHost and
/// isHostLabel): 1 to 63 of a-z, 0-9 and "-", no "-" at either end, and no "xn--" (punycode
/// lookalikes are refused on purpose). A copy, not shared code: the selftest rows pin it.
func isKosmosPlusURL(_ url: URL) -> Bool {
    guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased(), !host.isEmpty,
          url.user == nil, url.password == nil, url.port == nil || url.port == 443,
          host.unicodeScalars.allSatisfy({ $0.isASCII })
    else { return false }
    let coordinator = kosmosPlusSignIn.host!
    if host == coordinator { return true }
    // The computers live one label under the sign-in host's parent ("login.kosmosplus.com" gives
    // "kosmosplus.com"), derived as iOS derives it (relayDomain), so moving the sign-in moves both.
    let labels = coordinator.split(separator: ".")
    guard labels.count >= 3 else { return false }
    let suffix = "." + labels.dropFirst().joined(separator: ".")
    guard host.hasSuffix(suffix) else { return false }
    let label = String(host.dropLast(suffix.count))
    guard (1...63).contains(label.count), label.first != "-", label.last != "-", !label.hasPrefix("xn--")
    else { return false }
    return label.unicodeScalars.allSatisfy {
        ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-"
    }
}

/// PURE, for --kosmos-app-mode-selftest. A connect computer's main-frame navigations, as the iOS
/// app decides them: Kosmos Plus and the person's computers in the window; any other https site in
/// the browser; plain http only from a click, and then in the browser; mail, phone and text links
/// only from a click; about:blank for the page's own use; every other scheme refused. So another
/// site can never REPLACE the window's page with a fake Kosmos screen. This decides main-frame
/// navigations only: a frame inside a Kosmos Plus page is that page's to choose (as on iOS, which
/// adds an https-only rule for frames; not ported here).
func connectLinkDecision(for url: URL, clicked: Bool) -> ConnectLink {
    switch url.scheme?.lowercased() ?? "" {
    case "https":
        if isKosmosPlusURL(url) { return .inApp }
        guard let host = url.host, !host.isEmpty else { return .block }
        return .browser
    case "http":
        guard let host = url.host, !host.isEmpty else { return .block }
        return clicked ? .browser : .block
    case "mailto", "tel", "sms":
        return clicked ? .browser : .block
    case "about":
        return url.absoluteString == "about:blank" ? .inApp : .block
    default:
        return .block
    }
}

/// #5167: PURE, for --kosmos-app-mode-selftest. One of the two checks a saved download passes (the other
/// is isBoardPage): the file is from the page's own origin. Scheme, host and port must all match; a
/// missing port is the scheme's default, so `https://x.kosmosplus.com:443` is the same origin as
/// `https://x.kosmosplus.com`.
func isSameOriginDownload(_ target: URL, page: URL?) -> Bool {
    guard let page = page else { return false }
    func origin(_ u: URL) -> (String, String, Int)? {
        guard let scheme = u.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = u.host?.lowercased(), !host.isEmpty, u.user == nil
        else { return nil }
        return (scheme, host, u.port ?? (scheme == "https" ? 443 : 80))
    }
    guard let a = origin(target), let b = origin(page) else { return false }
    return a == b
}

/// #5167: the names the coordinator keeps for Kosmos+ itself, so a page under one is treated as a Kosmos+
/// service, not a board. A computer that held one of them before it was reserved keeps it, and is refused
/// here too. A COPY of RESERVED_NAMES in kosmos-relay coordinator/src/signin.rs (2026-10-03, c91521c1); add
/// a name there, add it here.
let kosmosPlusReservedLabels: Set<String> = [
    "www", "api", "app", "relay", "coordinator", "admin", "mail", "smtp", "mx", "ns", "ns1", "ns2", "dns",
    "status", "help", "support", "kosmos", "billing", "community", "docs", "forum", "blog", "news", "cdn", "static",
    "assets", "autodiscover", "autoconfig", "login", "log-in", "signin", "sign-in", "signup", "sign-up", "setup",
    "register", "auth", "account", "accounts", "checkout", "pay", "payment", "payments", "secure", "verify",
]

/// #5167: PURE, for --kosmos-app-mode-selftest. Whether the page on screen is a board this app may save
/// downloads from: a Kosmos+ computer (isKosmosPlusURL), or the board this app loaded (`board`, the
/// host and port it resolved; nil on a connect computer). A foreign site, or another local server, that
/// ends up in the window is neither, so it cannot save its own files.
func isBoardPage(_ page: URL?, board: (host: String, port: Int)?) -> Bool {
    guard let page = page else { return false }
    if isKosmosPlusURL(page) {
        let label = page.host?.lowercased().split(separator: ".").first.map(String.init) ?? ""
        return !kosmosPlusReservedLabels.contains(label)
    }
    guard let board = board, page.user == nil, let scheme = page.scheme?.lowercased(),
          scheme == "http" || scheme == "https", let host = page.host?.lowercased()
    else { return false }
    return host == board.host.lowercased() && (page.port ?? (scheme == "https" ? 443 : 80)) == board.port
}

/// #5167: PURE, for --kosmos-app-mode-selftest. Whether the board's page says a refusal of this download
/// itself: #5165's Files lists (kplusDownload) look at these two routes with ?check=1 and say the board's
/// own sentence, on any board. Nothing else (an attachment, say) is looked at by the page.
func pageSaysDownloadRefusal(_ url: URL?) -> Bool {
    let path = url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.percentEncodedPath } ?? ""   // an encoded / stays one part
    let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    // ["", "api", "agent", <name>, "files", "download"] or ["", "api", "project", <id>, "file-download"]
    if parts.count == 6, parts[1] == "api", parts[2] == "agent", !parts[3].isEmpty, parts[4] == "files", parts[5] == "download" { return true }
    if parts.count == 5, parts[1] == "api", parts[2] == "project", !parts[3].isEmpty, parts[4] == "file-download" { return true }
    return false
}

/// #5167: PURE, for --kosmos-app-mode-selftest. Where a saved download goes: `dir` (the person's
/// Downloads), under the name the page or server suggested, made safe and never over an existing file.
/// WebKit already reduces the suggestion to a file name; this does not rely on that. A path separator,
/// a leading dot (a hidden file), control characters and an empty or `.`/`..` name are all refused into
/// something visible. A taken name gets " (2)", " (3)" before its extension, as Safari and Finder do.
func downloadDestination(dir: URL, suggested: String, exists: (URL) -> Bool) -> URL {
    var name = String(suggested.unicodeScalars.map { s -> Character in
        if s == "/" || s == ":" || s == "\\" { return "-" }
        if s.value < 0x20 || (0x7f...0x9f).contains(s.value) { return " " }
        return Character(s)
    }.filter { c in   // direction controls would let "x\u{202E}fdp.app" show as a .pdf in Finder
        !c.unicodeScalars.contains { (0x200B...0x200F).contains($0.value) || (0x2028...0x202E).contains($0.value)
                                     || (0x2060...0x2069).contains($0.value) || [0xFEFF, 0x061C, 0x00AD].contains($0.value) }
    }).trimmingCharacters(in: .whitespacesAndNewlines)
    // Until it stops changing: ". .zshrc" must not end as ".zshrc", nor ". ." as "." (Downloads itself).
    var before = ""
    while name != before {
        before = name
        while name.hasPrefix(".") { name.removeFirst() }
        name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    if name.isEmpty { name = "Download" }
    if name.utf8.count > 200 {   // HFS+/APFS cap a name at 255 bytes; leave room for " (999)"
        var ext = (name as NSString).pathExtension
        var stem = (name as NSString).deletingPathExtension
        if ext.utf8.count > 20 { ext = ""; stem = name }   // not an extension anyone opens by; it must not starve the stem
        while !stem.isEmpty && stem.utf8.count + (ext.isEmpty ? 0 : ext.utf8.count + 1) > 200 { stem.removeLast() }
        while let last = stem.last, last == "." || last == " " { stem.removeLast() }   // a cut can end on either
        if stem.isEmpty { stem = "Download" }
        name = ext.isEmpty ? stem : stem + "." + ext
    }
    let first = dir.appendingPathComponent(name)
    if !exists(first) { return first }
    let ext = (name as NSString).pathExtension
    let stem = (name as NSString).deletingPathExtension
    var n = 2
    while true {
        let candidate = dir.appendingPathComponent(stem + " (\(n))" + (ext.isEmpty ? "" : "." + ext))
        if !exists(candidate) { return candidate }
        if n >= 10000 {   // never over an existing file, however many there are
            return dir.appendingPathComponent(stem + " " + UUID().uuidString + (ext.isEmpty ? "" : "." + ext))
        }
        n += 1
    }
}

/// What `kosmos stop` did. `notOurs` is the CLI's own refusal to stop a board it has no pid for:
/// usually another account's Kosmos on this port, possibly this install's own board with its pidfile
/// lost. Either way the marker is written, so it does not come back at the next login; the person is
/// not warned, because in the usual case nothing of theirs is running (review rounds 15, 16).
enum StopOutcome: Equatable {
    case stopped, notOurs, failed
    // No bin/kosmos to ask: nothing of this install could have started a board, and nothing can
    // stop one, so it is logged, not put to the person as "still running here" (review round 18).
    case missing
}

/// #4356: `bin/kosmos stop`, when a computer switches to connect. It writes board.stopped, which
/// launchd's KeepAlive, `kosmos board-run` and the watchdog all obey, so the board stays down
/// across logins until something runs `kosmos start`. Returns what it did (StopOutcome).
func stopBoard(kosmosHome: String, port: Int?) -> StopOutcome {
    let kosmosBin = kosmosHome + "/bin/kosmos"
    guard FileManager.default.isExecutableFile(atPath: kosmosBin) else {
        logLine("#4356: cannot stop the board: \(kosmosBin) is missing")
        holdBoardStopped(kosmosHome: kosmosHome)   // so a CLI restored later still finds the board held off
        return .missing
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: kosmosBin)
    process.arguments = ["stop"]
    var env = ProcessInfo.processInfo.environment
    env["KOSMOS_HOME"] = kosmosHome
    // The same port startBoard hands the CLI: the app's port comes from kosmos-install.json, not the
    // environment, and `kosmos stop` judges "running" on the port it is given (review round 9).
    if let port { env["KOSMOS_PORT"] = String(port) }
    process.environment = env
    // Output to the null device, as startBoard explains (an undrained Pipe can deadlock the wait);
    // stderr to a file, which has no buffer to fill, so the CLI's reason can be read afterwards.
    let errURL = FileManager.default.temporaryDirectory.appendingPathComponent("kosmos-stop-\(UUID().uuidString).err")
    FileManager.default.createFile(atPath: errURL.path, contents: nil)
    defer { try? FileManager.default.removeItem(at: errURL) }
    process.standardOutput = FileHandle.nullDevice
    process.standardError = (try? FileHandle(forWritingTo: errURL)) ?? FileHandle.nullDevice
    do { try process.run() } catch {
        logLine("#4356: could not run \(kosmosBin) stop: \(error.localizedDescription)")
        holdBoardStopped(kosmosHome: kosmosHome)   // as every non-stopped outcome does
        return .failed
    }
    process.waitUntilExit()
    let said = (try? String(contentsOf: errURL, encoding: .utf8)) ?? ""
    logLine("#4356: kosmos stop exited \(process.terminationStatus)")
    if process.terminationStatus == 0 { return .stopped }
    holdBoardStopped(kosmosHome: kosmosHome)
    if said.contains("not started by this command") {
        logLine("#4356: the board answering on this port is not this install's; left alone")
        return .notOurs
    }
    return .failed
}

/// #4356: a stop that failed removes board.stopped on purpose (install/kosmos: a stop it could not
/// finish must not strand a board it did not stop), and a board it did not start leaves none. On a
/// computer set not to run a board that is the wrong default: without the marker, launchd's login
/// item (`board-run`) and the watchdog start the board again at the next login. So the app writes it.
func holdBoardStopped(kosmosHome: String) {
    let marker = kosmosHome + "/board.stopped"
    if FileManager.default.createFile(atPath: marker, contents: Data()) {
        logLine("#4356: wrote \(marker) so nothing starts the board at the next login")
    } else {
        logLine("#4356: could not write \(marker)")
    }
}

// MARK: - #4382: a connect computer updates without a board

/// What `kosmos update --if-newer` said, from the last line it printed (install/kosmos cmd_update).
enum UpdateAnswer: Equatable {
    case current(String)    // nothing newer than this version, the one installed on disk
    case newer(String)      // newer, and updates are off here: offered, not installed
    case updated(String)    // installed
    case failed(String)     // the installer ran and failed
    case board              // a board runs here, and it updates itself
    case unknown            // the release host could not be reached or read, or the CLI said nothing usable
    case refused            // the CLI will not update here (not a connect computer, or an agent): no retry
}

/// PURE, so --kosmos-app-update-selftest can drive it. Only the LAST non-empty line counts, and
/// only a version of the board's own shape (a.b.c): anything else is unknown, never current, so a
/// garbled answer can neither hide an update nor offer one.
func updateAnswer(fromOutput text: String) -> UpdateAnswer {
    guard let last = text.split(whereSeparator: { $0 == "\n" || $0 == "\r" || $0 == "\r\n" }).last(where: { !$0.allSatisfy({ $0 == " " || $0 == "\t" }) })
    else { return .unknown }
    // `refused<TAB><why>`: the reason is for people and the log, so only the word and the tab are read.
    if last.hasPrefix("refused\t"), last.dropFirst("refused\t".count).contains(where: { $0 != " " && $0 != "\t" }) { return .refused }
    let words = last.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
    func version(_ v: String) -> Bool {
        let p = v.split(separator: ".", omittingEmptySubsequences: false)
        return p.count == 3 && p.allSatisfy { !$0.isEmpty && $0.allSatisfy { ("0"..."9").contains($0) } }
    }
    switch (words.first, words.count) {
    case ("board", 1): return .board
    case ("current", 2) where version(words[1]): return .current(words[1])
    case ("newer", 2) where version(words[1]): return .newer(words[1])
    case ("updated", 2) where version(words[1]): return .updated(words[1])
    case ("failed", 2) where version(words[1]): return .failed(words[1])
    default: return .unknown
    }
}

/// #4382: `bin/kosmos update --if-newer`, off the main thread. On a connect computer the board is
/// stopped, so nothing else looks for updates; this runs the board's own look and, when updates are
/// on or the person chose Update, the board's own installer, which leaves a connect computer's board
/// stopped (install/setup.sh _kosmos_mode_keeps_board_off). It waits for the installer, which can
/// take minutes: the caller counts it in stopsInFlight, so Run agents cannot start a board under it.
func runKosmosUpdate(kosmosHome: String, port: Int?, install: Bool) -> UpdateAnswer {
    let kosmosBin = kosmosHome + "/bin/kosmos"
    guard FileManager.default.isExecutableFile(atPath: kosmosBin) else {
        logLine("#4382: cannot look for an update: \(kosmosBin) is missing")
        return .unknown
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: kosmosBin)
    process.arguments = install ? ["update", "--if-newer", "--install"] : ["update", "--if-newer"]
    var env = ProcessInfo.processInfo.environment
    env["KOSMOS_HOME"] = kosmosHome
    if let port { env["KOSMOS_PORT"] = String(port) }   // setup.sh reads KOSMOS_PORT
    process.environment = env
    // To files, as stopBoard explains: an undrained Pipe can deadlock the wait, and the installer's
    // output (it goes to logs/install.log, but a failure before that can still print) has no bound.
    let outURL = FileManager.default.temporaryDirectory.appendingPathComponent("kosmos-update-\(UUID().uuidString).out")
    FileManager.default.createFile(atPath: outURL.path, contents: nil)
    defer { try? FileManager.default.removeItem(at: outURL) }
    process.standardOutput = (try? FileHandle(forWritingTo: outURL)) ?? FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    do { try process.run() } catch {
        logLine("#4382: could not run \(kosmosBin) update: \(error.localizedDescription)")
        return .unknown
    }
    process.waitUntilExit()
    let said = (try? String(contentsOf: outURL, encoding: .utf8)) ?? ""
    let answer = updateAnswer(fromOutput: said)
    logLine("#4382: kosmos update --if-newer\(install ? " --install" : "") exited \(process.terminationStatus): \(answer)")
    if answer == .unknown || answer == .refused {
        // What it said, so an answer this app could not read (a version of another shape, say) can be found.
        let lastLine = said.split(whereSeparator: { $0 == "\n" }).last.map(String.init) ?? ""
        logLine("#4382: it said: \(String(lastLine.prefix(200)))")
    }
    return answer
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

// #1946: the board authenticates the loopback bind so another macOS account
// cannot reach it. The token lives in the per-account data dir the board writes
// it to, mode 600, readable only by this account. nil when there is no token (a
// board that does not enforce, e.g. a sandbox).
//
// This mirrors store.ROOT's macOS branch (`dataRootFor`): the base is
// `AGENT_WORKFORCE_DATA` when that override is set (so an operator who moved the
// data dir is followed rather than silently read at the default), otherwise the
// OS Application Support dir; the store-leaf subpath is APP (see storeLeaf()).
// Swift cannot require the node store module, so this is a faithful re-derivation
// of that one formula, not the single source itself -- the shipped app sets no
// override, so the two agree.
func boardTokenValue() -> String? {
    let env = ProcessInfo.processInfo.environment
    let base: URL
    if let dataOverride = env["AGENT_WORKFORCE_DATA"], !dataOverride.isEmpty {
        // store.ROOT: join(AGENT_WORKFORCE_DATA, APP)
        base = URL(fileURLWithPath: dataOverride)
    } else if let homeOverride = env["AGENT_WORKFORCE_HOME"], !homeOverride.isEmpty {
        // dataRootFor's home is AGENT_WORKFORCE_HOME || homedir(); honor the override.
        base = URL(fileURLWithPath: homeOverride).appendingPathComponent("Library/Application Support")
    } else if let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
        base = dir
    } else {
        return nil
    }
    let file = base.appendingPathComponent("\(storeLeaf(base: base))/board.token")
    guard let raw = try? String(contentsOf: file, encoding: .utf8) else { return nil }
    let tok = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return tok.isEmpty ? nil : tok
}

// #2439: the on-disk store leaf. engine/store.js renamed its APP constant from
// 'AgentWorkforce' to 'Kosmos', with a one-time migration (maybeMigrateLegacyStore)
// that renames the whole legacy dir to the new leaf on the JS board's first store access
// and NEVER clobbers an existing new leaf. This native app resolves the same store dir
// independently, and several of its writers create the dir (writeA11yStatus,
// writeFileAccessStatus, the scan hatch, writeRelaunchHandoffToken). If it wrote to
// 'Kosmos' before the JS migration ran, it would pre-create the new leaf, make the
// migration skip on never-clobber, and ORPHAN the person's entire legacy store. So
// resolve the CURRENT leaf: legacy 'AgentWorkforce' when it exists and 'Kosmos' does not
// yet (the pre-migration update case), else 'Kosmos'. The JS migration then relocates the
// legacy dir -- with anything this app wrote into it -- to 'Kosmos', and later reads here
// resolve 'Kosmos'. Mirrors the same legacy-vs-new choice install/setup.sh's
// source-channel write makes, for the same reason. Swift cannot require the node store
// module, so this re-derives the one formula rather than being the single source itself.
//
// Residual, accepted: there is no lock across the language boundary, so a TOCTOU window
// exists during the one-time migration -- if this resolves the legacy leaf (Kosmos absent)
// and the JS renameSync(legacy -> Kosmos) completes before the caller's write lands, the
// write (which mkdir's first) re-creates base/AgentWorkforce/ holding one stale coordination
// file the board (now reading Kosmos) never sees. It is NOT data loss (the user's store was
// already relocated to Kosmos), the window is milliseconds and only during a migrating
// update, the file is an ephemeral status/handoff that is rewritten, and the next write here
// resolves Kosmos. Left as-is rather than adding cross-process locking for a self-correcting
// millisecond race.
func storeLeaf(base: URL) -> String {
    let fm = FileManager.default
    var isDir: ObjCBool = false
    let kosmosExists = fm.fileExists(atPath: base.appendingPathComponent("Kosmos").path, isDirectory: &isDir) && isDir.boolValue
    let legacyExists = fm.fileExists(atPath: base.appendingPathComponent("AgentWorkforce").path, isDirectory: &isDir) && isDir.boolValue
    if legacyExists && !kosmosExists { return "AgentWorkforce" }
    return "Kosmos"
}

// MARK: - #2125 slice 3: the native Accessibility trust writer
//
// Accessibility trust is a TCC fact the Node engine CANNOT read (#1344); only a
// native AXIsProcessTrusted call can. engine/a11ystatus.js reads the verdict this
// writes, at store.ROOT/a11y-status.json, and gates the first-run Continue button on
// a POSITIVE checkable:true+trusted:false (fail-safe in every other state). This is
// the writing side of that seam.

// 🔑 THE PATH MUST MATCH engine/store.js's ROOT, or the writer and reader miss each
// other silently (the two-copies-of-one-fact defect). Resolved the SAME way
// boardTokenValue() / relaunchHandoffURL() resolve their dir -- AGENT_WORKFORCE_DATA
// override, else AGENT_WORKFORCE_HOME + Library/Application Support, else the OS
// app-support dir -- plus the shared store-leaf subpath (storeLeaf()). A cross-language seam
// is INHERENTLY two copies (Swift here, JS there), so the guard is not code-sharing
// (impossible across languages) but a test that the two agree: a11ystatus.test.js
// pins the reader path, and the native-writer test pins THIS one against store.ROOT.
// One resolution of the shared store dir (engine/store.js's ROOT), so every file
// the native app and engine pass between them -- file-access-status.json and the
// prompt-request files -- lands in the SAME place: a new shared file names itself here
// rather than re-implementing (and risk mis-copying) the resolution. AGENT_WORKFORCE_DATA
// override, else AGENT_WORKFORCE_HOME + Library/Application Support, else the OS
// app-support dir -- plus the shared store-leaf subpath (storeLeaf()). Mirrors engine/store.js;
// the seam is cross-language so the guard is a test that the two agree, not code-sharing.
//
// a11yStatusURL predates this helper and keeps its OWN inline copy of the same
// resolution: its #2125 writer test pins that inline body, so it is a grandfathered
// exception, not a pattern to copy. New code uses storeFileURL.
func storeFileURL(_ name: String) -> URL? {
    let env = ProcessInfo.processInfo.environment
    let base: URL
    if let dataOverride = env["AGENT_WORKFORCE_DATA"], !dataOverride.isEmpty {
        base = URL(fileURLWithPath: dataOverride)
    } else if let homeOverride = env["AGENT_WORKFORCE_HOME"], !homeOverride.isEmpty {
        base = URL(fileURLWithPath: homeOverride).appendingPathComponent("Library/Application Support")
    } else if let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
        base = dir
    } else {
        return nil
    }
    return base.appendingPathComponent("\(storeLeaf(base: base))/\(name)")
}

func a11yStatusURL() -> URL? {
    let env = ProcessInfo.processInfo.environment
    let base: URL
    if let dataOverride = env["AGENT_WORKFORCE_DATA"], !dataOverride.isEmpty {
        base = URL(fileURLWithPath: dataOverride)
    } else if let homeOverride = env["AGENT_WORKFORCE_HOME"], !homeOverride.isEmpty {
        base = URL(fileURLWithPath: homeOverride).appendingPathComponent("Library/Application Support")
    } else if let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
        base = dir
    } else {
        return nil
    }
    return base.appendingPathComponent("\(storeLeaf(base: base))/a11y-status.json")
}

// The Accessibility trust reading. AXIsProcessTrusted() is the real source; the
// KOSMOS_AXCHECK_FORCE_TRUSTED env override exists ONLY for testing, because a dev
// box with Accessibility already granted returns true unconditionally, so the gating
// (trusted:false) path cannot otherwise be exercised locally (measured 2026-09-04).
// "1"/"true" force trusted, "0"/"false" force not-trusted; any other value -- and its
// absence -- falls through to the real call. The shipped app never sets it.
func axTrustReading() -> Bool {
    if let forced = ProcessInfo.processInfo.environment["KOSMOS_AXCHECK_FORCE_TRUSTED"] {
        let v = forced.lowercased()
        if v == "1" || v == "true" { return true }
        if v == "0" || v == "false" { return false }
    }
    return AXIsProcessTrusted()
}

// Write {"trusted":<bool>,"at":<ISO8601>} where a11ystatus.js reads it. The `at`
// timestamp is load-bearing: the reader treats a verdict older than its
// STALE_AFTER_MS as "cannot check" (fail-safe), so a fresh timestamp on every write
// is what keeps the gate live while the first-run screen polls. Returns false (never
// throws) on a write failure so the caller's exit code reflects it. Hand-built JSON
// so the shape is exactly what a11ystatus.js parses -- a boolean `trusted` and a
// Date.parse-able `at` -- with no encoder surprises; a Swift Bool interpolates as the
// bare `true`/`false` JSON literals.
func writeA11yStatus(trusted: Bool) -> Bool {
    guard let url = a11yStatusURL() else {
        logLine("axcheck: could not resolve the a11y-status path")
        return false
    }
    let at = ISO8601DateFormatter().string(from: Date())
    let json = "{\"trusted\":\(trusted),\"at\":\"\(at)\"}\n"
    do {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try json.write(to: url, atomically: true, encoding: .utf8)
        return true
    } catch {
        logLine("axcheck: could not write a11y-status (\(error.localizedDescription))")
        return false
    }
}

func fileAccessStatusURL() -> URL? {
    storeFileURL("file-access-status.json")
}

// The bundled tmux the agents run under, resolved the SAME way the rest of the
// system resolves it. The bundle stages tmux at <kosmosHome>/tmux/bin/tmux
// (install/kosmos exports PATH="$KOSMOS_HOME/tmux/bin"; build-tmux-bundle.sh
// stages the binary at <bundle>/bin/tmux, and that bundle is $KOSMOS_HOME/tmux).
// An explicit AGENT_WORKFORCE_TMUX_BIN wins, matching how agent creation and the
// first-run machine check pick their tmux, so a test seam or a non-default layout
// is honoured identically for the app and the agents. Returns the first executable
// candidate, or nil (the caller stays fail-safe: no reading rather than a crash).
//
// 🛑 #2189 / #2347 REOPEN, and the whole cascade of Josh's 0.6.40 fresh-install
// re-test. This used to be the hardcoded bare bin/tmux path (kosmosHome plus
// slash-bin-slash-tmux), a path that exists on NO real install -- the bundle puts
// tmux at tmux/bin/tmux, and <kosmosHome>/bin holds only `kosmos`. (The literal is
// spelled out in prose here, not as code, so the regression guard in the test --
// which forbids that exact code literal anywhere in the source -- is not tripped by
// this comment.) So spawnAxHatchUnderTmux's guard was FALSE
// on every real install and EVERY under-tmux hatch silently skipped: the a11y
// prompt never fired (so nothing landed in the Accessibility list -> "no Tmux to
// enable"; note that even when it DOES fire it registers the kosmos-app, not tmux, per
// the #2125 attribution correction in startA11yTrustChecks, so "no Tmux to enable" has
// that second cause too), a11y-status.json was never written (-> promptrequest.nativePresent()
// false -> the on-demand a11y/file-access fires fell back to opening Settings), and
// the file-access prompt never fired on Allow Access. Meanwhile the AGENTS resolve
// tmux correctly (tmux/bin via PATH / AGENT_WORKFORCE_TMUX_BIN), so the prompt still
// fired later at Import -- exactly Josh's "prompts only appear at Import" symptom.
// Measured on a real install: <home>/bin/tmux ABSENT, <home>/tmux/bin/tmux PRESENT.
// Masked on dev boxes (a11y granted broadly) and by tests using a controlled home
// with tmux placed where they expect it. The path MUST match the bundle's real
// layout, not a path no install has.
func resolveBundledTmux(kosmosHome: String) -> String? {
    let fm = FileManager.default
    var candidates: [String] = []
    let env = ProcessInfo.processInfo.environment
    if let override = env["AGENT_WORKFORCE_TMUX_BIN"], !override.isEmpty {
        candidates.append(override)
    }
    candidates.append(kosmosHome + "/tmux/bin/tmux")
    for c in candidates where fm.isExecutableFile(atPath: c) { return c }
    return nil
}

// The file-access reading (#1/#2189, kosmos#2336's sibling seam). "Does the process
// macOS holds responsible for agent file access -- tmux, this hatch's parent -- hold
// the folder grants Screen 2 asks for?" We answer by ATTEMPTING to enumerate the
// protected folders; the attempt is also what makes macOS show the "would like to
// access" prompt on the first undecided access, so one operation both triggers the
// prompt and reads the verdict. Granted only if EVERY probed folder enumerates.
//
// 🛑 THE SAME LOAD-BEARING UNKNOWN AS THE a11y WRITER, and it must not promote to
// prod until the deferred fresh-install verify measures it. On a dev box the terminal
// already holds Full Disk Access, so contentsOfDirectory SUCCEEDS whether or not tmux
// itself holds the grant -- the DENIED arm (a real EPERM on a fresh install) cannot be
// observed here, so "granted:true on this Mac" is not evidence the fresh-install path
// works. The honest reading is emitted unconditionally (no bias default) precisely so
// Josh's fresh-account test CAN verify it. The KOSMOS_FILEACCESS_FORCE_GRANTED override
// exists ONLY for tests, to exercise the granted:false downstream (writer -> engine ->
// gate) without a fresh install. The shipped app never sets it.
//
// 🛑 A SECOND UNKNOWN FOR THE SAME VERIFY: TIMING/REFRESH. This assumes the enumerate
// BLOCKS until the user answers the TCC prompt (the usual behaviour for file-APIs, and
// unlike AXIsProcessTrustedWithOptions, which returns immediately). If it blocks, the
// one probe captures the grant and writes the true verdict. If instead it returns
// immediately while the prompt is async, this writes granted:false at probe time and
// there is NO periodic file-access refresh to correct it later -- unlike a11y, whose
// 60s axcheck timer catches an eventual grant. A re-click recovers (macOS remembers the
// answer, so the second probe reads the settled verdict without re-prompting), but the
// pill would stay red until then. The refresh is deliberately absent: the file-access
// probe IS the prompt, so running it periodically/at-launch would reintroduce the
// fresh-install prompt burst that permflood-2125 (#2125 slice 1) fixed. The correct
// hardening, IF the verify shows the call is async, is a bounded POST-CLICK re-probe
// (never launch-time) with the measured timing -- deferred until the verify says it is
// needed, because building it now needs that same fresh-Mac measurement.

// #3188: the REAL user home, NOT FileManager.homeDirectoryForCurrentUser -- which, under the
// launchd/app-exe hatch, can resolve to a redirected home (an inherited $HOME) so the folder-access
// probe and the scan-hatch clamp touch the wrong tree and false-green with no TCC prompt. This
// REUSES the exact mechanism resolveInstall() already relies on and this file empirically validated
// (see the KOSMOS_APP_TEST_HOME header note and resolveInstall's `realHome` at the same expression):
// NSHomeDirectory() is resolved against the REAL running identity and does NOT honor an inherited/
// spoofable $HOME, and KOSMOS_APP_TEST_HOME is the same testing-only override resolveInstall uses.
// One named place chooses "the real home" for #3188 so it cannot diverge from resolveInstall's copy.
func realUserHome() -> URL {
    let path = ProcessInfo.processInfo.environment["KOSMOS_APP_TEST_HOME"] ?? NSHomeDirectory()
    return URL(fileURLWithPath: path)
}

func fileAccessReading() -> Bool {
    if let forced = ProcessInfo.processInfo.environment["KOSMOS_FILEACCESS_FORCE_GRANTED"] {
        let v = forced.lowercased()
        if v == "1" || v == "true" { return true }
        if v == "0" || v == "false" { return false }
    }
    // #3188 FIX: resolve the REAL user home, not homeDirectoryForCurrentUser. Under the launchd /
    // app-exe hatch the latter can resolve to a redirected/container home, so the probe enumerates
    // container Documents/Downloads/Desktop (which exist and need no TCC) and never touches the real
    // protected trio -- granted:true with NO prompt, which is the fresh-box false-positive this
    // fixes. realUserHome() resolves the real home via NSHomeDirectory, unaffected by that redirection.
    let osHome = FileManager.default.homeDirectoryForCurrentUser
    let home = realUserHome()
    // #3188 DIAG (kept for the fresh-box fix-verify; removed in a follow-up once verified). Logs BOTH
    // homes so the read is definitive about the cause: osHome != realHome confirms (a) the redirected
    // home was the bug and this fix addresses it; osHome == realHome means the fix is a no-op there,
    // and an enumerate that STILL does not gate against the real home is a distinct macOS finding to
    // escalate, not a silent gap. Written to a store-dir FILE (see writeFileAccessDiag), the
    // proven-readable channel; NOT logLine (its app-log target does not exist on a real install).
    var diag = ["#3188 fileAccessReading diag",
                "osHome=\(osHome.path)",
                "realHome=\(home.path)"]
    // The three folders Screen 2's dialogs govern. Desktop/Documents/Downloads are the TCC-protected
    // trio agent files live in; enumerating each (against the REAL home) triggers ITS OWN prompt and
    // measures ITS grant -- they are three separate TCC services.
    var allGranted = true
    for folder in ["Documents", "Downloads", "Desktop"] {
        let dir = home.appendingPathComponent(folder)
        let enumResult: String
        do {
            let entries = try FileManager.default.contentsOfDirectory(atPath: dir.path)
            enumResult = "ok(entries=\(entries.count))"
        } catch let err as NSError {
            // Not granted (or unreadable). Record it but KEEP PROBING the rest: each
            // enumerate is what fires that folder's prompt, so a single grant-button
            // click must attempt all three or the user sees only the first folder's
            // prompt and has to click again for each remaining one -- the opposite of
            // Josh's #1 ("fire the prompts one after another to hit Allow"). An early
            // return here would surface exactly one of three prompts per click.
            allGranted = false
            enumResult = "THREW(domain=\(err.domain) code=\(err.code))"
        }
        diag.append("folder=\(folder) path=\(dir.path) enumerate=\(enumResult)")
    }
    writeFileAccessDiag(diag.joined(separator: "\n"))
    return allGranted
}

// Write {"granted":<bool>,"at":<ISO8601>} where fileaccessstatus.js reads it. Same
// shape and staleness contract as writeA11yStatus: a fresh `at` keeps the Screen 2
// gate live while the first-run screen polls.
func writeFileAccessStatus(granted: Bool) -> Bool {
    guard let url = fileAccessStatusURL() else {
        logLine("fileaccess: could not resolve the file-access-status path")
        return false
    }
    let at = ISO8601DateFormatter().string(from: Date())
    let json = "{\"granted\":\(granted),\"at\":\"\(at)\"}\n"
    do {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try json.write(to: url, atomically: true, encoding: .utf8)
        return true
    } catch {
        logLine("fileaccess: could not write file-access-status (\(error.localizedDescription))")
        return false
    }
}

// #3188 DIAG (temporary): write the fileAccessReading detail to a store-dir file the test20 re-run
// can read. logLine() targets the app log ($KOSMOS_APP_LOG, else /tmp/kosmos-app-test/app.log),
// which does not exist on a real install (createFile fails silently), so the diagnostic must use the
// SAME store-dir channel writeFileAccessStatus uses -- file-access-status.json lands and is read
// there on test20. Best-effort; never throws. Read it with:
//   cat "$HOME/Library/Application Support/Kosmos/file-access-diag-3188.txt"
// Removed when the fix lands.
func writeFileAccessDiag(_ text: String) {
    guard let url = storeFileURL("file-access-diag-3188.txt") else { return }
    let at = ISO8601DateFormatter().string(from: Date())
    let body = "at=\(at)\n\(text)\n"
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                             withIntermediateDirectories: true)
    try? body.write(to: url, atomically: true, encoding: .utf8)
}

// MARK: - #3 / #2125 follow-up: the import-scan TCC-root walk, done by the APP identity
//
// The find-agents import scan must read the TCC-protected roots (~/Documents deep,
// ~/Downloads + ~/Desktop shallow). Doing that in the ENGINE (node) re-prompts, because
// the S2 grant was taken for the APP-EXE identity, not the engine's. So the ENGINE drops a
// `scan-request.json` and this hatch -- the SAME app-exe spawned under tmux that
// `--kosmos-app-fileaccessprompt` uses (the proven S2 grant path) -- does the readdir + head
// reads under the granted identity and writes `scan-result.json`. It emits RAW MATERIAL only
// (paths + head bytes); ALL agent-detection + dedup stays single-sourced in engine/discover.js
// so there is no Swift/Node divergence. See .claude/plans/scan-tcc-hatch-2125b.md for the
// contract. This walk mirrors the engine's SCAN_SKIP / depth / budget semantics.

// Folder NAMES never descended -- the engine's SCAN_SKIP, kept in sync deliberately (the
// engine still owns detection; this is only the walk shape). Documents/Downloads/Desktop are
// here because a NESTED occurrence during descent is skipped; they still walk as explicit ROOTS.
private let kScanSkip: Set<String> = [
    "node_modules", "target", "vendor", "dist", "build",
    "Library", "Applications", "Music", "Movies", "Pictures", "Downloads",
    "Public", "Desktop", "Documents", "Photos Library.photoslibrary",
]
private struct ScanBudgets {
    var maxDirs = 6000   // matches the engine's SCAN.MAX_DIRS; only used if a request omits budgets
    var maxMdPerDir = 40
    var maxMdReads = 3000
    var readCap = 4000
}

// Read the first `cap` bytes of a file as a UTF-8 string (lossy), never allocating the whole
// file (an agent .md is small, but a mis-placed huge file must not be slurped). Returns nil if
// unreadable (which, for a TCC root before the grant, is exactly the not-granted signal).
private func headBytes(_ path: String, cap: Int) -> String? {
    // O_NOFOLLOW closes the lstat->open TOCTOU atomically: a symlink swapped into a user-writable
    // TCC root between the lstatType check and this open is refused here (open fails with ELOOP)
    // rather than followed. O_NONBLOCK stops a fifo swapped into that same window from blocking.
    // (Parity with the engine's /api/agent-import-file read hardening.)
    let fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
    if fd < 0 { return nil }
    defer { close(fd) }
    var buf = [UInt8](repeating: 0, count: cap)
    let n = read(fd, &buf, cap)
    if n <= 0 { return nil }
    return String(decoding: buf[0..<n], as: UTF8.self)
}

/* #3/#2125 -- THE NO-SYMLINK-ESCAPE GUARD (engine parity, discover.js). The TCC roots
   (~/Documents, ~/Downloads, ~/Desktop) are USER-WRITABLE, so a symlink dropped there could
   steer this privileged walk out of the tree -- a symlinked dir into /etc or another user's
   home, or a symlinked `foo.md` pointing at an arbitrary readable file whose first bytes would
   surface as a find-agents preview. The engine refuses exactly this with `lstat` (a symlinked
   dir reports isDirectory()===false and is not descended; readClaudeHead lstat-refuses a
   symlinked file). `attributesOfItem` does NOT follow a final symlink (lstat semantics), so it
   reports `.typeSymbolicLink` for a link; we descend only a real directory and read only a real
   regular file. This is the escape "this module family has shipped six times"; do not relax it. */
private func lstatType(_ path: String) -> FileAttributeType? {
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: path) else { return nil }
    return attrs[.type] as? FileAttributeType
}

// Walk the requested roots under the granted app identity and write scan-result.json.
// Returns true on a written result (even an empty one); false only if the request/result
// paths cannot be resolved. Never throws out: a per-entry failure is recorded, not fatal --
// an unreadable TCC root simply yields no rows (the grant is not there), which is a valid
// answer, not an error.
func scanUnderGrant() -> Bool {
    // The watcher has already atomically renamed scan-request.json -> scan-request.inflight
    // (the consume, so successive 1.5s ticks cannot launch a second walk). This hatch reads
    // the claimed file and removes it when done.
    guard let reqURL = storeFileURL("scan-request.inflight"),
          let outURL = storeFileURL("scan-result.json") else {
        logLine("scan: could not resolve scan-request/scan-result paths")
        return false
    }
    // Parse the request. A missing/garbage request is not a crash: write a bounded-empty
    // result so the engine's poll never hangs waiting on a hatch that had nothing to do.
    var roots: [[String: Any]] = []
    var budgets = ScanBudgets()
    var nonce = ""
    if let data = try? Data(contentsOf: reqURL),
       let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
        roots = (obj["roots"] as? [[String: Any]]) ?? []
        nonce = (obj["req"] as? String) ?? ""
        if let b = obj["budgets"] as? [String: Any] {
            if let v = b["maxDirs"] as? Int { budgets.maxDirs = v }
            if let v = b["maxMdPerDir"] as? Int { budgets.maxMdPerDir = v }
            if let v = b["maxMdReads"] as? Int { budgets.maxMdReads = v }
            if let v = b["readCap"] as? Int { budgets.readCap = v }
        }
    } else {
        logLine("scan: no readable scan-request.json; writing bounded-empty result")
    }

    let fm = FileManager.default
    var dirsOut: [[String: Any]] = []
    var looseOut: [[String: Any]] = []
    var visited = Set<String>()      // canonical realpaths already walked
    var dirCount = 0
    var mdReads = 0
    var boundedDirs = false
    var boundedImportable = false

    // Resolve to a canonical realpath so three aliases of one physical dir are walked once
    // (the engine dedups by realpath for the same reason): $HOME re-reaching a curated parent,
    // a case-variant on the case-insensitive default FS, and a symlinked root.
    func canon(_ p: String) -> String { URL(fileURLWithPath: p).resolvingSymlinksInPath().path }

    // One directory: read its instruction-file heads (folder-agent material) and, when the
    // root is importOnly, its loose .md heads (importable material). Then descend, honouring
    // SCAN_SKIP, dotdirs, depth and budgets.
    func walk(_ dir: String, depth: Int, importOnly: Bool) {
        if dirCount >= budgets.maxDirs { boundedDirs = true; return }
        let real = canon(dir)
        if visited.contains(real) { return }
        visited.insert(real)
        dirCount += 1

        let entries: [String]
        do { entries = try fm.contentsOfDirectory(atPath: dir) }
        catch { return }   // unreadable (e.g. TCC not granted) -> no rows from here

        // Folder-agent material: the folder's CLAUDE.md head (engine parity -- the connect
        // scan's byDir path reads CLAUDE.md only; AGENTS.md/GEMINI.md folder-agents are owned
        // by found()/foundCodex/foundGemini, which do NOT walk here). Non-importOnly roots
        // only, matching the engine's `!cur.importOnly` gate.
        if !importOnly {
            let file = (dir as NSString).appendingPathComponent("CLAUDE.md")
            // Regular file ONLY (lstat, not fileExists which follows symlinks): a symlinked
            // CLAUDE.md must not have an out-of-tree file's bytes read into a preview.
            // NO detected-equivalent row cap here: DETECTION is single-sourced in the engine, so a
            // raw-emission cap (counting non-agent CLAUDE.mds too) would drop real agents enumerated
            // after the cap. Emission is bounded by the READ budgets (maxDirs folders, one CLAUDE.md
            // read each) -- the same bound the engine walk uses -- and the engine merge caps the
            // DETECTED rows.
            if lstatType(file) == .typeRegular, let head = headBytes(file, cap: budgets.readCap) {
                dirsOut.append(["dir": dir, "instr": ["file": file, "head": head]])
            }
        }

        // Importable loose agent FILES -- runs on BOTH normal and importOnly roots (engine
        // parity, #1652). `.md`/`.markdown`, excluding the folder-agent markers claude.md and
        // agents.md (lowercased), bounded per-dir and by the global head-read budget.
        var perDir = 0
        for name in entries {
            let lower = name.lowercased()
            guard lower.hasSuffix(".md") || lower.hasSuffix(".markdown") else { continue }
            if lower == "claude.md" || lower == "agents.md" { continue }
            if perDir >= budgets.maxMdPerDir { boundedImportable = true; break }
            if mdReads >= budgets.maxMdReads { boundedImportable = true; break }
            // NO detected-equivalent looseOut cap: emission is bounded by maxMdReads (the engine's
            // own loose-read budget); a raw cap counting non-agent .md files would drop real agent
            // files sorted after it (readdir order is arbitrary). The engine merge caps DETECTED rows.
            let file = (dir as NSString).appendingPathComponent(name)
            // Regular file ONLY (lstat) -- refuse a symlinked .md, same no-escape guard.
            guard lstatType(file) == .typeRegular else { continue }
            if let head = headBytes(file, cap: budgets.readCap) {
                mdReads += 1
                perDir += 1
                looseOut.append(["file": file, "head": head])
            }
        }

        // Descend.
        if depth <= 0 { return }
        for name in entries {
            if name.hasPrefix(".") { continue }          // every dotdir skipped by rule
            if kScanSkip.contains(name) { continue }     // build/vendor output + macOS homes
            let child = (dir as NSString).appendingPathComponent(name)
            // lstat, NOT fileExists: refuse a symlinked directory so the walk cannot be steered
            // OUT of the TCC tree by a symlink in a user-writable folder (engine parity). Only a
            // REAL directory is descended.
            guard lstatType(child) == .typeDirectory else { continue }
            walk(child, depth: depth - 1, importOnly: importOnly)
        }
    }

    // CONFUSED-DEPUTY GUARD: this hatch holds the app's broad Files-and-Folders grant, so it must
    // only ever walk the THREE expected TCC roots. scan-request.json lives in the user's own
    // Application Support, but a same-user process WITHOUT a Documents grant could still write one
    // naming arbitrary paths and harvest the head bytes from the world-of-same-user-readable
    // scan-result.json -- a within-user privilege escalation. Clamp to ~/Documents, ~/Downloads,
    // ~/Desktop (canonicalised), refusing anything else, so a forged request cannot redirect the
    // grant. The engine only ever sends these three.
    // #3188: the allowlist MUST use the REAL user home, not homeDirectoryForCurrentUser. The engine
    // computes the roots it sends from node's os.homedir() (engine/discover.js:968, 1018 -- the real
    // passwd home; node is not sandboxed), so a redirected/container homeDirectoryForCurrentUser here
    // would build a container-home allowlist that REFUSES the engine's real-home roots ("refusing
    // non-TCC-root") -> the scan walks nothing and finds no agents even after the check flips green.
    // realUserHome() (NSHomeDirectory) matches os.homedir(), so the clamp aligns with what the engine
    // sends; it still restricts to exactly the three real-home TCC roots, so the confused-deputy guard
    // holds.
    let home = realUserHome()
    // Test seam, mirroring the engine's AGENT_WORKFORCE_SCAN_ROOTS override: a path-delimited list
    // REPLACES the allowlist so a fixture tree can be walked under test. Unset in production ->
    // exactly the three TCC roots.
    let allowedRoots: Set<String>
    if let override = ProcessInfo.processInfo.environment["AGENT_WORKFORCE_SCAN_ALLOW_ROOTS"], !override.isEmpty {
        allowedRoots = Set(override.split(separator: ":").map {
            URL(fileURLWithPath: String($0)).resolvingSymlinksInPath().path
        })
    } else {
        allowedRoots = Set(["Documents", "Downloads", "Desktop"].map {
            home.appendingPathComponent($0).resolvingSymlinksInPath().path
        })
    }
    for r in roots {
        guard let dir = r["dir"] as? String else { continue }
        let canonDir = URL(fileURLWithPath: dir).resolvingSymlinksInPath().path
        guard allowedRoots.contains(canonDir) else {
            logLine("scan: refusing non-TCC-root \(dir) (confused-deputy guard)")
            continue
        }
        let maxDepth = (r["maxDepth"] as? Int) ?? 4
        let importOnly = (r["importOnly"] as? Bool) ?? false
        walk(canonDir, depth: maxDepth, importOnly: importOnly)
    }

    let result: [String: Any] = [
        "ok": true,
        "req": nonce,
        "dirs": dirsOut,
        "loose": looseOut,
        "bounded": ["dirs": boundedDirs, "count": false, "importable": boundedImportable, "visited": dirCount],
    ]
    do {
        let data = try JSONSerialization.data(withJSONObject: result, options: [])
        try fm.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: outURL, options: .atomic)   // atomic: the engine never reads a torn result
        // Remove the claimed request AFTER the result lands, not before: in the window between a
        // remove and the write, defaultTccScan would see no result AND no pending request/inflight
        // and drop a fresh scan-request.json -> a redundant second walk. (Non-fatal if it fails:
        // the watcher only ever renames a fresh scan-request.json into .inflight.)
        try? fm.removeItem(at: reqURL)
        return true
    } catch {
        logLine("scan: could not write scan-result.json (\(error.localizedDescription))")
        return false
    }
}

// MARK: - #2124 single-instance handoff
//
// A fresh install ran MULTIPLE Kosmos instances: the installer launches a copy,
// and the dragged /Applications copy is a DIFFERENT bundle PATH, which LaunchServices
// treats as a separate app (single-instance is keyed on path, not just bundle id). So
// applicationDidFinishLaunching now dedups by bundle id: if another instance is already
// running, it activates that one and exits, so the FIRST instance to launch stays THE
// app and later duplicates fold into it. (Whether that first launch is the /Applications
// copy depends on the installer's launch path -- the install-location tangle is the
// pre-existing, deliberately-deferred residual noted in the plan, not settled here.)
//
// 🛑 THE ONE EXCEPTION IS #2094's SELF-UPDATE RELAUNCH. There, the EXITING stale
// instance deliberately launches a fresh copy that shares its bundle id and then exits;
// if the fresh copy deduped-by-activation it would land on the stale one and, once the
// stale one terminates, quit to NOTHING. So the relaunch hands the fresh copy an EXPLICIT
// handoff signal, and the fresh copy skips the dedup when it sees it. The signal is
// carried TWO ways, and either one suffices, because the failure of the signal is the
// quit-to-nothing bug and must not depend on a single fragile channel:
//   1. A launch-environment variable set on the relaunch's OpenConfiguration -- handed
//      directly to the new process, no disk, no timing window, and PROCESS-SPECIFIC (only
//      the fresh copy inherits it). This is the robust primary.
//   2. A short-TTL token file the exiting instance writes -- a belt-and-suspenders
//      fallback in case the environment does not propagate, exactly the written token
//      the design called for.
// A NORMAL user launch (double-click, dock, installer) carries neither, so it dedups.
//
// ⚠️ The token is GLOBAL, not process-specific: it cannot be, because a process-targeted
// token would need a secret handed to the fresh copy, which is exactly what channel 1
// already is. So in a narrow race -- a manual launch double-clicked in the sub-second
// window between the exiting instance writing the token and the fresh copy consuming it --
// the manual launch could read the token and skip its own dedup, ending up as a second
// window. This is accepted deliberately: channel 1 protects the INTENDED fresh copy
// regardless (it is process-specific), the window is a coincidence of manual timing during
// an auto-update, and the harm is one recoverable extra window -- far less than the
// quit-to-nothing the token exists to prevent. Removing the token to close the race would
// drop the defense-in-depth the design called for, so it stays.

let kRelaunchHandoffEnvKey = "KOSMOS_RELAUNCH_HANDOFF"
let kRelaunchHandoffTTL: TimeInterval = 30  // a relaunch's fresh copy launches within a second or two

// The handoff token file, resolved the SAME way boardTokenValue() resolves its dir, so
// the exiting instance and the fresh copy (same user, same env) agree on the path.
func relaunchHandoffURL() -> URL? {
    let env = ProcessInfo.processInfo.environment
    let base: URL
    if let dataOverride = env["AGENT_WORKFORCE_DATA"], !dataOverride.isEmpty {
        base = URL(fileURLWithPath: dataOverride)
    } else if let homeOverride = env["AGENT_WORKFORCE_HOME"], !homeOverride.isEmpty {
        base = URL(fileURLWithPath: homeOverride).appendingPathComponent("Library/Application Support")
    } else if let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
        base = dir
    } else {
        return nil
    }
    return base.appendingPathComponent("\(storeLeaf(base: base))/relaunch-handoff")
}

// Called by the EXITING instance right before it opens the fresh copy. Best-effort: a
// write failure is logged, not fatal, because the environment handoff (channel 1) is the
// primary and does not touch disk.
func writeRelaunchHandoffToken() {
    guard let url = relaunchHandoffURL() else { return }
    do {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try String(Date().timeIntervalSince1970).write(to: url, atomically: true, encoding: .utf8)
    } catch {
        logLine("relaunch-handoff: could not write token (\(error.localizedDescription)); env handoff still stands")
    }
}

// Called by a FRESH instance at launch. Returns true iff this launch is a #2094 relaunch
// handoff (via the env var OR a fresh token file), and CONSUMES both so the signal is
// one-shot: the token FILE is removed, and the env var is unset in THIS process so it
// neither lingers nor propagates to descendants. That propagation matters -- the engine
// subprocess startBoard spawns copies the current environment, and a stale handoff carried
// into any descendant that later launched the GUI would wrongly skip the dedup.
func consumeFreshRelaunchHandoff(now: Date = Date()) -> Bool {
    var handoff = false
    if let raw = ProcessInfo.processInfo.environment[kRelaunchHandoffEnvKey], !raw.isEmpty {
        handoff = true
    }
    // Unset unconditionally: the signal is one-shot, and it must not survive to be
    // inherited by a descendant process (startBoard copies the current environment).
    unsetenv(kRelaunchHandoffEnvKey)
    if let url = relaunchHandoffURL() {
        if let raw = try? String(contentsOf: url, encoding: .utf8),
           let written = Double(raw.trimmingCharacters(in: .whitespacesAndNewlines)),
           now.timeIntervalSince1970 - written <= kRelaunchHandoffTTL,
           now.timeIntervalSince1970 - written >= 0 {
            handoff = true
        }
        // Always delete: the signal is one-shot, and a lingering token must not exclude
        // a later launch. That exclusion is NOT harmless when another instance is up --
        // it is exactly the duplicate #2124 prevents -- which is why the relaunch-failure
        // path removes the token too rather than letting it ride out its TTL.
        try? FileManager.default.removeItem(at: url)
    }
    return handoff
}

// Another running instance of THIS app (same bundle id, different process), or nil.
//
// ⚠️ ACCEPTED RESIDUAL: this is a runtime ENUMERATION, so it cannot close a truly
// simultaneous-launch race -- two copies opened in the same instant can each enumerate
// before the other has registered as running, see nil, and both proceed. Closing that
// window would need an OS-level launch lock, out of scope for #2124 and a launch-critical
// change of its own. It does NOT affect the reported #2124 bug, which is SEQUENTIAL: the
// installer launches its copy, then the user later drags to /Applications and opens that
// one -- seconds apart, so the second enumeration sees the first.
func otherRunningInstance() -> NSRunningApplication? {
    guard let bid = Bundle.main.bundleIdentifier else { return nil }
    let me = ProcessInfo.processInfo.processIdentifier
    return NSRunningApplication.runningApplications(withBundleIdentifier: bid)
        .first { $0.processIdentifier != me }
}

// The pure decision, factored out so both arms are unit-assertable without a window
// server: defer to (activate + exit for) an existing instance ONLY on a normal launch
// with another instance up. A relaunch handoff NEVER defers (that is the #2094 carve-out).
//   (a) duplicate launch:      handoff=false, other=true  -> true  (dedup fires)
//   (b) #2094 relaunch:        handoff=true,  other=true  -> false (excluded; fresh survives)
//   normal single launch:      handoff=false, other=false -> false
//   relaunch, stale already gone: handoff=true, other=false -> false
func shouldDeferToExistingInstance(handoff: Bool, otherRunning: Bool) -> Bool {
    return !handoff && otherRunning
}

// A board URL with the token added as a `?token=` query item, for a WebView load:
// the board validates it, sets an httpOnly cookie, and redirects to the clean URL,
// so subsequent same-origin requests carry the cookie automatically. Adds nothing
// when there is no token (a non-enforcing board) or when a `token` item is already
// present, and preserves any existing query rather than clobbering it (so a
// KOSMOS_URL override that already carries `?first-run=1` keeps it).
func tokenizedBoardURL(_ urlString: String) -> URL? {
    guard var comps = URLComponents(string: urlString) else { return URL(string: urlString) }
    if let tok = boardTokenValue(),
       !(comps.queryItems ?? []).contains(where: { $0.name == "token" }) {
        var items = comps.queryItems ?? []
        items.append(URLQueryItem(name: "token", value: tok))
        comps.queryItems = items
    }
    return comps.url ?? URL(string: urlString)
}

/* #3996: the page's waiting count, handed to the app. A separate object held WEAKLY to the app:
   WKUserContentController keeps its handlers alive, and holding the AppDelegate there would be a
   cycle. Only the board's own page is heard: the main frame at the board's own address and port
   (the app loads nothing else there, but a main frame could be sent to another local service). */
final class BadgeMessageProxy: NSObject, WKScriptMessageHandler {
    weak var owner: AppDelegate?
    init(_ owner: AppDelegate) { self.owner = owner }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let owner else { return }
        let origin = message.frameInfo.securityOrigin
        guard owner.isBoardOrigin(host: origin.host, port: origin.port, scheme: origin.protocol) else { return }
        owner.pageSaidWaiting(message.body)
    }
}

/* #4356: the first screen's choice, handed to the app. Held weakly, as BadgeMessageProxy is, and
   heard only from the board's address in the main frame, and only while the app is asking
   (pageChoseMode): another origin cannot pick this computer's mode.
   ⚠️ The same trust as the Dock badge: "the page at 127.0.0.1:<this install's port>". A different
   process answering on that port (a stale or misconfigured install) would be trusted too. Accepted
   (review round 20): per-account ports make it rare, a choice is taken only while the app asks, and
   what posts it is the person's own click on the screen they see; only a hostile local process
   could post one unasked, and that computer is already not ours to defend here. */
final class ModeMessageProxy: NSObject, WKScriptMessageHandler {
    weak var owner: AppDelegate?
    init(_ owner: AppDelegate) { self.owner = owner }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let owner else { return }
        let origin = message.frameInfo.securityOrigin
        guard owner.isBoardOrigin(host: origin.host, port: origin.port, scheme: origin.protocol) else { return }
        owner.pageChoseMode(message.body)
    }
}

/* #4409: talking to an agent. The page's mic button asks this bridge to listen; the words come back
   into the composer as text, and nothing is sent. ON-DEVICE ONLY, by construction:
   `requiresOnDeviceRecognition = true`, and a language with no on-device model is REFUSED rather than
   handed to Apple's servers. Audio goes from the input tap straight to the recognizer and is never
   written anywhere.

   Why not the page's own `webkitSpeechRecognition`: it exists in our web view (measured on #4409), but the
   host app still needs the same two permissions and the same entitlement, and the page cannot ask for
   on-device recognition. Same cost, weaker promise.

   🛑 THE APP NEEDS THREE THINGS OUTSIDE THIS FILE, and missing any one fails SILENTLY:
     - `com.apple.security.device.audio-input` on the hardened-runtime signature
       (native-app/kosmos-app.entitlements, applied in tools/build-kosmos-bundle.sh);
     - `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` in the Info.plist that
       install/setup.sh writes. With a usage string missing, macOS KILLS the process at the request, so
       `start` checks for both first and refuses with `not-set-up` instead of crashing.

   Same guard as the badge: only the board's own page, in the main frame, can start the mic. */
final class VoiceBridge: NSObject, WKScriptMessageHandler {
    weak var owner: AppDelegate?
    weak var webView: WKWebView?
    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    /// #4409 (review 1): held for the life of the task. A recognizer released while its task runs is a commonly
    /// reported way for the task to never call back; nothing else here owned it.
    private var recognizer: SFSpeechRecognizer?
    /// Which start the callbacks belong to. A callback from an older start is dropped, so a stop
    /// followed by a quick start can never be finished by the first one's late answer.
    private var session = 0
    /// #4409 (review 2): the page's own id for the start it asked for, echoed on every event. The page moves between
    /// mics with cancel-then-start in one turn, and the cancel's "stopped" arrives AFTER the page has begun the next
    /// session: without an id it switched the new button off while the mic went on listening.
    private var pageId = ""
    /// A start is waiting on a permission answer: nothing to stop yet, but a hidden window must still cancel it.
    private var pending = false
    private var limit: DispatchWorkItem?
    init(_ owner: AppDelegate) { self.owner = owner }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let owner else { return }
        let origin = message.frameInfo.securityOrigin
        guard owner.isBoardOrigin(host: origin.host, port: origin.port, scheme: origin.protocol) else { return }
        guard let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
        switch op {
        case "start":
            pageId = (body["id"] as? String) ?? ""
            start()
        case "stop": stop()
        case "cancel": cancel()
        default: return
        }
    }

    /// The first language the person prefers that has an ON-DEVICE model, else nil. PURE, so
    /// --kosmos-app-voice-selftest drives it. `en-US` is the last resort only because it is the one
    /// on-device model every Mac we measured carries; it is still asked, never assumed.
    static func pickLocale(preferred: [String], onDevice: (String) -> Bool) -> String? {
        var seen = Set<String>()
        for raw in preferred + ["en-US"] {
            let id = raw.replacingOccurrences(of: "_", with: "-")
            if id.isEmpty || !seen.insert(id).inserted { continue }
            if onDevice(id) { return id }
        }
        return nil
    }

    /// What the page is told when listening ends on an error. PURE for the selftest. 1110 is the
    /// recognizer's "no speech detected", which is an ordinary silence, not a fault.
    static func endReason(domain: String, code: Int) -> String {
        if domain == "kAFAssistantErrorDomain" && code == 1110 { return "nothing-heard" }
        if domain == "kAFAssistantErrorDomain" && (code == 203 || code == 216 || code == 301) { return "" }   // cancelled or stopped by us
        return "recognizer"
    }

    static func usageStringsPresent(_ info: [String: Any]?) -> Bool {
        guard let info else { return false }
        return (info["NSMicrophoneUsageDescription"] as? String)?.isEmpty == false
            && (info["NSSpeechRecognitionUsageDescription"] as? String)?.isEmpty == false
    }

    private func emit(_ event: [String: Any]) {
        var event = event
        event["id"] = pageId   // read NOW: a cancel's "stopped" carries the id of the session it ended
        guard let web = webView,
              let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.kosmosVoiceEvent && window.kosmosVoiceEvent(" + json + ")", completionHandler: nil)
    }

    private func refuse(_ reason: String) {
        pending = false
        logLine("voice: not listening (" + reason + ")")
        emit(["kind": "error", "reason": reason])
        emit(["kind": "stopped"])
    }

    private func start() {
        stopAudio(); task?.cancel(); task = nil; request = nil
        session += 1
        let mine = session
        pending = true
        guard Self.usageStringsPresent(Bundle.main.infoDictionary) else { refuse("not-set-up"); return }
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard mine == self.session else { return }
                guard status == .authorized else { self.refuse(status == .notDetermined ? "speech-unanswered" : "speech-denied"); return }
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    DispatchQueue.main.async {
                        guard mine == self.session else { return }
                        guard granted else { self.refuse("mic-denied"); return }
                        self.begin(mine)
                    }
                }
            }
        }
    }

    private func begin(_ mine: Int) {
        pending = false
        let preferred = Locale.preferredLanguages + [Locale.current.identifier]
        guard let id = Self.pickLocale(preferred: preferred, onDevice: { SFSpeechRecognizer(locale: Locale(identifier: $0))?.supportsOnDeviceRecognition == true }),
              let recognizer = SFSpeechRecognizer(locale: Locale(identifier: id)), recognizer.isAvailable else {
            refuse("no-on-device"); return
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.requiresOnDeviceRecognition = true   // 🛑 the whole promise: never the network
        req.shouldReportPartialResults = true
        req.addsPunctuation = true
        let eng = AVAudioEngine()
        let input = eng.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.channelCount > 0, format.sampleRate > 0 else { refuse("no-mic"); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in req.append(buffer) }
        eng.prepare()
        do { try eng.start() } catch {
            input.removeTap(onBus: 0)
            refuse("no-mic"); return
        }
        engine = eng
        request = req
        self.recognizer = recognizer
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal == true
            let ns = error.map { $0 as NSError }
            DispatchQueue.main.async {
                guard let self, mine == self.session else { return }
                if let text { self.emit(["kind": isFinal ? "final" : "partial", "text": text]) }
                if ns != nil || isFinal { self.finish(ns) }
            }
        }
        logLine("voice: listening, on-device, " + id)
        emit(["kind": "listening", "lang": id])
        // A mic left on by mistake does not listen forever.
        let cap = DispatchWorkItem { [weak self] in if mine == self?.session { self?.stop() } }
        limit = cap
        DispatchQueue.main.asyncAfter(deadline: .now() + 300, execute: cap)
    }

    /// Stop listening and let the recognizer deliver what it heard (a final result follows).
    private func stop() {
        guard let req = request else { session += 1; pending = false; stopAudio(); emit(["kind": "stopped"]); return }
        stopAudio()
        req.endAudio()
        // #4409 (review 1): the final answer normally follows at once; if it never comes, the button must not say
        // "Stop listening" for good. Bounded, then finished with whatever the page already has.
        let mine = session
        let wait = DispatchWorkItem { [weak self] in
            guard let self, mine == self.session, self.request != nil else { return }
            self.task?.cancel()
            self.finish(nil)
        }
        limit = wait
        DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: wait)
    }

    /// #4409 (review 1): the app itself ends listening when the page cannot show it: the window closed (stay-running
    /// mode only hides it, so the page gets no pagehide), minimised, or (review 3) the page's process died or a new
    /// page loaded, which would draw the mic as off while it listened. No-op when not listening.
    func hostCancel(_ why: String) {
        guard pending || engine != nil || request != nil || task != nil else { return }
        logLine("voice: cancelled, " + why)
        cancel()
    }

    /// Stop and throw away anything still coming (the person pressed Send).
    private func cancel() {
        session += 1
        pending = false
        stopAudio()
        task?.cancel(); task = nil; request = nil; recognizer = nil
        emit(["kind": "stopped"])
    }

    private func finish(_ error: NSError?) {
        stopAudio()
        task = nil; request = nil; recognizer = nil
        session += 1
        if let error {
            let reason = Self.endReason(domain: error.domain, code: error.code)
            if !reason.isEmpty {
                logLine("voice: ended, " + error.domain + " " + String(error.code))
                emit(["kind": "error", "reason": reason])
            }
        }
        emit(["kind": "stopped"])
    }

    private func stopAudio() {
        limit?.cancel(); limit = nil
        if let eng = engine {
            eng.stop()
            eng.inputNode.removeTap(onBus: 0)
        }
        engine = nil
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    /// #4409: the mic's bridge, so closing or minimising the window can turn the mic off.
    var voice: VoiceBridge?
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
    // #2125 slice 3: the repeating Accessibility-refresh timer (held so it survives).
    private var a11yTimer: Timer?
    // #1 / #2189: the watcher that turns a webview grant-button POST into a real,
    // under-tmux macOS prompt (see startPromptRequestWatcher).
    private var promptRequestTimer: Timer?
    // #3996: the Dock badge's poll (held so it survives), when the page last handed over its count,
    // and the order answers were asked in (an older answer never overwrites a newer one).
    private var badgeTimer: Timer?
    // #4356: this computer's choice, read once at launch (readComputerMode) and changed only by the
    // first screen or the menu. `modeHome` is the install it was read from and is written back to;
    // nil under the KOSMOS_URL test path, where there is no install and the app behaves as today.
    private(set) var computerMode: ComputerMode = .unset
    private var modeHome: String?
    private var modePort: Int?   // the resolved install's port, for `kosmos stop` (stopBoard)
    // #4356: how many `kosmos stop`s of ours are running: the switch to connect, a connect launch
    // stopping a board left running, a start that landed after Connect. "Run agents on this computer"
    // refuses, saying so, until all of them finish, or its `kosmos start` would race a stop (and the stop can win, leaving a
    // run computer's board down). A count, not a flag: two stops can overlap, and the first to finish
    // must not clear the wait for the second (review round 5).
    private var stopsInFlight = 0
    private var lastPageBadgeAt: TimeInterval?   // systemUptime: a clock that never steps backwards
    private var badgeAsked = 0
    private var badgeShown = 0
    private var badgeReadFailing = false
    private var badgeEverAnswered = false
    private var badgeMisses = 0
    // The board's own origin, the only page allowed to hand over a count (set where the board is chosen).
    // #5167: also the board downloads are saved from (isBoardPage); a change made for the badge changes
    // downloads too. fileprivate so the download selftest can set it.
    fileprivate var badgeOrigin: (host: String, port: Int)?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // #2124: single-instance. A fresh install could run this app from two bundle
        // PATHS (the installer's launched copy + the dragged /Applications copy), which
        // LaunchServices treats as separate apps. Dedup by bundle id: if another instance
        // is already up, activate IT and exit, so the first instance stays the one app.
        // EXCEPT a #2094 self-update relaunch, which hands us a one-shot handoff signal so
        // it is not mistaken for a duplicate (deduping there would quit to nothing).
        let handoff = consumeFreshRelaunchHandoff()
        let other = otherRunningInstance()
        if shouldDeferToExistingInstance(handoff: handoff, otherRunning: other != nil) {
            logLine("#2124: another Kosmos instance is already running; activating it and exiting this duplicate")
            /* Raise the survivor's WINDOWS, not just its process: .activateAllWindows brings
               the existing instance's window forward so the person sees it after this
               duplicate exits, rather than a process that is frontmost with nothing on
               screen. Log the result so a declined activation is diagnosable.
               ⚠️ ACCEPTED RESIDUAL: if the survivor's window was CLOSED (this app hides via
               orderOut rather than quitting, closingWindowQuits=false), it is off the window
               server and activation cannot bring it back -- only the survivor's own
               applicationShouldHandleReopen re-shows it, and macOS does not route a reopen
               here because the duplicate is a different bundle PATH. In the reported #2124
               scenario the survivor's window is freshly shown (visible), so this surfaces it;
               the hidden-window edge is a rarer follow-up (a cross-process reopen/notify). */
            if let survivor = other, !survivor.activate(options: [.activateAllWindows]) {
                logLine("#2124: activation of the existing instance was declined by the OS")
            }
            /* 🛑 SET THIS BEFORE terminate, exactly as the #2094 relaunch path does.
               NSApp.terminate re-enters applicationShouldTerminate, which -- with this
               flag false -- shows the "Your agents keep running" quit dialog and, if the
               person dismisses it, returns .terminateCancel and the DUPLICATE STAYS OPEN,
               defeating this whole guard. The dedup is not a person-initiated quit; there
               is nothing to confirm, so terminate cleanly. */
            isActuallyQuitting = true
            NSApp.terminate(nil)
            return
        }
        NSApp.setActivationPolicy(.regular)
        // #4356: read before anything starts, so a connect computer never starts its board.
        readLaunchComputerMode()
        buildMenu()
        buildWindow()
        if computerMode == .connect {
            logLine("#4356: this computer connects to agents on another computer; its own board is not started")
            loadConnect()
            stopBoardIfRunning()
        } else {
            loadBoard()
        }
        NSApp.activate(ignoringOtherApps: true)
        if computerMode != .connect {
            // #2125 slice 3: keep the native Accessibility verdict fresh for the first-run
            // gate (spawned under the bundled tmux; see startA11yTrustChecks). Best-effort
            // and non-fatal -- if it cannot run, the gate stays fail-safe (Continue enabled).
            startA11yTrustChecks()
            // #1 / #2189: notice a webview grant-button's prompt request and fire the real
            // macOS prompt under tmux on demand. Best-effort, non-fatal.
            startPromptRequestWatcher()
        }
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

    // MARK: #2125 slice 3 -- keeping the native Accessibility verdict fresh
    //
    // The engine cannot read Accessibility trust (#1344); the native app does it via
    // AXIsProcessTrusted and writes the verdict where engine/a11ystatus.js reads it,
    // and the first-run Continue gate consumes it (fail-safe: it only ever BLOCKS on a
    // positive checkable:true+trusted:false). The hatches are spawned under the bundled
    // tmux on the BELIEF that this would make the verdict reflect TMUX's trust -- tmux
    // being the responsible process that owns the folder-TCC grant, and the process the
    // copy tells the user to grant ("Turn on Tmux in Accessibility"). ⚠️ THAT BELIEF IS
    // VERIFIED WRONG (see the correction below): accessibility is keyed on the CALLING
    // BINARY, so the under-tmux read reports the kosmos-APP's trust, not tmux's. The
    // spawn-under-tmux is retained only because the axPROMPT is the mechanism that
    // surfaces an Accessibility entry at all -- but by the SAME calling-binary rule that
    // entry is the kosmos-APP's, NOT tmux's, which is exactly why #2189 sees "no Tmux to
    // enable" when the pane opens Accessibility. The axCHECK's verdict likewise does not
    // describe tmux and must not be read as if it does. Check and prompt use the same AX
    // API family in the same binary; neither can be attributed to tmux.
    //
    // 🛑 THE ATTRIBUTION IS VERIFIED WRONG (2026-09-06, #2125), AND THE HARM WAS THE
    // OPPOSITE DIRECTION FROM WHAT THIS COMMENT ORIGINALLY ANTICIPATED. It read: the
    // one risk is a FALSE-BLOCK (app ungranted, tmux granted -> trusted:false ->
    // Continue stuck). Josh's 0.6.42 fresh-account re-test showed the real failure is a
    // FALSE-GREEN: the under-tmux AXIsProcessTrusted reports the APP's trust (accessibility
    // is keyed on the CALLING BINARY, not the responsible process), so on a fresh account
    // the tmux gate read ACTIVATED on arrival while tmux was ungranted and absent from the
    // Accessibility list. So the LOAD-BEARING UNKNOWN of #2125 is now resolved: an
    // under-tmux re-exec reports the APP's trust, NOT tmux's. This verdict therefore does
    // not describe tmux at all. #2189 (Open-Accessibility surfaces no Tmux to enable) is
    // the same seam. Fix = the pending #2125 keep/drop fork (KEEP: one-identity routing;
    // DROP: remove the ask, no synthetic-input API is used). Do not re-assume the tmux
    // attribution. Root: ~/work/Josh-Brain/Projects/kosmos-tcc-identity-root-2378-1-3-2026-09-06.md
    //
    // ⚠️ THE PROTECTION IS THE RELEASE PROCESS, NOT THIS CODE. There is no in-code guard
    // here (no feature flag, no channel check, no bias-to-trusted default): this writer
    // emits the REAL reading unconditionally, deliberately, so the attribution CAN be
    // verified on a fresh install (the bias-to-trusted mitigation in the plan would make
    // the writer inert and UNVERIFIABLE, which is why it is NOT applied). So a
    // #2125-carrying build MUST NOT promote to prod until the deferred fresh-install
    // verify on #2125 passes on staging. If that human gate is skipped, this code can
    // false-block. Ruled by Splinter (build-now + deferred-verify); do not silently
    // change it to a bias default without re-opening that decision, because it breaks
    // the verify.
    private func startA11yTrustChecks() {
        // The bundled tmux lives under the resolved install home, the same home
        // startBoard uses. resolveInstall is a pure, synchronous function; a failure
        // to resolve is non-fatal -- the gate is fail-safe, so no reading just means
        // Continue stays enabled.
        guard let home = try? resolveInstall(config: KosmosInstallConfig.load()).kosmosHome else {
            logLine("a11y: could not resolve the install home; skipping Accessibility checks (gate stays fail-safe)")
            return
        }
        // #2347 (Josh's 0.6.41 fresh-install re-test): NO a11y PROMPT at launch. #2371
        // fixed the bundled-tmux path so spawnAxHatchUnderTmux now actually fires; that
        // turned this once-at-launch axprompt into the FIRST thing a user saw on
        // install, before the Access screen -- and it activated accessibility at install
        // time, so the later Access-screen tmux step read "Activated" and the person
        // skipped the Turn-On flow. The prompt must fire ONLY on-demand: the Access
        // screen's tmux Turn-On POSTs /api/a11y-prompt and startPromptRequestWatcher
        // (below) fires the axprompt hatch then. So the launch-time axprompt is removed;
        // the on-demand watcher owns it. (File-access already fires on-demand only.)
        //
        // The axCHECK stays at launch + on a timer: it only READS trust
        // (AXIsProcessTrusted, no prompt) and writes a11y-status.json for the first-run
        // Continue gate to poll. Reading is not prompting.
        // Refresh now, then on a repeating timer well inside a11ystatus's staleness
        // window (5 min) so the first-run screen always polls a fresh verdict.
        spawnAxHatchUnderTmux(kosmosHome: home, hatch: "--kosmos-app-axcheck")
        a11yTimer?.invalidate()   // #4356: callable again after a switch back to run; never two timers
        a11yTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            self?.spawnAxHatchUnderTmux(kosmosHome: home, hatch: "--kosmos-app-axcheck")
        }
    }

    // (currentlyTrusted() was removed with the launch-time axprompt in #2347: it existed
    // only to decide that one-shot launch prompt, which no longer fires. The on-demand
    // axprompt is benign if the user is already trusted -- macOS no-ops it -- so no
    // pre-check is needed on that path.)

    // Spawn a native hatch UNDER the bundled tmux via a PRIVATE tmux server socket
    // (-L kosmos-axcheck), so this never touches the user's own tmux sessions. The
    // hatch runs detached, writes its verdict (axcheck) or triggers the system prompt
    // (axprompt), and exits; the private server winds down with its last session.
    // Not waited on: the hatch is detached and blocking the main thread on it would
    // beachball launch -- the reading lands within a moment and the poll picks it up
    // (fail-safe until it does).
    // MARK: On-demand permission prompts (#1 / #2189)
    //
    // The permission screens' grant buttons must fire the REAL macOS prompts on demand,
    // not just open Settings (Josh's 0.6.39 #1: "clicking the grant button ... didn't
    // actually ask for the correct permission"). The webview button POSTs to the engine
    // (server.js), which drops a request file in the shared store dir; this watcher --
    // running in the APP, the process that can spawn under the bundled tmux -- notices it
    // and fires the matching hatch under tmux, using the SAME under-tmux spawn the
    // launch-time axcheck uses. Firing through the app rather than letting the engine
    // spawn tmux keeps the spawn tree IDENTICAL to the proven launch (axcheck) path,
    // adding no new attribution assumption to the #2125 seam. (The attribution the
    // Accessibility API actually reports is now RESOLVED, not an open question: the AX
    // call is labelled by the calling binary, the kosmos-app, not tmux -- verified by
    // Josh's 0.6.42 fresh-account re-test, see the startA11yTrustChecks correction. This
    // watcher's job is only the on-demand FIRING, timing fixed in #2347.)
    private func startPromptRequestWatcher() {
        checkPromptRequests()
        checkScanRequest()
        // 1.5s: fast enough that a grant button feels like it fired the prompt, cheap
        // enough (a fileExists on two paths) to run continuously.
        promptRequestTimer?.invalidate()   // #4356: callable again after a switch back to run; never two timers
        promptRequestTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            self?.checkPromptRequests()
            self?.checkScanRequest()
        }
    }

    // #3 / #2125 follow-up: the import-scan TCC-root walk. The engine drops scan-request.json;
    // this claims it by an ATOMIC rename to scan-request.inflight (so two 1.5s ticks cannot
    // both launch a walk) and fires --kosmos-app-scan under tmux -- the SAME spawn path as the
    // file-access hatch, so the walk runs under the APP identity that holds the S2 grant and
    // fires no fresh Documents prompt. The hatch reads the .inflight file, writes
    // scan-result.json (atomic, nonce-tagged) and removes the .inflight file.
    private func checkScanRequest() {
        guard let req = storeFileURL("scan-request.json"),
              FileManager.default.fileExists(atPath: req.path),
              let inflight = storeFileURL("scan-request.inflight") else { return }
        // A request older than 60s is abandoned (the engine's poll times out well before
        // then); drop it rather than fire a walk nobody is waiting on.
        if let attrs = try? FileManager.default.attributesOfItem(atPath: req.path),
           let mtime = attrs[.modificationDate] as? Date,
           Date().timeIntervalSince(mtime) > 60 {
            try? FileManager.default.removeItem(at: req)
            logLine("scan-request: dropped stale request (older than 60s)")
            return
        }
        guard let home = try? resolveInstall(config: KosmosInstallConfig.load()).kosmosHome else { return }
        // The rename IS the consume: exactly one tick wins it, and a failure (already claimed,
        // or gone) means another tick got there first -- so bail without firing.
        do {
            // Replace any leftover .inflight from a crashed prior walk, then claim.
            try? FileManager.default.removeItem(at: inflight)
            try FileManager.default.moveItem(at: req, to: inflight)
        } catch {
            return
        }
        spawnAxHatchUnderTmux(kosmosHome: home, hatch: "--kosmos-app-scan")
    }

    private func checkPromptRequests() {
        // Steady state is cheap: only a fileExists per request name. Resolve the install
        // (config load + disk path resolution) ONLY when a request is actually pending,
        // rather than every 1.5s tick for the app's whole idle lifetime.
        let names = ["a11y-prompt-request", "file-access-prompt-request", "a11y-recheck-request"]
        let pending = names.contains { name in
            guard let u = storeFileURL(name) else { return false }
            return FileManager.default.fileExists(atPath: u.path)
        }
        guard pending else { return }
        // kosmosHome carries the bundled tmux; a failure to resolve means we cannot spawn
        // under tmux, so there is nothing to do (the button's Settings fallback covers it).
        guard let home = try? resolveInstall(config: KosmosInstallConfig.load()).kosmosHome else { return }
        consumeRequest(named: "a11y-prompt-request") { [weak self] in
            self?.spawnAxHatchUnderTmux(kosmosHome: home, hatch: "--kosmos-app-axprompt")
            // Refresh the verdict now. Accessibility is granted asynchronously (the user
            // toggles tmux in System Settings), so this does NOT flip the pill by itself
            // -- it just keeps the reading fresh; the 60s timer or a later re-request
            // captures the eventual grant. (Contrast the file-access hatch, where the TCC
            // prompt is synchronous and the one hatch can capture the grant.)
            self?.spawnAxHatchUnderTmux(kosmosHome: home, hatch: "--kosmos-app-axcheck")
        }
        consumeRequest(named: "file-access-prompt-request") { [weak self] in
            // One hatch both fires the Files-and-Folders prompt and writes the verdict
            // (see fileAccessReading / --kosmos-app-fileaccessprompt).
            self?.spawnAxHatchUnderTmux(kosmosHome: home, hatch: "--kosmos-app-fileaccessprompt")
        }
        // #3282: the "tmux-a11y-prompt-request" consumer (and spawnTmuxAutomationPrompt) were
        // removed. That onboarding pre-register was written only by the deleted
        // /api/tmux-a11y-prompt route, whose web trigger #3113/#3298 removed. The runtime
        // automation path (engine/terminal.js osascript under tmux) is separate and untouched.
        consumeRequest(named: "a11y-recheck-request") { [weak self] in
            // #2912: a manual "Check again" on the Access screen. Run ONLY the axcheck
            // (AXIsProcessTrusted, no prompt) so a just-granted permission is re-measured
            // and a11y-status.json is rewritten AT ONCE -- no axprompt (a re-check must not
            // re-surface the system dialog) and no wait on the 60s timer. The app reading
            // its OWN trust needs no Full Disk Access, which is exactly the fresh-install-
            // no-FDA case where the engine's appGrant() read is unavailable and the route
            // falls back to this native file -- so this is what makes "Check again" force a
            // fresh verdict there instead of re-reading the same stale 60s file.
            self?.spawnAxHatchUnderTmux(kosmosHome: home, hatch: "--kosmos-app-axcheck")
        }
    }

    // If a fresh request file is present, consume it (delete) and fire the hatch. A
    // request older than 30s is dropped unfired (it is from a previous run), and the
    // hatch fires only if the delete actually succeeded, so a failed delete cannot
    // re-fire the prompt every tick.
    private func consumeRequest(named name: String, fire: () -> Void) {
        guard let url = storeFileURL(name),
              FileManager.default.fileExists(atPath: url.path) else { return }
        // Drop a request older than 30s rather than fire it. Such a request reflects a
        // click from a PREVIOUS run: the app was up when the engine wrote it (so
        // nativePresent passed), then quit before this watcher's next tick consumed it,
        // and the file persisted to this launch. Firing a TCC prompt the user did not
        // just ask for is surprising -- and unlike the live case there is no button
        // click to explain it. 30s comfortably covers the POST -> 1.5s-tick latency of a
        // real click. (#2347: this now matters EQUALLY for both requests -- neither a11y
        // nor file-access fires at launch any more, so a leftover request of either kind
        // would be the only way an un-asked-for prompt could appear; the 30s drop is what
        // prevents it.)
        if let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
           let mtime = attrs[.modificationDate] as? Date,
           Date().timeIntervalSince(mtime) > 30 {
            // Log by what actually happened: an unconditional "dropped" would lie when
            // the delete failed (the file survives and the next tick retries).
            do {
                try FileManager.default.removeItem(at: url)
                logLine("prompt-request: dropped stale \(name) (older than 30s)")
            } catch {
                logLine("prompt-request: could not drop stale \(name) (\(error.localizedDescription)); will retry next tick")
            }
            return
        }
        // Delete before firing, and fire ONLY if the delete succeeded. The delete is
        // the consume: a hatch that takes a moment cannot be launched twice by
        // successive ticks -- but that guarantee holds only when the file is actually
        // gone. A best-effort `try?` that failed while still firing would leave the
        // request on disk and re-fire a real TCC prompt every 1.5s until the staleness
        // guard drops it (prompt spam). So on a delete failure we log and bail; the next
        // tick retries the delete, and staleness is the backstop. (A transient SPAWN
        // failure still loses the one request, but the gate poll never flips, so a
        // re-click re-requests it -- recovery without a double-prompt.)
        do {
            try FileManager.default.removeItem(at: url)
        } catch {
            logLine("prompt-request: could not consume \(name) (\(error.localizedDescription)); not firing to avoid a re-fire loop")
            return
        }
        logLine("prompt-request: consumed \(name); firing under tmux")
        fire()
    }

    // #3282: spawnTmuxAutomationPrompt was REMOVED. It ran an osascript automation op under
    // the bundled tmux to pre-register the tmux Accessibility/Automation grant during
    // onboarding, driven by the deleted /api/tmux-a11y-prompt route (web trigger removed by
    // #3113/#3298). With no caller it was dead code. The runtime path that actually acquires
    // the grant at first agent action (engine/terminal.js osascript under tmux) is separate
    // and unchanged; spawnAxHatchUnderTmux (the app-subject a11y/file-access hatch) also remains.

    private func spawnAxHatchUnderTmux(kosmosHome: String, hatch: String) {
        guard let exe = Bundle.main.executableURL?.path else {
            logLine("a11y: no executable path; cannot spawn \(hatch)")
            return
        }
        guard let tmux = resolveBundledTmux(kosmosHome: kosmosHome) else {
            logLine("a11y: no bundled tmux under \(kosmosHome) (looked at AGENT_WORKFORCE_TMUX_BIN and tmux/bin/tmux); skipping \(hatch) (gate stays fail-safe)")
            return
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tmux)
        // Single-quote the executable path so a space in the bundle path cannot split
        // the command tmux hands to /bin/sh; an app-bundle path carries no single quote.
        p.arguments = ["-L", "kosmos-axcheck", "new-session", "-d", "'\(exe)' \(hatch)"]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do {
            try p.run()
        } catch {
            logLine("a11y: could not spawn tmux for \(hatch): \(error.localizedDescription)")
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
        // #4356: every way into here (launch, Reload's fall-through, a navigation failure's one-shot)
        // would run `kosmos start`, which clears board.stopped. None of them may on a connect computer.
        guard computerMode != .connect else {
            logLine("#4356: loadBoard refused on a connect computer; loading sign-in instead")
            loadConnect()
            return
        }
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
            // #1946: tokenize the override too, so pointing KOSMOS_URL at an
            // enforcing board loads a working board rather than a 403 shell. A
            // sandbox board has no token, so this is a no-op there (the test path's
            // usual target).
            guard let url = tokenizedBoardURL(urlString) else {
                showStartupFailureAlert(detail: "The address \(urlString) is not a valid URL.")
                return
            }
            logLine("LOADING \(url.absoluteString) (KOSMOS_URL override, test path)")
            /* #3996: the page on the chosen board still feeds the Dock badge (its origin is the board);
               the app's own poll needs the resolved port, so it stays off here. */
            if let host = url.host { badgeOrigin = (host, url.port ?? Self.defaultPort(url.scheme)) }
            logLine("dock badge: fed by the page only under KOSMOS_URL")
            boardLoadNavigation = webView.load(URLRequest(url: url))
            return
        }

        let config = KosmosInstallConfig.load()
        logLine("KosmosInstallConfig.load() -> \(config == nil ? "nil (no baked config; using defaults/overrides)" : "loaded")")

        let resolved: ResolvedInstall
        do {
            resolved = try resolveInstall(config: config)
            resolvedPort = resolved.port
            badgeOrigin = ("127.0.0.1", resolved.port)
            startDockBadge(port: resolved.port)
        } catch InstallResolutionError.noOwnInstallForOtherUser {
            // Logged before the modal so a test double can observe the
            // refusal without needing to click the dialog it is about to
            // block on (see the modal note on showStartupFailureAlert below).
            logLine("resolveInstall: refused, no own install for this account")
            // #664's dialog (see showForeignAccountAlert; #3114 gave it a Download button and
            // trimmed the wording, so it is no longer the bash launcher's text verbatim).
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
                // #4356: a start already running when the person chose Connect can finish after the
                // stop did. Undo it, before the stale-generation check below drops the result.
                if self.computerMode == .connect {
                    logLine("#4356: a board start finished after Connect; stopping it again")
                    // Retire this start as finished, or the 300 s watchdog says "still starting" on a
                    // computer that runs no board; and hold Run agents until this stop is done.
                    if let s = self.inFlightStart, s.generation == generation { self.inFlightStart = nil }
                    self.boardStartInFlight = false
                    self.boardStartGeneration += 1
                    self.stopsInFlight += 1
                    DispatchQueue.global(qos: .utility).async { [weak self] in
                        _ = stopBoard(kosmosHome: resolved.kosmosHome, port: resolved.port)
                        DispatchQueue.main.async { self?.stopsInFlight -= 1 }
                    }
                    return
                }
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
                    self.showStartupFailureAlert(detail: "Something went wrong while \(whose) was starting. \(remedy): open installkosmos.com and click Download for macOS. Your agents and settings stay on this computer; installing again does not remove them.")
                case .alreadyRunningOrStarted:
                    let urlString = "http://127.0.0.1:\(resolved.port)"
                    guard let url = self.withModeQuery(tokenizedBoardURL(urlString)) else {
                        self.showStartupFailureAlert(detail: "The address \(urlString) is not a valid URL.")
                        return
                    }
                    logLine("LOADING \(url.absoluteString)")
                    self.boardLoadNavigation = self.webView.load(URLRequest(url: url))
                }
            }
        }
    }

    // MARK: #4356: this computer runs agents, or connects to agents on another computer

    /// Once, at launch, before anything starts. The KOSMOS_URL test path has no install to read,
    /// and an install that cannot be resolved is loadBoard's to explain: both behave as today.
    private func readLaunchComputerMode() {
        // The release switch (KOSMOS_FIRSTRUN_CHOICE): off, every Mac runs agents, as before #4356.
        guard kosmosFirstRunChoice else { computerMode = .run; return }
        guard ProcessInfo.processInfo.environment["KOSMOS_URL"] == nil,
              let install = try? resolveInstall(config: KosmosInstallConfig.load())
        else { computerMode = .run; return }
        let home = install.kosmosHome
        modeHome = home
        modePort = install.port
        computerMode = readComputerMode(kosmosHome: home)
        logLine("#4356: this computer's mode is \(computerMode.rawValue)")
    }

    /// The board's address, plus what the page must know: `unset` shows the first screen before
    /// first run, `unreadable` shows it even after first run (web frChoiceWanted), and `both` ends
    /// first run at Kosmos Plus sign-in (web frPlusLast).
    func withModeQuery(_ url: URL?) -> URL? {
        guard let url, computerMode == .unset || computerMode == .unreadable || computerMode == .both,
              var comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return url }
        var items = comps.queryItems ?? []
        items.append(URLQueryItem(name: "mode", value: computerMode.rawValue))
        comps.queryItems = items
        return comps.url ?? url
    }

    /// #4356: after a run or both answer, the board is started if it is not running. The screen was
    /// served by the board, but an update can stop it while the screen waits (its pause, and it does
    /// not start a board for an unreadable choice), leaving the answer on a dead page. `kosmos start`
    /// on a healthy board only checks it, and it clears board.stopped, which a run computer wants.
    /// Known race: an answer given while the update is still copying files can start from a half
    /// copied tree and fail; the failure is said (Cmd-R), and the installer's own start or launchd
    /// restart at the end of its run brings the finished board up.
    private func ensureBoardRunning(home: String) {
        guard let port = resolvedPort ?? modePort, !boardStartInFlight else { return }
        // Counted as a board start, as loadBoard's is, so a Cmd-R meanwhile is ignored (reloadDecision)
        // rather than racing a second `kosmos start` (review round 12).
        boardStartInFlight = true
        boardStartGeneration += 1
        let generation = boardStartGeneration
        // The same 300 s watchdog loadBoard has: a start that never returns must not leave every
        // Cmd-R a silent beep (#965).
        DispatchQueue.main.asyncAfter(deadline: .now() + 300) { [weak self] in
            guard let self, self.boardStartInFlight, self.boardStartGeneration == generation else { return }
            logLine("#4356: the start after the choice gave no answer in 300s; re-arming Reload")
            self.boardStartInFlight = false
            self.boardStartGeneration += 1
        }
        DispatchQueue.global(qos: .utility).async {
            let result = startBoard(kosmosHome: home, port: port)
            DispatchQueue.main.async { [weak self] in
                guard let self, self.boardStartGeneration == generation else { return }
                self.boardStartInFlight = false
                if case .failed(let why) = result {
                    logLine("#4356: start after the choice failed: \(why)")
                    self.showStartupFailureAlert(detail: "Kosmos could not start its board on this computer after your choice. Click OK, then press Cmd-R (View > Reload) to try again.")
                }
            }
        }
    }

    private func showChoiceNotSaved(_ home: String) {
        showStartupFailureAlert(detail: "Kosmos could not save your choice on this computer, so it may ask you again, or carry on as if this computer runs agents. Check that you can make changes in the Kosmos folder in your home folder (\(home)).", title: "Kosmos could not save your choice")
    }

    /// #4356: `kosmos stop` did not stop the board (it did not die, or something else answers on the
    /// port). Said when it happens: at the switch to connect, or at a launch's retry (stopBoardIfRunning).
    private func showBoardStillRunning() {
        logLine("#4356: kosmos stop failed; the board may still be running on this computer")
        showStartupFailureAlert(detail: "Kosmos could not stop running in the background on this computer. You can connect to your other computer anyway. Kosmos will try again the next time it opens, and it will not start again when you restart this computer.", title: "Kosmos is still running here")
    }

    /// At every launch of a connect computer: `kosmos stop`, whatever the marker says. A board left
    /// running (a stop that failed, one started by hand) is stopped again; the marker cannot be the
    /// sign, since a failed stop leaves it written too (holdBoardStopped). With nothing running, the
    /// CLI says so and writes the marker, which costs a moment and nothing else.
    private func stopBoardIfRunning() {
        guard let home = modeHome else { return }
        logLine("#4356: connect computer launching; making sure its board is stopped")
        stopsInFlight += 1
        let port = modePort   // read here, on the main thread, not from the queue below
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let outcome = stopBoard(kosmosHome: home, port: port)
            DispatchQueue.main.async {
                self?.stopsInFlight -= 1
                if outcome == .failed { self?.showBoardStillRunning() }
                // #4382: after the stop, so the look never meets a board of ours mid-stop.
                self?.startUpdateLooks()
            }
        }
    }

    private func loadConnect() {
        lastLoadFailed = false
        logLine("LOADING \(kosmosPlusSignIn.absoluteString) (#4356 connect)")
        boardLoadNavigation = webView.load(URLRequest(url: kosmosPlusSignIn))
    }

    /// The first screen's button. Heard only while no choice is saved (unset or unreadable): once one
    /// is, no page can change it. An install from before #4356 has no file until its next update
    /// writes `run` (install/setup.sh, when its first run is done); only the board's own page in the
    /// main frame can post here.
    func pageChoseMode(_ body: Any) {
        guard let choice = body as? String, let home = modeHome,
              computerMode == .unset || computerMode == .unreadable
        else { logLine("#4356: ignored a mode message while not asking (\(body))"); return }
        switch choice {
        case "run":
            // First run carries on either way; a choice that could not be saved is said (showChoiceNotSaved),
            // and with no file the computer counts as run once its first run is done.
            if !writeComputerMode(.run, kosmosHome: home) { showChoiceNotSaved(home) }
            computerMode = .run
            ensureBoardRunning(home: home)
            logLine("#4356: this computer runs agents")
        case "both":
            // Runs agents like run; first run ends at Kosmos Plus sign-in, which the page does itself.
            if !writeComputerMode(.both, kosmosHome: home) { showChoiceNotSaved(home) }
            computerMode = .both
            ensureBoardRunning(home: home)
            logLine("#4356: this computer runs agents and connects to other computers")
        case "connect":
            guard writeComputerMode(.connect, kosmosHome: home) else {
                showStartupFailureAlert(detail: "Kosmos could not save your choice on this computer, so it will ask again. Check that you can make changes in the Kosmos folder in your home folder (\(home)).", title: "Kosmos could not switch")
                loadBoard()
                return
            }
            switchToConnect(home: home)
        default:
            logLine("#4356: ignored an unknown mode message (\(choice))")
        }
    }

    /// Everything that belongs to a board here stops: the Dock badge, the Accessibility checks and
    /// the prompt watcher, then the board itself (`kosmos stop`, off the main thread). Sign-in loads
    /// after the stop has finished either way, and a stop that failed is said (showBoardStillRunning).
    private func switchToConnect(home: String) {
        computerMode = .connect
        stopsInFlight += 1
        logLine("#4356: switching this computer to connect")
        // The local board's port stops being this window's: #4347's stale-app check keys on it, and
        // the pages from here on are Kosmos Plus's (ensureBoardRunning falls back to modePort).
        resolvedPort = nil
        // A Reload still in flight must not fall through to a board start when the stop kills its page.
        recoverOnReloadFailure = false
        reloadNavigation = nil
        badgeTimer?.invalidate(); badgeTimer = nil
        badgeOrigin = nil   // #5167: no board of its own to save downloads from any more
        committedPageURL = nil
        a11yTimer?.invalidate(); a11yTimer = nil
        promptRequestTimer?.invalidate(); promptRequestTimer = nil
        NSApp.dockTile.badgeLabel = nil
        updateRunAgentsItem()
        let port = modePort   // read here, on the main thread, not from the queue below
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let outcome = stopBoard(kosmosHome: home, port: port)
            DispatchQueue.main.async {
                guard let self else { return }
                self.stopsInFlight -= 1
                guard self.computerMode == .connect else { return }
                self.loadConnect()
                if outcome == .failed { self.showBoardStillRunning() }
                self.startUpdateLooks()   // #4382: from now on this app, not a board, keeps this computer current
            }
        }
    }

    /// The Kosmos menu's "Run agents on this computer", shown only on a connect computer. It is
    /// here and not in Settings because the Settings on screen are the OTHER computer's (#4356,
    /// Liu Kang m2442). `kosmos start` (loadBoard) clears board.stopped, and first run, never
    /// finished on this computer, opens as it would on a fresh one.
    @objc func runAgentsHere(_ sender: Any?) {
        guard computerMode == .connect, let home = modeHome else { return }
        // #4382: an install this app started before it quit is not counted in stopsInFlight; its marker is.
        let installing = updateLookInFlight || Self.installUnderWay(kosmosHome: home)
        guard stopsInFlight == 0, !installing else {
            logLine("#4356: Run agents refused for now: a stop or an update is still running")
            let detail = installing
                ? "Kosmos is still updating on this computer. Try again when it has finished."
                : "Kosmos is still stopping the board on this computer. Try again in a moment."
            showStartupFailureAlert(detail: detail, title: "One moment")
            return
        }
        guard writeComputerMode(.run, kosmosHome: home) else {
            showStartupFailureAlert(detail: "Kosmos could not save that change on this computer, so it still connects to agents on another computer. Check that you can make changes in the Kosmos folder in your home folder (\(home)), then try again.", title: "Kosmos could not switch")
            return
        }
        computerMode = .run
        logLine("#4356: switching this computer to run agents")
        stopUpdateLooks()   // #4382: the board looks for updates again, every fifteen minutes
        updateRunAgentsItem()
        loadBoard()
        startA11yTrustChecks()
        startPromptRequestWatcher()
    }

    private func updateRunAgentsItem() {
        let items = NSApp.mainMenu?.items.first?.submenu?.items ?? []
        items.first(where: { $0.action == #selector(AppDelegate.runAgentsHere(_:)) })?.isHidden = computerMode != .connect
        // Settings… (Cmd-,) opens the page's own Settings, which on a connect computer is the OTHER
        // computer's; hidden there, as the plan says this computer's settings are not on that page.
        items.first(where: { $0.action == #selector(AppDelegate.openSettings(_:)) })?.isHidden = computerMode == .connect
    }

    // MARK: #4382: a connect computer keeps itself current, with no board

    /// The look, at launch (after stopBoardIfRunning's stop), when a computer switches to connect, and
    /// once a day while it stays one. A look that could not reach the release host is tried again once,
    /// an hour later (the retry itself is not retried), and a Mac that wakes when its last look is a day
    /// old looks then.
    static let updateLookInterval: TimeInterval = 24 * 60 * 60
    static let updateRetryAfterUnknown: TimeInterval = 60 * 60
    private var updateTimer: Timer?
    private var updateLookInFlight = false
    /// When the last look finished, whatever it found; the wake look keys on it.
    private var lastUpdateLookAt: Date?
    /// The look in flight is the hour retry, which is not retried again: offline, the next look is the
    /// daily one (or a wake), not one an hour for as long as the app runs.
    private var updateLookIsRetry = false
    private var updateRetry: DispatchWorkItem?
    private var updateWakeObserver: NSObjectProtocol?
    /// A version the installer finished while nobody asked (updates are on). The new app waits for the
    /// person's Restart, so words being typed on the page are never lost to a restart nobody chose.
    private var installedUpdate: String?
    /// The version offered (updates are off, or an install failed), or nil when there is no offer.
    private var offeredUpdate: String?
    /// The slim native bar under the title bar. Native on purpose (Liu Kang, #4382): on a connect
    /// computer the page belongs to the other computer, so nothing is injected into it, and there is
    /// no macOS notification (this app never asks for that permission).
    private var updateBar: NSTitlebarAccessoryViewController?
    private var updateBarLabel: NSTextField?
    private var updateBarButton: NSButton?
    /// The version whose bar the person closed with Not Now; the menu item still offers it.
    private var updateBarDismissed: String?

    private func startUpdateLooks() {
        guard computerMode == .connect else { return }
        if updateTimer == nil {
            updateTimer = Timer.scheduledTimer(withTimeInterval: Self.updateLookInterval, repeats: true) { [weak self] _ in
                self?.lookForUpdate(install: false)
            }
        }
        if updateWakeObserver == nil {
            updateWakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
                forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
                guard let self, self.computerMode == .connect else { return }
                if let last = self.lastUpdateLookAt, Date().timeIntervalSince(last) < Self.updateLookInterval { return }
                logLine("#4382: woke with the last update look a day old or more; looking now")
                self.lookForUpdate(install: false)
            }
        }
        lookForUpdate(install: false)
    }

    private func stopUpdateLooks() {
        updateTimer?.invalidate(); updateTimer = nil
        updateRetry?.cancel(); updateRetry = nil
        if let o = updateWakeObserver { NSWorkspace.shared.notificationCenter.removeObserver(o); updateWakeObserver = nil }
        installedUpdate = nil
        showUpdateOffer(nil)
    }

    /// #4382: whether the version on disk is one to restart into: strictly newer than the running app.
    /// An app newer than its install (a hand-run build) is never offered a "Restart" into an older one, and a
    /// version either side cannot read offers nothing (isBehind's unknown). Pure, for the update selftest.
    static func restartWanted(running: String?, onDisk: String) -> Bool {
        guard let running else { return false }
        return isBehind(running, onDisk) == true
    }

    /// #4382: an install under way here, as `kosmos update` judges it: logs/install.started younger than
    /// 30 minutes. An interrupted install leaves an older marker behind, which is not in the way.
    static func installUnderWay(kosmosHome: String) -> Bool {
        let marker = kosmosHome + "/logs/install.started"
        guard let at = (try? FileManager.default.attributesOfItem(atPath: marker))?[.modificationDate] as? Date else { return false }
        let age = Date().timeIntervalSince(at)
        return age >= 0 && age < 30 * 60   // a marker from the future (a clock change) holds nothing off
    }

    /// One more look an hour after one that could not reach the release host, not a day later.
    private func retryUpdateLookSoon() {
        guard updateRetry == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            self?.updateRetry = nil
            self?.lookForUpdate(install: false, retry: true)
        }
        updateRetry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.updateRetryAfterUnknown, execute: work)
    }

    /// One look, and the install when it is due. `install` is the person's choice from the offer.
    private func lookForUpdate(install: Bool, retry: Bool = false) {
        guard computerMode == .connect, let home = modeHome else { return }
        guard !updateLookInFlight else { logLine("#4382: an update look is already running"); return }
        updateLookInFlight = true
        updateLookIsRetry = retry
        // Counted as a stop of ours: "Run agents on this computer" waits for an installer to finish
        // rather than starting a board in the middle of it.
        stopsInFlight += 1
        if install {
            // Shown even when the bar was put away with Not Now (the menu item is the other way to press
            // Update): the person is told the app restarts before it does.
            let bar = updateBar ?? makeUpdateBar()
            updateBarLabel?.stringValue = "Updating Kosmos. It restarts when the update is installed."
            updateBarButton?.isHidden = true   // pressed once is enough; it comes back with the answer
            bar.isHidden = false
            let items = NSApp.mainMenu?.items.first?.submenu?.items ?? []
            items.first(where: { $0.action == #selector(AppDelegate.updateKosmosNow(_:)) })?.isHidden = true
        }
        let port = modePort   // read here, on the main thread, not from the queue below
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let answer = runKosmosUpdate(kosmosHome: home, port: port, install: install)
            DispatchQueue.main.async {
                guard let self else { return }
                self.updateLookInFlight = false
                self.stopsInFlight -= 1
                self.lastUpdateLookAt = Date()
                self.updateLookDone(answer, asked: install)
            }
        }
    }

    private func updateLookDone(_ answer: UpdateAnswer, asked: Bool) {
        guard computerMode == .connect else { showUpdateOffer(nil); return }
        if !updateLookIsRetry {
            if case .unknown = answer { retryUpdateLookSoon() }
            // An install another run of this app started may still be going: look again within the hour.
            if case .refused = answer, !asked { retryUpdateLookSoon() }
        }
        switch answer {
        case .newer(let v):
            // Replaces a waiting Restart offer, if any: pressing Update installs the newer one and restarts.
            showUpdateOffer(v)
        case .failed(let v):
            showUpdateOffer(v, note: "Kosmos could not update to \(v). Press Update to try again.")
        case .updated(let v) where asked && !ownDialogOpen:
            // The person pressed Update, and the bar said it restarts when done. The offer is kept
            // underneath, so a relaunch that fails leaves Restart on offer, not nothing.
            showInstalledOffer(v)
            relaunchAfterUpdate(to: v)
        case .updated(let v):
            // Installed because updates are on, or a dialog of ours is open: never restart unasked.
            showInstalledOffer(v)
        case .unknown where asked:
            // The person pressed Update and the release host could not be reached: say so, keep the offer.
            showUpdateOffer(offeredUpdate, note: "Kosmos could not reach its update server. Check your internet connection and try again.")
        case .unknown:
            // Could not look: what is on offer stays on offer (a missed look is not "nothing newer").
            if let v = installedUpdate { showInstalledOffer(v) }
        case .board where asked, .refused where asked:
            // The person pressed Update and it could not start here (another install is under way, or a
            // board now runs): say so, and keep what was offered.
            showUpdateOffer(offeredUpdate, note: "Kosmos could not start the update right now. Try again in a few minutes.")
        case .current(let v) where installedUpdate == nil && Self.restartWanted(running: runningAppVersion(), onDisk: v)
                                   && Self.freshAppURL(theirs: v) != nil:
            // What is on disk is newer than what is running, and an app carrying it is there: an install this app
            // did not see finish (another run of it started it, or a relaunch failed). Offer the Restart.
            showInstalledOffer(v)
        case .current, .board, .refused:
            // A later look finds the installed version current; an installed update still waits for Restart.
            if let v = installedUpdate { showInstalledOffer(v) } else { showUpdateOffer(nil) }
        }
    }

    /// The bar and the menu item, once a new version is installed and waits for a restart.
    private func showInstalledOffer(_ v: String) {
        installedUpdate = v
        showUpdateOffer(v, note: "Kosmos \(v) is installed. Restart Kosmos to start using it.", installed: true)
    }

    /// Relaunch approved for #4382 (Liu Kang): the installer opens the app only when the board is
    /// its own (setup.sh), so without this a connect Mac would keep running the old app. The same
    /// relaunch the stale-app check uses (#2094/#4347), aimed at the copy that now carries `v`.
    private func relaunchAfterUpdate(to v: String) {
        guard let target = Self.freshAppURL(theirs: v) else {
            logLine("#4382: updated to \(v), but no Kosmos.app on disk carries it; not relaunching")
            showUpdateOffer(nil, note: "Kosmos \(v) is installed. Quit Kosmos and open it again to start using it.", menu: false)
            return
        }
        relaunch(mine: runningAppVersion() ?? "unknown", theirs: v, target: target, waited: 0, asked: true, askedBefore: true)
    }

    /// The menu item "Update Kosmos to X" and the bar. nil hides both, unless a note is given.
    /// `installed`: the version is already installed and the button restarts into it.
    private func showUpdateOffer(_ version: String?, note: String? = nil, menu: Bool = true, installed: Bool = false) {
        offeredUpdate = (menu && !installed) ? version : nil
        if !installed { installedUpdate = nil }
        let actionable: String? = installed ? version : offeredUpdate
        let items = NSApp.mainMenu?.items.first?.submenu?.items ?? []
        if let item = items.first(where: { $0.action == #selector(AppDelegate.updateKosmosNow(_:)) }) {
            item.isHidden = actionable == nil
            item.title = actionable.map { installed ? "Restart Kosmos to Use \($0)" : "Update Kosmos to \($0)" } ?? "Update Kosmos"
        }
        let text: String? = note ?? version.map { "Kosmos \($0) is available. Updates are off on this computer, so it was not installed." }
        // Not Now holds for that version whatever the bar would say about it (an install waiting for
        // Restart, a failure); the menu item still offers it, and a new version raises the bar again.
        guard let text, version == nil || version != updateBarDismissed else {
            updateBar?.isHidden = true
            return
        }
        let bar = updateBar ?? makeUpdateBar()
        updateBarLabel?.stringValue = text
        updateBarButton?.title = installed ? "Restart" : "Update"
        updateBarButton?.isHidden = actionable == nil
        bar.isHidden = false
    }

    private func makeUpdateBar() -> NSTitlebarAccessoryViewController {
        let label = NSTextField(labelWithString: "")
        label.lineBreakMode = .byTruncatingTail
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let update = NSButton(title: "Update", target: self, action: #selector(AppDelegate.updateKosmosNow(_:)))
        update.bezelStyle = .rounded
        update.keyEquivalent = ""
        let later = NSButton(title: "Not Now", target: self, action: #selector(AppDelegate.dismissUpdateBar(_:)))
        later.bezelStyle = .rounded
        let row = NSStackView(views: [label, update, later])
        row.orientation = .horizontal
        row.spacing = 8
        row.edgeInsets = NSEdgeInsets(top: 4, left: 12, bottom: 4, right: 12)
        row.translatesAutoresizingMaskIntoConstraints = false
        let host = NSView(frame: NSRect(x: 0, y: 0, width: 600, height: 32))
        host.addSubview(row)
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            row.topAnchor.constraint(equalTo: host.topAnchor),
            row.bottomAnchor.constraint(equalTo: host.bottomAnchor),
        ])
        let bar = NSTitlebarAccessoryViewController()
        bar.layoutAttribute = .bottom
        bar.view = host
        window.addTitlebarAccessoryViewController(bar)
        updateBar = bar
        updateBarLabel = label
        updateBarButton = update
        return bar
    }

    /// The menu item and the bar's button: restart into an installed version, or install the offered
    /// one whatever the Updates switch says, because the person chose it.
    @objc func updateKosmosNow(_ sender: Any?) {
        guard computerMode == .connect else { return }
        guard !updateLookInFlight else { logLine("#4382: Update pressed while a look is running; it answers shortly"); return }
        if let v = installedUpdate {
            updateBarDismissed = nil
            relaunchAfterUpdate(to: v)
            return
        }
        guard offeredUpdate != nil else { return }
        updateBarDismissed = nil   // asked for it: what follows is shown, even after a Not Now
        lookForUpdate(install: true)
    }

    @objc func dismissUpdateBar(_ sender: Any?) {
        updateBarDismissed = installedUpdate ?? offeredUpdate
        updateBar?.isHidden = true
    }

    /// #4356: a connect computer's main-frame navigations follow connectLinkDecision. #5167: on every
    /// computer, a download the page asks for is decided first.
    /* 📌 PINNED, as createWebViewWith is: an optional delegate method with a slightly wrong Swift
       signature compiles and is never called, which would switch the connect policy off silently.
       The selector is WebKit's own (WKNavigationDelegate.h). */
    @objc(webView:decidePolicyForNavigationAction:decisionHandler:)
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        /* #5167: a download the page asked for (`<a download>`: #4930's attachments, #5165's Files lists
           over Kosmos+) is SAVED when the page is a board and the file is from its origin, after the person
           allows it for a Kosmos+ computer (mayDownload). */
        if navigationAction.shouldPerformDownload, let url = navigationAction.request.url,
           isBoardPage(committedPageURL, board: badgeOrigin), isSameOriginDownload(url, page: committedPageURL) {
            // No name here: the name saved comes from the answer, which a page can make differ from its link.
            mayDownload(file: nil) { decisionHandler($0 ? .download : .cancel) }
            return
        }
        // A download this app will not save is refused, not loaded in the window instead (from a board page's own
        // frame only a blob: or data: download gets here: WebKit makes a cross-origin `download` link a plain link).
        if navigationAction.shouldPerformDownload {
            logLine("#5167: refused a download that is not from this board")
            let boardPage = isBoardPage(committedPageURL, board: badgeOrigin)
            if navigationAction.targetFrame?.isMainFrame != false {
                tellDownloadFailed(boardPage
                    ? "That file is not from this board, so it was not saved."
                    : "This page is not a board Kosmos saves files from, so the file was not saved.", quiet: true)
            }
            decisionHandler(.cancel)
            return
        }
        guard computerMode == .connect, let url = navigationAction.request.url,
              let frame = navigationAction.targetFrame, frame.isMainFrame
        else { decisionHandler(.allow); return }
        switch connectLinkDecision(for: url, clicked: navigationAction.navigationType == .linkActivated) {
        case .inApp:
            decisionHandler(.allow)
        case .browser:
            logLine("#4356: opening in the browser: \(url.absoluteString)")
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        case .block:
            logLine("#4356: refused a navigation: \(url.absoluteString)")
            decisionHandler(.cancel)
        }
    }

    /* #5167: what each response does, in the order below: an attachment from the board's origin, on a board
       page, is saved (for a Kosmos+ computer, after the person allows it); any other attachment is refused and logged
       (a foreign file the window cannot show likewise); a board file the window cannot show is saved; anything
       else is shown if WebKit can show its type and cancelled if not.
       📌 PINNED selector, as above: a near-miss Swift signature compiles and is never called. */
    @objc(webView:decidePolicyForNavigationResponse:decisionHandler:)
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        // A frame inside the page cannot save a file just by loading; only the page's own navigations can.
        guard navigationResponse.isForMainFrame else {
            decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
            return
        }
        // A 204 or 205 has nothing to show or save; WebKit leaves the page as it is.
        if let http = navigationResponse.response as? HTTPURLResponse, http.statusCode == 204 || http.statusCode == 205 {
            decisionHandler(.allow)
            return
        }
        if let http = navigationResponse.response as? HTTPURLResponse, let url = http.url,
           let disposition = http.value(forHTTPHeaderField: "Content-Disposition"),
           String(disposition[..<(disposition.firstIndex(of: ";") ?? disposition.endIndex)])
               .trimmingCharacters(in: .whitespaces).lowercased() == "attachment" {
            if isBoardPage(committedPageURL, board: badgeOrigin), isSameOriginDownload(url, page: committedPageURL) {
                mayDownload(file: navigationResponse.response.suggestedFilename) { decisionHandler($0 ? .download : .cancel) }
            } else {
                logLine("#5167: refused an attachment that is not from this board")
                if committedPageURL != nil { tellDownloadFailed(isBoardPage(committedPageURL, board: badgeOrigin)
                    ? "The file came from somewhere Kosmos does not save from, so it was not saved."
                    : "This page is not a board Kosmos saves files from, so the file was not saved.", quiet: true) }
                decisionHandler(.cancel)
            }
            return
        }
        if !navigationResponse.canShowMIMEType, let url = navigationResponse.response.url,
           isBoardPage(committedPageURL, board: badgeOrigin), isSameOriginDownload(url, page: committedPageURL) {
            mayDownload(file: navigationResponse.response.suggestedFilename) { decisionHandler($0 ? .download : .cancel) }   // a board file the window cannot show (a .zip) is saved, as Safari does
            return
        }
        if !navigationResponse.canShowMIMEType {
            logLine("#5167: a response this window cannot show, not from this board, was not loaded")
            // No page yet (start-up, a crash, a switch to connect): the app's own load, not a file the person asked for.
            if committedPageURL != nil { tellDownloadFailed(isBoardPage(committedPageURL, board: badgeOrigin)
                ? "That file came from somewhere Kosmos does not save from, so it was not opened or saved."
                : "This page is not a board Kosmos saves files from, so the file was not opened or saved.", quiet: true) }
        }
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
    }

    /// #5167: only --kosmos-app-download-selftest sets this, so a measured run never writes to the real Downloads.
    static var downloadsDirOverride: URL?

    /// #5167: the page on screen, as of its last main-frame commit. fileprivate for the download selftest.
    fileprivate var committedPageURL: URL?

    /// #5167: both ways a navigation becomes a download hand it to this delegate, which picks where it goes.
    @objc(webView:navigationAction:didBecomeDownload:)
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    @objc(webView:navigationResponse:didBecomeDownload:)
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    /// #5167: how a failed download the board started is said (one modal alert). Swapped out by
    /// --kosmos-app-download-selftest, which has no one to press OK. A policy refusal is only logged (tellDownloadFailed).
    static var downloadAlertPresenter: ((String) -> Void)?

    /// #5167: downloads whose failure this app has already said, so the failure that follows is not said twice.
    // Weak keys: an entry goes with its download, so a later one at the same address never inherits it.
    private let downloadsTold = NSHashTable<WKDownload>.weakObjects()

    /// #5167: whoever holds a Kosmos+ name runs that name's tunnel, so a Kosmos+ computer's page is only as
    /// trusted as its holder. The first time one asks to save a file, the person is asked, as Safari asks per
    /// site. Either answer holds for this run of the app only: nothing is kept that a later holder of the
    /// same name could inherit, and a page cannot ask again and again. This computer's own board, which this
    /// app loaded, is never asked about.
    static var downloadPermissionPresenter: ((String, @escaping (Bool) -> Void) -> Void)?
    /// Only --kosmos-app-download-selftest sets this: a loopback host to treat as a Kosmos+ computer, so the
    /// question can be driven through a real click.
    static var askAboutHostForSelftest: String?
    fileprivate var allowedDownloadHosts: Set<String> = []
    private var refusedDownloadHosts: Set<String> = []
    fileprivate func resetDownloadAsks() { refusedDownloadHosts = [] }   // the selftest, between its arms
    private var downloadAsks: [String: [(Bool) -> Void]] = [:]
    private var pageCommits = 0   // main-frame commits; the Allow answer counts only for the page that asked

    fileprivate func mayDownload(file: String? = nil, _ then: @escaping (Bool) -> Void) {
        guard let page = committedPageURL, let host = page.host?.lowercased(),
              isKosmosPlusURL(page) || host == AppDelegate.askAboutHostForSelftest
        else { then(true); return }
        if allowedDownloadHosts.contains(host) { then(true); return }
        if refusedDownloadHosts.contains(host) {
            logLine("#5167: downloads from \(host) were not allowed this time (the person said so; View > Reload asks again)")
            then(false); return
        }
        if downloadAsks[host] != nil { downloadAsks[host]!.append(then); return }   // one question at a time
        downloadAsks[host] = [then]
        let answer: (Bool) -> Void = { yes in   // strong: every waiting decision handler must be answered
            if yes { self.allowedDownloadHosts.insert(host) } else { self.refusedDownloadHosts.insert(host) }
            logLine("#5167: downloads from \(host) \(yes ? "allowed" : "not allowed")")
            for waiting in self.downloadAsks.removeValue(forKey: host) ?? [] { waiting(yes) }
        }
        if let ask = AppDelegate.downloadPermissionPresenter { ask(host, answer); return }
        let commitsBefore = pageCommits
        // On the next turn, not inside WebKit's policy callback: the waiting decision handlers are held in
        // downloadAsks, so WebKit's delegate calls do not run nested inside this question's modal loop.
        DispatchQueue.main.async { [self] in
        let alert = NSAlert()
        alert.messageText = "Allow downloads from \(host)?"
        // Cleaned as a saved name is (no direction controls or separators): the page chose this text.
        let clean = file.map { downloadDestination(dir: URL(fileURLWithPath: "/"), suggested: $0) { _ in false }.lastPathComponent }
        let shown = clean.map { $0.filter { !"\"\u{201C}\u{201D}\u{2018}\u{2019}'`".contains($0) } }   // cannot close the quotation
        let what = (shown.map { !$0.isEmpty && $0 != "Download" } ?? false) ? "\u{201C}\(shown!)\u{201D}" : "a file"
        alert.informativeText = "This Kosmos+ computer wants to save \(what) to your Downloads folder. Allow it only if it is one of your own computers. Your answer lasts until Kosmos quits; after Don't Allow, View > Reload asks again."
        alert.alertStyle = .warning
        let allow = alert.addButton(withTitle: "Allow")
        let refuse = alert.addButton(withTitle: "Don't Allow")
        // Return answers Don't Allow: the page decides when this appears, so a keypress meant for the
        // composer must never grant it.
        allow.keyEquivalent = ""
        refuse.keyEquivalent = "\r"
        alert.window.initialFirstResponder = refuse   // with Full Keyboard Access a stray Space must not answer Allow either
        // Modal, not a sheet: every download from this computer waits on the answer, and a sheet over another
        // sheet can be dropped (#2807), which would leave them waiting for good.
        NSApp.activate(ignoringOtherApps: true)   // in front, where the person can read it
        let asked = alert.runModal() == .alertFirstButtonReturn
        // The page may have changed while it was asked (a switch to connect clears it). Don't Allow is always kept
        // (refusing is safe, and a page that reloads cannot ask again and again); only an Allow is void, since it
        // was given for a page no longer there, and the waiting downloads are not saved.
        if asked, committedPageURL?.host?.lowercased() != host || pageCommits != commitsBefore {
            logLine("#5167: the page changed while \(host) was asked about, so its downloads were not saved")
            for waiting in downloadAsks.removeValue(forKey: host) ?? [] { waiting(false) }
            return
        }
        answer(asked)
        }
    }

    /// #5167: a download the person started that did not save is said, one plain alert each. A refusal by policy
    /// (`quiet: true`: not a board, not this board's origin, WebKit stopping it; a computer the person did not allow
    /// and a page that changed are logged in mayDownload itself) is logged only: the person either chose it or is not on a Kosmos page, and a page that
    /// repeats one cannot pile alerts up. The selftest sets downloadAlertPresenter to read what is said.
    private func tellDownloadFailed(_ detail: String, title: String? = nil, quiet: Bool = false, always: Bool = false) {
        if quiet { logLine("#5167: not saved (a refusal, logged only): \(detail)"); return }
        let title = title ?? "Kosmos could not save that file"
        if let present = AppDelegate.downloadAlertPresenter { present(title + ": " + detail); return }   // the selftest
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = detail
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        // Modal, never a sheet: a sheet over another sheet can be dropped (#2807), and a failure must be said.
        // Shown on the next turn, so the caller answers WebKit first rather than holding its decision under it.
        DispatchQueue.main.async {
            if always { NSApp.activate(ignoringOtherApps: true) }   // the one warning about a saved file is seen
            alert.runModal()
        }
    }

    /// #5167: where each running download is being saved, so its end can be told to the Dock.
    private var downloadsInFlight: [ObjectIdentifier: URL] = [:]

    /// #5167: a download's redirect to another origin is refused. A backstop: WebKit itself stops a download
    /// redirected to another origin before asking (measured on WebKit 21624); this keeps the rule if it ever
    /// asks. Same-origin redirects do reach it (the selftest's same-origin redirect row).
    @objc(download:willPerformHTTPRedirection:newRequest:decisionHandler:)
    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        if let to = request.url, isSameOriginDownload(to, page: download.originalRequest?.url) {
            decisionHandler(.allow)
        } else {
            logLine("#5167: refused a download's redirect to another origin")
            downloadsTold.add(download)
            tellDownloadFailed("The file pointed somewhere Kosmos does not save from, so it was not saved.", quiet: true)
            decisionHandler(.cancel)
        }
    }

    /// #5167: into the person's Downloads folder, under a safe name that never replaces a file
    /// (downloadDestination). No Downloads folder: the download is cancelled rather than put elsewhere.
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard let dir = AppDelegate.downloadsDirOverride
                ?? FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first else {
            logLine("#5167: no Downloads folder, so a download was not saved")
            downloadsTold.add(download)
            tellDownloadFailed("This computer has no Downloads folder Kosmos can find, so the file was not saved.")
            completionHandler(nil)
            return
        }
        // Nothing to save: the board answers a refused download navigation with 204 (server.js refuseDownload),
        // and the page says why. Saving it would leave an empty file under the real name.
        if let http = response as? HTTPURLResponse, http.statusCode == 204 || http.statusCode == 205 {
            logLine("#5167: a download answered \(http.statusCode) (nothing to save), so nothing was saved")
            downloadsTold.add(download)
            completionHandler(nil)
            return
        }
        // An error page is not the file: a 404 or 500 saved under the file's name would look like success.
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            logLine("#5167: a download answered \(http.statusCode), so nothing was saved")
            downloadsTold.add(download)
            // The Files lists' page says any answer that is not OK itself (pageSaysDownloadRefusal), so it is not said twice.
            if pageSaysDownloadRefusal(http.url ?? download.originalRequest?.url) {
                completionHandler(nil)
                return
            }
            tellDownloadFailed("The file is not available (the answer was \(http.statusCode)), so nothing was saved.")
            completionHandler(nil)
            return
        }
        // A web page where a file was expected: an expired Kosmos+ sign-in answers a download with its
        // sign-in page (200, text/html), which must not be saved under the file's name.
        let namedPage = ["html", "htm"].contains((suggestedFilename as NSString).pathExtension.lowercased())
        let disposition = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        let sentAsAttachment = String(disposition[..<(disposition.firstIndex(of: ";") ?? disposition.endIndex)])
            .trimmingCharacters(in: .whitespaces).lowercased() == "attachment"   // the same reading as the response policy
        // A web page sent as an attachment is the file (the board's attachments are); otherwise only a .html
        // off Kosmos+. Over Kosmos+ a signed-out computer answers with its sign-in page, never an attachment.
        let wantsPage = sentAsAttachment || (namedPage && !(committedPageURL.map(isKosmosPlusURL) ?? false))
        if response.mimeType?.lowercased() == "text/html", !wantsPage {
            logLine("#5167: a download answered with a web page, not a file, so nothing was saved")
            downloadsTold.add(download)
            // The Files lists' page says a signed-out answer itself (its look gets the sign-in's own sentence).
            if pageSaysDownloadRefusal(response.url ?? download.originalRequest?.url) {
                completionHandler(nil)
                return
            }
            tellDownloadFailed(committedPageURL.map(isKosmosPlusURL) == true
                ? "The answer was a web page, not the file, so nothing was saved. You may need to sign in to Kosmos+ again."
                : "The answer was a web page, not the file, so nothing was saved.")
            completionHandler(nil)
            return
        }
        let taken = Set(downloadsInFlight.values.map { $0.standardizedFileURL.path.lowercased() })   // Downloads is case-insensitive
        let dest = downloadDestination(dir: dir, suggested: suggestedFilename) {
            // The entry itself, not what it points to: a dangling symlink is taken, never written through.
            (try? FileManager.default.attributesOfItem(atPath: $0.path)) != nil || taken.contains($0.standardizedFileURL.path.lowercased())
        }
        downloadsInFlight[ObjectIdentifier(download)] = dest
        logLine("#5167: saving a download to Downloads as \(dest.lastPathComponent)")
        completionHandler(dest)
    }

    /// #5167: a finished download bounces the Dock's Downloads stack, as Safari's do, so the person
    /// sees where it went. 📌 PINNED selector: an optional method with a wrong signature is never called.
    @objc(downloadDidFinish:)
    func downloadDidFinish(_ download: WKDownload) {
        downloadsTold.remove(download)
        guard let dest = downloadsInFlight.removeValue(forKey: ObjectIdentifier(download)) else { return }
        logLine("#5167: download saved: \(dest.lastPathComponent)")
        /* Marked as downloaded, as Safari marks its own, so Gatekeeper checks it when it is opened: the
           file came from another computer or an agent, and may be an app or a script. */
        var values = URLResourceValues()
        // No addresses: a page's address carries the board token (?token=, #kst=).
        values.quarantineProperties = [kLSQuarantineAgentNameKey as String: "Kosmos",
                                       kLSQuarantineTypeKey as String: kLSQuarantineTypeWebDownload as String]
        var marked = dest
        do { try marked.setResourceValues(values) } catch {
            // Kept, as Safari keeps a download it cannot mark (a Downloads folder on a disk without the mark).
            logLine("#5167: could not mark \(dest.lastPathComponent) as downloaded: \(error.localizedDescription)")
            // WebKit marks what it downloads too; the person is told only if the file carries no mark at all.
            if getxattr(dest.path, "com.apple.quarantine", nil, 0, 0, 0) <= 0 {
                // Always on its own: it is the one warning about a file that WAS saved, so it cannot go into a
                // summary of files that were not.
                tellDownloadFailed("\(dest.lastPathComponent) was saved to Downloads, but could not be marked as downloaded, so macOS will not check it when it is opened. Open it only if you expected it.",
                                   title: "Kosmos saved that file without its download mark", always: true)
            }
        }
        if AppDelegate.downloadsDirOverride == nil {   // the selftest does not bounce the build box's Dock
            DistributedNotificationCenter.default().post(name: Notification.Name("com.apple.DownloadFileFinished"),
                                                         object: dest.path)
        }
    }

    @objc(download:didFailWithError:resumeData:)
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let dest = downloadsInFlight.removeValue(forKey: ObjectIdentifier(download))
        logLine("#5167: a download failed (\(dest?.lastPathComponent ?? "no destination yet")): \(error.localizedDescription)")
        // Said once per download: a refusal this app already told arrives here as a cancel too. A cancel
        // it did not start (WebKit refusing a download on its own) is said as a quiet refusal; any other
        // failure always.
        let alreadySaid = downloadsTold.contains(download)
        downloadsTold.remove(download)
        if !alreadySaid {
            if dest == nil && (error as NSError).domain == NSURLErrorDomain && (error as NSError).code == NSURLErrorCancelled {
                // WebKit stopped it before it had anywhere to go (measured for a redirect to another origin, where
                // the window may then show the file: #5169). Quiet, so one click cannot put up two sheets.
                tellDownloadFailed("It stopped before it began.", quiet: true)
            } else {
                tellDownloadFailed("The file could not be saved to Downloads (\(error.localizedDescription)).")
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

    // #664's dialog. The wording tracked the bash launcher's (install/setup.sh) verbatim until
    // #3114 gave it an actionable "Download Kosmos" button and trimmed the now-redundant "open
    // installkosmos.com and click Download" sentence, so it no longer matches the launcher text
    // 1:1. Still never sends anyone to a terminal; the button points at the .pkg download for
    // their own copy.
    private func showForeignAccountAlert() {
        let alert = NSAlert()
        alert.messageText = "Kosmos is installed on this computer for another user"
        alert.informativeText = "It was set up by a different account on this computer, and it runs for that account. To use Kosmos here, install your own copy. Yours will be separate, with your own agents and settings."
        alert.alertStyle = .critical
        // #3114 recovery: this alert used to carry only an "OK" button, so the one thing the
        // user could do was dismiss it -- onto a blank window (resolveInstall correctly refused
        // to open a foreign account's install, and the caller `return`s straight after this, so
        // nothing else fills the window). That dead-end is Josh's blocker. Give a real path:
        //   Download Kosmos (default) -> open installkosmos.com so the user lands on their own
        //     download, THEN quit -- the foreign-account app cannot run here, so leaving it up is
        //     exactly the blank window we are removing.
        //   Quit -> just close it.
        // Either button quits, so the foreign-account app never sits on a blank window. (Baron's
        // pkg-script fix prevents the mis-install at the root; this rescues a mis-install that
        // ALREADY happened -- Josh's current state and any user who hit it before that ships.)
        let downloadButton = alert.addButton(withTitle: "Download Kosmos")   // the default button
        alert.addButton(withTitle: "Quit")
        // Compare the clicked response against Download's ACTUAL index in alert.buttons, never a
        // hardcoded 0 -- so reordering the addButton calls moves the check WITH the button. This
        // is the genuinely swap-safe form of showQuitDialog's discipline (compare a semantic
        // index, not the literal .alertFirstButtonReturn): a future reorder cannot silently send
        // the Download action to the wrong button.
        let clickedIndex = alert.runModal().rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
        let downloadIndex = alert.buttons.firstIndex(of: downloadButton) ?? 0
        // Set isActuallyQuitting BEFORE terminate (the dedup discipline this file uses at its
        // Cmd-Q / #2124 sites): NSApp.terminate re-enters applicationShouldTerminate, which with
        // this flag false shows the "Your agents keep running" quit dialog -- nonsensical here
        // (resolveInstall refused before any agent started), and a Cancel/Escape there returns
        // .terminateCancel, leaving the exact blank-window dead end this alert exists to remove.
        // Nothing is running to confirm, so quit cleanly.
        isActuallyQuitting = true
        if clickedIndex == downloadIndex, let url = URL(string: "https://installkosmos.com") {
            // Download: open the page ASYNC and quit in the completion handler -- exactly as the
            // #2094 relaunch path does (NSWorkspace.openApplication there) -- so the app does not
            // exit before LaunchServices has launched the browser. A bare open(url) + immediate
            // terminate could kill this process mid-handoff and the download page would never
            // appear, defeating the one thing this button exists to do. The handler fires on
            // success OR failure, so the app always quits; on failure it leaves a log trace (there
            // is no window left to show an error, and quitting still beats the old blank dead-end).
            NSWorkspace.shared.open(url, configuration: NSWorkspace.OpenConfiguration()) { app, err in
                DispatchQueue.main.async {
                    if app == nil || err != nil {
                        logLine("showForeignAccountAlert: could not open \(url.absoluteString): \(err?.localizedDescription ?? "no browser launched") -- quitting anyway")
                    }
                    NSApp.terminate(nil)
                }
            }
        } else {
            // Quit, or the URL could not be built: nothing to open, quit now.
            NSApp.terminate(nil)
        }
    }

    // MARK: The webView, and the file picker (kosmos#1032)

    /// Both delegates in one place, so a webView can never be built with the
    /// navigation one wired and the UI one forgotten. That is not a
    /// hypothetical tidiness: it is exactly the bug this constructor was
    /// extracted to close.
    static func makeWebView(frame: NSRect, delegate: AppDelegate) -> WKWebView {
        let config = WKWebViewConfiguration()
        // #3996: the page hands the app its waiting count each time it polls the board.
        config.userContentController.add(BadgeMessageProxy(delegate), name: "kosmosBadge")
        // #4356: the first screen's choice (web/index.html frChoose).
        config.userContentController.add(ModeMessageProxy(delegate), name: "kosmosMode")
        // #4409: the mic button's bridge. Its presence is how the page knows it may draw the button.
        let voice = VoiceBridge(delegate)
        config.userContentController.add(voice, name: "kosmosVoice")
        let web = WKWebView(frame: frame, configuration: config)
        voice.webView = web
        delegate.voice = voice
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
    /// #4412: the answer for the panel that is up, held HERE so WebKit's handler is never released
    /// un-called. Josh's 0.7.06 window aborted because NSOpenPanel.begin dropped its completion
    /// (never called it): with the handler reachable only through that completion, it was released
    /// at return and WebKit's checker aborted the app.
    /// Written and never read, on purpose: defensive. Today the local `respond` is also held by the watch
    /// closure (and by the stack frame through begin), so this duplicates that hold; it keeps the handler
    /// reachable if a later edit moves or drops the watch.
    private var openPanelHeld: (([URL]?) -> Void)?
    /// #4412: stands in for "is the picker on screen" when openPanelPresenter is set (the selftest).
    static var openPanelPresenterShowing: (() -> Bool)?
    /// #4412: how long a picker has to appear before it counts as never shown, then how often an
    /// open picker is looked at. A picker seen gone on two looks in a row without answering is answered
    /// with nil (two, so a panel that hides a moment before AppKit delivers its answer keeps the pick).
    /// A real panel shows within about 0.03 s of begin (measured); one slower than the first look would be
    /// answered nil under the person, the accepted cost of never leaving WebKit's handler unanswered.
    static let openPanelFirstLook: TimeInterval = 5
    static let openPanelLookEvery: TimeInterval = 0.5
    /// #4412: how many pickers the watch has answered nil itself. Only the selftest reads it: a picker still in
    /// use must never be counted here.
    static var openPanelWatchAnswers = 0
    /// #4412: after this many looks at a picker that stays up, the watch logs once, so a picker that never goes
    /// away (and keeps every later press refused) leaves a trace. It does not answer: the person may still be
    /// choosing a file. 1200 looks is 10 minutes.
    static let openPanelLongLooks = 1200
    /// #4412: whether a real NSOpenPanel still counts as up. A panel on screen is left alone. While
    /// Kosmos is not the active app the answer is deferred, whatever the panel reports: NSOpenPanel does
    /// not hide on deactivate (measured: hidesOnDeactivate=false, isVisible stays true), so this is not
    /// about a hidden panel. It keeps a picker Josh left up while he switched to the browser from being
    /// answered under him; a dropped one is answered within openPanelLookEvery of his coming back, and
    /// nothing can be pressed while he is away. Its own function so the selftest pins the rule.
    static func openPanelStillUp(visible: Bool, appActive: Bool) -> Bool { visible || !appActive }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        /* 🛑 A RE-ENTRANT REQUEST IS ANSWERED IMMEDIATELY, NOT IGNORED.
           This delegate serves ONE open panel at a time: while a panel is
           outstanding (openPanelOutstanding, set below), a second runOpenPanel is
           refused with a single nil answer rather than opening a second picker.
           The nil answer is mandatory -- WebKit aborts the app if a runOpenPanel
           completion is not called exactly once (the rule two comments down) --
           and refusing costs the person nothing: the first panel is still up and
           still theirs. (Historically this also sidestepped a measured macOS-26
           bug where a second beginSheetModal on a window that already had a sheet
           was silently dropped; the panel path no longer uses beginSheetModal, so
           that specific mechanism no longer applies, but serialising open panels
           is the right invariant and this nil answer is required either way.) */
        /* ⚠️ SAID, NOT SILENT. This branch introduces the one state in the class
           (`openPanelOutstanding`) that could strand: if a future path ever
           presents without going through one of the two closures that clear it,
           every later + press is refused forever with no diagnostic -- #1032
           reproduced by the code that fixes it. Nothing exercises this branch,
           so a line in the log is the only thing that would ever name it.
           Main-thread only, like every other flag on this delegate: WebKit
           calls this method on the main thread and the panel's begin completion
           (and the presenter stub's) are main-thread, so the flag needs no
           synchronisation. */
        if openPanelOutstanding {
            logLine("runOpenPanelWith: refused, a panel is already up")
            // The OTHER panel still owns openPanelOutstanding; do NOT clear it
            // here. This is a single, direct answer for the refused request.
            completionHandler(nil)
            return
        }
        openPanelOutstanding = true
        /* 🛑 #2807: WebKit's CompletionHandlerCallChecker ABORTS THE WHOLE APP if
           this handler is called zero times OR more than once. The cancel path
           is answered below, but the pre-fix `beginSheetModal` could be SILENTLY
           DROPPED (now fixed below by presenting with the app-modal `panel.begin`),
           which left the handler released un-called -- exactly what crashed Josh's
           0.6.56 the moment he changed a profile picture. Wrap the handler so it
           is called EXACTLY ONCE on
           every path of THIS invocation: a repeat call is a no-op, and every
           branch routes through `respond`. It clears the flag THIS call set (not
           the refused-request path above, which never set it). Main-thread only,
           like the flag, so `answered` needs no synchronisation. */
        var answered = false
        let respond: ([URL]?) -> Void = { [weak self] urls in
            if answered { return }
            answered = true
            self?.openPanelOutstanding = false
            self?.openPanelHeld = nil
            completionHandler(urls)
        }
        openPanelHeld = respond
        /* #4412: if the picker never appears, or goes away without answering, answer nil ourselves.
           A picker the person is still using is left alone. `giveUp` closes a real panel the watch has
           answered for, so the screen matches what WebKit was told and no second picker opens beside it. */
        var looks = 0
        var giveUp: (() -> Void)?
        func watch(after: TimeInterval, goneBefore: Bool = false, _ showing: @escaping () -> Bool) {
            DispatchQueue.main.asyncAfter(deadline: .now() + after) {
                if answered { return }
                looks += 1
                if looks == AppDelegate.openPanelLongLooks {
                    logLine("runOpenPanelWith: the file picker has been up 10 minutes and has not answered (#4412)")
                }
                if showing() { watch(after: AppDelegate.openPanelLookEvery, showing); return }
                /* Gone once: look again before answering, in case its own answer is on the way. */
                if !goneBefore { watch(after: AppDelegate.openPanelLookEvery, goneBefore: true, showing); return }
                logLine("runOpenPanelWith: the file picker is not showing and never answered; answering nil (#4412)")
                AppDelegate.openPanelWatchAnswers += 1
                respond(nil)
                giveUp?()
            }
        }
        if let present = AppDelegate.openPanelPresenter {
            present(parameters) { urls in respond(urls) }
            watch(after: AppDelegate.openPanelFirstLook, AppDelegate.openPanelPresenterShowing ?? { false })
            return
        }
        let panel = NSOpenPanel()
        // The page decides these, not us: a composer that accepts several
        // files says so on its own input, and honouring the flag is what makes
        // `multiple` mean anything.
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = !parameters.allowsDirectories
        /* 🛑 #2807 + CANCEL MUST ANSWER. WebKit's CompletionHandlerCallChecker
           ABORTS THE WHOLE APP if this handler is not called EXACTLY once
           (measured: building this delegate with the cancel arm dropped raises
           NSInternalInconsistencyException, "Completion handler ... was not
           called", and the app TERMINATES mid-conversation). There are two ways
           to reach zero calls: not answering Cancel (the answer closure below
           answers both OK and Cancel), and #2807 -- beginSheetModal(for:) is
           SILENTLY DROPPED when the host window already has a sheet (or is
           otherwise unable to host one). A dropped sheet never presents, `answer`
           never fires, and at method return the panel + answer + completionHandler
           release un-called, so the checker aborts synchronously inside
           runOpenPanel. That is the crash Josh hit on 0.6.56 changing a profile
           picture.

           So present with the app-modal `panel.begin`, NOT beginSheetModal:
           begin does not attach to a window, so no window state can drop it.
           It was expected to always call its completion too, and #4412 showed
           it does not: Josh's 0.7.06 window aborted when begin dropped it. So
           begin alone no longer closes the abort class; the answer held past
           begin plus the watch above do, for any presenter. The cost is
           the picker is app-modal (centred) rather than a sheet on the window;
           for a path that otherwise aborts the app that is the right trade.
           `answer` routes through the call-once `respond`, so OK and Cancel each
           answer exactly once. */
        let answer: (NSApplication.ModalResponse) -> Void = { resp in
            respond(resp == .OK ? panel.urls : nil)
        }
        panel.begin(completionHandler: answer)
        giveUp = { panel.cancel(nil) }   // its own answer then arrives at a respond that has already answered
        /* See openPanelStillUp: on screen, or Kosmos in the background, counts as still up. */
        watch(after: AppDelegate.openPanelFirstLook) {
            AppDelegate.openPanelStillUp(visible: panel.isVisible, appActive: NSApp.isActive)
        }
    }

    /* 🛑 #3309: BOARD alert()/confirm()/prompt() WERE SILENTLY DROPPED IN THE APP.
       A WKWebView does not draw JavaScript dialogs itself: it ASKS the host through
       WKUIDelegate's runJavaScript{Alert,Confirm,TextInput}Panel. With those three
       unimplemented, WebKit's default is to DISMISS the request with no UI --
       alert() shows nothing, confirm() returns FALSE, prompt() returns nil -- so
       any board "are you sure?" confirm() quietly did NOTHING in the Mac app while
       the Windows native window showed it (destructive-action confirmations
       especially). The uiDelegate is already wired above and already answers file
       panels; these three add the JS panels. Found cross-machine by the Windows
       box building the Mac/Windows parity checklist (Homer, 2026-09-19).

       ⚠️ EACH COMPLETION MUST BE CALLED EXACTLY ONCE, or WebKit's
       CompletionHandlerCallChecker aborts the whole app -- the same rule
       runOpenPanel documents above. Present with the synchronous app-modal
       NSAlert.runModal(), which ALWAYS returns and so ALWAYS answers, NOT
       beginSheetModal: #2807 showed a sheet can be SILENTLY DROPPED on a window
       that already has one, leaving the handler released un-called and aborting the
       app. runModal is called on the main thread (WebKit calls these there). The
       call-once `respond` wrapper is belt-and-braces for the presenter-stub path.

       A presenter stub (nil in every shipped run, like openPanelPresenter) lets the
       build gate drive these headless without a real modal.

       No `outstanding` serialization flag (unlike runOpenPanel): runModal is a
       synchronous nested app-modal loop, so overlapping dialogs from two frames
       stack as nested modal sessions (AppKit supports this and each still answers
       its own completion exactly once) rather than dropping one -- so there is no
       dropped-request-is-a-crash hazard here to guard against. */
    static var jsAlertPresenter: ((String, @escaping () -> Void) -> Void)?
    static var jsConfirmPresenter: ((String, @escaping (Bool) -> Void) -> Void)?
    static var jsPromptPresenter: ((String, String?, @escaping (String?) -> Void) -> Void)?

    /* The OK/Cancel -> value mapping, pulled out as PURE functions so the button
       logic is testable WITHOUT presenting a modal. The real NSAlert.runModal()
       cannot be driven on a headless build box (it blocks the main thread and needs
       a window server), so a stub-only self-test would leave this mapping - the one
       place a logic inversion (Cancel answering true, or OK/Cancel swapped) would
       ship silently - uncovered. The --kosmos-app-jspanels-selftest arm asserts
       both responses against these, so the mapping is gated even though the modal
       itself is not. `.alertFirstButtonReturn` is the FIRST-added button (OK). */
    static func jsConfirmValue(_ resp: NSApplication.ModalResponse) -> Bool {
        resp == .alertFirstButtonReturn
    }
    static func jsPromptValue(_ resp: NSApplication.ModalResponse, fieldText: String) -> String? {
        resp == .alertFirstButtonReturn ? fieldText : nil   // Cancel -> nil (JS prompt() convention)
    }

    /* Build the confirm/prompt NSAlert. Extracted so the self-test can assert the
       button ORDER the mapping above depends on: jsConfirmValue/jsPromptValue read
       `.alertFirstButtonReturn` as OK, which is only correct if OK is the FIRST
       button added. If a future edit swapped these addButton lines, confirm/prompt
       would SILENTLY invert (Cancel answering true / the typed text) -- worse than
       "does nothing" -- and the stub-driven arms would still pass. So the self-test
       checks buttons[0].title == "OK" on the alert THIS builder produces, closing
       the order-vs-mapping link that source order alone would leave uncovered. */
    static func makeConfirmAlert(_ message: String) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")       // FIRST -> .alertFirstButtonReturn
        alert.addButton(withTitle: "Cancel")
        return alert
    }
    static func makePromptAlert(_ prompt: String, _ defaultText: String?) -> (NSAlert, NSTextField) {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")        // FIRST -> .alertFirstButtonReturn
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field   // focus so the person can type at once
        return (alert, field)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        var answered = false
        let respond: () -> Void = { if answered { return }; answered = true; completionHandler() }
        if let present = AppDelegate.jsAlertPresenter { present(message) { respond() }; return }
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
        respond()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        var answered = false
        let respond: (Bool) -> Void = { ok in if answered { return }; answered = true; completionHandler(ok) }
        if let present = AppDelegate.jsConfirmPresenter { present(message) { respond($0) }; return }
        respond(AppDelegate.jsConfirmValue(AppDelegate.makeConfirmAlert(message).runModal()))
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        var answered = false
        let respond: (String?) -> Void = { s in if answered { return }; answered = true; completionHandler(s) }
        if let present = AppDelegate.jsPromptPresenter { present(prompt, defaultText) { respond($0) }; return }
        let (alert, field) = AppDelegate.makePromptAlert(prompt, defaultText)
        // Split so the read of field.stringValue AFTER dismissal is visibly ordered, not
        // resting on Swift's left-to-right argument evaluation: we want the text the person
        // left in the field, which only exists once runModal() has returned.
        let resp = alert.runModal()
        respond(AppDelegate.jsPromptValue(resp, fieldText: field.stringValue))
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
        // #4356: on a connect computer, a new window to Kosmos Plus or one of the person's computers
        // opens in this window, as a same-window link would (connectLinkDecision); others go on to
        // the browser as before. A new window is a click or a page's own window.open, so "clicked".
        if computerMode == .connect && connectLinkDecision(for: url, clicked: true) == .inApp {
            logLine("#4356: new window to Kosmos+ opened in the app window: \(url.absoluteString)")
            webView.load(URLRequest(url: url))
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
    /* #4347: this prompt is now the fallback: shown when the page cannot say whether a restart would lose
       anything, or when something has held the restart for relaunchAskAfter (with its own wording, and no
       Return key, when something unfinished would be lost). Restart is the default: Josh read the old grey "Quit and Open Again" beside a
       blue "Not Now" as the notice recommending the wrong thing, and a restart that reopens Kosmos is not
       the destructive quit the old Return rule guarded against. */
    static let relaunchButtons: (titles: [String], returnIndex: Int, restartIndex: Int) =
        (["Restart Kosmos", "Not Now"], 0, 0)

    /// The key equivalent for each button, DERIVED from the spec.
    ///
    /// 🛑 THIS FUNCTION EXISTS BECAUSE THE GATE WITHOUT IT COULD NOT FAIL. An
    /// earlier version assigned the key equivalents to hardcoded locals and had
    /// the selftest compare the spec's two indices -- a property of
    /// the tuple literal, not of the alert anyone sees. Measured by mutation:
    /// swapping the two hardcoded assignments makes a reflexive Return QUIT THE
    /// APP, and the gate printed "Return lands on Not Now" and passed. So did
    /// inverting the spec, and so did swapping the two titles. The only mutant
    /// it caught was a degenerate one nobody would write.
    /// ⭐ A check that reads one thing and vouches for another is worse than no
    /// check: it is a reassuring sentence over the defect it names.
    static func relaunchKeyEquivalents(_ spec: (titles: [String], returnIndex: Int, restartIndex: Int),
                                       wordsWaiting: Bool = false) -> [String] {
        /* #4347: when the page says words are waiting, the dialog came because someone typed, so a Return
           meant for a message box must not restart and lose them: no button answers to Return then. */
        spec.titles.indices.map { $0 == spec.returnIndex ? (wordsWaiting ? "" : "\r") : "\u{1b}" }
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

       ⭐ ENTER STAYS ON THE DESTRUCTIVE BUTTON HERE. This dialog only appears
       because the person just pressed Cmd-Q, so Return confirming what they asked
       for is the expected thing, and moving it would silently break the deliberate
       quit that works today.
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
    /* #1182. The version this app was running when it last relaunched itself onto a newer
       version. Survives the relaunch it describes, which is the
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

    /* #3996 (Josh, 2026-09-26: "a total number of waiting notifications on the kosmos app icon in
       the dock, like Messages app shows"): the red number on the Dock icon. The board works the
       number out (engine/status.js waitingTotal: needs-you + unread DMs + unread project messages,
       the page's own three counters) and serves it as counts.waiting on /api/status; this only
       shows it.
       TWO SOURCES, ONE NUMBER. While the page is polling the board (every 5 s) it hands the app its
       counts.waiting (pageSaidWaiting), so the app asks nothing extra of the board's heaviest
       route. When the page has not said anything for 8 s (the window closed, the page hidden or
       reloading), the app's own 10 s timer asks /api/status itself, the stale check's request
       (token header, no cache), so the badge keeps up with the window closed.
       ⚠️ macOS may slow a windowless app's timers (App Nap): with the window closed the badge can
       lag the ten seconds. The tolerance lets macOS batch it rather than skip it. Not measured on a
       served build yet. */
    private func startDockBadge(port: Int) {
        badgeTimer?.invalidate()
        refreshDockBadge(port: port)
        let t = Timer(timeInterval: 10, repeats: true) { [weak self] _ in
            self?.refreshDockBadge(port: port)
        }
        t.tolerance = 2
        RunLoop.main.add(t, forMode: .common)   // keeps counting while a dialog or a menu is open
        badgeTimer = t
    }

    private func refreshDockBadge(port: Int) {
        // 8 s: above the page's 5 s poll, below this timer's 10 s, so a page that went quiet costs one tick at most.
        if let at = lastPageBadgeAt, ProcessInfo.processInfo.systemUptime - at < 8 { return }   // the page is saying it
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/status") else { return }
        var req = URLRequest(url: url)
        if let tok = boardTokenValue() {
            req.setValue(tok, forHTTPHeaderField: "x-kosmos-board-token")
        }
        req.timeoutInterval = 8
        req.cachePolicy = .reloadIgnoringLocalCacheData
        badgeAsked += 1
        let asked = badgeAsked
        URLSession.shared.dataTask(with: req) { [weak self] data, response, _ in
            let code = (response as? HTTPURLResponse)?.statusCode
            /* Answered means a 200 whose body READ as the board's status (round 6): a 200 cut off
               mid-body is a miss like any other, so it cannot skip the three-miss rule. A status
               that read but has no count (an older board) is an answer, and clears the badge. */
            let answered = code == 200 && Self.readsAsStatus(data)
            let label = answered ? Self.badgeLabel(fromStatusJSON: data) : nil
            DispatchQueue.main.async {
                guard let self else { return }
                /* Said once when the read starts failing and once when it recovers, so "the badge never
                   shows" can be told apart from "nothing is waiting" in the app's log. No answer at all
                   is not logged before the first answer (at a cold launch the board is still starting);
                   an answer that is a REFUSAL (a wrong token: 403) is logged at once, with its code. */
                if !answered && !self.badgeReadFailing && (self.badgeEverAnswered || code != nil) {
                    logLine("dock badge: /api/status " + (code.map { "answered \($0)" } ?? "did not answer") + "; the badge clears if it keeps failing")
                }
                if answered && self.badgeReadFailing { logLine("dock badge: the board answers again") }
                if answered { self.badgeEverAnswered = true; self.badgeMisses = 0 } else { self.badgeMisses += 1 }
                self.badgeReadFailing = !answered && (self.badgeEverAnswered || code != nil)
                /* One slow answer on a busy board is not a board that is gone: the badge clears only after
                   three misses in a row (about 30 s), and until then the number stands. A board that is
                   really down still clears it, so a stale count never outlives it for long. */
                if answered || self.badgeMisses >= 3 { self.showBadge(label, asked: asked) }
            }
        }.resume()
    }

    /// Whether a page origin is this app's board (127.0.0.1 on the resolved port), for BadgeMessageProxy.
    // The scheme only resolves WebKit's port 0; it is not part of the trust check (the board is plain http).
    func isBoardOrigin(host: String, port: Int, scheme: String? = nil) -> Bool {
        guard let mine = badgeOrigin else { return false }
        // WebKit reports a URL's default port as 0; read it as the scheme's own (KOSMOS_URL without a port).
        let seen = port == 0 ? Self.defaultPort(scheme) : port
        return host == mine.host && seen == mine.port
    }
    static func defaultPort(_ scheme: String?) -> Int { scheme == "https" ? 443 : 80 }

    /// The page's own count (#3996), handed over by BadgeMessageProxy after every board poll.
    func pageSaidWaiting(_ body: Any) {
        // #4356: the board's page can still post while Connect is stopping it; a connect computer has
        // no waiting count to show.
        guard computerMode != .connect else { return }
        lastPageBadgeAt = ProcessInfo.processInfo.systemUptime
        /* A post is a board read that worked (the page posts only from a poll that succeeded), so the
           app's miss count starts again (round 7): misses from before a stretch the page fed do not
           add up to a later "three in a row". */
        badgeMisses = 0
        if badgeReadFailing { badgeReadFailing = false; logLine("dock badge: the board answers again (through the page)") }
        badgeAsked += 1
        showBadge(Self.badgeLabel(fromCount: body), asked: badgeAsked)
    }

    /// Main thread. `asked` orders the answers: one asked earlier never replaces one asked later.
    private func showBadge(_ label: String?, asked: Int) {
        Self.badgesAllowed { allowed in
            DispatchQueue.main.async {
                guard self.computerMode != .connect else { NSApp.dockTile.badgeLabel = nil; return }
                guard asked >= self.badgeShown else { return }
                self.badgeShown = asked
                let next = allowed ? label : nil
                if NSApp.dockTile.badgeLabel != next { NSApp.dockTile.badgeLabel = next }
            }
        }
    }

    /* 🔑 PURE, so --kosmos-app-badge-selftest can drive it (the callers are a URLSession callback
       and a script message no selftest reaches). A whole number above zero is the label; over 999 it
       reads "999+" so the badge stays a badge. Zero, a missing, unreadable or non-number count
       clears it: nil. */
    /// Whether a body is the board's status at all (a JSON object carrying `counts`).
    static func readsAsStatus(_ data: Data?) -> Bool {
        guard let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return obj["counts"] is [String: Any]
    }
    static func badgeLabel(fromStatusJSON data: Data?) -> String? {
        guard let data,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let counts = obj["counts"] as? [String: Any] else { return nil }
        return badgeLabel(fromCount: counts["waiting"])
    }
    static func badgeLabel(fromCount value: Any?) -> String? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }   // true is an NSNumber too
        let d = n.doubleValue
        guard d.isFinite, d >= 1, d == d.rounded() else { return nil }
        return d > 999 ? "999+" : String(Int(d))
    }

    /* A forward check, not a switch the person can reach today: macOS lists an app under
       Notifications (with its Badges switch) only once it has asked for notification permission,
       and Kosmos does not ask (a system dialog nobody asked for). So this reads .notSupported and
       the badge shows; if Kosmos ever asks, turning badges off there will hide it. The in-app off
       switch is Settings > Computer > App icon (#4025): off, the board serves counts.waiting as null
       and the badge clears. UNUserNotificationCenter needs a real bundle, so a bare binary
       (a selftest, the prototype build) skips the question. */
    /* Asked at most every five minutes (the setting almost never changes, and a badge update runs
       every few seconds): the last answer is kept and handed on in between. */
    private static var badgeSettingAnswer: (allowed: Bool, at: TimeInterval)?
    static func badgesAllowed(_ done: @escaping (Bool) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))   // badgeSettingAnswer is read and written only here
        guard Bundle.main.bundleIdentifier != nil else { done(true); return }
        if let last = badgeSettingAnswer, ProcessInfo.processInfo.systemUptime - last.at < 300 { done(last.allowed); return }
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let allowed = settings.badgeSetting != .disabled
            DispatchQueue.main.async { badgeSettingAnswer = (allowed, ProcessInfo.processInfo.systemUptime) }
            done(allowed)
        }
    }

    /// Ask the board what version it is, once, after the page has loaded.
    private func checkWhetherThisAppIsBehind(port: Int) {
        guard !staleAppNoticeShown else { return }
        // #4356: a connect computer runs no board of its own, so there is nothing here to be behind;
        // a board answering on this port is another install's, and its "restart to update, your
        // agents keep running" would be about agents this computer does not have (review round 18).
        // Belt and braces: switchToConnect clears resolvedPort, which is what keeps this from being
        // called on a connect computer today; this makes a future caller safe too (review round 24).
        guard computerMode != .connect else {
            sayQuietStaleReason("this computer connects to agents on another computer, so there is no board of its own to compare")
            return
        }
        guard let mine = runningAppVersion() else {
            sayQuietStaleReason("this app carries no CFBundleShortVersionString, so there is nothing to compare")
            return
        }
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/status") else {
            sayQuietStaleReason("could not build the status URL for port \(port)")
            return
        }
        var req = URLRequest(url: url)
        // #1946: /api/status is gated on an enforcing board. URLSession.shared uses
        // its own cookie store (not the WKWebView's, which holds the bootstrap
        // cookie), so this probe must carry the token itself or it 403s on every
        // prod board and the stale-app notice can never fire. The header, not a
        // cookie, is the reliable channel across the two stores.
        if let tok = boardTokenValue() {
            req.setValue(tok, forHTTPHeaderField: "x-kosmos-board-token")
        }
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

    /* #2094: which app to relaunch. The pure core, kept apart from the filesystem
       read so the selftest can drive it without real bundles on disk. Given
       (candidate url, its version-or-nil) pairs and the board's version `theirs`,
       return the FIRST candidate that carries `theirs` or a newer version (#4347) -- the
       fresh installed copy -- or nil when none does. First-match order is deliberate: the caller lists the
       canonical /Applications copy first. An unreadable candidate (version nil) is
       skipped, never chosen. */
    static func pickFresh(_ candidates: [(url: URL, version: String?)], theirs: String) -> URL? {
        /* An exact match anywhere beats a newer copy (#4347): on a shared Mac, another account's newer
           /Applications copy must not win over this account's own bundle that carries exactly `theirs`. */
        if let exact = candidates.first(where: { $0.version == theirs }) { return exact.url }
        for c in candidates {
            guard let v = c.version else { continue }
            if isBehind(theirs, v) == true { return c.url }
        }
        return nil
    }

    /* #2094 / #4347: the installed Kosmos.app that carries the board's version or newer, read
       from each candidate's Info.plist on disk. Reopening the path this process came from while
       it still held the old version is what made a person relaunch more than once. nil: no
       candidate has caught up yet. */
    static func onDiskVersion(_ app: URL) -> String? {
        let plist = app.appendingPathComponent("Contents/Info.plist")
        return NSDictionary(contentsOf: plist)?["CFBundleShortVersionString"] as? String
    }

    static func freshAppURL(theirs: String) -> URL? {
        let candidates = [
            URL(fileURLWithPath: "/Applications/Kosmos.app"),
            URL(fileURLWithPath: NSHomeDirectory() + "/Applications/Kosmos.app"),
            /* #4347: this window's own path last. Read from disk below, so an update that rewrote the
               bundle this process came from is seen as the new version it now holds. */
            Bundle.main.bundleURL,
        ]
        let pairs: [(url: URL, version: String?)] = candidates.map { url in
            guard FileManager.default.fileExists(atPath: url.path) else { return (url, nil) }
            /* #4347: the version ON DISK, never Bundle(url:), which hands back a CACHED Bundle for a
               path this process was launched from and so reports the old version after an update
               rewrote it. Reading the plist file is what lets the relaunch wait for the bundle. */
            return (url, onDiskVersion(url))
        }
        return pickFresh(pairs, theirs: theirs)
    }

    /* #4347: what the window does next after it learns the board is newer. PURE, for the stale selftest.
       Josh: the notice showed on every update, recommended the grey button, and took one or two
       relaunches to stick, because a relaunch could reopen the app before the update had rewritten it. */
    enum RelaunchStep: Equatable {
        /// No app on disk carries the board's version yet, or the page says a restart would lose something.
        case wait
        /// A fresh app is on disk and the page says nothing would be lost: restart with no question.
        case relaunchNow
        /// A fresh app is on disk but the page could not answer (an older page): ask the person.
        case askPerson
        /// The app on disk never caught up: reopening cannot help, say so once.
        case giveUp
    }
    /// What the page said when asked whether a restart would lose anything.
    enum PageSays: Equatable {
        case safe
        /// Something is being sent, typed or attached.
        case wouldLose
        /// The page answered but cannot tell (an older page, or the check itself failed).
        case cannotTell
        /// No answer at all (the page is mid-load or its process is gone): ask again shortly.
        case noReply
        /// Nothing would be lost, but not now: What's New is deciding or open, or the person just did
        /// something. Wait, and never ask the person about it.
        case hold
    }
    /// What the window asks the page. A page still loading has not defined the function yet, so it
    /// answers "loading" (ask again), not "unknown" (ask the person). The name is pinned against the page's
    /// own assignment by native-app.stale-silences.test.js.
    static let relaunchPageQuestion = "(function(){ if (document.readyState !== 'complete') return 'loading';"
        + " if (typeof window.kosmosSafeToRestart !== 'function') return 'unknown';"
        + " var v = window.kosmosSafeToRestart(); return v === true ? true : v === false ? false : v === 'hold' ? 'hold' : 'unknown'; })()"
    static let relaunchWaitLimit: TimeInterval = 180
    /// With another app in front: how long the whole Mac must have had no input before a silent restart.
    static let relaunchQuietSeconds: TimeInterval = 30
    static func systemIdleSeconds() -> TimeInterval {
        CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
    }
    /// How often to look for the new app on disk, then to re-ask the page once it is there.
    static let relaunchPollForApp: TimeInterval = 3
    static let relaunchPollForPage: TimeInterval = 15
    /// After the person was told the app did not update: keep looking for it, less often.
    static let relaunchPollAfterGiveUp: TimeInterval = 30
    /// How long to wait for the page to answer before asking it again.
    static let relaunchPageReplyLimit: TimeInterval = 20
    /// With the new app ready, how long words left in a box hold the restart before the person is asked.
    static let relaunchAskAfter: TimeInterval = 600
    static func relaunchStep(freshFound: Bool, waited: TimeInterval, freshFor: TimeInterval,
                             page: PageSays, toldGaveUp: Bool = false, askedBefore: Bool = false,
                             seenFresh: Bool = false) -> RelaunchStep {
        /* Give up only if the new app was never seen: one that was seen and is briefly unreadable (mid-swap) is
           waited for. Once the person has been told, keep looking quietly: a late app still wins. */
        guard freshFound else {
            return (waited >= relaunchWaitLimit && !toldGaveUp && !seenFresh) ? .giveUp : .wait
        }
        switch page {
        case .safe: return .relaunchNow
        case .hold: return .wait
        // The person is asked at most once: after a Not Now, only the silent restart remains.
        case .cannotTell: return askedBefore ? .wait : .askPerson
        case .wouldLose, .noReply: return (!askedBefore && freshFor >= relaunchAskAfter) ? .askPerson : .wait
        }
    }

    private func offerRelaunch(mine: String, theirs: String) {
        // #4356: a status answer that lands after a switch to Connect offers nothing: the dialogs below
        // are about this computer's board and agents, which it no longer runs (review round 25).
        if computerMode == .connect { logLine("stale-app: an answer landed after Connect; nothing offered"); return }
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
        let told = relaunchGaveUpAt == "\(mine)|\(theirs)"
        if told { logLine("relaunch: already told the person about \(mine) -> \(theirs); looking for the new app quietly") }
        stepRelaunch(mine: mine, theirs: theirs, since: ProcessInfo.processInfo.systemUptime, freshSince: nil, toldGaveUp: told, askedBefore: told)
    }

    private var loggedRelaunchPageError = false
    private static let relaunchGaveUpKey = "kosmos.relaunchGaveUpAt"
    /// #4347: the "mine|theirs" pair for which the wait for a new app timed out and the person was told once.
    private var relaunchGaveUpAt: String? {
        get { UserDefaults.standard.string(forKey: Self.relaunchGaveUpKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.relaunchGaveUpKey) }
    }

    /// #4347: a dialog, sheet or file picker of the app's own is open.
    private var ownDialogOpen: Bool { NSApp.modalWindow != nil || window?.attachedSheet != nil || openPanelOutstanding }
    /// #4347: silent restarts that failed to open the new window this launch; after the limit the person is told.
    private var silentRelaunchFailures = 0
    static let silentRelaunchFailureLimit = 3

    /// #4347: one step of the wait-then-restart. Re-arms itself until it relaunches, asks, or gives up.
    /// `since` and `freshSince` are systemUptime, which stops while the Mac sleeps, as the poll timers do: a Mac
    /// that slept through an update does not wake up "past the limit" before the install could finish.
    private func stepRelaunch(mine: String, theirs: String, since: TimeInterval, freshSince: TimeInterval?, toldGaveUp: Bool,
                              askedBefore: Bool = false) {
        // #4356: a loop begun on the board's page, before a switch to Connect, stops here: the page is
        // now Kosmos Plus's, it cannot say whether a restart is safe, and "your agents keep running"
        // is not true of a computer that runs none (review round 19).
        guard computerMode != .connect else { logLine("stale-app: stopped, this computer switched to connect"); return }
        /* A dialog, sheet or file picker of the app's own is open: do nothing now and look again later,
           without deciding anything, so no second dialog lands on top of it and no restart closes it. */
        if ownDialogOpen {
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.relaunchPollForPage) { [weak self] in
                self?.stepRelaunch(mine: mine, theirs: theirs, since: since, freshSince: freshSince,
                                   toldGaveUp: toldGaveUp, askedBefore: askedBefore)
            }
            return
        }
        let target = Self.freshAppURL(theirs: theirs)
        let now = ProcessInfo.processInfo.systemUptime
        let waited = now - since
        let freshAt = freshSince ?? (target == nil ? nil : now)
        let freshFor = freshAt.map { now - $0 } ?? 0
        var decided = false
        let decide = { [weak self] (page: PageSays) in
            guard !decided, let self else { return }
            decided = true
            var step = Self.relaunchStep(freshFound: target != nil, waited: waited, freshFor: freshFor, page: page,
                                         toldGaveUp: toldGaveUp, askedBefore: askedBefore, seenFresh: freshAt != nil)
            // A dialog may have opened while the page was answering: never act under it.
            if (step == .relaunchNow || step == .askPerson) && self.ownDialogOpen { step = .wait }
            /* The page only sees activity inside Kosmos. With another app in front, a restart would pull the new
               window in front of what the person is typing there, so it also waits for the whole Mac to be idle. */
            if step == .relaunchNow && !NSApp.isActive && Self.systemIdleSeconds() < Self.relaunchQuietSeconds { step = .wait }
            switch step {
            case .wait:
                let again = target != nil ? Self.relaunchPollForPage
                    : (toldGaveUp ? Self.relaunchPollAfterGiveUp : Self.relaunchPollForApp)
                DispatchQueue.main.asyncAfter(deadline: .now() + again) { [weak self] in
                    self?.stepRelaunch(mine: mine, theirs: theirs, since: since, freshSince: freshAt, toldGaveUp: toldGaveUp,
                                       askedBefore: askedBefore)
                }
            case .relaunchNow:
                self.relaunch(mine: mine, theirs: theirs, target: target!, waited: waited, asked: false,
                              askedBefore: askedBefore)
            case .askPerson:
                let restarted = self.askToRestart(mine: mine, theirs: theirs, target: target!, waited: waited,
                                                  wordsWaiting: page != .cannotTell)
                if !restarted {
                    // Not Now: no more questions; the silent restart still happens once the page says safe.
                    DispatchQueue.main.asyncAfter(deadline: .now() + Self.relaunchPollForPage) { [weak self] in
                        self?.stepRelaunch(mine: mine, theirs: theirs, since: since, freshSince: ProcessInfo.processInfo.systemUptime, toldGaveUp: toldGaveUp,
                                           askedBefore: true)
                    }
                }
            case .giveUp:
                logLine("relaunch: \(ISO8601DateFormatter().string(from: Date())) no app on disk reached \(theirs) "
                        + "after \(Int(waited))s; not reopening")
                self.relaunchGaveUpAt = "\(mine)|\(theirs)"
                self.showCannotSelfHeal(mine: mine, theirs: theirs, reopened: false)
                // After this notice, only the silent restart remains: never a second question.
                DispatchQueue.main.asyncAfter(deadline: .now() + Self.relaunchPollAfterGiveUp) { [weak self] in
                    self?.stepRelaunch(mine: mine, theirs: theirs, since: since, freshSince: nil, toldGaveUp: true,
                                       askedBefore: true)
                }
            }
        }
        guard target != nil else { decide(.noReply); return }
        guard let web = webView else { decide(.cannotTell); return }
        let ask = Self.relaunchPageQuestion
        /* A completion WebKit never calls (a crashed page process) would otherwise stop the wait for
           good; this re-asks instead. `decided` makes whichever comes first the only one acted on. */
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.relaunchPageReplyLimit) { decide(.noReply) }
        web.evaluateJavaScript(ask) { [weak self] result, error in
            let page: PageSays
            if let error {
                page = .noReply
                // Once per window, not per poll: a page that keeps failing would bury the diagnostic file.
                if let self, !self.loggedRelaunchPageError {
                    self.loggedRelaunchPageError = true
                    logLine("relaunch: the page did not answer whether a restart is safe: \(error.localizedDescription); asking again")
                }
            }
            else if let b = result as? Bool { page = b ? .safe : .wouldLose }
            else if (result as? String) == "unknown" { page = .cannotTell }
            else if (result as? String) == "loading" { page = .noReply }
            else if (result as? String) == "hold" { page = .hold }
            else { page = .noReply }
            decide(page)
        }
    }

    /// #4347: when the page cannot say whether a restart is safe, or words have waited in a box for
    /// relaunchAskAfter. Restart is the default (Josh: the recommended action is the blue one).
    @discardableResult
    private func askToRestart(mine: String, theirs: String, target: URL, waited: TimeInterval, wordsWaiting: Bool) -> Bool {
        window?.makeKeyAndOrderFront(nil)
        let alert = NSAlert()
        alert.messageText = "Restart Kosmos to finish updating"
        alert.informativeText = wordsWaiting
            ? "Your agents keep running. Anything unfinished in this window, such as words not sent yet, will be lost, so finish it first if you need it."
            : "Your agents keep running."
        alert.alertStyle = .informational
        let spec = AppDelegate.relaunchButtons
        let keys = AppDelegate.relaunchKeyEquivalents(spec, wordsWaiting: wordsWaiting)
        for (i, title) in spec.titles.enumerated() {
            alert.addButton(withTitle: title).keyEquivalent = keys[i]
        }
        let clicked = alert.runModal().rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
        guard clicked == spec.restartIndex else { return false }
        relaunch(mine: mine, theirs: theirs, target: target, waited: waited, asked: true, askedBefore: true)
        return true
    }

    private func relaunch(mine: String, theirs: String, target: URL, waited: TimeInterval, asked: Bool,
                          askedBefore: Bool) {
        logLine("relaunch: \(ISO8601DateFormatter().string(from: Date())) \(mine) -> \(theirs), "
                + "target \(target.path), waited \(Int(waited))s, \(asked ? "person pressed Restart" : "no question asked")")

        /* 🛑 #1182: WRITTEN BEFORE THE RELAUNCH, NOT AFTER IT. There is no after:
           this process calls NSApp.terminate a few lines down, so anything
           recorded "once the replacement is up" is recorded by nobody. If the
           relaunch fails instead, the value is still correct -- we DID try at
           this version. The failure path below clears it again for a silent restart (nothing reopened);
           after a restart the person asked for, it stays, and the next launch says so honestly. */
        relaunchedAtVersion = mine

        /* 🛑 NEVER QUIT UNTIL THE REPLACEMENT IS ACTUALLY COMING. Terminating
           first and hoping is how a person ends up with no Kosmos at all, which
           is far worse than the stale menu bar this fixes. The new instance is
           launched FIRST, and this one only exits once macOS confirms it. */
        let conf = NSWorkspace.OpenConfiguration()
        /* 🛑 ALWAYS force a new instance -- do NOT try to dedup by activating an
           existing one. The fresh copy and this stale process share a
           CFBundleIdentifier, and LaunchServices keys "already running" on the
           BUNDLE ID, not the path: opening the fresh path with
           createsNewApplicationInstance=false would ACTIVATE this same stale
           instance instead of launching the fresh copy, the completion handler
           would read that as "replacement started" and terminate -- quitting to
           NOTHING. The pile-up Josh saw came from relaunching the SAME stale
           bundle over and over; targeting the FRESH copy (the target stepRelaunch found) already fixes that,
           and the old instance still exits below once the new one is confirmed, so
           this settles to a fresh window (two momentarily if a fresh one was already
           open, and the stale one then exits -- never zero) without the dedup that
           could leave him with none. */
        conf.createsNewApplicationInstance = true
        /* #2124: hand the fresh copy the relaunch handoff so its single-instance guard
           does NOT mistake this deliberate relaunch for a duplicate and defer back to
           this (exiting) instance -- which would quit to nothing. Two channels, either
           suffices: the launch ENVIRONMENT (handed directly to the new process, no disk),
           preserving the current environment and adding the one key; and a token FILE
           written just below as a fallback. A normal user launch carries neither. */
        conf.environment = ProcessInfo.processInfo.environment
            .merging([kRelaunchHandoffEnvKey: String(Date().timeIntervalSince1970)]) { _, new in new }
        writeRelaunchHandoffToken()
        NSWorkspace.shared.openApplication(at: target, configuration: conf) { app, err in
            DispatchQueue.main.async {
                if app != nil, err == nil {
                    logLine("relaunch: replacement started, this instance is exiting")
                    /* 🛑 THE PERSON HAS ALREADY ANSWERED. `NSApp.terminate` re-enters
                       `applicationShouldTerminate`, which shows the quit dialog unless
                       this flag is set -- so without it the relaunch would hand the
                       person a SECOND, unrelated modal asking whether to close the app, with the replacement's window already on
                       screen behind it. Two windows, one of them modal, over a
                       question they did not ask. The file names this seam at the
                       Cmd-Q site; this call site is the one that did not. */
                    self.isActuallyQuitting = true
                    NSApp.terminate(nil)
                    return
                }
                logLine("relaunch FAILED: \(err?.localizedDescription ?? "no app handle"); staying open")
                /* #2124: the fresh copy never launched, so nothing will consume the
                   handoff token, and THIS instance stays open (below). A lingering token
                   would let a manual reopen within its TTL skip the single-instance guard
                   and run as a DUPLICATE alongside this window -- the exact bug #2124
                   fixes. Remove it now, before the blocking modal. The env channel needs
                   no cleanup: it was set only on this failed launch's configuration and
                   never reaches a manual reopen (a new process gets a fresh environment). */
                if let handoffURL = relaunchHandoffURL() {
                    try? FileManager.default.removeItem(at: handoffURL)
                }
                /* #4347: nobody asked for a silent restart, so a failure is tried again quietly. Nothing reopened,
                   so the #1182 marker is cleared; after silentRelaunchFailureLimit the person is told, below. */
                if !asked {
                    self.relaunchedAtVersion = nil
                    self.silentRelaunchFailures += 1
                    if self.silentRelaunchFailures < Self.silentRelaunchFailureLimit {
                        DispatchQueue.main.asyncAfter(deadline: .now() + Self.relaunchPollForPage) {
                            // A failure nobody saw is not a question anybody was asked: carry the real value.
                            self.stepRelaunch(mine: mine, theirs: theirs, since: ProcessInfo.processInfo.systemUptime, freshSince: ProcessInfo.processInfo.systemUptime,
                                              toldGaveUp: false, askedBefore: askedBefore)
                        }
                        return
                    }
                }
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

       Reached two ways: a relaunch came back at the SAME version (#1182), or no app on disk reached
       the board's version within relaunchWaitLimit (#4347, reopened: false).

       1. IT PROMISES NOTHING. There is no instruction we have measured. Saying "reinstall and it will be fixed"
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
    private func showCannotSelfHeal(mine: String, theirs: String, reopened: Bool = true) {
        window?.makeKeyAndOrderFront(nil)
        let alert = NSAlert()
        /* #2101: Josh read the old wording ("This window cannot update itself ...
           Installing Kosmos again is what replaces this window") as hostile -- a
           dead-end. Same facts, calmer framing: it drops the "cannot update / already
           tried / we will stop asking" tone and names ONE reliable action.
           🔑 THE ACTION IS DOWNLOAD, NOT "open from Applications". Reaching here means
           no fresh copy is reachable (freshAppURL nil, or the /Applications copy is itself stale),
           so telling the person to open Applications is telling them to repeat the
           thing that just failed. Downloading the current build always works, which
           is what the design rules above mean by PROMISES NOTHING / NAMES NO CAUSE.
           The window still stops re-asking (relaunchedAtVersion cleared below). */
        alert.messageText = "This window is on an older version of Kosmos"
        alert.informativeText = "It is running version \(mine), and Kosmos is on \(theirs). "
            + (reopened ? "Reopening this window did not move it to the newer version. "
                        : "The Kosmos app on this computer was not updated with it. ")
            + "Your agents kept "
            + "running the whole time, and nothing needs signing in to again. To get the current "
            + "version, download the latest Kosmos from installkosmos.com and open it."
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
        voice?.hostCancel("page process ended")   // #4409 (review 3): no page is left to show the mic is on
        committedPageURL = nil   // #5167: no page is on screen to save downloads from
    }

    /// #4409 (review 3): a new page (a reload, a navigation) starts with every mic drawn off, so the old page's
    /// listening must end with it. Main-frame commits only reach this delegate method.
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        voice?.hostCancel("new page loaded")
        committedPageURL = webView.backForwardList.currentItem?.url   // #5167: the origin a download must share (moves only at a commit)
        pageCommits += 1   // #5167: an Allow asked before this commit does not count for the new page
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
        // #4356: a connect computer whose sign-in did not load would otherwise sit on a blank window.
        // A load our own policy sent to the browser ends as WebKit's "interrupted by policy change"
        // (WebKitErrorDomain 102); that is not Kosmos Plus failing to answer.
        let policyCancel = (error as NSError).domain == "WebKitErrorDomain" && (error as NSError).code == 102
        if computerMode == .connect && !policyCancel && (isBoardLoadNav || webView.backForwardList.currentItem == nil) {
            showStartupFailureAlert(detail: "Kosmos could not reach Kosmos+ (\(kosmosPlusSignIn.host!)). Check this computer's internet connection, then press Cmd-R (View > Reload) to try again.", title: "Kosmos+ did not answer")
            return
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
        refusedDownloadHosts = []   // #5167: the person's Reload asks again about a computer they refused
        // #4356: a connect computer has no board to start, so Reload reloads the page it is on, or
        // goes back to sign-in when there is none or the last load failed.
        if computerMode == .connect {
            if webView.backForwardList.currentItem == nil || lastLoadFailed { loadConnect() } else { webView.reload() }
            return
        }
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
        voice?.hostCancel("window hidden")   // #4409: a hidden window never leaves the mic on
        window.orderOut(nil)
        return false
    }

    // #4409: minimised is out of sight too.
    func windowDidMiniaturize(_ notification: Notification) {
        voice?.hostCancel("window minimised")
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
        // #4356: "Your agents keep running" is false on a computer that runs none.
        if computerMode == .connect {
            logLine("applicationShouldTerminate: connect computer, no agents here, terminateNow")
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
        /* #4356: a computer that connects to agents elsewhere switches back here, not in Settings,
           whose page is the other computer's. Hidden unless this computer connects
           (AppDelegate.updateRunAgentsItem); the selftest lists hidden items too. */
        let runAgentsItem = NSMenuItem(title: "Run agents on this computer",
                                       action: #selector(AppDelegate.runAgentsHere(_:)),
                                       keyEquivalent: "")
        runAgentsItem.target = settingsTarget
        runAgentsItem.isHidden = true
        appMenu.addItem(runAgentsItem)
        /* #4382: on a connect computer with updates off, the offer of a newer version ("Update Kosmos
           to X", showUpdateOffer sets the title). Hidden otherwise; a board shows its own offer. */
        let updateItem = NSMenuItem(title: "Update Kosmos",
                                    action: #selector(AppDelegate.updateKosmosNow(_:)),
                                    keyEquivalent: "")
        updateItem.target = settingsTarget
        updateItem.isHidden = true
        appMenu.addItem(updateItem)
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
        updateRunAgentsItem()
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
        // #4356: hidden on a connect computer (updateRunAgentsItem), and refused here too, in case its
        // Cmd-, still fires: the page's Settings there are the OTHER computer's.
        guard computerMode != .connect else { NSSound.beep(); return }
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
           · `burgerClose()` -- on the narrow layout the burger nav otherwise
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

// #2124: the single-instance DEFER decision, every arm, no window server. A build-time
// gate diffs this against the expected table so BOTH arms are pinned: the duplicate-launch
// arm (dedup fires) AND the #2094 relaunch-handoff arm (dedup EXCLUDED, so the fresh copy
// is not deduped to nothing).
if CommandLine.arguments.contains("--kosmos-app-instance-selftest") {
    for handoff in [false, true] {
        for otherRunning in [false, true] {
            print("handoff=\(handoff) otherRunning=\(otherRunning) -> defer=\(shouldDeferToExistingInstance(handoff: handoff, otherRunning: otherRunning))")
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

if CommandLine.arguments.contains("--kosmos-app-download-selftest") {
    /* #5167: MEASURES the download path in a real WKWebView driven by this app's own delegate, which the
       mode selftest's pure rows and the source-reading test cannot: that WebKit actually calls the pinned
       selectors, that a same-origin `<a download>` and a same-origin attachment land as files, that a
       redirect to another origin and a link to another origin save nothing, and that a saved file carries
       the quarantine mark. The page is served over HTTP on 127.0.0.1 (an ephemeral port); "another
       origin" is `localhost` on the same port. Files go to a temporary folder (downloadsDirOverride), never
       the real Downloads. Offscreen, and driven from JavaScript, like the filepanel selftest. It runs as a
       computer that runs agents (computerMode stays unset, which the policy treats as run); a connect computer is
       not driven live here. */
    setvbuf(stdout, nil, _IONBF, 0)
    /* Above the worst case of a run where NOTHING saves (every expected-file wait runs out, then the 10s settle;
       measured 146s, 2026-10-03), so a product that saves nothing is judged, not timed out. A passing run: ~55s. */
    let dl = FileManager.default.temporaryDirectory.appendingPathComponent("kosmos-download-selftest-\(getpid())")
    DispatchQueue.main.asyncAfter(deadline: .now() + 300) {
        try? FileManager.default.removeItem(at: dl)
        print("download selftest TIMED OUT"); exit(1)
    }
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    try? FileManager.default.createDirectory(at: dl, withIntermediateDirectories: true)
    AppDelegate.downloadsDirOverride = dl
    var told: [String] = []
    AppDelegate.downloadAlertPresenter = { told.append($0) }
    var port: UInt16 = 0
    func reply(_ path: String) -> String {
        let body = "kosmos " + path
        func ok(_ extra: String) -> String {
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: \(body.utf8.count)\r\n" + extra + "Connection: close\r\n\r\n" + body
        }
        switch path {
        case "/":
            let page = "<!doctype html><meta charset=utf-8>"
                + "<a id=same href=/same.txt download>a</a>"
                + "<a id=att href=/att>b</a>"
                + "<a id=redir href=/redir download>c</a>"
                + "<a id=redir2 href=/redir2 download>g</a>"
                + "<a id=missing href=/missing download=missing.txt>h</a>"
                + "<a id=zip href=/pack.zip>i</a>"
                + "<a id=attstar href=/attstar>j</a>"
                + "<a id=foreignzip href=http://localhost:\(port)/pack2.zip>k</a>"
                + "<button id=frames onclick=\"document.body.insertAdjacentHTML('beforeend', '<iframe src=/attframe></iframe><iframe src=http://localhost:\(port)/attframe2></iframe>')\">l</button>"
                + "<a id=foreign href=http://localhost:\(port)/foreign.txt download>d</a>"
                + "<a id=foreignatt href=http://localhost:\(port)/att2>e</a>"
                + "<a id=last href=/last.txt download>f</a>"
                + "<a id=askno href=/asked-no.txt download>m</a>"
                + "<a id=empty href=/empty>o</a>"
                + "<a id=gone href=/gone download=gone.pptx>r</a>"
                + "<a id=signin href=/signin download=report.pptx>p</a>"
                + "<a id=askyes href=/asked-yes.txt download>n</a>"
                + "<script>window.__probeReady = 1;</script>"
            return "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: \(page.utf8.count)\r\nConnection: close\r\n\r\n" + page
        case "/att": return ok("Content-Disposition: attachment; filename=\"att.txt\"\r\n")
        case "/attframe": return ok("Content-Disposition: attachment; filename=\"attframe.txt\"\r\n")
        case "/attframe2": return ok("Content-Disposition: attachment; filename=\"attframe2.txt\"\r\n")
        case "/pack2.zip":
            let z = "PK not really a zip"
            return "HTTP/1.1 200 OK\r\nContent-Type: application/zip\r\nContent-Length: \(z.utf8.count)\r\nConnection: close\r\n\r\n" + z
        case "/attstar": return ok("Content-Disposition: attachment; filename*=UTF-8''%E6%96%87.txt\r\n")   // the board's own shape (server.js)
        case "/elsewhere":
            let page = "<!doctype html><meta charset=utf-8><a id=nb href=/nb.txt download>x</a><script>window.__probeReady = 1;</script>"
            return "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: \(page.utf8.count)\r\nConnection: close\r\n\r\n" + page
        case "/att2": return ok("Content-Disposition: attachment; filename=\"att2.txt\"\r\n")
        case "/pack.zip":
            let z = "PK not really a zip"
            return "HTTP/1.1 200 OK\r\nContent-Type: application/zip\r\nContent-Length: \(z.utf8.count)\r\nConnection: close\r\n\r\n" + z
        case "/signin":
            let page = "<!doctype html><title>Sign in</title>"
            return "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: \(page.utf8.count)\r\nConnection: close\r\n\r\n" + page
        case "/gone": return "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        case "/empty": return "HTTP/1.1 204 No Content\r\nContent-Disposition: attachment; filename=\"empty.txt\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        case "/missing2": return "HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/plain\r\nContent-Length: 4\r\nConnection: close\r\n\r\nboom"
        case "/missing": return "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 9\r\nConnection: close\r\n\r\nnot found"
        case "/redir2": return "HTTP/1.1 302 Found\r\nLocation: /ok2.txt\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        case "/redir": return "HTTP/1.1 302 Found\r\nLocation: http://localhost:\(port)/redirected.txt\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        default: return ok("")
        }
    }
    let params = NWParameters.tcp
    params.requiredInterfaceType = .loopback   // nothing off this computer can reach it during a build
    params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    guard let listener = try? NWListener(using: params, on: .any) else {
        try? FileManager.default.removeItem(at: dl)
        print("download selftest: no listener"); exit(1)
    }
    listener.newConnectionHandler = { conn in
        conn.start(queue: .main)
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, _ in
            let head = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let target = head.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
            let path = String(target.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first ?? "/")
            conn.send(content: reply(path).data(using: .utf8), completion: .contentProcessed { _ in conn.cancel() })
        }
    }
    let d = AppDelegate()
    let frame = NSRect(x: 0, y: 0, width: 600, height: 300)
    let web = AppDelegate.makeWebView(frame: frame, delegate: d)
    d.webView = web   // as the app sets it: a navigation that becomes a download ends its provisional load
    let win = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: frame.width, height: frame.height),
                       styleMask: [.titled], backing: .buffered, defer: false)
    win.contentView = web
    win.orderFrontRegardless()
    func load(then: @escaping () -> Void) {
        // The old page's ready mark is cleared first, so the poll waits for the NEW page, never the old one.
        web.evaluateJavaScript("window.__probeReady = 0") { _, _ in
            web.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/")!))
        }
        func poll(_ tries: Int) {
            web.evaluateJavaScript("window.__probeReady === 1 && location.host === '127.0.0.1:\(port)'") { r, _ in
                if (r as? Bool) == true { then(); return }
                guard tries > 0 else {
                    try? FileManager.default.removeItem(at: dl)
                    print("download selftest PAGE NEVER LOADED: the probe page (this can be the app's own response policy)"); exit(1)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { poll(tries - 1) }
            }
        }
        poll(150)
    }
    var leftBoard: [String] = []
    var notBoardStayed = false
    var liveAsked: [String] = []
    /* Before the rows are read, the messages are waited for (up to 20s), so a busy build box cannot fail a good
       product on a message that came late. Two come from the arms (the 404 and the web page); a run that says fewer
       is judged as it stands. */
    func settled(_ go: @escaping () -> Void, tries: Int = 200) {
        if told.count >= 2 || tries == 0 { go(); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { settled(go, tries: tries - 1) }
    }
    /* The per-computer question through a real click: the probe page is treated as a Kosmos+ computer that
       must be asked. Don't Allow saves nothing (and holds); then, asked fresh, Allow saves. */
    func askArm(then: @escaping () -> Void) {
        AppDelegate.askAboutHostForSelftest = "127.0.0.1"
        var reply = false
        AppDelegate.downloadPermissionPresenter = { host, answer in liveAsked.append(host); answer(reply) }
        click("askno") {
            d.allowedDownloadHosts = []
            reply = true
            d.resetDownloadAsks()
            click("askyes", expect: "asked-yes.txt") {
                AppDelegate.askAboutHostForSelftest = nil
                AppDelegate.downloadPermissionPresenter = nil
                d.allowedDownloadHosts = []
                d.resetDownloadAsks()
                then()
            }
        }
    }
    /* A page that is not the board (localhost on the same port: not the host the board was loaded as)
       asking for a download from its own origin: refused, said, and the page stays. */
    func notBoard(then: @escaping () -> Void) {
        web.load(URLRequest(url: URL(string: "http://localhost:\(port)/elsewhere")!))
        func poll(_ tries: Int) {
            web.evaluateJavaScript("window.__probeReady === 1 && location.host === 'localhost:\(port)'") { r, _ in
                if (r as? Bool) == true {
                    web.evaluateJavaScript("document.getElementById('nb').click()") { _, _ in }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                        notBoardStayed = web.url?.path == "/elsewhere"
                        then()
                    }
                    return
                }
                guard tries > 0 else {
                    try? FileManager.default.removeItem(at: dl)
                    print("download selftest PAGE NEVER LOADED: the non-board page (this can be the app's own response policy)"); exit(1)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { poll(tries - 1) }
            }
        }
        poll(150)
    }
    func saved(_ name: String) -> Bool { FileManager.default.fileExists(atPath: dl.appendingPathComponent(name).path) }
    /* A click that should save a file waits for that file (up to 5s), so a busy build box cannot fail a
       good product on a fixed sleep. One that should save nothing waits 2s, and a same-origin download
       clicked LAST is waited for before the folder is read, so a late file from an earlier click is
       already there to be counted. */
    func click(_ id: String, expect: String? = nil, then: @escaping () -> Void) {
        load {
            web.evaluateJavaScript("document.getElementById('\(id)').click()") { _, _ in }
            func wait(_ tries: Int) {
                if let e = expect, saved(e) || tries == 0 { then(); return }
                if expect == nil && tries == 0 {
                    if web.url?.host != "127.0.0.1" { leftBoard.append(id) }
                    then(); return
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { wait(tries - 1) }
            }
            wait(expect == nil ? 20 : 50)
        }
    }
    listener.stateUpdateHandler = { state in
        guard case .ready = state, port == 0, let p = listener.port?.rawValue else { return }
        port = p
        d.badgeOrigin = ("127.0.0.1", Int(p))   // as loadBoard sets it: this page is the board
        click("same", expect: "same.txt") { click("att", expect: "att.txt") { click("redir2", expect: "ok2.txt") { click("missing") { click("empty") { click("gone") { click("signin") { click("zip", expect: "pack.zip") { click("attstar", expect: "\u{6587}.txt") { click("foreignzip") { click("frames") { notBoard { click("redir") { click("foreign") { click("foreignatt") { click("last", expect: "last.txt") { askArm { settled {
            var bad = 0, ran = 0
            func row(_ ok: Bool, _ why: String) { ran += 1; if !ok { bad += 1 }; print((ok ? "PASS  " : "FAIL  ") + why) }
            // The per-computer question (a Kosmos+ name's holder runs its tunnel), driven directly: no Kosmos+
            // computer can be served here. Its answers are held in memory only.
            var asked: [String] = []
            var reply = false
            AppDelegate.downloadPermissionPresenter = { host, answer in asked.append(host); answer(reply) }
            var got: [Bool] = []
            d.committedPageURL = URL(string: "http://127.0.0.1:\(port)/")
            d.mayDownload { got.append($0) }
            row(asked.isEmpty && got == [true], "this computer's own board is never asked about")
            d.committedPageURL = URL(string: "https://amy.kosmosplus.com/")
            d.mayDownload { got.append($0) }
            d.mayDownload { got.append($0) }
            row(asked == ["amy.kosmosplus.com"] && got == [true, false, false],
                "A KOSMOS+ COMPUTER IS ASKED ABOUT ONCE, and Don't Allow holds without asking again (asked \(asked), got \(got))")
            reply = true
            d.committedPageURL = URL(string: "https://josh.kosmosplus.com/#kst=x")
            d.mayDownload { got.append($0) }
            d.mayDownload { got.append($0) }
            row(asked.count == 2 && got.suffix(2) == [true, true] && d.allowedDownloadHosts == ["josh.kosmosplus.com"],
                "Allow holds for that computer only, for this run, and is not asked again (\(d.allowedDownloadHosts))")
            row(liveAsked == ["127.0.0.1", "127.0.0.1"] && !saved("asked-no.txt") && saved("asked-yes.txt"),
                "THROUGH A REAL CLICK: a computer that must be asked saves nothing on Don't Allow, and saves on Allow (asked \(liveAsked))")
            row(saved("same.txt"), "a same-origin <a download> is saved")
            row(saved("att.txt"), "a same-origin attachment response is saved, under its own name")
            row(saved("ok2.txt"), "a same-origin redirect is followed and saved")
            row(!saved("missing.txt") && !saved("empty.txt") && !saved("report.pptx") && !saved("gone.pptx"),
                "AN ERROR PAGE (404) IS NOT SAVED under the file's name, nor an empty 204 (a link or a download: the board's refusal), nor a sign-in page answered for a .pptx")
            row(saved("pack.zip"), "a board file the window cannot show (a plain link to a .zip) is saved, not dropped")
            row(!saved("redirected.txt"), "A REDIRECT TO ANOTHER ORIGIN SAVES NOTHING")
            row(!saved("foreign.txt"), "a download link to another origin saves nothing (WebKit treats it as a plain link)")
            row(!saved("att2.txt"), "AN ATTACHMENT FROM ANOTHER ORIGIN SAVES NOTHING")
            // WebKit marks every download itself, so the row reads THIS app's mark: its agent name.
            var qbuf = [UInt8](repeating: 0, count: 512)
            let qn = getxattr(dl.appendingPathComponent("same.txt").path, "com.apple.quarantine", &qbuf, qbuf.count, 0, 0)
            let qmark = qn > 0 ? String(decoding: qbuf[0..<qn], as: UTF8.self) : ""
            row(qmark.contains(";Kosmos;"), "a saved file carries THIS APP's quarantine mark (\(qmark))")
            let all = (try? FileManager.default.contentsOfDirectory(atPath: dl.path)) ?? []
            row(saved("\u{6587}.txt"), "the board's own attachment header (filename*=UTF-8'') is saved under its decoded name")
            row(!saved("pack2.zip") && !leftBoard.contains("foreignzip"), "A FILE FROM ANOTHER ORIGIN THE WINDOW CANNOT SHOW IS NOT SAVED, and the board stays")
            row(!saved("attframe.txt") && !saved("attframe2.txt"), "A FRAME LOADING AN ATTACHMENT SAVES NOTHING, from the board's origin or another")
            row(!saved("nb.txt") && notBoardStayed, "A PAGE THAT IS NOT THE BOARD CANNOT SAVE ITS OWN FILE, and stays in the window")
            row(all.sorted() == ["asked-yes.txt", "att.txt", "last.txt", "ok2.txt", "pack.zip", "same.txt", "\u{6587}.txt"], "nothing else was saved (saw: \(all.sorted().joined(separator: ", ")))")
            row(told.count == 2 && told.contains { $0.contains("answer was 404") } && told.contains { $0.contains("a web page, not the file") },
                "EVERY REAL FAILURE IS SAID, ONE ALERT EACH (the 404, a web page answered for a file), and nothing else is (told \(told.count): \(told.joined(separator: " | ")))")
            row(!told.contains { $0.contains("not a board") } && !told.contains { $0.contains("were not allowed") }
                && !told.contains { $0.contains("stopped before it began") } && !told.contains { $0.contains("not opened or saved") }
                && !told.contains { $0.contains("somewhere Kosmos does not save from") },
                "A POLICY REFUSAL IS LOGGED, NEVER AN ALERT (not a board, a computer not allowed, WebKit stopping it, a foreign file): a page repeating one cannot pile alerts up")
            row(told.allSatisfy { $0.hasPrefix("Kosmos could not save that file: ") }, "and each alert carries the failure title (a 204 says nothing)")
            // Only the attachment: WebKit ignores `download` on a link to another origin, so "foreign" is a
            // plain link, and a computer that runs agents loads every link in the window (#5169).
            row(leftBoard.contains("foreign"), "CONTROL: localhost answers here (a plain foreign link loads), so the other-origin rows are not vacuous")
            row(!leftBoard.contains("foreignatt"),
                "A REFUSED ATTACHMENT DOES NOT LOAD IN THE WINDOW instead (other arms that left the board, all #5169: \(leftBoard.joined(separator: ", ")))")
            try? FileManager.default.removeItem(at: dl)
            let expected = 23
            if ran != expected { print("\ndownload-check: only \(ran) of \(expected) rows ran, so this proved nothing"); exit(1) }
            print(bad == 0 ? "\ndownload-check: all good (\(ran) rows)" : "\ndownload-check: \(bad) row(s) wrong")
            exit(bad == 0 ? 0 : 1)
        } } } } } } } } } } } } } } } } } }
    }
    listener.start(queue: .main)
    withExtendedLifetime((d, listener, win)) { app.run() }
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
    /* #2807: make this hatch's stdout UNBUFFERED. The build gate captures this
       output through a pipe ($(...)), where Swift block-buffers stdout, so if an
       arm regresses and the app aborts (SIGABRT), the buffer is never flushed and
       every already-"printed" arm is LOST -- the gate then reads empty output and
       misattributes the failure to itself ("the product is NOT implicated")
       instead of to the #2807 regression. Unbuffered, each arm reaches the pipe
       the instant it prints, so it survives an abort and the gate attributes the
       failure correctly. */
    setvbuf(stdout, nil, _IONBF, 0)
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
       Budget: 150 x 0.1s = 15s, inside the hatch's own 65s watchdog and the
       shell's 80s alarm. The page loads in well under half a second here, so
       this is ~30x the observed margin rather than the ~12x it was. The run's
       length is not restated here (it goes stale with every arm): the watchdog
       has to cover the arms plus this 15s, and tools.filepanel-gate.test.js
       pins the alarm at least 15s above the watchdog. */
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
                            guard again else { exit(1) }
                            /* #2807: the file input fires while the host window
                               ALREADY HAS A SHEET. With the pre-fix delegate,
                               beginSheetModal(for:) on a window that already has
                               a sheet is SILENTLY DROPPED, the completion handler
                               is released un-called, and WebKit's
                               CompletionHandlerCallChecker aborts the app
                               synchronously inside runOpenPanel -- the exact
                               #2807 crash (Josh, changing a profile picture).
                               Reproduce it on the REAL panel path: put a sheet on
                               the window, fire the input, and require the app to
                               STILL BE ALIVE (reaching the print below AT ALL
                               proves no abort) AND a panel to have presented via
                               the app-modal `begin` fallback. This arm reds the
                               cut if the #2807 fix is ever dropped. */
                            AppDelegate.openPanelPresenter = nil
                            let blocker = NSOpenPanel()
                            blocker.beginSheetModal(for: win) { _ in }
                            current = "sheeted"
                            /* Setup control: the sheet MUST actually be attached
                               before we fire, or the arm would pass trivially
                               without exercising #2807. POLL for it rather than
                               assuming a fixed delay -- on a slow/busy build box
                               beginSheetModal can take a moment to attach, and a
                               fixed wait there would emit a spurious failure that
                               reds a real cut. If it genuinely never attaches that
                               is a HARNESS problem (not the product), so print an
                               INCONCLUSIVE token the build gate treats as "could
                               not run", never a product verdict -- and one that
                               does NOT begin with `press:`, or the gate's product
                               arm would still match it. */
                            func fireWithSheet(tries: Int) {
                                if win.attachedSheet != nil {
                                    web.evaluateJavaScript("document.getElementById('bvisible').click()") { _, _ in }
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                                        // Reaching here AT ALL means the app did not abort;
                                        // the pre-fix code aborts before this line runs.
                                        let modal = NSApp.windows.first { $0 is NSOpenPanel && $0.isVisible && $0 !== blocker }
                                        print("press:with-a-sheet-up\tno-abort-and-panel-presented:\((modal != nil) ? "yes" : "no")")
                                        if let m = modal as? NSOpenPanel { m.cancel(nil) }
                                        if let host = blocker.sheetParent { host.endSheet(blocker, returnCode: .cancel) } else { blocker.cancel(nil) }
                                        guard modal != nil else { exit(1) }
                                        /* 🛑 #4412: A PICKER THAT DROPS ITS CALLBACK. Josh's 0.7.06 window aborted
                                           because NSOpenPanel.begin released its completion without calling it,
                                           and the handler WebKit gave us was reachable only through it. This stub
                                           does the same: it throws the callback away. Before the fix WebKit's
                                           checker aborts the app right here (this line never prints); after it,
                                           the delegate holds the answer, answers nil once the picker is not
                                           showing, and the next press reaches the app again. */
                                        var dropped = false
                                        var afterDrop = false
                                        AppDelegate.openPanelPresenterShowing = { false }
                                        AppDelegate.openPanelPresenter = { _, _ in dropped = true }
                                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                                            web.evaluateJavaScript("document.getElementById('bvisible').click()") { _, _ in }
                                            DispatchQueue.main.asyncAfter(deadline: .now() + AppDelegate.openPanelFirstLook + 1.5) {
                                                print("press:dropped-callback\tno-abort:yes asked:\(dropped ? "yes" : "no")")
                                                AppDelegate.openPanelPresenter = { _, done in afterDrop = true; done(nil) }
                                                web.evaluateJavaScript("document.getElementById('bvisible').click()") { _, _ in }
                                                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                                                    print("press:after-a-dropped-callback\treaches-the-app-again:\(afterDrop ? "yes" : "no")")
                                                    guard dropped && afterDrop else { exit(1) }
                                                    /* 🛑 #4412 (Josh 17:09, "Change picture dead until an app restart"): a picker
                                                       that KEEPS its callback and never calls it. Nothing aborts, but before the
                                                       fix openPanelOutstanding stayed true, so every later press was refused
                                                       with nil and no picker ever opened again. The watch must answer it. */
                                                    var held: (([URL]?) -> Void)?
                                                    var afterHung = false
                                                    AppDelegate.openPanelPresenter = { _, done in held = done }   // kept, never called
                                                    web.evaluateJavaScript("document.getElementById('bvisible').click()") { _, _ in }
                                                    DispatchQueue.main.asyncAfter(deadline: .now() + AppDelegate.openPanelFirstLook + 1.5) {
                                                        AppDelegate.openPanelPresenter = { _, done in afterHung = true; done(nil) }
                                                        web.evaluateJavaScript("document.getElementById('bvisible').click()") { _, _ in }
                                                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                                                            print("press:after-a-hung-picker\treaches-the-app-again:\(afterHung ? "yes" : "no")")
                                                            _ = held
                                                            /* The real panel's rule, which these stubbed arms cannot reach (this
                                                               process is never the active app): all four cases, so a rule that
                                                               never answers, or answers under a person who is away, reads wrong. */
                                                            let r = { (v: Bool, a: Bool) in AppDelegate.openPanelStillUp(visible: v, appActive: a) ? "up" : "gone" }
                                                            let rule = "shown+here:\(r(true, true)) gone+here:\(r(false, true)) shown+away:\(r(true, false)) gone+away:\(r(false, false))"
                                                            print("rule:picker-still-up\t\(rule)")
                                                            let ruleOK = rule == "shown+here:up gone+here:gone shown+away:up gone+away:up"
                                                            /* 🛑 #4412: A PICKER STILL IN USE IS LEFT ALONE. The arms above only ever see a
                                                               picker that is gone. These two keep one up past the first look (and one that
                                                               reads gone, then back, then gone again), and the watch must not answer either: a watch
                                                               that did would throw away the person's pick. */
                                                            /* Judged after the watch has looked `looks` times (not after a fixed wait, which
                                                               can land before the look under test), within a 12 s budget. */
                                                            func leftAlone(_ label: String, looks: Int, _ showing: @escaping (Int) -> Bool, then: @escaping (Bool) -> Void) {
                                                                let before = AppDelegate.openPanelWatchAnswers
                                                                var keep: (([URL]?) -> Void)?
                                                                var seen = 0
                                                                AppDelegate.openPanelPresenterShowing = { seen += 1; return showing(seen) }
                                                                AppDelegate.openPanelPresenter = { _, done in keep = done }
                                                                web.evaluateJavaScript("document.getElementById('bvisible').click()") { _, _ in }
                                                                func judge(tries: Int) {
                                                                    if seen < looks && tries > 0 {
                                                                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { judge(tries: tries - 1) }
                                                                        return
                                                                    }
                                                                    let ok = keep != nil && seen >= looks && AppDelegate.openPanelWatchAnswers == before
                                                                    print("press:\(label)\tleft-alone:\(ok ? "yes" : "no")")
                                                                    keep?(nil)   // the person closes it; the next arm starts clean
                                                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { then(ok) }
                                                                }
                                                                judge(tries: 120)
                                                            }
                                                            leftAlone("still-up-past-first-look", looks: 3, { _ in true }) { up in
                                                                /* Gone, back, gone again: each gone reading is a first look again once it was back, so a watch that
                                                               carried the first one over would answer on the second. */
                                                            leftAlone("gone-once-then-back", looks: 4, { n in n != 1 && n != 3 }) { back in
                                                                    AppDelegate.openPanelPresenterShowing = nil   // no later arm inherits the stub
                                                                    exit(afterHung && ruleOK && up && back ? 0 : 1)
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    return
                                }
                                guard tries > 0 else {
                                    print("filepanel selftest SETUP INCONCLUSIVE: the host sheet never attached (harness, not the product)")
                                    if let host = blocker.sheetParent { host.endSheet(blocker, returnCode: .cancel) } else { blocker.cancel(nil) }
                                    exit(1)
                                }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { fireWithSheet(tries: tries - 1) }
                            }
                            fireWithSheet(tries: 30)
                        }
                    }
                }
            }
        }
    }
    // A hung run loop must fail, not hang a release cut. The shell's alarm stays 15 s above this, so this fires first.
    DispatchQueue.main.asyncAfter(deadline: .now() + 65) {
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

// #3309: prove the board's JS alert()/confirm()/prompt() reach the app AND that
// their return values round-trip. Before this delegate, WKWebView dropped all
// three silently (confirm -> false with nothing on screen), so a "are you sure?"
// on the Mac did nothing. Mirrors the filepanel self-test: an in-process harness
// that swaps in presenter stubs (so it runs headless on a build box with no window
// server), loads a probe page that calls each dialog, and asserts each delegate
// fired and the page saw the scripted answer.
//
// ⚠️ LIMIT, STATED HONESTLY: unlike the filepanel gate, this does NOT have a
// "put the real presenter back and see a panel on screen" arm. The production
// path is NSAlert.runModal(), a SYNCHRONOUS nested modal loop -- once entered it
// blocks the main thread, so a headless gate cannot drive-then-dismiss it the way
// the async NSOpenPanel.begin path allowed, and a build box has no window server
// to present into anyway. So this proves WIRING + RETURN-VALUE round-trip (the
// exact regression: a missing delegate returned false/nil with no UI); the real
// NSAlert is standard AppKit API exercised the moment a person hits a confirm.
if CommandLine.arguments.contains("--kosmos-app-jspanels-selftest") {
    setvbuf(stdout, nil, _IONBF, 0)   // survive an abort through the gate's pipe (#2807)
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let d = AppDelegate()
    let frame = NSRect(x: 0, y: 0, width: 600, height: 300)
    let web = AppDelegate.makeWebView(frame: frame, delegate: d)
    print("uiDelegate:\(web.uiDelegate == nil ? "MISSING" : "set")")

    // First, the PURE mapping the real (un-stubbed) NSAlert path uses. This is the one
    // place a logic inversion would ship silently past the stub-driven arms below, so
    // assert BOTH responses directly against the helpers (OK==first button, Cancel==second).
    let mapOkTrue = AppDelegate.jsConfirmValue(.alertFirstButtonReturn) == true
    let mapCancelFalse = AppDelegate.jsConfirmValue(.alertSecondButtonReturn) == false
    let mapPromptOk = AppDelegate.jsPromptValue(.alertFirstButtonReturn, fieldText: "hi") == "hi"
    let mapPromptCancel = AppDelegate.jsPromptValue(.alertSecondButtonReturn, fieldText: "hi") == nil
    print("mapping:confirm-ok-true:\(mapOkTrue ? "yes" : "no")")
    print("mapping:confirm-cancel-false:\(mapCancelFalse ? "yes" : "no")")
    print("mapping:prompt-ok-text:\(mapPromptOk ? "yes" : "no")")
    print("mapping:prompt-cancel-nil:\(mapPromptCancel ? "yes" : "no")")

    // The mapping above trusts OK to be the FIRST button; assert the real builders
    // actually make it so (a swapped addButton order would invert the semantics and
    // otherwise pass every stub-driven arm below). Checks the alert THIS delegate builds.
    let confirmOkFirst = AppDelegate.makeConfirmAlert("x").buttons.first?.title == "OK"
    let promptOkFirst = AppDelegate.makePromptAlert("x", nil).0.buttons.first?.title == "OK"
    print("buttons:confirm-ok-first:\(confirmOkFirst ? "yes" : "no")")
    print("buttons:prompt-ok-first:\(promptOkFirst ? "yes" : "no")")

    // Presenter stubs record that the delegate fired and answer programmatically
    // (no real modal). Scripted answers: confirm -> OK(true), prompt -> "typed".
    var alertFired = false, confirmFired = false, promptFired = false
    AppDelegate.jsAlertPresenter = { _, done in alertFired = true; done() }
    AppDelegate.jsConfirmPresenter = { _, done in confirmFired = true; done(true) }
    AppDelegate.jsPromptPresenter = { _, _, done in promptFired = true; done("typed") }

    let win = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: frame.width, height: frame.height),
                       styleMask: [.titled], backing: .buffered, defer: false)
    win.contentView = web
    win.orderFrontRegardless()
    // The probe records the RETURN VALUE the page observed for confirm/prompt, so a
    // delegate that fired but answered wrong (or on the wrong path) still fails.
    let probePage = "<!doctype html><meta charset=utf-8><script>"
        + "window.__r = {};"
        + "window.__run = function(){"
        + "  alert('a'); window.__r.alert = 'called';"
        + "  window.__r.confirm = confirm('c');"
        + "  window.__r.prompt = prompt('p','d');"
        + "  window.__done = 1;"
        + "};"
        + "window.__probeReady = 1;</script>"
    web.loadHTMLString(probePage, baseURL: URL(string: "http://127.0.0.1/"))

    func whenTrue(_ expr: String, _ go: @escaping () -> Void, _ label: String, tries: Int = 150) {
        web.evaluateJavaScript(expr) { r, _ in
            if (r as? Bool) == true { go(); return }
            guard tries > 0 else { print("jspanels selftest TIMED OUT: \(label)"); exit(1) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { whenTrue(expr, go, label, tries: tries - 1) }
        }
    }
    whenTrue("window.__probeReady === 1", {
        // Kick __run(). alert/confirm/prompt are synchronous in the page but round-trip
        // to this host process, so poll window.__done rather than assuming completion.
        web.evaluateJavaScript("window.__run()") { _, _ in }
        whenTrue("window.__done === 1", {
            web.evaluateJavaScript("JSON.stringify(window.__r)") { r, _ in
                let seen = (r as? String) ?? ""
                print("delegate-fired:alert:\(alertFired ? "yes" : "no")")
                print("delegate-fired:confirm:\(confirmFired ? "yes" : "no")")
                print("delegate-fired:prompt:\(promptFired ? "yes" : "no")")
                print("return-value:confirm-true:\(seen.contains("\"confirm\":true") ? "yes" : "no")")
                print("return-value:prompt-typed:\(seen.contains("\"prompt\":\"typed\"") ? "yes" : "no")")
                // Gate the exit on the mapping/buttons arms too, not just the wiring arms:
                // otherwise an inverted jsConfirmValue prints `mapping:...:no` yet the binary
                // still exits 0, leaving the inversion protection only in the (headless-skipped)
                // build gate. Include every check so the binary itself self-fails on an inversion.
                let ok = alertFired && confirmFired && promptFired
                    && seen.contains("\"confirm\":true") && seen.contains("\"prompt\":\"typed\"")
                    && mapOkTrue && mapCancelFalse && mapPromptOk && mapPromptCancel
                    && confirmOkFirst && promptOkFirst
                exit(ok ? 0 : 1)
            }
        }, "the probe dialogs never resolved (a delegate never answered its completion)")
    }, "the probe page never finished loading")

    DispatchQueue.main.asyncAfter(deadline: .now() + 25) { print("jspanels selftest TIMED OUT: watchdog"); exit(1) }
    withExtendedLifetime(d) { app.run() }
    exit(1)   // app.run() must never fall through into the real app (see filepanel note above)
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
             && btn.titles.indices.contains(btn.restartIndex),
             "both indices name a real button")
    btnCheck(keys.count == btn.titles.count, "every button gets a key equivalent")
    /* #4347: Return now RESTARTS, on purpose (Josh: the button the notice recommends must be the blue
       default). The rows pin that, and pin it by title, so swapping the two strings is caught. */
    if keys.count == btn.titles.count, btn.titles.indices.contains(btn.restartIndex) {
        btnCheck(keys[btn.restartIndex] == "\r",
                 "Return reaches the restart button (it is \"\(btn.titles[btn.restartIndex])\")")
        btnCheck(keys.enumerated().filter { $0.element == "\r" }.count == 1, "exactly one button answers to Return")
        btnCheck(keys.count == 2 && keys[1 - btn.restartIndex] == "\u{1b}", "Not Now answers to Escape")
        let wordsKeys = AppDelegate.relaunchKeyEquivalents(btn, wordsWaiting: true)
        btnCheck(!wordsKeys.contains("\r"), "with words waiting, NO button answers to Return (a Return meant for a message box must not restart)")
    }
    btnCheck(btn.titles.indices.contains(btn.restartIndex)
             && btn.titles[btn.restartIndex] == "Restart Kosmos",
             "the restart button is the one titled \"Restart Kosmos\"")
    btnCheck(btn.titles.count == 2 && btn.titles[1 - btn.restartIndex] == "Not Now",
             "the other button is \"Not Now\"")

    /* #4347: the wait-then-restart decision, as rows. Row 1 is the bug Josh hit: relaunching before the
       app on disk carries the new version put him back on the old one. */
    var stepBad = 0
    func stepCheck(_ got: AppDelegate.RelaunchStep, _ want: AppDelegate.RelaunchStep, _ why: String) {
        let ok = got == want
        if !ok { stepBad += 1 }
        print((ok ? "PASS  " : "FAIL  ") + "relaunch step: \(why) -> \(got)")
        ran += 1
    }
    typealias P = AppDelegate.PageSays
    func step(_ fresh: Bool, _ waited: TimeInterval, _ freshFor: TimeInterval, _ page: P) -> AppDelegate.RelaunchStep {
        AppDelegate.relaunchStep(freshFound: fresh, waited: waited, freshFor: freshFor, page: page)
    }
    stepCheck(step(false, 0, 0, .safe), .wait, "the app on disk is still old: wait, even if the page is safe")
    stepCheck(step(false, 179, 0, .cannotTell), .wait, "still inside the wait limit")
    stepCheck(step(false, AppDelegate.relaunchWaitLimit, 0, .safe), .giveUp, "the app never caught up: stop, do not reopen")
    stepCheck(step(true, 5, 0, .safe), .relaunchNow, "fresh app, nothing to lose: restart with no question")
    stepCheck(step(true, 5, 0, .wouldLose), .wait, "fresh app, but a draft or a send: wait, never interrupt")
    stepCheck(step(true, 5, 0, .noReply), .wait, "no answer (page mid-load): ask the page again, never the person")
    stepCheck(step(true, 900, AppDelegate.relaunchAskAfter - 1, .wouldLose), .wait,
              "words waiting, not yet for the ask-after time (a long wait for the app does not count)")
    stepCheck(step(true, 900, AppDelegate.relaunchAskAfter, .wouldLose), .askPerson,
              "words left in a box for the ask-after time: ask, rather than stay old forever")
    stepCheck(step(true, 900, AppDelegate.relaunchAskAfter, .noReply), .askPerson,
              "a page that never answers is asked about after the same time")
    stepCheck(step(true, 5, 0, .cannotTell), .askPerson, "the page cannot tell: ask, with Restart as the default")
    stepCheck(step(true, 9999, 9999, .hold), .wait,
              "What's New deciding or open, or the person just active: wait for as long as it takes, never ask")
    stepCheck(AppDelegate.relaunchStep(freshFound: true, waited: 900, freshFor: 15, page: .cannotTell, askedBefore: true), .wait,
              "after Not Now, a page that cannot tell is not asked again")
    stepCheck(AppDelegate.relaunchStep(freshFound: true, waited: 9999, freshFor: 9999, page: .wouldLose, askedBefore: true), .wait,
              "after Not Now, words left for any length of time never bring the dialog back (asked at most once)")
    stepCheck(AppDelegate.relaunchStep(freshFound: true, waited: 900, freshFor: 15, page: .safe, askedBefore: true), .relaunchNow,
              "after Not Now, once the words are sent the restart happens with no question")
    stepCheck(AppDelegate.relaunchStep(freshFound: false, waited: AppDelegate.relaunchWaitLimit + 1, freshFor: 30, page: .safe,
                                       seenFresh: true), .wait,
              "the new app was seen, then briefly unreadable (mid-swap) past the limit: wait, do not say it did not update")
    stepCheck(AppDelegate.relaunchStep(freshFound: false, waited: 9999, freshFor: 0, page: .safe, toldGaveUp: true), .wait,
              "after telling the person once, keep looking quietly: never a second notice")
    stepCheck(AppDelegate.relaunchStep(freshFound: true, waited: 9999, freshFor: 9999, page: .cannotTell, toldGaveUp: true,
                                       askedBefore: true), .wait,
              "an app that lands after the notice, on a page that cannot tell: no second question for the same update")
    stepCheck(AppDelegate.relaunchStep(freshFound: true, waited: 9999, freshFor: 0, page: .safe, toldGaveUp: true), .relaunchNow,
              "an app that lands after the notice still gets the silent restart")

    /* #4347: a newer app than the board version we started waiting for is accepted: the board can
       move on again during the wait, and an exact match would then wait out the limit and wrongly
       say the app did not update. */
    let a1 = URL(fileURLWithPath: "/Applications/Kosmos.app")
    stepCheck(AppDelegate.pickFresh([(a1, "0.7.06")], theirs: "0.7.05") == a1 ? .wait : .giveUp, .wait,
              "an app NEWER than the awaited version is accepted")
    let own = URL(fileURLWithPath: "/Users/x/Applications/Kosmos.app")
    stepCheck(AppDelegate.pickFresh([(a1, "0.7.06"), (own, "0.7.05")], theirs: "0.7.05") == own ? .wait : .giveUp, .wait,
              "an EXACT match beats a newer copy listed first (another account's newer /Applications copy)")
    stepCheck(AppDelegate.pickFresh([(a1, "0.7.04")], theirs: "0.7.05") == nil ? .wait : .giveUp, .wait,
              "an app OLDER than the awaited version is not")

    /* #4347: the version is read from the plist ON DISK. A scratch bundle whose plist is rewritten must
       read as the new version, which the cached Bundle(url:) does not do for a path already loaded. */
    let tmpApp = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("kosmos-4347-\(getpid()).app")
    let plistDir = tmpApp.appendingPathComponent("Contents")
    try? FileManager.default.createDirectory(at: plistDir, withIntermediateDirectories: true)
    func writeVersion(_ v: String) {
        (["CFBundleShortVersionString": v] as NSDictionary).write(to: plistDir.appendingPathComponent("Info.plist"), atomically: true)
    }
    writeVersion("0.7.03")
    stepCheck(AppDelegate.onDiskVersion(tmpApp) == "0.7.03" ? .wait : .giveUp, .wait, "on-disk read sees the old version")
    _ = Bundle(url: tmpApp)?.infoDictionary   // load and cache it, as a running app has
    writeVersion("0.7.05")
    stepCheck(AppDelegate.onDiskVersion(tmpApp) == "0.7.05" ? .wait : .giveUp, .wait,
              "after the bundle is rewritten, the on-disk read sees the NEW version")
    try? FileManager.default.removeItem(at: tmpApp)
    if stepBad > 0 {
        print("\nstale-check: the wait-then-restart decision or the on-disk version read is wrong (#4347)")
        exit(1)
    }

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

    /* 🛑 #2094: THE RELAUNCH TARGET, AS ROWS. Josh's window ran a stale 0.6.26
       bundle against a 0.6.27 board; offerRelaunch reopened Bundle.main (that same
       stale bundle) forever. pickFresh chooses the installed copy that carries the
       board's version instead. Row 2 returns nil: no copy has caught up, so the caller
       waits for one (#4347) rather than reopening a stale bundle. */
    var freshBad = 0
    func freshCheck(_ got: URL?, _ want: URL?, _ what: String) {
        let ok = got?.path == want?.path
        if !ok { freshBad += 1 }
        print((ok ? "PASS  " : "FAIL  ") + "fresh-relaunch: " + what + " -> \(got?.path ?? "nil")")
    }
    let sysApp = URL(fileURLWithPath: "/Applications/Kosmos.app")
    let homeApp = URL(fileURLWithPath: "/Users/x/Applications/Kosmos.app")
    freshCheck(AppDelegate.pickFresh([(sysApp, "0.6.27"), (homeApp, "0.6.26")], theirs: "0.6.27"), sysApp,
               "the /Applications copy carrying the board version is chosen over a stale one")
    freshCheck(AppDelegate.pickFresh([(sysApp, "0.6.26"), (homeApp, "0.6.26")], theirs: "0.6.27"), nil,
               "no copy carries the board version -> nil, so the caller waits")
    freshCheck(AppDelegate.pickFresh([(sysApp, nil), (homeApp, "0.6.27")], theirs: "0.6.27"), homeApp,
               "an UNREADABLE candidate is skipped, not chosen")
    freshCheck(AppDelegate.pickFresh([(sysApp, "0.6.27"), (homeApp, "0.6.27")], theirs: "0.6.27"), sysApp,
               "with two matches the first listed (canonical /Applications) wins")
    if freshBad > 0 {
        print("\nstale-check: the #2094 fresh-copy relaunch target is wrong, which is the loop Josh hit")
        exit(1)
    }
    ran += 4

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

// #4356: this computer's mode, and where a connect computer's window may go. Pure, so no window
// server is needed; tools/build-kosmos-bundle.sh runs it at every bundle build.
if CommandLine.arguments.contains("--kosmos-app-mode-selftest") {
    var bad = 0
    var ran = 0
    func mode(_ bytes: [UInt8]?, _ want: ComputerMode, _ why: String) {
        ran += 1
        let got = computerMode(fromFile: bytes.map { Data($0) })
        if got != want { bad += 1 }
        print((got == want ? "PASS  " : "FAIL  ") + got.rawValue.padding(toLength: 11, withPad: " ", startingAt: 0) + why)
    }
    mode(nil, .unset, "no file: never chosen, behaves as today")
    mode(Array("run".utf8), .run, "run")
    mode(Array("run\n".utf8), .run, "run with the newline the app writes")
    mode(Array("run\n\n".utf8), .run, "trailing newlines dropped, as the installer's $(cat) does")
    mode(Array("connect\n".utf8), .connect, "connect")
    mode(Array("both\n".utf8), .both, "both (runs agents, and connects to other computers)")
    mode(Array(" run".utf8), .unreadable, "a space is not dropped (the installer would not match it either)")
    mode(Array("run\r\n".utf8), .unreadable, "a CR is not dropped either")
    mode(Array("RUN".utf8), .unreadable, "case matters, as in the installer")
    mode(Array("".utf8), .unreadable, "AN EMPTY FILE ASKS AGAIN, it does not become run")
    mode(Array("unset".utf8), .unreadable, "unset is not a stored choice")
    mode([0xff, 0xfe], .unreadable, "bytes that are not text")
    func link(_ s: String, _ clicked: Bool, _ want: ConnectLink, _ why: String) {
        ran += 1
        let got = URL(string: s).map { connectLinkDecision(for: $0, clicked: clicked) }
        if got != want { bad += 1 }
        print((got == want ? "PASS  " : "FAIL  ") + (got?.rawValue ?? "nil").padding(toLength: 11, withPad: " ", startingAt: 0) + why)
    }
    link("https://login.kosmosplus.com/", false, .inApp, "sign-in stays in the window")
    link("https://login.kosmosplus.com/signin?open=josh.kosmosplus.com", false, .inApp, "slice 2's open intent stays in the window")
    link("https://josh.kosmosplus.com/#kst=abc", false, .inApp, "a computer's board, after the handoff")
    link("https://LOGIN.KosmosPlus.com/", false, .inApp, "hosts are not case sensitive")
    link("https://josh.kosmosplus.com:443/", false, .inApp, "443 is the default port")
    link("https://josh.kosmosplus.com:8443/", false, .browser, "another port is not ours")
    link("https://a.b.kosmosplus.com/", false, .browser, "two labels deep is not a computer")
    link("https://-x.kosmosplus.com/", false, .browser, "a label must not start with a hyphen")
    link("https://x-.kosmosplus.com/", false, .browser, "nor end with one")
    link("https://a_b.kosmosplus.com/", false, .browser, "an underscore is not a host label (iOS refuses it too)")
    link("https://xn--80ak6aa92e.kosmosplus.com/", false, .browser, "a punycode lookalike goes to the browser")
    link("https://" + String(repeating: "a", count: 64) + ".kosmosplus.com/", false, .browser, "a label over 63 characters is not a host")
    link("https://kosmosplus.com.evil.example/", false, .browser, "a lookalike suffix goes to the browser")
    link("https://user@login.kosmosplus.com/", false, .browser, "a user part is not ours")
    link("https://stripe.com/pay", false, .browser, "any other site goes to the browser, even from a redirect")
    link("http://127.0.0.1:16180/", false, .block, "THIS COMPUTER'S STOPPED BOARD IS NEVER LOADED by a script or redirect")
    link("http://example.com/", true, .browser, "plain http, clicked, goes to the browser")
    link("mailto:help@kosmosplus.com", true, .browser, "a clicked mail link opens Mail")
    link("mailto:help@kosmosplus.com", false, .block, "a scripted mail link does not")
    link("javascript:alert(1)", true, .block, "javascript: is refused")
    link("file:///etc/passwd", true, .block, "file: is refused")
    link("about:blank", false, .inApp, "about:blank for the page's own use")
    // #5167: which downloads the app saves, and where.
    func dl(_ target: String, _ page: String?, _ want: Bool, _ why: String) {
        ran += 1
        let got = URL(string: target).map { isSameOriginDownload($0, page: page.flatMap { URL(string: $0) }) } ?? false
        if got != want { bad += 1 }
        print((got == want ? "PASS  " : "FAIL  ") + (got ? "save" : "policy").padding(toLength: 11, withPad: " ", startingAt: 0) + why)
    }
    dl("https://josh.kosmosplus.com/api/attachment/0123", "https://josh.kosmosplus.com/#kst=abc", true, "an attachment over Kosmos+ is saved")
    dl("https://josh.kosmosplus.com/api/agent/a/files/download?name=x", "https://josh.kosmosplus.com/", true, "a Files-list download over Kosmos+ is saved")
    dl("https://JOSH.kosmosplus.com:443/x", "https://josh.kosmosplus.com/", true, "case and the default port are the same origin")
    dl("http://127.0.0.1:16180/api/attachment/1", "http://127.0.0.1:16180/", true, "this computer's own board is saved too")
    dl("https://amy.kosmosplus.com/x", "https://josh.kosmosplus.com/", false, "ANOTHER COMPUTER'S FILE IS NOT SAVED by this page")
    dl("https://evil.example/x.dmg", "https://josh.kosmosplus.com/", false, "A FOREIGN FILE IS NOT SAVED: a download attribute cannot pull it onto the disk")
    dl("http://josh.kosmosplus.com/x", "https://josh.kosmosplus.com/", false, "http is not the https origin")
    dl("http://127.0.0.1:3000/x", "http://127.0.0.1:16180/", false, "another local port is another origin")
    dl("https://user@josh.kosmosplus.com/x", "https://josh.kosmosplus.com/", false, "a user part is refused")
    dl("blob:https://josh.kosmosplus.com/1234", "https://josh.kosmosplus.com/", false, "blob: is not saved (nothing in the page makes one to download)")
    dl("https://josh.kosmosplus.com/x", nil, false, "no page yet: nothing is saved")
    func says(_ s: String, _ want: Bool, _ why: String) {
        ran += 1
        let got = pageSaysDownloadRefusal(URL(string: s))
        if got != want { bad += 1 }
        print((got == want ? "PASS  " : "FAIL  ") + (want ? "page says" : "app says").padding(toLength: 11, withPad: " ", startingAt: 0) + why)
    }
    says("https://josh.kosmosplus.com/api/agent/amy/files/download?name=a.pdf", true, "an agent's Files-list download: the page says its refusal")
    says("http://127.0.0.1:16180/api/project/p1/file-download?name=a.pdf", true, "a project's Files-list download, on this computer's board too")
    says("https://josh.kosmosplus.com/api/attachment/0123", false, "AN ATTACHMENT'S REFUSAL IS SAID BY THE APP (the page does not look)")
    says("https://josh.kosmosplus.com/api/agent/amy/files/download/extra", false, "only the exact route")
    func board(_ s: String?, _ want: Bool, _ why: String) {
        ran += 1
        let got = isBoardPage(s.flatMap { URL(string: $0) }, board: (host: "127.0.0.1", port: 16180))
        if got != want { bad += 1 }
        print((got == want ? "PASS  " : "FAIL  ") + (got ? "board" : "not").padding(toLength: 11, withPad: " ", startingAt: 0) + why)
    }
    board("https://josh.kosmosplus.com/#kst=abc", true, "a Kosmos+ computer is a board page")
    board("https://login.kosmosplus.com/", false, "KOSMOS+ SIGN-IN IS NOT A BOARD")
    board("https://community.kosmosplus.com/", false, "THE PUBLIC COMMUNITY FEED IS NOT A BOARD")
    board("https://coordinator.kosmosplus.com/", false, "THE COORDINATOR (a live alias of sign-in) IS NOT A BOARD")
    board("https://status.kosmosplus.com/", false, "no reserved name is a board (the coordinator's own list)")
    board("http://127.0.0.1:16180/", true, "this computer's own board is a board page")
    board("https://stripe.com/pay", false, "A FOREIGN SITE IN THE WINDOW CANNOT SAVE ITS OWN FILES")
    board("http://example.com/", false, "nor can a foreign http site")
    board("https://127.0.0.1/", false, "loopback on another port is not the board")
    board("http://127.0.0.1:3000/", false, "ANOTHER LOCAL SERVER IN THE WINDOW CANNOT SAVE ITS OWN FILES")
    board("http://localhost:16180/", false, "the board is the host it was loaded as")
    ran += 1
    let connectBoard = isBoardPage(URL(string: "http://127.0.0.1:16180/"), board: nil)
    if connectBoard { bad += 1 }
    print((connectBoard ? "FAIL  board      " : "PASS  not        ") + "a connect computer has no board of its own to save from")
    board(nil, false, "no page yet")
    func dest(_ suggested: String, _ taken: Set<String>, _ want: String, _ why: String) {
        ran += 1
        let dir = URL(fileURLWithPath: "/D", isDirectory: true)
        let got = downloadDestination(dir: dir, suggested: suggested) { taken.contains($0.lastPathComponent) }
        let ok = got.deletingLastPathComponent().path == "/D" && got.lastPathComponent == want
        if !ok { bad += 1 }
        print((ok ? "PASS  " : "FAIL  ") + got.lastPathComponent.padding(toLength: 22, withPad: " ", startingAt: 0) + why)
    }
    dest("report.pdf", [], "report.pdf", "the suggested name, in Downloads")
    dest("report.pdf", ["report.pdf"], "report (2).pdf", "a taken name is never replaced")
    dest("report.pdf", ["report.pdf", "report (2).pdf"], "report (3).pdf", "and counts on")
    dest("notes", ["notes"], "notes (2)", "no extension")
    dest("../../.zshrc", [], "-..-.zshrc", "A PATH CANNOT LEAVE Downloads (separators become -)")
    dest(".zshrc", [], "zshrc", "a leading dot does not make a hidden file")
    dest(". .zshrc", [], "zshrc", "NOR DOES A DOT, A SPACE AND A DOT")
    dest(". .", [], "Download", "NOR CAN A NAME BECOME . (the Downloads folder itself)")
    dest("a:b", [], "a-b", "a colon is a separator to Finder")
    dest("a\nb.txt", [], "a b.txt", "control characters become spaces")
    dest("a\u{85}b.txt", [], "a b.txt", "so do C1 controls (invisible in Finder)")
    dest("invoice\u{202E}fdp.app", [], "invoicefdp.app", "A DIRECTION CONTROL CANNOT DISGUISE AN APP AS A PDF")
    dest("\u{200B}\u{FEFF}", [], "Download", "a name of invisible characters only gets one")
    dest("", [], "Download", "an empty name gets one")
    dest("..", [], "Download", "and so does ..")
    dest(String(repeating: "x", count: 300) + ".pdf", [], String(repeating: "x", count: 196) + ".pdf", "a long name is cut to 200 bytes, keeping its extension")
    dest("a." + String(repeating: "y", count: 210), [], "a." + String(repeating: "y", count: 198), "A LONG EXTENSION DOES NOT CRASH: it is not kept as one, and the name is cut")
    dest(String(repeating: "\u{6587}", count: 160) + ".txt", [], String(repeating: "\u{6587}", count: 65) + ".txt", "a long multi-byte name is cut by bytes, never mid-character")
    // The file itself: a write the reader reads back, a missing file, and one that cannot be read.
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("kosmos-mode-selftest-\(getpid())")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    // Removed before each exit below: exit() does not unwind, so a defer here would never run.
    func disk(_ got: Bool, _ why: String) {
        ran += 1
        if !got { bad += 1 }
        print((got ? "PASS  " : "FAIL  ") + "disk".padding(toLength: 11, withPad: " ", startingAt: 0) + why)
    }
    disk(readComputerMode(kosmosHome: dir.path) == .unset, "no file reads unset")
    disk(writeComputerMode(.connect, kosmosHome: dir.path) && readComputerMode(kosmosHome: dir.path) == .connect, "connect written reads back connect")
    disk(writeComputerMode(.run, kosmosHome: dir.path) && readComputerMode(kosmosHome: dir.path) == .run, "run written reads back run")
    disk(writeComputerMode(.both, kosmosHome: dir.path) && readComputerMode(kosmosHome: dir.path) == .both, "both written reads back both")
    disk(!writeComputerMode(.unreadable, kosmosHome: dir.path) && !writeComputerMode(.unset, kosmosHome: dir.path), "only the three choices can be written")
    try? FileManager.default.removeItem(atPath: computerModePath(kosmosHome: dir.path))
    try? FileManager.default.createDirectory(atPath: computerModePath(kosmosHome: dir.path), withIntermediateDirectories: false)
    disk(readComputerMode(kosmosHome: dir.path) == .unreadable, "a mode that cannot be read (a folder in its place) reads unreadable, not unset")
    try? FileManager.default.removeItem(at: dir)
    let expected = 86
    if ran != expected {
        print("\nmode-check: only \(ran) of \(expected) rows ran, so this proved nothing")
        exit(1)
    }
    if bad > 0 { print("\nmode-check: \(bad) row(s) wrong"); exit(1) }
    print("\nmode-check: all good (\(ran) rows)")
    exit(0)
}

// #4382: what `kosmos update --if-newer` said, read the way a connect computer's app reads it. Pure;
// tools/build-kosmos-bundle.sh runs it at every bundle build.
if CommandLine.arguments.contains("--kosmos-app-update-selftest") {
    var bad = 0
    var ran = 0
    func row(_ text: String, _ want: UpdateAnswer, _ why: String) {
        ran += 1
        let got = updateAnswer(fromOutput: text)
        if got != want { bad += 1 }
        print((got == want ? "PASS  " : "FAIL  ") + "\(got)".padding(toLength: 18, withPad: " ", startingAt: 0) + why)
    }
    row("current 0.7.18\n", .current("0.7.18"), "nothing newer, and which version is on disk")
    row("newer 0.7.19\n", .newer("0.7.19"), "newer, updates off: offered")
    row("updated 0.7.19\n", .updated("0.7.19"), "installed: relaunch")
    row("failed 0.7.19\n", .failed("0.7.19"), "the installer failed")
    row("board\n", .board, "a board runs here and looks for itself")
    row("unknown\tthe release host could not be reached\n", .unknown, "the host could not be reached")
    row("", .unknown, "NO OUTPUT IS UNKNOWN, never current")
    row("Kosmos is starting\nnewer 0.7.19\n\n", .newer("0.7.19"), "only the last non-empty line is the answer")
    row("newer 0.7.19\nsomething else\n", .unknown, "a last line that is not an answer is unknown, even after one")
    row("newer 0.7.19-wedge\n", .unknown, "a version not of the board's shape is never offered")
    row("newer\n", .unknown, "newer with no version")
    row("updated 0.7\n", .unknown, "two parts is not a version")
    row("current 0.7.18 extra\n", .unknown, "an extra word is not an answer")
    row("Newer 0.7.19\n", .unknown, "case matters, as the CLI prints it")
    row("refused\tthis computer is not set to connect to agents elsewhere\n", .refused, "refused: nothing to retry")
    row("refused\n", .unknown, "refused with no reason is not the CLI's answer")
    row("refused\t   \n", .unknown, "a reason of only spaces is no reason")
    func want(_ running: String?, _ onDisk: String, _ expect: Bool, _ why: String) {
        ran += 1
        let got = AppDelegate.restartWanted(running: running, onDisk: onDisk)
        if got != expect { bad += 1 }
        print((got == expect ? "PASS  " : "FAIL  ") + "restart=\(got)".padding(toLength: 18, withPad: " ", startingAt: 0) + why)
    }
    want("0.7.18", "0.7.19", true, "the install is newer than the running app: offer Restart")
    want("0.7.19", "0.7.19", false, "the same version: nothing to restart into")
    want("0.7.20", "0.7.19", false, "an app newer than its install is never offered an older one")
    want(nil, "0.7.19", false, "no running version: offer nothing")
    want("0.7.18-dev", "0.7.19", false, "a version that cannot be read offers nothing")
    row("Kosmos is starting\r\nnewer 0.7.19\r\n", .newer("0.7.19"), "CRLF lines split too (Swift reads CRLF as one Character)")
    let expected = 23
    if ran != expected { print("\nupdate-check: only \(ran) of \(expected) rows ran, so this proved nothing"); exit(1) }
    if bad > 0 { print("\nupdate-check: \(bad) row(s) wrong"); exit(1) }
    print("\nupdate-check: all good (\(ran) rows)")
    exit(0)
}

/* #3996: the Dock badge's number, read from the board's own JSON the way the timer reads it. */
if CommandLine.arguments.contains("--kosmos-app-badge-selftest") {
    var bad = 0
    var ran = 0
    func check(_ json: String?, _ want: String?, _ why: String) {
        ran += 1
        let got = AppDelegate.badgeLabel(fromStatusJSON: json.map { Data($0.utf8) })
        let ok = got == want
        if !ok { bad += 1 }
        print((ok ? "PASS  " : "FAIL  ") + (got ?? "(none)").padding(toLength: 7, withPad: " ", startingAt: 0) + why)
    }
    check(#"{"counts":{"waiting":3}}"#, "3", "a count is its number")
    check(#"{"counts":{"waiting":1}}"#, "1", "one is shown")
    check(#"{"counts":{"waiting":999}}"#, "999", "999 as it is")
    check(#"{"counts":{"waiting":1000}}"#, "999+", "over 999 stays a badge")
    check(#"{"counts":{"waiting":0}}"#, nil, "ZERO CLEARS IT: no badge when nothing is waiting")
    check(#"{"counts":{"waiting":-2}}"#, nil, "a negative is not a count")
    check(#"{"counts":{"waiting":2.5}}"#, nil, "nor a fraction")
    check(#"{"counts":{"waiting":"4"}}"#, nil, "a string is not read as a number")
    check(#"{"counts":{"waiting":true}}"#, nil, "nor is true (it is an NSNumber too)")
    check(#"{"counts":{"waiting":null}}"#, nil, "an unknown count clears it")
    check(#"{"counts":{"needsYou":2}}"#, nil, "a board from before #3996 has no count: no badge, not a guess")
    check(#"{"version":"0.6.98"}"#, nil, "no counts at all")
    check("not json", nil, "an answer that is not JSON")
    check(nil, nil, "no answer")
    // Whether an answer READ as the board's status (a miss otherwise, counted toward three).
    func reads(_ json: String?, _ want: Bool, _ why: String) {
        ran += 1
        let got = AppDelegate.readsAsStatus(json.map { Data($0.utf8) })
        if got != want { bad += 1 }
        print((got == want ? "PASS  " : "FAIL  ") + (got ? "reads " : "miss  ").padding(toLength: 7, withPad: " ", startingAt: 0) + why)
    }
    reads(#"{"counts":{"waiting":2}}"#, true, "a status with a count reads")
    reads(#"{"counts":{}}"#, true, "a status from an older board (no count) still reads: it clears, it is not a miss")
    reads(#"{"counts":{"wait"#, false, "A 200 CUT OFF MID-BODY IS A MISS, not a reason to clear at once")
    reads(#"{"version":"0.6.98"}"#, false, "an answer with no counts is not the status")
    let expected = 18
    if ran != expected {
        print("\nbadge-check: only \(ran) of \(expected) rows ran, so this proved nothing")
        exit(1)
    }
    if bad > 0 { print("\nbadge-check: \(bad) row(s) wrong"); exit(1) }
    print("\nbadge-check: all good (\(ran) rows)")
    exit(0)
}

/* #4409: the dictation bridge's decisions that need no microphone and no permission: which language it
   listens in (on-device only, never a network fallback), what an ending is called, and the refusal that
   stands in for a crash when the bundle lacks a usage string. */
if CommandLine.arguments.contains("--kosmos-app-voice-selftest") {
    var bad = 0
    var ran = 0
    func row(_ ok: Bool, _ why: String) { ran += 1; if !ok { bad += 1 }; print((ok ? "PASS  " : "FAIL  ") + why) }
    let here: Set<String> = ["en-US", "en-GB"]
    let has = { (id: String) in here.contains(id) }
    row(VoiceBridge.pickLocale(preferred: ["en-GB", "en-US"], onDevice: has) == "en-GB", "the person's first language, when it has an on-device model")
    row(VoiceBridge.pickLocale(preferred: ["fr-FR", "en-GB"], onDevice: has) == "en-GB", "a language with no on-device model is skipped, not sent to a server")
    row(VoiceBridge.pickLocale(preferred: ["en_GB"], onDevice: has) == "en-GB", "Locale.current's en_GB spelling is the same language")
    row(VoiceBridge.pickLocale(preferred: ["fr-FR"], onDevice: has) == "en-US", "en-US is the last resort")
    row(VoiceBridge.pickLocale(preferred: ["fr-FR"], onDevice: { _ in false }) == nil, "NO ON-DEVICE MODEL AT ALL REFUSES: nil, never a network recognizer")
    row(VoiceBridge.pickLocale(preferred: [], onDevice: has) == "en-US", "no preference at all still asks for en-US")
    row(VoiceBridge.endReason(domain: "kAFAssistantErrorDomain", code: 1110) == "nothing-heard", "silence is not a fault")
    row(VoiceBridge.endReason(domain: "kAFAssistantErrorDomain", code: 216) == "", "a stop we asked for says nothing")
    row(VoiceBridge.endReason(domain: "NSOSStatusErrorDomain", code: -1) == "recognizer", "anything else is a recognizer error")
    let both: [String: Any] = ["NSMicrophoneUsageDescription": "x", "NSSpeechRecognitionUsageDescription": "y"]
    row(VoiceBridge.usageStringsPresent(both), "both usage strings present")
    row(!VoiceBridge.usageStringsPresent(["NSMicrophoneUsageDescription": "x"]), "A MISSING SPEECH STRING REFUSES (macOS would kill the app at the request)")
    row(!VoiceBridge.usageStringsPresent(["NSSpeechRecognitionUsageDescription": "y"]), "a missing mic string refuses")
    row(!VoiceBridge.usageStringsPresent(["NSMicrophoneUsageDescription": "", "NSSpeechRecognitionUsageDescription": "y"]), "an empty string is missing")
    row(!VoiceBridge.usageStringsPresent(nil), "no Info.plist at all (an unbundled binary) refuses")
    let expected = 14
    if ran != expected { print("\nvoice-check: only \(ran) of \(expected) rows ran, so this proved nothing"); exit(1) }
    if bad > 0 { print("\nvoice-check: \(bad) row(s) wrong"); exit(1) }
    print("\nvoice-check: all good (\(ran) rows)")
    exit(0)
}

// #2125 slice 3: the native Accessibility writer's two hatches, same
// exit-before-app.run() shape as the selftests above.
//
// --kosmos-app-axcheck: read AXIsProcessTrusted() (or the KOSMOS_AXCHECK_FORCE_TRUSTED
// mock) and write the verdict where engine/a11ystatus.js reads it. Spawned UNDER the
// bundled tmux (see applicationDidFinishLaunching) on the BELIEF that macOS would then
// attribute the AX read to tmux -- the responsible process that owns the folder-TCC
// grant -- not to the kosmos-app.
//
// 🛑 THE ATTRIBUTION IS VERIFIED WRONG (2026-09-06, #2125). It was the load-bearing
// UNKNOWN; Josh's 0.6.42 fresh-account re-test resolved it the WRONG way. An under-tmux
// re-exec does NOT report tmux's trust -- accessibility is keyed on the CALLING BINARY,
// so AXIsProcessTrusted here reports the kosmos-APP's trust regardless of the tmux
// parent. Observed harm is the OPPOSITE of the false-BLOCK the startA11yTrustChecks
// comment anticipated: it FALSE-GREENED -- the tmux gate read ACTIVATED on arrival on a
// fresh account while tmux was ungranted and absent from the Accessibility list (writing
// trusted:true = the app's state). So this hatch cannot answer "is tmux trusted"; the
// verdict it writes is the app's. Do not re-assume the tmux attribution. The fix is the
// pending #2125 fork: KEEP -> route the AX check + grant through one identity; DROP ->
// remove the accessibility ask (no synthetic-input API is used anywhere; agents run on
// tmux send-keys IPC). Root writeup:
// ~/work/Josh-Brain/Projects/kosmos-tcc-identity-root-2378-1-3-2026-09-06.md
// The FORCE-mock still exercises the trusted:false downstream (writer -> engine -> gate).
if CommandLine.arguments.contains("--kosmos-app-axcheck") {
    exit(writeA11yStatus(trusted: axTrustReading()) ? 0 : 1)
}
// --kosmos-app-axprompt: show the system Accessibility prompt, which ALSO adds an entry
// to the Accessibility list -- so the Open-Accessibility button then "gives something to
// enable" (Josh's bug #2). Fired once (under tmux) when the last reading is
// not-trusted/absent. ⚠️ CORRECTED (#2125, 2026-09-06): the entry it adds is the CALLING
// BINARY's (the kosmos-app), NOT tmux's -- accessibility is keyed on the calling binary,
// not the responsible process, and this prompt uses the same AX API family as the
// axcheck. That is exactly #2189's "no Tmux to enable": the prompt registers the app, so
// no tmux row appears to toggle.
if CommandLine.arguments.contains("--kosmos-app-axprompt") {
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(opts)
    exit(0)
}
// --kosmos-app-fileaccessprompt: attempt to enumerate the protected folders, which
// fires the Files-and-Folders prompt for tmux (this hatch's responsible process) on
// the first undecided access, and write the resulting grant verdict where
// fileaccessstatus.js reads it. Spawned UNDER the bundled tmux (see the prompt-request
// watcher) so the grant is attributed to tmux -- the responsible process the running
// agents use -- not to the kosmos-app. One hatch does both the prompt and the verdict,
// exactly as attempting the access does both in macOS. (Folder-TCC uses the
// responsible-process model, which is why the under-tmux spawn works HERE. The
// Accessibility seam does NOT -- it is keyed on the calling binary, so its under-tmux
// read reports the app, not tmux; see the startA11yTrustChecks correction. Do not read
// this file-access attribution as evidence the a11y seam attributes to tmux too.)
if CommandLine.arguments.contains("--kosmos-app-fileaccessprompt") {
    exit(writeFileAccessStatus(granted: fileAccessReading()) ? 0 : 1)
}
// --kosmos-app-scan: the import-scan TCC-root walk, done by the APP identity (#3 / #2125
// follow-up). The engine drops scan-request.json; the prompt-request watcher claims it (rename
// -> scan-request.inflight) and fires this hatch UNDER tmux -- the SAME spawn path as
// --kosmos-app-fileaccessprompt, so the readdir runs under the app identity that holds the S2
// grant and fires no fresh Documents prompt. This walk emits RAW MATERIAL only (paths + head
// bytes) to scan-result.json; ALL agent detection + dedup stays in engine/discover.js so there
// is no Swift/Node divergence. Contract: .claude/plans/scan-tcc-hatch-2125b.md.
if CommandLine.arguments.contains("--kosmos-app-scan") {
    exit(scanUnderGrant() ? 0 : 1)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
