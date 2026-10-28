import Foundation

// kosmos#7488 (Josh 10-28 09:41, build 11): + on Agents opened the board's web page. This is the native New Agent flow,
// Mona Lisa's phone design of the desktop's (#4554), screen for screen and in the desktop's own words (web/index.html
// cstep-kind, cstep-role, cstep-name, cstep-made). Every list comes from the board's own routes (/api/roles), never
// typed into the app, so the phone and the Mac cannot drift. It creates through POST /api/agents, the desktop's
// Create button's route, with the desktop's body: only what the person changed travels.
// Not in this slice (the card says why): the provider and account pickers (the board's default account, and the Claude
// models /api/roles serves), a swarm limit as a share of the weekly allowance (tokens only), import, org chart.
enum NewAgent {
    enum Kind: String, CaseIterable, Identifiable { case single, team, swarm; var id: String { rawValue } }

    enum Words {
        static let kindTitle = "What would you like to create?"
        static func kindName(_ k: Kind) -> String {
            switch k {
            case .single: return "Create a Single Agent"
            case .team: return "Create a Team of Agents"
            case .swarm: return "Create a Swarm of Autonomous Agents"
            }
        }
        static func kindLine(_ k: Kind) -> String {
            switch k {
            case .single: return "One agent for one job"
            case .team: return "A lead and the agents who report to it"
            case .swarm: return "Many agents that answer as one"
            }
        }
        static let roleTitle = "What should this agent do?"
        static let roleHint = "You can change any of this later."
        static let pickAnother = "Pick another role"
        static let ownName = "Describe it yourself"
        static let ownLine = "Write the job in your own words"
        static let ownFull = "We will start you off with an example you can change, rather than an empty page."
        static let continueWord = "Continue"
        static let setupTitle = "Set up your agent"
        static let name = "Name"
        static let role = "Role"
        static let reportsTo = "Reports to"
        static let you = "You"
        static let model = "Model"
        static let modelSoft = "(you can change this later)"
        static let maxHelpers = "Maximum helpers"
        static let dailyLimit = "Daily usage limit"
        static let pauses = "This swarm pauses when it reaches its daily limit and resumes the next day. You can change the limit anytime."
        static func swarmExplain(_ max: Int) -> String {
            "The lead agent brings in up to \(max) helpers when parts of a task can be done at the same time. Otherwise, it works alone."
        }
        static func swarmWarn(_ max: Int) -> String {
            "With all \(max) helpers active, the swarm can use roughly \(max + 1) times as many tokens as a single agent."
        }
        static let create = "Create"
        static let making = "Making it"
        static func makingNamed(_ n: String) -> String { n.isEmpty ? making : "Making " + n }
        static let hello = "Say “hello” to your agent to activate it on Kosmos."
        static func sayHello(_ shown: String) -> String { "Say Hello to " + shown }
        static let nameMissing = "Give it a name first."
        static let rolesUnread = "Kosmos could not load the roles. Pull down or try again."
    }

    // The desktop's slider bounds and starting values (create-swarm-max 2...10 at 3; create-swarm-cap in tokens 1...20 at
    // 6, millions a day).
    static let helpersRange = 2...10
    static let helpersStart = 3
    static let capRange = 1...20
    static let capStart = 6
    static func capWords(_ millions: Int) -> String {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "en_US")
        return (f.string(from: NSNumber(value: millions * 1_000_000)) ?? String(millions * 1_000_000)) + " tokens a day"
    }

    struct Role: Equatable, Identifiable {
        let key: String
        let label: String
        let blurb: String
        let instructions: String
        let group: String?
        var id: String { key }
    }
    struct Model: Equatable, Identifiable {
        let key: String
        let label: String
        let isDefault: Bool
        var id: String { key }
    }
    struct Catalogue: Equatable {
        let roles: [Role]          // menu roles only, as served
        let own: Role?             // "Describe it yourself", when the board serves it
        let models: [Model]        // the Claude models (the phone creates on the board's default account)
        let swarms: Bool

        // The desktop's recommended radio: the pm role, else the first served (buildPicker).
        var recommended: Role? { roles.first { $0.key == "pm" } ?? roles.first }
        var defaultModel: Model? { models.first { $0.isDefault } ?? models.first }

        // The menu groups, in the order the catalogue first names them; a role with none goes under "Other".
        var groups: [(name: String, roles: [Role])] {
            var order: [String] = []
            var by: [String: [Role]] = [:]
            for r in roles {
                let g = r.group.flatMap { NewProject.trimmed($0).isEmpty ? nil : $0 } ?? "Other"
                if by[g] == nil { order.append(g) }
                by[g, default: []].append(r)
            }
            return order.map { ($0, by[$0] ?? []) }
        }
        func role(_ key: String?) -> Role? {
            guard let key else { return nil }
            return key == "own" ? own : roles.first { $0.key == key }
        }
    }

    static func rolesRequest(mac: URL) -> URLRequest {
        // ?catalogue=1, as the desktop's picker asks when it opens: the ready-made roles beyond the built-in ones (#4632).
        var r = URLRequest(url: URL(string: "/api/roles?catalogue=1", relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    static func parseCatalogue(_ data: Data, swarms: Bool) -> Catalogue? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = obj["roles"] as? [[String: Any]] else { return nil }
        func role(_ row: [String: Any], label fallback: String? = nil) -> Role? {
            guard let key = row["key"] as? String, !key.isEmpty else { return nil }
            let label = (row["label"] as? String).flatMap { NewProject.trimmed($0).isEmpty ? nil : $0 } ?? fallback
            guard let label else { return nil }
            return Role(key: key, label: label, blurb: row["blurb"] as? String ?? "",
                        instructions: row["instructions"] as? String ?? "", group: row["group"] as? String)
        }
        let roles = rows.compactMap { role($0) }
        // own has no label of its own (the person's words are its label); it is shown under its radio's name.
        let own = (obj["own"] as? [String: Any]).flatMap { role($0, label: Words.ownName) }
        let models = ((obj["models"] as? [[String: Any]]) ?? []).compactMap { m -> Model? in
            guard (m["provider"] as? String ?? "anthropic") == "anthropic",
                  let key = m["key"] as? String, !key.isEmpty, let label = m["label"] as? String else { return nil }
            return Model(key: key, label: label, isDefault: m["default"] as? Bool ?? false)
        }
        return Catalogue(roles: roles, own: own, models: models, swarms: swarms)
    }

    struct Draft: Equatable {
        var kind: Kind = .single
        var roleKey: String?            // a menu role's key, or "own"
        var ownWords = ""               // the "Describe it yourself" editor, as shown (the name reads "your agent")
        var name = ""
        var label = ""                  // the Role field on Set up; the role's own title until changed
        var reportsTo = ""              // empty is you
        var model = ""
        var maxHelpers = NewAgent.helpersStart
        var capMillions = NewAgent.capStart
    }

    // The example the editor starts from: the template, with the name it does not know yet read as the desktop reads it.
    static let unnamed = "your agent"
    static func ownExample(_ c: Catalogue) -> String { (c.own?.instructions ?? "").replacingOccurrences(of: "{{NAME}}", with: unnamed) }

    static func canContinueRole(_ d: Draft, _ c: Catalogue) -> Bool {
        guard let role = c.role(d.roleKey) else { return false }
        return role.key != "own" || !NewProject.trimmed(d.ownWords).isEmpty
    }
    static func canCreate(_ d: Draft, _ c: Catalogue) -> Bool {
        guard canContinueRole(d, c), !NewProject.trimmed(d.name).isEmpty else { return false }
        // own's label always travels and the engine refuses without one.
        return d.roleKey != "own" || !NewProject.trimmed(d.label).isEmpty
    }

    // The desktop's body (create-go): name and role; a label only when changed (always for own); edited instructions;
    // the model; a reporting line other than you; a swarm's kind, helpers, limit in tokens and provider.
    static func body(_ d: Draft, _ c: Catalogue) -> [String: Any]? {
        guard canCreate(d, c), let role = c.role(d.roleKey) else { return nil }
        let name = NewProject.trimmed(d.name)
        var b: [String: Any] = ["name": name, "role": role.key, "notifyCreated": true]
        let label = NewProject.trimmed(d.label)
        if role.key == "own" ? !label.isEmpty : (!label.isEmpty && label != role.label) { b["label"] = label }
        if role.key == "own" {
            let words = d.ownWords
            if !NewProject.trimmed(words).isEmpty && words != ownExample(c) {
                b["instructions"] = words.replacingOccurrences(of: "**\(unnamed)**", with: "**\(name)**")
            }
        }
        if !d.model.isEmpty { b["model"] = d.model }
        if !d.reportsTo.isEmpty { b["reportsTo"] = d.reportsTo }
        if d.kind == .swarm {
            b["kind"] = "swarm"
            b["maxHelpers"] = min(max(d.maxHelpers, helpersRange.lowerBound), helpersRange.upperBound)
            b["dailyTokenLimit"] = min(max(d.capMillions, capRange.lowerBound), capRange.upperBound) * 1_000_000
            b["provider"] = "anthropic"
        }
        return b
    }

    static func createRequest(mac: URL, draft d: Draft, catalogue c: Catalogue) -> URLRequest? {
        guard let b = body(d, c), let data = try? JSONSerialization.data(withJSONObject: b) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agents", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = data
        return r
    }

    enum Result: Equatable {
        case made(session: String, shownAs: String)
        case refused(String)
        case unknown   // no answer, or one that does not say: it may have been made
    }
    static let fallback = "We could not make it, and we cannot tell you why."
    static let unsureWords = "Kosmos could not tell whether that went through. Look in Agents before you try again."

    // created is made; refused and partial (the engine rolls a partial back) are the board's own sentence; an error
    // with a sentence is that sentence; no answer, or a 5xx with none, is unknown.
    static func result(sent: Bool, status: Int, body: Data?) -> Result {
        if !sent { return .refused(fallback) }
        if status == 0 { return .unknown }
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let said = [obj?["because"] as? String, obj?["error"] as? String].compactMap { $0 }.first { !NewProject.trimmed($0).isEmpty }
        if (200...299).contains(status), obj?["outcome"] as? String == "created" {
            guard let session = obj?["name"] as? String, Board.isAgentSession(session) else { return .unknown }
            let shown = (obj?["shownAs"] as? String).flatMap { NewProject.trimmed($0).isEmpty ? nil : $0 } ?? session
            return .made(session: session, shownAs: shown)
        }
        if let said { return .refused(said) }
        return status >= 500 || (200...299).contains(status) ? .unknown : .refused(fallback)
    }
}
