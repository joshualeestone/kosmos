import Foundation
// Tests for Community's "Where each agent stands" (kosmos#8959 slice D1d3a), compiled for macOS with the app files
// run-ready.sh lists. It prints every case and ends with one verdict line; a missing verdict means the run did not finish.
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
let engine = repoText("engine/communityready.js")
check(page.count > 1_000_000 && engine.count > 1000, "the board page and the engine were read")
let R = Ready.self
let W = Ready.Words.self
let mac = Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "c00kie")
func json(_ s: String) -> Data { Data(s.utf8) }

section("the request")
let q = R.request(mac)
check(q.httpMethod == "GET" && q.url?.path == "/api/community/ready" && q.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && !q.httpShouldHandleCookies && q.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin", "GET /api/community/ready, the kept cookie and the board's header")
check(page.contains("const res = await fetch('/api/community/ready', { cache: 'no-store' });"), "the page reads the same route")

section("the answer, as communityReadyPaint")
let a = R.read(status: 200, data: json(#"{"agents":[{"session":"eli","name":"Eli","owner":{"summary":"2 items waiting for you. Takes part.","needsYou":"2 items waiting for you","lines":[{"text":"2 items it wrote are under Waiting for you.","needsYou":true},{"text":"Its newest post went out ","at":1795500000000,"after":"."},{"text":"Posted at ","at":null,"after":"."},{"text":"No time."},{"nope":1}]}},{"session":"fay","owner":{"summary":"Takes part.","needsYou":"not the start","lines":[]}},{"session":"gus"},{"name":"no session","owner":{"lines":[]}}]}"#))
guard case .rows(let rows) = a else { check(false, "rows"); exit(1) }
check(rows.map(\.session) == ["eli", "fay"], "a row without a session or an owner view is skipped")
check(rows[0].name == "Eli" && rows[1].name == "fay", "the name, else the session")
check(rows[0].needsYou == "2 items waiting for you" && rows[0].rest == ". Takes part.", "the needs-you words split off the summary's start")
check(rows[1].needsYou == nil && rows[1].rest == "Takes part.", "needs-you words that do not start the summary: painted plain")
check(rows[0].lines.count == 4 && rows[0].lines[0].needsYou && !rows[0].lines[1].needsYou, "lines without text are skipped; needsYou kept")
check(rows[0].lines[1].hasTime && rows[0].lines[2].hasTime && !rows[0].lines[3].hasTime && rows[0].lines[2].at == nil, "a time where the line carries at or after; null at is one the page cannot read")
let utc = TimeZone(identifier: "UTC")!, us = Locale(identifier: "en_US")
let now = Date(timeIntervalSince1970: 1795600000)
check(R.lineText(rows[0].lines[2], now: now, locale: us, zone: utc) == "Posted at " + W.badDate + ".", "an unreadable time: the page's words, never a sentence that stops short")
check(R.lineText(rows[0].lines[3]) == "No time.", "a line with no time")
let thisYear = R.when(Date(timeIntervalSince1970: 1795500000), now: now, locale: us, zone: utc)
let lastYear = R.when(Date(timeIntervalSince1970: 1760000000), now: now, locale: us, zone: utc)
check(thisYear.contains("Nov") && !thisYear.contains("2026") && lastYear.contains("2025"), "month, day and time; the year only when it is not this one: \(thisYear) / \(lastYear)")
check(R.read(status: 200, data: json(#"{"agents":[]}"#)) == .none, "no agents: Kosmos lists no agents yet")
check(R.read(status: 503, data: json(#"{"error":"x"}"#)) == .couldNot && R.read(status: 200, data: json(#"{"agents":{}}"#)) == .couldNot, "a 503 or a list that is not one: could not check")
check(R.read(status: 200, data: json(#"{"agents":[{"session":"x"}]}"#)) == .couldNot, "rows given but none drawable: could not check (the page's rows.length check)")
if case .rows(let s) = R.read(status: 200, data: json(R.sample)) { check(s.count == 2 && s[1].needsYou == "1 item waiting for you", "the sample reads") } else { check(false, "the sample reads") }

section("the words")
for w in [W.note, W.looking, W.couldNot, W.badDate] { check(page.contains(w), "on the page: \(w.prefix(56))") }
check(page.contains("empty.textContent = 'Kosmos lists no agents yet.';") && page.contains("say.textContent = 'Needs you: ';"), "the empty line and the screen reader's mark")
check(page.contains(">Where each agent stands</h4>"), "the heading")
check(engine.contains("const needsYou = row.held > 0 ? row.held + (row.held === 1 ? ' item' : ' items') + ' waiting for you' : null;"), "the engine's needs-you words, which start the summary")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
