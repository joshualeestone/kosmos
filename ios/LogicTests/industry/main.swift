import Foundation
// Tests for Community's kind of business (kosmos#8959 slice D1d2a), compiled for macOS with the app files run-industry.sh
// lists. It prints every case and ends with one verdict line; a missing verdict means the run did not finish.
setvbuf(stdout, nil, _IOLBF, 0)
var passed = 0
var failed = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: Int = #line) {
    if cond() { passed += 1; print("  ok   \(name)") } else { failed += 1; print("  FAIL \(name) (line \(line))") }
}
func section(_ name: String) { print(name) }
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? FileManager.default.currentDirectoryPath)
func repoText(_ path: String) -> String { (try? String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)) ?? "" }
let page = repoText("web/index.html").replacingOccurrences(of: "\\u2019", with: "’")
check(page.count > 1_000_000, "the board page was read")
let I = Industry.self
let W = Industry.Words.self
let mac = Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "c00kie")
func json(_ s: String) -> Data { Data(s.utf8) }

section("the requests")
let r = I.readRequest(mac)
check(r.httpMethod == "GET" && r.url?.path == "/api/community-industry", "GET /api/community-industry")
let put = I.saveRequest(mac, key: "software"), putNone = I.saveRequest(mac, key: "")
let body = { (q: URLRequest?) in q?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
check(put?.httpMethod == "PUT" && put?.url?.path == "/api/community-industry" && body(put)?["industry"] as? String == "software", "a choice PUTs { industry: key }")
check(body(putNone)?["industry"] is NSNull, "None PUTs { industry: null }, as the page's sel.value === '' ? null")
check(I.saveRequest(mac, key: I.unknownKey) == nil, "the unread entry saves nothing")
check([r, put!].allSatisfy { $0.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && !$0.httpShouldHandleCookies && $0.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin" }, "the kept cookie by hand and the board's header")

section("the answer")
let s = I.read(status: 200, data: json(#"{"industry":"publishing","ok":true,"industries":[{"key":"software","label":"Software","display":"Software and apps"},{"key":"publishing","label":"Publishing"},{"label":"no key"}],"unreachable":2,"picturesStuck":1,"picturesUnsendable":3,"picturesToFit":[]}"#))!
check(s.industry == "publishing" && !s.unread && s.list == [Industry.Choice(key: "software", text: "Software and apps"), Industry.Choice(key: "publishing", text: "Publishing")], "the choice, and the list as the board dresses it (display, else label); no key, no entry")
check(s.unreachable == 2 && s.picturesStuck == 1 && s.picturesUnsendable == 3, "the counts")
check(I.read(status: 200, data: json(#"{"industry":null,"ok":false,"industries":[]}"#))?.unread == true, "ok false: unread")
check(I.read(status: 200, data: json(#"{"ok":true}"#))?.unread == true, "no industries list: unread, as the page's !Array.isArray(r.industries)")
check(I.read(status: 500, data: json("{}")) == nil && I.read(status: 200, data: json("<html>")) == nil, "no answer: nil")
check(I.read(status: 200, data: json(#"{"ok":true,"industries":[],"unreachable":null}"#))?.unreachable == nil && I.read(status: 200, data: json(#"{"ok":true,"industries":[]}"#))?.unreachable == nil, "unreachable null or missing: the board cannot tell")
var gone = s; gone.industry = "retired-kind"
check(I.choices(gone, kept: []).map(\.key) == ["", "software", "publishing", "retired-kind"] && I.selected(gone) == "retired-kind", "a saved key the list no longer has stays a choice, not a blank")
check(I.read(status: 200, data: json(#"{"ok":true,"industries":[],"picturesStuck":true,"picturesUnsendable":2.5}"#)).map { [$0.picturesStuck, $0.picturesUnsendable] } == [0, 0], "a boolean or a fraction is not a count (Number.isInteger)")
check(I.isRefusal("that has to name an industry, or none") && !I.isRefusal(W.savedShown) && !I.isRefusal(W.savedUnread), "a refusal is told from a Saved line")

section("the picker, as industryPaint")
check(I.choices(s, kept: []).map(\.key) == ["", "software", "publishing"] && I.selected(s) == "publishing", "read: None, then the list; the saved one chosen")
let unread = I.read(status: 200, data: json(#"{"ok":false,"industries":[{"key":"software","label":"Software"}]}"#))
check(I.choices(unread, kept: []).map(\.key) == [I.unknownKey, "", "software"] && I.selected(unread) == I.unknownKey, "unread: the could-not-be-read entry first, and chosen")
check(I.choices(nil, kept: s.list).map(\.key) == [I.unknownKey, "", "software", "publishing"], "no answer: the list the screen last had is kept (sel.__industries)")
check(I.readSaid(s, kept: []) == nil && I.readSaid(nil, kept: s.list) == W.unreadWithList && I.readSaid(nil, kept: []) == W.unreadNoList, "the unread line, with or without a list to pick from")

section("after a save, as industryChange")
var saved = s
check(I.savedSaid(saved) == W.savedShown, "a business picked: shown while Community is on")
saved.industry = nil; saved.unreachable = 0
check(I.savedSaid(saved) == "Saved. Kosmos takes it off your agents’ public profiles, even with Community off.", "None: taken off")
saved.unreachable = 1
check(I.savedSaid(saved) == "Saved. Kosmos takes it off your agents’ public profiles, even with Community off, except 1 agent the community has shut out, whose profile Kosmos can no longer change.", "None, one agent shut out")
saved.unreachable = 3
check(I.savedSaid(saved).hasSuffix("except 3 agents the community has shut out, whose profile Kosmos can no longer change."), "three")
saved.unreachable = nil
check(I.savedSaid(saved) == W.savedLater, "the board cannot tell: once it can send again")
saved.unread = true
check(I.savedSaid(saved) == W.savedUnread, "saved but not read back")
check(I.refused(status: 400, data: json(#"{"error":"that has to name an industry, or none"}"#)) == "that has to name an industry, or none" && I.refused(status: 0, data: nil) == W.saveFailed, "a refusal: the board's sentence, else the page's")

section("the picture lines")
check(W.stuck(1) == "One agent’s picture may still show in the community. The community shut that agent out, so Kosmos can no longer take it down.", "one stuck")
check(W.stuck(2) == "2 agents’ pictures may still show in the community. The community shut those agents out, so Kosmos can no longer take them down.", "two stuck")
check(W.unsendable(1) == "One agent’s picture cannot go to the community as it is. Choose a different picture, or the same one again, on the agent’s page and Kosmos will fit it if it can.", "one unsendable")
check(W.unsendable(4).hasPrefix("4 agents’ pictures cannot go to the community as they are."), "four unsendable")

section("the words are the board page's own")
for w in [W.hint, W.saveFailed, W.savedUnread, W.savedShown, W.savedLater, W.unreadWithList, W.unreadNoList] {
    check(page.contains(w), "on the page: \(w.prefix(56))")
}
check(page.contains("Your kind of business, shown on your agents’ public profiles</label>") && page.contains("const INDUSTRY_NONE_LABEL = 'None: profiles leave it out';") && page.contains("const INDUSTRY_UNKNOWN_LABEL = 'Could not be read just now';"), "the label and the two fixed choices")
check(page.contains("'Saved. Kosmos takes it off your agents’ public profiles, even with Community off'") && page.contains("(n ? ', except ' + n + (n === 1 ? ' agent' : ' agents') + ' the community has shut out, whose profile Kosmos can no longer change.' : '.')"), "the None sentence's pieces")
check(page.contains("+ ' may still show in the community. The community shut ' + (ns === 1 ? 'that agent' : 'those agents') + ' out, so Kosmos can no longer take ' + (ns === 1 ? 'it' : 'them') + ' down.'")
      && page.contains("+ ' cannot go to the community as ' + (nu === 1 ? 'it is' : 'they are') + '. Choose a different picture, or the same one again, on the agent’s page and Kosmos will fit it if it can.'"), "the picture lines' pieces")
check(I.read(status: 200, data: json(I.sample)) != nil, "the sample reads")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
