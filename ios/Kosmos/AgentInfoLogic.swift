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
        let reportsTo: String?   // a session, or nil when the agent reports to the person
        let runner: String       // "" for Claude, else codex, gemini, grok, antigravity, muse (engine/status.js)
        let modelName: String?
        let plannedModelName: String?
        let settingModelName: String?
        let neverRecorded: Bool
        let accountProvider: String?
        let accountLabel: String?
        let running: Bool
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
            role: text(row["role"]),
            reportsTo: text(profile?["reportsTo"]),
            runner: (row["runner"] as? String) ?? "",
            modelName: text(row["modelName"]),
            plannedModelName: text(row["plannedModelName"]),
            settingModelName: text(row["settingModelName"]),
            neverRecorded: (row["neverRecorded"] as? Bool) == true,
            accountProvider: text(account?["provider"]),
            accountLabel: text(account?["label"]) ?? text(account?["name"]),
            running: (row["running"] as? Bool) != false)
    }

    // The board's modelLine (web/index.html), with no tense: an attribute of the agent, as on its card (Mona Lisa's
    // 2026-08-19 ruling there). A stopped agent is named by what it will start on when the job says.
    static func modelLine(_ d: AgentDetails) -> String {
        let name = (!d.running ? d.plannedModelName : nil) ?? d.modelName ?? d.plannedModelName
        func starts(_ s: String, _ pattern: String) -> Bool { s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil }
        if d.runner == "codex" && d.accountProvider == "alibaba" {
            return name.map { starts($0, "qwen") ? $0 : "Qwen " + $0 } ?? "Qwen"
        }
        if d.runner == "codex" { return name.map { starts($0, "^(gpt|openai|codex)\\b") ? $0 : "OpenAI " + $0 } ?? "OpenAI Codex" }
        if d.runner == "gemini", let name, d.running, let set = d.settingModelName { return name + " (set to " + set + ")" }
        if d.runner == "gemini" || d.runner == "grok" { return name ?? (d.runner == "gemini" ? "Gemini" : "Grok") }
        if d.runner == "antigravity" { return name ?? "Gemini (Google subscription)" }
        if d.runner == "muse" { return name ?? "Meta Muse" }
        guard let name else { return d.neverRecorded ? "Made before Kosmos recorded this" : "Unknown Model" }
        return starts(name, "^claude") ? name : "Claude " + name
    }

    // The provider's mark beside the model (Board.providerMarkAsset, the board's own marks), by the runner.
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

    // MARK: Name and role (PUT /api/agent/<n>/profile, the board's Save under Profile)

    static let profileFieldMax = 80   // the route's cap on both
    static func profileSaveRequest(mac: URL, session: String, name: String, role: String, shownName: String) -> URLRequest? {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let r0 = role.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isAgentSession(session), !n.isEmpty, n.count <= profileFieldMax, r0.count <= profileFieldMax else { return nil }
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
    // Saved, or the route's own reason, or no answer (never "saved" on a body this build cannot read).
    enum ProfileSave: Equatable { case saved, refused(String), noAnswer }
    static func profileSaveResult(status: Int, body: Data?) -> ProfileSave {
        let obj = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if status == 200, obj != nil { return .saved }
        if let e = obj?["error"] as? String, !e.isEmpty { return .refused(sentence(e)) }
        return status == 0 ? .noAnswer : .refused("We could not save that.")
    }

    // MARK: Instructions and skills, read only here

    static func agentRequest(mac: URL, session: String, _ tail: String) -> URLRequest? {
        guard isAgentSession(session) else { return nil }
        var r = URLRequest(url: URL(string: "/api/agent/\(session)/\(tail)", relativeTo: mac)!.absoluteURL)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }
    // GET .../instructions: "" when the agent has none yet (exists false), nil when the answer cannot be read.
    static func parseInstructions(_ data: Data) -> String? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        if (obj["exists"] as? Bool) == false { return "" }
        return obj["text"] as? String
    }
    // GET .../skills: the skills' names, nil when the answer cannot be read or says it could not.
    static func parseSkills(_ data: Data) -> [String]? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (obj["ok"] as? Bool) != false, let list = obj["skills"] as? [[String: Any]] else { return nil }
        return list.compactMap { ($0["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } }
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
        if (d?["state"] as? String) == "could_not" || d == nil {
            return ((d?["because"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "It could not be done just now.", false)
        }
        let lead = which == .compact ? "Asked it to compact. " : "Asked it to clear. "
        let note = (d?["paneNote"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "It does this the moment it is between tasks."
        return (lead + note, true)
    }
}
