import Foundation
import UserNotifications

// Tests for the iOS app's UIKit-free logic (#718), compiled for macOS together
// with the app files run.sh lists and run on a Mac:
// there is no iOS simulator runtime on the build box, so XCTest cannot run.
// Run with ios/LogicTests/run.sh. It prints every case and ends with one
// verdict line; a missing verdict means the run did not finish.

// Line-buffered, so a crash mid-run still shows every case printed before it.
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

section("notification tap target")
func tapURL(_ info: [AnyHashable: Any]) -> String? {
    PushBridge.boardURL(fromNotification: info, coordinator: coordinator)?.absoluteString
}
check(tapURL(["address": "hers.kosmosplus.com"]) == "https://hers.kosmosplus.com/", "a Mac address opens that board over https")
check(tapURL(["address": "Hers.KosmosPlus.com"]) == "https://hers.kosmosplus.com/", "case is normalised")
check(tapURL(["address": "my-mac-2.kosmosplus.com"]) == "https://my-mac-2.kosmosplus.com/", "hyphens and digits inside a label: accepted")
check(tapURL([:]) == nil, "no address: nothing opens")
check(tapURL(["address": NSNull()]) == nil, "null address: nothing opens")
check(tapURL(["address": 5]) == nil, "non-string address: nothing opens")
check(tapURL(["address": "evil.example.com"]) == nil, "another domain: refused")
check(tapURL(["address": "hers.kosmosplus.com.evil.example"]) == nil, "suffix lookalike: refused")
check(tapURL(["address": "evilkosmosplus.com"]) == nil, "glued lookalike: refused")
check(tapURL(["address": "kosmosplus.com"]) == nil, "bare relay domain: refused")
check(tapURL(["address": ".kosmosplus.com"]) == nil, "empty label: refused")
check(tapURL(["address": "a.b.kosmosplus.com"]) == nil, "two labels deep: refused")
check(tapURL(["address": "hers.kosmosplus.com/steal"]) == nil, "a path: refused")
check(tapURL(["address": "hers.kosmosplus.com:8443"]) == nil, "a port: refused")
check(tapURL(["address": "https://hers.kosmosplus.com"]) == nil, "a full URL: refused")
check(tapURL(["address": "u@hers.kosmosplus.com"]) == nil, "userinfo: refused")
check(tapURL(["address": "-hers.kosmosplus.com"]) == nil, "leading hyphen: refused")
check(tapURL(["address": "hers-.kosmosplus.com"]) == nil, "trailing hyphen: refused")
check(tapURL(["address": String(repeating: "a", count: 64) + ".kosmosplus.com"]) == nil, "64-char label: refused")
check(tapURL(["address": String(repeating: "a", count: 63) + ".kosmosplus.com"]) != nil, "63-char label: accepted")
check(tapURL(["address": "h\u{0435}rs.kosmosplus.com"]) == nil, "non-ASCII lookalike letter: refused")
check(tapURL(["address": "xn--hrs-8cd.kosmosplus.com"]) == nil, "punycode label: refused")
check(tapURL(["address": "evil-kosmosplus.com"]) == nil, "hyphen-glued lookalike: refused")
check(tapURL(["address": "hers.kosmosplus.com.evil.com"]) == nil, "relay domain as a subdomain of another: refused")
check(tapURL(["address": ""]) == nil, "empty string: refused")
check(tapURL(["address": "hers.kosmosplus.com."]) == nil, "trailing dot: refused")
check(tapURL(["address": "javascript:alert(1)//.kosmosplus.com"]) == nil, "script scheme smuggled in the label: refused")
check(tapURL(["address": "hers.kosmosplus.com", "url": "https://evil.example.com/"]) == "https://hers.kosmosplus.com/", "other payload fields never steer navigation")
check(tapURL(["address": "login.kosmosplus.com"]) == nil, "the coordinator's own host is not a Mac: refused")
check(tapURL(["address": "\u{212A}ate.kosmosplus.com"]) == nil, "a non-ASCII letter that lowercases to ASCII (Kelvin sign): refused")
check(PushBridge.relayDomain(ofCoordinatorHost: "login.kosmosplus.com") == "kosmosplus.com", "relay domain is the coordinator host minus its first label")
check(PushBridge.relayDomain(ofCoordinatorHost: "kosmosplus.com") == nil, "a two-label coordinator host yields no relay domain")
check(PushBridge.relayDomain(ofCoordinatorHost: "login..com") == nil, "an empty label yields no relay domain")
check(PushBridge.boardURL(fromNotification: ["address": "hers.kosmosplus.com"], coordinator: URL(string: "https://kosmosplus.com")!) == nil, "a misconfigured coordinator origin refuses every tap")
check(PushBridge.boardURL(fromNotification: ["address": "hers.example.org"], coordinator: URL(string: "https://login.example.org")!)?.absoluteString == "https://hers.example.org/", "repointing the coordinator origin repoints the tap domain with it")

section("tap deep link to the agent (kosmos#718, agreed with Kano)")
check(tapURL(["address": "hers.kosmosplus.com", "session": "leo"]) == "https://hers.kosmosplus.com/?tab=detail&agent=leo", "a plain session opens that agent")
check(tapURL(["address": "hers.kosmosplus.com", "session": "release-notes_2"]) == "https://hers.kosmosplus.com/?tab=detail&agent=release-notes_2", "hyphens, underscores and digits: kept")
check(tapURL(["address": "hers.kosmosplus.com"]) == "https://hers.kosmosplus.com/", "no session: the board home")
for bad in ["", "Leo", "leo.x", "a/b", "../x", "leo?tab=settings", "leo&agent=x", "leo#x", "http://evil", "leo%2Fx", "le o", "l\u{0435}o", "-leo", "_leo", String(repeating: "a", count: 65)] {
    check(tapURL(["address": "hers.kosmosplus.com", "session": bad]) == "https://hers.kosmosplus.com/", "session \(bad.debugDescription.prefix(24)): refused, the board home")
}
check(tapURL(["address": "hers.kosmosplus.com", "session": String(repeating: "a", count: 64)]) != "https://hers.kosmosplus.com/", "a 64-character session: accepted (control)")
check(tapURL(["address": "hers.kosmosplus.com", "session": "a"]) == "https://hers.kosmosplus.com/?tab=detail&agent=a", "a 1-character session: accepted (the length is deliberately wider than NAME_RE)")
check(tapURL(["address": "hers.kosmosplus.com", "session": 7]) == "https://hers.kosmosplus.com/", "a non-string session: the board home")
check(tapURL(["address": "hers.kosmosplus.com", "session": NSNull()]) == "https://hers.kosmosplus.com/", "session null (the coordinator's value for an invalid one, kosmos-relay #113): the board home")
check(tapURL(["address": "evil.example.com", "session": "leo"]) == nil, "a good session cannot rescue a bad address")

section("shell: a page that failed to load")
check(Shell.loadFailure(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet) == .offline, "no internet: offline")
check(Shell.loadFailure(domain: NSURLErrorDomain, code: NSURLErrorNetworkConnectionLost) == .unreachable, "connection lost: unreachable (the phone may still be online)")
check(Shell.loadFailure(domain: NSURLErrorDomain, code: NSURLErrorCannotConnectToHost) == .unreachable, "cannot connect: unreachable")
check(Shell.loadFailure(domain: NSURLErrorDomain, code: NSURLErrorTimedOut) == .unreachable, "timed out: unreachable")
check(Shell.loadFailure(domain: NSURLErrorDomain, code: NSURLErrorServerCertificateUntrusted) == .unreachable, "bad certificate: unreachable")
check(Shell.loadFailure(domain: NSURLErrorDomain, code: NSURLErrorCancelled) == nil, "a cancelled load is not a failure page")
check(Shell.loadFailure(domain: "WebKitErrorDomain", code: 102) == nil, "a load handed to Safari is not a failure page")
check(Shell.loadFailure(domain: "WebKitErrorDomain", code: 204) == nil, "media handled by a plug-in is not a failure page")
check(Shell.loadFailure(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist) == .other, "anything else: other")
check(Shell.loadFailure(domain: "SomeDomain", code: 1) == .other, "another domain: other")

section("shell: where a link goes")
func link(_ s: String, _ o: Shell.Origin = .tapped) -> Shell.LinkDecision { Shell.linkDecision(for: URL(string: s)!, coordinator: coordinator, origin: o) }
check(link("https://login.kosmosplus.com/signin") == .inApp, "the coordinator: in the app")
check(link("https://hers.kosmosplus.com/?tab=detail&agent=leo") == .inApp, "a Mac's board: in the app")
check(link("HTTPS://LOGIN.KOSMOSPLUS.COM/signin") == .inApp, "an uppercase scheme and host: still the coordinator")
check(link("https://billing.stripe.com/p/session/x") == .external, "tapped: Stripe's billing page goes to Safari")
check(link("https://billing.stripe.com/p/session/x", .newWindow) == .external, "a new window to Stripe: Safari")
check(link("https://checkout.stripe.com/c/pay/x", .pageFlow) == .external, "a redirect or script to another site: Safari (no third-party page inside the app)")
check(link("https://kosmosplus.com/help") == .external, "tapped: the marketing site goes to Safari (not a Mac, not the coordinator)")
check(link("https://evil.example.com/") == .external, "tapped: another site goes to Safari, never inside the app")
check(link("https://login.kosmosplus.com.evil.example/") == .external, "tapped: a lookalike of the coordinator goes to Safari")
check(link("https://a.b.kosmosplus.com/") == .external, "tapped: two labels deep is not a Mac")
check(link("http://login.kosmosplus.com/") == .external, "tapped plain http, even to Kosmos+: Safari, not the app")
check(link("http://login.kosmosplus.com/", .pageFlow) == .block, "a redirect to plain http: refused, never loaded in the app")
check(link("mailto:help@kosmosplus.com") == .external, "mail: the Mail app")
check(link("tel:+12145551234") == .external, "phone: the Phone app")
check(link("javascript:alert(1)") == .block, "javascript: refused")
check(link("javascript:alert(1)", .pageFlow) == .block, "javascript: refused in a flow too")
check(link("file:///etc/passwd") == .block, "file: refused")
check(link("data:text/html,hi") == .block, "data: refused (no data: downloads on the board today)")
check(link("blob:https://hers.kosmosplus.com/1234") == .block, "blob: refused (no blob: downloads on the board today)")
check(link("kosmos://open") == .block, "a custom scheme: refused")
check(link("about:blank", .pageFlow) == .inApp, "about:blank for the page's own use: allowed")
check(link("about:blank", .newWindow) == .block, "about:blank as a new window: refused (it would blank the board)")
check(link("about:srcdoc") == .block, "other about: pages refused")
check(link("sms:+12145551234") == .external, "text: the Messages app")
check(link("https://hers.kosmosplus.com/", .newWindow) == .inApp, "a new window to a Mac: in the one WebView")
check(link("http://evil.example.com/", .pageFlow) == .block, "a redirect to a third-party plain http page: refused")
check(link("https://hers.kosmosplus.com:8443/") == .external, "a Mac host with a port is not ours: Safari")
check(link("https://x@login.kosmosplus.com/") == .external, "the coordinator with a user part is not ours: Safari")
check(link("https://accounts.example-idp.com/other", .tapped) == .external, "tapped on OUR page: another site goes to Safari")
check(link("https://terms.example.org/tos", .newWindow) == .external, "a new window to another site: Safari")
check(link("http://accounts.example-idp.com/", .tapped) == .external, "plain http tapped: Safari, never loaded in the app")
check(link("mailto:x@y.z", .pageFlow) == .block, "a script cannot open Mail")
check(link("tel:+1", .pageFlow) == .block, "a script cannot open Phone")
check(link("sms:+1", .pageFlow) == .block, "a script cannot open Messages")
check(link("tel:+1", .newWindow) == .external, "a new window to tel: the person asked: Phone")
check(Shell.isOurs(URL(string: "https://login.kosmosplus.com:443/")!, coordinator: coordinator), "an explicit :443 on the coordinator: still ours")
check(Shell.isOurs(URL(string: "https://dev.example.org:8443/x")!, coordinator: URL(string: "https://dev.example.org:8443")!), "a coordinator on a port: its own port is ours")
check(!Shell.isOurs(URL(string: "https://dev.example.org/x")!, coordinator: URL(string: "https://dev.example.org:8443")!), "a coordinator on a port: another port is not ours")
check(Shell.retryAction(failed: URL(string: "https://hers.kosmosplus.com/?tab=detail&agent=leo")!, current: URL(string: "https://hers.kosmosplus.com/")!, home: coordinator) == .load(URL(string: "https://hers.kosmosplus.com/?tab=detail&agent=leo")!), "Try again loads the page that FAILED, not the one showing")
check(Shell.retryAction(failed: nil, current: nil, home: coordinator) == .load(coordinator), "nothing loaded yet: the home page")
check(Shell.retryAction(failed: nil, current: URL(string: "https://hers.kosmosplus.com/")!, home: coordinator) == .reload, "otherwise: reload the page showing")
check(Shell.backAction(provisional: true, current: URL(string: "https://mac-a.kosmosplus.com/")!, canGoBack: true) == .stay, "Back after a failed tap: stay on the page still loaded (Mac A), not skip it")
check(Shell.backAction(provisional: false, current: URL(string: "https://mac-c.kosmosplus.com/")!, canGoBack: true) == .goBack, "Back after a committed page failed: go back one page")
check(Shell.backAction(provisional: true, current: nil, canGoBack: false) == .home, "Back when nothing ever loaded: the board home")
check(Shell.backAction(provisional: false, current: nil, canGoBack: false) == .home, "Back with no history: the board home")
check(Shell.retriesOnShow(failure: .offline, online: true, alreadyRetried: false), "offline page while already online: retry by itself")
check(!Shell.retriesOnShow(failure: .offline, online: true, alreadyRetried: true), "only once per failure (a captive portal cannot loop)")
check(!Shell.retriesOnShow(failure: .offline, online: false, alreadyRetried: false), "really offline: wait for the reconnect")
check(!Shell.retriesOnShow(failure: .unreachable, online: true, alreadyRetried: false), "not answering is not offline: no automatic retry")
check(Shell.allowsSubframe(URL(string: "https://js.stripe.com/v3/")!), "a frame over https: allowed")
check(Shell.allowsSubframe(URL(string: "about:srcdoc")!), "about:srcdoc in a frame: allowed (WebKit uses it)")
check(!Shell.allowsSubframe(URL(string: "about:config")!), "any other about: page in a frame: refused")
for bad in ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "blob:https://x/1", "http://evil.example/", "kosmos://x"] {
    check(!Shell.allowsSubframe(URL(string: bad)!), "a frame to \(bad.prefix(18)): refused")
}

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
    var saves = 0
    init(_ value: String? = nil) { self.value = value }
    func load() -> String? { value }
    func save(_ session: String) -> Bool {
        saves += 1
        if failSaves { return false }
        value = session
        return true
    }
    func delete() { value = nil }
}

extension Array {
    // Out-of-range reads return nil, so a missing request fails a check instead of
    // trapping the whole run.
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}

struct Sent {
    let path: String
    let auth: String
    let body: [String: String]
}

final class Harness {
    let store: MemoryStore
    let pending: MemoryStore
    var sent: [Sent] = []
    var logs: [String] = []
    // Status to answer each request with, in order; default 200. A pending
    // completion is kept when holdReplies is set, to test in-flight changes.
    var replies: [Int?] = []
    var holdReplies = false
    var held: [(Int?) -> Void] = []
    var registrar: PushRegistrar!

    init(stored: String? = nil, pendingStored: String? = nil) {
        store = MemoryStore(stored)
        pending = MemoryStore(pendingStored)
        registrar = PushRegistrar(
            coordinator: coordinator,
            bundleID: "io.kosmos.app",
            environment: .sandbox,
            store: store,
            pendingStore: pending,
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
    check(h.paths == [R] && h.sent[safe: 0]?.auth == "Bearer KST1.saved", "relaunch: a stored session registers before the page loads")
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
    check(h.paths == [R, R] && h.sent[safe: 1]?.auth == "Bearer KST1.two", "a different session registers again")
    h.registrar.didReceiveDeviceToken(tokB)
    check(h.paths == [R, R, R] && h.sent[safe: 2]?.body["token"] == tokB, "a rotated device token registers again")
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
    check(h.sent[safe: 1]?.auth == "Bearer KST1.one" && h.sent[safe: 1]?.body == ["token": tokA], "with the OLD session and the token")
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
    check(h.paths == [U] && h.sent[safe: 0]?.auth == "Bearer KST1.one", "when the token arrives, unregister with the signed-out session, no register")
}
do {
    let h = Harness()
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceive(.signedOut)
    h.registrar.didReceive(.signedIn("KST1.two"))
    h.registrar.didReceiveDeviceToken(tokA)
    check(h.paths == [R] && h.sent[safe: 0]?.auth == "Bearer KST1.two", "sign-out then a new sign-in before the token: just register the new one")
}

section("registrar: in-flight races")
do {
    let h = Harness()
    h.holdReplies = true
    h.registrar.didReceiveDeviceToken(tokA)
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceiveDeviceToken(tokA)
    check(h.paths == [R], "repeat posts while a register is in flight: still one register")
    check(h.store.saves == 1, "a repeat post of the same session does not rewrite the Keychain")
    h.held[safe: 0]?(nil)
    h.registrar.didReceive(.signedIn("KST1.one"))
    check(h.paths == [R, R], "once the in-flight one fails, the next post retries")
}
do {
    let h = Harness()
    h.holdReplies = true
    h.registrar.didReceiveDeviceToken(tokA)
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceive(.signedOut)
    check(h.paths == [R, U], "sign-out while the register is in flight unregisters at once")
    h.held[safe: 1]?(200)
    h.held[safe: 0]?(200)
    check(h.paths == [R, U, U], "the register landing after the sign-out is unregistered again")
    check(h.sent[safe: 2]?.auth == "Bearer KST1.one" && h.sent[safe: 2]?.body == ["token": tokA], "with the signed-out session and the token")
}
do {
    let h = Harness()
    h.holdReplies = true
    h.registrar.didReceiveDeviceToken(tokA)
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceive(.signedOut)
    h.registrar.didReceive(.signedIn("KST1.two"))
    h.held[safe: 0]?(200)
    check(!h.paths.dropFirst(2).contains(U), "a late register with a newer session signed in sends no extra unregister")
    check(h.paths.last == R && h.sent.last?.auth == "Bearer KST1.two", "the newer session registers")
}

section("registrar: an owed unregister survives a relaunch")
do {
    let h = Harness()
    h.registrar.didReceive(.signedIn("KST1.one"))
    h.registrar.didReceive(.signedOut)
    check(h.pending.value == "KST1.one", "sign-out before the token persists the owed unregister")
    check(h.store.value == nil, "while the live session is gone")
    // Relaunch: a fresh registrar over the same stores.
    let h2 = Harness(stored: h.store.value, pendingStored: h.pending.value)
    h2.replies = [nil]
    h2.registrar.didReceiveDeviceToken(tokA)
    check(h2.paths == [U] && h2.sent[safe: 0]?.auth == "Bearer KST1.one", "the relaunch sends the owed unregister, and no register")
    check(h2.pending.value == "KST1.one", "unreachable: still owed")
    let h3 = Harness(pendingStored: h2.pending.value)
    h3.registrar.didReceiveDeviceToken(tokA)
    check(h3.paths == [U] && h3.pending.value == nil, "answered: no longer owed")
}
do {
    let h = Harness(pendingStored: "KST1.old")
    h.registrar.didReceive(.signedIn("KST1.new"))
    check(h.pending.value == nil, "a new sign-in drops the owed unregister")
    h.registrar.didReceiveDeviceToken(tokA)
    check(h.paths == [R] && h.sent[safe: 0]?.auth == "Bearer KST1.new", "and only the new session registers")
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
    h.held[safe: 0]?(401)
    check(h.registrar.session == "KST1.new" && h.store.value == "KST1.new", "a stale 401 does not forget a newer session")
    h.held[safe: 1]?(200)
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

// MARK: - Notification categories (#3870)

// Approve and Deny did nothing when tapped, so the first store build shows no
// action buttons at all: a notification's only action is the plain tap.
section("notification categories")
do {
    let cats = NotificationCategories.all()
    let perm = cats.first { $0.identifier == "AGENT_PERMISSION" }
    check(perm != nil, "the agent-permission category is still registered, so a push's category still matches")
    check(cats.allSatisfy { $0.actions.isEmpty }, "no category registers an action button (Approve/Deny hidden)")
    check(cats.allSatisfy { $0.options.isEmpty }, "no category asks for dismiss delivery, which the handler has no branch for")
}

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
