import Foundation

// The iOS shell's decisions about loading pages (kosmos#718: the app must behave
// like an app on a phone). Foundation-only, like PushBridgeLogic, so
// ios/LogicTests proves them on a Mac with no simulator. ContentView's WebView
// delegate is a thin caller of what is here.
enum Shell {

    // MARK: - A page that failed to load

    enum LoadFailure: Equatable {
        // The phone has no connection: "you're offline" is the whole story.
        case offline
        // The phone is online but Kosmos+ did not answer.
        case unreachable
        // The phone is online and the address that failed is a Mac's own
        // (<mac>.kosmosplus.com): the Mac did not answer, usually because it is
        // asleep, off, or not running Kosmos (#718 state 2).
        case macUnreachable
        // Anything else that stopped the page, shown with the system's wording.
        case other
    }

    // nil means "not a failure worth a page": a navigation the person or the
    // page cancelled (typing a new address, a redirect superseding a load), and
    // WebKit's "frame load interrupted", which is how it reports a navigation
    // the delegate chose to hand to Safari.
    static func loadFailure(domain: String, code: Int) -> LoadFailure? {
        if domain == NSURLErrorDomain {
            switch code {
            case NSURLErrorCancelled:
                return nil
            // Connection lost is NOT offline: the far end usually dropped it while
            // the phone stayed online, so "back online" would never come.
            case NSURLErrorNotConnectedToInternet,
                 NSURLErrorDataNotAllowed, NSURLErrorInternationalRoamingOff,
                 NSURLErrorCallIsActive:
                return .offline
            case NSURLErrorNetworkConnectionLost,
                 NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorTimedOut,
                 NSURLErrorDNSLookupFailed, NSURLErrorSecureConnectionFailed,
                 NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate,
                 NSURLErrorServerCertificateNotYetValid, NSURLErrorServerCertificateHasUnknownRoot,
                 NSURLErrorBadServerResponse:
                return .unreachable
            default:
                return .other
            }
        }
        // WebKitErrorDomain 102: frame load interrupted by a policy change; 204: a plug-in (media)
        // handled the load, which is playing, not failing.
        if domain == "WebKitErrorDomain" && (code == 102 || code == 204) { return nil }
        return .other
    }

    // The codes that mean nothing answered at the far end. A certificate error or a bad
    // response on a Mac's address means the Mac DID answer (the tunnel ends TLS on the Mac),
    // and a DNS failure is the phone's own lookup, so those keep the Kosmos+ wording.
    static let noAnswerCodes: Set<Int> = [
        NSURLErrorTimedOut, NSURLErrorCannotConnectToHost,
        NSURLErrorNetworkConnectionLost, NSURLErrorSecureConnectionFailed,
    ]

    // The same, told which address failed: a Mac's own address that did not answer is the
    // Mac not answering, not Kosmos+. The coordinator's host, any host that is not a Mac's,
    // and any failure outside noAnswerCodes stay .unreachable.
    static func loadFailure(domain: String, code: Int, failingHost: String?, coordinator: URL) -> LoadFailure? {
        guard let failure = loadFailure(domain: domain, code: code) else { return nil }
        if failure == .unreachable, domain == NSURLErrorDomain, noAnswerCodes.contains(code),
           let host = failingHost?.lowercased(), PushBridge.isMacHost(host, coordinator: coordinator) {
            return .macUnreachable
        }
        return failure
    }

    // MARK: - Where a link goes

    enum LinkDecision: Equatable {
        // Load it in the app's WebView.
        case inApp
        // Hand it to the system (Safari, Mail, Phone).
        case external
        // Do nothing with it.
        case block
    }

    // A navigation inside a frame of the page (an iframe), which linkDecision never
    // sees. Embedded content keeps working over https (and about:blank / about:srcdoc,
    // which WebKit uses for frames); every other scheme (javascript:, file:, data:,
    // blob:, plain http, custom schemes) is refused, so a frame cannot do what the
    // main frame may not.
    static func allowsSubframe(_ url: URL) -> Bool {
        switch url.scheme?.lowercased() ?? "" {
        case "https": return true
        case "about": return url.absoluteString == "about:blank" || url.absoluteString == "about:srcdoc"
        default: return false
        }
    }

    // What Try again (or pull to refresh) loads: the page that failed, else the
    // home page when nothing has loaded yet, else a reload of the current page.
    enum RetryAction: Equatable {
        case load(URL)
        case reload
    }

    static func retryAction(failed: URL?, current: URL?, home: URL) -> RetryAction {
        if let failed = failed { return .load(failed) }
        if current == nil { return .load(home) }
        return .reload
    }

    // What "Back to Kosmos" does on the failure page.
    enum BackAction: Equatable {
        // Just close the failure page: the page before the failed one is still loaded.
        case stay
        // Go back one page in the WebView's history.
        case goBack
        // Nothing to go back to: load the board home.
        case home
    }

    // `provisional` is true when the failure came before the new page committed
    // (an offline Mac, a timeout, a bad certificate). Then the history's current
    // item is still the page that was showing, and going back would skip it: board,
    // Mac A, a tap to an offline Mac C, then Back, must land on Mac A, not the board.
    static func backAction(provisional: Bool, current: URL?, canGoBack: Bool) -> BackAction {
        if provisional && current != nil { return .stay }
        return canGoBack ? .goBack : .home
    }

    // kosmos#6850 (Josh, 10-21: no easy way to flip to another computer when the one he picked
    // is not answering). Only a Mac that did not answer offers another one: offline, Kosmos+
    // down and other failures would fail the same way on any computer.
    static func offersOtherComputer(_ failure: LoadFailure) -> Bool {
        failure == .macUnreachable
    }

    // Where "Choose another computer" goes: the coordinator's /account page, which lists
    // the person's computers, says which are answering and opens one from its row. Not
    // "/": that page opens a lone computer by itself after an allow, which could put the
    // person straight back on the Mac that just failed; /account never opens anything by
    // itself (kosmos#5397).
    static func otherComputerURL(coordinator: URL) -> URL {
        URL(string: "/account", relativeTo: coordinator)!.absoluteURL
    }

    // Whether an "offline" failure should retry by itself straight away. The
    // automatic reload otherwise waits for NWPathMonitor to report a CHANGE; if the
    // phone was already back online when the load failed, no change will come and
    // the person would sit on "You're offline" while online. Once per failure, so a
    // path that reads online while nothing loads (a captive portal) cannot loop.
    static func retriesOnShow(failure: LoadFailure, online: Bool, alreadyRetried: Bool) -> Bool {
        failure == .offline && online && !alreadyRetried
    }

    // What started a navigation, as far as the rule cares.
    enum Origin {
        // The person tapped a link.
        case tapped
        // A redirect, a form post or a script: part of a flow the page is running.
        case pageFlow
        // A request for a new window (target=_blank, window.open).
        case newWindow
    }

    // Kosmos+ itself or one of the person's Macs, over https: the plain host with no
    // user part, and the coordinator's own port (443 and none are the same) or none.
    static func isOurs(_ url: URL, coordinator: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased(), !host.isEmpty,
              url.user == nil, url.password == nil
        else { return false }
        let port = url.port == 443 ? nil : url.port
        if host == coordinator.host?.lowercased() {
            let want = coordinator.port == 443 ? nil : coordinator.port
            return port == want
        }
        return port == nil && PushBridge.isMacHost(host, coordinator: coordinator)
    }

    // Decides a MAIN-FRAME navigation or a new-window request. Subframe loads never
    // come here.
    // - Kosmos+ itself and the person's Macs, over https: in the app.
    // - Any other https site, however it is reached (a tap, a new window, a redirect,
    //   a script): Safari. Kosmos+ sign-in is email plus a code with no third-party
    //   identity provider, and the iOS app shows no purchase (Liu Kang's default,
    //   m556), so no flow needs another site inside the app, and a hostile page can
    //   never show a fake Kosmos screen inside the app's own frame.
    // - Plain http: never loaded in the app; tapped, it goes to Safari.
    // - mail, phone and text links: their apps, but only from a tap or a new window
    //   the person asked for, never from a script or redirect.
    // - about:blank: allowed for the page's own use, but never as a new window,
    //   which would replace the board with a blank page.
    // - Every other scheme (javascript:, file:, data:, blob:, custom schemes): refused.
    //   A data: or blob: download is refused on purpose: the board has none today.
    static func linkDecision(for url: URL, coordinator: URL, origin: Origin) -> LinkDecision {
        let scheme = url.scheme?.lowercased() ?? ""
        switch scheme {
        case "https":
            if isOurs(url, coordinator: coordinator) { return .inApp }
            guard let host = url.host, !host.isEmpty else { return .block }
            return .external
        case "http":
            guard let host = url.host, !host.isEmpty else { return .block }
            return origin == .pageFlow ? .block : .external
        case "mailto", "tel", "sms":
            // Only a person's tap (or a new window they asked for) may open Mail,
            // Phone or Messages; a script or redirect may not.
            return origin == .pageFlow ? .block : .external
        case "about":
            return url.absoluteString == "about:blank" && origin != .newWindow ? .inApp : .block
        default:
            return .block
        }
    }
}

// The app's own tab bar (kosmos#6846, part b): Agents is native, the other four open their part of the board in the
// one web view through the board's door, window.kosmosAppTab (part a, .claude/plans/apptab-6846.md).
enum AppTabs {
    enum Tab: CaseIterable, Hashable {
        case today, agents, projects, tasks, settings

        var title: String {
            switch self {
            case .today: return "Today"
            case .agents: return "Agents"
            case .projects: return "Projects"
            case .tasks: return "Tasks"
            case .settings: return "Settings"
            }
        }

        // Mona Lisa's slice 1 spec.
        var symbol: String {
            switch self {
            case .today: return "sun.max"
            case .agents: return "person.2"
            case .projects: return "folder"
            case .tasks: return "checklist"
            case .settings: return "gearshape"
            }
        }

        // The name the board's door takes; nil for the native tab. Today is the board's home, its agents tab.
        var boardName: String? {
            switch self {
            case .today: return "agents"
            case .agents: return nil
            case .projects: return "projects"
            case .tasks: return "tasks"
            case .settings: return "settings"
            }
        }
    }

    // In Mona Lisa's order. Tasks is earned, as on the computer (#3559): the bar shows it only once the board says so.
    static func visible(tasksTab: Bool) -> [Tab] {
        Tab.allCases.filter { $0 != .tasks || tasksTab }
    }

    // What to show when the bar changes under a selection it no longer has (Tasks on a Mac that has not earned it).
    // The tab that lights for a section the PAGE is on. A Tasks section the bar does not offer (a project's View all,
    // which on a Mac below Tasks' threshold is that project's only full list) belongs under Projects, where it is
    // reached from, and the page is left where it is: nothing presses it away.
    // kosmos#7010: the Settings tab is native, so the board's own Settings section (its links into it, or the native
    // screen's "open the board's Settings" row) shows under Today, as an agent's chat does. Lighting the Settings tab
    // would put the native screen over the very section the person was sent to.
    // The tabs the app draws itself. Pressing one ends any press still waiting, and a lock never replays one.
    // kosmos#7030: Today too. A page the app sends under Today (ContentView todayBoard) is loaded by the app itself, so
    // a press on Today never drives the board: it brings back the native screen.
    static func isNative(_ tab: Tab) -> Bool { tab == .agents || tab == .settings || tab == .today }

    static func barTab(forPage section: Tab, tasksTab: Bool) -> Tab {
        if section == .settings { return .today }
        return visible(tasksTab: tasksTab).contains(section) ? section : .projects
    }

    static func keep(_ selected: Tab, tasksTab: Bool) -> Tab {
        visible(tasksTab: tasksTab).contains(selected) ? selected : .today
    }

    // The call the app makes for a press. It tells apart a page without the door (the sign-in page, an error page,
    // an older board: the typeof test) from a board that refused (a box or full-screen step is up, where a person
    // could not press either). Only a real true from the door is "opened"; a door that throws counts as refused, so a
    // broken press ends instead of waiting to fire on some later load.
    static func pressScript(_ tab: Tab) -> String? {
        guard let name = tab.boardName else { return nil }
        return "(function () { if (typeof window.kosmosAppTab !== 'function') return 'absent'; try { return window.kosmosAppTab('\(name)') === true ? 'opened' : 'refused'; } catch (e) { return 'refused'; } })()"
    }

    enum DoorAnswer: Equatable {
        // The section opened.
        case opened
        // The board said no: the press is over, and the bar goes back to the tab the page still shows.
        case refused
        // No answer (an error mid-navigation): the press waits for the next page to load.
        case absent
        // A page without the door. On the sign-in page the press waits, since the hand-off to the Mac is still to
        // come; on a Mac's page (an older board, which will never have it) the press ends where the page is.
        case noDoor
    }

    // The coordinator's sign-in host, where a press waits for the hand-off. It must match KosmosConfig.coordinatorOrigin
    // (ContentView.swift), which LogicTests cannot compile; change both together.
    static let signInHost = "login.kosmosplus.com"

    // What a press's answer does: whether the press is over, and where the bar goes (nil: it stays). A refusal puts
    // the bar on the tab of the section the page is really on, read from its address (the board keeps ?tab= there
    // with replaceState). Not the bar's previous tab: the bar may have moved since without the page following. And
    // never Agents (an address never names it): from Agents every web tab would be refused in turn while the box
    // refusing them sat out of sight.
    static func afterAnswer(_ answer: DoorAnswer, pageURL: URL?) -> (over: Bool, barTo: Tab?) {
        switch answer {
        case .opened: return (true, nil)
        case .absent: return (false, nil)
        case .refused: return (true, tab(forBoardURL: pageURL))
        case .noDoor:
            guard let host = pageURL?.host, host != signInHost else { return (false, nil) }
            return (true, tab(forBoardURL: pageURL))
        }
    }

    // The page moved to another section by itself (a link in it, a swipe back): the tab the bar moves to, or nil to
    // leave it, so the bar never lights a tab the page is not on. Only a real change of section counts: an address the
    // board rewrites within a section (and a Settings opened over the consolidated layout, which keeps the previous
    // ?tab=) moves nothing. Not while the bar is held (a press running, or waiting while a page loads: its answer
    // decides), never from Agents, the native tab, which shows no page, and never on the sign-in page. It never
    // presses: the page stays where the person took it.
    static func follow(from previous: URL?, to pageURL: URL?, selected: Tab, barHeld: Bool, tasksTab: Bool) -> Tab? {
        // A native tab (Agents, Settings #7010) is not moved by the hidden page.
        guard !barHeld, selected != .agents, selected != .settings, let pageURL = pageURL, pageURL.host != signInHost else { return nil }
        let now = tab(forBoardURL: pageURL)
        if let previous = previous, previous.host == pageURL.host, tab(forBoardURL: previous) == now { return nil }
        let next = barTab(forPage: now, tasksTab: tasksTab)
        return next == selected ? nil : next
    }

    static func answer(_ result: Any?, error: Error?) -> DoorAnswer {
        guard error == nil else { return .absent }
        switch result as? String {
        case "opened": return .opened
        case "refused": return .refused
        case "absent": return .noDoor
        default: return .absent
        }
    }

    // The tab whose section a board address opens (?tab=), so a build that starts on an address lights the right tab.
    // The board's home, an agent's chat and anything unknown are Today.
    static func tab(forBoardURL url: URL?) -> Tab {
        let name = url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }?
            .queryItems?.first(where: { $0.name == "tab" })?.value
        guard let name = name else { return .today }
        return Tab.allCases.first { $0 != .today && $0.boardName == name } ?? .today
    }

    // Marks every page the app loads, at document start, so the board hides its own navigation (part c). A script at
    // document start can run before <html> exists, so it waits for the root when there is none yet.
    static let markScript = """
    (function () {
      function mark() { document.documentElement.classList.add('kapptabs'); }
      if (document.documentElement) { mark(); return; }
      new MutationObserver(function (m, o) {
        if (document.documentElement) { o.disconnect(); mark(); }
      }).observe(document, { childList: true });
    })();
    """

    // The board keeps the Tasks flag from its status poll in localStorage (web/index.html tskTabGate), per Mac.
    static let tasksReadScript = "(function () { try { return localStorage.getItem('kosmos.tasksTab'); } catch (e) { return null; } })()"

    // "1" and "0" are the board's answer; anything else (the sign-in page, an older board, no storage) says nothing.
    static func tasksTab(fromPage result: Any?) -> Bool? {
        switch result as? String {
        case "1": return true
        case "0": return false
        default: return nil
        }
    }

    // The app's own memory of the flag, so a launch shows the bar it last had.
    static let rememberedTasksKey = "kosmos.app.tasksTab"
}

// The bookkeeping behind the app's presses and its Tasks reads (kosmos#6846), apart from WebKit so LogicTests can
// drive it. BoardWeb (ContentView.swift) only carries out what this says.
struct PressTracker {
    // The press the page has not yet taken (no page yet, still loading, or a page without the door, such as the
    // sign-in page before the hand-off to the Mac). Tried again at every load until the door opens the section or
    // refuses; a new press, the native tab, or a page the app loads itself (an agent tap) replaces it.
    private(set) var pending: AppTabs.Tab?
    // Whether the latest press's script is running (sent, no answer yet). Only then does the bar not follow the page:
    // a press waiting for a load does not hold the bar, since the page can move many times before that load.
    private(set) var running = false
    // Every press, every page the app loads itself and every drop take a new number; an answer counts only for the
    // latest, so a late answer to an earlier press can neither end nor move anything newer.
    private(set) var serial = 0
    // Moves on only when a lock drops the page, so reads of the dropped page are ignored.
    private(set) var generation = 0
    // Moves on with each round of Tasks reads, so only the latest round runs (they do not stack).
    private(set) var readRound = 0
    // Whether the latest round is a launch's (it ends at the first answer) or a return's (it reads at each of its
    // times, since its first reads can be the board's flag from before the board's next poll).
    private(set) var readRoundIsLaunch = true
    // Whether a Tasks read of this launch has answered; until then a read may change the bar.
    private(set) var readThisLaunch = false
    // Whether a launch round has had an answer at all (a "0" too). Its round reads on to its end, but later loads
    // start no new launch round: the bar changes only at launch or on a return (Mona Lisa), not at every load.
    private(set) var launchAnswered = false
    // The host the launch's reads are for. The flag is per Mac, so a load on another host (the person switched
    // computers in the page) starts the launch's reads again.
    private(set) var launchHost: String?

    // What BoardWeb sees of its page when a press comes: no web view yet (a signed-in launch opens on Agents, and a
    // web tab's host is made only when first shown), one still loading, or one that can take the press.
    enum Page { case noView, loading, ready }

    // A press: the script to run now and the number its answer must carry, or nil when there is nothing to run now
    // (the native tab, which also ends a waiting press; or a page not ready, when the press waits for its load).
    // `section`: press the board's own section for a native tab on purpose (#7010, the Settings tab's row to the
    // board's Settings); the bar is on Today by then.
    mutating func press(_ tab: AppTabs.Tab, page: Page, section: Bool = false) -> (script: String, serial: Int)? {
        serial += 1
        guard section || !AppTabs.isNative(tab), let script = AppTabs.pressScript(tab) else { pending = nil; running = false; return nil }
        pending = tab
        running = page == .ready
        return running ? (script, serial) : nil
    }

    // An answer to the press numbered `serial`: where the bar goes, or nil. An opened press puts the bar on the tab
    // pressed, since the bar may have moved meanwhile (following the page while the press waited for a load). The
    // tab can be one the bar does not offer (a refusal on a hidden Tasks section): the caller lights barTab for it.
    mutating func answered(serial: Int, _ answer: AppTabs.DoorAnswer, pageURL: URL?) -> AppTabs.Tab? {
        guard serial == self.serial else { return nil }
        running = false
        let pressed = pending
        let next = AppTabs.afterAnswer(answer, pageURL: pageURL)
        if next.over { pending = nil }
        return answer == .opened ? pressed : next.barTo
    }

    // The app is loading a page of its own choosing (an agent tap, a notification): no earlier press may cover it,
    // and no answer to one may move the bar.
    mutating func loadingOwnPage() {
        serial += 1
        running = false
        pending = nil
    }

    // A launch's reads: every 2 s for 20 s from the load, ending at the first answer (on a fresh install the board
    // writes its flag only when its first status poll answers, after the page has loaded).
    static let launchReads = Array(stride(from: 0.0, through: 20.0, by: 2.0))
    // A return's reads: after the board's polls (every 5 s) have had time to write the flag again, each applied.
    static let returnReads = [6.0, 12.0, 18.0]

    // A page finished loading: a launch round of Tasks reads starts if none has answered this launch (its number, or
    // nil).
    mutating func loaded(host: String? = nil) -> Int? {
        if let host = host, host != launchHost {
            if launchHost != nil { readThisLaunch = false; launchAnswered = false }
            launchHost = host
        }
        guard !readThisLaunch && !launchAnswered else { return nil }
        readRound += 1
        readRoundIsLaunch = true
        return readRound
    }

    // The app came back to the front: a return round of reads starts.
    mutating func returned() -> Int {
        readRound += 1
        readRoundIsLaunch = false
        return readRound
    }

    // Whether a read scheduled in `round` for `generation` should still run.
    func shouldRead(round: Int, generation: Int) -> Bool {
        generation == self.generation && round == readRound && !(readRoundIsLaunch && readThisLaunch)
    }

    // A read's answer: the value to put in the bar, or nil to leave it. In a launch's round only a "1" ends the round:
    // a "0" can be last session's flag, read before the board's first poll writes it again, so the round reads on to
    // its end and the last answer stands. Once shown, Tasks stays (#3559), so a "1" is never stale in that direction.
    mutating func read(_ shown: Bool?, generation: Int) -> Bool? {
        guard generation == self.generation, let shown = shown else { return nil }
        if shown || !readRoundIsLaunch { readThisLaunch = true }
        if readRoundIsLaunch { launchAnswered = true }
        return shown
    }

    // The page was dropped (a lock): the fresh page opens the selected tab's section and may set Tasks, as at launch.
    mutating func drop(selected: AppTabs.Tab) {
        serial += 1
        running = false
        generation += 1
        pending = AppTabs.isNative(selected) || AppTabs.pressScript(selected) == nil ? nil : selected
        readThisLaunch = false
        launchAnswered = false
        launchHost = nil
    }
}
