import Foundation
// Tests for the agent page (kosmos#7267: Profile | AI Settings), compiled for macOS with the files run-agentinfo.sh
// lists. It prints every case and ends with one verdict line; a missing verdict means the run did not finish.
setvbuf(stdout, nil, _IOLBF, 0)
var passed = 0
var failed = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: Int = #line) {
    if cond() { passed += 1; print("  ok   \(name)") } else { failed += 1; print("  FAIL \(name) (line \(line))") }
}
func section(_ name: String) { print(name) }
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? ".")
let boardPage = (try? String(contentsOf: repo.appendingPathComponent("web/index.html"), encoding: .utf8)) ?? ""
check(boardPage.count > 100_000, "premise: the board's page was read")
let mac = URL(string: "https://studio.kosmosplus.com")!

section("one agent's row of /api/status")
let status = #"{"agents":[{"sessionName":"cleo","name":"Cleo","role":"Designer","runner":"","modelName":"Opus 5.5","running":true,"profile":{"reportsTo":"dana"},"account":{"label":"Work account","provider":"anthropic"}},{"sessionName":"gus","name":"","runner":"codex","modelName":"o3","running":false,"state":"stopped","plannedModelName":"GPT 5.6 Sol","account":{"provider":"alibaba"}},{"sessionName":"eli","runner":"gemini","running":true,"modelName":"Gemini 3.8 Flash","settingModelName":"Gemini 3.8 Pro"}]}"#
let cleo = Board.parseAgentDetails(Data(status.utf8), session: "cleo")
check(cleo?.name == "Cleo" && cleo?.role == "Designer" && cleo?.reportsTo == "dana" && cleo?.accountLabel == "Work account", "the fields the page reads")
let roles = Board.parseAgentDetails(Data(#"{"agents":[{"sessionName":"r","role":"From the file","profile":{"role":"Saved by the person"}}]}"#.utf8), session: "r")
check(roles?.role == "Saved by the person", "the saved role first, as the board (review 2)")
let parsedOnly = Board.parseAgentDetails(Data(#"{"agents":[{"sessionName":"p","role":"project manager"}]}"#.utf8), session: "p")!
let seo = Board.parseAgentDetails(Data(#"{"agents":[{"sessionName":"q","role":"SEO specialist"}]}"#.utf8), session: "q")!
let titles = Board.parseRoleTitles(Data(#"{"roles":[{"label":"Project Manager"},{"label":""}]}"#.utf8))
check(Board.roleLine(parsedOnly, titles: titles) == "Project Manager", "a parsed role that is one of the catalogue's: its own label (review 3)")
check(Board.roleLine(parsedOnly, titles: nil) == "Project manager" && Board.roleLine(seo, titles: titles) == "SEO specialist", "else a capital first letter only, never title case")
check(Board.roleLine(roles!, titles: ["saved by the person": "X"]) == "Saved by the person", "a chosen role is never rewritten")
check(boardPage.contains("return parsed.charAt(0).toUpperCase() + parsed.slice(1);") && boardPage.contains("const known = titles && titles.get(parsed.trim().toLowerCase());"), "the board's roleLine still")
let failedRestart = Board.parseAgentDetails(Data(#"{"agents":[{"sessionName":"f","state":"needs_you","disruption":{"failed":true},"modelName":"Opus 5","plannedModelName":"Haiku 4.5"}]}"#.utf8), session: "f")!
check(failedRestart.stopped && Board.modelLine(failedRestart) == "Claude Haiku 4.5", "a restart that did not come back is not running, as the board's card")
func acct(_ a: String) -> String? { Board.parseAgentDetails(Data(("{\"agents\":[{\"sessionName\":\"a\",\"account\":" + a + "}]}").utf8), session: "a")?.accountLabel }
check(acct(#"{"name":"Work","email":"w@x","keyTail":"1234","label":"account-b"}"#) == "Work" && acct(#"{"email":"w@x","label":"account-b"}"#) == "w@x"
      && acct(#"{"keyTail":"1234","label":"account-b"}"#) == "API key ending 1234" && acct(#"{"label":"account-b"}"#) == "account-b", "the board's acctParenthetical order")
check(boardPage.contains("acct.name || acct.email || (acct.keyTail ? 'API key ending ' + acct.keyTail : '') || acct.label"), "the board's order still")
let stoppedLive = Board.parseAgentDetails(Data(#"{"agents":[{"sessionName":"s","state":"stopped","running":true,"modelName":"Opus 5","plannedModelName":"Haiku 4.5"}]}"#.utf8), session: "s")!
check(stoppedLive.stopped && Board.modelLine(stoppedLive) == "Claude Haiku 4.5", "a live pane in state stopped: what it will start on, as the board's card")
check(Board.parseAgentDetails(Data(status.utf8), session: "nobody") == nil, "an agent not in the answer: nothing, never another agent's row")
check(Board.parseAgentDetails(Data("<html>sign in</html>".utf8), session: "cleo") == nil, "the gate's sign-in page is not a read")
let gus = Board.parseAgentDetails(Data(status.utf8), session: "gus")!
check(gus.name == "gus" && gus.running == false, "an empty name falls back to the session; running false is read")

section("the model line, as the board's modelLine")
check(Board.modelLine(cleo!) == "Claude Opus 5.5", "Claude: provider first")
func d(_ runner: String, model: String? = nil, planned: String? = nil, setting: String? = nil, running: Bool = true, provider: String? = nil, never: Bool = false, stopped: Bool = false) -> Board.AgentDetails {
    Board.AgentDetails(session: "x", name: "X", role: nil, reportsTo: nil, runner: runner, modelName: model, plannedModelName: planned,
                       settingModelName: setting, neverRecorded: never, accountProvider: provider, accountLabel: nil, running: running, stopped: stopped)
}
check(Board.modelLine(d("", model: "Claude Haiku 4.5")) == "Claude Haiku 4.5", "no Claude Claude")
check(Board.modelLine(d("", model: "Opus 5", planned: "Haiku 4.5", running: false, stopped: true)) == "Claude Haiku 4.5", "stopped: what it will start on")
check(Board.modelLine(d("", model: "Opus 5", planned: "Haiku 4.5", running: true)) == "Claude Opus 5", "running: what it runs")
check(Board.modelLine(gus) == "Qwen GPT 5.6 Sol" , "Qwen runs on codex and is never OpenAI")
check(Board.modelLine(d("codex", model: "o3")) == "OpenAI o3" && Board.modelLine(d("codex", model: "GPT 5.6")) == "GPT 5.6" && Board.modelLine(d("codex")) == "OpenAI Codex", "codex")
check(Board.modelLine(Board.parseAgentDetails(Data(status.utf8), session: "eli")!) == "Gemini 3.8 Flash (set to Gemini 3.8 Pro)", "a Gemini that fell back says what it was set to")
check(Board.modelLine(d("grok")) == "Grok" && Board.modelLine(d("antigravity")) == "Gemini (Google subscription)" && Board.modelLine(d("muse")) == "Meta Muse", "the provider while no model is known")
check(Board.modelLine(d("")) == "Unknown Model" && Board.modelLine(d("", never: true)) == "Made before Kosmos recorded this", "no model: the board's two words")
for phrase in ["if (a.runner === 'codex') return name ? (/^(?:gpt|openai|codex)\\b/i.test(name) ? name : 'OpenAI ' + name) : 'OpenAI Codex';",
               "if (a.runner === 'antigravity') return name || 'Gemini (Google subscription)';",
               "if (!name) return a.neverRecorded === true ? 'Made before Kosmos recorded this' : 'Unknown Model';",
               "return /^claude/i.test(name) ? name : 'Claude ' + name;"] {
    check(boardPage.contains(phrase), "the board's modelLine still says: \(phrase.prefix(60))")
}
check(Board.runnerMark(d("")) == "MarkClaude" && Board.runnerMark(gus) == "MarkQwen" && Board.runnerMark(d("codex")) == "MarkOpenAI"
      && Board.runnerMark(d("antigravity")) == "MarkGemini" && Board.runnerMark(d("muse")) == "MarkMeta" && Board.runnerMark(d("weird")) == nil, "each runner's mark")
check(Board.reportsToWords(cleo!, names: ["dana": "Dana"]) == "Dana" && Board.reportsToWords(gus, names: [:]) == "You", "reports to: a name, or you")

section("saving the name and role")
let save = Board.profileSaveRequest(mac: mac, session: "cleo", name: " Cleo ", role: "Lead designer", shownName: "Cleo")
let saveBody = save?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
check(save?.httpMethod == "PUT" && save?.url?.path == "/api/agent/cleo/profile", "PUT to the agent's profile")
check(saveBody?["role"] as? String == "Lead designer" && saveBody?["displayName"] == nil, "an unchanged name is not sent (never re-checked for a clash)")
let renamed = Board.profileSaveRequest(mac: mac, session: "cleo", name: "Cleo B", role: "", shownName: "Cleo")
check((renamed?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] })?["displayName"] as? String == "Cleo B", "a changed name is")
check(Board.profileSaveRequest(mac: mac, session: "cleo", name: "  ", role: "", shownName: "Cleo") == nil, "no name: nothing sent")
let long = Board.profileSaveRequest(mac: mac, session: "cleo", name: String(repeating: "n", count: 81), role: String(repeating: "r", count: 90), shownName: "Cleo")
let longBody = long?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
check((longBody?["displayName"] as? String)?.count == 80 && (longBody?["role"] as? String)?.count == 80, "over the route's 80: cut to 80, as the board's Save (never a false no-answer)")
check(Board.capped(String(repeating: "😀", count: 50)).utf16.count == 80 && Board.capped(String(repeating: "😀", count: 50)).count == 40, "80 in UTF-16 units, the route's count, cut between whole emoji")
check(Board.profileSaveRequest(mac: mac, session: "../x", name: "A", role: "", shownName: "B") == nil, "a session that is not one: no request")
check(Board.profileSaveResult(status: 200, body: Data(#"{"role":"x"}"#.utf8)) == .saved("Saved."), "saved")
func said(_ json: String, running: Bool = true, before: String = "Bob", typed: String = "Scarlet") -> String {
    if case .saved(let s) = Board.profileSaveResult(status: 200, body: Data(json.utf8), running: running, before: before, typed: typed) { return s }
    return "not saved"
}
check(said(#"{"renamed":{"changed":true,"ok":true,"was":"Bob"}}"#) == "Saved. Bob will not answer to Scarlet until you restart it. You can restart it from your computer.", "renamed while running: both names, and where to restart")
check(said(#"{"renamed":{"changed":true,"ok":true}}"#, before: "Scarlet") == "Saved. Its instructions say the new name too, so restart it when you are ready and it will know.", "running, name not edited here: the board's sentence")
check(said(#"{"renamed":{"changed":true,"ok":true,"was":""}}"#) == "Saved. Bob will not answer to Scarlet until you restart it. You can restart it from your computer.", "an empty was falls back to the shown name, as the board's ren.was || wasCalled")
check(said(#"{"renamed":{"changed":true,"ok":true,"was":"Bob"}}"#, running: false) == "Saved. It will know its new name when it next starts.", "stopped: no restart claim")
check(said(#"{"renamed":{"changed":false,"ok":false,"because":"we could not update its instructions"}}"#) == "Saved here, but we could not update its instructions.", "a partial save says so")
check(said(#"{"reports":{"state":"told"}}"#, typed: "Bob") == "Saved. They are running on what they read when they started, so restart them to use it now. You can restart them from your computer." && said(#"{"reports":{"state":"told"}}"#, running: false, typed: "Bob") == "Saved.", "reports-to told: restart only while running")
check(said(#"{"reports":{"state":"could_not","because":"its file is locked"}}"#, typed: "Bob") == "Saved here, but its file is locked.", "reports-to could not")
let boardSave = boardPage.components(separatedBy: .newlines).joined(separator: " ")
for phrase in ["'Saved. Its instructions say the new name too, so restart it when you are ready and it will know.'", "'Saved. It will know its new name when it next starts.'",
               "'Saved here, but ' + ren.because + '.'", "' will not answer to '", "' until you restart it. '",
               "They are running on what they read when they started, so restart them to use it now."] {
    check(boardSave.contains(phrase), "the board's save still says: \(phrase.prefix(50))")
}
check(Board.profileSaveResult(status: 400, body: Data(#"{"error":"an agent cannot report to itself"}"#.utf8)) == .refused("An agent cannot report to itself."), "the route's reason, as a sentence")
check(Board.profileSaveResult(status: 200, body: Data("<html>".utf8)) == .refused("We could not save that."), "a 200 this build cannot read is never saved")
check(Board.profileSaveResult(status: 0, body: nil) == .noAnswer, "no answer")

section("instructions and skills")
check(Board.parseInstructions(Data(#"{"exists":false,"editable":true,"text":""}"#.utf8)) == "", "no file yet: empty, not unreadable")
check(Board.parseInstructions(Data(#"{"exists":false,"editable":false,"because":"it is a link"}"#.utf8)) == nil, "a file that cannot be read is never \"no instructions yet\" (review 2)")
check(Board.parseInstructions(Data(#"{"exists":true,"text":"Be kind."}"#.utf8)) == "Be kind.", "the text")
check(Board.parseInstructions(Data("x".utf8)) == nil, "unreadable")
check(Board.parseSkills(Data(#"{"ok":true,"skills":[{"name":"Minutes","key":"minutes"},{"name":"Minutes","key":"minutes-2"},{"name":""}]}"#.utf8))?.map(\.key) == ["minutes", "minutes-2"], "the skills, keyed (two may share a name)")
check(Board.parseSkills(Data(#"{"ok":false,"because":"x"}"#.utf8)) == nil, "the route could not: unreadable, never \"none\"")

section("fresh start")
let compact = Board.freshConfirm(.compact, name: "Cleo")
check(compact.title == "Compact Cleo\u{2019}s memory?" && compact.go == "Compact Cleo\u{2019}s memory", "the board's dialog words")
for phrase in [" summarises this session to make room and keeps going. Fine detail from earlier in the session may be lost. What it agreed to stays. Its instructions are not read again, so a changed file still needs a restart.",
               " forgets this session. Anything it was part way through ends, including anything it agreed to and has not done yet. Its instructions and its files are untouched, and not read again; a changed file still needs a restart.",
               "Compact: summarise and keep going", "Clear: start over, loses what it is holding", "Each one shows what it stands to lose before you choose.",
               "'Asked it to compact. ' : 'Asked it to clear. '", "'It does this the moment it is between tasks.'", "'It could not be done just now.'"] {
    check(boardPage.contains(phrase), "the board still says: \(phrase.prefix(50))")
}
check(Board.freshConfirm(.clear, name: "Cleo").small.hasPrefix("Cleo forgets this session."), "Clear's sentence")
let fr = Board.freshRequest(mac: mac, session: "cleo", .clear)
check(fr?.httpMethod == "POST" && fr?.url?.path == "/api/agent/cleo/clear", "POST to clear")
check(Board.freshResult(.compact, status: 200, body: Data(#"{"delivery":{"state":"sent"}}"#.utf8)) == ("Asked it to compact. It does this the moment it is between tasks.", true), "asked")
check(Board.freshResult(.clear, status: 200, body: Data(#"{"delivery":{"state":"sent","paneNote":"It is busy; it will clear after."}}"#.utf8)).sentence == "Asked it to clear. It is busy; it will clear after.", "the pane's own note")
check(Board.freshResult(.clear, status: 409, body: Data(#"{"delivery":{"state":"could_not","because":"Its window is gone."}}"#.utf8)) == ("Its window is gone.", false), "could not: its reason")
check(Board.freshResult(.clear, status: 0, body: nil) == ("We could not reach Kosmos.", false), "no answer")
check(Board.freshResult(.clear, status: 200, body: Data("{}".utf8)).ok == false, "no delivery to read: never said to have gone")
check(Board.freshResult(.clear, status: 404, body: Data(#"{"error":"no agent by that name"}"#.utf8)) == ("No agent by that name.", false), "a refusal before delivery: the route's own words")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
