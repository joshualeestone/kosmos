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
            case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost,
                 NSURLErrorDataNotAllowed, NSURLErrorInternationalRoamingOff,
                 NSURLErrorCallIsActive:
                return .offline
            case NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorTimedOut,
                 NSURLErrorDNSLookupFailed, NSURLErrorSecureConnectionFailed,
                 NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate,
                 NSURLErrorServerCertificateNotYetValid, NSURLErrorServerCertificateHasUnknownRoot,
                 NSURLErrorBadServerResponse:
                return .unreachable
            default:
                return .other
            }
        }
        // WebKitErrorDomain 102: frame load interrupted by a policy change.
        if domain == "WebKitErrorDomain" && code == 102 { return nil }
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

    // Decides a MAIN-FRAME navigation or a request for a new window (a link with
    // target=_blank, which a WKWebView otherwise silently drops). Subframe loads
    // never come here. Kosmos+ itself and the person's Macs stay in the app; any
    // other web page (Stripe's billing page, a help link) opens in Safari, so the
    // app never becomes a browser for someone else's site; mail, phone and text
    // links go to their apps; any other scheme (javascript:, file:, data:, custom
    // app schemes) is refused.
    static func linkDecision(for url: URL, coordinator: URL) -> LinkDecision {
        let scheme = url.scheme?.lowercased() ?? ""
        switch scheme {
        case "https", "http":
            guard let host = url.host?.lowercased(), !host.isEmpty else { return .block }
            if scheme == "https",
               host == coordinator.host?.lowercased() || PushBridge.isMacHost(host, coordinator: coordinator) {
                return .inApp
            }
            return .external
        case "mailto", "tel", "sms":
            return .external
        case "about":
            return url.absoluteString == "about:blank" ? .inApp : .block
        default:
            return .block
        }
    }
}
