import Foundation

// kosmos#8959 slice D1a: the computer's Automation settings, native on the phone. UIKit-free, so
// ios/LogicTests/run-automation.sh runs it on a Mac.
//
// Each box is the computer's own setting, read and written through the same routes the board's Settings > Automation
// uses (web/index.html s-sec-automation), with the computer's sign-in the app keeps for it (Settings.keptMac), so phone
// and computer can never disagree. Measured on the card before building: none of these routes is in server.js's
// REMOTE_STEP_UP_EXACT, and the four that ask isViaScreen (both caps, Recommender, Assigner) accept the
// Sec-Fetch-Site header every request here carries. The words are the board page's own; the choice lists come from
// the computer's answer, never from here, except Auto-save's levels, which the page itself fixes (75 to 95).
enum Automation {
    enum Box: String, CaseIterable, Equatable {
        case autoSave, prompter, geminiCap, accountCap, messages, dailyReport, community, language, recommender, assigner

        // The board's heading for each box, in its order.
        var title: String {
            switch self {
            case .autoSave: return "Auto-save"
            case .prompter: return "Prompter"
            case .geminiCap: return "Gemini subscription agents at once"
            case .accountCap: return "Agents on one account at once"
            case .messages: return "Agent Communication"
            case .dailyReport: return "Daily report"
            case .community: return "Community"
            case .language: return "Language"
            case .recommender: return "Recommender"
            case .assigner: return "Assigner"
            }
        }

        // The route each box reads (GET) and writes. Auto-save is part of the board's general settings.
        var path: String {
            switch self {
            case .autoSave: return "/api/settings"
            case .prompter: return "/api/heartbeat-setting"
            case .geminiCap: return "/api/agycap-setting"
            case .accountCap: return "/api/workcap-setting"
            case .messages: return "/api/limits"
            case .dailyReport: return "/api/feedback-setting"
            case .community: return "/api/community-setting"
            case .language: return "/api/agent-language"
            case .recommender: return "/api/recommender-setting"
            case .assigner: return "/api/assigner-setting"
            }
        }

        // server.js takes POST for the general settings and PUT for every other box.
        var writeMethod: String { self == .autoSave ? "POST" : "PUT" }
    }

    // MARK: The board's words (web/index.html s-sec-automation)

    enum Words {
        static let autoSaveLabel = "Save your agents' progress"
        static let autoSaveHint = "When an agent's context is nearly full, it will automatically be asked to write a handoff document for its future self. On by default."
        static let autoSaveLevel = "Save when context reaches"
        static let prompterLabel = "Check on your agents"
        // The page's line whole: since slice D1d1 the check-ins it points to are below the box on the phone too.
        static let prompterHintPieces = ["Every so often, Kosmos checks on your agents that have stopped while they still have tasks to finish, or that need reconnecting. It can remind the ones with tasks to pick their work back up, and shows a check-in below so you can look in on it. Everything stays on this computer. On by default."]
        static var prompterHint: String { prompterHintPieces[0] }
        static let prompterEvery = "Check every"
        static let capLabel = "Working at the same time"
        static let geminiCapHint = "Gemini agents signed in with a Google subscription on this computer share one Google account's quota, so several working at once can use it up together. Gemini agents on an API key are not counted. With a limit, Kosmos holds its own automatic messages, room posts and the tasks it hands out to the others while that many are working, counting each one it just started for a few minutes, so those can arrive late. Your own messages, and a restart or new team you start, are not held by this limit, though a restart or new team counts toward it. No limit by default."
        static let accountCapHint = "Agents on this computer signed in to the same account share its limits, so many working at once can hit them and their turns fail. With a limit, Kosmos waits to send other agents' room posts, messages that were waiting for an agent, and the tasks it hands out on that account while that many are working, so those can arrive late. Your own messages, and anything Kosmos sends about them, are never held by this limit. A restart or new team you start goes ahead too. Gemini subscription agents have their own limit, above. No limit by default."
        static let capUnreadSaved = "We could not read the saved limit, so no limit applies."
        static let messagesLabel = "Limit how often your agents message each other"
        static let messagesHint = "Every message between your agents is billed to your AI plan. Past the limit below, Kosmos stops them for the rest of the hour. If your model does not charge per use, turn this off."
        static let messagesTier = "Stop them after"
        static let messagesTierUnit = "exchanges an hour"
        static let messagesHigh = "A hundred exchanges an hour can add up if your provider charges per use."
        static let messagesOff = "Your agents will keep talking as long as they have something to say. Kosmos will still tell you when a conversation stops going anywhere, but it will not step in."
        static let dailyReportLabel = "Make Kosmos work better for everyone."
        static let dailyReportHint = "Allow an agent to send a daily note with any system issues or improvement suggestions."
        static let communityLabel = "My agents take part in the Kosmos+ community"
        // Review 1: as the Prompter's, without the clauses that point "below" to the held posts, the kind of business and
        // the list of posts, which stay on the board until D1d.
        // Review 5: the kind of business stays in (a consent switch must say what goes public), only "below" goes.
        static let communityHintPieces = ["They share what they are working on in the Kosmos+ community at community.kosmosplus.com. What they write goes out straight away, unless Kosmos’s safety check stops it", "Their public profiles show each agent’s picture, and the kind of business you pick", ", if you pick one.", "Once three or more of your agents on this Kosmos take part, each one’s profile also lists the others as working alongside it."]
        static var communityHint: String { communityHintPieces[0] + ". " + communityHintPieces[1] + communityHintPieces[2] + " " + communityHintPieces[3] }
        static let communityOff = "Off. Your agents will not post. Any kind of business already on their profiles stays there until you pick None, and a picture stays until you remove it from the agent. Your current agents already shown as working alongside each other stay shown that way while three or more of them are active. Posts and comments already in the community stay up."
        static let communityUnread = "We could not read this setting just now, so it is not shown. It stays as it was; try again in a moment."
        static let languageLabel = "The language your agents write to you in"
        static let languageHint = "Your agents write to you and in your project rooms in this language. Kosmos+ community posts stay in English."
        static let languageAutoUnsure = "Kosmos could not tell this computer’s language, so new agents write in English, and an agent that already had a language from this computer keeps it. Pick a language above to set it for all of them."
        static let languageUnread = "We could not read which language you chose just now. Pick one to set it again; until then your agents keep the language they have."
        static let recommenderLabel = "Let blocked agents recommend and act"
        static let recommenderHint = "When an agent reports it needs a decision, Kosmos asks up to two of its teammates for their view. The agent then decides, writes down why, and carries it out, within the guards below."
        static let recommenderGuardsHead = "Never let a recommendation:"
        static let recommenderGuardsNote = "Your agents are given these as instructions. Kosmos cannot yet stop these actions on its own."
        static let recommenderOff = "Off by default. Your agents will still tell you when they are stuck; they just will not act on it themselves."
        static let assignerLabel = "Turn your goals into assigned work"
        static let assignerHint = "When an agent has had nothing to do for 20 minutes and has not told Kosmos it is still holding work, Kosmos gives it the next task nobody is on in one of its projects, soonest due date first (not a repeating task, which its schedule runs). If a project has no open tasks but its brief states a goal, Kosmos asks the agent to draft a few toward it."
        static let failoverLabel = "Move work when a provider hits its limit"
        static let failoverHint = "When an agent has been paused for 15 minutes by a usage limit that says when it ends, Kosmos gives its unfinished tasks to an idle teammate on the same project that uses a different provider. They stay with that teammate, and the paused agent is told which ones moved. That teammate's work is billed to its own provider's account."
        static let failoverOff = "Off by default."
        static let readFailed = "We could not read this setting just now."
        static let saveFailed = "We could not save that setting."
        static let savedUnread = "Saved, but we could not read it back just now."
        static let dailyReportDamaged = "Your Daily report setting could not be read, so no report is being sent. Turn it on to set it again."
        static let messagesDefault = "We could not read this setting, so Kosmos is using the default shown here."
        static let languageCouldNotRead = "Could not be read just now"
        // Not the page's: the phone's own line for what is not on this screen yet (card #8959, D1d2 to D2). The Prompter's
        // check-ins left it with slice D1d1, which put them under the Prompter box.
        static let elsewhere = "The Community's posts and kind of business, and the rest of your computer's settings are in Settings on your computer's board."
    }

    // The recommender's three guards, in the board's order, with its words.
    enum Guard: String, CaseIterable, Equatable {
        case money, `public`, delete
        var label: String {
            switch self {
            case .money: return "Act on anything that spends money"
            case .public: return "Post anything publicly under my name"
            case .delete: return "Delete anything that has no other copy"
            }
        }
    }

    // Auto-save's levels: fixed in the page itself (web/index.html #ah-threshold), not served by the computer.
    static let autoSaveLevels = [75, 80, 85, 90, 95]

    // As the board labels each choice (web/index.html capLabel, paintHeartbeat).
    static func capLabel(_ n: Int) -> String { n == 0 ? "No limit" : (n == 1 ? "1 agent" : "\(n) agents") }
    static func minutesLabel(_ n: Int) -> String { "\(n) minutes" }
    static func percentLabel(_ n: Int) -> String { "\(n)%" }

    // MARK: What each box reads

    struct AutoSave: Equatable { let on: Bool; let threshold: Int }
    struct Prompter: Equatable { let on: Bool; let minutes: Int; let choices: [Int] }
    struct Cap: Equatable { let max: Int; let choices: [Int]; let savedUnread: Bool }
    struct Messages: Equatable { let on: Bool; let perHour: Int; let tiers: [Int]; var defaultInUse = false }
    struct Community: Equatable { let on: Bool; let stopped: String? }
    struct LanguageOption: Equatable, Identifiable { let tag: String; let name: String; var id: String { tag } }
    struct Language: Equatable {
        let choice: String?         // "auto" or a tag on the list; nil when the computer could not read it
        let options: [LanguageOption]
        let automaticName: String?  // what Automatic reads on this computer, when it is sure
        var automaticLabel: String { automaticName.map { "Automatic: \($0), from this computer" } ?? "Automatic: English for now" }
    }
    struct Recommender: Equatable { let on: Bool; let guards: [Guard: Bool] }
    struct Assigner: Equatable { let on: Bool; let failover: Bool? }   // nil: an older computer that does not say

    // One box's state, as the screen paints it.
    enum State: Equatable {
        // dailyReport's damaged: the computer found its file unreadable and treats it as Off (the page says so).
        case autoSave(AutoSave), prompter(Prompter), cap(Cap), messages(Messages), dailyReport(on: Bool, damaged: Bool)
        case community(Community), language(Language), recommender(Recommender), assigner(Assigner)
    }

    private static func object(_ status: Int, _ data: Data) -> [String: Any]? {
        guard status == 200 else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    // A whole number from JSON (an NSNumber that is not a Bool), else nil.
    private static func int(_ v: Any?) -> Int? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        return d.rounded() == d && d >= 0 && d <= 100_000 ? Int(d) : nil
    }
    private static func bool(_ v: Any?) -> Bool? {
        guard let n = v as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
        return n.boolValue
    }
    private static func ints(_ v: Any?) -> [Int]? {
        guard let a = v as? [Any] else { return nil }
        let out = a.compactMap(int)
        return out.count == a.count && !out.isEmpty ? out : nil
    }
    private static func text(_ v: Any?) -> String? {
        guard let s = v as? String, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return s
    }

    // The box's state from the computer's answer; nil for anything the board would call unreadable, so a failed read
    // never shows a switch in a position nobody saved.
    static func parse(_ box: Box, status: Int, data: Data) -> State? {
        guard let o = object(status, data) else { return nil }
        switch box {
        case .autoSave:
            // GET /api/settings answers { autohandoff: { enabled, threshold } } (engine autohandoff.settingFrom).
            guard let a = o["autohandoff"] as? [String: Any], let on = bool(a["enabled"]) else { return nil }
            return .autoSave(AutoSave(on: on, threshold: int(a["threshold"]) ?? 85))
        case .prompter:
            guard let on = bool(o["on"]), let choices = ints(o["intervals"]) else { return nil }
            return .prompter(Prompter(on: on, minutes: int(o["intervalMinutes"]) ?? 15, choices: choices))
        case .geminiCap, .accountCap:
            guard let choices = ints(o["choices"]) else { return nil }
            return .cap(Cap(max: int(o["maxWorking"]) ?? 0, choices: choices, savedUnread: bool(o["ok"]) == false))
        case .messages:
            guard let on = bool(o["on"]), let tiers = ints(o["tiers"]), let per = int(o["perHour"]) else { return nil }
            return .messages(Messages(on: on, perHour: per, tiers: tiers, defaultInUse: bool(o["ok"]) == false))
        case .dailyReport:
            // As the page reads this privacy switch: readable is exactly ok:true with a boolean on; damaged is exactly
            // {on:false, ok:false}; any other shape is unread, so no unexpected answer is drawn as a position.
            guard let on = bool(o["on"]) else { return nil }
            let ok = bool(o["ok"])
            if ok == false && on == false { return .dailyReport(on: false, damaged: true) }
            guard ok == true else { return nil }
            return .dailyReport(on: on, damaged: false)
        case .community:
            // The board treats ok:false as unread (web/index.html communityPaint).
            guard bool(o["ok"]) != false, let on = bool(o["on"]) else { return nil }
            return .community(Community(on: on, stopped: text(o["stopped"])))
        case .language:
            // As the page: a choice it could not read still shows the list (so the person can set it again), with no
            // choice picked. Only an answer with no list at all is unread.
            guard let list = o["options"] as? [[String: Any]] else { return nil }
            let options = list.compactMap { e -> LanguageOption? in
                guard let tag = text(e["tag"]) else { return nil }
                return LanguageOption(tag: tag, name: text(e["name"]) ?? tag)
            }
            let auto = o["automatic"] as? [String: Any]
            let sure = bool(auto?["sure"]) == true
            return .language(Language(choice: bool(o["ok"]) == true ? (text(o["choice"]) ?? "auto") : nil, options: options,
                                      automaticName: sure ? text(auto?["name"]) : nil))
        case .recommender:
            guard let on = bool(o["on"]) else { return nil }
            let g = o["guards"] as? [String: Any] ?? [:]
            // As the board ticks them: a guard is on unless the computer says false.
            var guards: [Guard: Bool] = [:]
            for k in Guard.allCases { guards[k] = bool(g[k.rawValue]) != false }
            return .recommender(Recommender(on: on, guards: guards))
        case .assigner:
            guard let on = bool(o["on"]) else { return nil }
            return .assigner(Assigner(on: on, failover: bool(o["failover"])))
        }
    }

    // MARK: Requests

    private static func request(_ mac: Settings.Mac, _ path: String, method: String, body: [String: Any]? = nil) -> URLRequest? {
        guard let url = URL(string: path, relativeTo: mac.url)?.absoluteURL else { return nil }
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        r.httpMethod = method
        // As Settings' own requests: the computer's cookie by hand on this one request, and the board's header, so
        // Kosmos+ gives it the Mac's token and the computer reads it as its Settings screen (server.js isViaScreen).
        r.httpShouldHandleCookies = false
        r.setValue("\(Board.macCookieName)=\(mac.cookie)", forHTTPHeaderField: "Cookie")
        r.setValue("same-origin", forHTTPHeaderField: Board.fetchSiteHeader)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return nil }
            r.httpBody = data
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return r
    }

    static func readRequest(_ mac: Settings.Mac, _ box: Box) -> URLRequest? { request(mac, box.path, method: "GET") }

    // One change, as the board sends it. Each write carries only the field that changed, except where the route needs
    // both halves (Auto-save's pair, the messages limit's pair), which the board also sends together.
    enum Change: Equatable {
        case autoSave(on: Bool, threshold: Int)
        case prompterOn(Bool), prompterMinutes(Int)
        case cap(Int)
        case messages(on: Bool, perHour: Int)
        case dailyReport(Bool), community(Bool)
        case language(String)
        case recommenderOn(Bool), recommenderGuard(Guard, Bool)
        case assignerOn(Bool), failover(Bool)
    }

    static func body(_ change: Change) -> [String: Any] {
        switch change {
        case .autoSave(let on, let threshold): return ["autohandoff": ["enabled": on, "threshold": threshold]]
        case .prompterOn(let on): return ["on": on]
        case .prompterMinutes(let m): return ["intervalMinutes": m]
        case .cap(let n): return ["maxWorking": n]
        case .messages(let on, let per): return ["on": on, "perHour": per]
        case .dailyReport(let on), .community(let on), .recommenderOn(let on), .assignerOn(let on): return ["on": on]
        case .language(let choice): return ["choice": choice]
        case .recommenderGuard(let g, let v): return ["guard": g.rawValue, "value": v]
        case .failover(let on): return ["failover": on]
        }
    }

    // Which box a change belongs to; a cap change is sent to the box it was made in.
    static func writeRequest(_ mac: Settings.Mac, _ box: Box, _ change: Change) -> URLRequest? {
        guard accepts(box, change) else { return nil }
        return request(mac, box.path, method: box.writeMethod, body: body(change))
    }

    // A change is only ever sent to its own box's route, so a slip in the screen cannot write one setting's value
    // into another's file.
    static func accepts(_ box: Box, _ change: Change) -> Bool {
        switch (box, change) {
        case (.autoSave, .autoSave), (.prompter, .prompterOn), (.prompter, .prompterMinutes),
             (.geminiCap, .cap), (.accountCap, .cap), (.messages, .messages), (.dailyReport, .dailyReport),
             (.community, .community), (.language, .language), (.recommender, .recommenderOn),
             (.recommender, .recommenderGuard), (.assigner, .assignerOn), (.assigner, .failover):
            return true
        default:
            return false
        }
    }

    // MARK: What the screen says

    // Why a read or a write did not work. 401 and 403: the phone's sign-in line (Board.phoneShutOut). No answer: says so.
    // A read: the page's read line, whatever the body says. A save: the computer's `error` or `because`, else the
    // board's words.
    static func refusal(status: Int, data: Data, writing: Bool) -> String {
        if status == 401 { return Board.phoneShutOut }
        let said = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]).flatMap { text($0["error"]) ?? text($0["because"]) }
        // kosmos#7840's rule (BoardLogic): a 403 is the phone's sign-in line, never anyone's words. Review 5: that includes
        // the computer's isViaScreen sentence ("from Settings" means nothing to a person already in Settings), and a
        // request missing the board header is refused earlier by the board-token check anyway.
        if status == 403 { return Board.phoneShutOut }
        if status == 0 { return "Your computer is not answering. Try again in a moment." }
        // Review 4: a failed read is the page's read line whatever the body says (the page never shows a GET's error);
        // a refused save is the computer's own reason when it gave one (the page shows `error`).
        if !writing { return Words.readFailed }
        return said.map(Settings.sentence) ?? Words.saveFailed
    }

    // Why a read gave no state. A 200 the box could not read is the page's own sentence where it has one (Community's).
    static func readRefusal(_ box: Box, status: Int, data: Data) -> String {
        // Review 5: as the page's communityPaint(null), for every failed read but the sign-in and no-answer ones.
        if box == .community && status != 401 && status != 403 && status != 0 { return Words.communityUnread }
        return refusal(status: status, data: data, writing: false)
    }

    // What a write's answer means. saved: the box's new state. savedUnread: a 200 the box could not read (the setting
    // is saved; the page says "Saved, but we could not read it back just now." and the screen reads it again).
    // refused: nothing changed, with why (the screen still reads again: a write with no answer may have landed).
    enum WriteOutcome: Equatable { case saved(State), savedUnread, refused(String) }
    static func writeOutcome(_ box: Box, status: Int, data: Data) -> WriteOutcome {
        if let s = parse(box, status: status, data: data) {
            // Language: a save the computer could not read back is saved, unread (the page's first case).
            if case .language(let l) = s, l.choice == nil { return .savedUnread }
            return .saved(s)
        }
        // Review 2: only a JSON answer counts as the computer's (a gate or captive page can answer 200 with HTML, and
        // the setting did not change); anything else is refused, and the screen reads again to show what is there.
        if object(status, data) != nil { return .savedUnread }
        if status == 200 { return .refused(Words.saveFailed) }
        return .refused(refusal(status: status, data: data, writing: true))
    }

    // After a Language save, what happens to running agents, in the page's words (web/index.html agentLanguageChange).
    static func languageSaved(status: Int, data: Data) -> String? {
        // Only a .saved outcome calls this, which for Language means ok:true (writeOutcome), so ok is not read again.
        guard let o = object(status, data) else { return nil }
        let n = (o["couldNot"] as? NSNumber)?.intValue ?? 0
        let changed = (o["changed"] as? NSNumber)?.intValue ?? 0
        let removed = (o["removed"] as? NSNumber)?.intValue ?? 0
        if n < 0 { return "Saved. Your agents pick it up the next time Kosmos starts." }
        if n > 0 { return "Saved. \(n)" + (n == 1 ? " agent" : " agents") + " could not be changed just now and keep the language they have until Kosmos next starts." }
        if changed == 0 { return "Saved." }
        if removed == changed { return "Saved. New agents use it now. Agents already running drop their old language the next time they start." }
        if removed > 0 { return "Saved. Some agents switch to it once they finish what they are doing; the rest drop their old language the next time they start." }
        return "Saved. Your agents switch to it once they finish what they are doing."
    }

    // The lines under each box, as the board shows them for that state (web/index.html paint functions).
    static func notes(_ state: State) -> [String] {
        switch state {
        case .cap(let c): return c.savedUnread ? [Words.capUnreadSaved] : []
        case .messages(let m):
            var out = m.defaultInUse ? [Words.messagesDefault] : []
            if !m.on { out.append(Words.messagesOff) } else if m.perHour == 100 { out.append(Words.messagesHigh) }
            return out
        case .dailyReport(_, let damaged): return damaged ? [Words.dailyReportDamaged] : []
        case .community(let c):
            var out: [String] = []
            if !c.on { out.append(Words.communityOff) }
            if let s = c.stopped { out.append(Settings.sentence(s)) }
            return out
        case .language(let l):
            if l.choice == nil { return [Words.languageUnread] }
            return l.choice == "auto" && l.automaticName == nil ? [Words.languageAutoUnsure] : []
        case .recommender(let r): return r.on ? [Words.recommenderGuardsNote] : [Words.recommenderOff]
        case .assigner, .autoSave, .prompter: return []
        }
    }

    // The level and interval rows show only while their switch is on, and the failover row only while the Assigner is
    // on and the computer said where failover stands (an older computer's answer leaves it out: unknown, not Off).
    static func failoverShown(_ a: Assigner) -> Bool { a.on && a.failover != nil }

    // What a sample build's computer answers (KOSMOS_SAMPLE_AGENTS, a Debug build only), in each route's own shape, for
    // screenshots and the UI test. Every box parses from it (the logic suite checks), so a sample never shows "unread".
    static func sampleAnswer(_ box: Box) -> String {
        switch box {
        case .autoSave: return #"{"timezone":null,"autohandoff":{"enabled":true,"threshold":85},"setupAssistant":null,"waitingBadge":true}"#
        case .prompter: return #"{"on":true,"intervalMinutes":15,"intervals":[5,10,15,30,60],"ok":true}"#
        // The lists are the engine's own (engine/agycap-setting.js, workcap-setting.js, limits.js, heartbeat-setting.js;
        // the logic suite compares them), so a screenshot never shows a choice no computer offers.
        case .geminiCap: return #"{"maxWorking":0,"choices":[0,1,2,3,4],"ok":true}"#
        case .accountCap: return #"{"maxWorking":4,"choices":[0,2,4,6,8,12,16],"ok":true}"#
        case .messages: return #"{"on":true,"perHour":40,"ok":true,"tiers":[10,20,40,100]}"#
        case .dailyReport: return #"{"on":false,"ok":true}"#
        case .community: return #"{"on":true,"ok":true,"share":null,"stopped":null}"#
        case .language: return #"{"choice":"auto","ok":true,"options":[{"tag":"en","name":"English"},{"tag":"es-419","name":"Spanish (Latin America)"}],"automatic":{"tag":"en","name":"English","sure":true}}"#
        case .recommender: return #"{"on":true,"guards":{"money":true,"public":true,"delete":true},"guardKeys":["money","public","delete"],"ok":true}"#
        case .assigner: return #"{"on":true,"failover":false,"ok":true}"#
        }
    }

    // A box's state with one change made, as the computer would answer it. Only a sample build uses it (it has no
    // computer to answer); a real screen always repaints from the computer's answer. A change for another box leaves
    // the state as it was.
    static func applying(_ change: Change, to state: State) -> State {
        switch (state, change) {
        case (.autoSave, .autoSave(let on, let t)): return .autoSave(AutoSave(on: on, threshold: t))
        case (.prompter(let p), .prompterOn(let on)): return .prompter(Prompter(on: on, minutes: p.minutes, choices: p.choices))
        case (.prompter(let p), .prompterMinutes(let m)): return .prompter(Prompter(on: p.on, minutes: m, choices: p.choices))
        case (.cap(let c), .cap(let n)): return .cap(Cap(max: n, choices: c.choices, savedUnread: false))
        case (.messages(let m), .messages(let on, let per)): return .messages(Messages(on: on, perHour: per, tiers: m.tiers))
        case (.dailyReport, .dailyReport(let on)): return .dailyReport(on: on, damaged: false)
        case (.community(let c), .community(let on)): return .community(Community(on: on, stopped: c.stopped))
        case (.language(let l), .language(let choice)):
            return .language(Language(choice: choice, options: l.options, automaticName: l.automaticName))
        case (.recommender(let r), .recommenderOn(let on)): return .recommender(Recommender(on: on, guards: r.guards))
        case (.recommender(let r), .recommenderGuard(let g, let v)):
            var guards = r.guards
            guards[g] = v
            return .recommender(Recommender(on: r.on, guards: guards))
        case (.assigner(let a), .assignerOn(let on)): return .assigner(Assigner(on: on, failover: a.failover))
        case (.assigner(let a), .failover(let on)): return .assigner(Assigner(on: a.on, failover: on))
        default: return state
        }
    }

    // A choice list that also holds the value the computer has, so a stored value the list no longer offers still
    // shows as itself rather than as the first choice.
    static func choices(_ list: [Int], keeping current: Int) -> [Int] {
        list.contains(current) ? list : (list + [current]).sorted()
    }
}
