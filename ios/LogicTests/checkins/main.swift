import Foundation
// Tests for the Prompter check-ins' logic (kosmos#8959 slice D1d1), compiled for macOS with the app files run-checkins.sh
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
let C = Checkins.self
let W = Checkins.Words.self
let mac = Settings.Mac(name: "Studio Mac", url: URL(string: "https://Studio.kosmosplus.com/")!, cookie: "c00kie")

section("the requests")
let n = C.nudgesRequest(mac), s = C.statusRequest(mac)
check(n.httpMethod == "GET" && n.url?.path == "/api/prompter-nudges" && s.httpMethod == "GET" && s.url?.path == "/api/status", "GET /api/prompter-nudges, and /api/status for the phases")
check([n, s].allSatisfy { $0.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && !$0.httpShouldHandleCookies && $0.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin" }, "the kept cookie by hand and the board's header")
check(page.contains("const res = await fetch('/api/prompter-nudges', { cache: 'no-store' });"), "the page reads the same route")

section("the answer")
let ns = C.nudges(status: 200, data: Data(#"{"at":"x","ok":true,"nudges":[{"session":"dana","from":"working","to":"idle"},{"session":"eli","to":"connection_lost"},{"session":"fay","to":"auth_failed"},{"session":""},{"to":"idle"}]}"#.utf8))
check(ns == [Checkins.Nudge(session: "dana", to: "idle"), Checkins.Nudge(session: "eli", to: "connection_lost"), Checkins.Nudge(session: "fay", to: "auth_failed")], "each check-in with a session; one without is dropped")
check(C.nudges(status: 500, data: Data("{}".utf8)) == nil && C.nudges(status: 200, data: Data("<html>".utf8)) == nil, "any failure: nil, which hides the list (the page's catch)")
check(C.nudges(status: 200, data: Data(#"{"nudges":[]}"#.utf8)) == [], "none: an empty list, which also hides it")
check(C.needsPhases(ns ?? []) && !C.needsPhases([Checkins.Nudge(session: "a", to: "idle")]), "the status is read only when a lost connection needs its phase")
let ph = C.phases(status: 200, data: Data(#"{"agents":[{"sessionName":"eli","reconnect":{"phase":"gave_up","tries":3}},{"sessionName":"gus","reconnect":null},{"sessionName":"hal"}]}"#.utf8))
check(ph == ["eli": "gave_up"] && C.phases(status: 0, data: nil) == [:], "each agent's reconnect phase from the status, none when unread")
check(C.phases(status: 200, data: Data(#"{"agents":[7,{"sessionName":"eli","reconnect":{"phase":"waiting"}}]}"#.utf8)) == ["eli": "waiting"], "an entry that is not an object is skipped, not the whole list")

section("the questions, as the page's prompterCheckinQuestion")
check(C.question(Checkins.Nudge(session: "a", to: "auth_failed"), phase: nil) == W.signIn, "signed out")
check(C.question(Checkins.Nudge(session: "a", to: "connection_lost"), phase: "waiting") == W.reconnecting && C.question(Checkins.Nudge(session: "a", to: "connection_lost"), phase: "retried") == W.reconnecting, "reconnecting (waiting or retried)")
check(C.question(Checkins.Nudge(session: "a", to: "connection_lost"), phase: "gave_up") == W.gaveUp, "Kosmos stopped trying")
check(C.question(Checkins.Nudge(session: "a", to: "connection_lost"), phase: nil) == W.lost && C.question(Checkins.Nudge(session: "a", to: "connection_lost"), phase: "other") == W.lost, "a lost connection with no phase read")
check(C.question(Checkins.Nudge(session: "a", to: "idle"), phase: nil) == W.quiet && C.question(Checkins.Nudge(session: "a", to: nil), phase: "gave_up") == W.quiet, "anything else: gone quiet")
check(C.rows(ns ?? [], phases: ph).map(\.question) == [W.quiet, W.gaveUp, W.signIn], "the rows, in the computer's order")
for w in [W.signIn, W.reconnecting, W.gaveUp, W.lost, W.quiet] { check(page.contains("'" + w + "'"), "on the page: \(w.prefix(48))") }
check(page.contains("'<p class=\"dlab\" style=\"margin:14px 0 6px;\">Agents that may need you</p>'"), "the heading")
check(page.contains("if (ph === 'waiting' || ph === 'retried') return") && page.contains("if (ph === 'gave_up') return") && page.contains("if (to === 'auth_failed') return"), "the page's branches")

section("the agent a row opens")
let t = C.target(mac, session: "dana")
check(t == PushBridge.AgentTarget(host: "studio.kosmosplus.com", session: "dana", name: "Dana"), "the computer's address, lower-cased, the session, and its name as a push tap gives one with none")
check(C.target(mac, session: "../x") == nil && C.target(mac, session: "") == nil, "a session the board's names cannot be opens nothing")
check(C.rows(C.nudges(status: 200, data: Data(C.sampleNudges.utf8)) ?? [], phases: C.samplePhases).map(\.question) == [W.quiet, W.gaveUp], "the sample: one quiet, one Kosmos stopped trying on")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
