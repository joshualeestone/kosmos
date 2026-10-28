import Foundation

// kosmos#7389 (the iOS half of #5167): what the iPhone app does with a file the board hands over as a download (an
// attachment's Download, #4930; a file in a Files list, #5165). The rules are the Mac app's (native-app/main.swift, the
// #5167 blocks), the words Mona Lisa's design on the card. The app's web view only carries them out (ContentView.swift).
enum Download {
    // The Mac's words where the case is the same, so the two apps never disagree; "couldNotGet" is the phone's own.
    static let notFromThisBoard = "That file is not from this board, so it was not saved."
    static let fromElsewhere = "The file came from somewhere Kosmos does not save from, so it was not saved."
    static let notABoard = "This page is not a board Kosmos saves files from, so the file was not saved."
    // A response the window cannot show and that is not an attachment (the Mac's wording for that case).
    static let notOpenedElsewhere = "That file came from somewhere Kosmos does not save from, so it was not opened or saved."
    static let notOpenedNotABoard = "This page is not a board Kosmos saves files from, so the file was not opened or saved."
    // A download that redirected somewhere else (the Mac's words for it).
    static let redirectedElsewhere = "The file pointed somewhere Kosmos does not save from, so it was not saved."
    static let couldNotGet = "Kosmos could not get that file. Try again in a moment."
    // WebKit stopped a download itself before it had anywhere to go (the Mac measured it for a redirect elsewhere).
    static let stoppedBeforeItBegan = "it stopped before it began"
    static let failedLead = "The file could not be downloaded ("
    static func failed(_ reason: String) -> String { failedLead + reason + ")." }
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
                               coordinator: URL) -> ResponseDecision {
        let wanted = attachment || !canShow
        guard wanted else { return .show }
        if status == 204 || status == 205 { return .show }   // nothing to save; WebKit leaves the page as it is
        guard page != nil else { return .refuse(nil) }   // no page yet: the app's own load, not a file anyone asked for
        let board = isBoardPage(page, coordinator: coordinator)
        // An attachment is refused as not saved; a file the window cannot show, as not opened or saved (the Mac's words).
        guard board else { return .refuse(attachment ? notABoard : notOpenedNotABoard) }
        guard let target, isSameOrigin(target, page: page) else { return .refuse(attachment ? fromElsewhere : notOpenedElsewhere) }
        // What arrives is judged again at its destination (decideDestination): the status, and a web page for a file.
        return .save
    }

    /// The board's Files routes say a refused or signed-out answer on the page themselves (their look), so the app does
    /// not say it twice. The Mac's pageSaysDownloadRefusal: /api/agent/<name>/files/download, /api/project/<id>/file-download.
    static func pageSaysRefusal(_ url: URL?) -> Bool {
        let path = url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.percentEncodedPath } ?? ""
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        // download-folder (#6724) says its refusals on the page too; the Mac's list misses it.
        if parts.count == 6, parts[1] == "api", parts[2] == "agent", !parts[3].isEmpty, parts[4] == "files",
           parts[5] == "download" || parts[5] == "download-folder" { return true }
        if parts.count == 5, parts[1] == "api", parts[2] == "project", !parts[3].isEmpty, parts[4] == "file-download" { return true }
        return false
    }

    /// What arrives for a download, judged before anything is kept (every board download comes here: `<a download>`
    /// never reaches the response policy). The Mac's decideDestinationUsing: a 204 or 205 is nothing (the board's page
    /// says why it refused), an error is never kept as the file, and a web page where a file was expected (a signed-out
    /// computer answers with its sign-in page) is refused; a web page sent AS an attachment is the file. Said only
    /// where the page does not say it itself.
    enum Destination: Equatable { case keep, drop(String?) }
    static func decideDestination(status: Int?, mimeType: String?, attachment: Bool, url: URL?) -> Destination {
        let quietIfPageSays: String? = pageSaysRefusal(url) ? nil : couldNotGet
        if let status, status == 204 || status == 205 { return .drop(nil) }
        if let status, !(200...299).contains(status) { return .drop(quietIfPageSays) }
        if (mimeType ?? "").lowercased().hasPrefix("text/html"), !attachment { return .drop(quietIfPageSays) }
        return .keep
    }

    /// The name the file is shared under: the answer's own name, made safe for a file (no path, no leading dot), or
    /// "download" when it has none.
    static func fileName(_ suggested: String?) -> String {
        // No control or format characters (a right-to-left override would make "gpj.exe" read as an image).
        let clean = String(String.UnicodeScalarView((suggested ?? "").unicodeScalars.filter {
            $0.properties.generalCategory != .control && $0.properties.generalCategory != .format
                && $0.properties.generalCategory != .lineSeparator && $0.properties.generalCategory != .paragraphSeparator
        }))
        let raw = clean.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: "\\", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var name = String(raw.drop(while: { $0 == "." }))
        if name.count > 120 { name = String(String(name.suffix(120)).drop(while: { $0 == "." })) }   // the cut must not start on a dot
        return name.isEmpty ? "download" : name
    }

    /// The Mac's guard (native-app/main.swift refusalShouldShow, kosmos PR #7384), so a page cannot pile messages up: none
    /// while one is on screen, none within `repeatSeconds` of the last refusal of any kind (keyed on time, not on the
    /// sentence: a page alternating two refusals would otherwise trap the person), and each sentence at most `perPage`
    /// times on one page.
    static let repeatSeconds: TimeInterval = 10
    static let perPage = 2
    /// The app asks this only for a refusal; a failure is always said, in its turn (the Coordinator's queue).
    static func shouldSay(up: Bool, refusal: Bool, lastAt: Date?, now: Date, shownThisPage: Int) -> Bool {
        if up { return false }
        if !refusal { return true }
        if shownThisPage >= perPage { return false }
        if let lastAt, now.timeIntervalSince(lastAt) < repeatSeconds { return false }
        return true
    }
}
