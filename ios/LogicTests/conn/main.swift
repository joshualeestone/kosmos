import Foundation
// Tests for the computer's Connections, native and read only (kosmos#8959 slice D2b1), compiled for macOS with the app
// files run-conn.sh lists. It prints every case and ends with one verdict line; a missing verdict means it did not finish.
setvbuf(stdout, nil, _IOLBF, 0)
var passed = 0
var failed = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: Int = #line) {
    if cond() { passed += 1; print("  ok   \(name)") } else { failed += 1; print("  FAIL \(name) (line \(line))") }
}
func section(_ name: String) { print(name) }
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? FileManager.default.currentDirectoryPath)
func repoText(_ path: String) -> String { (try? String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)) ?? "" }
let server = repoText("server.js")
check(server.count > 100_000, "the server was read")
let C = Conn.self
let mac = Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "c00kie")
func got(_ s: String, _ status: Int = 200) -> [Conn.Service]? { if case .got(let v) = C.read(status: status, data: Data(s.utf8)) { return v }; return nil }

section("the request: the disk-only read, never the billed sweep")
let q = C.request(mac)
check(q.httpMethod == "GET" && q.url?.absoluteString == "https://studio.kosmosplus.com/api/connections/held", "GET /api/connections/held on the computer")
check(q.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && !q.httpShouldHandleCookies, "the computer's cookie, by hand only")
check(q.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin", "same-origin, which the route's cross-site guard lets through")
check(server.contains("if (pathname === '/api/connections/held' && (req.method === 'GET' || req.method === 'HEAD')) {")
      && server.contains("sendJson(res, 200, { services: connectionsHeld() });"), "the server answers the route with connectionsHeld()")
check(server.contains("#4451: the agents' read of what is connected: the disk only, never a verify()"), "the server says it reads the disk only, never a verify")

section("held: true, false, or a tool's own sign-in")
check(C.state(true) == .saved && C.state(false) == .none && C.state(nil) == .unknown && C.state(NSNull()) == .unknown, "true saved, false none, null or absent unknown")
check(C.state(1) == .unknown && C.state(0) == .unknown && C.state("true") == .unknown, "a number or a string is not a boolean")

section("the read")
let rows = got(#"{"services":[{"name":"GitHub","how":"sign-in","held":true},{"name":"Vercel","how":"sign-in","held":null,"tool":true},{"name":"Cloudflare","how":"token","held":false},{"name":"Exa","how":"token","held":true},{"name":"  ","held":true},{"held":true}]}"#)
check(rows?.map(\.name) == ["GitHub", "Vercel", "Cloudflare", "Exa"], "every named row, in the board's order; a row with no name is skipped")
check(rows?.map(\.line) == [Conn.Words.savedSignIn, Conn.Words.unknown, Conn.Words.notConnected, Conn.Words.savedToken], "each state's line, a sign-in and a token worded apart")
check(got(#"{"services":[]}"#) == [], "an empty list is a list")
check(C.read(status: 503, data: Data(#"{"services":[]}"#.utf8)) == .failed(Conn.Words.failed), "a refusal is the could-not-read sentence")
check(C.read(status: 403, data: Data(#"{"error":"cross-site"}"#.utf8)) == .failed(Conn.Words.failed), "the cross-site refusal too")
check(C.read(status: 200, data: Data("nope".utf8)) == .failed(Conn.Words.failed) && C.read(status: 200, data: Data(#"{"services":{}}"#.utf8)) == .failed(Conn.Words.failed), "a body that does not parse, or no list")

section("the shape the server builds (connectionsHeld)")
check(server.contains("{ name: 'GitHub', route: '/api/github', how: 'sign-in', held: true }") && server.contains("how: 'token', held: fileHeld(cloudflare.FILE)"), "a sign-in row and a token row, with name, how and held")
check(server.contains("held: signedin.github() ? true : null") && server.contains("held: signedin.vercel() ? true : null"), "a tool's sign-in is true or null, never false")

section("the sample")
let sample = got(Conn.sampleList) ?? []
check(sample.map(\.state) == [.saved, .unknown, .none, .saved] && sample.count == 4, "one of each state, both kinds")

print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
