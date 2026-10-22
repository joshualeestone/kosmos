import Foundation
import JavaScriptCore
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

section("shell: which end did not answer (#718 state 2)")
func failed(_ code: Int, _ host: String?) -> Shell.LoadFailure? {
    Shell.loadFailure(domain: NSURLErrorDomain, code: code, failingHost: host, coordinator: coordinator)
}
check(failed(NSURLErrorTimedOut, "leo.kosmosplus.com") == .macUnreachable, "a Mac's own address timing out: the Mac is not answering")
check(failed(NSURLErrorCannotConnectToHost, "Leo.KosmosPlus.com") == .macUnreachable, "a Mac's address in any case: the Mac")
check(failed(NSURLErrorSecureConnectionFailed, "leo.kosmosplus.com") == .macUnreachable, "a failed secure connection to a Mac: the Mac")
check(failed(NSURLErrorTimedOut, "login.kosmosplus.com") == .unreachable, "the coordinator timing out: Kosmos+, not a Mac")
check(failed(NSURLErrorTimedOut, "example.com") == .unreachable, "another host: Kosmos+ wording, never a Mac")
check(failed(NSURLErrorTimedOut, "a.b.kosmosplus.com") == .unreachable, "two labels deep is not a Mac's address")
check(failed(NSURLErrorTimedOut, nil) == .unreachable, "no failing address: Kosmos+ wording")
check(failed(NSURLErrorNetworkConnectionLost, "leo.kosmosplus.com") == .macUnreachable, "a Mac dropping the connection: the Mac")
check(failed(NSURLErrorServerCertificateUntrusted, "leo.kosmosplus.com") == .unreachable, "a certificate error on a Mac means the Mac answered: not asleep")
check(failed(NSURLErrorServerCertificateHasBadDate, "leo.kosmosplus.com") == .unreachable, "an expired Mac certificate: the Mac answered")
check(failed(NSURLErrorBadServerResponse, "leo.kosmosplus.com") == .unreachable, "a bad response from a Mac: it answered")
check(failed(NSURLErrorCannotFindHost, "leo.kosmosplus.com") == .unreachable, "a DNS failure is the phone's lookup, not the Mac asleep")
check(failed(NSURLErrorNotConnectedToInternet, "leo.kosmosplus.com") == .offline, "the phone offline stays offline, whichever address")
check(failed(NSURLErrorCancelled, "leo.kosmosplus.com") == nil, "a cancelled load on a Mac is still not a failure page")
check(!Shell.retriesOnShow(failure: .macUnreachable, online: true, alreadyRetried: false), "a Mac not answering is not auto-retried as if the phone came back online")

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
// kosmos#6850: a Mac that did not answer offers another computer; nothing else does.
check(Shell.offersOtherComputer(.macUnreachable), "a Mac not answering offers Choose another computer")
check(!Shell.offersOtherComputer(.offline), "offline: another computer would fail the same way")
check(!Shell.offersOtherComputer(.unreachable), "Kosmos+ not answering: the computer list is on Kosmos+ too")
check(!Shell.offersOtherComputer(.other), "any other failure: no computer was at fault")
check(Shell.otherComputerURL(coordinator: URL(string: "https://login.kosmosplus.com")!).absoluteString == "https://login.kosmosplus.com/account", "Choose another computer opens /account, which never opens a computer by itself")
check(Shell.otherComputerURL(coordinator: URL(string: "https://login.kosmosplus.com/")!).absoluteString == "https://login.kosmosplus.com/account", "a coordinator with a trailing slash gives the same address")
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

// MARK: - kosmos#6838: the native Agents tab

section("native board: requests")
do {
    let mac = URL(string: "https://studio.kosmosplus.com/")!
    let macs = Board.macsRequest(coordinator: coordinator, session: "kst1")
    check(macs.url?.absoluteString == "https://login.kosmosplus.com/v1/account/macs", "the Mac list is asked of Kosmos+")
    check(macs.value(forHTTPHeaderField: "Authorization") == "Bearer kst1", "with the Kosmos+ session as a bearer")
    check(macs.httpShouldHandleCookies == false, "and no cookies")
    let h = Board.handoffRequest(coordinator: coordinator, session: "kst1", address: "studio.kosmosplus.com")
    check(h.httpMethod == "POST" && h.url?.path == "/v1/account/handoff", "a handoff is a POST to /v1/account/handoff")
    let hb = (try? JSONSerialization.jsonObject(with: h.httpBody ?? Data())) as? [String: String]
    check(hb == ["address": "studio.kosmosplus.com"], "naming the Mac's address and nothing else")
    let s = Board.sessionRequest(mac: mac, handoffToken: "hand1")
    check(s.url?.absoluteString == "https://studio.kosmosplus.com/_kosmos/session" && s.httpMethod == "POST", "the gate's session door")
    check(s.value(forHTTPHeaderField: "Origin") == nil, "with no Origin header (the gate refuses only a foreign one)")
    let sb = (try? JSONSerialization.jsonObject(with: s.httpBody ?? Data())) as? [String: String]
    check(sb == ["token": "hand1"], "carrying the handoff token as the gate page does")
    check(Board.statusRequest(mac: mac).url?.absoluteString == "https://studio.kosmosplus.com/api/status", "the board snapshot")
    check(Board.statusRequest(mac: mac).value(forHTTPHeaderField: "Accept") == "application/json", "asking for JSON, so an ended session is a 401, not the sign-in page at 200")
}

section("native board: which Mac")
do {
    check(Board.macURL(address: "studio.kosmosplus.com", coordinator: coordinator)?.absoluteString == "https://studio.kosmosplus.com/", "a Mac under the relay domain")
    check(Board.macURL(address: "STUDIO.kosmosplus.com", coordinator: coordinator)?.host == "studio.kosmosplus.com", "case does not matter")
    check(Board.macURL(address: "login.kosmosplus.com", coordinator: coordinator) == nil, "the coordinator itself is not a Mac")
    check(Board.macURL(address: "evil.example.com", coordinator: coordinator) == nil, "another domain is refused")
    check(Board.macURL(address: "a.b.kosmosplus.com", coordinator: coordinator) == nil, "a deeper name is refused")
    let json = #"{"macs":[{"name":"Old","address":"old.kosmosplus.com","retired_at":1700000000},{"name":"Off","address":"off.kosmosplus.com","remote_off":true},{"name":"Studio","address":"studio.kosmosplus.com","retired_at":null},{"name":"","address":"laptop.kosmosplus.com"},{"name":"No address"}]}"#
    let macs = Board.parseMacs(Data(json.utf8)) ?? []
    check(macs.count == 4, "a row with no address is dropped")
    check(macs.map(\.usable) == [false, false, true, true], "retired and switched-off Macs are not usable; a null retired_at is")
    let heldRefused = Board.parseMacs(Data(#"{"macs":[{"address":"h.kosmosplus.com","held":true},{"address":"r.kosmosplus.com","refused":true}]}"#.utf8)) ?? []
    check(heldRefused.map(\.usable) == [false, false], "a held or refused Mac is not usable either")
    check(macs[3].name == "laptop.kosmosplus.com", "an empty name falls back to the address")
    check(Board.pickMac(macs, remembered: nil)?.address == "laptop.kosmosplus.com", "a usable Mac (none has a last-seen time here, so by address)")
    check(Board.pickMac(macs, remembered: "studio.kosmosplus.com")?.address == "studio.kosmosplus.com", "the remembered Mac while it is usable")
    check(Board.pickMac(macs, remembered: "old.kosmosplus.com")?.address == "laptop.kosmosplus.com", "not a remembered Mac that was retired")
    let ranked = #"{"macs":[{"name":"Old laptop","address":"old.kosmosplus.com","last_seen":100,"not_connected":true},{"name":"Studio","address":"studio.kosmosplus.com","last_seen":300},{"name":"Mini","address":"mini.kosmosplus.com","last_seen":200}]}"#
    let r = Board.parseMacs(Data(ranked.utf8)) ?? []
    check(Board.pickMac(r, remembered: nil)?.address == "studio.kosmosplus.com", "a connected Mac, most recently seen first, not simply the oldest")
    check(Board.pickMac(r, remembered: "mini.kosmosplus.com")?.address == "mini.kosmosplus.com", "the remembered Mac while it is connected")
    check(Board.pickMac(r, remembered: "old.kosmosplus.com")?.address == "studio.kosmosplus.com", "not a remembered Mac that is not connected, while another is")
    let allDown = #"{"macs":[{"address":"a.kosmosplus.com","last_seen":5,"not_connected":true},{"address":"b.kosmosplus.com","last_seen":9,"not_connected":true}]}"#
    check(Board.pickMac(Board.parseMacs(Data(allDown.utf8)) ?? [], remembered: nil)?.address == "b.kosmosplus.com", "with none connected, the most recently seen, so the screen can say it is not answering")
    let mixed = [Board.Mac(name: "Bad", address: "evil.example.com", usable: true, lastSeen: 999), Board.Mac(name: "Good", address: "good.kosmosplus.com", usable: true, lastSeen: 1)]
    check(Board.pickMac(Board.reachableMacs(mixed, coordinator: coordinator), remembered: nil)?.address == "good.kosmosplus.com", "a row with an address the app may not open never hides a good Mac")
    let tie = [Board.Mac(name: "z", address: "z.kosmosplus.com", usable: true), Board.Mac(name: "a", address: "a.kosmosplus.com", usable: true)]
    check(Board.pickMac(tie, remembered: nil)?.address == "a.kosmosplus.com", "equal last-seen: by address, the same answer every time")
    let refused = #"{"macs":[{"address":"new.kosmosplus.com","last_seen":900,"this_device":"denied"},{"address":"old.kosmosplus.com","last_seen":100}]}"#
    check(Board.pickMac(Board.parseMacs(Data(refused.utf8)) ?? [], remembered: nil)?.address == "old.kosmosplus.com", "a Mac that refused this iPhone is passed over while another can be tried")
    let onlyRefused = #"{"macs":[{"address":"new.kosmosplus.com","last_seen":900,"this_device":"denied"}]}"#
    check(Board.pickMac(Board.parseMacs(Data(onlyRefused.utf8)) ?? [], remembered: nil)?.address == "new.kosmosplus.com", "and still picked when it is the only one, so the screen can say it refused")
    check(Board.parseMacs(Data("[]".utf8)) == nil, "a body that is not the list reads as nothing")
    check(Board.parseHandoffToken(Data(#"{"token":"t"}"#.utf8)) == "t" && Board.parseHandoffToken(Data(#"{"token":""}"#.utf8)) == nil, "the handoff token, never an empty one")
}

section("native board: the Mac's answer")
do {
    func a(_ status: Int, _ body: String?, waiting: Bool = false) -> Board.SessionAnswer {
        Board.classifySession(status: status, body: body.map { Data($0.utf8) }, waiting: waiting)
    }
    check(a(200, nil) == .admitted, "200 is in")
    check(a(403, #"{"pending":true,"code":"4821"}"#) == .pending(code: "4821"), "pending, with the match code the Mac shows")
    check(a(403, #"{"pending":true}"#) == .pending(code: nil), "pending with no code")
    check(a(403, #"{"denied":true}"#) == .denied, "the Mac said no")
    check(a(400, nil, waiting: true) == .retry, "a 400 while waiting is a slow network, asked again")
    check(a(400, #"{"because":"that link expired"}"#) == .refused(because: "that link expired"), "a 400 before waiting is a refusal, with the reason")
    check(a(403, #"{"because":"wrong key"}"#) == .refused(because: "wrong key"), "a 403 that is neither pending nor denied is a refusal")
    check(a(502, "not json") == .refused(because: nil), "anything else is a refusal with no reason")
}

section("native board: agents")
do {
    let json = #"{"agents":[{"sessionName":"eli","name":"Eli","role":"Researcher","state":"idle"},{"sessionName":"cleo","name":"Cleo","role":"","state":"needs_you","stateReportedBy":"agent"},{"sessionName":"dana","name":"Dana","state":"working","task":"Pages 9 to 12"},{"name":"No key","state":"working"},{"sessionName":"farah","name":"Farah","state":"needs_you","awaitingApproval":true},{"sessionName":"gus","name":"Gus","state":"working","running":false},{"sessionName":"hal","name":"Hal","state":"connection_lost","reconnect":{"phase":"waiting"}},{"sessionName":"ida","name":"Ida","state":"idle","crashLoop":{"looping":true}}]}"#
    let agents = Board.parseAgents(Data(json.utf8)) ?? []
    let word = { (s: String) in Board.statusWord(agents.first { $0.session == s }!) }
    check(agents.count == 7, "a row with no sessionName is dropped")
    check(agents.first { $0.session == "cleo" }?.role == nil, "an empty role is no role")
    check(word("cleo") == "Question" && word("farah") == "Needs permission", "a question and a permission prompt, in the board's words")
    check(agents.first { $0.session == "farah" }?.needsYou == true && agents.first { $0.session == "dana" }?.needsYou == false, "needs you is marked, working is not")
    // The board's needsPerson (engine/status.js), case by case.
    check(Board.needsPerson(["state": "needs_trust"]), "a trust prompt needs you")
    check(Board.needsPerson(["state": "connection_lost", "reconnect": ["phase": "gave_up"]]) && !Board.needsPerson(["state": "connection_lost", "reconnect": ["phase": "waiting"]]), "a connection Kosmos gave up on needs you; one still reconnecting does not")
    check(Board.needsPerson(["state": "idle", "crashLoop": ["looping": true]]), "a crash loop needs you")
    check(Board.needsPerson(["state": "auth_failed", "stuckError": ["stuck": true]]) && !Board.needsPerson(["state": "auth_failed"]), "an error it is stuck on needs you; a passing one does not (as on the board)")
    check(Board.needsPerson(["state": "working", "ownBound": ["raised": true]]), "a helper that gave up needs you")
    check(!Board.needsPerson(["state": "working"]) && !Board.needsPerson(["state": "idle", "running": false]), "working, and plain not running, do not")
    check(word("gus") == "Not running", "an agent that is not running says so, whatever its last state")
    check(word("hal") == "Reconnecting\u{2026}", "a lost connection that is retrying says Reconnecting")
    check(word("ida") == "Keeps stopping", "a crash loop says Keeps stopping")
    check(Board.sorted(agents).prefix(2).map(\.session) == ["cleo", "farah"], "what needs you first, by name")
    let twins = [Board.Agent(session: "b", name: "Ann", role: nil, state: "idle", task: nil, needsYou: false), Board.Agent(session: "a", name: "ann", role: nil, state: "idle", task: nil, needsYou: false)]
    check(Board.sorted(twins).map(\.session) == ["a", "b"] && Board.sorted(twins.reversed()).map(\.session) == ["a", "b"], "names equal but for case keep one order")
    let w = { (s: String) in Board.statusWord(Board.Agent(session: "x", name: "x", role: nil, state: s, task: nil, needsYou: false)) }
    check(w("working") == "Working" && w("idle") == "Idle" && w("stopped") == "Not running" && w("blocked") == "Waiting", "the same words as engine/cardlabel.js for the plain states")
    check(w("needs_trust") == "Waiting on a trust prompt", "including a trust prompt")
    let off = { (s: String, trust: Bool, unseen: Bool) in Board.statusWord(Board.Agent(session: "x", name: "x", role: nil, state: s, task: nil, needsYou: false, running: false, needsTrust: trust, jobRunningUnseen: unseen)) }
    check(off("working", true, false) == "Waiting on a trust prompt", "not running at a trust prompt says so")
    check(off("working", false, true) == "Can't tell", "not running with a job Kosmos cannot see is Can't tell")
    check(off("restarting", false, false) == "Restarting agent", "a restarting agent is not called Not running")
    check(w("restarting") == "Restarting agent" && w("question") == "Question" && w("approval") == "Needs permission", "restarting while running, and the question and approval states, in the board's words")
    let stuck = Board.parseAgents(Data(#"{"agents":[{"sessionName":"r","name":"R","state":"restarting","disruption":{"timedOut":true}}]}"#.utf8)) ?? []
    check(stuck.first.map(Board.statusWord) == "Restarting agent, not back yet", "a restart that timed out says so, as the board does")
    check(w("connection_lost") == "Connection lost" && w("rate_limited") == "Rate Limit" && w("needs_you") == "Issue", "including the plain ones")
    check(w("something_new") == "Can't tell", "a state the phone does not know says what the board says for it, never blank")
    check(Board.parseAgents(Data(#"{"counts":{}}"#.utf8)) == nil, "a snapshot with no agents list reads as nothing")
    check(Board.parseAgents(Data("<html>sign in</html>".utf8)) == nil, "the gate's sign-in page reads as nothing, not an empty list")
    check(Board.sessionEnded(status: 401, contentType: "application/json"), "a 401 is an ended session")
    check(Board.sessionEnded(status: 200, contentType: "text/html; charset=utf-8"), "the sign-in page at 200 is an ended session")
    check(!Board.sessionEnded(status: 200, contentType: "application/json"), "a JSON answer that is not the list (a board starting) is only a missed refresh")
    check(!Board.sessionEnded(status: 502, contentType: "text/html") && !Board.sessionEnded(status: 302, contentType: nil), "a 5xx or a redirect is a missed refresh, not a sign-out")
}

section("native board: the Mac's session kept between launches")
do {
    let rec = Board.SavedMacSession(name: "Studio", address: "studio.kosmosplus.com", cookie: "c1", owner: Board.owner(of: "kst1"))
    let stored = Board.encode(rec)
    check(stored != nil && !(stored ?? "").contains("kst1"), "kept as a record that holds a fingerprint of the Kosmos+ session, never the session")
    check(Board.usableSaved(stored, session: "kst1", coordinator: coordinator) == rec, "reused under the same Kosmos+ session")
    check(Board.usableSaved(stored, session: "kst2", coordinator: coordinator) == nil, "never under another account or a new sign-in")
    check(Board.usableSaved(stored, session: nil, coordinator: coordinator) == nil, "never when signed out")
    check(Board.usableSaved(nil, session: "kst1", coordinator: coordinator) == nil && Board.usableSaved("not json", session: "kst1", coordinator: coordinator) == nil, "nothing kept, or something unreadable, is nothing")
    let foreign = Board.encode(Board.SavedMacSession(name: "x", address: "evil.example.com", cookie: "c1", owner: Board.owner(of: "kst1")))
    check(Board.usableSaved(foreign, session: "kst1", coordinator: coordinator) == nil, "a kept record naming a host outside the relay is refused")
    let empty = Board.encode(Board.SavedMacSession(name: "x", address: "studio.kosmosplus.com", cookie: "", owner: Board.owner(of: "kst1")))
    check(Board.usableSaved(empty, session: "kst1", coordinator: coordinator) == nil, "an empty cookie is not a session")
    check(Board.owner(of: "kst1") != Board.owner(of: "kst2") && Board.owner(of: "kst1").count == 64, "fingerprints differ per session")
}

// MARK: - kosmos#6838: the connect, poll and reconnect loop, against a fake Kosmos+ and Mac

// A fake world: Kosmos+ answers the Mac list and handoffs, the Mac's gate admits (setting its cookie in the client's
// jar, as a real Set-Cookie would), and /api/status answers from a queue. Waiting advances a fake clock, so the 15 s
// grace and the 30 s reconnect gap are real arithmetic, not real seconds.
final class FakeBoardWorld {
    var clock = Date(timeIntervalSince1970: 1_000_000)
    var requests: [String] = []
    var macsBody = #"{"macs":[{"name":"Studio","address":"studio.kosmosplus.com","last_seen":100}]}"#
    var sessionAnswer: (Int, String) = (200, #"{"ok":true}"#)
    var sessionNoAnswer = false
    // Each status request takes the first queued answer; nil is no answer at all. Empty queue: statusDefault.
    var statusQueue: [(Int, String)?] = []
    var statusDefault: (Int, String)? = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"}]}"#)
    var admitted = 0
    // The Mac cookie each status request carried, as the real session would send it from the jar.
    var presented: [String] = []
    var macsStatus = 200
    // The gate's own cookie keyed apart from the one the app restored (a leading-dot domain), as a real host-only
    // Set-Cookie might be: both then sit in the jar side by side.
    var admitKeyedApart = false
    // Pictures: an image, or (pictureAsPage) the gate's sign-in page at 200, as an ended session would answer.
    var pictureAsPage = false
    let cookies = URLSessionConfiguration.ephemeral.httpCookieStorage!

    func count(_ path: String) -> Int { requests.filter { $0.hasSuffix(path) }.count }

    func send(_ r: URLRequest) -> (Data, HTTPURLResponse)? {
        let url = r.url!
        requests.append("\(r.httpMethod ?? "GET") \(url.host ?? "")\(url.path)")
        func answer(_ code: Int, _ body: String) -> (Data, HTTPURLResponse) {
            (Data(body.utf8), HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
        }
        switch url.path {
        case "/v1/account/macs": return answer(macsStatus, macsStatus == 200 ? macsBody : "{}")
        case "/v1/account/handoff": return answer(200, #"{"token":"hand"}"#)
        case "/_kosmos/session":
            if sessionNoAnswer { return nil }
            if sessionAnswer.0 == 200 {
                admitted += 1
                cookies.setCookie(HTTPCookie(properties: [.name: Board.macCookieName, .value: "fresh-\(admitted)", .domain: (admitKeyedApart ? "." : "") + url.host!, .path: "/", .secure: "TRUE"])!)
            }
            return answer(sessionAnswer.0, sessionAnswer.1)
        case "/api/status":
            presented.append((cookies.cookies(for: url) ?? []).filter { $0.name == Board.macCookieName }.map(\.value).joined(separator: ","))
            let next: (Int, String)? = statusQueue.isEmpty ? statusDefault : statusQueue.removeFirst()
            return next.map { answer($0.0, $0.1) }
        default:
            if url.path.hasPrefix("/api/agent/") && url.path.hasSuffix("/avatar") {
                if pictureAsPage {
                    return (Data("<html>sign in</html>".utf8), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "text/html"])!)
                }
                return (Data([0x89, 0x50, 0x4e, 0x47]), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "image/png"])!)
            }
            return nil
        }
    }
}

@MainActor
func boardLoopTests() async {
    func make(_ session: String?, kept: String? = nil) -> (BoardClient, FakeBoardWorld, MemoryStore, MemoryStore) {
        let world = FakeBoardWorld()
        let sessions = MemoryStore(session)
        let macs = MemoryStore(kept)
        // One fixed suite, emptied for every case: the runs leave one small plist, never one per run.
        let defaults = UserDefaults(suiteName: "kosmos-board-loop-tests")!
        defaults.removePersistentDomain(forName: "kosmos-board-loop-tests")
        let client = BoardClient(coordinator: coordinator, sessionStore: sessions, macStore: macs, cookies: world.cookies,
                                 env: .init(send: { world.send($0) },
                                            sleep: { world.clock += $0; await Task.yield() },
                                            now: { world.clock },
                                            defaults: defaults))
        return (client, world, sessions, macs)
    }
    func settle(_ cond: () -> Bool) async -> Bool {
        for _ in 0..<5000 { if cond() { return true }; await Task.yield() }
        return cond()
    }
    func isLive(_ c: BoardClient) -> Bool { if case .live = c.phase { return !c.agents.isEmpty }; return false }
    func keptRecord(_ owner: String, cookie: String) -> String {
        Board.encode(Board.SavedMacSession(name: "Studio", address: "studio.kosmosplus.com", cookie: cookie, owner: Board.owner(of: owner)))!
    }

    section("native board: the spec's tones and order (Mona Lisa, slice 1)")
do {
    func a(_ s: String, _ name: String, state: String, needs: Bool = false, agent: Bool = false, approval: Bool = false) -> Board.Agent {
        Board.Agent(session: s, name: name, role: nil, state: state, task: nil, needsYou: needs, awaitingApproval: approval, reportedByAgent: agent)
    }
    check(Board.tone(a("q", "Q", state: "needs_you", needs: true, agent: true)) == .asked, "Question is asked (gold)")
    check(Board.tone(a("p", "P", state: "needs_you", needs: true, approval: true)) == .needsYou, "Needs permission is needs you (red)")
    check(Board.tone(a("r", "R", state: "rate_limited")) == .needsYou && Board.tone(a("s", "S", state: "stopped")) == .needsYou, "Rate Limit and Not running are needs you")
    check(Board.tone(a("w", "W", state: "working")) == .working && Board.tone(a("i", "I", state: "idle")) == .quiet, "Working is working, Idle is quiet")
    check(Board.tone(a("c", "C", state: "idle", needs: true)) == .needsYou, "a word the table does not list is needs you when the board counts the agent as needing the person")
    check(Board.tone(a("n", "N", state: "something_new")) == .quiet && Board.tone(a("u", "U", state: "unknown")) == .needsYou, "a state the phone does not know yet is quiet; the board's own unknown (Can't tell) is needs you")
    let mixed = [a("i", "Ivy", state: "idle"), a("w", "Wes", state: "working"), a("q", "Quinn", state: "needs_you", needs: true, agent: true), a("p", "Pat", state: "rate_limited")]
    check(Board.sorted(mixed).map(\.session) == ["p", "q", "w", "i"], "needs you and asked first (by name), then working, then quiet")
    let shown = [a("w", "Wes", state: "working"), a("i", "Ivy", state: "idle")]
    let fresh = [a("i", "Ivy", state: "needs_you", needs: true, agent: true), a("w", "Wes", state: "idle"), a("z", "Zed", state: "working"), a("b", "Bo", state: "idle")]
    let kept = Board.keepingOrder(shown, with: fresh)
    check(kept.map(\.session) == ["w", "i", "z", "b"], "a live update keeps the shown order and adds new agents at the end, sorted among themselves")
    check(kept[1].state == "needs_you", "while each kept row takes its new state")
    check(Board.keepingOrder(shown, with: [a("i", "Ivy", state: "idle")]).map(\.session) == ["i"], "an agent that is gone is dropped")
    let mac = URL(string: "https://studio.kosmosplus.com/")!
    check(Board.avatarRequest(mac: mac, session: "dana")?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/dana/avatar", "an agent's picture comes from its Mac")
    check(Board.avatarRequest(mac: mac, session: "../x") == nil && Board.avatarRequest(mac: mac, session: "a/b") == nil, "never for a name outside the agent-name characters")
    let pic = Board.parseAgents(Data(#"{"agents":[{"sessionName":"d","name":"D","state":"idle","hasAvatar":true,"avatarVer":3}]}"#.utf8))?.first
    check(pic?.hasAvatar == true && pic?.avatarVer == "3", "the picture flag and version are read from the snapshot")
}

section("native board loop: connecting")
    do {
        let (c, w, _, macs) = make("kst1")
        c.start()
        let ok1 = await settle { isLive(c) }
        check(ok1, "a fresh connect lists the agents")
        check(w.count("/v1/account/macs") == 1 && w.count("/v1/account/handoff") == 1 && w.count("/_kosmos/session") == 1, "by the Mac list, one handoff and one gate session")
        check(Board.usableSaved(macs.value, session: "kst1", coordinator: coordinator)?.cookie == "fresh-1", "and keeps the Mac's session for the next launch")
        c.stop()
    }
    do {
        let (c, w, _, _) = make("kst1", kept: keptRecord("kst1", cookie: "kept"))
        c.start()
        let ok2 = await settle { isLive(c) }
        check(ok2, "a kept Mac session is used at launch")
        check(w.count("/v1/account/handoff") == 0 && w.count("/_kosmos/session") == 0, "without a new sign-in to the Mac")
        c.stop()
    }
    do {
        // The bug review found (iteration 12): the reconnect restored the very record that had just ended.
        let (c, w, _, macs) = make("kst1", kept: keptRecord("kst1", cookie: "kept"))
        w.statusQueue = [(401, "{}")]
        c.start()
        let ok3 = await settle { isLive(c) }
        check(ok3, "a kept session the Mac has ended is replaced and the list comes back")
        check(w.count("/v1/account/handoff") == 1, "by one fresh sign-in, not by restoring the ended record again")
        check(Board.usableSaved(macs.value, session: "kst1", coordinator: coordinator)?.cookie == "fresh-1", "and the new session is the one kept")
        c.stop()
    }

    section("native board loop: a Mac that has just started")
    do {
        let (c, w, _, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        w.statusQueue = [(401, "{}"), (401, "{}")]
        let before = w.count("/api/status")
        let ok4 = await settle { w.count("/api/status") >= before + 4 }
        check(ok4, "it keeps polling through 401s")
        check(w.count("/v1/account/handoff") == 1 && isLive(c), "two 401s within 15 s of a working session keep it (no new sign-in)")
        w.statusDefault = (401, "{}")
        let ok5 = await settle { w.count("/v1/account/handoff") == 2 }
        check(ok5, "401s past the 15 s grace sign in again")
        c.stop()
    }

    section("native board loop: sign-out and another account")
    do {
        let (c, w, sessions, macs) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        sessions.value = "kst2"
        c.start()
        check(c.agents.isEmpty, "another account's sign-in clears the old list at once")
        let ok6 = await settle { isLive(c) && Board.usableSaved(macs.value, session: "kst2", coordinator: coordinator) != nil }
        check(ok6, "and connects again under the new account")
        check(w.count("/v1/account/handoff") == 2, "with its own sign-in to the Mac")
        sessions.value = nil
        c.start()
        let ok7 = await settle { c.phase == .signedOut } && c.agents.isEmpty
        check(ok7, "signed out: nothing shown")
        check(macs.value != nil, "the kept Mac session is left for the sign-out itself to delete (PushNotificationManager)")
        c.stop()
    }

    section("native board loop: not answering, and Try again")
    do {
        let (c, w, _, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        w.statusDefault = nil
        let ok8 = await settle { c.phase == .unreachable(mac: "Studio") }
        check(ok8, "three refreshes with no answer say the Mac is not answering")
        let lists = w.count("/v1/account/macs")
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"}]}"#)
        c.retry()
        let ok9 = await settle { isLive(c) } && w.count("/v1/account/macs") == lists
        check(ok9, "the first Try again reuses the Mac session (the Mac may only have slept)")
        w.statusDefault = nil
        _ = await settle { c.phase == .unreachable(mac: "Studio") }
        c.retry()
        _ = await settle { c.phase == .unreachable(mac: "Studio") }
        c.retry()
        let ok10 = await settle { w.count("/v1/account/macs") == lists + 1 }
        check(ok10, "a second Try again in a row asks Kosmos+ for the Macs afresh")
        c.stop()
    }

    section("native board loop: an ended session is never restored")
    do {
        // Review iteration 13: after the Mac ended the kept session and the reconnect found no answer, the first Try
        // again restored the same ended cookie.
        let (c, w, _, macs) = make("kst1", kept: keptRecord("kst1", cookie: "kept"))
        w.statusQueue = [(401, "{}")]
        w.sessionNoAnswer = true
        c.start()
        let ok20 = await settle { c.phase == .unreachable(mac: "Studio") }
        check(ok20 && macs.value == nil, "a kept session the Mac ended is deleted, not kept for later")
        w.sessionNoAnswer = false
        c.retry()
        let ok21 = await settle { isLive(c) }
        check(ok21 && w.count("/v1/account/handoff") >= 2, "Try again then signs in fresh rather than restoring the ended cookie")
        c.stop()
    }

    section("native board loop: the cookie sent, and the failure screens")
    do {
        let (c, w, _, _) = make("kst1", kept: keptRecord("kst1", cookie: "kept"))
        c.start()
        let ok30 = await settle { isLive(c) }
        check(ok30 && w.presented.first == "kept", "a kept session's cookie is the one presented to the Mac")
        c.stop()
    }
    do {
        let (c, w, _, _) = make("kst1", kept: keptRecord("kst1", cookie: "kept"))
        w.statusQueue = [(401, "{}")]
        w.admitKeyedApart = true
        c.start()
        let ok31 = await settle { isLive(c) }
        check(ok31 && w.presented.last == "fresh-1", "after the Mac ends it, only the new cookie is presented, never the ended one beside it")
        c.stop()
    }
    do {
        let (c, w, _, _) = make("kst1")
        w.macsStatus = 401
        c.start()
        let ok32 = await settle { c.phase == .signedOut }
        check(ok32, "Kosmos+ answering 401 means signed out")
        c.stop()
    }
    do {
        let (c, w, _, _) = make("kst1")
        w.macsStatus = 403
        c.start()
        let ok33 = await settle { c.phase == .kosmosPlusRefused }
        check(ok33, "Kosmos+ answering 403: its own refusal, not the Mac's")
        c.stop()
    }
    do {
        let (c, w, _, _) = make("kst1")
        w.sessionAnswer = (403, #"{"pending":false,"denied":true}"#)
        c.start()
        let ok34 = await settle { c.phase == .denied(mac: "Studio") }
        check(ok34, "the Mac denying this iPhone says so")
        c.stop()
    }
    do {
        let (c, w, _, _) = make("kst1")
        w.sessionAnswer = (403, #"{"because":"that sign-in is not valid any more"}"#)
        c.start()
        let ok35 = await settle { c.phase == .macRefused(mac: "Studio") }
        check(ok35 && w.count("/v1/account/handoff") == 7, "a gate that keeps refusing gets six fresh handoffs, then says it did not accept the sign-in")
        c.stop()
    }

    section("native board loop: rows hold still until pull to refresh")
    do {
        let (c, w, _, _) = make("kst1")
        w.statusDefault = (200, #"{"agents":[{"sessionName":"zed","name":"Zed","state":"working"},{"sessionName":"amy","name":"Amy","state":"idle"}]}"#)
        c.start()
        let ok40 = await settle { isLive(c) }
        check(ok40 && c.agents.map(\.session) == ["zed", "amy"], "on appear the list is sorted (working before quiet)")
        w.statusDefault = (200, #"{"agents":[{"sessionName":"zed","name":"Zed","state":"idle"},{"sessionName":"amy","name":"Amy","state":"needs_you","stateReportedBy":"agent"}]}"#)
        let polls = w.count("/api/status")
        let ok41 = await settle { w.count("/api/status") >= polls + 2 && c.agents.first?.state == "idle" }
        check(ok41 && c.agents.map(\.session) == ["zed", "amy"], "a live update changes the rows in place and does not move them")
        await c.refreshNow()
        check(c.agents.map(\.session) == ["amy", "zed"], "pull to refresh re-sorts (Amy's question first)")
        c.stop()
    }

    section("native board loop: pictures")
    do {
        let (c, w, _, _) = make("kst1")
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working","hasAvatar":true,"avatarVer":1}]}"#)
        c.start()
        let ok50 = await settle { c.pictures["dana"] != nil }
        check(ok50 && w.count("/api/agent/dana/avatar") == 1, "an agent's picture is fetched once for its version")
        let polls = w.count("/api/status")
        _ = await settle { w.count("/api/status") >= polls + 3 }
        check(w.count("/api/agent/dana/avatar") == 1, "and not again while the version is the same")
        c.stop()
    }
    do {
        let (c, w, _, _) = make("kst1")
        w.pictureAsPage = true
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working","hasAvatar":true,"avatarVer":1}]}"#)
        c.start()
        let ok51 = await settle { w.count("/api/agent/dana/avatar") >= 2 }
        check(ok51 && c.pictures["dana"] == nil, "the gate's sign-in page is never taken for a picture, and it is asked for again")
        w.pictureAsPage = false
        let ok52 = await settle { c.pictures["dana"] != nil }
        check(ok52, "and the picture arrives once the Mac answers with one")
        c.stop()
    }

    do {
        let (c, w, _, _) = make("kst1")
        w.pictureAsPage = true
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working","hasAvatar":true,"avatarVer":7}]}"#)
        c.start()
        _ = await settle { w.count("/api/agent/dana/avatar") >= 3 }
        let polls = w.count("/api/status")
        _ = await settle { w.count("/api/status") >= polls + 4 }
        check(w.count("/api/agent/dana/avatar") == 3, "a picture that keeps failing is asked for three times per version, then left")
        c.stop()
    }
    do {
        let (c, w, _, _) = make("kst1")
        w.sessionAnswer = (403, #"{"pending":true,"code":"77"}"#)
        c.start()
        _ = await settle { c.phase == .waitingForAllow(mac: "Studio", code: "77") }
        let handoffs = w.count("/v1/account/handoff")
        await c.refreshNow()
        check(c.phase == .waitingForAllow(mac: "Studio", code: "77") && w.count("/v1/account/handoff") == handoffs, "pull to refresh while waiting for Allow changes nothing (no new sign-in, no second Allow)")
        c.stop()
    }

    section("native board loop: not answering clears by itself")
    do {
        let (c, w, _, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        w.statusDefault = nil
        _ = await settle { c.phase == .unreachable(mac: "Studio") }
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"}]}"#)
        let ok53 = await settle { isLive(c) }
        check(ok53 && w.count("/v1/account/handoff") == 1, "the next good read clears not answering, with no Try again and no new sign-in")
        c.stop()
    }

    section("native board loop: an old list is never shown as current")
    do {
        let (c, w, _, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) && c.fresh }
        c.stop()
        w.statusDefault = nil
        c.start()
        check(!c.fresh && !c.agents.isEmpty, "back on the tab, the earlier list is shown as not current until a new read")
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"}]}"#)
        let ok60 = await settle { c.fresh }
        check(ok60, "and current again after one")
        c.stop()
    }
    do {
        // Review iteration 20: after a refusal or not answering, admitted is unset, so the account check must look at
        // whose list is on screen.
        let (c, w, sessions, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        w.statusDefault = nil
        _ = await settle { c.phase == .unreachable(mac: "Studio") }
        c.retry()
        _ = await settle { c.phase == .unreachable(mac: "Studio") }
        c.retry()
        c.stop()
        sessions.value = "kst2"
        c.start()
        check(c.agents.isEmpty, "another account's sign-in clears the old list even when no Mac session is held")
        c.stop()
    }

    section("native board loop: waiting for Allow")
    do {
        let (c, w, _, _) = make("kst1")
        w.sessionAnswer = (403, #"{"pending":true,"code":"4821"}"#)
        c.start()
        let ok11 = await settle { c.phase == .waitingForAllow(mac: "Studio", code: "4821") }
        check(ok11, "the Mac showing Allow shows its code")
        w.sessionAnswer = (200, #"{"ok":true}"#)
        let ok12 = await settle { isLive(c) }
        check(ok12, "and once Allow is pressed the list comes")
        c.stop()
    }
}

// MARK: - The app's tab bar (#6846 part b)

section("app tabs: the bar")
check(AppTabs.visible(tasksTab: true) == [.today, .agents, .projects, .tasks, .settings], "five tabs in Mona Lisa's order once Tasks is earned")
check(AppTabs.visible(tasksTab: false) == [.today, .agents, .projects, .settings], "four before it, Tasks left out (#3559)")
check(AppTabs.keep(.tasks, tasksTab: false) == .today, "Tasks leaving the bar while showing goes to Today")
check(AppTabs.keep(.projects, tasksTab: false) == .projects, "any other tab stays where it is")
check(AppTabs.keep(.tasks, tasksTab: true) == .tasks, "Tasks stays while it is in the bar")
check(AppTabs.Tab.today.boardName == "agents", "Today opens the board's home, its agents tab")
check(AppTabs.Tab.agents.boardName == nil && AppTabs.pressScript(.agents) == nil, "Agents is native: no press on the board")
check(AppTabs.pressScript(.settings)?.contains("window.kosmosAppTab('settings')") == true, "a press asks the door for that tab's board name")

section("app tabs: the door's answer")
struct DoorError: Error {}
check(AppTabs.answer("opened", error: nil) == .opened, "opened is opened")
check(AppTabs.answer("refused", error: nil) == .refused, "refused is refused: the bar goes back")
check(AppTabs.answer("absent", error: nil) == .noDoor, "the script's absent is a page without the door")
check(AppTabs.answer(nil, error: nil) == .absent && AppTabs.answer(true, error: nil) == .absent, "anything else is no answer, never opened")
check(AppTabs.answer("opened", error: DoorError()) == .absent, "an error (a page mid-navigation) is no answer, whatever came with it")

section("app tabs: the press, run")
func pressIn(_ door: String?, _ tab: AppTabs.Tab) -> (AppTabs.DoorAnswer, String?) {
    let js = JSContext()!
    js.evaluateScript("var window = {}; var pressed = null;")
    if let door = door { js.evaluateScript("window.kosmosAppTab = function (n) { pressed = n; return \(door); };") }
    let result = js.evaluateScript(AppTabs.pressScript(tab)!)?.toObject()
    let threw = js.exception != nil
    let pressed = js.evaluateScript("pressed")?.toString()
    return (threw ? .absent : AppTabs.answer(result, error: nil), threw ? "threw" : pressed)
}
check(pressIn("true", .projects) == (.opened, "projects"), "a board that opens the section answers opened, for the name asked")
check(pressIn("true", .today) == (.opened, "agents"), "Today asks for the board's home")
check(pressIn("false", .projects) == (.refused, "projects"), "a board that says no answers refused")
check(pressIn("1", .projects) == (.refused, "projects"), "only a real true is opened (a number 1 is refused)")
check(pressIn("undefined", .settings) == (.refused, "settings"), "a door that answers nothing is refused, not opened")
check(pressIn(nil, .today) == (.noDoor, "null"), "a page without the door answers absent, and asking does not throw")
check(pressIn("(function () { throw new Error('broken'); })()", .projects) == (.refused, "projects"), "a door that throws is refused, so the press ends")

section("app tabs: what an answer does")
let roomURL = URL(string: "https://studio.kosmosplus.com/?tab=projects&project=x")
let settingsURL = URL(string: "https://studio.kosmosplus.com/?tab=settings&sec=you")
let tasksURL = URL(string: "https://studio.kosmosplus.com/?tab=tasks")
check(AppTabs.afterAnswer(.opened, pageURL: roomURL) == (true, nil), "opened: the press is over, the bar stays")
check(AppTabs.afterAnswer(.absent, pageURL: roomURL) == (false, nil), "absent: the press waits, the bar stays")
check(AppTabs.afterAnswer(.refused, pageURL: roomURL) == (true, .projects), "refused: the bar goes to the section the page is on (a project room: Projects)")
check(AppTabs.afterAnswer(.refused, pageURL: settingsURL) == (true, .settings), "on Settings: Settings")
check(AppTabs.afterAnswer(.refused, pageURL: nil) == (true, .today), "no address: Today")
check(AppTabs.afterAnswer(.noDoor, pageURL: URL(string: "https://\(AppTabs.signInHost)/")) == (false, nil), "no door on the sign-in page: the press waits for the Mac")
check(AppTabs.afterAnswer(.noDoor, pageURL: nil) == (false, nil), "no door and no address: it waits")
check(AppTabs.afterAnswer(.noDoor, pageURL: roomURL) == (true, .projects), "no door on a Mac's page (an older board): the press ends and the bar goes where the page is")
check(AppTabs.signInHost == "login.kosmosplus.com", "the sign-in host is the coordinator's (KosmosConfig.coordinatorOrigin)")
let anyURL = ["?tab=agents", "?tab=detail&agent=a", "?tab=projects", "?tab=tasks", "?tab=settings", "", "?tab=zzz"].map { URL(string: "https://m.kosmosplus.com/" + $0) }
check(anyURL.allSatisfy { AppTabs.afterAnswer(.refused, pageURL: $0).barTo != .agents }, "no refusal ever puts the bar on Agents, where the box would be out of sight")

section("app tabs: the bar's labels")
check(AppTabs.visible(tasksTab: true).map(\.title) == ["Today", "Agents", "Projects", "Tasks", "Settings"], "the bar's words, in order")
check(AppTabs.visible(tasksTab: true).map(\.symbol) == ["sun.max", "person.2", "folder", "checklist", "gearshape"], "the spec's symbols")

section("app tabs: press bookkeeping")
do {
    var t = PressTracker()
    check(t.press(.projects, page: .noView) == nil && t.pending == .projects, "with no web view yet (a signed-in launch on Agents) the tracker keeps the press (BoardWeb runs it at the load)")
    check(t.press(.settings, page: .loading) == nil && t.pending == .settings, "a page still loading: the press waits")
    let serialBefore = t.serial
    let run = t.press(.projects, page: .ready)
    check(run != nil && run?.script == AppTabs.pressScript(.projects) && run?.serial == serialBefore + 1, "a ready page: the press runs, with a new number")
    check(t.answered(serial: run!.serial, .absent, pageURL: nil) == nil && t.pending == .projects, "no door: it still waits")
    let waiting = t.press(.projects, page: .ready)!
    check(t.running, "the press is running while it waits for its answer")
    check(t.answered(serial: waiting.serial, .absent, pageURL: nil) == nil && !t.running && t.pending == .projects, "no answer: it waits for a load, but no longer holds the bar")
    let again = t.press(.projects, page: .ready)!
    check(t.answered(serial: again.serial, .opened, pageURL: nil) == .projects && t.pending == nil && !t.running, "opened: over, and the bar goes to the tab pressed")

    var u = PressTracker()
    let first = u.press(.projects, page: .ready)!
    let second = u.press(.settings, page: .ready)!
    check(u.answered(serial: first.serial, .refused, pageURL: roomURL) == nil && u.pending == .settings, "a late answer to an earlier press moves nothing and ends nothing")
    check(u.answered(serial: second.serial, .refused, pageURL: roomURL) == .projects && u.pending == nil, "the latest press's refusal ends it and moves the bar to the page's tab")

    var v = PressTracker()
    let shown = v.press(.settings, page: .ready)!
    v.loadingOwnPage()
    check(v.pending == nil && v.answered(serial: shown.serial, .refused, pageURL: settingsURL) == nil, "an agent tap ends a press, and a late refusal of it cannot move the bar")
    _ = v.press(.projects, page: .loading)
    check(v.press(.agents, page: .ready) == nil && v.pending == nil, "the native tab ends a waiting press")

    var w = PressTracker()
    let before = w.press(.tasks, page: .ready)!
    let page = w.generation
    check(w.read(true, generation: page) == true && w.readThisLaunch, "a read before the lock counts")
    w.drop(selected: .projects)
    check(w.pending == .projects && !w.readThisLaunch, "after a lock, the fresh page opens the selected tab and reads again")
    check(w.answered(serial: before.serial, .opened, pageURL: nil) == nil && w.pending == .projects, "a late answer from the dropped page does not end it")
    check(w.read(true, generation: page) == nil && !w.readThisLaunch, "nor does a late Tasks read from it count")
    w.drop(selected: .agents)
    check(w.pending == nil, "a lock on Agents leaves nothing to press")
}

section("app tabs: the bar follows the page")
do {
    let home = URL(string: "https://studio.kosmosplus.com/")
    let signIn = URL(string: "https://\(AppTabs.signInHost)/")
    func f(_ from: URL?, _ to: URL?, _ selected: AppTabs.Tab, held: Bool = false, tasks: Bool = false) -> AppTabs.Tab? {
        AppTabs.follow(from: from, to: to, selected: selected, barHeld: held, tasksTab: tasks)
    }
    check(f(home, roomURL, .today) == .projects, "a link from Today into a project room lights Projects")
    check(f(roomURL, home, .projects) == .today, "a swipe back to the board's home lights Today")
    check(f(home, roomURL, .projects) == nil, "already right: nothing moves")
    check(f(home, settingsURL, .today, held: true) == nil, "the bar held for a press: its answer decides, not the address")
    check(f(home, settingsURL, .agents) == nil, "never from Agents, which shows no page")
    check(f(home, nil, .settings) == nil, "no address: nothing moves")
    check(f(home, signIn, .projects) == nil, "never on the sign-in page")
    let roomTwo = URL(string: "https://studio.kosmosplus.com/?tab=projects&project=y")
    check(f(roomURL, roomTwo, .settings) == nil, "an address rewritten within one section (Settings opened over the consolidated layout keeps ?tab=projects) moves nothing")
    check(f(roomURL, tasksURL, .projects) == nil, "a project's View all onto a Tasks section the bar does not offer stays under Projects")
    check(f(home, tasksURL, .today) == .projects, "and lights Projects from elsewhere")
    check(f(roomURL, tasksURL, .projects, tasks: true) == .tasks, "Tasks once the bar has it")
    check(f(signIn, home, .today) == nil && f(signIn, roomURL, .today) == .projects, "from the sign-in page to a Mac's page is a real move")
    check(AppTabs.barTab(forPage: .tasks, tasksTab: false) == .projects && AppTabs.barTab(forPage: .settings, tasksTab: false) == .settings, "a hidden Tasks section belongs under Projects; any other section lights its own tab")
}

section("app tabs: Tasks read rounds")
do {
    var t = PressTracker()
    let g = t.generation
    let r1 = t.loaded() ?? -1
    let r2 = t.loaded() ?? -2
    check(r1 > 0 && r2 > 0 && r1 != r2, "each load starts a round")
    check(!t.shouldRead(round: r1, generation: g) && t.shouldRead(round: r2, generation: g), "only the latest round reads, so they do not stack")
    check(t.read(nil, generation: g) == nil && !t.readThisLaunch, "the sign-in page's nothing does not end the launch's reads")
    check(t.read(false, generation: g) == false && !t.readThisLaunch && t.shouldRead(round: r2, generation: g), "a launch's 0 is applied but the round reads on (it can be last session's flag)")
    check(t.read(true, generation: g) == true && t.readThisLaunch, "a 1 sets the bar and ends the launch's reads")
    do {
        var z = PressTracker()
        let zr = z.loaded()!
        _ = z.read(false, generation: z.generation)
        check(z.shouldRead(round: zr, generation: z.generation) && z.loaded() == nil, "after a launch's 0 its round reads on, but a later load (an agent tap) starts no new round")
        z.drop(selected: .today)
        check(z.loaded() != nil, "a lock's fresh page reads again, as at launch")
        var y = PressTracker()
        let yr = y.loaded(host: "mac-a.example")!
        _ = y.read(true, generation: y.generation)
        check(y.loaded(host: "mac-a.example") == nil, "the same Mac again: no new round")
        let other = y.loaded(host: "mac-b.example")
        check(other != nil && other != yr && !y.readThisLaunch, "another Mac (switched in the page): its flag is read again")
    }
    check(!t.shouldRead(round: r2, generation: g) && t.loaded() == nil, "and then the rounds stop, and loads start none")
    let back = t.returned()
    check(t.shouldRead(round: back, generation: g) && t.read(false, generation: g) == false, "a return to the front starts a round, and its answers count")
    check(t.shouldRead(round: back, generation: g), "and it keeps reading after an answer (its first reads can predate the board's next poll)")
    check(t.loaded() == nil && t.shouldRead(round: back, generation: g), "once the launch has an answer, a load during it starts no launch round and does not cut it")
    check(PressTracker.returnReads.min()! > 5 && PressTracker.returnReads.count >= 2, "a return reads only after a board poll (every 5 s) could have written the flag, more than once")
    check(PressTracker.launchReads.first == 0 && PressTracker.launchReads.last == 20, "a launch reads from the load for 20 s")
    t.drop(selected: .today)
    check(!t.readThisLaunch && !t.shouldRead(round: back, generation: g), "after a lock the dropped page's reads do not run")
    let fresh = t.loaded()
    check(fresh != nil && t.shouldRead(round: fresh!, generation: t.generation), "and the fresh page reads again, as at launch")
}
func marked(rootLater: Bool) -> Bool {
    let js = JSContext()!
    js.evaluateScript("""
    var observers = [];
    function MutationObserver(cb) { this.cb = cb; this.on = false; observers.push(this); }
    MutationObserver.prototype.observe = function () { this.on = true; };
    MutationObserver.prototype.disconnect = function () { this.on = false; };
    var root = { classes: [], classList: { add: function (c) { root.classes.push(c); } } };
    var document = { documentElement: \(rootLater ? "null" : "root") };
    """)
    js.evaluateScript(AppTabs.markScript)
    if rootLater {
        js.evaluateScript("observers.forEach(function (o) { if (o.on) o.cb([], o); }); document.documentElement = root; observers.forEach(function (o) { if (o.on) o.cb([], o); }); observers.forEach(function (o) { if (o.on) o.cb([], o); });")
    }
    return js.exception == nil && js.evaluateScript("root.classes.join(',')").toString() == "kapptabs"
}
check(marked(rootLater: false), "the page's root gets kapptabs at once when it exists")
check(marked(rootLater: true), "and once, when it arrives, when the script runs before <html> exists")
func pageFlag(_ stored: String?, storage: Bool = true) -> FlagRead {
    let js = JSContext()!
    if storage {
        js.evaluateScript("var localStorage = { getItem: function (k) { return k === 'kosmos.tasksTab' ? \(stored.map { "'\($0)'" } ?? "null") : 'wrong key'; } };")
    } else {
        js.evaluateScript("var localStorage = { getItem: function () { throw new Error('blocked'); } };")
    }
    let answer = js.evaluateScript(AppTabs.tasksReadScript)?.toObject()
    return js.exception == nil ? .read(AppTabs.tasksTab(fromPage: answer)) : .threw
}
enum FlagRead: Equatable { case read(Bool?), threw }
check(pageFlag("1") == .read(true), "the board's flag 1 shows Tasks")
check(pageFlag("0") == .read(false), "0 hides it")
check(pageFlag(nil) == .read(nil), "no flag (the sign-in page, an older board) says nothing")
check(pageFlag(nil, storage: false) == .read(nil), "blocked storage says nothing, and does not throw")
check(AppTabs.tasksTab(fromPage: NSNull()) == nil && AppTabs.tasksTab(fromPage: 1) == nil, "only the strings 1 and 0 count")

section("app tabs: the tab an address belongs to")
func tabFor(_ s: String) -> AppTabs.Tab { AppTabs.tab(forBoardURL: URL(string: s)) }
check(tabFor("http://10.0.0.2:8080/?tab=projects&project=launchthespringcatalogue") == .projects, "a project room lights Projects")
check(tabFor("http://10.0.0.2:8080/?tab=tasks") == .tasks && tabFor("http://10.0.0.2:8080/?tab=settings&sec=you") == .settings, "tasks and settings light their own")
check(tabFor("http://10.0.0.2:8080/?tab=detail&agent=cleo") == .today, "an agent's chat lights Today, where chats show")
check(tabFor("http://10.0.0.2:8080/") == .today && tabFor("http://10.0.0.2:8080/?tab=agents") == .today, "the home lights Today")
check(tabFor("http://10.0.0.2:8080/?tab=nonsense") == .today && AppTabs.tab(forBoardURL: nil) == .today, "anything else lights Today")

// MARK: - kosmos#6487: a notification's words, asked of the person's own computer

section("phone notice: the request for a notification's words")
let savedMac = #"{"name":"Studio","address":"m-abc123.kosmosplus.com","cookie":"c00kie","owner":"x"}"#
let pushed: [AnyHashable: Any] = ["id": "report:2026-10-22T18:28:40.123Z:irma", "address": "m-abc123.kosmosplus.com", "session": "irma", "kind": "needs_you"]
if let r = PhoneNotice.wordsRequest(userInfo: pushed, stored: savedMac) {
    check(r.url?.absoluteString == "https://m-abc123.kosmosplus.com/api/phone/notice?id=report:2026-10-22T18:28:40.123Z:irma", "asks the computer the push names, for that push's id: \(r.url?.absoluteString ?? "-")")
    check(r.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && !r.httpShouldHandleCookies, "with the kept session's cookie, by hand")
} else { check(false, "a push with a kept session for its computer makes a request") }
var otherMac = pushed; otherMac["address"] = "m-other.kosmosplus.com"
check(PhoneNotice.wordsRequest(userInfo: otherMac, stored: savedMac) == nil, "a push from a computer the kept session is not for: no request (the notice shows as it came)")
check(PhoneNotice.wordsRequest(userInfo: pushed, stored: nil) == nil, "no kept session: no request")
check(PhoneNotice.wordsRequest(userInfo: pushed, stored: "not json") == nil, "an unreadable kept session: no request")
check(PhoneNotice.wordsRequest(userInfo: pushed, stored: #"{"name":"S","address":"m-abc123.kosmosplus.com","cookie":"","owner":"x"}"#) == nil, "an empty cookie: no request")
var crashloop = pushed; crashloop["id"] = "crashloop:2026-10-22T18:28:40.123Z:irma"
check(PhoneNotice.wordsRequest(userInfo: crashloop, stored: savedMac) == nil, "a kind of push the computer has no words for: no request")
for bad in ["m-abc123.kosmosplus.com/x", "m-abc123.kosmosplus.com:444", "user@m-abc123.kosmosplus.com", "", ".kosmosplus.com", "m..x.com"] {
    var b = pushed; b["address"] = bad
    let stored = #"{"name":"S","address":"\#(bad)","cookie":"c","owner":"x"}"#
    check(PhoneNotice.wordsRequest(userInfo: b, stored: stored) == nil, "an address that is not a bare host name is refused: \(bad)")
}
var upper = pushed; upper["address"] = "M-ABC123.kosmosplus.com"
check(PhoneNotice.wordsRequest(userInfo: upper, stored: savedMac)?.url?.host == "m-abc123.kosmosplus.com", "the address compared without case")

section("phone notice: reading the answer")
let json = "application/json; charset=utf-8"
let answer = Data(#"{"kind":"report","session":"irma","agent":"Irma","text":"Can I send the lease?","picture":"/api/agent/irma/avatar"}"#.utf8)
let w = PhoneNotice.words(status: 200, contentType: json, data: answer, userInfo: pushed)
check(w?.agent == "Irma" && w?.text == "Can I send the lease?", "a 200 JSON answer gives the agent and the words")
check(PhoneNotice.words(status: 404, contentType: json, data: answer, userInfo: pushed) == nil, "a 404 (no words for it): nothing")
check(PhoneNotice.words(status: 200, contentType: "text/html", data: answer, userInfo: pushed) == nil, "a page that is not JSON (a sign-in page): nothing")
var otherAgent = pushed; otherAgent["session"] = "leo"
check(PhoneNotice.words(status: 200, contentType: json, data: answer, userInfo: otherAgent) == nil, "words for another agent than the push named: nothing")
check(PhoneNotice.words(status: 200, contentType: json, data: Data(#"{"kind":"report","session":"irma","agent":"Irma","text":"  ","picture":null}"#.utf8), userInfo: pushed) == nil, "blank words: nothing")
check(PhoneNotice.words(status: 200, contentType: json, data: Data(repeating: 0x20, count: PhoneNotice.maxAnswerBytes + 1), userInfo: pushed) == nil, "an oversized answer is not read")

section("phone notice: the agent's picture")
if let w {
    check(PhoneNotice.pictureRequest(w, userInfo: pushed, stored: savedMac)?.url?.absoluteString == "https://m-abc123.kosmosplus.com/api/agent/irma/avatar", "the picture comes from the same computer's avatar route")
    for bad in ["https://evil.example/api/agent/irma/avatar", "//evil.example/api/agent/irma/avatar", "/api/agent/../../etc/avatar", "/api/status", "/api/agent/irma/avatar?x=1"] {
        let b = PhoneNotice.Words(kind: w.kind, session: w.session, agent: w.agent, text: w.text, picture: bad)
        check(PhoneNotice.pictureRequest(b, userInfo: pushed, stored: savedMac) == nil, "a picture address off that route is refused: \(bad)")
    }
    check(PhoneNotice.pictureRequest(PhoneNotice.Words(kind: "report", session: "irma", agent: "Irma", text: "x", picture: nil), userInfo: pushed, stored: savedMac) == nil, "no picture: no request")
}
check(PhoneNotice.pictureData(status: 200, contentType: "image/png", data: Data([1, 2, 3])) != nil, "a 200 image is shown")
check(PhoneNotice.pictureData(status: 200, contentType: "text/html", data: Data([1])) == nil && PhoneNotice.pictureData(status: 404, contentType: "image/png", data: Data([1])) == nil, "anything else is not")

section("phone notice: a picture as an attachment needs a file type iOS shows")
check(PhoneNotice.attachmentExtension(contentType: "image/png") == "png" && PhoneNotice.attachmentExtension(contentType: "image/jpeg; charset=binary") == "jpg", "png and jpeg get their endings")
check(PhoneNotice.attachmentExtension(contentType: "image/webp") == nil && PhoneNotice.attachmentExtension(contentType: nil) == nil, "a kind an attachment cannot show is left off, so the words still go")

section("phone notice: the shared keychain group, checked the same in the app and the extension")
for (group, ok) in [("6563JLN5HF.io.kosmos.app.shared", true), ("io.kosmos.app.shared", false), (".io.kosmos.app.shared", false), ("$(AppIdentifierPrefix)io.kosmos.app.shared", false), ("6563jln5hf.io.kosmos.app.shared", false), ("6563JLN5HF.", false), ("", false)] {
    check(PhoneNotice.hasTeamPrefix(group) == ok && (SessionKeychain.usableGroup(group) != nil) == ok, "\(group.isEmpty ? "(empty)" : group): \(ok ? "held" : "not held")")
}

await boardLoopTests()

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
