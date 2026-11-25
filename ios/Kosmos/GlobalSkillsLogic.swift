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
        // The page's spoken label for an unarmed Remove (its aria-label), the skill's name after it.
        static let removeLabel = "Remove the skill "
        static let listFailed = "We could not reach Kosmos to list the skills."
        static let addFailed = "We could not reach Kosmos to add that skill."
        static let removeFailed = "We could not reach Kosmos to remove it."
        static let addRefusedDefault = "we could not add that skill"
        static let removeRefusedDefault = "we could not remove it"
        static let listRefusedDefault = "we could not read the skills folder"
    }

    // The page's own limits on the two fields (web/index.html g-skill-name maxlength 80, g-skill-body 65536). A browser's
    // maxlength counts UTF-16 units, so these do too (clipped). The engine's own size check stays the engine's: it
    // refuses in its own sentence (review 1).
    static let nameMax = 80
    static let bodyMax = 65536

    // The text cut, as a field with maxlength stops typing: at most `max` UTF-16 units, never inside a character.
    static func clipped(_ s: String, utf16 max: Int) -> String {
        guard s.utf16.count > max else { return s }
        var out = ""
        var used = 0
        for ch in s {
            let n = String(ch).utf16.count
            if used + n > max { break }
            out.append(ch); used += n
        }
        return out
    }

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

    // As the page's Add skill, whatever is written is sent (the name trimmed): a blank name or blank words are the
    // engine's to refuse, in its own sentence, not a grey button with no reason (review 2).
    static func addRequest(_ mac: Settings.Mac, name: String, body: String) -> URLRequest? {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = try? JSONSerialization.data(withJSONObject: ["name": n, "body": body], options: [.sortedKeys]) else { return nil }
        var r = URLRequest(url: URL(string: "/api/skills", relativeTo: mac.url)!.absoluteURL)
        r.httpMethod = "POST"
        sign(&r, mac)
        r.httpBody = data
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return r
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

    // The page's two scripts differ here, and each is followed: Add reads its answer with json().catch(() => null), so an
    // answer that is not JSON is "We could not add that skill."; Remove's res.json() throws on one, so it is the
    // could-not-reach line (review 2). No answer at all is could-not-reach for both.
    static func added(status: Int, data: Data) -> Done {
        done(status, data, refusedDefault: Words.addRefusedDefault, failed: Words.addFailed, notJSON: Settings.sentence(Words.addRefusedDefault))
    }
    static func removed(status: Int, data: Data) -> Done {
        done(status, data, refusedDefault: Words.removeRefusedDefault, failed: Words.removeFailed, notJSON: Words.removeFailed)
    }

    private static func done(_ status: Int, _ data: Data, refusedDefault: String, failed: String, notJSON: String) -> Done {
        if status == 401 || status == 403 { return .refused(Board.phoneShutOut) }
        if status == 0 { return .refused(failed) }
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .refused(notJSON) }
        if status == 200 && (obj["ok"] as? Bool) != false { return .done }
        return .refused(Settings.sentence(text(obj["because"]) ?? refusedDefault))
    }

    private static func text(_ v: Any?) -> String? {
        guard let s = v as? String, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return s
    }

    // A sample build has no engine to ask, so it refuses as engine/skills.js does, in its sentences (review 3): a name
    // with no letters or numbers, blank words, and a name already taken. The key is the engine's slugFor.
    static let sampleBlankName = "Give the skill a short name in letters and numbers."
    static let sampleBlankWords = "Write what the skill should do; an empty skill teaches nothing."
    static func slug(_ name: String) -> String {
        let lower = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var out = ""
        var dash = false
        for u in lower.unicodeScalars {
            if ("a"..."z").contains(u) || ("0"..."9").contains(u) { out.unicodeScalars.append(u); dash = false }
            else if !dash { out.append("-"); dash = true }
        }
        while out.hasPrefix("-") { out.removeFirst() }
        while out.hasSuffix("-") { out.removeLast() }
        return String(out.prefix(64))
    }
    static func sampleRefusal(name: String, body: String, taken: [String]) -> String? {
        let key = slug(name)
        if key.isEmpty { return sampleBlankName }
        if body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return sampleBlankWords }
        if taken.contains(key) { return "There is already a skill called \(key); pick another name rather than replacing it." }
        return nil
    }

    // A sample build's computer (KOSMOS_SAMPLE_AGENTS, Debug only), in the route's own shape, for screenshots.
    static let sampleList = #"{"ok":true,"skills":[{"key":"how-we-write-emails","name":"How we write emails"},{"key":"release-notes","name":"Release notes"}]}"#
}
