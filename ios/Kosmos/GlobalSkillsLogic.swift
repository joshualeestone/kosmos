import Foundation

// kosmos#8959 slice D1b1: the computer's Global skills, native on the phone. UIKit-free, so
// ios/LogicTests/run-globalskills.sh runs it on a Mac.
//
// The list, the add and the remove are the board's own routes (server.js GET and POST /api/skills, DELETE
// /api/skills/<key>; engine/skills.js), with the computer's sign-in the app keeps for it (Settings.keptMac), as the
// board's Settings > Global skills uses them (web/index.html s-sec-gskills, loadSkills, wireSkillAdd). None of the three
// is gated for a remote session (measured on the card). A skill's rows are names only, as the page's (Josh 2026-08-23:
// "just have only the header"); the list reads the board's answer the same way the agent screen does (Board.parseSkills).
enum GlobalSkills {
    // The board page's words (web/index.html s-sec-gskills and its script).
    enum Words {
        static let title = "Global skills"
        static let ask = "Ask your agent: “What skills should we install?”"
        static let hint = "Skills every agent on this computer gets, alongside whatever each one has of its own. Agents read them when they start, so anything you add arrives at each agent’s next restart."
        static let none = "No skills here yet."
        static let addLabel = "Add a global skill"
        static let addHint = "Name it, then write what it should do, the way you would brief a person."
        static let namePlaceholder = "How we write emails"
        static let bodyPlaceholder = "Short sentences. Say the ask in the first line. Never more than one question per email."
        static let addButton = "Add skill"
        static let added = "Added. Every agent picks it up at its next restart."
        static let remove = "Remove"
        static let removeArmed = "Remove it for good?"
        static let listFailed = "We could not reach Kosmos to list the skills."
        static let addFailed = "We could not reach Kosmos to add that skill."
        static let removeFailed = "We could not reach Kosmos to remove it."
        static let addRefusedDefault = "we could not add that skill"
        static let removeRefusedDefault = "we could not remove it"
        static let listRefusedDefault = "we could not read the skills folder"
    }

    // The page's own limits on the two fields (web/index.html g-skill-name maxlength 80, g-skill-body 65536).
    static let nameMax = 80
    static let bodyMax = 65536

    // Every request carries the computer's cookie by hand and the board's header, as Settings' own do.
    private static func sign(_ r: inout URLRequest, _ mac: Settings.Mac) {
        r.cachePolicy = .reloadIgnoringLocalCacheData
        r.timeoutInterval = 15
        r.httpShouldHandleCookies = false
        r.setValue("\(Board.macCookieName)=\(mac.cookie)", forHTTPHeaderField: "Cookie")
        r.setValue("same-origin", forHTTPHeaderField: Board.fetchSiteHeader)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
    }

    // Each request with its route written out on its own line, so server.ios-routes-6838.test.js can read it.
    static func listRequest(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/skills", relativeTo: mac.url)!.absoluteURL)
        sign(&r, mac)
        return r
    }

    // nil when there is nothing to send: a blank name or blank words (the engine refuses them; the button waits).
    static func addRequest(_ mac: Settings.Mac, name: String, body: String) -> URLRequest? {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canAdd(name: name, body: body),
              let data = try? JSONSerialization.data(withJSONObject: ["name": n, "body": body], options: [.sortedKeys]) else { return nil }
        var r = URLRequest(url: URL(string: "/api/skills", relativeTo: mac.url)!.absoluteURL)
        r.httpMethod = "POST"
        sign(&r, mac)
        r.httpBody = data
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return r
    }

    static func canAdd(name: String, body: String) -> Bool {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return !n.isEmpty && n.count <= nameMax && !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && body.utf8.count <= bodyMax
    }

    // The key is the board's (engine/skills.js), one path segment, encoded as the page's encodeURIComponent.
    static func removeRequest(_ mac: Settings.Mac, key: String) -> URLRequest? {
        guard !key.isEmpty, let seg = segment(key) else { return nil }
        var r = URLRequest(url: URL(string: "/api/skills/\(seg)", relativeTo: mac.url)!.absoluteURL)
        r.httpMethod = "DELETE"
        sign(&r, mac)
        return r
    }

    // encodeURIComponent's set: letters, digits and - _ . ! ~ * ' ( ) stay; everything else, "/" included, is encoded.
    static func segment(_ key: String) -> String? {
        var allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        allowed.insert(charactersIn: "-_.!~*'()")
        return key.addingPercentEncoding(withAllowedCharacters: allowed)
    }

    // MARK: Answers

    enum ListRead: Equatable { case got([Board.Skill]), failed(String) }

    // The list from GET /api/skills: the skills, names only, in the board's order; or why not. The route's 200
    // {ok:false} is its folder read failing, said in its own `because` (as the page's loadSkills).
    static func list(status: Int, data: Data) -> ListRead {
        if status == 401 || status == 403 { return .failed(Board.phoneShutOut) }
        if status == 200, let skills = Board.parseSkills(data) { return .got(skills) }
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        if status == 200, (obj?["ok"] as? Bool) == false {
            return .failed(Settings.sentence(text(obj?["because"]) ?? Words.listRefusedDefault))
        }
        return .failed(Words.listFailed)
    }

    // A write's answer: done, or the computer's own reason (its `because`), or the page's words when it gave none.
    enum Done: Equatable { case done, refused(String) }

    static func added(status: Int, data: Data) -> Done { done(status, data, refusedDefault: Words.addRefusedDefault, failed: Words.addFailed) }
    static func removed(status: Int, data: Data) -> Done { done(status, data, refusedDefault: Words.removeRefusedDefault, failed: Words.removeFailed) }

    private static func done(_ status: Int, _ data: Data, refusedDefault: String, failed: String) -> Done {
        if status == 401 || status == 403 { return .refused(Board.phoneShutOut) }
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            // No answer, or not the computer's (a gate's page): the page's could-not-reach line.
            return .refused(failed)
        }
        if status == 200 && (obj["ok"] as? Bool) != false { return .done }
        return .refused(Settings.sentence(text(obj["because"]) ?? refusedDefault))
    }

    private static func text(_ v: Any?) -> String? {
        guard let s = v as? String, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return s
    }

    // A sample build's computer (KOSMOS_SAMPLE_AGENTS, Debug only), in the route's own shape, for screenshots.
    static let sampleList = #"{"ok":true,"skills":[{"key":"how-we-write-emails","name":"How we write emails"},{"key":"release-notes","name":"Release notes"}]}"#
}
