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

    // kosmos#7197 (Josh, 10-26 08:29, with two Macs): a Mac that is not answering is named, so the person knows which
    // one to wake. The name is the Mac's address label (the first part of its host), as Kosmos+ lists it; with no
    // name the wording is the old "Your Mac".
    static func macName(fromHost host: String?) -> String? {
        guard let first = host?.split(separator: ".").first, !first.isEmpty else { return nil }
        return String(first)
    }

    static func macUnreachableTitle(_ name: String?) -> String {
        guard let n = name?.trimmingCharacters(in: .whitespaces), !n.isEmpty else { return "Your Mac isn't answering" }
        return "\(n) isn't answering"
    }

    // The line over a list that is no longer updating.
    static func notUpdatingLine(_ name: String?) -> String {
        "Not updating. " + macUnreachableTitle(name) + "."
    }

    // kosmos#7416 slice 2 (Mona Lisa's words, as the board says them): never a claim the Mac is asleep, since from the
    // phone asleep, off and offline look the same, then when it was last heard from (Board.lastHeard), when known.
    static func macUnreachableMessage(_ name: String?, lastSeen: Double? = nil, now: Date = Date(),
                                      calendar: Calendar = .current, locale: Locale = .current) -> String {
        let n = name?.trimmingCharacters(in: .whitespaces) ?? ""
        let who = n.isEmpty ? "your Mac" : "the Mac called \(n)"
        let heard = lastHeardSentence(lastSeen, now: now, calendar: calendar, locale: locale).map { " " + $0 } ?? ""
        return "Your phone is online, but \(who) didn't reply. It may be asleep, off or offline.\(heard) Wake it, then try again."
    }

    // kosmos#7416 slice 2: "We last heard from it ..." in the person's own clock and words, the board's
    // lastHeardSentence (web/index.html). nil when there is no time (see heardWhen).
    static func lastHeardSentence(_ lastSeen: Double?, now: Date = Date(),
                                  calendar: Calendar = .current, locale: Locale = .current) -> String? {
        heardWhen(lastSeen, now: now, calendar: calendar, locale: locale).map { "We last heard from it \($0)." }
    }

    // When a computer was last heard from, as the end of a sentence (Mona Lisa's words): "at 8:12 PM" today,
    // "yesterday at 8:12 PM", "on Tuesday at 8:12 PM" within the week, "on Oct 21" before that. `lastSeen` is unix
    // seconds, in the app the later of Kosmos+'s last_seen and the app's own last good read (Board.lastHeard). nil when
    // there is none (0: never seen) and for a time more than clockAllowance ahead of now (Board.lastHeard already drops
    // such a last_seen; this is the same rule for any other caller). One function for the message and the switcher.
    // How far ahead of this phone's clock a time may be and still be taken as now (the board's 60 s too).
    static let clockAllowance: Double = 60

    static func heardWhen(_ lastSeen: Double?, now: Date = Date(),
                          calendar: Calendar = .current, locale: Locale = .current) -> String? {
        guard let s = lastSeen, s.isFinite, s > 0 else { return nil }
        let t = Date(timeIntervalSince1970: s)
        guard t.timeIntervalSince(now) <= clockAllowance else { return nil }
        func words(_ template: String) -> String {
            let f = DateFormatter()
            f.locale = locale
            f.calendar = calendar
            f.timeZone = calendar.timeZone
            f.setLocalizedDateFormatFromTemplate(template)
            return f.string(from: t)
        }
        let clock = words("jmm")
        // Calendar days, so a clock change is not a day.
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: t), to: calendar.startOfDay(for: now)).day ?? 0
        if days <= 0 { return "at \(clock)" }
        if days == 1 { return "yesterday at \(clock)" }
        if days < 7 { return "on \(words("EEEE")) at \(clock)" }
        return "on \(words("MMMd"))"
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

        // Mona Lisa's slice 1 spec. kosmos#7266 (Josh, 10-26): a briefcase for Projects; Agents draws `asset` instead.
        var symbol: String {
            switch self {
            case .today: return "sun.max"
            case .agents: return "person.2"
            case .projects: return "briefcase"
            case .tasks: return "checklist"
            case .settings: return "gearshape"
            }
        }

        // kosmos#7266: the bar's own drawing where it is not an SF Symbol. Agents: Font Awesome Free's user-tie
        // (CC BY 4.0, credited on the Settings page), Assets.xcassets/TabAgent.
        var asset: String? { self == .agents ? "TabAgent" : nil }

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

    // kosmos#7252 (Josh, 2026-10-26 16:18: "i think we kill the 'today' tab for now.. it seems to be overkill and
    // redundant"): off, the bar has no Today and a signed-in launch opens on Agents. A switch, not a deletion (#7030's
    // native Today stays, "for now"). The board pages the app used to show under Today open over the tabs instead
    // (ContentView's board page), so `.today` still names that page in barTab and keep.
    #if KOSMOS_STORE_SHOTS
    static let todayTab = true   // the App Store screenshot build photographs board screens under Today, as before
    #else
    static let todayTab = false
    #endif

    // In Mona Lisa's order. Tasks is earned, as on the computer (#3559): the bar shows it only once the board says so.
    // kosmos#7266 (Josh, 10-26: "four tabs only, like the desktop app"): with Today gone the bar is always Agents,
    // Projects, Tasks, Settings; the earned Tasks applies only to the old five-tab bar (the screenshot build).
    static func visible(tasksTab: Bool, todayTab: Bool = AppTabs.todayTab) -> [Tab] {
        Tab.allCases.filter { ($0 != .tasks || tasksTab || !todayTab) && ($0 != .today || todayTab) }
    }

    // kosmos#7266: the + on Agents and on Projects open the board's own create form (the phone cannot make either
    // natively yet): the board's door takes these names as well as its sections.
    enum Create: String { case agent = "new-agent", project = "new-project" }

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
    // kosmos#7032: Projects too (the native list and a project's room). kosmos#7031: Tasks too.
    static func isNative(_ tab: Tab) -> Bool {
        tab == .agents || tab == .settings || tab == .today || tab == .projects || tab == .tasks
    }

    // kosmos#7032: with Projects native, the board's own project pages (a room's info button, a link into a project) and
    // a Tasks section the bar does not offer show under Today, as the board's Settings does: lighting Projects would put
    // the native list over the very page the person was sent to. kosmos#7031: with Tasks native as well, the board's own
    // Tasks section (a project's View all, a board link) shows under Today too, whether or not the bar offers Tasks.
    static func barTab(forPage section: Tab, tasksTab: Bool) -> Tab {
        if section == .settings || section == .projects || section == .tasks { return .today }
        // `.today` here is the board page, whether it shows under the Today tab or over the tabs (kosmos#7252).
        return section == .today || visible(tasksTab: tasksTab).contains(section) ? section : .today
    }

    // kosmos#7252: with Today off, a tab leaving the bar goes to Agents, the tab a launch opens on.
    static func keep(_ selected: Tab, tasksTab: Bool, todayTab: Bool = AppTabs.todayTab) -> Tab {
        visible(tasksTab: tasksTab, todayTab: todayTab).contains(selected) ? selected : (todayTab ? .today : .agents)
    }

    // The call the app makes for a press. It tells apart a page without the door (the sign-in page, an error page,
    // an older board: the typeof test) from a board that refused (a box or full-screen step is up, where a person
    // could not press either). Only a real true from the door is "opened"; a door that throws counts as refused, so a
    // broken press ends instead of waiting to fire on some later load.
    static func pressScript(_ tab: Tab) -> String? {
        guard let name = tab.boardName else { return nil }
        return pressScript(door: name)
    }

    // The door call for any name it takes: a section, or a create (kosmos#7266). An older board that does not know a
    // create name refuses it, and the press ends with the page on its own section.
    static func pressScript(door name: String) -> String {
        // kosmos#7266 review 2: a create (the + buttons) refused while a box is up or the bar is inert is not an older
        // board's "unknown name": it answers 'covered', which answer() reads as no answer (.absent), so the press waits
        // for the next load like any covered press and never reaches a fallback (which would reload the page under the
        // box). Review 3: not 'absent', which answer() reads as a page without the door (.noDoor) and DOES fall back.
        // The board door's own guards, read here.
        let covered = Create(rawValue: name) == nil ? "" : "var t = document.getElementById('tabs'); if (!t || t.closest('[inert]') || document.querySelector('.rm-back:not([hidden]), .fr-back:not([hidden]), .frc-back:not([hidden])')) return 'covered'; "
        return "(function () { if (typeof window.kosmosAppTab !== 'function') return 'absent'; try { if (window.kosmosAppTab('\(name)') === true) return 'opened'; \(covered)return 'refused'; } catch (e) { return 'refused'; } })()"
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
    // kosmos#7266 review 1: a + the board turned down (an older board whose door does not know the create names, or a
    // box up) must not leave the person on an unexplained page. A refused project create opens the board's Projects
    // section; a refused agent create loads the board's own create page (?tab=create, a deep link the board has long
    // served). nil when the press opened, still waits, or was not a create.
    // kosmos#7266 review 3 (with the switcher): a + creates on the computer the switcher shows, not on whichever one the
    // shared board page happens to be on. The board to load first, or nil when the page is already on that computer
    // (or no computer is shown yet, as before the switcher).
    static func createTarget(pageURL: URL?, shown: URL?) -> URL? {
        guard let shown, let want = shown.host?.lowercased() else { return nil }
        return pageURL?.host?.lowercased() == want ? nil : shown
    }

    enum CreateFallback: Equatable { case projects, load(URL) }
    static func createFallback(door: String?, _ answer: DoorAnswer, pageURL: URL?) -> CreateFallback? {
        guard let door, answer != .opened, afterAnswer(answer, pageURL: pageURL).over else { return nil }
        if door == Create.project.rawValue { return .projects }
        guard door == Create.agent.rawValue, let url = pageURL, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }
        parts.path = "/"
        parts.query = "tab=create"
        parts.fragment = nil
        return parts.url.map { .load($0) }
    }

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
        // A native tab (Agents, Settings #7010, Projects #7032, Tasks #7031) is not moved by the hidden page.
        guard !barHeld, selected != .agents, selected != .settings, selected != .projects, selected != .tasks,
              let pageURL = pageURL, pageURL.host != signInHost else { return nil }
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

    // kosmos#7032: the engine's own Tasks flag on GET /api/status (`tasksTab`, server.js; the board page's tskTabGate
    // reads the same), so the bar can earn Tasks when no tab hosts the board page. nil when it is not there.
    // kosmos#7032: the Projects tab's badge, /api/status's counts.projectsUnread (unread room posts over every project;
    // the board's own Projects tab count). nil or 0: no badge. Here, beside the Tasks flag, so every suite that builds
    // BoardClient has it.
    static func projectsUnread(fromStatus data: Data) -> Int? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let counts = obj["counts"] as? [String: Any], let n = counts["projectsUnread"] as? Int, n > 0
        else { return nil }
        return n
    }

    static func tasksTab(fromStatus data: Data) -> Bool? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj["tasksTab"] as? Bool
    }
}

// The bookkeeping behind the app's presses and its Tasks reads (kosmos#6846), apart from WebKit so LogicTests can
// drive it. BoardWeb (ContentView.swift) only carries out what this says.
struct PressTracker {
    // The press the page has not yet taken (no page yet, still loading, or a page without the door, such as the
    // sign-in page before the hand-off to the Mac). Tried again at every load until the door opens the section or
    // refuses; a new press, the native tab, or a page the app loads itself (an agent tap) replaces it.
    private(set) var pending: AppTabs.Tab?
    // kosmos#7266: the door name a waiting press uses instead of its tab's section (a create), replayed with it.
    private(set) var pendingDoor: String?
    // kosmos#7266 review 5: the computer a waiting create was meant for (its board was loaded for it), or nil for any page.
    // A load on another host does not replay it, so a create can never land on a computer the switcher did not name.
    private(set) var pendingHost: String?
    // kosmos#7266 review 1: what a finished load replays, the tab and its create name together (ContentView.loaded), so
    // the replay rule is one the tests can reach.
    var replay: (tab: AppTabs.Tab, door: String?, host: String?)? { pending.map { ($0, pendingDoor, pendingHost) } }
    // Review 5: what a load on `host` replays: nothing while the waiting press is for another computer (it keeps waiting).
    func replay(host: String?) -> (tab: AppTabs.Tab, door: String?, host: String?)? {
        guard pendingHost == nil || pendingHost?.lowercased() == host?.lowercased() else { return nil }
        return replay
    }
    // Whether the latest press's script is running (sent, no answer yet). Only then does the bar not follow the page:
    // a press waiting for a load does not hold the bar, since the page can move many times before that load.
    private(set) var running = false
    // Every press, every page the app loads itself and every drop take a new number; an answer counts only for the
    // latest, so a late answer to an earlier press can neither end nor move anything newer.
    private(set) var serial = 0
    // kosmos#7266 review 3: whether an answer is to the newest press (a late one may not act, a fallback included).
    func isCurrent(_ serial: Int) -> Bool { serial == self.serial }
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
    mutating func press(_ tab: AppTabs.Tab, page: Page, section: Bool = false, door: String? = nil, host: String? = nil) -> (script: String, serial: Int)? {
        serial += 1
        guard section || !AppTabs.isNative(tab), let script = door.map({ AppTabs.pressScript(door: $0) }) ?? AppTabs.pressScript(tab)
        else { pending = nil; pendingDoor = nil; pendingHost = nil; running = false; return nil }
        pending = tab
        pendingDoor = door
        pendingHost = host
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
        if next.over { pending = nil; pendingDoor = nil; pendingHost = nil }
        return answer == .opened ? pressed : next.barTo
    }

    // kosmos#7266 review 6: a load of the computer a waiting create was for failed (an offline computer): the create
    // ends there, so it neither holds the bar through later loads nor opens much later on a retry of that board.
    mutating func loadFailed(host: String?) {
        guard let want = pendingHost, want.lowercased() == host?.lowercased() else { return }
        serial += 1
        running = false
        pending = nil
        pendingDoor = nil
        pendingHost = nil
    }

    // The app is loading a page of its own choosing (an agent tap, a notification): no earlier press may cover it,
    // and no answer to one may move the bar.
    mutating func loadingOwnPage() {
        serial += 1
        running = false
        pending = nil
        pendingDoor = nil
        pendingHost = nil
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
        pendingDoor = nil   // review 1 nit: a dropped page drops a waiting create too
        pendingHost = nil
        readThisLaunch = false
        launchAnswered = false
        launchHost = nil
    }
}
