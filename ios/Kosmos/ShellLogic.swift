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
        // The phone is online but Kosmos+ (or a Mac) did not answer.
        case unreachable
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
