import Foundation
// Tests for the native Automation screen's logic (kosmos#8959 slice D1a), compiled for macOS with the app files
// run-automation.sh lists. It prints every case and ends with one verdict line; a missing verdict means the run did not
// finish.
setvbuf(stdout, nil, _IOLBF, 0)
var passed = 0
var failed = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: Int = #line) {
    if cond() {
        passed += 1
        print("  ok   \(name)")
    } else {
        failed += 1
        print("  FAIL \(name) (line \(line))")
    }
}
func section(_ name: String) { print(name) }
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? FileManager.default.currentDirectoryPath)
func repoText(_ path: String) -> String { (try? String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)) ?? "" }
func json(_ s: String) -> Data { Data(s.utf8) }
func sent(_ r: URLRequest?) -> [String: Any]? { r?.httpBody.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] } }

let mac = Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "c00kie")

section("each box reads its own route on the kept computer, signed as the board's own")
for box in Automation.Box.allCases {
    let r = Automation.readRequest(mac, box)
    check(r?.httpMethod == "GET" && r?.url?.absoluteString == "https://studio.kosmosplus.com" + box.path, "\(box.rawValue): GET \(box.path)")
    check(r?.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && r?.httpShouldHandleCookies == false,
          "\(box.rawValue): the kept cookie by hand, no jar")
    check(r?.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin", "\(box.rawValue): the board's header (server.js isViaScreen)")
}

section("each change is sent as the board sends it")
func write(_ box: Automation.Box, _ c: Automation.Change) -> URLRequest? { Automation.writeRequest(mac, box, c) }
let ah = write(.autoSave, .autoSave(on: false, threshold: 90))
check(ah?.httpMethod == "POST" && (sent(ah)?["autohandoff"] as? [String: Any])?["enabled"] as? Bool == false
      && (sent(ah)?["autohandoff"] as? [String: Any])?["threshold"] as? Int == 90, "Auto-save POSTs { autohandoff: { enabled, threshold } }")
check(write(.prompter, .prompterOn(true)).map { sent($0)?["on"] as? Bool == true && $0.httpMethod == "PUT" } == true, "Prompter on is PUT { on }")
check(sent(write(.prompter, .prompterMinutes(30)))?["intervalMinutes"] as? Int == 30 && sent(write(.prompter, .prompterMinutes(30)))?.count == 1,
      "the interval alone is { intervalMinutes }")
check(sent(write(.geminiCap, .cap(2)))?["maxWorking"] as? Int == 2 && write(.geminiCap, .cap(2))?.url?.path == "/api/agycap-setting", "the Gemini cap")
check(write(.accountCap, .cap(3))?.url?.path == "/api/workcap-setting", "the account cap goes to its own route")
let lim = sent(write(.messages, .messages(on: true, perHour: 40)))
check(lim?["on"] as? Bool == true && lim?["perHour"] as? Int == 40, "the messages limit sends both halves, as the board does")
check(sent(write(.dailyReport, .dailyReport(false)))?["on"] as? Bool == false, "Daily report { on }")
check(sent(write(.community, .community(true)))?["on"] as? Bool == true, "Community { on }")
check(sent(write(.language, .language("pt-BR")))?["choice"] as? String == "pt-BR", "Language { choice }")
let g = sent(write(.recommender, .recommenderGuard(.public, false)))
check(g?["guard"] as? String == "public" && g?["value"] as? Bool == false && g?.count == 2, "one guard at a time, so the others are never reset")
check(sent(write(.assigner, .failover(true)))?["failover"] as? Bool == true && sent(write(.assigner, .failover(true)))?.count == 1, "failover alone")
check(write(.assigner, .assignerOn(true))?.value(forHTTPHeaderField: "Content-Type") == "application/json", "as JSON")

section("a change is never sent to another box's route")
check(write(.geminiCap, .community(true)) == nil, "a community change is not sent to the Gemini cap")
check(write(.dailyReport, .assignerOn(true)) == nil, "an Assigner change is not sent to the Daily report")
check(write(.autoSave, .prompterOn(true)) == nil, "a Prompter change is not sent to the general settings")
var paired = 0
for box in Automation.Box.allCases {
    for c: Automation.Change in [.autoSave(on: true, threshold: 85), .prompterOn(true), .prompterMinutes(15), .cap(0), .messages(on: true, perHour: 40),
                                 .dailyReport(true), .community(true), .language("auto"), .recommenderOn(true),
                                 .recommenderGuard(.money, true), .assignerOn(true), .failover(true)] where Automation.accepts(box, c) { paired += 1 }
}
check(paired == 13, "thirteen pairs in all: every change has exactly one box, the cap two (counted \(paired))")

section("the answers, read as the board reads them")
func state(_ box: Automation.Box, _ s: String, status: Int = 200) -> Automation.State? { Automation.parse(box, status: status, data: json(s)) }
check(state(.autoSave, #"{"timezone":null,"autohandoff":{"enabled":false,"threshold":90}}"#) == .autoSave(.init(on: false, threshold: 90)), "Auto-save")
check(state(.autoSave, #"{"timezone":null}"#) == nil, "no autohandoff block: unread, not On")
check(state(.prompter, #"{"on":true,"intervalMinutes":30,"intervals":[15,30,60],"ok":true}"#) == .prompter(.init(on: true, minutes: 30, choices: [15, 30, 60])), "Prompter")
check(state(.prompter, #"{"on":true,"intervalMinutes":30}"#) == nil, "no choices from the computer: unread, never a list made up here")
check(state(.geminiCap, #"{"maxWorking":2,"choices":[0,1,2,3],"ok":true}"#) == .cap(.init(max: 2, choices: [0, 1, 2, 3], savedUnread: false)), "a cap")
let unreadCap = state(.accountCap, #"{"maxWorking":0,"choices":[0,1,2],"ok":false}"#)
check(unreadCap == .cap(.init(max: 0, choices: [0, 1, 2], savedUnread: true)) && unreadCap.map(Automation.notes) == [Automation.Words.capUnreadSaved],
      "a saved limit the computer could not read says so, not a quiet No limit")
check(state(.messages, #"{"on":true,"perHour":40,"ok":true,"tiers":[20,40,100]}"#) == .messages(.init(on: true, perHour: 40, tiers: [20, 40, 100])), "the messages limit")
if case .messages(let m)? = state(.messages, #"{"on":true,"perHour":40,"ok":false,"tiers":[20,40,100]}"#) {
    check(m.defaultInUse && Automation.notes(.messages(m)) == [Automation.Words.messagesDefault], "a default in use says so, not as the person's choice")
} else { check(false, "a default limit parses") }
check(state(.dailyReport, #"{"on":true,"ok":true}"#) == .dailyReport(on: true, damaged: false), "Daily report")
check(state(.dailyReport, #"{"on":false,"ok":false}"#) == .dailyReport(on: false, damaged: true), "a damaged file is Off, and said so")
check(Automation.notes(.dailyReport(on: false, damaged: true)) == [Automation.Words.dailyReportDamaged], "the damaged file's sentence")
check(state(.dailyReport, #"{"on":true}"#) == nil && state(.dailyReport, #"{"on":true,"ok":false}"#) == nil,
      "no ok, or ok:false with on:true, is unread: never a position on this privacy switch")
check(state(.dailyReport, #"{"on":"yes"}"#) == nil, "a string is not a switch")
check(state(.dailyReport, #"{"on":1}"#) == nil, "a number is not a switch")
check(state(.community, #"{"on":true,"ok":true,"share":null,"stopped":null}"#) == .community(.init(on: true, stopped: nil)), "Community")
check(state(.community, #"{"on":true,"ok":false}"#) == nil, "Community ok:false is unread, as the board paints it")
let lang = state(.language, #"{"choice":"auto","ok":true,"options":[{"tag":"en","name":"English"},{"tag":"pt-BR","name":"Portuguese (Brazil)"}],"automatic":{"tag":"pt-BR","name":"Portuguese (Brazil)","sure":true}}"#)
if case .language(let l)? = lang {
    check(l.choice == "auto" && l.options.map(\.tag) == ["en", "pt-BR"] && l.automaticLabel == "Automatic: Portuguese (Brazil), from this computer", "Language, Automatic named")
    check(Automation.notes(.language(l)).isEmpty, "a sure Automatic needs no note")
} else { check(false, "Language parses") }
if case .language(let l)? = state(.language, #"{"choice":"auto","ok":true,"options":[],"automatic":{"tag":null,"name":null,"sure":false}}"#) {
    check(l.automaticLabel == "Automatic: English for now" && Automation.notes(.language(l)) == [Automation.Words.languageAutoUnsure], "an unsure Automatic says English for now, and why")
} else { check(false, "an unsure Automatic parses") }
if case .language(let l)? = state(.language, #"{"choice":"en","ok":false,"options":[{"tag":"en","name":"English"}],"automatic":{"tag":"en","name":"English","sure":true}}"#) {
    check(l.choice == nil && l.options.count == 1 && Automation.notes(.language(l)) == [Automation.Words.languageUnread],
          "a choice the computer could not read still shows the list, with no choice and the page's sentence")
} else { check(false, "an unread choice still parses its list") }
check(state(.language, #"{"choice":null,"ok":false}"#) == nil, "no list at all is unread")
if case .recommender(let r)? = state(.recommender, #"{"on":true,"guards":{"money":false},"guardKeys":["money","public","delete"],"ok":true}"#) {
    check(r.guards[.money] == false && r.guards[.public] == true && r.guards[.delete] == true, "a guard is on unless the computer says false")
} else { check(false, "Recommender parses") }
check(state(.assigner, #"{"on":true,"failover":false,"ok":true}"#) == .assigner(.init(on: true, failover: false)), "Assigner")
if case .assigner(let a)? = state(.assigner, #"{"on":true,"ok":true}"#) {
    check(a.failover == nil && !Automation.failoverShown(a), "an older computer without failover: unknown, so the row is not shown")
} else { check(false, "an older Assigner parses") }
check(!Automation.failoverShown(.init(on: false, failover: true)), "failover shows only while the Assigner is on")
for box in Automation.Box.allCases {
    check(Automation.parse(box, status: 500, data: json(#"{"on":true}"#)) == nil && Automation.parse(box, status: 200, data: json("<html>")) == nil,
          "\(box.rawValue): a failed or foreign answer is never a setting")
}

for box in Automation.Box.allCases {
    check(Automation.parse(box, status: 200, data: json(Automation.sampleAnswer(box))) != nil, "\(box.rawValue): the sample build's answer parses")
}

section("a sample build applies a change to its own copy, and only to its own box")
let r0 = Automation.State.recommender(.init(on: true, guards: [.money: true, .public: true, .delete: true]))
check(Automation.applying(.recommenderGuard(.delete, false), to: r0) == .recommender(.init(on: true, guards: [.money: true, .public: true, .delete: false])),
      "one guard changes, the others stay")
check(Automation.applying(.prompterMinutes(30), to: .prompter(.init(on: true, minutes: 15, choices: [15, 30]))) == .prompter(.init(on: true, minutes: 30, choices: [15, 30])),
      "the interval changes, the switch stays")
check(Automation.applying(.community(false), to: .dailyReport(on: true, damaged: false)) == .dailyReport(on: true, damaged: false), "another box's change leaves the state as it was")
check(Automation.applying(.dailyReport(true), to: .dailyReport(on: false, damaged: true)) == .dailyReport(on: true, damaged: false), "turning a damaged Daily report on sets it again")
check(Automation.applying(.failover(true), to: .assigner(.init(on: true, failover: false))) == .assigner(.init(on: true, failover: true)), "failover")

section("the sample offers only what a computer offers")
let engineFiles: [Automation.Box: String] = [.prompter: "engine/heartbeat-setting.js", .geminiCap: "engine/agycap-setting.js",
                                             .accountCap: "engine/workcap-setting.js", .messages: "engine/limits.js"]
for (box, file) in engineFiles {
    let src = repoText(file)
    var list: [Int] = []
    var current = -1
    switch Automation.parse(box, status: 200, data: json(Automation.sampleAnswer(box))) {
    case .prompter(let p)?: list = p.choices; current = p.minutes
    case .cap(let c)?: list = c.choices; current = c.max
    case .messages(let m)?: list = m.tiers; current = m.perHour
    default: break
    }
    let literal = "[" + list.map(String.init).joined(separator: ", ") + "]"
    check(!src.isEmpty && !list.isEmpty && src.contains(literal), "\(box.rawValue): the sample's list \(literal) is \(file)'s own")
    check(list.contains(current), "\(box.rawValue): the sample's value \(current) is one of them")
}

section("the notes under each box follow the state, as the board's")
check(Automation.notes(.messages(.init(on: false, perHour: 40, tiers: [40]))) == [Automation.Words.messagesOff], "off: the off sentence")
check(Automation.notes(.messages(.init(on: true, perHour: 100, tiers: [100]))) == [Automation.Words.messagesHigh], "top tier: the cost line")
check(Automation.notes(.messages(.init(on: true, perHour: 40, tiers: [40]))).isEmpty, "otherwise nothing, so the caution is read when it shows")
check(Automation.notes(.community(.init(on: true, stopped: "a policy keeps agents out"))) == ["A policy keeps agents out."], "a policy stop is said under the switch")
check(Automation.notes(.community(.init(on: false, stopped: nil))) == [Automation.Words.communityOff], "Community off")
check(Automation.notes(.recommender(.init(on: false, guards: [:]))) == [Automation.Words.recommenderOff], "Recommender off")

section("what a save's answer means")
check(Automation.writeOutcome(.dailyReport, status: 200, data: json(#"{"on":true,"ok":true}"#)) == .saved(.dailyReport(on: true, damaged: false)), "saved, with the new state")
check(Automation.writeOutcome(.prompter, status: 200, data: json("{}")) == .savedUnread, "a 200 the box cannot read is saved, not failed")
check(Automation.writeOutcome(.dailyReport, status: 200, data: json("<html>sign in</html>")) == .refused(Automation.Words.saveFailed),
      "a 200 page that is not JSON (a gate, a captive page) is not a save")
check(Automation.writeOutcome(.language, status: 200, data: json(#"{"choice":null,"ok":false,"options":[],"changed":0,"removed":0,"couldNot":0}"#)) == .savedUnread,
      "a Language save the computer could not read back is saved, unread (the page's first case)")
check(Automation.writeOutcome(.geminiCap, status: 403, data: json(#"{"error":"only you can change this, from Settings"}"#)) == .refused("Only you can change this, from Settings."),
      "a refusal, with the computer's sentence")
check(Automation.writeOutcome(.assigner, status: 0, data: json("")) == .refused("Your computer is not answering. Try again in a moment."), "no answer is a refusal (and the screen reads again)")
func lang(_ s: String) -> String? { Automation.languageSaved(status: 200, data: json(s)) }
check(lang(#"{"ok":true,"changed":3,"removed":0,"couldNot":0}"#) == "Saved. Your agents switch to it once they finish what they are doing.", "agents told")
check(lang(#"{"ok":true,"changed":0,"removed":0,"couldNot":0}"#) == "Saved.", "nobody to tell")
check(lang(#"{"ok":true,"changed":2,"removed":2,"couldNot":0}"#) == "Saved. New agents use it now. Agents already running drop their old language the next time they start.", "all removed")
check(lang(#"{"ok":true,"changed":3,"removed":1,"couldNot":0}"#) == "Saved. Some agents switch to it once they finish what they are doing; the rest drop their old language the next time they start.", "some removed")
check(lang(#"{"ok":true,"changed":0,"removed":0,"couldNot":1}"#) == "Saved. 1 agent could not be changed just now and keep the language they have until Kosmos next starts.", "one could not")
check(lang(#"{"ok":true,"changed":0,"removed":0,"couldNot":-1}"#) == "Saved. Your agents pick it up the next time Kosmos starts.", "none now, all at the next start")
check(lang(#"{"ok":false}"#) == Automation.Words.savedUnread, "saved, unread")
check(Automation.readRefusal(.community, status: 200, data: json(#"{"on":true,"ok":false}"#)) == Automation.Words.communityUnread, "Community's own could-not-read sentence")
check(Automation.readRefusal(.prompter, status: 200, data: json("{}")) == Automation.Words.readFailed, "the others say the page's general one")

section("labels and lists")
check(Automation.capLabel(0) == "No limit" && Automation.capLabel(1) == "1 agent" && Automation.capLabel(4) == "4 agents", "cap labels, as the board's capLabel")
check(Automation.minutesLabel(15) == "15 minutes" && Automation.percentLabel(85) == "85%", "interval and level labels")
check(Automation.choices([15, 30], keeping: 45) == [15, 30, 45] && Automation.choices([15, 30], keeping: 30) == [15, 30], "a stored value not on the list still shows as itself")

section("refusals keep the computer's own sentence")
check(Automation.refusal(status: 403, data: json(#"{"error":"only you can change this, from Settings"}"#), writing: true) == "Only you can change this, from Settings.",
      "a 403 with a sentence is that sentence, not the sign-in line")
check(Automation.refusal(status: 401, data: json(#"{"error":"x"}"#), writing: false) == Board.phoneShutOut, "a 401 is the phone's sign-in")
check(Automation.refusal(status: 403, data: json("<html>"), writing: false) == Board.phoneShutOut, "a bare 403 (the gate) is too")
check(Automation.refusal(status: 400, data: json(#"{"error":"that has to be on or off"}"#), writing: true) == "That has to be on or off.", "the computer's reason")
check(Automation.refusal(status: 400, data: json(#"{"ok":false,"because":"that is not a valid auto-handoff setting"}"#), writing: true) == "That is not a valid auto-handoff setting.",
      "Auto-save's route says `because`, and that is read too")
check(Automation.refusal(status: 500, data: json(""), writing: true) == Automation.Words.saveFailed, "a failed save, in the board's words")
check(Automation.refusal(status: 500, data: json(""), writing: false) == Automation.Words.readFailed, "a failed read is not called a save")
check(Automation.refusal(status: 0, data: json(""), writing: false) == "Your computer is not answering. Try again in a moment.", "no answer says so")

section("the words are the board page's own, and the routes are the computer's")
let page = repoText("web/index.html")
let server = repoText("server.js")
check(page.count > 100_000 && server.count > 100_000, "the page and the server were read (\(page.count), \(server.count) bytes)")
let W = Automation.Words.self
let pageWords = [W.autoSaveLabel, W.autoSaveHint, W.autoSaveLevel, W.prompterLabel] + W.prompterHintPieces + [W.prompterEvery, W.capLabel,
                 W.geminiCapHint, W.accountCapHint, W.capUnreadSaved, W.messagesLabel, W.messagesHint, W.messagesTier, W.messagesTierUnit,
                 W.messagesHigh, W.messagesOff, W.dailyReportLabel, W.dailyReportHint, W.communityLabel] + W.communityHintPieces + [W.communityOff,
                 W.communityUnread, W.languageLabel, W.languageHint, W.languageAutoUnsure, W.languageUnread, W.recommenderLabel,
                 W.recommenderHint, W.recommenderGuardsNote, W.recommenderOff, W.assignerLabel, W.assignerHint, W.failoverLabel,
                 W.failoverHint, W.failoverOff, W.readFailed, W.saveFailed, W.recommenderGuardsHead, W.savedUnread, W.dailyReportDamaged,
                 W.messagesDefault, W.languageCouldNotRead,
                 "Saved. Your agents pick it up the next time Kosmos starts.", " could not be changed just now and keep the language they have until Kosmos next starts.",
                 "Saved. New agents use it now. Agents already running drop their old language the next time they start.",
                 "Saved. Some agents switch to it once they finish what they are doing; the rest drop their old language the next time they start.",
                 "Saved. Your agents switch to it once they finish what they are doing."]
check(!W.prompterHint.contains("below") && !W.communityHint.contains("below") && !W.communityOff.contains("below"),
      "nothing shown points below to a list the phone does not have")
for w in pageWords { check(page.contains(w), "on the page: \(w.prefix(48))") }
for b in Automation.Box.allCases { check(page.contains(">\(b.title)<"), "heading on the page: \(b.title)") }
for g in Automation.Guard.allCases { check(page.contains(g.label), "guard on the page: \(g.label)") }
check(page.contains("<option value=\"75\">75%</option>") && page.contains("<option value=\"95\">95%</option>") && Automation.autoSaveLevels == [75, 80, 85, 90, 95],
      "Auto-save's levels are the page's fixed list")
let stepUp = server.range(of: "const REMOTE_STEP_UP_EXACT = new Set([").flatMap { start in
    server.range(of: "]);", range: start.upperBound..<server.endIndex).map { String(server[start.upperBound..<$0.lowerBound]) }
} ?? ""
check(stepUp.contains("'POST /api/update'"), "the step-up list was found (control: it holds POST /api/update)")
for b in Automation.Box.allCases {
    check(server.contains("pathname === '\(b.path)' && req.method === '\(b.writeMethod)'"), "\(b.rawValue): the computer has \(b.writeMethod) \(b.path)")
    check(!stepUp.contains(" \(b.path)'"), "\(b.rawValue): not a step-up route, so a phone session can change it")
}

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
