import Foundation

// kosmos#7267 (Josh, 2026-10-26 18:26, TestFlight build 4): the agent "i" button opened the board's agent page, which
// repeated the conversation in an unstyled view. It now opens a native page that is the agent's Profile and its AI
// Settings, switched by a segmented control, the board's two buttons under Direct Message (#4550). What the phone can
// do here is what the board's routes let a phone session do without a step-up (none of these routes asks for one);
// switching provider, model or account, the Terminal and Remove stay on the computer, behind one row.
// The decisions are here (tested in LogicTests/agentinfo); AgentInfoView.swift draws them.
extension Board {
    // One agent's row of GET /api/status, the fields this page reads beyond Board.Agent's.
    struct AgentDetails: Equatable {
        let session: String
        let name: String
        let role: String?
        // True when `role` is the person's saved choice (profile.role), false when it is the file's parsed line.
        var roleChosen = true
        let reportsTo: String?   // a session, or nil when the agent reports to the person
        let runner: String       // "" for Claude, else codex, gemini, grok, antigravity, muse (engine/status.js)
        let modelName: String?
        let plannedModelName: String?
        let settingModelName: String?
        let neverRecorded: Bool
        let accountProvider: String?
        let accountLabel: String?
        let running: Bool
        // The board's "is it running" for the model line (cardStOf(a).pres === 'off'): the state "stopped", which a live
        // pane can carry while `running` is still true (review 1).
        var stopped = false
    }

    static func parseAgentDetails(_ data: Data, session: String) -> AgentDetails? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = obj["agents"] as? [[String: Any]],
              let row = rows.first(where: { ($0["sessionName"] as? String) == session })
        else { return nil }
        func text(_ v: Any?) -> String? { (v as? String).flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } }
        let profile = row["profile"] as? [String: Any]
        let account = row["account"] as? [String: Any]
        return AgentDetails(
            session: session,
            name: text(row["name"]) ?? session,
            // The person's saved role first, then the line parsed out of the instruction file, as the board reads it
            // (review 2: the parsed line alone made a saved role look undone, and a name-only save sent it back).
            role: text(profile?["role"]) ?? text(row["role"]),
            roleChosen: text(profile?["role"]) != nil,
            reportsTo: text(profile?["reportsTo"]),
            runner: (row["runner"] as? String) ?? "",
            modelName: text(row["modelName"]),
            plannedModelName: text(row["plannedModelName"]),
            settingModelName: text(row["settingModelName"]),
            neverRecorded: (row["neverRecorded"] as? Bool) == true,
            accountProvider: text(account?["provider"]),
            // The board's acctParenthetical: name, else email, else "API key ending ..", else the folder's label.
            accountLabel: text(account?["name"]) ?? text(account?["email"])
                ?? text(account?["keyTail"]).map { "API key ending " + $0 } ?? text(account?["label"]),
            running: (row["running"] as? Bool) != false,
            // The board's cardStOf presence off: stopped, or a restart that did not come back (#4006).
            stopped: (row["state"] as? String) == "stopped"
                || ((row["state"] as? String) == "needs_you" && ((row["disruption"] as? [String: Any])?["failed"] as? Bool) == true))
    }

    // The board's modelLine (web/index.html), with no tense: an attribute of the agent, as on its card (Mona Lisa's
    // 2026-08-19 ruling there). A stopped agent is named by what it will start on when the job says.
    static func modelLine(_ d: AgentDetails) -> String {
        let name = (d.stopped ? d.plannedModelName : nil) ?? d.modelName ?? d.plannedModelName
        func starts(_ s: String, _ pattern: String) -> Bool { s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil }
        if d.runner == "codex" && d.accountProvider == "alibaba" {
            return name.map { starts($0, "qwen") ? $0 : "Qwen " + $0 } ?? "Qwen"
        }
        if d.runner == "codex" { return name.map { starts($0, "^(gpt|openai|codex)\\b") ? $0 : "OpenAI " + $0 } ?? "OpenAI Codex" }
        if d.runner == "gemini", let name, !d.stopped, let set = d.settingModelName { return name + " (set to " + set + ")" }
        if d.runner == "gemini" || d.runner == "grok" { return name ?? (d.runner == "gemini" ? "Gemini" : "Grok") }
        if d.runner == "antigravity" { return name ?? "Gemini (Google subscription)" }
        if d.runner == "muse" { return name ?? "Meta Muse" }
        guard let name else { return d.neverRecorded ? "Made before Kosmos recorded this" : "Unknown Model" }
        return starts(name, "^claude") ? name : "Claude " + name
    }

    // The board's roleLine: a chosen role as written; a role parsed from the instruction file is matched against the
    // role catalogue's own labels (GET /api/roles `roles[].label`, case folded) and, when it is not one of them, given a
    // capital first letter only (never title case: "SEO specialist" stays so). Review 3: the raw parsed line put
    // "project manager" into the saved profile on a name-only save.
    static func roleLine(_ d: AgentDetails, titles: [String: String]?) -> String? {
        guard let role = d.role else { return nil }
        if d.roleChosen { return role }
        if let known = titles?[role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()] { return known }
        return role.prefix(1).uppercased() + role.dropFirst()
    }
    // GET /api/roles: label (lower-cased) to label, nil when none could be read (the board's learnRoleTitles).
    static func parseRoleTitles(_ data: Data) -> [String: String]? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let roles = obj["roles"] as? [[String: Any]] else { return nil }
        var m: [String: String] = [:]
        for r in roles { if let l = r["label"] as? String, !l.isEmpty { m[l.lowercased()] = l } }
        return m.isEmpty ? nil : m
    }

    // The provider's mark beside the model (the board's own marks, kept equal to the board's by LogicTests/room), by the runner.
    static func runnerMark(_ d: AgentDetails) -> String? {
        switch d.runner {
        case "": return "MarkClaude"
        case "codex": return d.accountProvider == "alibaba" ? "MarkQwen" : "MarkOpenAI"
        case "gemini", "antigravity": return "MarkGemini"
        case "grok": return "MarkGrok"
        case "muse": return "MarkMeta"
        default: return nil
        }
    }

    // "Reports to" in the board's words: the person until somebody is picked (its hint, "Until you pick somebody, that
    // is you."), else the agent's shown name.
    static func reportsToWords(_ d: AgentDetails, names: [String: String]) -> String {
        guard let to = d.reportsTo else { return "You" }
        return names[to] ?? to
    }

    // An agent whose session name the phone will not put in a request path (a found tmux session like "Angel"):
    // nothing on this page can be read or changed from here, and it says so instead of "could not reach" (review 4).
    static func agentPageOnBoardOnly(_ name: String) -> String { "\(name)\u{2019}s settings can be changed on your computer\u{2019}s board." }

    // MARK: Name and role (PUT /api/agent/<n>/profile, the board's Save under Profile)

    static let profileFieldMax = 80   // the route's cap on both, in UTF-16 units (a JS string's length)
    // At most 80 UTF-16 units, cut between whole characters, so what is sent is what the route keeps (review 2).
    static func capped(_ s: String) -> String {
        var out = ""
        for ch in s {
            if out.utf16.count + String(ch).utf16.count > profileFieldMax { break }
            out.append(ch)
        }
        return out
    }
    static func profileSaveRequest(mac: URL, session: String, name: String, role: String, shownName: String) -> URLRequest? {
        // Cut to the route's 80, as the board's Save does (review 1: refusing here read as "could not reach").
        let n = capped(name.trimmingCharacters(in: .whitespacesAndNewlines))
        let r0 = capped(role.trimmingCharacters(in: .whitespacesAndNewlines))
        guard isAgentSession(session), !n.isEmpty else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/profile", relativeTo: mac)!.absoluteURL)
        r.httpMethod = "PUT"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // As the board's Save: the name only when it was changed, so an unchanged one is never re-checked for a clash.
        var body: [String: Any] = ["role": r0]
        if n != shownName { body["displayName"] = n }
        r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        return r
    }
    // Saved (with the board's sentence), or the route's own reason, or no answer (never "saved" on a body this build
    // cannot read).
    enum ProfileSave: Equatable { case saved(String), refused(String), noAnswer }
    // `running`: the agent's pane is up (the board's CURRENT.running !== false). `before`: the name the box was filled
    // with; `typed`: the name sent.
    static func profileSaveResult(status: Int, body: Data?, running: Bool = true, before: String = "", typed: String = "") -> ProfileSave {
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if status == 200, let obj { return .saved(profileSavedSentence(obj, running: running, before: before, typed: typed)) }
        // A 200 this build cannot read may still have saved (review 4): say it cannot tell, never that it failed.
        if status == 200 { return .refused("We could not tell whether that saved. Look again in a moment.") }
        if let e = obj?["error"] as? String, !e.isEmpty { return .refused(sentence(e)) }
        return status == 0 ? .noAnswer : .refused("We could not save that.")
    }

    // The board's sentence after Save (web/index.html, the d-role save: #406, #2829, #336), word for word, except where
    // the board puts a Restart button beside it: the phone has no restart here, so it says where it is.
    static func profileSavedSentence(_ saved: [String: Any], running: Bool, before: String, typed: String) -> String {
        let ren = saved["renamed"] as? [String: Any]
        let changed = (ren?["changed"] as? Bool) == true
        let renameTo = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        let said = ((ren?["was"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let was = said.isEmpty ? before.trimmingCharacters(in: .whitespacesAndNewlines) : said   // the board's ren.was || wasCalled
        let edited = renameTo != before.trimmingCharacters(in: .whitespacesAndNewlines)
        if changed && running && edited && !was.isEmpty && was != renameTo {
            return "Saved. \(was) will not answer to \(renameTo) until you restart it. You can restart it from your computer."
        }
        if let ren {
            if changed {
                return running ? "Saved. Its instructions say the new name too, so restart it when you are ready and it will know."
                               : "Saved. It will know its new name when it next starts."
            }
            if (ren["ok"] as? Bool) == false, let why = ren["because"] as? String, !why.isEmpty { return "Saved here, but \(why)." }
        }
        if let rep = saved["reports"] as? [String: Any] {
            if rep["state"] as? String == "told" && running {
                return "Saved. They are running on what they read when they started, so restart them to use it now. You can restart them from your computer."
            }
            if rep["state"] as? String == "could_not", let why = rep["because"] as? String, !why.isEmpty { return "Saved here, but \(why)." }
        }
        return "Saved."
    }

    // MARK: Instructions and skills, read only here

    static func agentRequest(mac: URL, session: String, _ tail: String) -> URLRequest? {
        guard isAgentSession(session) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/\(tail)", relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }
    // GET .../instructions: "" when the agent has none yet (no file: exists false AND editable, engine/instructions.js
    // read), nil when the answer or the file cannot be read (exists false and not editable: a link, too big, not text).
    static func parseInstructions(_ data: Data) -> String? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if (obj["exists"] as? Bool) == false { return (obj["editable"] as? Bool) == true ? "" : nil }
        return obj["text"] as? String
    }
    // GET .../skills: the skills (key and name; two may share a name), nil when the answer cannot be read or says it
    // could not.
    struct Skill: Equatable, Identifiable { let key: String; let name: String; var id: String { key } }
    static func parseSkills(_ data: Data) -> [Skill]? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (obj["ok"] as? Bool) != false, let list = obj["skills"] as? [[String: Any]] else { return nil }
        return list.compactMap { x in
            guard let name = x["name"] as? String, !name.isEmpty else { return nil }
            return Skill(key: (x["key"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? name, name: name)
        }
    }

    // MARK: Fresh start (POST .../compact or .../clear, the board's memoryCommand)

    enum FreshStart: String { case compact, clear }
    // The board's changeDialog, word for word (web/index.html d-compact-go, d-clear-go).
    static func freshConfirm(_ which: FreshStart, name: String) -> (title: String, small: String, go: String) {
        switch which {
        case .compact:
            return ("Compact \(name)\u{2019}s memory?",
                    "\(name) summarises this session to make room and keeps going. Fine detail from earlier in the session may be lost. What it agreed to stays. Its instructions are not read again, so a changed file still needs a restart.",
                    "Compact \(name)\u{2019}s memory")
        case .clear:
            return ("Clear \(name)\u{2019}s memory?",
                    "\(name) forgets this session. Anything it was part way through ends, including anything it agreed to and has not done yet. Its instructions and its files are untouched, and not read again; a changed file still needs a restart.",
                    "Clear \(name)\u{2019}s memory")
        }
    }
    static func freshRequest(mac: URL, session: String, _ which: FreshStart) -> URLRequest? {
        guard var r = agentRequest(mac: mac, session: session, which.rawValue) else { return nil }
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return r
    }
    // The board's sentence after a press, and whether it went (memoryCommand).
    static func freshResult(_ which: FreshStart, status: Int, body: Data?) -> (sentence: String, ok: Bool) {
        guard status != 0, let obj = body.flatMap({ try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }) else {
            return ("We could not reach Kosmos.", false)
        }
        let d = obj["delivery"] as? [String: Any]
        // A refusal before any delivery (no such agent, its window unreachable): the route's own words (review 1).
        if d == nil, let e = obj["error"] as? String, !e.isEmpty { return (sentence(e), false) }
        if (d?["state"] as? String) == "could_not" || d == nil {
            return ((d?["because"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "It could not be done just now.", false)
        }
        let lead = which == .compact ? "Asked it to compact. " : "Asked it to clear. "
        let note = (d?["paneNote"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "It does this the moment it is between tasks."
        return (lead + note, true)
    }
}
