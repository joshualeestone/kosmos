import Foundation

// kosmos#7502: the provider, account and model choice on New Agent, the desktop's (web/index.html cstep-name:
// #create-provider, #create-account, #create-model), rule for rule and in its words. Every list comes from the board's
// own routes: GET /api/accounts (the accounts), /api/roles (the Claude models, NewAgent.Catalogue.models),
// /api/accounts/openai/models?dir= (an OpenAI account's models), /api/antigravity, /api/muse and /api/accounts/compat
// (whether Gemini by subscription, Meta Muse and DeepSeek can be offered). Pure: the screens hold the answers.
enum NewAgentPicker {
    // The menu's values, in the desktop's one provider order (PROVIDER_ORDER, Josh #3651), with its words.
    enum Provider: String, CaseIterable, Identifiable {
        case anthropic, openai, google, antigravity, xai, meta, alibaba, deepseek
        var id: String { rawValue }
        var label: String {
            switch self {
            case .anthropic: return "Anthropic / Claude"
            case .openai: return "OpenAI / Codex"
            case .google: return "Google Gemini (API key)"
            case .antigravity: return "Google Gemini (Google subscription)"
            case .xai: return "xAI Grok"
            case .meta: return "Meta Muse"
            case .alibaba: return "Alibaba Qwen"
            case .deepseek: return "DeepSeek"
            }
        }
        // switchKeyedWord: the screen's short word for a provider in a sentence.
        var word: String {
            switch self {
            case .antigravity: return "Gemini (Google subscription)"
            case .meta: return "Meta Muse"
            case .alibaba: return "Qwen"
            case .deepseek: return "DeepSeek"
            case .google: return "Gemini"
            case .xai: return "Grok"
            case .anthropic: return "Claude"
            case .openai: return "OpenAI"
            }
        }
        // keyOnlyProvider: a keyed provider other than OpenAI (ACCT_KEYED_ROUTE's other rows).
        var keyOnly: Bool { [.google, .xai, .alibaba, .deepseek].contains(self) }
        // vendorPicksModel: no Kosmos model list; the row is hidden and no model is sent.
        var picksOwnModel: Bool { keyOnly || self == .antigravity || self == .meta }
        // No Kosmos account at all: the account row is hidden and nothing is sent.
        var hasNoAccount: Bool { self == .antigravity || self == .meta }
    }

    enum Words {
        static let provider = "Provider"
        static let account = "Account"
        static let checking = "Checking your accounts"
        static let couldNotCheck = "Could not check your accounts"
        static let connect = "Connect in AI Models"
        static let swarmOff = "Swarms run on Claude for now"
        static let agyChecking = "Checking Antigravity"
        static let agyNotHere = "Not on this computer"
        static let agySetUp = "Set up in Settings, AI Models"
        static let museSignIn = "Sign in to Meta Muse first"
        static let museSetUp = "Set up in Settings, AI Models"
        static let comingSoon = "Coming soon"
        static let unknownLive = " (could not check just now)"
        static let openaiOwn = "The OpenAI sign-in on this computer"
        static func keyedOwn(_ p: Provider) -> String { "This computer's own " + p.word + " key, if one is set up" }
        static let claudeOwn = "Your Claude account"
        static let loadingModels = "Loading this account's models…"
        static let openaiPicks = "OpenAI picks its own model for now"
        static let openaiChoose = "Let OpenAI choose (recommended)"
        static func picksOwn(_ p: Provider) -> String {
            switch p {
            case .alibaba: return "The Qwen account names the model."
            case .deepseek: return "The DeepSeek account names the model."
            case .antigravity:
                return p.word + " picks its own model. If Antigravity is not signed in yet, sign in first: in Settings, AI Models, choose Add a provider, then Google Gemini."
            default: return p.word + " picks its own model."
            }
        }
    }

    // One row of GET /api/accounts, as much of it as the menus read.
    struct Account: Equatable {
        let dir: String
        let provider: Provider          // acctProvider: the menu's provider for this row
        let rawProvider: String         // the row's own `provider`, lowercased (acctPrimaryName reads it)
        let email: String?
        let name: String?               // a human-chosen name (acctChosenName)
        let keyTail: String?
        let label: String?
        let baseUrl: String?
        let local: Bool
        let isDefault: Bool
        let memoryShared: Bool
        let badge: String?              // connection.badge
        let state: String?              // connection.state
        let hasConnection: Bool
        let offerable: Bool             // the row's `offerable` (false only when the board says so)
    }

    // acctProvider: 'antigravity' and 'meta' by provider or authMode, a keyed provider by its id, else Claude.
    static func provider(of row: [String: Any]) -> Provider {
        let p = (row["provider"] as? String ?? "").lowercased()
        let mode = row["authMode"] as? String
        if p == "antigravity" || mode == "antigravity" { return .antigravity }
        if p == "meta" || mode == "muse" { return .meta }
        switch p {
        case "openai": return .openai
        case "google": return .google
        case "xai": return .xai
        case "alibaba": return .alibaba
        case "deepseek": return .deepseek
        default: return .anthropic
        }
    }

    static func parseAccounts(_ data: Data) -> [Account]? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = obj["accounts"] as? [[String: Any]] else { return nil }
        return rows.map { r in
            let c = r["connection"] as? [String: Any]
            func s(_ k: String) -> String? { (r[k] as? String).flatMap { $0.isEmpty ? nil : $0 } }
            return Account(dir: r["dir"] as? String ?? "", provider: provider(of: r),
                           rawProvider: (r["provider"] as? String ?? "").lowercased(),
                           email: s("email"), name: (r["name"] as? String).map { NewProject.trimmed($0) }.flatMap { $0.isEmpty ? nil : $0 },
                           keyTail: s("keyTail"), label: s("label"), baseUrl: s("baseUrl"), local: r["local"] as? Bool == true,
                           isDefault: r["isDefault"] as? Bool == true, memoryShared: r["memoryShared"] as? Bool == true,
                           badge: c?["badge"] as? String, state: c?["state"] as? String, hasConnection: c != nil,
                           offerable: r["offerable"] as? Bool != false)
        }
    }

    // acctOfferableTarget: only the confirmed-unusable are left out (rejected, signed out); unknown is offered, labelled.
    static func offerable(_ a: Account) -> Bool {
        guard a.hasConnection else { return true }
        if let b = a.badge { return b != "rejected" && b != "signed_out" }
        return a.state != "none"
    }
    // acctUnknownLive: a live check that could not be read.
    static func unknownLive(_ a: Account) -> Bool {
        guard a.hasConnection else { return false }
        if let b = a.badge { return b == "unchecked" }
        return a.state == "unknown"
    }
    // acctPrimaryName: the chosen name; a Qwen account by where it runs; a keyed one by its key's tail; else email, label, dir.
    static func primaryName(_ a: Account) -> String {
        if let n = a.name { return n }
        if a.rawProvider == "alibaba" {
            let host = a.baseUrl.flatMap { URL(string: $0) }.map { u in (u.host ?? "") + (u.port.map { ":\($0)" } ?? "") } ?? ""
            return a.local ? "Qwen on this computer" : (!host.isEmpty ? host : (a.label ?? "Qwen endpoint"))
        }
        let keyed = ["openai", "google", "xai", "alibaba", "deepseek"].contains(a.rawProvider)
        if let e = a.email { return e }
        if keyed, let t = a.keyTail { return "API key ending " + t }
        return a.label ?? a.dir
    }

    // accountQualifiers, for a list of ONE provider (the create menu filters to one, so a provider name never
    // separates two rows here): rows whose names read alike get "main" (the first default), else their label, else
    // their dir, each kept distinct from the others in the group without regard to case.
    static func qualifiers(_ rows: [Account]) -> [String: String] {
        let key = { (a: Account) in primaryName(a).lowercased() }
        var count: [String: Int] = [:]
        for a in rows where !key(a).isEmpty { count[key(a), default: 0] += 1 }
        var used: [String: [String]] = [:]
        var out: [String: String] = [:]
        for a in rows {
            let k = key(a)
            if k.isEmpty || (count[k] ?? 0) < 2 { out[a.dir] = ""; continue }
            let taken = { (v: String) in !v.isEmpty && (used[k] ?? []).contains { $0.lowercased() == v.lowercased() } }
            func distinctly(_ v: String) -> String {
                let base = v.isEmpty ? "account" : v
                if !taken(base) { return base }
                var n = 2
                while taken(base + " (\(n))") { n += 1 }
                return base + " (\(n))"
            }
            var q: String
            if a.isDefault && !taken("main") { q = "main" } else {
                q = a.label ?? ""
                if q.isEmpty || q.lowercased() == "main" || taken(q) { q = distinctly(a.dir) }
            }
            used[k, default: []].append(q)
            out[a.dir] = q
        }
        return out
    }

    // What the board said about the providers with no Kosmos account, and DeepSeek's switch. nil: not read yet, or the
    // read failed (never a confident answer from a failed read).
    struct Readiness: Equatable {
        var agy: (offered: Bool, installed: Bool)? = nil         // GET /api/antigravity
        var muse: (on: Bool, installed: Bool, ready: Bool)? = nil  // GET /api/muse
        var compat: Bool? = nil                                   // GET /api/accounts/compat: on, with a deepseek vendor
        static func == (l: Readiness, r: Readiness) -> Bool {
            l.agy?.offered == r.agy?.offered && l.agy?.installed == r.agy?.installed
                && l.muse?.on == r.muse?.on && l.muse?.installed == r.muse?.installed && l.muse?.ready == r.muse?.ready
                && l.compat == r.compat
        }
    }
    static func parseAgy(_ data: Data) -> (offered: Bool, installed: Bool)? {
        guard let b = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return (b["enabled"] as? Bool != false && b["supported"] as? Bool != false, b["installed"] as? Bool == true)
    }
    static func parseMuse(_ data: Data) -> (on: Bool, installed: Bool, ready: Bool)? {
        guard let b = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let on = b["enabled"] as? Bool == true
        let installed = on && b["installed"] as? Bool == true
        return (on, installed, installed && b["signedIn"] as? Bool == true)
    }
    static func parseCompat(_ data: Data) -> Bool? {
        guard let b = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let on = b["enabled"] as? Bool else { return nil }
        return on && ((b["vendors"] as? [[String: Any]]) ?? []).contains { $0["id"] as? String == "deepseek" }
    }

    // The accounts as the screen knows them: `known` once /api/accounts answered, `failed` when a read finished without.
    struct Accounts: Equatable {
        var rows: [Account] = []
        var known = false
        var failed = false
    }

    struct Option: Equatable, Identifiable {
        let provider: Provider
        let enabled: Bool
        let off: String?          // why it cannot be chosen (the desktop's pill)
        var id: String { provider.rawValue }
    }

    // The provider menu: paintKeyedProviderOptions, paintAgyOption, paintMuseOption and swarmProviderGate together.
    static func providers(_ acc: Accounts, _ ready: Readiness, swarm: Bool) -> [Option] {
        Provider.allCases.map { p in
            if swarm && p != .anthropic { return Option(provider: p, enabled: false, off: Words.swarmOff) }
            switch p {
            case .anthropic, .openai: return Option(provider: p, enabled: true, off: nil)
            case .antigravity:
                if let a = ready.agy, a.offered, a.installed { return Option(provider: p, enabled: true, off: nil) }
                let why = ready.agy.map { !$0.offered ? Words.agyNotHere : Words.agySetUp } ?? Words.agyChecking
                return Option(provider: p, enabled: false, off: why)
            case .meta:
                guard let m = ready.muse else { return Option(provider: p, enabled: false, off: Words.comingSoon) }
                if m.ready { return Option(provider: p, enabled: true, off: nil) }
                return Option(provider: p, enabled: false, off: !m.on ? Words.comingSoon : m.installed ? Words.museSignIn : Words.museSetUp)
            case .google, .xai, .alibaba, .deepseek:
                if p == .deepseek && ready.compat != true { return Option(provider: p, enabled: false, off: Words.comingSoon) }
                // "Usable" is both rules: the create list's and the switch list's.
                let has = acc.known && acc.rows.contains {
                    $0.provider == p && offerable($0) && !($0.hasConnection && $0.state == "none") && $0.offerable
                }
                if has { return Option(provider: p, enabled: true, off: nil) }
                return Option(provider: p, enabled: false, off: acc.known ? Words.connect : acc.failed ? Words.couldNotCheck : Words.checking)
            }
        }
    }

    // resetCreateProvider: OpenAI only when there is an OpenAI account and no Claude one; Claude otherwise, and always
    // for a swarm.
    static func defaultProvider(_ acc: Accounts, swarm: Bool) -> Provider {
        if swarm { return .anthropic }
        let claude = acc.rows.contains { $0.provider == .anthropic }
        let openai = acc.rows.contains { $0.provider == .openai }
        return !claude && openai ? .openai : .anthropic
    }

    // A pick the menu no longer allows (createPickGone): back to the default, said. nil when the pick still stands.
    static func pickGone(_ p: Provider, _ acc: Accounts, _ ready: Readiness, swarm: Bool) -> (back: Provider, why: String?)? {
        guard let opt = providers(acc, ready, swarm: swarm).first(where: { $0.provider == p }), !opt.enabled else { return nil }
        let back = defaultProvider(acc, swarm: swarm)
        // A swarm's move to Claude is the form's own and says nothing (swarmProviderGate).
        if swarm || !p.picksOwnModel { return (back, nil) }
        let to = back == .openai ? "OpenAI" : "Claude"
        switch p {
        case .antigravity:
            return (back, "Gemini (Google subscription) is not set up on this computer, so this is back on \(to). Set it up in Settings, AI Models: Add a provider, then Google Gemini.")
        case .meta:
            let m = ready.muse
            if m == nil || m?.on != true { return (back, "Meta Muse is not available on this computer, so this is back on \(to).") }
            if m?.installed != true { return (back, "Muse Code is not on this computer, so this is back on \(to). Install it in Settings, AI Models: Add a provider, then Meta.") }
            return (back, "Meta Muse is not signed in on this computer, so this is back on \(to). Sign in to it in Settings, AI Models: Add a provider, then Meta.")
        default:
            return (back, acc.known ? "There is no \(p.word) account connected, so this is back on \(to). Add one in Settings, AI Models."
                : "We could not check your \(p.word) accounts just now, so this is back on \(to).")
        }
    }

    struct AccountChoice: Equatable, Identifiable {
        let value: String         // the account's dir; empty for the fallback, which is never sent
        let label: String
        var id: String { value.isEmpty ? "-" : value }
    }
    // fillCreateAccounts: the provider's offerable rows (for Claude, those whose memory moves, when there are any),
    // named as the desktop names them; the default first chosen. `show` is false below two (Josh, #2097).
    static func accounts(for p: Provider, _ acc: Accounts) -> (choices: [AccountChoice], chosen: String, show: Bool) {
        if p.hasNoAccount { return ([], "", false) }
        let working = acc.rows.filter { $0.provider == p && offerable($0) }
        let movable = p == .anthropic ? working.filter(\.memoryShared) : working
        let usable = movable.isEmpty ? working : movable
        if usable.isEmpty {
            let only = p == .openai ? Words.openaiOwn : p == .anthropic ? Words.claudeOwn : Words.keyedOwn(p)
            return ([AccountChoice(value: "", label: only)], "", false)
        }
        let q = qualifiers(usable)
        let choices = usable.map { a -> AccountChoice in
            let qual = q[a.dir].flatMap { $0.isEmpty ? nil : " (" + $0 + ")" } ?? ""
            return AccountChoice(value: a.dir, label: primaryName(a) + qual + (unknownLive(a) ? Words.unknownLive : ""))
        }
        // The desktop marks every default `selected`, and a select keeps the last one so marked; none marked: the first.
        let chosen = usable.last(where: \.isDefault)?.dir ?? usable[0].dir
        return (choices, chosen, usable.count >= 2)
    }

    static func openaiModelsRequest(mac: URL, dir: String) -> URLRequest? {
        guard !dir.isEmpty else { return nil }
        var c = URLComponents(); c.path = "/api/accounts/openai/models"; c.queryItems = [URLQueryItem(name: "dir", value: dir)]
        // URLComponents leaves + and & alone in a query value: encode them as encodeURIComponent does.
        c.percentEncodedQuery = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let u = c.url(relativeTo: mac) else { return nil }
        var r = URLRequest(url: u.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }
    // The OpenAI account's answer: its models when it lists some, else the `because` for the note.
    enum OpenaiModels: Equatable { case listed([NewAgent.Model]), notListed(because: String?) }
    static func parseOpenaiModels(_ data: Data?) -> OpenaiModels {
        let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        let rows = (obj?["models"] as? [[String: Any]]) ?? []
        let models = rows.compactMap { m -> NewAgent.Model? in
            guard let key = m["key"] as? String, !key.isEmpty, let label = m["label"] as? String else { return nil }
            return NewAgent.Model(key: key, label: label, isDefault: m["default"] as? Bool == true)
        }
        if obj?["ok"] as? Bool == true, !models.isEmpty { return .listed(models) }
        return .notListed(because: obj?["because"] as? String)
    }

    // openaiNoModelsNote, its sentences and its order.
    static func openaiNote(_ because: String?) -> String {
        let b = because ?? ""
        func has(_ p: String) -> Bool { b.range(of: p, options: [.regularExpression, .caseInsensitive]) != nil }
        if has("not an api key") { return "This account is signed in with ChatGPT, so we cannot list its models here. It will use OpenAI's default. Sign in with an API key to choose a specific model." }
        if has("no chat models we recognise|no chat models") { return "We could not find a model we recognise on this account, so it will use OpenAI's default. You can change this later." }
        if has(#"rejected by OpenAI \(401\)"#) { return "OpenAI rejected this account's API key, so we cannot list its models. Reconnect this account to choose a model." }
        if has("cannot list models, though the key itself works") { return "This account's key cannot list models here (OpenAI answered 401 for a permissions reason, not a bad key), so it will use OpenAI's default. It still works for running the agent." }
        if has(#"not allowed to list models \(403\)"#) { return "This account's key is not allowed to list models (its OpenAI project or role denies it), so it will use OpenAI's default. Fix the key's permissions to choose a specific model." }
        if has(#"usage or billing limit \(429\)"#) { return "This account has hit its OpenAI usage or billing limit, so we cannot list its models right now. It will use OpenAI's default." }
        if has("rate-limiting this account") { return "OpenAI is rate-limiting this account right now, so we could not list its models. It will use OpenAI's default; try again shortly." }
        if has("having trouble right now") { return "OpenAI is having trouble right now, so we could not list this account's models. It will use OpenAI's default; try again shortly." }
        if has("did not return|answered|reach|unreachable|could not read this account'?s models") { return "We could not reach OpenAI to list this account's models right now, so it will use its default. You can change this later." }
        return "Once this account is signed in, you can pick its model here. For now it will use OpenAI's default."
    }

    // The model row (applyCreateProviderUI, paintOpenaiCreateModel). `value` is what Create sends: empty sends nothing.
    struct ModelChoice: Equatable, Identifiable {
        let value: String
        let label: String
        var id: String { value.isEmpty ? "-" : value }
    }
    struct ModelRow: Equatable {
        let shown: Bool           // false: the row is hidden (a vendor picks its own)
        let enabled: Bool
        let choices: [ModelChoice]
        let chosen: String
        let note: String?
    }
    // openai: nil while its account's list is being read (or not asked yet for this account).
    static func modelRow(_ p: Provider, account: String, claude: [NewAgent.Model], lastClaude: String, openai: OpenaiModels?) -> ModelRow {
        if p.picksOwnModel { return ModelRow(shown: false, enabled: false, choices: [], chosen: "", note: Words.picksOwn(p)) }
        if p == .openai {
            if account.isEmpty {
                return ModelRow(shown: true, enabled: false, choices: [ModelChoice(value: "", label: Words.openaiPicks)], chosen: "", note: openaiNote(nil))
            }
            switch openai {
            case nil:
                return ModelRow(shown: true, enabled: false, choices: [ModelChoice(value: "", label: Words.loadingModels)], chosen: "", note: nil)
            case .listed(let ms)?:
                return ModelRow(shown: true, enabled: true, choices: [ModelChoice(value: "", label: Words.openaiChoose)] + ms.map { ModelChoice(value: $0.key, label: $0.label) },
                                chosen: "", note: nil)
            case .notListed(let because)?:
                return ModelRow(shown: true, enabled: false, choices: [ModelChoice(value: "", label: Words.openaiPicks)], chosen: "", note: openaiNote(because))
            }
        }
        let choices = claude.map { ModelChoice(value: $0.key, label: $0.label) }
        // A non-default Claude pick survives a round trip through another provider.
        let chosen = claude.contains { $0.key == lastClaude } ? lastClaude : (claude.last(where: \.isDefault) ?? claude.first)?.key ?? ""
        return ModelRow(shown: true, enabled: true, choices: choices, chosen: chosen, note: nil)
    }

    // The reads the menus are drawn from (GETs, never cached: the desktop asks with cache: 'no-store').
    private static func get(_ path: String, mac: URL) -> URLRequest {
        var r = URLRequest(url: URL(string: path, relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }
    static func accountsRequest(mac: URL) -> URLRequest { get("/api/accounts", mac: mac) }
    static func agyRequest(mac: URL) -> URLRequest { get("/api/antigravity", mac: mac) }
    static func museRequest(mac: URL) -> URLRequest { get("/api/muse", mac: mac) }
    static func compatRequest(mac: URL) -> URLRequest { get("/api/accounts/compat", mac: mac) }

    // The single agent's create, with the choice made here: NewAgent.body (the desktop's body for everything else), its
    // model replaced by the model row's (Claude's pick, an OpenAI account's, or none where the vendor picks), and the
    // provider and account added as create-go adds them. nil when NewAgent.body is (Create is off then).
    static func createRequest(mac: URL, draft d: NewAgent.Draft, catalogue c: NewAgent.Catalogue,
                              provider p: Provider, account: String, model: String) -> URLRequest? {
        guard var b = NewAgent.body(d, c) else { return nil }
        let swarm = d.kind == .swarm
        let p = swarm ? .anthropic : p
        b["model"] = nil
        if !p.picksOwnModel && !model.isEmpty { b["model"] = model }
        addChoice(to: &b, provider: p, account: account, swarm: swarm)
        guard let data = try? JSONSerialization.data(withJSONObject: b) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agents", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = data
        return r
    }

    // The team step's specs read with the choice (the desktop's tcSpecs and tcModel): the provider always, as its menu's
    // value is never empty; the account and the model only when there is one. NewTeam.specsRequest's body otherwise.
    static func specsRequest(mac: URL, key: String, names: [String: String], project: String?, provider p: Provider,
                             account: String, model: String, check: Bool) -> URLRequest? {
        guard NewTeam.isKey(key) else { return nil }
        var b: [String: Any] = ["names": names, "check": check, "provider": p.rawValue]
        if let project { b["project"] = project }
        if !account.isEmpty && !p.hasNoAccount { b["account"] = account }
        if !p.picksOwnModel && !model.isEmpty { b["model"] = model }
        guard let data = try? JSONSerialization.data(withJSONObject: b) else { return nil }
        var r = URLRequest(url: URL(string: "/api/teams/seeded/\(key)/specs", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = data
        return r
    }

    // create-go: the provider only when it is not Claude, the account only when one is chosen; a swarm is Claude.
    static func addChoice(to b: inout [String: Any], provider p: Provider, account: String, swarm: Bool) {
        if swarm { b["provider"] = Provider.anthropic.rawValue } else if p != .anthropic { b["provider"] = p.rawValue }
        if !account.isEmpty && !p.hasNoAccount { b["account"] = account }
    }
}
