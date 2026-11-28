import Foundation
// Tests for the computer's AI Models, native (kosmos#8959 slice D2a), compiled for macOS with the app files run-models.sh
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
let page = repoText("web/index.html")
check(page.count > 1_000_000, "the board page was read")
let M = Models.self
let P = NewAgentPicker.self

// Times use a plain space before AM/PM, as the page's toLocaleTimeString does (the phone replaces ICU's U+202F).
// A fixed clock: Friday 2026-11-27 12:00 in Chicago, US English, so every date and time below is one answer.
var clock = Models.Clock()
clock.locale = Locale(identifier: "en_US")
clock.timeZone = TimeZone(identifier: "America/Chicago")!
var parts = DateComponents(); parts.year = 2026; parts.month = 11; parts.day = 27; parts.hour = 12
clock.now = clock.calendar.date(from: parts)!
let nowMs = clock.now.timeIntervalSince1970 * 1000
let hour = 3_600_000.0
let day = 24 * hour

func row(_ connection: String, provider: String = "anthropic", extra: String = "") -> NewAgentPicker.Account {
    let s = #"{"accounts":[{"dir":"/a","provider":""# + provider + #"""# + extra + #","connection":"# + connection + "}]}"
    return P.parseAccounts(Data(s.utf8))?.first ?? P.Account(dir: "", provider: .anthropic, rawProvider: "", email: nil, name: nil, keyTail: nil, label: nil, baseUrl: nil, local: false, isDefault: false, memoryShared: false, badge: nil, state: nil, hasConnection: false, offerable: true)
}
func words(_ a: NewAgentPicker.Account) -> String { M.pill(a, clock).words }
func tone(_ a: NewAgentPicker.Account) -> Models.Tone { M.pill(a, clock).tone }

section("the request and the read")
let mac = Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "c00kie")
let q = M.request(mac)
check(q.httpMethod == "GET" && q.url?.absoluteString == "https://studio.kosmosplus.com/api/accounts", "GET /api/accounts on the computer")
check(q.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && !q.httpShouldHandleCookies, "the computer's cookie, by hand only")
check(q.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin", "same-origin, which the board's cross-site guard lets through")
check(page.contains("fetch('/api/accounts'"), "the page reads the same route")
if case .got(let rows) = M.read(status: 200, data: Data(#"{"accounts":[{"dir":"/a","provider":"anthropic"}]}"#.utf8)) { check(rows.count == 1 && rows[0].dir == "/a", "a 200 lists its rows") } else { check(false, "a 200 lists its rows") }
check(M.read(status: 200, data: Data(#"{"accounts":[]}"#.utf8)) == .got([]), "an empty list is a list")
check(M.read(status: 503, data: Data(#"{"accounts":[]}"#.utf8)) == .failed(Models.Words.failed), "a refusal says the page's could-not-read sentence")
check(M.read(status: 200, data: Data("not json".utf8)) == .failed(Models.Words.failed), "a body that does not parse, too")
check(page.contains("We could not read the accounts on this computer.") && page.contains("Checking your accounts…"), "the page has both lines")

section("agoWords, as the page's")
check(M.agoWords(nil) == "" && M.agoWords(-1) == "" && M.agoWords(.infinity) == "", "no age, a negative or a non-finite one says nothing")
check(M.agoWords(4_999) == "just now" && M.agoWords(5_000) == "5 seconds ago" && M.agoWords(89_999) == "89 seconds ago", "under 5 s, then seconds below 90")
check(M.agoWords(90_000) == "1 minute ago" && M.agoWords(5_399_999) == "89 minutes ago", "then minutes below 90")
check(M.agoWords(5_400_000) == "1 hour ago" && M.agoWords(36 * hour - 1) == "35 hours ago", "then hours below 36")
check(M.agoWords(36 * hour) == "1 day ago" && M.agoWords(3 * day) == "3 days ago", "then days")
check(page.contains("if (n < 5) return 'just now';") && page.contains("if (hours < 36) return hours + (hours === 1 ? ' hour ago' : ' hours ago');"), "the page's agoWords has the same steps")

section("the parser reads what the pill needs")
let parsed = row(#"{"badge":"working","observedFrom":"check","observedAgeMs":120000,"loginValidUntil":true,"loginExpiresInDays":2.5,"because":""}"#)
check(parsed.badge == "working" && parsed.live.observedFrom == "check" && parsed.live.observedAgeMs == 120000, "badge, observedFrom and observedAgeMs")
check(parsed.live.loginValidUntil == nil, "a boolean is not a time (Number.isFinite)")
check(parsed.live.loginExpiresInDays == nil, "a fraction is not a day count (Number.isInteger)")
check(parsed.live.because == nil, "an empty because is no reason")

section("the pill, case by case, in the page's order")
let stops = row(#"{"badge":"working","loginStopsAt":"# + String(Int(nowMs + 2 * hour)) + #","loginEnded":true,"loginExpiresInDays":0}"#)
check(words(stops) == "Signed in · stops working at about 2:00 PM" && tone(stops) == .unverified, "a stop time ahead outranks everything, today")
let stopsTomorrow = row(#"{"badge":"working","loginStopsAt":"# + String(Int(nowMs + day)) + "}")
check(words(stopsTomorrow) == "Signed in · stops working tomorrow at about 12:00 PM", "a stop time tomorrow")
let stopsPast = row(#"{"badge":"working","loginStopsAt":"# + String(Int(nowMs - hour)) + #","loginEnded":true}"#)
check(words(stopsPast) == "Login expired" && tone(stopsPast) == .none, "a stop time already past: the login has ended")
let expiring = row(#"{"badge":"working","loginExpiresInDays":3,"loginExpiresAt":"# + String(Int(nowMs + 3 * day)) + "}")
check(words(expiring) == "Signed in until Nov 30" && tone(expiring) == .unverified, "inside the notice's window, with its date")
check(words(row(#"{"badge":"working","loginExpiresInDays":0}"#)) == "Signed in · login expires today", "today, with no date")
check(words(row(#"{"badge":"working","loginExpiresInDays":1}"#)) == "Signed in · login expires in 1 day", "one day")
let goodUntil = row(#"{"badge":"working","observedFrom":"login","loginValidUntil":"# + String(Int(nowMs + 40 * day)) + "}")
check(words(goodUntil) == "Signed in · login good until Jan 6, 2027" && tone(goodUntil) == .connected, "green from the login, with its date (the year, as it is not this year)")
let okUntil = row(#"{"badge":"signed_in_unverified","loginValidUntil":"# + String(Int(nowMs + 10 * day)) + "}")
check(words(okUntil) == "Signed in · login good until Dec 7" && tone(okUntil) == .loginok, "unverified with a login date")
let greenNoDate = row(#"{"badge":"working","observedFrom":"login"}"#)
check(words(greenNoDate) == "Signed in" && tone(greenNoDate) == .unverified, "a login green with no date is not claimed as working")
check(words(row(#"{"badge":"working","observedAgeMs":120000}"#)) == "Signed in · active 2 minutes ago", "working, from an agent's request")
check(words(row(#"{"badge":"working","observedFrom":"check","observedAgeMs":120000}"#)) == "Signed in · checked 2 minutes ago", "working, from a check")
check(words(row(#"{"badge":"working"}"#)) == "Signed in", "working with no age")
let rejected = row(#"{"badge":"rejected","observedAgeMs":7200000}"#)
check(words(rejected) == "Not connected · rejected 2 hours ago" && tone(rejected) == .none, "rejected")
let since = row(#"{"badge":"signed_in_unverified","notConfirmedSince":"# + String(Int(nowMs - 5 * day)) + "}")
check(words(since) == "Not confirmed since Nov 22" && tone(since) == .unverified, "not renewed since a date this year")
let sinceOld = row(#"{"badge":"signed_in_unverified","notConfirmedSince":"# + String(Int(nowMs - 400 * day)) + "}")
check(words(sinceOld) == "Not confirmed since Oct 23, 2025", "the year when it is not this year")
check(words(row(#"{"badge":"signed_in_unverified"}"#)) == "Signed in", "unverified")
let out = row(#"{"badge":"signed_out","because":"Sign in again on this computer."}"#)
check(words(out) == "Sign in again on this computer." && tone(out) == .none, "signed out says the board's own reason")
check(words(row(#"{"badge":"signed_out"}"#)) == "this account is not connected", "signed out, no reason: the page's sentence")
check(words(row(#"{"badge":"unchecked"}"#)) == "we could not check this account" && tone(row(#"{"badge":"unchecked"}"#)) == .unknown, "unchecked")
let chatgptOn = row(#"{"state":"connected"}"#, provider: "openai", extra: #","authMode":"chatgpt""#)
check(words(chatgptOn) == "Signed in" && tone(chatgptOn) == .connected, "a ChatGPT subscription, connected (green)")
check(words(row(#"{"state":"none"}"#, provider: "openai", extra: #","authMode":"chatgpt""#)) == "Not connected", "a ChatGPT subscription, not connected")
check(tone(row(#"{"state":"unknown"}"#, provider: "openai", extra: #","authMode":"chatgpt""#)) == .unverified, "a ChatGPT subscription, not known")
let keyOn = row(#"{"state":"connected"}"#, provider: "openai")
check(words(keyOn) == "Signed in" && tone(keyOn) == .connected, "no badge (an API-key row): the state (green)")
check(words(row(#"{"state":"none","because":"The key was refused."}"#, provider: "openai")) == "The key was refused.", "no badge, not connected: the reason")
check(words(row(#"{}"#, provider: "openai")) == "we could not check this account", "no badge, no state")

section("every fixture row, against expected.json (the file web.models-ios-parity-8959 checks the page against)")
struct FixtureRow: Decodable { let name: String }
let fixtureObj = (try? JSONSerialization.jsonObject(with: Data(repoText("ios/LogicTests/models/fixture.json").utf8))) as? [String: Any]
let expectedRows = (try? JSONSerialization.jsonObject(with: Data(repoText("ios/LogicTests/models/expected.json").utf8))) as? [[String: String]] ?? []
let fixtureRows = fixtureObj?["rows"] as? [[String: Any]] ?? []
check(fixtureRows.count >= 20 && fixtureRows.count == expectedRows.count, "the fixture and expected.json were read, row for row")
// Review 1: the zone and locale are the fixture's, as the page test's are, so the two sides cannot drift apart.
var fixClock = clock
fixClock.now = Date(timeIntervalSince1970: ((fixtureObj?["nowMs"] as? Double) ?? 0) / 1000)
fixClock.timeZone = TimeZone(identifier: fixtureObj?["timeZone"] as? String ?? "") ?? fixClock.timeZone
fixClock.locale = Locale(identifier: (fixtureObj?["locale"] as? String ?? "en-US").replacingOccurrences(of: "-", with: "_"))
check(fixClock.timeZone.identifier == "America/Chicago" && fixClock.locale.identifier == "en_US", "the fixture's zone and locale were read")
for (i, fr) in fixtureRows.enumerated() where i < expectedRows.count {
    let acct = fr["account"] ?? [:]
    let one = (try? JSONSerialization.data(withJSONObject: ["accounts": [acct]])) ?? Data()
    guard let a = P.parseAccounts(one)?.first else { check(false, "row \(i) parses"); continue }
    let p = M.pill(a, fixClock)
    let want = expectedRows[i]
    check(p.words == want["words"] && p.tone.rawValue == want["tone"] && M.name(a) == want["shown"], "fixture: " + (want["name"] ?? "?") + " -> " + M.name(a) + ", " + p.words)
}
// Review 2: the section order, against the page's accountGroupsHtml on the same rows.
let groupRows = fixtureObj?["groupRows"] as? [[String: Any]] ?? []
let groupData = (try? JSONSerialization.data(withJSONObject: ["accounts": groupRows])) ?? Data()
let wantGroups = fixtureObj?["expectedGroups"] as? [String] ?? []
check(groupRows.count >= 4 && M.groups(P.parseAccounts(groupData) ?? []).map(\.label) == wantGroups, "fixture: the sections in the page's order " + wantGroups.joined(separator: ", "))

section("groups and the sample")
let mixed = P.parseAccounts(Data(#"{"accounts":[{"dir":"/o1","provider":"openai"},{"dir":"/c1","provider":"anthropic"},{"dir":"/o2","provider":"openai"}]}"#.utf8)) ?? []
let gs = M.groups(mixed)
check(gs.map(\.label) == ["Anthropic / Claude", "OpenAI"], "no providerName: OpenAI is \"OpenAI\", any other \"Anthropic / Claude\"; sorted by PROVIDER_ORDER, not the board's order")
let compat = P.parseAccounts(Data(#"{"accounts":[{"dir":"/g","provider":"glm","providerName":"Z.ai GLM","keyTail":"9z1b"},{"dir":"/m","provider":"minimax","providerName":"MiniMax","email":"m@example.com"},{"dir":"/c","provider":"anthropic","email":"c@example.com"}]}"#.utf8)) ?? []
check(M.groups(compat).map(\.label) == ["Anthropic / Claude", "Z.ai GLM", "MiniMax"], "GLM and MiniMax have their own sections, by the board's providerName, in PROVIDER_ORDER")
check(M.name(compat[0]) == "API key ending 9z1b" && M.name(compat[1]) == "m@example.com" && M.name(compat[2]) == "c@example.com", "a GLM key is named by its tail; email first, as acctPrimaryName")
check(page.contains("if (p === 'glm') return 'Z.ai GLM';") && page.contains("if (p === 'minimax') return 'MiniMax';"), "the page's words for the two")
check(gs[0].rows.map(\.dir) == ["/c1"] && gs[1].rows.map(\.dir) == ["/o1", "/o2"], "rows keep the board's order inside their section")
check(M.groups([]).isEmpty, "no accounts, no sections")
let sampleRows = P.parseAccounts(Data(Models.sampleList.utf8)) ?? []
check(sampleRows.count == 3, "the sample has three accounts")
check(sampleRows.map { P.primaryName($0) + ", " + M.pill($0, clock).words } == ["dana@example.com, Signed in · active 2 minutes ago", "Team account, Signed in", "API key ending 4f2a, The key was refused."],
      "the sample's rows read as the UI test expects")

section("the page says the same words")
for w in ["Signed in · stops working ", "Login expired", "'Signed in until '", "'Signed in · login '", "Signed in · login good until ",
          "Not connected' + (ageStr ? ' · rejected '", "' · checked ' : ' · active '", "Not confirmed since ",
          "'this account is not connected'", "'we could not check this account'", "'tomorrow at about '", "'at about '"] {
    check(page.contains(w), "the page has: " + w)
}

print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
