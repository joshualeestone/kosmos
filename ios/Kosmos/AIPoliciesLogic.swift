import Foundation

// kosmos#8959 slice D1b2: the computer's AI policies, native on the phone. UIKit-free, so
// ios/LogicTests/run-aipolicies.sh runs it on a Mac.
//
// The board's own routes (server.js GET and POST /api/policy, POST /api/policy/rename, POST /api/policy/remove; engine
// policy.js), with the computer's sign-in the app keeps for it (Settings.keptMac), and the board page's words
// (web/index.html s-sec-policy, paintPolicy, polCompanyCard, polCard, polFrom, polSaid, polSubmit, polConfirm). None of
// the routes is gated for a remote session (measured on the card). A policy "from a link" is fetched by the computer.
enum AIPolicies {
    enum Words {
        static let title = "AI policies"
        static let hint = "If your company has rules for how AI gets used, put them here and every agent on this computer will follow them. Keep as many as you have, say one from Legal and one from Engineering; every agent gets all of them."
        static let none = "No policies here yet."
        static let leadOne = "Every agent gets it; each one starts following it at its next restart."
        static let leadMany = "Every agent gets all of these; each one starts following them at its next restart."
        static let companyOnly = "Every agent gets your company's policy below; each one starts following it at its next restart."
        static let companyFrom = "Set by your company in its Kosmos policy. Only your company can change or remove it."
        static let unreadDefault = "we could not read the saved policies"
        static let listFailed = "We could not reach Kosmos to check for policies."
        static let rename = "Rename"
        static let replace = "Replace its words"
        static let remove = "Remove"
        static let removeArmed = "Remove it for good?"
        static let keep = "Keep"
        static let leave = "Leave it"
        static let nameFirst = "Give it a name first."
        static let linkFirst = "Paste the link first."
        static let textFirst = "Paste the policy first."
        static let addLabel = "Add a policy"
        static let addHint = "Name it for whoever it comes from. Then paste a link to it, or paste the policy itself."
        static let replaceHint = "Paste a link to the new version, or paste the new words. The name stays."
        static let namePlaceholder = "Legal"
        static let linkLabel = "From a link"
        static let linkHint = "We fetch the page and hand its words to your agents. Your agents never visit the site themselves."
        static let linkPlaceholder = "https://yourcompany.com/ai-policy"
        static let fetch = "Fetch it"
        static let pasteLabel = "Or paste it"
        static let pastePlaceholder = "Paste the policy here."
        static let save = "Hand it to every agent"
        static let saveReplace = "Replace it for every agent"
        static let cancelReplace = "Keep the old words"
        static let confirmSmall = "It goes into the instructions of every agent on this computer. Nothing restarts and nothing is interrupted; each agent starts following it after its own next restart."
        static let confirmNo = "Not yet"
        static let confirmGo = "Hand it out"
        static let saveFailed = "We could not reach Kosmos to save it."
        static let renameFailed = "We could not reach Kosmos to rename it."
        static let removeFailed = "We could not reach Kosmos to remove it."
        static let saveRefusedDefault = "we could not save that"
        static let renameRefusedDefault = "we could not rename it"
        static let removeRefusedDefault = "we could not remove it"
        static let fetching = "Fetching the page…"
        static let saving = "Saving…"
        static let renaming = "Renaming…"
        static let removing = "Removing…"
    }

    // The page's own limits (web/index.html pol-name maxlength 60, pol-url 2000, pol-text 16384; the rename field 60).
    static let nameMax = 60
    static let linkMax = 2000
    static let textMax = 16384

    // MARK: What the computer says

    struct Policy: Equatable, Identifiable {
        let id: String
        let name: String
        let source: String
        let savedAt: Date?
        let chars: Int
        let opening: String
    }
    struct Company: Equatable { let name: String; let chars: Int; let opening: String; let family: Bool }

    enum Read: Equatable {
        case saved([Policy], company: Company?)
        case none(company: Company?)            // nothing saved here (state "none")
        case unread(String, company: Company?)  // state "unknown": the computer's own sentence
        case failed(String)                     // no answer from the computer
    }

    private static func text(_ v: Any?) -> String? {
        guard let s = v as? String, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return s
    }
    private static func int(_ v: Any?) -> Int { (v as? NSNumber)?.intValue ?? 0 }

    static func date(_ s: String?) -> Date? {
        guard let s else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    // As the page's paintPolicy: the company only when it has a name; a policy only with an id and a name.
    static func read(status: Int, data: Data) -> Read {
        if status == 401 || status == 403 { return .failed(Board.phoneShutOut) }
        guard status == 200, let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .failed(Words.listFailed) }
        var company: Company?
        if let c = o["company"] as? [String: Any], let name = c["name"] as? String {
            company = Company(name: name, chars: int(c["chars"]), opening: (c["opening"] as? String) ?? "", family: (c["kind"] as? String) == "family")
        }
        let state = o["state"] as? String
        if state != "saved" {
            if state == "unknown" { return .unread(Settings.sentence(text(o["because"]) ?? Words.unreadDefault), company: company) }
            return .none(company: company)
        }
        let list = (o["policies"] as? [[String: Any]] ?? []).compactMap { p -> Policy? in
            guard let id = text(p["id"]), let name = p["name"] as? String else { return nil }
            return Policy(id: id, name: name, source: (p["source"] as? String) ?? "pasted", savedAt: date(p["savedAt"] as? String),
                          chars: int(p["chars"]), opening: (p["opening"] as? String) ?? "")
        }
        return .saved(list, company: company)
    }

    // The page's plusOrgIn: on a family's Kosmos, "your company" reads "your family" (and its company's, its family's).
    static func orgWords(_ s: String, family: Bool) -> String {
        guard family else { return s }
        var t = s.replacingOccurrences(of: "your company", with: "your family").replacingOccurrences(of: "Your company", with: "Your family")
        t = t.replacingOccurrences(of: "its company's", with: "its family's")
        return t
    }

    // The line above the list, as the page's.
    static func lead(_ r: Read) -> String? {
        switch r {
        case .saved(let list, let company):
            return list.count + (company == nil ? 0 : 1) == 1 ? Words.leadOne : Words.leadMany
        case .none(let company):
            return company.map { orgWords(Words.companyOnly, family: $0.family) } ?? Words.none
        case .unread(let why, _): return why
        case .failed: return nil
        }
    }

    // The page's polFrom: "Pasted" or "From <link>", then ", updated <date>" when it has one, with a full stop.
    static func from(_ p: Policy, dateStyle: (Date) -> String) -> String {
        let from = p.source == "pasted" ? "Pasted" : "From " + p.source
        return from + (p.savedAt.map { ", updated " + dateStyle($0) } ?? "") + "."
    }

    // The first 240 characters the computer sent, with … when there is more (as the page's polopen).
    static func opening(_ text: String, chars: Int) -> String { text + (chars > 240 ? "…" : "") }

    // MARK: Requests

    // A POST's body and headers, on a request whose route its caller wrote out on its own line.
    private static func post(_ r: inout URLRequest, _ mac: Settings.Mac, _ body: [String: String]) -> Bool {
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return false }
        sign(&r, mac)
        r.httpBody = data
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return true
    }
    private static func sign(_ r: inout URLRequest, _ mac: Settings.Mac) {
        r.cachePolicy = .reloadIgnoringLocalCacheData
        r.timeoutInterval = 30   // a link is fetched by the computer before it answers
        r.httpShouldHandleCookies = false
        r.setValue("\(Board.macCookieName)=\(mac.cookie)", forHTTPHeaderField: "Cookie")
        r.setValue("same-origin", forHTTPHeaderField: Board.fetchSiteHeader)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
    }

    // Each request's route on its own line, so server.ios-routes-6838.test.js can read it.
    static func listRequest(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/policy", relativeTo: mac.url)!.absoluteURL)
        sign(&r, mac)
        r.timeoutInterval = 15
        return r
    }

    // What the add form sends, as the page's polBody: an id replaces that policy's words, a name adds a new one; then
    // the link or the words. The page refuses, in its words, before sending anything (polNamed and the two checks).
    enum Source: Equatable { case link(String), words(String) }
    enum Form: Equatable { case ready([String: String]), refused(String) }
    static func form(replacing id: String?, name: String, source: Source) -> Form {
        var body: [String: String] = [:]
        if let id { body["id"] = id } else {
            let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
            if n.isEmpty { return .refused(Words.nameFirst) }
            body["name"] = n
        }
        switch source {
        case .link(let u):
            let t = u.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.isEmpty { return .refused(Words.linkFirst) }
            body["url"] = t
        case .words(let w):
            if w.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .refused(Words.textFirst) }
            body["text"] = w
        }
        return .ready(body)
    }
    static func saveRequest(_ mac: Settings.Mac, _ body: [String: String]) -> URLRequest? {
        var r = URLRequest(url: URL(string: "/api/policy", relativeTo: mac.url)!.absoluteURL); r.httpMethod = "POST"
        return post(&r, mac, body) ? r : nil
    }
    static func renameRequest(_ mac: Settings.Mac, id: String, name: String) -> URLRequest? {
        var r = URLRequest(url: URL(string: "/api/policy/rename", relativeTo: mac.url)!.absoluteURL); r.httpMethod = "POST"
        return post(&r, mac, ["id": id, "name": name]) ? r : nil
    }
    static func removeRequest(_ mac: Settings.Mac, id: String) -> URLRequest? {
        var r = URLRequest(url: URL(string: "/api/policy/remove", relativeTo: mac.url)!.absoluteURL); r.httpMethod = "POST"
        return post(&r, mac, ["id": id]) ? r : nil
    }

    // The confirm's title, as the page's polConfirm, with the policy's name in curly quotes.
    static func confirmTitle(name: String, replacing: Bool) -> String {
        let who = "“" + name + "”"
        return replacing ? "Replace the words of " + who + " for every agent?" : "Hand " + who + " to every agent?"
    }

    // MARK: After a change

    enum Did: String { case handed, replaced, renamed, removed }
    struct Told: Equatable { let agent: String?; let told: Bool; let because: String?; let shownAs: String? }

    static func told(_ data: Data) -> [Told] {
        let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        return (o?["told"] as? [[String: Any]] ?? []).map { t in
            Told(agent: t["agent"] as? String, told: (t["state"] as? String) == "told", because: t["because"] as? String, shownAs: t["shownAs"] as? String)
        }
    }

    // The page's polSaid, sentence for sentence: who was told, and who was not yet and why.
    static func said(_ told: [Told], did: Did) -> String {
        let misses = told.filter { !$0.told }
        let lead = ["handed": "Saved", "replaced": "Replaced", "renamed": "Renamed", "removed": "Removed"][did.rawValue] ?? "Saved"
        if told.isEmpty {
            switch did {
            case .removed: return "Removed. No agents are running, so there was nothing to take back."
            case .renamed: return "Renamed."
            case .replaced: return "Replaced. No agents are running yet; each one gets the new words when it exists."
            case .handed: return "Saved. No agents are running yet; each one gets it when it exists."
            }
        }
        if misses.isEmpty {
            switch did {
            case .handed: return "Handed to every agent. Each one starts following it at its next restart."
            case .replaced: return "Replaced for every agent. Each one starts following the new words at its next restart."
            case .renamed: return "Renamed. Each agent sees the new name at its next restart."
            case .removed: return "Removed. Each agent lets go of it at its next restart."
            }
        }
        let who = misses.map { m in (m.shownAs ?? m.agent ?? "one agent") + " (" + Settings.sentence(m.because ?? "could not be told") + ")" }
            .joined(separator: "; ")
        let have = told.count - misses.count
        let verb = did == .removed ? "let go of it" : (did == .renamed ? "have the new name" : "have it")
        return lead + ". \(have) of \(told.count) agents " + verb + ". Not yet: " + who
    }

    // A change's answer: done with its sentence, or the computer's own reason (its `error`), or the page's words.
    enum Done: Equatable { case done(String), refused(String) }
    static func done(_ did: Did, status: Int, data: Data) -> Done {
        if status == 401 || status == 403 { return .refused(Board.phoneShutOut) }
        let failed = did == .renamed ? Words.renameFailed : (did == .removed ? Words.removeFailed : Words.saveFailed)
        let refusedDefault = did == .renamed ? Words.renameRefusedDefault : (did == .removed ? Words.removeRefusedDefault : Words.saveRefusedDefault)
        // As the page: res.json() throws on an answer that is not JSON, which is its could-not-reach line.
        guard status != 0, let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .refused(failed) }
        if (200...299).contains(status) { return .done(said(told(data), did: did)) }
        return .refused(Settings.sentence(text(o["error"]) ?? refusedDefault))
    }

    // A sample build's computer (KOSMOS_SAMPLE_AGENTS, Debug only), in the route's own shape, for screenshots.
    static let sampleRead = #"{"state":"saved","policies":[{"id":"p1","name":"Legal","source":"pasted","savedAt":"2026-11-20T15:00:00.000Z","chars":180,"opening":"Never put client names, account numbers or anything under NDA into a prompt. Ask before using an AI tool on a contract."},{"id":"p2","name":"Engineering","source":"https://example.com/ai-policy","savedAt":"2026-11-22T09:30:00.000Z","chars":620,"opening":"Every change an agent makes goes through review before it reaches main. Agents never push to production, never rotate keys and never read a customer's data without a ticket that says so, and they say in the pull request which"}],"because":null,"company":null}"#
}
