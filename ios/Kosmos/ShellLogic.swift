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
    enum Tab: CaseIterable, Equatable {
        case today, agents, projects, tasks, settings

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
    static func keep(_ selected: Tab, tasksTab: Bool) -> Tab {
        visible(tasksTab: tasksTab).contains(selected) ? selected : .today
    }

    // The call the app makes for a press. The door is absent on the sign-in page, an error page or an older board, so
    // the typeof test answers false there rather than throwing.
    static func pressScript(_ tab: Tab) -> String? {
        guard let name = tab.boardName else { return nil }
        return "typeof window.kosmosAppTab === 'function' && window.kosmosAppTab('\(name)')"
    }

    // Opened only on a real true. false, nothing, any other value and an error all mean the section did not open.
    static func opened(_ result: Any?, error: Error?) -> Bool {
        guard error == nil, let value = result as? Bool else { return false }
        return value
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
