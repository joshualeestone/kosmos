import Foundation
// Tests for the native AI policies screen's logic (kosmos#8959 slice D1b2), compiled for macOS with the app files
// run-aipolicies.sh lists. It prints every case and ends with one verdict line; a missing verdict means the run did not
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
func body(_ r: URLRequest?) -> [String: String]? { r?.httpBody.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: String] } }
let mac = Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "c00kie")
let A = AIPolicies.self

section("the requests: the board's routes on the kept computer, signed as the board's own")
let list = A.listRequest(mac)
check(list.httpMethod == "GET" && list.url?.absoluteString == "https://studio.kosmosplus.com/api/policy", "the list is GET /api/policy")
let save = A.saveRequest(mac, ["name": "Legal", "text": "Rules."])
let rename = A.renameRequest(mac, id: "p1", name: "Counsel")
let remove = A.removeRequest(mac, id: "p1")
for r in [list, save!, rename!, remove!] {
    check(r.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && r.httpShouldHandleCookies == false
          && r.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin", "\(r.url?.path ?? "?"): the kept cookie by hand and the board's header")
}
check(save?.httpMethod == "POST" && save?.url?.path == "/api/policy" && body(save) == ["name": "Legal", "text": "Rules."], "a save POSTs the form's body")
check(rename?.httpMethod == "POST" && rename?.url?.path == "/api/policy/rename" && body(rename) == ["id": "p1", "name": "Counsel"], "rename POSTs { id, name }")
check(remove?.httpMethod == "POST" && remove?.url?.path == "/api/policy/remove" && body(remove) == ["id": "p1"], "remove POSTs { id }")
check((save?.timeoutInterval ?? 0) >= 30, "a save waits for the computer to fetch a link")

section("the form, as the page's polBody, polNamed and its two checks")
check(A.form(replacing: nil, name: "  Legal ", source: .words("Rules.")) == .ready(["name": "Legal", "text": "Rules."]), "a new one: the name trimmed, the words as pasted")
check(A.form(replacing: nil, name: "Eng", source: .link(" https://x.example/p ")) == .ready(["name": "Eng", "url": "https://x.example/p"]), "a link, trimmed")
check(A.form(replacing: "p2", name: "ignored", source: .words("New.")) == .ready(["id": "p2", "text": "New."]), "replacing sends the id, never a name")
check(A.form(replacing: nil, name: " ", source: .words("x")) == .refused("Give it a name first."), "no name: the page's sentence, nothing sent")
check(A.form(replacing: nil, name: "A", source: .link("  ")) == .refused("Paste the link first."), "no link")
check(A.form(replacing: nil, name: "A", source: .words(" \n ")) == .refused("Paste the policy first."), "no words")
check(A.form(replacing: "p1", name: "", source: .words("x")) == .ready(["id": "p1", "text": "x"]), "replacing needs no name (the name stays)")
check(A.confirmTitle(name: "Legal", replacing: false) == "Hand “Legal” to every agent?" && A.confirmTitle(name: "Legal", replacing: true) == "Replace the words of “Legal” for every agent?",
      "the confirm's title names the policy, as the page's polConfirm")

section("the list, as the page's paintPolicy reads it")
let saved = A.read(status: 200, data: json(#"{"state":"saved","policies":[{"id":"p1","name":"Legal","source":"pasted","savedAt":"2026-11-20T15:00:00.000Z","chars":300,"opening":"Never."},{"id":"p2","name":"Eng","source":"https://x.example/p","savedAt":null,"chars":5,"opening":"Code."}],"because":null,"company":null}"#))
if case .saved(let ps, let c) = saved {
    check(ps.map(\.id) == ["p1", "p2"] && c == nil, "the policies, in the board's order")
    check(ps[0].savedAt == A.date("2026-11-20T15:00:00.000Z") && ps[0].savedAt != nil && ps[1].savedAt == nil, "savedAt read from the engine's ISO date, or none")
    check(A.from(ps[0]) { _ in "11/20/26" } == "Pasted, updated 11/20/26." && A.from(ps[1]) { _ in "x" } == "From https://x.example/p.", "the source line, as polFrom")
    check(A.opening(ps[0].opening, chars: ps[0].chars) == "Never.…" && A.opening(ps[1].opening, chars: 5) == "Code.", "… only when there is more than 240")
    check(A.lead(saved) == A.Words.leadMany, "two policies: the plural lead")
} else { check(false, "a saved list parses") }
let one = A.read(status: 200, data: json(#"{"state":"saved","policies":[{"id":"p1","name":"Legal","source":"pasted","savedAt":null,"chars":1,"opening":"x"}],"company":null}"#))
check(A.lead(one) == A.Words.leadOne, "one policy: the singular lead")
let withCompany = A.read(status: 200, data: json(#"{"state":"saved","policies":[{"id":"p1","name":"Legal","source":"pasted","savedAt":null,"chars":1,"opening":"x"}],"company":{"name":"Acme AI policy","chars":900,"opening":"Be careful.","kind":"company"}}"#))
check(A.lead(withCompany) == A.Words.leadMany, "one policy and the company's: plural, as the page counts them")
check(A.read(status: 200, data: json(#"{"state":"none","policies":[],"because":null,"company":null}"#)) == .none(company: nil), "nothing saved")
check(A.lead(.none(company: nil)) == A.Words.none, "the page's No policies here yet.")
let fam = AIPolicies.Company(name: "Home rules", chars: 10, opening: "x", family: true)
check(A.lead(.none(company: fam)) == "Every agent gets your family's policy below; each one starts following it at its next restart.", "only the company's, on a family's Kosmos")
check(A.orgWords(A.Words.companyFrom, family: true) == "Set by your family in its Kosmos policy. Only your family can change or remove it." && A.orgWords(A.Words.companyFrom, family: false) == A.Words.companyFrom,
      "the company's line, in the family's words only on a family's Kosmos (plusOrgIn)")
check(A.read(status: 200, data: json(#"{"state":"unknown","policies":[],"because":"the policy file is damaged","company":null}"#)) == .unread("The policy file is damaged.", company: nil), "an unreadable record is its own sentence")
check(A.read(status: 200, data: json(#"{"state":"unknown","policies":[]}"#)) == .unread("We could not read the saved policies.", company: nil), "with the page's default")
check(A.read(status: 500, data: json("<html>")) == .failed(A.Words.listFailed) && A.read(status: 0, data: json("")) == .failed(A.Words.listFailed), "no answer: the page's could-not-reach line")
check(A.read(status: 401, data: json("")) == .failed(Board.phoneShutOut) && A.read(status: 403, data: json(#"{"error":"gate"}"#)) == .failed(Board.phoneShutOut), "401 and 403 are the sign-in line")
check(A.read(status: 200, data: json(#"{"state":"saved","policies":[{"name":"No id"},{"id":"p9","name":"Kept"}]}"#)) == .saved([AIPolicies.Policy(id: "p9", name: "Kept", source: "pasted", savedAt: nil, chars: 0, opening: "")], company: nil),
      "a policy with no id is not listed (it could not be renamed or removed)")
check(A.read(status: 200, data: json(A.sampleRead)) != .failed(A.Words.listFailed), "the sample build's answer parses")

section("after a change: the page's polSaid, sentence for sentence")
let t = { (agent: String, told: Bool, because: String?) in AIPolicies.Told(agent: agent, told: told, because: because, shownAs: nil) }
check(A.said([], did: .handed) == "Saved. No agents are running yet; each one gets it when it exists.", "handed, no agents")
check(A.said([], did: .removed) == "Removed. No agents are running, so there was nothing to take back.", "removed, no agents")
check(A.said([], did: .renamed) == "Renamed.", "renamed, no agents")
check(A.said([], did: .replaced) == "Replaced. No agents are running yet; each one gets the new words when it exists.", "replaced, no agents")
check(A.said([t("a", true, nil)], did: .handed) == "Handed to every agent. Each one starts following it at its next restart.", "handed, all told")
check(A.said([t("a", true, nil)], did: .replaced) == "Replaced for every agent. Each one starts following the new words at its next restart.", "replaced, all told")
check(A.said([t("a", true, nil)], did: .renamed) == "Renamed. Each agent sees the new name at its next restart.", "renamed, all told")
check(A.said([t("a", true, nil)], did: .removed) == "Removed. Each agent lets go of it at its next restart.", "removed, all told")
check(A.said([t("a", true, nil), AIPolicies.Told(agent: "sess-2", told: false, because: "its folder is read only", shownAs: "Mona")], did: .handed)
      == "Saved. 1 of 2 agents have it. Not yet: Mona (Its folder is read only.)", "some not told: who, by the name shown, and why")
check(A.said([t("a", false, nil)], did: .removed) == "Removed. 0 of 1 agents let go of it. Not yet: a (Could not be told.)", "removed, none told")
check(A.said([AIPolicies.Told(agent: nil, told: false, because: nil, shownAs: nil)], did: .renamed) == "Renamed. 0 of 1 agents have the new name. Not yet: one agent (Could not be told.)", "an unnamed miss")
check(A.told(json(#"{"told":[{"agent":"s1","state":"told"},{"agent":"s2","state":"could_not","because":"x","shownAs":"Ana"},{"agent":"s3","state":"not_tried"}]}"#))
      == [AIPolicies.Told(agent: "s1", told: true, because: nil, shownAs: nil), AIPolicies.Told(agent: "s2", told: false, because: "x", shownAs: "Ana"), AIPolicies.Told(agent: "s3", told: false, because: nil, shownAs: nil)],
      "only the engine's \"told\" counts as told (could_not and not_tried do not)")

section("a change's answer")
check(A.done(.handed, status: 200, data: json(#"{"policies":[],"saved":{"id":"p1","name":"Legal"},"told":[]}"#)) == .done("Saved. No agents are running yet; each one gets it when it exists."), "done, with its sentence")
check(A.done(.handed, status: 400, data: json(#"{"error":"there is already a policy called Legal"}"#)) == .refused("There is already a policy called Legal."), "the computer's own refusal")
check(A.done(.renamed, status: 400, data: json("{}")) == .refused("We could not rename it."), "with none, the page's default")
check(A.done(.removed, status: 400, data: json("{}")) == .refused("We could not remove it.") && A.done(.replaced, status: 400, data: json("{}")) == .refused("We could not save that."), "each default")
check(A.done(.handed, status: 200, data: json("<html>")) == .refused(A.Words.saveFailed) && A.done(.removed, status: 0, data: json("")) == .refused(A.Words.removeFailed),
      "an answer that is not JSON, or none, is the page's could-not-reach line (its res.json() throws)")
check(A.done(.renamed, status: 403, data: json(#"{"error":"x"}"#)) == .refused(Board.phoneShutOut), "a 403 is the sign-in line")

section("the words are the board page's own, and the routes are the computer's")
let raw = repoText("web/index.html")
let page = raw.replacingOccurrences(of: "&rsquo;", with: "’").replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
func cut(_ from: String, _ to: String) -> String {
    guard let a = page.range(of: from), let b = page.range(of: to, range: a.upperBound..<page.endIndex) else { return "" }
    return String(page[a.lowerBound..<b.lowerBound])
}
let sectionHTML = cut(#"<section class="dsec" id="s-sec-policy""#, #"<section class="dsec" id="s-sec-mac""#)
let modal = cut(#"<div class="rm-back" id="pol-modal""#, "</div> </div>")
// The script writes an apostrophe inside a quoted string as \'; compare with it unescaped.
let script = cut("async function paintPolicy() {", "function freshStartLabel(name) {").replacingOccurrences(of: "\\'", with: "'")
check(sectionHTML.count > 1000 && modal.count > 200 && script.count > 5000, "the section, the confirm and the script were found (\(sectionHTML.count), \(modal.count), \(script.count))")
check(!sectionHTML.contains("Remove it for good?") && !script.contains("Hand it out"), "control: each cut is its own region")
let W = A.Words.self
for w in [W.title, W.hint, W.addLabel, W.addHint, W.namePlaceholder, W.linkLabel, W.linkHint, W.linkPlaceholder, W.fetch, W.pasteLabel,
          W.pastePlaceholder, W.save, W.cancelReplace] {
    check(sectionHTML.contains(w), "in the section: \(w.prefix(48))")
}
for w in [W.confirmSmall, W.confirmNo, W.confirmGo] { check(modal.contains(w), "in the confirm: \(w.prefix(48))") }
for w in [W.leadOne, W.leadMany, W.companyOnly, W.companyFrom, W.none, W.listFailed, W.replaceHint, W.saveReplace, W.keep, W.leave,
          W.nameFirst, W.linkFirst, W.textFirst, W.saveFailed, W.renameFailed, W.removeFailed, W.saveRefusedDefault,
          W.renameRefusedDefault, W.removeRefusedDefault, W.fetching, W.saving, W.renaming, W.removing, W.removeArmed, W.unreadDefault] {
    check(script.contains(w), "in the script: \(w.prefix(48))")
}
check(script.contains("rename.textContent = '" + W.rename + "';") && script.contains("swap.textContent = '" + W.replace + "';")
      && script.contains("rm.textContent = '" + W.remove + "';"), "the three buttons' own words")
check(script.contains("' (' + pjSentence(m.because || 'could not be told') + ')'") && script.contains("'. Not yet: '"), "polSaid's miss list, as the app writes it")
check(page.contains(#"id="pol-name" maxlength="60""#) && page.contains(#"id="pol-url" maxlength="2000""#) && page.contains(#"id="pol-text" rows="6" maxlength="16384""#)
      && script.contains("inp.maxLength = 60"), "the field limits are the page's")
let server = repoText("server.js")
for r in ["pathname === '/api/policy' && (req.method === 'GET'", "pathname === '/api/policy' && req.method === 'POST'",
          "pathname === '/api/policy/rename' && req.method === 'POST'", "pathname === '/api/policy/remove' && req.method === 'POST'"] {
    check(server.contains(r), "the computer has \(r.dropFirst(13).prefix(40))")
}
let stepUp = server.range(of: "const REMOTE_STEP_UP_EXACT = new Set([").flatMap { s in
    server.range(of: "]);", range: s.upperBound..<server.endIndex).map { String(server[s.upperBound..<$0.lowerBound]) } } ?? ""
let patterns = server.range(of: "const REMOTE_STEP_UP_PATTERNS = [").flatMap { s in
    server.range(of: "];", range: s.upperBound..<server.endIndex).map { String(server[s.upperBound..<$0.lowerBound]) } } ?? ""
check(stepUp.contains("'POST /api/update'") && !stepUp.contains("/api/policy"), "not on the exact step-up list (control: it holds POST /api/update)")
check(patterns.contains("svc") && !patterns.contains("policy"), "nor matched by a step-up pattern")
check(repoText("engine/projects.js").contains("TOLD: 'told',"), "the engine's told state is \"told\"")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
