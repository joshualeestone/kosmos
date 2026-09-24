import Foundation

// Tests for the push bridge logic (#718), compiled for macOS together with
// ios/Kosmos/PushBridgeLogic.swift and PushRegistrar.swift and run on a Mac:
// there is no iOS simulator runtime on the build box, so XCTest cannot run.
// Run with ios/LogicTests/run.sh. It prints every case and ends with one
// verdict line; a missing verdict means the run did not finish.

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

// WebKit hands a posted object over as Foundation types; build bodies the same way.
func jsonBody(_ json: String) -> Any {
    try! JSONSerialization.jsonObject(with: Data(json.utf8), options: [.fragmentsAllowed])
}

// MARK: - Origin gate

section("origin gate")
func trusted(_ main: Bool, _ scheme: String, _ host: String, _ port: Int) -> Bool {
    PushBridge.isTrustedSender(isMainFrame: main, scheme: scheme, host: host, port: port, coordinator: coordinator)
}
check(trusted(true, "https", "login.kosmosplus.com", 0), "main frame, coordinator origin, default port: accepted")
check(trusted(true, "https", "login.kosmosplus.com", 443), "explicit 443 is the same origin: accepted")
check(trusted(true, "HTTPS", "LOGIN.kosmosplus.com", 0), "case differences: accepted")
check(!trusted(false, "https", "login.kosmosplus.com", 0), "a subframe on the coordinator origin: refused")
check(!trusted(true, "http", "login.kosmosplus.com", 0), "plain http: refused")
check(!trusted(true, "http", "login.kosmosplus.com", 443), "http on 443 is not https: refused")
check(!trusted(true, "https", "login.kosmosplus.com.evil.example", 0), "suffix lookalike: refused")
check(!trusted(true, "https", "evil-login.kosmosplus.com", 0), "sibling subdomain: refused")
check(!trusted(true, "https", "kosmosplus.com", 0), "parent domain: refused")
check(!trusted(true, "https", "login.kosmosplus.com", 8443), "another port: refused")
check(!trusted(true, "https", "", 0), "empty host: refused")
check(!trusted(true, "file", "", 0), "file URL: refused")

// MARK: - Message parse

section("session message parse")
check(PushBridge.parseSessionMessage(jsonBody(#"{"token":"KST1.abc"}"#)) == .signedIn("KST1.abc"), "{token: string} is a sign-in")
check(PushBridge.parseSessionMessage(jsonBody(#"{"token":null}"#)) == .signedOut, "{token: null} is a sign-out")
check(PushBridge.parseSessionMessage(jsonBody(#"{}"#)) == nil, "no token key: refused")
check(PushBridge.parseSessionMessage(jsonBody(#"{"token":""}"#)) == nil, "empty token: refused")
check(PushBridge.parseSessionMessage(jsonBody(#"{"token":5}"#)) == nil, "numeric token: refused")
check(PushBridge.parseSessionMessage(jsonBody(#""KST1.abc""#)) == nil, "bare string body: refused")
check(PushBridge.parseSessionMessage(jsonBody(#"["KST1.abc"]"#)) == nil, "array body: refused")

// MARK: - Device token

section("device token hex")
check(PushBridge.hexToken(Data([0x0a, 0xff, 0x00])) == "0aff00", "lowercase, zero padded")
let token32 = Data((0..<32).map { UInt8($0 * 7 & 0xff) })
let hex32 = PushBridge.hexToken(token32)
check(hex32.count == 64 && hex32.allSatisfy { "0123456789abcdef".contains($0) }, "32 bytes -> 64 lowercase hex chars (the server's minimum)")

// MARK: - Environment

section("aps environment")
func profile(_ env: String?) -> Data {
    var ents = "<key>application-identifier</key><string>T.io.kosmos.app</string>"
    if let env = env { ents += "<key>aps-environment</key><string>\(env)</string>" }
    let xml = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0"><dict><key>Name</key><string>p</string>
    <key>Entitlements</key><dict>\(ents)</dict></dict></plist>
    """
    // A CMS envelope around the plist, as in a real embedded.mobileprovision.
    return Data([0x30, 0x82, 0x1f, 0x00, 0x06, 0x09]) + Data(xml.utf8) + Data([0xa0, 0x82, 0x00, 0xff])
}
check(PushBridge.environment(isSimulator: true, provisioningProfile: nil) == .sandbox, "simulator: sandbox")
check(PushBridge.environment(isSimulator: true, provisioningProfile: profile("production")) == .sandbox, "simulator wins over a profile: sandbox")
check(PushBridge.environment(isSimulator: false, provisioningProfile: nil) == .production, "no profile (App Store install): production")
check(PushBridge.environment(isSimulator: false, provisioningProfile: profile("development")) == .sandbox, "development profile: sandbox")
check(PushBridge.environment(isSimulator: false, provisioningProfile: profile("production")) == .production, "production profile: production")
check(PushBridge.apsEnvironment(inProfile: profile(nil)) == nil, "profile without push: no aps-environment read")
check(PushBridge.apsEnvironment(inProfile: Data([1, 2, 3])) == nil, "garbage profile: nothing read, no crash")

// MARK: - Requests

section("register / unregister requests")
let reg = PushBridge.registerRequest(coordinator: coordinator, session: "KST1.s", token: hex32, bundleID: "io.kosmos.app", environment: .sandbox)
check(reg.url?.absoluteString == "https://login.kosmosplus.com/v1/push/apns/register", "register URL is the coordinator origin + /v1/push/apns/register")
check(reg.httpMethod == "POST", "register is a POST")
check(reg.value(forHTTPHeaderField: "Authorization") == "Bearer KST1.s", "register carries the Bearer session")
check(reg.value(forHTTPHeaderField: "Content-Type") == "application/json", "register is JSON")
check(reg.httpShouldHandleCookies == false, "register sends no cookies")
let regBody = (try? JSONSerialization.jsonObject(with: reg.httpBody ?? Data())) as? [String: String]
check(regBody == ["token": hex32, "bundle_id": "io.kosmos.app", "environment": "sandbox"], "register body is exactly {token, bundle_id, environment}")
let unreg = PushBridge.unregisterRequest(coordinator: coordinator, session: "KST1.s", token: hex32)
check(unreg.url?.absoluteString == "https://login.kosmosplus.com/v1/push/apns/unregister", "unregister URL")
check(unreg.value(forHTTPHeaderField: "Authorization") == "Bearer KST1.s", "unregister carries the Bearer session")
let unregBody = (try? JSONSerialization.jsonObject(with: unreg.httpBody ?? Data())) as? [String: String]
check(unregBody == ["token": hex32], "unregister body is exactly {token}")
let slashed = PushBridge.registerRequest(coordinator: URL(string: "https://login.kosmosplus.com/")!, session: "s", token: hex32, bundleID: "b", environment: .production)
check(slashed.url?.absoluteString == "https://login.kosmosplus.com/v1/push/apns/register", "a trailing slash on the origin does not double up")

section("response outcomes")
check(PushBridge.outcome(status: 200) == .ok, "200 ok")
check(PushBridge.outcome(status: 401) == .sessionRejected, "401 session rejected")
check(PushBridge.outcome(status: 403) == .deviceRefused, "403 device refused")
check(PushBridge.outcome(status: 400) == .failed(400), "400 failed")
check(PushBridge.outcome(status: 500) == .failed(500), "500 failed")
check(PushBridge.outcome(status: nil) == .unreachable, "no answer unreachable")

// MARK: - Registrar

final class MemoryStore: SessionStore {
    var value: String?
    var failSaves = false
    init(_ value: String? = nil) { self.value = value }
    func load() -> String? { value }
    func save(_ session: String) -> Bool {
        if failSaves { return false }
        value = session
        return true
    }
    func delete() { value = nil }
}

struct Sent {
    let path: String
    let auth: String
    let body: [String: String]
}

final class Harness {
    let store: MemoryStore
    var sent: [Sent] = []
    var logs: [String] = []
    // Status to answer each request with, in order; default 200. A pending
    // completion is kept when holdReplies is set, to test in-flight changes.
    var replies: [Int?] = []
    var holdReplies = false
    var held: [(Int?) -> Void] = []
    var registrar: PushRegistrar!

    init(stored: String? = nil) {
        store = MemoryStore(stored)
        registrar = PushRegistrar(
            coordinator: coordinator,
            bundleID: "io.kosmos.app",
            environment: .sandbox,
            store: store,
            transport: { [unowned self] req, done in
                let body = (try? JSONSerialization.jsonObject(with: req.httpBody ?? Data())) as? [String: String] ?? [:]
                self.sent.append(Sent(path: req.url?.path ?? "", auth: req.value(forHTTPHeaderField: "Authorization") ?? "", body: body))
                if self.holdReplies {
                    self.held.append(done)
                } else {
                    done(self.replies.isEmpty ? 200 : self.replies.removeFirst())
                }
            },
            log: { [unowned self] in self.logs.append($0) }
        )
    }

    var paths: [String] { sent.map { $0.path } }
}

let R = PushBridge.registerPath
let U = PushBridge.unregisterPath
let tokA = String(repeating: "a1", count: 32)
let tokB = String(repeating: "b2", count: 32)

section("registrar: ordering")
do {
    let h = Harness()
    h.registrar.didReceiveDeviceToken(tokA)
    check(h.sent.isEmpty, "token alone sends nothing")
    h.registrar.didReceive(.signedIn("KST1.one"))
    check(h.paths == [R], "session arriving second registers once")
    check(h.sent.first?.auth == "Bearer KST1.one" && h.sent.first?.body["token"] == tokA, "with that session and token")
    check(h.sent.first?.body["environment"] == "sandbox" && h.sent.first?.body["bundle_id"] == "io.kosmos.app", "with the bundle id and environment")
    check(h.store.value == "KST1.one", "session stored")
}
do {
    let h = Harness()
    h.registrar.didReceive(.signedIn("KST1.one"))
    check(h.sent.isEmpty, "session alone sends nothing")
    h.registrar.didReceiveDeviceToken(tokA)
    check(h.paths == [R], "token arriving second registers once")
}
do {
    let h = Harness(stored: "KST1.saved")
    h.registrar.didReceiveDeviceToken(tokA)
    check(h.paths == [R] && h.sent[0].auth == "Bearer KST1.saved", "relaunch: a stored session registers before the page loads")
}

section("registrar: repeats (the page re-posts on every signed-in load)")
do {
    let h = Harness()
    h.registrar.didReceiveDeviceToken(tokA)
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceiveDeviceToken(tokA)
    check(h.paths == [R], "same session and token again: no second register")
    h.registrar.didReceive(.signedIn("KST1.two"))
    check(h.paths == [R, R] && h.sent[1].auth == "Bearer KST1.two", "a different session registers again")
    h.registrar.didReceiveDeviceToken(tokB)
    check(h.paths == [R, R, R] && h.sent[2].body["token"] == tokB, "a rotated device token registers again")
}
do {
    let h = Harness()
    h.replies = [nil]
    h.registrar.didReceiveDeviceToken(tokA)
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceive(.signedIn("KST1.one"))
    check(h.paths == [R, R], "after an unreachable register, the next post retries")
    check(h.store.value == "KST1.one", "unreachable keeps the session")
}

section("registrar: sign-out")
do {
    let h = Harness()
    h.registrar.didReceiveDeviceToken(tokA)
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceive(.signedOut)
    check(h.paths == [R, U], "sign-out unregisters")
    check(h.sent[1].auth == "Bearer KST1.one" && h.sent[1].body == ["token": tokA], "with the OLD session and the token")
    check(h.store.value == nil && h.registrar.session == nil, "and forgets the session")
    h.registrar.didReceiveDeviceToken(tokA)
    check(h.paths == [R, U], "a later token delivery registers nothing")
    h.registrar.didReceive(.signedOut)
    check(h.paths == [R, U], "a second sign-out (null on a signed-out page) sends nothing")
    h.registrar.didReceive(.signedIn("KST1.one"))
    check(h.paths == [R, U, R], "signing back in with the same session registers again")
}
do {
    let h = Harness()
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceive(.signedOut)
    check(h.sent.isEmpty, "sign-out before APNs gave a token: nothing to send yet")
    h.registrar.didReceiveDeviceToken(tokA)
    check(h.paths == [U] && h.sent[0].auth == "Bearer KST1.one", "when the token arrives, unregister with the signed-out session, no register")
}
do {
    let h = Harness()
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceive(.signedOut)
    h.registrar.didReceive(.signedIn("KST1.two"))
    h.registrar.didReceiveDeviceToken(tokA)
    check(h.paths == [R] && h.sent[0].auth == "Bearer KST1.two", "sign-out then a new sign-in before the token: just register the new one")
}

section("registrar: refusals")
do {
    let h = Harness()
    h.replies = [401]
    h.registrar.didReceiveDeviceToken(tokA)
    h.registrar.didReceive(.signedIn("KST1.dead"))
    check(h.store.value == nil && h.registrar.session == nil, "401 forgets the session")
    h.registrar.didReceiveDeviceToken(tokA)
    check(h.paths == [R], "and does not retry it")
}
do {
    let h = Harness()
    h.replies = [403]
    h.registrar.didReceiveDeviceToken(tokA)
    h.registrar.didReceive(.signedIn("KST1.one"))
    check(h.store.value == "KST1.one", "403 keeps the session")
}
do {
    let h = Harness()
    h.replies = [400]
    h.registrar.didReceiveDeviceToken(tokA)
    h.registrar.didReceive(.signedIn("KST1.one"))
    check(h.store.value == "KST1.one", "400 keeps the session")
    check(h.logs.contains { $0.contains("HTTP 400") }, "and logs the status")
}
do {
    let h = Harness()
    h.holdReplies = true
    h.registrar.didReceiveDeviceToken(tokA)
    h.registrar.didReceive(.signedIn("KST1.old"))
    h.registrar.didReceive(.signedIn("KST1.new"))
    // The old session's register comes back 401 AFTER the new sign-in.
    h.held[0](401)
    check(h.registrar.session == "KST1.new" && h.store.value == "KST1.new", "a stale 401 does not forget a newer session")
    h.held[1](200)
}
do {
    let h = Harness()
    h.store.failSaves = true
    h.registrar.didReceiveDeviceToken(tokA)
    h.registrar.didReceive(.signedIn("KST1.one"))
    check(h.paths == [R], "a Keychain write failure still registers for this launch")
}

section("registrar: never logs secrets")
do {
    let h = Harness()
    h.replies = [200, 401, 403, 400, nil, 200]
    h.registrar.didReceiveDeviceToken(tokA)
    for s in ["KST1.aaaa", "KST1.bbbb", "KST1.cccc", "KST1.dddd", "KST1.eeee"] {
        h.registrar.didReceive(.signedIn(s))
    }
    h.registrar.didReceive(.signedOut)
    let all = h.logs.joined(separator: "\n")
    check(!h.logs.isEmpty, "the arms above did log something (control)")
    check(!all.contains("KST1"), "no session material in any log line")
    check(!all.contains(tokA) && !all.contains(String(tokA.prefix(8))), "no token material in any log line")
}

// MARK: - The real URLSession transport against a stubbed network

final class StubProtocol: URLProtocol {
    static var status: Int = 200
    static var fail = false
    static var seen: [URLRequest] = []
    static var seenBodies: [Data] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        StubProtocol.seen.append(request)
        // URLSession moves httpBody into a stream before a protocol sees it.
        var body = Data()
        if let stream = request.httpBodyStream {
            stream.open()
            var buf = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buf, maxLength: buf.count)
                if n <= 0 { break }
                body.append(buf, count: n)
            }
            stream.close()
        }
        StubProtocol.seenBodies.append(body)
        if StubProtocol.fail {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
            return
        }
        let resp = HTTPURLResponse(url: request.url!, statusCode: StubProtocol.status, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"ok":true}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

section("URLSession transport")
func runTransport(status: Int, fail: Bool) -> (Int?, Bool) {
    StubProtocol.status = status
    StubProtocol.fail = fail
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubProtocol.self]
    let transport = PushRegistrar.urlSessionTransport(URLSession(configuration: config))
    var got: Int?? = .none
    var onMain = false
    transport(reg) { s in got = .some(s); onMain = Thread.isMainThread }
    let deadline = Date().addingTimeInterval(5)
    while got == nil && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
    return (got ?? -1, onMain)
}
do {
    let (s, main) = runTransport(status: 200, fail: false)
    check(s == 200, "reports the HTTP status")
    check(main, "completes on the main thread")
    let r = StubProtocol.seen.last
    check(r?.httpMethod == "POST" && r?.value(forHTTPHeaderField: "Authorization") == "Bearer KST1.s", "the wire request is the POST with the Bearer session")
    let b = (try? JSONSerialization.jsonObject(with: StubProtocol.seenBodies.last ?? Data())) as? [String: String]
    check(b?["token"] == hex32, "the wire body carries the token")
    check(runTransport(status: 401, fail: false).0 == 401, "a 401 comes through as 401")
    check(runTransport(status: 200, fail: true).0 == nil, "a connection failure comes through as no status")
}

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
