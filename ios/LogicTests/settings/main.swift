import Foundation
// Tests for the native Settings tab's logic (#7010), compiled for macOS with the app files run-settings.sh lists.
// It prints every case and ends with one verdict line; a missing verdict means the run did not finish.
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
let coordinator = URL(string: "https://login.kosmosplus.com")!
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? FileManager.default.currentDirectoryPath)
func repoText(_ path: String) -> String { (try? String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)) ?? "" }

section("the kept computer: only this account's, only a computer under Kosmos+")
let session = "sess-abc"
func saved(_ address: String, cookie: String = "c00kie", owner: String = Board.owner(of: "sess-abc")) -> String {
    Board.encode(Board.SavedMacSession(name: "Studio Mac", address: address, cookie: cookie, owner: owner))!
}
let mac = Settings.keptMac(stored: saved("studio.kosmosplus.com"), session: session, coordinator: coordinator)
check(mac?.name == "Studio Mac" && mac?.url.absoluteString == "https://studio.kosmosplus.com/" && mac?.cookie == "c00kie", "this account's computer is kept")
check(Settings.keptMac(stored: saved("studio.kosmosplus.com", owner: Board.owner(of: "someone-else")), session: session, coordinator: coordinator) == nil, "another account's computer is never asked")
check(Settings.keptMac(stored: saved("evil.example.com"), session: session, coordinator: coordinator) == nil, "an address outside Kosmos+ is refused")
check(Settings.keptMac(stored: saved("studio.kosmosplus.com", cookie: ""), session: session, coordinator: coordinator) == nil, "no cookie, no computer")
check(Settings.keptMac(stored: saved("studio.kosmosplus.com"), session: nil, coordinator: coordinator) == nil, "signed out: no computer")
check(Settings.keptMac(stored: "not json", session: session, coordinator: coordinator) == nil, "an unreadable record: no computer")

section("the requests: the computer's own setting, with its sign-in by hand")
if let mac {
    let r = Settings.readRequest(mac)!
    check(r.httpMethod == "GET" && r.url?.absoluteString == "https://studio.kosmosplus.com/api/phone-notify", "a read is GET /api/phone-notify on that computer")
    check(r.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && r.httpShouldHandleCookies == false, "it carries the kept cookie and no other")
    let master = Settings.writeRequest(mac, kind: nil, on: true)!
    check(master.httpMethod == "PUT" && String(data: master.httpBody ?? Data(), encoding: .utf8) == #"{"on":true}"#, "the master switch sends { on } alone")
    let room = Settings.writeRequest(mac, kind: .postedRoom, on: false)!
    check(String(data: room.httpBody ?? Data(), encoding: .utf8) == #"{"kind":"postedRoom","on":false}"#, "a kind sends { kind, on }")
    check(room.value(forHTTPHeaderField: "Content-Type") == "application/json", "as JSON")
} else { check(false, "the requests need a kept computer") }

section("the answer: what the computer says is on")
let body = #"{"available":true,"on":true,"connected":true,"kinds":{"needsYou":true,"replied":true,"postedMention":true,"ready":false,"postedRoom":false},"offByChoice":false,"defaultBecause":null}"#
let s = Settings.phoneNotify(status: 200, data: Data(body.utf8))
check(s?.on == true && s?.isOn(.needsYou) == true && s?.isOn(.ready) == false && s?.isOn(.postedRoom) == false, "each switch reads the computer's own value")
check(Settings.phoneNotify(status: 500, data: Data(body.utf8)) == nil, "a server error is not a setting")
check(Settings.phoneNotify(status: 200, data: Data("<html>".utf8)) == nil, "a page that is not the setting is not one")

section("refusals say why, and a read is not called a save")
check(Settings.refusal(status: 400, data: Data(#"{"error":"this computer is not connected to Kosmos+"}"#.utf8), writing: true) == "This computer is not connected to Kosmos+.", "the computer's own reason, as a sentence")
check(Settings.refusal(status: 401, data: Data(), writing: false).hasPrefix("Your computer did not let this phone in just now."), "a refused sign-in is not worded as final (a restart answers 401 for a few seconds)")
check(Settings.refusal(status: 0, data: Data(), writing: true) == "Your computer is not answering. Try again in a moment.", "no answer says so")
check(Settings.refusal(status: 404, data: Data("<html>".utf8), writing: false) == "Your computer did not send these settings. Try again in a moment.", "a failed read does not say 'did not save'")
check(Settings.refusal(status: 500, data: Data("<html>".utf8), writing: true) == "That did not save. Try again in a moment.", "a failed write does")

section("the master switch's line, and when it can be pressed")
func status(available: Bool = true, on: Bool, connected: Bool, because: String? = nil) -> Settings.PhoneNotify {
    Settings.PhoneNotify(available: available, on: on, connected: connected, kinds: [:], offByChoice: !on, defaultBecause: because)
}
check(Settings.masterNote(status(on: true, connected: true)).contains("never what they said"), "on: what is and is not sent")
check(Settings.masterNote(status(on: false, connected: false)).contains("not connected to Kosmos+"), "not connected: says so")
check(Settings.masterNote(status(on: false, connected: true, because: "Kosmos on this computer needs an update before phone notifications can be turned on")) == "Not on yet. Kosmos on this computer needs an update before phone notifications can be turned on.", "the computer's reason, after 'Not on yet.' as the board says it, made a sentence")
check(Settings.masterNote(status(available: false, on: false, connected: true)).contains("not available"), "not available on this computer")
check(Settings.masterEnabled(status(on: false, connected: true)), "off and connected: can turn on")
check(!Settings.masterEnabled(status(on: false, connected: false)), "off and not connected: nothing to turn on")
check(Settings.masterEnabled(status(on: true, connected: false)), "on but not connected: can still turn off")
check(!Settings.masterEnabled(status(available: false, on: false, connected: true)), "not available: no switch")
check(Settings.kindsShown(status(on: true, connected: true)), "on and connected: the per-kind switches show")
check(!Settings.kindsShown(status(on: true, connected: false)), "on but not connected: they do not (the board's paintKinds)")
check(!Settings.kindsShown(status(on: false, connected: true)), "off: they do not")

section("drift: the phone says what the computer says")
let page = repoText("web/index.html")
check(!page.isEmpty, "the board's page was read (KOSMOS_REPO)")
check(page.contains("<b>\(Settings.masterLabel)</b>"), "the master label is the board's")
// Each board row is "<div>label ... </div>" then its button with data-kind, so a label is checked against ITS OWN
// row's kind, and two labels swapped fail.
for kind in Settings.Kind.allCases {
    let row = page.range(of: "<div>\(kind.label)")
    let rest = row.map { String(page[$0.upperBound...].prefix(600)) } ?? ""
    let ownKind = rest.range(of: #"data-kind="([a-zA-Z]+)""#, options: .regularExpression).map { String(rest[$0]).dropFirst(11).dropLast() }
    check(ownKind.map(String.init) == kind.rawValue, "\(kind.rawValue): the board's row with these words is this switch")
    if let hint = kind.hint { check(rest.contains(hint), "\(kind.rawValue): the hint is the board's") }
}
let engine = repoText("engine/phonenotify.js")
if let r = engine.range(of: #"const KIND_DEFAULTS = \{([^}]*)\}"#, options: .regularExpression) {
    let keys = engine[r].split(separator: "{")[1].split(separator: ",").compactMap { $0.split(separator: ":").first?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty && !$0.hasPrefix("}") }
    check(Set(keys) == Set(Settings.Kind.allCases.map(\.rawValue)), "the kinds are the computer's (KIND_DEFAULTS)")
} else { check(false, "KIND_DEFAULTS was found in engine/phonenotify.js") }

section("Kosmos+ pages")
check(Settings.accountURL(coordinator: coordinator).absoluteString == "https://login.kosmosplus.com/account", "the account page")
check(Settings.deleteAccountURL(coordinator: coordinator).absoluteString == "https://login.kosmosplus.com/delete-account", "the delete-account flow")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
