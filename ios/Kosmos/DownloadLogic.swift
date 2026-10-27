import Foundation

// kosmos#7389 (the iOS half of #5167): what the iPhone app does with a file the board hands over as a download (an
// attachment's Download, #4930; a file in a Files list, #5165). The rules are the Mac app's (native-app/main.swift, the
// #5167 blocks), the words Mona Lisa's design on the card. The app's web view only carries them out (ContentView.swift).
enum Download {
    // The Mac's words where the case is the same, so the two apps never disagree; "couldNotGet" is the phone's own.
    static let notFromThisBoard = "That file is not from this board, so it was not saved."
    static let fromElsewhere = "The file came from somewhere Kosmos does not save from, so it was not saved."
    static let notABoard = "This page is not a board Kosmos saves files from, so the file was not saved."
    static let couldNotGet = "Kosmos could not get that file. Try again in a moment."
    static func failed(_ reason: String) -> String { "The file could not be downloaded (\(reason))." }
    static func getting(_ name: String) -> String { "Getting \(name)" }

    /// The names Kosmos+ keeps for itself, so a page under one is a Kosmos+ service, not a board. A COPY of
    /// RESERVED_NAMES in kosmos-relay coordinator/src/signin.rs, as native-app/main.swift kosmosPlusReservedLabels is;
    /// add a name there, add it in both.
    static let reservedLabels: Set<String> = [
        "www", "api", "app", "relay", "coordinator", "admin", "mail", "smtp", "mx", "ns", "ns1", "ns2", "dns",
        "status", "help", "support", "kosmos", "billing", "community", "docs", "forum", "blog", "news", "cdn", "static",
        "assets", "autodiscover", "autoconfig", "login", "log-in", "signin", "sign-in", "signup", "sign-up", "setup",
        "register", "auth", "account", "accounts", "checkout", "pay", "payment", "payments", "secure", "verify",
    ]

    /// Whether the page on screen is a board files may be saved from: a computer's own Kosmos+ address (one label under
    /// the relay domain, https, no user or odd port), never Kosmos+ itself or a name it keeps. The phone has no local
    /// board of its own, so that is the only kind.
    static func isBoardPage(_ page: URL?, coordinator: URL) -> Bool {
        guard let page, page.scheme?.lowercased() == "https", page.user == nil, page.port == nil || page.port == 443,
              let host = page.host?.lowercased(), PushBridge.isMacHost(host, coordinator: coordinator)
        else { return false }
        let label = host.split(separator: ".").first.map(String.init) ?? ""
        return !reservedLabels.contains(label)
    }

    /// The file is from the page's own origin: scheme, host and port all match (a missing port is the scheme's default).
    static func isSameOrigin(_ target: URL, page: URL?) -> Bool {
        guard let page else { return false }
        func origin(_ u: URL) -> (String, String, Int)? {
            guard let scheme = u.scheme?.lowercased(), scheme == "https" || scheme == "http",
                  let host = u.host?.lowercased(), !host.isEmpty, u.user == nil else { return nil }
            return (scheme, host, u.port ?? (scheme == "https" ? 443 : 80))
        }
        guard let a = origin(target), let b = origin(page) else { return false }
        return a == b
    }

    /// What to do with a download the page ASKED for (`<a download>`): save it, or refuse with a sentence.
    enum Decision: Equatable { case save, refuse(String) }
    static func decideAction(target: URL, page: URL?, coordinator: URL) -> Decision {
        guard isBoardPage(page, coordinator: coordinator) else { return .refuse(notABoard) }
        return isSameOrigin(target, page: page) ? .save : .refuse(notFromThisBoard)
    }

    /// What to do with a main-frame answer: show it in the window, save it, or refuse with a sentence (nil sentence: a
    /// refusal nobody asked about, such as the app's own first load, which is not said). `attachment`: the answer's
    /// Content-Disposition is attachment. `canShow`: WebKit can show its type.
    enum ResponseDecision: Equatable { case show, save, refuse(String?) }
    static func decideResponse(status: Int, attachment: Bool, canShow: Bool, target: URL?, page: URL?,
                               coordinator: URL, signInPage: Bool) -> ResponseDecision {
        let wanted = attachment || !canShow
        guard wanted else { return .show }
        // Nothing to save, an error, or the sign-in page where the file should be: never saved as the file.
        if status == 204 || status == 205 { return .show }
        guard page != nil else { return .refuse(nil) }   // no page yet: the app's own load, not a file anyone asked for
        guard isBoardPage(page, coordinator: coordinator) else { return .refuse(notABoard) }
        guard let target, isSameOrigin(target, page: page) else { return .refuse(attachment ? fromElsewhere : notFromThisBoard) }
        guard (200...299).contains(status), !signInPage else { return .refuse(couldNotGet) }
        return .save
    }

    /// The gate's sign-in page served in place of a file (a session that ended): an HTML answer where a file was asked.
    static func looksLikeSignInPage(mimeType: String?) -> Bool {
        (mimeType ?? "").lowercased().hasPrefix("text/html")
    }

    /// The name the file is shared under: the answer's own name, made safe for a file (no path, no leading dot), or
    /// "download" when it has none.
    static func fileName(_ suggested: String?) -> String {
        let raw = (suggested ?? "").replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: "\\", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var name = String(raw.drop(while: { $0 == "." }))
        if name.count > 120 { name = String(name.suffix(120)) }
        return name.isEmpty ? "download" : name
    }

    /// The Mac's guard (native-app/main.swift refusalShouldShow, kosmos PR #7384), so a page cannot pile messages up: none
    /// while one is on screen, none within `repeatSeconds` of the last refusal of any kind (keyed on time, not on the
    /// sentence: a page alternating two refusals would otherwise trap the person), and each sentence at most `perPage`
    /// times on one page.
    static let repeatSeconds: TimeInterval = 10
    static let perPage = 2
    static func shouldSay(up: Bool, lastAt: Date?, now: Date, shownThisPage: Int) -> Bool {
        if up || shownThisPage >= perPage { return false }
        if let lastAt, now.timeIntervalSince(lastAt) < repeatSeconds { return false }
        return true
    }
}
