import Foundation
import CryptoKit
import ImageIO
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
    // #7017: Reply is the one live button (PushNotificationManager handles it); the rule stays "no dead buttons".
    check(perm?.actions.isEmpty == true, "the coordinator's permission category still offers no buttons: it rides pushes the computer was never asked about (#3870)")
    // #7017 part 2: Allow and Deny join it, each handled by the app (run-actions.sh checks the handler for every one).
    check(Set(cats.flatMap { $0.actions }.map(\.identifier)) == [NotificationCategories.replyAction, NotificationCategories.allowAction, NotificationCategories.denyAction], "the only actions anywhere are Reply, Allow and Deny, which the app handles: no dead buttons (#3870)")
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

section("native board: the Mac's own word and tone (kosmos#7004)")
do {
    // A newer Mac sends cardWord and cardTone; they win over the phone's own table, including words the table cannot
    // make (a restart's cause) and a tone the phone's rule would not give.
    let json = #"{"agents":[{"sessionName":"a","name":"A","state":"restarting","cardWord":"Switching to Opus","cardTone":"quiet"},{"sessionName":"b","name":"B","state":"idle","cardWord":"Idle","cardTone":"needs_you"},{"sessionName":"c","name":"C","state":"auth_failed","cardWord":"","cardTone":"sparkly"},{"sessionName":"d","name":"D","state":"auth_failed"},{"sessionName":"e","name":"E","state":"idle","cardWord":"A word added later","cardTone":"future"},{"sessionName":"f","name":"F","state":"idle","crashLoop":{"looping":true},"cardWord":"Keeps stopping","cardTone":"future"},{"sessionName":"g","name":"G","state":"idle","cardWord":"Issue","cardTone":"future"}]}"#
    let agents = Board.parseAgents(Data(json.utf8)) ?? []
    let one = { (s: String) in agents.first { $0.session == s }! }
    check(Board.statusWord(one("a")) == "Switching to Opus", "the Mac's word wins, one the phone's table cannot make")
    check(Board.tone(one("b")) == .needsYou, "the Mac's tone wins over the phone's own rule")
    check(Board.statusWord(one("c")) == "Sign-in Issue" && Board.tone(one("c")) == .needsYou,
          "an empty word and a tone name the phone does not know fall back to the phone's own table")
    check(Board.statusWord(one("d")) == "Sign-in Issue", "an older Mac (no cardWord): the phone's table, now in the Mac's current word")
    check(one("d").macWord == nil && one("d").macTone == nil, "nothing ready-made from an older Mac")
    check(Board.tone(named: "asked") == .asked && Board.tone(named: "working") == .working && Board.tone(named: nil) == nil,
          "each tone name the Mac sends, and none")
    // The Mac's word with a tone name the phone does not know: the word is shown, the phone's own rule picks the tone.
    check(Board.statusWord(one("e")) == "A word added later" && Board.tone(one("e")) == .quiet,
          "a new word with an unknown tone is shown, quiet, never red at the top")
    check(Board.statusWord(one("f")) == "Keeps stopping" && Board.tone(one("f")) == .needsYou,
          "an unknown tone on an agent the board counts as needing the person is still needs you")
    check(Board.statusWord(one("g")) == "Issue" && Board.tone(one("g")) == .needsYou,
          "an unknown tone with a needs-you word from the Mac: the phone's own table reads it as needs you")
    // The order follows the Mac's tone too.
    check(Board.sorted(agents).first?.session == "b", "a needs-you tone from the Mac sorts first")
}

section("Today: the model (kosmos#7030)")
do {
    // The fields part 1 sends, parsed; an older Mac sends none of them.
    let json = #"{"agents":["#
        + #"{"sessionName":"cleo","name":"Cleo","state":"needs_you","cardWord":"Question","cardTone":"asked","needsReason":"question","stateProjectName":"Spring catalogue","waitingSince":"2026-10-24T05:00:00.000Z"},"#
        + #"{"sessionName":"ada","name":"Ada","state":"needs_trust","cardWord":"Waiting on a trust prompt","cardTone":"needs_you","needsReason":"trust","waitingSince":"2026-10-24T04:00:00.000Z"},"#
        + #"{"sessionName":"bo","name":"Bo","state":"auth_failed","cardWord":"Sign-in Issue","cardTone":"needs_you","needsReason":"other"},"#
        + #"{"sessionName":"abe","name":"Abe","state":"rate_limited","cardWord":"Rate Limit","cardTone":"needs_you","needsReason":"brand_new_reason"},"#
        + #"{"sessionName":"wes","name":"Wes","state":"working","cardWord":"Working","cardTone":"working"},"#
        + #"{"sessionName":"una","name":"Una","state":"working","cardWord":"Working","cardTone":"working"},"#
        + #"{"sessionName":"ivo","name":"Ivo","state":"idle","cardWord":"Idle","cardTone":"quiet"},"#
        + #"{"sessionName":"old","name":"Old","state":"needs_you","stateReportedBy":"agent"}"#
        + #"]}"#
    let agents = Board.parseAgents(Data(json.utf8)) ?? []
    let one = { (s: String) in agents.first { $0.session == s }! }
    check(one("cleo").needsReason == "question" && one("cleo").stateProjectName == "Spring catalogue" && one("cleo").waitingSince != nil,
          "the reason, the project's name and when the wait began are read")
    check(one("old").needsReason == nil && one("old").stateProjectName == nil && one("old").waitingSince == nil, "an older Mac sends none")

    let m = Board.today(agents: agents, tasks: [])
    check(m.needsYou.map(\.session) == ["ada", "cleo", "abe", "bo", "old"],
          "needs you: longest waiting first, then the ones with no known start by name")
    check(m.working.map(\.session) == ["una", "wes"], "working now: by name")
    check(!m.needsYou.contains { $0.session == "ivo" } && !m.working.contains { $0.session == "ivo" }, "an idle agent is on neither")
    check(m.subhead == "5 things need you", "the subhead counts the needs-you cards")

    // The sentence and button per reason: the spec's table.
    let why = { (s: String) in Board.todayReason(one(s)) }
    check(why("cleo") == ("Waiting for your answer.", .answer), "its own question: Answer")
    check(why("ada") == ("Waiting for you to approve it before it can start.", .open), "a trust prompt: Open")
    check(why("bo") == ("Kosmos needs you to look at it.", .open), "other")
    check(why("abe") == ("Kosmos needs you to look at it.", .open), "a reason the phone does not know reads as other, never a question")
    check(why("old") == ("Kosmos needs you to look at it.", .open), "an older Mac (no reason) reads as other, never a question")
    for (reason, action) in [("question", Board.TodayAction.answer), ("permission", .answer), ("waiting", .open), ("restart_failed", .open),
                             ("trust", .open), ("gave_up", .open), ("crash_loop", .open), ("stuck_auth", .open), ("stuck_rate", .open),
                             ("own_bound", .open), ("other", .open)] {
        check(Board.todayWhy[reason]?.1 == action, "\(reason): \(action.title)")
    }
    check(Board.todayWhy.count == 11, "one row per reason the Mac sends (engine/cardlabel.js NEEDS_REASONS)")
    check(Board.todayWhy["permission"]?.0 == "Waiting for you to allow or deny something.", "the spec's permission words")
    check(Board.todayWhy["waiting"]?.0 == "Waiting for you. Open it to see what it shows.", "the spec's words for a wait read off the screen")
    check(Board.todayWhy["restart_failed"]?.0 == "Kosmos restarted it, and it did not come back.", "pjAlsoWhy's words for a failed restart")

    // The subhead's three forms.
    check(Board.today(agents: [], tasks: []).subhead == "Nothing needs you right now.", "nothing")
    check(Board.today(agents: [one("cleo")], tasks: []).subhead == "1 thing needs you", "one")
    check(Board.today(agents: [], tasks: nil).subhead == nil, "review 1: nobody needs you and the tasks are unknown: no claim at all")
    check(Board.today(agents: [one("cleo")], tasks: nil).subhead == "1 thing needs you", "an unknown tasks list still counts the agents")
}

section("Today: ready to check (kosmos#7030)")
do {
    let json = #"{"tasks":["#
        + #"{"projectId":"p1","projectName":"Catalogue","number":4,"sentence":"Pages 1 to 8","state":"built","builtAt":"2026-10-24T06:00:00.000Z","builtBy":"dana","builtNote":"Ready for a look"},"#
        + #"{"projectId":"p1","projectName":"Catalogue","number":2,"sentence":"Cover","state":"built","builtAt":"2026-10-24T05:00:00.000Z","builtByPerson":true,"builtBy":"dana"},"#
        + #"{"projectId":"p2","projectName":"Site","number":9,"sentence":"Footer","state":"decision","builtAt":"2026-10-24T04:00:00.000Z","builtBy":"eli"},"#
        + #"{"projectId":"p2","projectName":"Site","number":3,"sentence":"Header","state":"working"},"#
        + #"{"projectId":"p2","projectName":"Site","number":7,"sentence":"Menu","state":"built"}"#
        + #"]}"#
    let ready = Board.readyTasks(Data(json.utf8)) ?? []
    check(ready.map(\.id) == ["p1#2", "p1#4", "p2#7"], "only state built, oldest built first, one with no time last")
    check(ready.first { $0.number == 2 }?.byPerson == true && ready.first { $0.number == 2 }?.builtBy == nil, "marked by the person: by you, no agent")
    check(ready.first { $0.number == 4 }?.builtBy == "dana" && ready.first { $0.number == 4 }?.note == "Ready for a look", "the agent and its note")
    check(!ready.contains { $0.number == 9 }, "a built task whose agent needs the person is a decision, under that agent's card instead")
    check(Board.readyTasks(Data(#"{"error":"we cannot read your tasks right now"}"#.utf8)) == nil, "an error answer is not zero tasks")
    check(Board.readyTasks(Data("<html>sign in</html>".utf8)) == nil, "the gate's page is not zero tasks")
    // Review 1: a Mac that could not read who is running cannot tell built from a decision, so it is not read as tasks.
    check(Board.readyTasks(Data(#"{"tasks":[{"projectId":"p","number":1,"sentence":"S","state":"built"}],"rosterUnreadable":true}"#.utf8)) == nil,
          "rosterUnreadable: not known, never a list")
    check(Board.readyTasks(Data(#"{"tasks":[{"projectId":"p","number":1,"sentence":"S","state":"built"}],"rosterUnreadable":false}"#.utf8))?.count == 1,
          "CONTROL: a readable roster reads the task")
    // The badge: counts.waiting, a whole number at 0 or more; null (turned off) or anything else is none.
    let badge = { (s: String) in Board.waitingCount(Data(s.utf8)) }
    check(badge(#"{"counts":{"waiting":4}}"#) == 4 && badge(#"{"counts":{"waiting":0}}"#) == 0, "the board's number, 0 included")
    check(badge(#"{"counts":{"waiting":null}}"#) == nil, "turned off: no badge")
    check(badge(#"{"counts":{"waiting":-1}}"#) == nil && badge(#"{"counts":{"waiting":2.5}}"#) == nil && badge(#"{"counts":{"waiting":true}}"#) == nil,
          "negative, fractional or not a number: none")
    check(badge(#"{"counts":{}}"#) == nil && badge("<html>sign in</html>") == nil, "missing, or not an answer: none")
    let m = Board.today(agents: [], tasks: ready)
    check(m.subhead == "3 things need you", "ready cards count in the subhead")
    let req = Board.readyTasksRequest(mac: URL(string: "https://studio.kosmosplus.com/")!)
    check(req.url?.absoluteString == "https://studio.kosmosplus.com/api/tasks?view=tasks", "the board's own Tasks view read")
}

section("native chat: requests (kosmos#7008)")
do {
    let mac = URL(string: "https://studio.kosmosplus.com/")!
    let get = Board.threadRequest(mac: mac, session: "dana")
    check(get?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/dana/thread" && get?.httpMethod == "GET",
          "the conversation is the board chat's own route")
    check(Board.threadRequest(mac: mac, session: "../status") == nil, "a name the app does not accept builds no request")
    let post = Board.sendRequest(mac: mac, session: "dana", text: "  Hello there \n")
    let body = post?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    check(post?.httpMethod == "POST" && post?.url?.path == "/api/agent/dana/thread" && body?["text"] as? String == "Hello there",
          "a send posts {text}, trimmed, to the same route")
    check(body?.count == 1, "nothing else rides with a plain message")
    check(Board.sendRequest(mac: mac, session: "dana", text: "   ") == nil, "a blank message is not sent")
    // Counted as the board counts: UTF-16 units of the words with whitespace runs made one space.
    check(Board.fitsBoard(String(repeating: "a", count: Board.maxMessage)) && !Board.fitsBoard(String(repeating: "a", count: Board.maxMessage + 1)),
          "the board's own longest message, and not one character more")
    check(!Board.fitsBoard(String(repeating: "\u{1F44D}", count: 6000)), "6000 emoji are 12000 UTF-16 units: too long for the board, so not sent")
    check(Board.fitsBoard(String(repeating: "a      ", count: 2000)), "spaces the board folds away do not count against the length")
    check(Board.sameWords(" Thanks,\n\n\n\nsee   you\tFriday ") == "Thanks, see you Friday", "words compared as the board compares them")
}

section("native chat: reading the conversation")
do {
    let json = #"{"messages":[{"at":"2026-10-23T13:32:00Z","text":"Morning","from":null,"delivery":{"state":"placed"}},{"at":"2026-10-23T13:33:00Z","text":"Hi","from":"dana"},{"at":"2026-10-23T13:33:00Z","text":"And again","from":"dana"},{"at":"2026-10-23T13:40:00Z","text":"Paused","from":null,"kind":"kosmos"},{"at":"2026-10-23T13:41:00Z","text":"Tue or Wed?","from":"dana","kind":"question","id":"q1"},{"at":"2026-10-23T13:42:00Z","text":"May I run it?","from":"dana","kind":"question","permission":{"title":"x"}},{"at":"2026-10-23T13:43:00Z","text":"File","from":"dana","attachments":[{"id":"a"}]},{"at":"2026-10-23T13:44:00Z","text":"Lost","from":null,"delivery":{"state":"could_not"}},{"at":"2026-10-23T13:45:00Z","text":"Later","from":null,"delivery":{"state":"held"}},{"at":"2026-10-23T13:46:00Z","text":"Maybe","from":null,"delivery":{"state":"unconfirmed"}},{"from":"dana"}],"olderCount":12}"#
    let t = Board.parseThread(Data(json.utf8))
    let rows = t?.rows ?? []
    check(rows.count == 10, "a row with no text is dropped")
    check(rows[0].who == .person && rows[1].who == .agent && rows[3].who == .kosmos, "no from is the person's, a from is the agent's, kind kosmos is Kosmos's own")
    check(rows[1].id != rows[2].id && Set(rows.map(\.id)).count == rows.count, "two rows at the same time keep different ids")
    check(rows[4].id.hasPrefix("id|q1"), "the Mac's own id is used where it gives one")
    check(rows[0].atRaw == "2026-10-23T13:32:00Z", "the Mac's own time is kept as sent, to match a sent message to its row")
    check(rows[4].wayThrough == .question && rows[5].wayThrough == .permission && rows[6].wayThrough == .attachment && rows[1].wayThrough == nil,
          "a question, a permission card and a file each get their way-through row")
    check(rows[0].notSent == nil && rows[7].notSent == "Not sent" && rows[8].notSent == "Waiting to send" && rows[9].notSent == "Not confirmed",
          "placed reached the agent; could_not, held and unconfirmed (it may have arrived) say which")
    check(rows[7].canSendAgain && !rows[8].canSendAgain && !rows[0].canSendAgain,
          "only a message the Mac could not deliver can be sent again; one it holds goes by itself")
    check(!rows[9].canSendAgain, "one not confirmed is not offered again: it may have arrived, and a second copy would duplicate it")
    // Not every could_not is a plain message to send again: a copy the Mac already marked as one, and a menu answer.
    let odd = Board.parseThread(Data(#"{"messages":[{"at":"T1","text":"Hello","from":null,"delivery":{"state":"could_not","duplicateOf":"T0","because":"the same message was already kept above"}},{"at":"T2","text":"Yes, and don't ask again","wire":"2","from":null,"delivery":{"state":"could_not"}},{"at":"T3","text":"Plain","from":null,"delivery":{"state":"could_not","because":"Dana is not running"}}]}"#.utf8))?.rows ?? []
    check(!odd[0].canSendAgain && !odd[1].canSendAgain && odd[2].canSendAgain, "a duplicate and a menu answer are not sent again; a plain one is")
    check(odd[0].because == "the same message was already kept above" && odd[2].because == "Dana is not running", "the Mac's own reason is kept, to show as the board shows it")
    check(t?.olderCount == 12, "older messages are counted")
    check(Board.parseThread(Data("{}".utf8)) == nil && Board.parseThread(Data("not json".utf8)) == nil, "an answer that is not a conversation is nil")
    let empty = Board.parseThread(Data(#"{"messages":[]}"#.utf8))
    check(empty?.rows.isEmpty == true && empty?.olderCount == 0, "an empty conversation is one, not a failure")

    // What a read says: the conversation, the Mac's own reason, or no answer.
    let read = { (s: Int, b: String?) in Board.readThread(status: s, data: b.map { Data($0.utf8) }) }
    if case .thread = read(200, #"{"messages":[]}"#) { check(true, "a conversation") } else { check(false, "a conversation") }
    check(read(200, #"{"messages":null,"historyBecause":"we could not read this conversation"}"#) == .refused("we could not read this conversation"),
          "a history the Mac could not read says so, not that the Mac is not answering")
    check(read(404, #"{"error":"that name belongs to another session"}"#) == .refused("that name belongs to another session"),
          "a name the Mac refuses says the Mac's words")
    check(read(0, nil) == .noAnswer && read(502, "<html>") == .noAnswer && read(200, "<html>") == .noAnswer,
          "no answer, a gateway error or a page that is not the conversation are no answer")
    check(read(200, #"{"messages":[],"historyUnfilable":true,"historyBecause":"this conversation cannot be filed"}"#) == .refused("this conversation cannot be filed"),
          "a conversation the Mac cannot file says why, not that there are no messages")
    let draft = Board.parseThread(Data(#"{"messages":[{"at":"T","text":"git push --force","from":null,"kind":"kosmos","draft":true,"draftId":"d1"}]}"#.utf8))?.rows.first
    check(draft?.wayThrough == .draft, "words that sat unsent in the agent's box are a way-through row, never drawn as Kosmos speaking")
}

section("native chat: runs, times and day lines (Mona Lisa's slice 3a spec)")
do {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "America/Chicago")!
    cal.locale = Locale(identifier: "en_GB")
    let at = { (s: String) in Board.isoDate(s)! }
    let now = at("2026-10-23T20:00:00Z")   // Friday 23 October, 3 pm in Chicago
    let row = { (id: String, when: String, who: Board.ChatRow.Who, way: Board.ChatRow.WayThrough?) in
        Board.ChatRow(id: id, atRaw: when, at: at(when), text: id, who: who, wayThrough: way)
    }
    let rows = [
        row("old", "2026-10-21T15:00:00Z", .agent, nil),
        row("y1", "2026-10-22T15:00:00Z", .person, nil),
        row("y2", "2026-10-22T15:01:00Z", .person, nil),
        row("t1", "2026-10-23T15:00:00Z", .person, nil),
        row("t2", "2026-10-23T15:01:00Z", .agent, nil),
        row("t3", "2026-10-23T15:02:00Z", .agent, nil),
        row("k", "2026-10-23T15:03:00Z", .kosmos, nil),
        row("t4", "2026-10-23T15:04:00Z", .agent, nil),
        row("q", "2026-10-23T15:05:00Z", .agent, .question),
        row("t5", "2026-10-23T15:06:00Z", .agent, nil),
    ]
    let items = Board.chatItems(rows, now: now, calendar: cal)
    let days = items.compactMap { if case .day(let s) = $0.kind { return s } else { return nil } }
    check(days == ["Wednesday 21 October", "Yesterday", "Today"], "a day line whenever the day changes: a date, Yesterday, Today")
    let runs = Dictionary(uniqueKeysWithValues: items.compactMap { item -> (String, (Bool, Bool))? in
        if case .row(let r, let first, let last) = item.kind { return (r.id, (first, last)) } else { return nil }
    })
    check(runs["y1"]! == (true, false) && runs["y2"]! == (false, true), "two from the same side are one run: the time goes on the last")
    check(runs["t1"]! == (true, true), "a new day starts a new run, even from the same side")
    check(runs["t2"]! == (true, false) && runs["t3"]! == (false, true), "the side changing ends a run")
    check(runs["t4"]! == (true, true) && runs["t5"]! == (true, true), "Kosmos's line and a way-through row stand alone and end the runs around them")
    check(Board.dayLine(at("2025-12-31T18:00:00Z"), now: now, calendar: cal) == "Wednesday 31 December 2025", "another year says the year")
    check(Set(items.map(\.id)).count == items.count, "every item has its own id")
}

section("native chat: what follows a new message down")
do {
    func r(_ id: String, _ at: String?) -> Board.ChatRow { Board.ChatRow(id: id, atRaw: at, at: Board.isoDate(at), text: id, who: .agent) }
    let before = Board.Thread(rows: [r("a", "T1"), r("b", "T2")], olderCount: 5)
    let shifted = Board.Thread(rows: [r("b", "T2"), r("c", "T3")], olderCount: 6)
    check(Board.followKey(before) != Board.followKey(shifted), "at the Mac's 200-row cap the count stays the same, and the key still moves")
    let withQuestion = Board.Thread(rows: [r("a", "T1"), r("b", "T2"), r("q", nil)], olderCount: 5)
    let newUnderQuestion = Board.Thread(rows: [r("a", "T1"), r("b", "T2"), r("c", "T3"), r("q", nil)], olderCount: 5)
    check(Board.followKey(withQuestion) != Board.followKey(newUnderQuestion), "a new message above the Mac's untimed question row moves the key")
    check(Board.followKey(before) == Board.followKey(Board.Thread(rows: [r("a", "T1"), r("b", "T2")], olderCount: 5)), "the same conversation read again does not")
}

section("native chat: what a send's answer means")
do {
    let res = { (s: Int, b: String?) in Board.sendResult(status: s, body: b.map { Data($0.utf8) }) }
    check(res(200, #"{"delivery":{"state":"placed","at":"T1"},"recorded":true}"#) == .kept(at: "T1"), "placed and kept: the row is at T1")
    check(res(200, #"{"delivery":{"state":"held","at":"T2"},"recorded":true}"#) == .keptUndelivered(at: "T2", note: "Waiting to send"),
          "held is kept, undelivered: its row says Waiting to send, so the app never offers to send it twice")
    check(res(200, #"{"delivery":{"state":"could_not","at":"T3","because":"x"},"recorded":true}"#) == .keptUndelivered(at: "T3", note: "Not sent"),
          "could_not is kept, undelivered: never shown as sent; its row says Not sent and is sent again from there")
    check(res(200, #"{"delivery":{"state":"placed","at":"T4"},"recorded":false}"#) == .taken, "placed but no row kept: shown as sent until a read holds the words")
    check(res(200, #"{"delivery":{"state":"unconfirmed","at":"T5"},"recorded":true}"#) == .keptUndelivered(at: "T5", note: "Not confirmed"),
          "unconfirmed is never shown as sent: it reads Not confirmed, as the board says it could not confirm")
    check(res(200, #"{"delivery":{"state":"unconfirmed"},"recorded":false}"#) == .unconfirmed, "unconfirmed and not kept: Not confirmed, never sent and never offered again (it may have arrived)")
    check(res(200, #"{"delivery":{"state":"held"},"recorded":false}"#) == .refused(nil), "held and not kept typed nothing")
    check(res(409, #"{"error":"Dana is at its trust prompt"}"#) == .refused("Dana is at its trust prompt"), "a refusal keeps the Mac's words")
    check(res(0, nil) == .noAnswer, "no answer is no answer")
    check(res(502, #"{"error":"the tunnel dropped"}"#) == .noAnswer && res(504, nil) == .noAnswer && res(500, #"{"error":"x"}"#) == .noAnswer,
          "a 5xx, words or not, is no answer (it may have arrived), so a retry reads first")
    check(res(400, #"{"error":"x"}"#) == .refused("x") && res(499, nil) == .refused(nil), "CONTROL: a 4xx is still a refusal")
    check(Board.isWebLink(URL(string: "https://example.com/a")!) && Board.isWebLink(URL(string: "HTTP://example.com")!),
          "web addresses stay links")
    check(!Board.isWebLink(URL(string: "tel:+15555550100")!) && !Board.isWebLink(URL(string: "mailto:a@example.com")!)
          && !Board.isWebLink(URL(string: "shortcuts://run-shortcut?name=x")!) && !Board.isWebLink(URL(string: "https:nohost")!),
          "any other address behind a message's words is not a link")
    check(Board.pendingState(after: .kept(at: "T")) == .kept(at: "T") && Board.pendingState(after: .noAnswer) == .failed(reason: nil)
          && Board.pendingState(after: .refused("x")) == .failed(reason: "x"), "each answer's pending state")
    check(Board.notSentLine(agentRunning: true, name: "Dana") == ("Not sent. Tap to try again.", true)
          && Board.notSentLine(agentRunning: false, name: "Dana") == ("Not sent. Dana isn't running on your computer.", false),
          "the spec's not-sent line, with no retry while the agent is not running")
}

section("native chat: a message's links (kosmos#7014)")
do {
    let links = { (s: String) in Board.messageLinks(s).map(\.absoluteString) }
    check(links("The report is at https://example.com/q3") == ["https://example.com/q3"], "a plain web address is a link")
    check(links("See [the **full** report](https://example.com/q3) now") == ["https://example.com/q3"], "a Markdown link's address")
    // One link in two runs, built by hand: Foundation does not style link words today, so no message text splits one.
    var split = AttributedString("the full report")
    split.link = URL(string: "https://example.com/q3")
    let mid = split.index(split.startIndex, offsetByCharacters: 4)
    split[mid..<split.index(mid, offsetByCharacters: 4)].inlinePresentationIntent = .stronglyEmphasized
    check(split.runs.count == 3 && split.runs.allSatisfy { $0.link != nil }, "CONTROL: the hand-built link really is in three runs, each carrying it")
    check(Board.links(in: split).map(\.absoluteString) == ["https://example.com/q3"], "one link split into runs by its styling counts once")
    check(links("[one](https://a.example) and [two](https://a.example)") == ["https://a.example", "https://a.example"],
          "two links to the same place, apart, are two")
    check(links("[call us](tel:+15555550100), [mail](mailto:a@example.com) or [open](shortcuts://run)").isEmpty,
          "an address that is not a web page is not a link, whatever its words")
    check(links("write to a@example.com").isEmpty, "an email address in the text is not a link (the detector reads it as mailto:)")
    check(links("[site](https://example.com) and http://b.example/x") == ["https://example.com", "http://b.example/x"], "links in order")
}

section("native chat: a question's buttons and a permission card (kosmos#7016)")
do {
    func thread(_ json: String) -> Board.Thread? { Board.parseThread(Data(json.utf8)) }
    let q = #"{"messages":[{"at":null,"text":"Tuesday or Wednesday?","from":"cleo","kind":"question"}],"question":{"text":"Launch email\nTuesday or Wednesday?\n❯ 1. Tuesday"},"asking":true,"asked":"Tuesday or Wednesday?","presence":"on","options":[{"n":1,"label":"Tuesday"},{"n":2,"label":"Wednesday","lasting":true},{"n":"3","label":"bad"}]}"#
    let t = thread(q)!
    check(t.choices?.options == [Board.ChoiceOption(n: 1, label: "Tuesday", lasting: false), Board.ChoiceOption(n: 2, label: "Wednesday", lasting: true)]
          && t.choices?.asked == "Tuesday or Wednesday?", "the options and the question's identity, an unreadable option dropped")
    check(Board.choices(for: t.rows[0], in: t) != nil, "the question row takes the buttons")
    check(thread(q.replacingOccurrences(of: #""asking":true"#, with: #""asking":false"#))?.choices == nil, "not asking now: no buttons")
    check(thread(q.replacingOccurrences(of: #""presence":"on""#, with: #""presence":"off""#))?.choices == nil, "composer closed: no buttons")
    check(thread(q.replacingOccurrences(of: #""presence":"on""#, with: #""presence":"unsure""#))?.choices != nil, "CONTROL: presence unsure keeps them")
    check(thread(q.replacingOccurrences(of: #""asked":"Tuesday or Wednesday?""#, with: #""asked":"""#))?.choices == nil, "no identity: no buttons")
    let reported = thread(q.replacingOccurrences(of: #""kind":"question"}"#, with: #""kind":"question","reported":true}"#))!
    check(Board.choices(for: reported.rows[0], in: reported) == nil, "the agent's own reported words take no buttons")
    // The key: the same words with other options, or another header, are a new question.
    let other = thread(q.replacingOccurrences(of: #""label":"Wednesday""#, with: #""label":"Thursday""#))!
    let header = thread(q.replacingOccurrences(of: "Launch email", with: "Newsletter"))!
    let cursor = thread(q.replacingOccurrences(of: "❯ 1. Tuesday", with: "  1. Tuesday"))!
    check(other.choices!.key != t.choices!.key && header.choices!.key != t.choices!.key, "other options or another header: a new question")
    check(cursor.choices!.key == t.choices!.key, "a highlight moving below the question line is the same question")
    check(Board.choiceHead("Launch email\nTuesday or Wednesday?\n 1. Tuesday", asked: "Tuesday or Wednesday?") == "Launch email\nTuesday or Wednesday?",
          "the head is the lines up to the question line")

    // The permission card.
    let p = #"{"messages":[{"at":null,"text":"Do you want to proceed?","from":"eli","kind":"question","permission":{"kind":"delete","says":"Clear the export","target":"rm -rf exports","detail":"Bash command","reason":"Deletes always ask.","allow":1,"deny":3}}],"asking":true,"asked":"Do you want to proceed?","presence":"on","options":[{"n":3,"label":"No"},{"n":2,"label":"Yes, and don't ask again","lasting":true},{"n":1,"label":"Yes"}]}"#
    let pt = thread(p)!
    let perm = pt.rows[0].permission!
    check(perm == Board.Permission(kind: "delete", says: "Clear the export", target: "rm -rf exports", detail: "Bash command", reason: "Deletes always ask.", allow: 1, deny: 3),
          "the Mac's reading of the prompt")
    check(Board.permissionAsk(perm) == "Wants to run a command that deletes files: rm -rf exports.", "the ask, in the board's words")
    let noTarget = Board.Permission(kind: "mystery", says: nil, target: nil, detail: nil, reason: nil, allow: 1, deny: 2)
    check(Board.permissionAsk(noTarget) == "Wants to do something that needs your permission.", "an unknown kind and no target")
    let card = Board.cardButtons(pt.choices!, perm)
    check(card?.allow.label == "Yes" && card?.deny.label == "No" && card?.more.map(\.n) == [2],
          "Allow and Deny are the prompt's own options by number; the rest are under Show details")
    let noDeny = Board.Permission(kind: "edit", says: nil, target: nil, detail: nil, reason: nil, allow: 1, deny: 9)
    check(Board.cardButtons(pt.choices!, noDeny) == nil, "no card unless both Allow and Deny are among the options")
    let notQuestion = thread(#"{"messages":[{"at":null,"text":"x","from":"eli","permission":{"allow":1,"deny":2}}]}"#)!.rows[0]
    check(notQuestion.permission == nil && notQuestion.wayThrough == nil, "a permission only on a question row, and it takes no buttons")
    check(thread(#"{"messages":[{"at":null,"text":"x","from":"eli","kind":"question","permission":null}]}"#)!.rows[0].wayThrough == .question,
          "a question with permission null is a plain question")
    // The board's strictness: a whole number, and only true.
    let loose = thread(#"{"messages":[],"asking":1,"asked":"Q","options":[{"n":1,"label":"a"}]}"#)
    check(loose?.choices == nil, "asking 1 is not true")
    let boolN = thread(#"{"messages":[],"asking":true,"asked":"Q","options":[{"n":true,"label":"a"},{"n":1.5,"label":"b"},{"n":2,"label":"c","lasting":1}]}"#)
    check(boolN?.choices?.options == [Board.ChoiceOption(n: 2, label: "c", lasting: false)], "n true or 1.5 is no option; lasting 1 is not lasting")

    // A press, as the board sends it.
    let mac = URL(string: "https://studio.kosmosplus.com")!
    let plain = Board.pressRequest(mac: mac, session: "cleo", option: .init(n: 1, label: "Tuesday", lasting: false), asked: "Q?")!
    let body = try! JSONSerialization.jsonObject(with: plain.httpBody!) as! [String: Any]
    check(plain.httpMethod == "POST" && plain.url?.path == "/api/agent/cleo/thread" && body["text"] as? String == "1" && body["chose"] as? String == "Tuesday"
          && body["asked"] as? String == "Q?" && body["lasting"] == nil && plain.value(forHTTPHeaderField: "Content-Type") == "application/json",
          "the digit typed, the option's words, the question it answers; no lasting")
    let lasting = Board.pressRequest(mac: mac, session: "cleo", option: .init(n: 2, label: "W", lasting: true), asked: "Q?")!
    check((try! JSONSerialization.jsonObject(with: lasting.httpBody!) as! [String: Any])["lasting"] as? Bool == true, "a lasting choice confirms it")
    check(Board.pressRequest(mac: mac, session: "../x", option: .init(n: 1, label: "a", lasting: false), asked: "Q") == nil, "not an agent's name: no request")

    // kosmos#7020: a permission card's press names its request; the request is part of the question's identity.
    let reqA = String(repeating: "a", count: 64), reqB = String(repeating: "b", count: 64)
    let named = Board.pressRequest(mac: mac, session: "cleo", option: .init(n: 1, label: "Yes", lasting: false), asked: "Q?", request: reqA)!
    check((try! JSONSerialization.jsonObject(with: named.httpBody!) as! [String: Any])["request"] as? String == reqA, "#7020: the press names its request")
    check(body["request"] == nil, "#7020 CONTROL: a press with no request names none")
    let permThread = { (req: String, reported: Bool) in thread(#"{"messages":[{"at":"2026-10-24T05:00:00Z","kind":"question","from":"cleo","text":"Do you want to proceed?","reported":"#
        + (reported ? "true" : "false") + #","permission":{"kind":"command","allow":1,"deny":2,"request":""# + req
        + #""}}],"asking":true,"asked":"Q","options":[{"n":1,"label":"Yes"},{"n":2,"label":"No"}]}"#) }
    let tA = permThread(reqA, false), tB = permThread(reqB, false)
    check(tA?.choices?.request == reqA, "#7020: the live question row's request is read")
    check(tA?.choices?.key != nil && tA?.choices?.key != tB?.choices?.key, "#7020: the same words with another request are another question")
    check(tA?.choices?.key == permThread(reqA, false)?.choices?.key, "#7020 CONTROL: the same request keeps its key")
    check(permThread(reqA, true)?.choices?.request == nil, "#7020: a reported question's request is not used")
    check(permThread("not-a-request", false)?.choices?.request == nil && permThread(reqA.uppercased(), false)?.choices?.request == nil,
          "#7020: only a request the Mac makes (64 lowercase hex)")
    check(thread(#"{"messages":[],"asking":true,"asked":"Q","options":[{"n":1,"label":"a"}]}"#)?.choices?.request == nil, "#7020: no card, no request")

    // What its answer means.
    let res = { (s: Int, b: String?) in Board.pressResult(status: s, body: b.map { Data($0.utf8) }) }
    check(res(200, #"{"delivery":{"state":"placed"}}"#) == .sent, "placed is sent")
    check(res(200, #"{"delivery":{"state":"could_not","because":"a message is being typed to it right now"}}"#)
          == .refused("A message is being typed to it right now."), "could_not typed nothing: the Mac's reason, as a sentence")
    check(res(200, #"{"delivery":{"state":"unconfirmed","because":"its question was still on its screen"}}"#)
          == .notSure(Board.choiceUnsure + " Its question was still on its screen."), "unconfirmed may have gone: the board's sentence and its reason")
    check(res(200, #"{}"#) == .notSure(Board.choiceUnsure) && res(0, nil) == .notSure(Board.choiceUnsure) && res(502, #"{"error":"x"}"#) == .notSure(Board.choiceUnsure),
          "a 200 with no verdict, no answer, or a 5xx may have gone")
    check(res(409, #"{"error":"its question is no longer on its screen, so we did not send the answer."}"#)
          == .refused("Its question is no longer on its screen, so we did not send the answer."), "a refusal keeps the Mac's words")
    check(res(409, nil) == .refused("That did not go; try again."), "a refusal with no words")
    check(Board.PressResult.sent.mayHaveSent && Board.PressResult.notSure("x").mayHaveSent && !Board.PressResult.refused("x").mayHaveSent, "which may have gone")
    check(Board.sentence("ok!") == "Ok!" && Board.sentence("  ") == "" && Board.sentence(nil) == "", "a sentence keeps its own stop")

    // What the buttons show (dmChoicesHtml).
    func st(_ part: Board.ChoicesPart, pressing: Bool = false, typing: Bool = false, answered: (sure: Bool, n: Int)? = nil,
            armedN: Int? = nil, unsure: Bool = false) -> Board.ChoicesState {
        Board.choicesState(part, pressing: pressing, typing: typing, answered: answered, armedN: armedN, unsure: unsure)
    }
    let main = Board.ChoicesPart.main(allow: 1, deny: 3)
    check(st(.plain) == Board.ChoicesState(), "nothing happening: pressable, no line")
    check(st(.plain, typing: true) == Board.ChoicesState(off: true), "a typed send in the air: off, nothing said")
    check(st(.plain, pressing: true).note == "Sending\u{2026}" && st(.plain, pressing: true).off, "a press in the air: off, Sending…")
    check(st(.more, pressing: true).note == nil && st(main, pressing: true).note == "Sending\u{2026}", "on a card, Sending… is said once, under Allow and Deny")
    check(st(.plain, answered: (true, 1)) == Board.ChoicesState(off: true, note: "Sent."), "sure: off, Sent.")
    check(st(main, answered: (true, 1)) == Board.ChoicesState(off: true, note: "Allowed.", settled: true)
          && st(main, answered: (true, 3)).note == "Denied." && st(main, answered: (true, 2)) == Board.ChoicesState(off: true, note: "Sent."),
          "a card says what was chosen, in place of the buttons; a lasting choice says Sent.")
    check(st(.more, answered: (true, 2)).note == nil, "Show details says nothing after a press")
    check(st(.plain, answered: (false, 1), unsure: true) == Board.ChoicesState(off: true, note: Board.choiceUnsure, danger: true),
          "not sure: off for the lock, and the danger line")
    check(st(.plain, armedN: 2).note == Board.choiceArmNote && st(.more, armedN: 2).note == Board.choiceArmNote && st(main, armedN: 1).note == Board.choiceArmNote
          && st(main).note == nil, "the arm note goes with the part that holds the armed choice")
    check(st(.plain, armedN: 2, unsure: true).note == Board.choiceArmNote, "a new arm outranks an old not-sure line")
    check(st(.more, unsure: true).note == nil, "Show details never says the not-sure line")

    // Arm and confirm (#6172).
    let t0 = Date(timeIntervalSince1970: 1000)
    let last = Board.ChoiceOption(n: 2, label: "W", lasting: true)
    check(Board.armStep(nil, option: .init(n: 1, label: "T", lasting: false), key: "k", now: t0) == .send, "an ordinary choice sends at once")
    let armed = Board.Armed(key: "k", n: 2, at: t0)
    check(Board.armStep(nil, option: last, key: "k", now: t0) == .arm(armed), "a lasting choice's first press arms it")
    check(Board.armStep(armed, option: last, key: "k", now: t0 + 0.3) == .ignore, "a second press inside 0.6 s is the same tap: nothing")
    check(Board.armStep(armed, option: last, key: "k", now: t0 + 2) == .send, "the second press sends it")
    check(Board.armStep(armed, option: last, key: "k", now: t0 + 15) == .arm(Board.Armed(key: "k", n: 2, at: t0 + 15)), "after 15 s it arms again")
    check(Board.armStep(armed, option: last, key: "other", now: t0 + 2) == .arm(Board.Armed(key: "other", n: 2, at: t0 + 2)), "another question: arms again")
    check(Board.armStep(armed, option: .init(n: 4, label: "Z", lasting: true), key: "k", now: t0 + 2) == .arm(Board.Armed(key: "k", n: 4, at: t0 + 2)),
          "another lasting option: arms that one")
    check(Board.isArmed(armed, n: 2, key: "k", now: t0 + 14.9) && !Board.isArmed(armed, n: 2, key: "k", now: t0 + 15)
          && !Board.isArmed(armed, n: 1, key: "k", now: t0 + 1) && !Board.isArmed(armed, n: 2, key: "x", now: t0 + 1), "what shows as armed")
}

section("native chat: a message's files (kosmos#7016 part 2)")
do {
    func row(_ json: String) -> Board.ChatRow? { Board.parseThread(Data(("{\"messages\":[" + json + "]}").utf8))?.rows.first }
    let r = row(#"{"at":"2026-10-22T16:10:00Z","text":"a.pdf, b.docx","from":"cleo","attachments":[{"id":"aaaaaaaaaaaaaaaaaaaaaaaa","name":" a.pdf ","type":"application/pdf","size":2516582,"kind":"pdf","url":"/api/attachment/aaaaaaaaaaaaaaaaaaaaaaaa","preview":"/api/attachment/aaaaaaaaaaaaaaaaaaaaaaaa/preview"},{"id":"bbbbbbbbbbbbbbbbbbbbbbbb","name":"b.docx","type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","size":48211,"kind":"weird","url":"/api/attachment/bbbbbbbbbbbbbbbbbbbbbbbb","preview":null},{"id":"cc","name":"evil","url":"https://elsewhere.example/x"}],"attachment":{"id":"cccccccccccccccccccccccc","url":"/api/attachment/cccccccccccccccccccccccc"}}"#)!
    check(r.attachments.map(\.id) == ["aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb"], "attachments in order, a file at another address dropped, attachment ignored when attachments has any")
    check(r.attachments[0].name == "a.pdf" && r.attachments[1].kind == "other" && r.wayThrough == .attachment, "names trimmed, an unknown kind is other")
    check(row(#"{"text":"x","from":"cleo","attachment":{"id":"cccccccccccccccccccccccc","name":"z.png","kind":"image","url":"/api/attachment/cccccccccccccccccccccccc"}}"#)!.attachments.map(\.id) == ["cccccccccccccccccccccccc"],
          "a lone attachment when there is no list")
    check(row(#"{"text":"x","from":"cleo","attachment":{"id":"q","url":"/api/attachment/dddddddddddddddddddddddd","name":""}}"#)!.attachments[0].name == "a file", "no name: a file")
    check(Board.isBoardPath("/api/attachment/aaaaaaaaaaaaaaaaaaaaaaaa") && !Board.isBoardPath("/api/../secret") && !Board.isBoardPath("//evil.example/api/x")
          && !Board.isBoardPath("/apix") && !Board.isBoardPath("https://h/api/x") && !Board.isBoardPath("/api/a\\b"), "only the board's own routes")
    let lead = row(#"{"text":"x","from":"c","attachment":{"url":"/api/attachment/dddddddddddddddddddddddd","preview":"https://elsewhere.example/p.png","kind":"image"}}"#)!.attachments[0]
    check(lead.preview == nil && !Board.hasThumbnail(lead), "a preview at another address is no preview")
    check(Board.hasThumbnail(r.attachments[0]) && !Board.hasThumbnail(r.attachments[1]), "a picture only for an image or PDF with a preview")
    func img(_ size: Int?) -> Board.Attachment {
        Board.Attachment(id: "x", name: "p.jpg", type: "image/jpeg", size: size, kind: "image", url: "/api/attachment/x", preview: "/api/attachment/x/preview")
    }
    check(Board.hasThumbnail(img(3 * 1024 * 1024)) && !Board.hasThumbnail(img(3 * 1024 * 1024 + 1)) && !Board.hasThumbnail(img(nil)),
          "an image's picture is the whole image, so one over 3 MB (or of unknown size) draws the symbol")
    check(!Board.savedName(String(repeating: "A", count: 190) + ".html..z").hasSuffix("."), "a cut name never ends in a dot")
    let cjk = Board.savedName(String(repeating: "報", count: 100) + ".pdf")
    check(cjk.utf8.count <= 200 && cjk.hasSuffix(".pdf") && cjk.hasPrefix("報報"), "a long name in Japanese fits iOS's 255 bytes and keeps its extension")
    check(Board.savedName("short.pdf") == "short.pdf" && Board.savedName(String(repeating: "x", count: 300)).utf8.count == 200, "short names unchanged; long ones cut to 200 bytes")
    check(Board.attachmentMeta(r.attachments[0]) == "PDF \u{00B7} 2.4 MB" && Board.attachmentMeta(r.attachments[1]) == "Word document \u{00B7} 47 KB",
          "the kind word and size, as the board writes them")
    let fw = { (t: String, n: String, k: String) in Board.fileWord(type: t, name: n, kind: k) }
    check(fw("", "x.XLSX", "other") == "Excel spreadsheet" && fw("application/vnd.ms-powerpoint", "x", "other") == "PowerPoint"
          && fw("image/png", "x", "other") == "Image" && fw("", "data.csv", "other") == "CSV" && fw("text/markdown", "x", "text") == "Text"
          && fw("", "archive.zip", "other") == "ZIP file" && fw("", "noext", "other") == "File", "pjFileWord's words")
    check(Board.sizeText(512) == "512 B" && Board.sizeText(1536) == "2 KB" && Board.sizeText(nil) == "" && Board.sizeText(-1) == "", "pjSize")
    check(Board.wordsShown("a.pdf, b.docx", files: r.attachments) == "" && Board.wordsShown("Here it is", files: r.attachments) == "Here it is",
          "a post whose words are only the file names draws no words")
    let web = { (n: String, t: String) in Board.isWebDocument(name: n, type: t) }
    check(web("report.html", "text/plain") && web("report.HTM", "application/octet-stream") && web("pic.svg", "image/png")
          && web("page", "text/html") && web("feed", "application/xhtml+xml") && web("a.webarchive", "") && web("data.xml", "")
          && web("saved.mht", "") && web("saved.mhtml", "application/octet-stream")
          && web("page.html.", "application/octet-stream") && web("pic.svg. ", "") && web("x.webarchive..", "")
          && web("page.html\u{0}", "application/octet-stream") && web("page.html\u{0}\u{0}", "") && web("page.ht\u{200B}ml", ""),
          "a page or markup document, by its name or its type, whatever type the sender gave")
    check(!web("plan.pdf", "application/pdf") && !web("notes.txt", "text/plain") && !web("photo.png", "image/png") && !web("deck.pptx", "")
          && !web("noext", "application/octet-stream"), "CONTROL: ordinary files are not")
    check(Board.fileSymbol(r.attachments[0]) == "doc.richtext" && Board.fileSymbol(r.attachments[1]) == "doc", "the symbol for a file with no picture")
    check(Board.savedName("../etc/passwd") == "-etc-passwd" && Board.savedName(".hidden") == "hidden" && Board.savedName("  ") == "file"
          && Board.savedName("a:b.pdf") == "a-b.pdf", "a saved name is never a path, never hidden, never empty")
    check(Board.savedName("page.html\u{0}") == "page.html" && Board.savedName("a\u{202E}b.pdf") == "ab.pdf" && Board.savedName("x\u{7}y.txt") == "xy.txt",
          "control and format characters never reach the saved name")
    check(Board.savedName("\u{1F468}\u{200D}\u{1F4BB} notes.pdf") == "\u{1F468}\u{200D}\u{1F4BB} notes.pdf", "joiners stay: an emoji keeps its spelling")
    check(Board.savedName("Z" + String(repeating: "\u{301}", count: 300) + ".pdf") == "file.pdf", "a stem that cannot fit keeps its extension")
    check(Board.savedName("Q3.final", type: "application/pdf") == "Q3.final.pdf" && Board.savedName("v1.2 report", type: "application/pdf") == "v1.2 report.pdf",
          "a dot in the name is not an extension unless an app knows it")
    check(Board.savedName("report", type: "application/pdf") == "report.pdf" && Board.savedName("report.txt", type: "application/pdf") == "report.txt"
          && Board.savedName("notes", type: "") == "notes", "a name with no extension takes one from its type, so Quick Look can open it")
    check(Board.attachmentId("/api/attachment/" + String(repeating: "a", count: 24)) != nil && Board.attachmentId("/api/attachment/AAAAAAAAAAAAAAAAAAAAAAAA") == nil
          && Board.attachmentId("/api/attachment/" + String(repeating: "a", count: 24) + "/preview") == nil && Board.attachmentId("/api/status") == nil,
          "a file's route is exactly /api/attachment/<24 hex>")
    let otherPreview = row(#"{"text":"x","from":"c","attachment":{"url":"/api/attachment/dddddddddddddddddddddddd","preview":"/api/attachment/aaaaaaaaaaaaaaaaaaaaaaaa/preview","kind":"image"}}"#)!.attachments[0]
    check(otherPreview.preview == nil, "a picture from another file's route is no picture")
    let mac = URL(string: "https://studio.kosmosplus.com")!
    check(Board.attachmentRequest(mac: mac, path: "/api/attachment/aaaaaaaaaaaaaaaaaaaaaaaa")?.url?.absoluteString == "https://studio.kosmosplus.com/api/attachment/aaaaaaaaaaaaaaaaaaaaaaaa"
          && Board.attachmentRequest(mac: mac, path: "//evil.example/api/x") == nil, "a file is fetched only from the connected Mac")
}

section("native chat: earlier messages (kosmos#7016 part 3)")
do {
    let mac = URL(string: "https://studio.kosmosplus.com")!
    let r = Board.olderRequest(mac: mac, session: "cleo", before: 412)!
    check(r.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/cleo/thread/older?before=412" && r.httpMethod == "GET",
          "a page before a position counted from the oldest message")
    check(Board.olderRequest(mac: mac, session: "cleo", before: 0) == nil && Board.olderRequest(mac: mac, session: "../x", before: 5) == nil,
          "no page before the first message, and only an agent's name")
    func page(_ n: Int, older: Int) -> Data {
        let rows = (0..<n).map { i in ["at": "2026-10-2\(i % 3)T10:00:00Z", "text": "m\(older + i)", "from": "cleo"] }
        return try! JSONSerialization.data(withJSONObject: ["messages": rows, "olderCount": older])
    }
    func pageOf(_ r: Board.OlderRead) -> (rows: [Board.ChatRow], older: Int) {
        if case .page(let rows, _, let older) = r { return (rows, older) }
        return ([], -1)
    }
    func pos(_ r: Board.OlderRead) -> [Int] { if case .page(_, let p, _) = r { return p }; return [] }
    let (rows, older) = pageOf(Board.readOlder(status: 200, data: page(200, older: 212), before: 412))
    check(older == 212 && rows.count == 200 && rows[0].text == "m212" && rows[0].id.hasPrefix("older|212|"), "the page, oldest first, ids by its position")
    check(Board.readOlder(status: 200, data: page(200, older: 200), before: 412) == .moved, "a range that is not the one asked for: the thread moved")
    check(Board.readOlder(status: 503, data: Data(#"{"error":"we could not read all of the earlier messages just now. Try again in a moment."}"#.utf8), before: 5)
          == .failed("We could not read all of the earlier messages just now. Try again in a moment."), "a failure in the Mac's own words")
    check(Board.readOlder(status: 0, data: nil, before: 5) == .failed(Board.olderFailed) && Board.readOlder(status: 200, data: Data("{}".utf8), before: 5) == .failed(Board.olderFailed),
          "no answer, or an answer with no messages, in the board's words")
    check(Board.readOlder(status: 200, data: Data(#"{"messages":[],"olderCount":5}"#.utf8), before: 5) == .failed(Board.olderFailed),
          "an empty page that makes no progress is a failure, not a page to ask again on every read")
    // Two pages never share an id, and neither shares the latest read's.
    let p1 = pageOf(Board.readOlder(status: 200, data: page(3, older: 0), before: 3)).rows
    let p2 = pageOf(Board.readOlder(status: 200, data: page(3, older: 3), before: 6)).rows
    check(p1.count == 3 && p2.count == 3, "CONTROL: both pages read")
    let latest = Board.parseThread(page(3, older: 6))!.rows
    check(Set((p1 + p2 + latest).map(\.id)).count == 9, "ids are unique across pages and the latest read")

    // Loading, as the board does.
    var e = Board.Earlier()
    check(!Board.shouldLoadEarlier(e, olderCount: 0) && Board.shouldLoadEarlier(e, olderCount: 12), "only when there is something before")
    func load(_ e: Board.Earlier, _ olderCount: Int, _ read: Board.OlderRead) -> Board.Earlier {
        let s = Board.startLoad(e, olderCount: olderCount)
        return Board.finishLoad(s, with: read, opening: s.opening)!
    }
    let page2 = Board.OlderRead.page(rows: p2, positions: [3, 4, 5], olderCount: 3)
    let page1 = Board.OlderRead.page(rows: p1, positions: [0, 1, 2], olderCount: 0)
    let s0 = Board.startLoad(e, olderCount: 12)
    check(s0.open && s0.before == 12 && s0.end == 12 && s0.loading && !Board.shouldLoadEarlier(s0, olderCount: 12), "the first load opens at the read's olderCount; one at a time")
    e = load(e, 12, page2)
    check(!e.loading && e.before == 3 && e.rows == p2 && Board.shouldLoadEarlier(e, olderCount: 12), "a page is prepended, and the next one can load")
    e = load(e, 12, page1)
    check(e.rows == p1 + p2 && e.before == 0 && !Board.shouldLoadEarlier(e, olderCount: 12), "down to the first message, then nothing more")
    var f = load(Board.Earlier(), 12, .failed("No."))
    check(f.because == "No." && !Board.shouldLoadEarlier(f, olderCount: 12), "a failure stops the loading until Try again")
    f = Board.retryEarlier(f)
    check(f.because == nil && f.open && f.before == 12 && Board.shouldLoadEarlier(f, olderCount: 12), "Try again lets it load, from where it was")
    var m = load(Board.Earlier(), 12, .moved)
    check(!m.open && m.moved == 1 && Board.shouldLoadEarlier(m, olderCount: 12), "the thread moved: start again, once")
    m = load(m, 12, .moved)
    check(m.because == Board.olderFailed && m.movedOut && !Board.shouldLoadEarlier(m, olderCount: 12), "moved twice running is a failure, so it is not asked for ever")
    let again = Board.retryEarlier(m)
    check(again.moved == 0 && !again.open && again.opening > m.opening && Board.shouldLoadEarlier(again, olderCount: 9)
          && Board.startLoad(again, olderCount: 9).before == 9, "Try again after a thread that kept moving starts from the latest read")
    // An answer for an older opening is dropped.
    let first = Board.startLoad(Board.Earlier(), olderCount: 12)
    let reset = Board.resetEarlier(first)
    let second = Board.startLoad(reset, olderCount: 12)
    check(Board.finishLoad(second, with: page2, opening: first.opening) == nil && Board.finishLoad(second, with: page2, opening: second.opening) != nil,
          "an answer that belongs to a reset before is dropped")
    check(Board.finishLoad(Board.Earlier(open: true, before: 3, end: 12), with: page1, opening: 0) == nil, "and so is one when no load is in flight")

    // The item kept in place when a page lands: a message row, never a day line whose id can vanish.
    let sameDay = Board.parseThread(Data(#"{"messages":[{"at":"2026-10-23T10:00:00Z","text":"a","from":"c"},{"at":"2026-10-23T10:05:00Z","text":"b","from":"c"}]}"#.utf8))!.rows
    let latestItems = Board.chatItems(sameDay, now: Date(), calendar: .current)
    let dayId = latestItems[0].id
    let firstRow = latestItems[1].id
    check(Board.anchorItem(latestItems, onScreen: [dayId, firstRow]) == firstRow, "the day line at the top is passed over for the row it labels")
    let earlierSameDay = Board.parseRows([["at": "2026-10-23T09:00:00Z", "text": "z", "from": "c"]], idPrefix: "older|0|")
    let combined = Board.chatItems(earlierSameDay + sameDay, now: Date(), calendar: .current)
    check(!combined.map(\.id).contains(dayId) && combined.map(\.id).contains(firstRow),
          "CONTROL: a page ending on the same day takes the old day line's id away, and keeps the row's")
    check(Board.anchorItem(latestItems, onScreen: [dayId]) == nil, "nothing on screen but a day line: nothing kept")

    // The chat's gate.
    let closed = Board.Earlier()
    check(!Board.shouldAsk(settled: false, topVisible: true, earlier: closed, olderCount: 12), "not before the first scroll has settled (the first layout shows the top)")
    check(!Board.shouldAsk(settled: true, topVisible: false, earlier: closed, olderCount: 12), "not while the top is off screen")
    check(Board.shouldAsk(settled: true, topVisible: true, earlier: closed, olderCount: 12), "at the top after settling: it asks")
    check(!Board.shouldAsk(settled: true, topVisible: true, earlier: Board.startLoad(closed, olderCount: 12), olderCount: 12), "never while one is loading")

    // The gap: messages that left the latest 200 while the chat was open.
    check(!Board.hasGap(end: 12, olderCount: 12) && Board.hasGap(end: 12, olderCount: 15), "a gap only when messages left the latest 200")
    check(Board.gapRows(p2, positions: [3, 4, 5], end: 4).map(\.text) == ["m4", "m5"] && Board.gapRows(p2, positions: [3, 4, 5], end: 3) == p2,
          "only the rows at or after the gap's start")
    // A row the phone cannot draw (no text) keeps the others' positions.
    let holey = try! JSONSerialization.data(withJSONObject: ["messages": [["at": "x", "from": "c"], ["at": "y", "text": "kept", "from": "c"]], "olderCount": 10])
    let hr = Board.readOlder(status: 200, data: holey, before: 12)
    check(pos(hr) == [11] && Board.gapRows(pageOf(hr).rows, positions: pos(hr), end: 11).map(\.text) == ["kept"], "positions come from the Mac's rows, not the drawn ones")
    let t = Board.Thread(rows: latest, olderCount: 6)
    check(Board.shownRows(e, thread: t) == p1 + p2 + latest && Board.shownRows(Board.Earlier(), thread: t) == latest, "earlier rows, then the latest read")
}

section("native chat: a sent message until the conversation holds it")
do {
    let t0 = Board.isoDate("2026-10-23T15:00:00Z")!
    func p(_ id: String, _ text: String, _ state: Board.PendingSend.State) -> Board.PendingSend { Board.PendingSend(id: id, text: text, at: t0, state: state) }
    func person(_ at: String, _ text: String, notSent: String? = nil) -> Board.ChatRow {
        Board.ChatRow(id: at, atRaw: at, at: Board.isoDate(at), text: text, who: .person, notSent: notSent)
    }
    let thread = Board.Thread(rows: [person("2026-10-23T15:00:01.000Z", "Hello"), person("2026-10-23T15:00:02.000Z", "Thanks,\n\nsee you Friday"),
                                     person("2026-10-23T14:00:00Z", "Old words")], olderCount: 0)
    let kept = p("k", "Hello", .kept(at: "2026-10-23T15:00:01.000Z"))
    let keptElsewhere = p("k2", "Hello", .kept(at: "2026-10-23T15:09:00.000Z"))
    check(Board.settled([kept, keptElsewhere], with: thread).map(\.id) == ["k2"], "a kept message goes when its own row (by the Mac's time) is read, and only then")
    let taken = p("t", "Thanks,\n\n\n\nsee you Friday", .taken)
    check(Board.settled([taken], with: thread).isEmpty, "a taken message matches the row the Mac tidied (blank lines folded)")
    let lost = p("n", "Thanks, see you   Friday", .failed(reason: nil))
    check(Board.settled([lost], with: thread).isEmpty, "a send that got no answer but arrived is cleared by the read, never left as Not sent")
    let refused = p("r", "Hello", .failed(reason: "Dana is at its trust prompt"))
    check(Board.settled([refused], with: thread).map(\.id) == ["r"], "one the Mac refused with a reason kept no row, so it stays")
    let sending = p("s", "Hello", .sending)
    check(Board.settled([sending], with: thread).map(\.id) == ["s"], "one still sending stays")
    let oldWords = p("o", "Old words", .taken)
    check(Board.settled([oldWords], with: thread).map(\.id) == ["o"], "a row written long before the send does not clear it")
    let twice = [p("a", "Hello", .taken), p("b", "Hello", .taken)]
    check(Board.settled(twice, with: thread).map(\.id) == ["b"], "one row clears one pending message")
    let agentSaid = Board.Thread(rows: [Board.ChatRow(id: "x", atRaw: nil, at: t0, text: "Hello", who: .agent)], olderCount: 0)
    check(Board.settled([p("a", "Hello", .taken)], with: agentSaid).map(\.id) == ["a"], "the agent saying the same words does not clear the person's message")
    // A send with no answer is cleared only by a row newer than what the chat had already shown when it was sent.
    var short = Board.PendingSend(id: "ok", text: "ok", at: Board.isoDate("2026-10-23T15:00:30Z")!, state: .failed(reason: nil))
    short.after = "2026-10-23T15:00:00.000Z"
    let earlierOk = Board.Thread(rows: [person("2026-10-23T15:00:00.000Z", "ok")], olderCount: 0)
    check(Board.settled([short], with: earlierOk).map(\.id) == ["ok"], "an earlier ok the chat had already shown never stands in for one that was never sent")
    let laterOk = Board.Thread(rows: [person("2026-10-23T15:00:00.000Z", "ok"), person("2026-10-23T15:00:31.000Z", "ok")], olderCount: 0)
    check(Board.settled([short], with: laterOk).isEmpty, "a newer ok clears it")
    // Rows named by the Mac settle first: a no-answer "ok" must not take the row of a later kept "ok".
    var fuzzy = Board.PendingSend(id: "f", text: "ok", at: Board.isoDate("2026-10-23T15:00:30Z")!, state: .failed(reason: nil)); fuzzy.after = "2026-10-23T15:00:00.000Z"
    let exact = Board.PendingSend(id: "e", text: "ok", at: Board.isoDate("2026-10-23T15:00:40Z")!, state: .kept(at: "2026-10-23T15:00:41.000Z"))
    let one = Board.Thread(rows: [person("2026-10-23T15:00:41.000Z", "ok")], olderCount: 0)
    check(Board.settled([fuzzy, exact], with: one).map(\.id) == ["f"], "the kept one takes its own row; the never-sent one stays")
    // Delivered but never written down: dropped once a read holds a newer row and still not it.
    var unrecorded = Board.PendingSend(id: "u", text: "done", at: Board.isoDate("2026-10-23T15:01:00Z")!, state: .taken); unrecorded.after = "2026-10-23T15:00:41.000Z"
    check(Board.settled([unrecorded], with: one).map(\.id) == ["u"], "no newer row yet: it stays")
    let newer = Board.Thread(rows: [person("2026-10-23T15:00:41.000Z", "ok"), Board.ChatRow(id: "r", atRaw: "2026-10-23T15:02:00.000Z", at: Board.isoDate("2026-10-23T15:02:00.000Z"), text: "reply", who: .agent)], olderCount: 0)
    check(Board.settled([unrecorded], with: newer).isEmpty, "a newer row and still not it: it goes, as the board never shows it")
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
    // kosmos#7030: the tasks read (GET /api/tasks?view=tasks); nil is no answer at all.
    var tasksAnswer: (Int, String)? = (200, #"{"tasks":[{"projectId":"p1","projectName":"Catalogue","number":4,"sentence":"Pages 1 to 8","state":"built","builtBy":"dana"}]}"#)
    var admitted = 0
    // The Mac cookie each status request carried, as the real session would send it from the jar.
    var presented: [String] = []
    var macsStatus = 200
    // The gate's own cookie keyed apart from the one the app restored (a leading-dot domain), as a real host-only
    // Set-Cookie might be: both then sit in the jar side by side.
    var admitKeyedApart = false
    // Pictures: an image, or (pictureAsPage) the gate's sign-in page at 200, as an ended session would answer.
    var pictureAsPage = false
    // kosmos#7008: one agent's conversation (GET) and the answers to sends (POST, each takes the first queued; nil is no
    // answer at all), with the texts posted.
    var threadAnswer: (Int, String)? = (200, #"{"messages":[],"olderCount":0}"#)
    var sendQueue: [(Int, String)?] = []
    var posted: [String] = []
    // kosmos#7020: each post's `request` ("" when it named none), beside `posted`.
    var postedRequests: [String] = []
    // Runs as a conversation read is answered, for a change that lands while a read is in flight.
    var onThreadRead: (() -> Void)?
    // Runs as a POST to a conversation is answered (taken once), for a change while a send or press is in flight.
    var onPost: (() -> Void)?
    // When set, a POST yields this many times before it is answered, so a test can act while it is in the air.
    var postYields = 0
    // kosmos#7016 part 2: what a file route answers (nil: no answer), and the paths asked for.
    var attachmentAnswer: (Int, String, Data)? = (200, "application/pdf", Data("%PDF-1.4 sample".utf8))
    var attachmentAsks: [String] = []
    var attachmentYields = 0
    // kosmos#7016 part 3: what the earlier-messages route answers, and the queries asked.
    var olderAnswer: (Int, String)? = (200, #"{"messages":[{"at":"2026-10-20T10:00:00Z","text":"first","from":"dana"}],"olderCount":0}"#)
    var olderAsks: [String] = []
    var onOlder: (() -> Void)?
    // File requests that have started (before any yield), so a test can act while one is on its way.
    var attachmentStarted: [String] = []
    var threadYields = 0
    // Runs as a status read is answered (taken once), for a change that lands while a read is in flight.
    var onStatusRead: (() -> Void)?
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
        case "/api/tasks":
            return tasksAnswer.map { answer($0.0, $0.1) }
        case "/api/status":
            presented.append((cookies.cookies(for: url) ?? []).filter { $0.name == Board.macCookieName }.map(\.value).joined(separator: ","))
            if let hook = onStatusRead { onStatusRead = nil; hook() }
            let next: (Int, String)? = statusQueue.isEmpty ? statusDefault : statusQueue.removeFirst()
            return next.map { answer($0.0, $0.1) }
        default:
            if url.path.hasPrefix("/api/agent/") && url.path.hasSuffix("/thread") {
                if r.httpMethod == "POST" {
                    let body = r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                    posted.append(body?["text"] as? String ?? "")
                    postedRequests.append(body?["request"] as? String ?? "")
                    if let hook = onPost { onPost = nil; hook() }
                    let next: (Int, String)? = sendQueue.isEmpty ? (200, #"{"delivery":{"state":"placed","at":"2026-10-23T20:00:00.000Z"},"recorded":true}"#) : sendQueue.removeFirst()
                    return next.map { answer($0.0, $0.1) }
                }
                onThreadRead?()
                return threadAnswer.map { answer($0.0, $0.1) }
            }
            if url.path.hasSuffix("/thread/older") {
                olderAsks.append(url.query ?? "")
                if let hook = onOlder { onOlder = nil; hook() }
                return olderAnswer.map { answer($0.0, $0.1) }
            }
            if url.path.hasPrefix("/api/attachment/") {
                attachmentAsks.append(url.path)
                guard let (code, type, body) = attachmentAnswer else { return nil }
                return (body, HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": type])!)
            }
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

// The loop tests' own folder for opened files (#7016), so no test writes into this Mac's folders.
let testFiles = FileManager.default.temporaryDirectory.appendingPathComponent("kosmos-logic-tests-files-\(getpid())", isDirectory: true)

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
                                 env: .init(send: { r in
                                                if r.httpMethod == "POST" { for _ in 0..<world.postYields { await Task.yield() } }
                                                else if r.url?.path.hasSuffix("/thread") == true { for _ in 0..<world.threadYields { await Task.yield() } }
                                                else if r.url?.path.hasPrefix("/api/attachment/") == true { world.attachmentStarted.append(r.url!.path); for _ in 0..<world.attachmentYields { await Task.yield() } }
                                                return world.send(r)
                                            },
                                            sleep: { world.clock += $0; await Task.yield() },
                                            now: { world.clock },
                                            defaults: defaults,
                                            files: testFiles))
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

    section("native chat: the client's sends and reads, against a fake Mac (kosmos#7008)")
    do {
        let (c, w, _, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        let dana = c.agents.first { $0.session == "dana" }!
        func pending() -> [Board.PendingSend] { c.pending["dana"] ?? [] }

        // Kept: shown until a read brings the Mac's own row for it, then gone with no copy left.
        w.sendQueue = [(200, #"{"delivery":{"state":"placed","at":"2026-10-23T20:00:01.000Z"},"recorded":true}"#)]
        await c.post("  Morning Dana \n", to: dana)
        check(w.posted.last == "Morning Dana", "the trimmed words are posted")
        check(pending().count == 1 && pending()[0].state == .kept(at: "2026-10-23T20:00:01.000Z"), "a kept send waits for its row")
        w.threadAnswer = (200, #"{"messages":[{"at":"2026-10-23T20:00:01.000Z","text":"Morning Dana","from":null,"delivery":{"state":"placed"}}]}"#)
        if case .thread(let t) = await c.thread(for: "dana") { c.settle(t, for: "dana") }
        check(pending().isEmpty, "the read that holds its row clears it: one bubble, not two")

        // Held: the Mac's row says Waiting to send; the app never offers to send it again (it would be typed twice).
        w.sendQueue = [(200, #"{"delivery":{"state":"held","at":"2026-10-23T20:00:02.000Z"},"recorded":true}"#)]
        await c.post("Pages 9 to 12?", to: dana)
        check(pending().last?.state == Board.PendingSend.State.keptUndelivered(at: "2026-10-23T20:00:02.000Z", note: "Waiting to send") && pending().last?.failed == false
              && pending().last?.shownAsSent == false, "a held send is kept undelivered: not failed, and never shown as sent")
        let before = w.posted.count
        await c.retry(pending().last!.id, to: dana)
        check(w.posted.count == before, "and a retry of it sends nothing")
        w.threadAnswer = (200, #"{"messages":[{"at":"2026-10-23T20:00:02.000Z","text":"Pages 9 to 12?","from":null,"delivery":{"state":"held"}}]}"#)
        if case .thread(let t) = await c.thread(for: "dana") {
            c.settle(t, for: "dana")
            check(pending().isEmpty && t.rows.first?.notSent == "Waiting to send" && t.rows.first?.canSendAgain == false,
                  "its row reads Waiting to send, with nothing to tap")
        } else { check(false, "the held row is read") }

        // Refused with the Mac's words: failed, says why, and is tried again by a tap.
        w.sendQueue = [(409, #"{"error":"Dana is at its trust prompt"}"#), (200, #"{"delivery":{"state":"placed","at":"2026-10-23T20:00:03.000Z"},"recorded":true}"#)]
        await c.post("Go on", to: dana)
        check(pending().last?.state == .failed(reason: "Dana is at its trust prompt"), "a refusal keeps the Mac's words")
        await c.retry(pending().last!.id, to: dana)
        check(w.posted.suffix(2) == ["Go on", "Go on"] && pending().last?.state == .kept(at: "2026-10-23T20:00:03.000Z"), "a tap tries again, and this time it is kept")
        c.discard(pending().last!.id, for: "dana")

        // No answer, but it arrived: the next read clears it instead of leaving "Not sent" for a message the agent has.
        w.sendQueue = [nil]
        await c.post("Thanks,\n\n\n\nsee you Friday", to: dana)
        check(pending().last?.state == .failed(reason: nil), "no answer is not sent, for now")
        w.threadAnswer = (200, #"{"messages":[{"at":"2026-10-23T20:00:04.000Z","text":"Thanks,\n\nsee you Friday","from":null,"delivery":{"state":"placed"}}]}"#)
        if case .thread(let t) = await c.thread(for: "dana") { c.settle(t, for: "dana") }
        check(pending().isEmpty, "a read that holds the same words (tidied by the Mac) clears it")

        // No answer, then a tap: the conversation is read first, and a message that did arrive is not sent again.
        w.threadAnswer = (200, #"{"messages":[]}"#)
        w.sendQueue = [nil]
        await c.post("Arrived after all", to: dana)
        let failedId = pending().last!.id
        w.threadAnswer = (200, #"{"messages":[{"at":"2026-10-23T20:00:09.000Z","text":"Arrived after all","from":null,"delivery":{"state":"placed"}}]}"#)
        let postsBeforeRetry = w.posted.count
        await c.retry(failedId, to: dana)
        check(w.posted.count == postsBeforeRetry && !pending().contains { $0.id == failedId },
              "a retry after no answer finds it in the conversation and sends nothing")

        // A message the Mac kept as not sent is sent again as a new message.
        let lostRow = Board.ChatRow(id: "x", atRaw: "T", at: nil, text: "Are you there?", who: .person, notSent: "Not sent", resendable: true)
        let postedBefore = w.posted.count
        await c.sendAgain(lostRow, to: dana)
        await c.sendAgain(lostRow, to: dana)
        check(w.posted.last == "Are you there?" && w.posted.count == postedBefore + 1, "Not sent, tapped twice, posts the words again once")
        check(c.wasSentAgain(lostRow, for: "dana"), "and the row knows it was sent again (its line goes)")

        // Reads say the Mac's reason, or no answer.
        w.threadAnswer = (404, #"{"error":"that name belongs to another session"}"#)
        let refusedRead = await c.thread(for: "dana")
        check(refusedRead == .refused("that name belongs to another session"), "a refused read keeps the Mac's words")
        w.threadAnswer = nil
        let silentRead = await c.thread(for: "dana")
        check(silentRead == .noAnswer, "no answer is no answer")
        c.stop()
    }
    do {
        // A read that finds no session (a Keychain that cannot be read yet) keeps the chats; a sign-out the web view
        // reports drops every chat's pending messages, unsent words and sent-again marks at once; and a session that
        // comes back as someone else's drops them too. Nothing typed or failed under one account is shown, or sent,
        // under the next.
        let (c, w, sessions, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        let dana = c.agents.first { $0.session == "dana" }!
        func hold() async {
            w.sendQueue = [(409, #"{"error":"no"}"#)]
            await c.post("send the wire details", to: dana)
            c.drafts["dana"] = "half a thought"
        }
        await hold()
        check(c.pending["dana"]?.isEmpty == false && c.drafts["dana"] != nil, "CONTROL: a failed message and a draft are held")
        let epoch = c.chatEpoch
        c.stop()
        sessions.value = nil
        c.start()
        check(c.pending["dana"]?.isEmpty == false && c.drafts["dana"] == "half a thought" && c.chatEpoch == epoch,
              "no session read: the chats, the draft and the open chat stay")
        sessions.value = "kst1"
        c.start()
        check(c.pending["dana"]?.isEmpty == false && c.drafts["dana"] == "half a thought" && c.chatEpoch == epoch,
              "and the same session back keeps them")
        c.stop()
        sessions.value = nil
        c.start()
        sessions.value = "kst2"
        c.start()
        check(c.pending.isEmpty && c.drafts.isEmpty && c.resent.isEmpty && c.chatEpoch > epoch,
              "another session after a read with none: all of it is gone, and the open chat resets")
        _ = await settle { isLive(c) }
        await hold()
        let before = c.chatEpoch
        c.accountChanged()
        check(c.pending.isEmpty && c.drafts.isEmpty && c.resent.isEmpty && c.chatEpoch > before,
              "a sign-out the web view reports: all of it is gone at once")
        c.stop()
    }
    do {
        // Another Mac: the chats opened on the one before go, before any chat call reaches the new one.
        let (c, w, sessions, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        let dana = c.agents.first { $0.session == "dana" }!
        w.sendQueue = [(409, #"{"error":"no"}"#)]
        await c.post("send the wire details", to: dana)
        c.drafts["dana"] = "half a thought"
        let epoch = c.chatEpoch
        c.retry()
        _ = await settle { isLive(c) }
        check(c.pending["dana"]?.isEmpty == false && c.chatEpoch == epoch, "CONTROL: the same Mac again keeps them")
        w.macsBody = #"{"macs":[{"name":"Office","address":"office.kosmosplus.com","last_seen":100}]}"#
        c.retry()
        let moved = await settle { if case .live(let m) = c.phase { return m.address == "office.kosmosplus.com" }; return false }
        check(moved, "CONTROL: the client moved to the other Mac")
        check(c.pending.isEmpty && c.drafts.isEmpty && c.chatEpoch > epoch, "another Mac: the chats from the one before are gone")
        // A draft on the new Mac, then a read with no session, then someone else's: the account check still holds.
        c.drafts["dana"] = "for the office Mac"
        c.stop()
        sessions.value = nil
        c.start()
        check(c.drafts["dana"] == "for the office Mac", "CONTROL: a read with no session keeps it")
        sessions.value = "kst2"
        c.start()
        check(c.drafts.isEmpty, "another account after a Mac change and a read with none: the draft is gone")
        c.stop()
    }
    do {
        // A sign-out reported while a status read is in flight: that read writes nothing back, and the tab shows signed out.
        let (c, w, sessions, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        w.onStatusRead = { MainActor.assumeIsolated { sessions.value = nil; c.accountChanged() } }
        let out = await settle { c.phase == .signedOut }
        check(out && c.agents.isEmpty && c.updatedAt == nil, "a read in flight at the sign-out does not put the old list back")
        c.stop()
    }
    do {
        // A retry's read that comes back after the chats were forgotten settles nothing into the new account's chat.
        let (c, w, _, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        let dana = c.agents.first { $0.session == "dana" }!
        w.sendQueue = [nil]
        await c.post("are you there", to: dana)
        let id = c.pending["dana"]!.last!.id
        w.threadAnswer = (200, #"{"messages":[{"at":"2026-10-23T20:00:09.000Z","text":"old account's words","from":null,"delivery":{"state":"placed"}}]}"#)
        w.onThreadRead = { MainActor.assumeIsolated { c.accountChanged() } }
        await c.retry(id, to: dana)
        w.onThreadRead = nil
        await c.post("hello", to: dana)
        check(c.pending["dana"]?.last?.after == nil, "and the old read did not set the new chat's newest row")
        c.stop()
    }
    do {
        // kosmos#7030: Today's tasks and badge through the client, against the fake Mac.
        let (c, w, _, _) = make("kst1")
        w.statusDefault = (200, #"{"counts":{"waiting":3},"agents":[{"sessionName":"dana","name":"Dana","state":"working"}]}"#)
        c.show(BoardClient.agentsViewer)
        _ = await settle { isLive(c) }
        check(c.waitingCount == 3, "the badge is the Mac's counts.waiting")
        // Two more reads, and time for anything they would start in the background to run, before looking.
        await c.refreshNow(); await c.refreshNow()
        for _ in 0..<50 { await Task.yield() }
        check(w.count("/api/status") >= 3, "CONTROL: the reads happened")
        check(w.count("/api/tasks") == 0 && c.readyTasks == nil, "no tasks read while only Agents is on screen")
        c.show(BoardClient.todayViewer)
        let read = await settle { c.readyTasks != nil }
        check(read && c.readyTasks?.map(\.number) == [4] && !c.tasksFailed, "Today arriving reads its tasks")
        c.hide(BoardClient.agentsViewer)
        // Review 2: the loop really keeps going for Today (the list alone would stay up even if it stopped).
        let readsBefore = w.count("/api/status")
        await c.refreshNow()
        check(w.count("/api/status") > readsBefore, "CONTROL: Today keeps the loop reading after Agents goes")
        // Review 2: tasks read longer ago than a tick are unknown when Today comes back, until the read answers.
        c.hide(BoardClient.todayViewer)
        c.show(BoardClient.agentsViewer)
        w.clock += BoardClient.tasksEvery + 1
        w.tasksAnswer = nil   // the read now does not answer, so what shows is what show() left
        c.show(BoardClient.todayViewer)
        check(c.readyTasks == nil, "old tasks are not shown as current when Today comes back")
        c.hide(BoardClient.agentsViewer)
        w.tasksAnswer = (200, #"{"tasks":[{"projectId":"p1","projectName":"Catalogue","number":4,"sentence":"Pages 1 to 8","state":"built","builtBy":"dana"}]}"#)
        // A failed read: the old list goes, and it says so (never an old list shown as current).
        w.tasksAnswer = (500, #"{"error":"we cannot read your tasks right now"}"#)
        await c.refreshTasks()
        check(c.readyTasks == nil && c.tasksFailed, "a failed read drops the old list and says it failed")
        w.tasksAnswer = (200, #"{"tasks":[]}"#)
        await c.refreshTasks()
        check(c.readyTasks == [] && !c.tasksFailed, "and a good one brings it back")
        // Another account: nothing of the old one's count or tasks is kept.
        w.tasksAnswer = (200, #"{"tasks":[{"projectId":"p1","projectName":"Catalogue","number":4,"sentence":"Pages 1 to 8","state":"built"}]}"#)
        await c.refreshTasks()
        check(c.readyTasks?.count == 1, "CONTROL: a list to forget")
        c.accountChanged()
        check(c.waitingCount == nil && c.readyTasks == nil && !c.tasksFailed, "another account: no count, no tasks")
        // Review 2: Kosmos+ ending the session (a 401 on the Mac list) drops the badge and the tasks too.
        let (c2, w2, _, _) = make("kst1")
        w2.statusDefault = (200, #"{"counts":{"waiting":2},"agents":[{"sessionName":"dana","name":"Dana","state":"working"}]}"#)
        c2.show(BoardClient.todayViewer)
        _ = await settle { isLive(c2) && c2.readyTasks != nil }
        check(c2.waitingCount == 2 && c2.readyTasks?.count == 1, "CONTROL: a badge and tasks to drop")
        w2.macsStatus = 401
        c2.retry(); c2.retry()
        let out = await settle { if case .signedOut = c2.phase { return true }; return false }
        check(out && c2.waitingCount == nil && c2.readyTasks == nil, "signed out by Kosmos+: no badge, no tasks under Sign in")
        c2.hide(BoardClient.todayViewer)
        c2.stop()
        c.hide(BoardClient.todayViewer)
        c.stop()
    }
    do {
        // kosmos#7016: a press through the client, against the fake Mac.
        let (c, w, _, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        let dana = c.agents.first { $0.session == "dana" }!
        let choices = Board.Choices(options: [.init(n: 1, label: "Tuesday", lasting: false)], asked: "Q?", key: "k1")
        let tue = choices.options[0]
        w.sendQueue = [(200, #"{"delivery":{"state":"placed"}}"#)]
        let sent = await c.press(tue, of: choices, to: dana)
        check(sent == .sent && w.posted.last == "1", "a press types the option's digit and comes back sent")
        check(w.postedRequests.last == "", "#7020 CONTROL: a press with no card names no request")
        check(c.answeredNow("dana", key: "k1") == BoardClient.Answered(key: "k1", at: w.clock, sure: true, n: 1), "and locks that question")
        check(c.answeredNow("dana", key: "k2") == nil, "but not another question")
        w.clock += 6
        check(c.answeredNow("dana", key: "k1") == nil, "the lock ends after 6 s")
        w.sendQueue = [(409, #"{"error":"its question is no longer on its screen"}"#)]
        let refused = await c.press(tue, of: choices, to: dana)
        check(refused == .refused("Its question is no longer on its screen.") && c.answeredNow("dana", key: "k1") == nil,
              "a refusal typed nothing: no lock, the buttons come back")
        w.sendQueue = [nil]
        let unsure = await c.press(tue, of: choices, to: dana)
        check(unsure == .notSure(Board.choiceUnsure) && c.answeredNow("dana", key: "k1")?.sure == false, "no answer may have gone: locked, not sure")
        check(c.pressing.isEmpty, "nothing left in the air")
        let carded = Board.Choices(options: choices.options, asked: "Q?", key: "k9", request: String(repeating: "c", count: 64))
        w.sendQueue = [(200, #"{"delivery":{"state":"placed"}}"#)]
        _ = await c.press(tue, of: carded, to: dana)
        check(w.postedRequests.last == String(repeating: "c", count: 64), "#7020: the client's press sends the card's request")
        w.clock += 6

        // One at a time, and never across a typed send.
        w.postYields = 50
        w.sendQueue = [(200, #"{"delivery":{"state":"placed"}}"#)]
        let inFlight = Task { await c.press(tue, of: choices, to: dana) }
        let flying = await settle { c.pressing.contains("dana") }
        check(flying, "CONTROL: the first press is in the air")
        let second = await c.press(tue, of: choices, to: dana)
        let posts = w.posted.count
        await c.post("typed meanwhile", to: dana)
        check(second == nil && w.posted.count == posts && c.pending["dana"]?.isEmpty != false,
              "while a press is in the air, a second press and a typed send send nothing")
        let first = await inFlight.value
        check(first == .sent && !c.pressing.contains("dana"), "and the first comes back sent")
        w.sendQueue = [(200, #"{"delivery":{"state":"placed"}}"#)]
        let pressAgain = Task { await c.press(tue, of: choices, to: dana) }
        _ = await settle { c.pressing.contains("dana") }
        let lostRow = Board.ChatRow(id: "lost", atRaw: "T", at: nil, text: "Are you there?", who: .person, notSent: "Not sent", resendable: true)
        await c.sendAgain(lostRow, to: dana)
        check(!c.wasSentAgain(lostRow, for: "dana"), "Send again while a press is in the air does nothing, and the row still offers it")
        _ = await pressAgain.value
        // And a retry of a failed message while a press is in the air sends nothing.
        w.sendQueue = [(409, #"{"error":"no"}"#)]
        await c.post("try me", to: dana)
        let f1 = c.pending["dana"]!.last!.id
        w.sendQueue = [(200, #"{"delivery":{"state":"placed"}}"#)]
        let pressThird = Task { await c.press(tue, of: choices, to: dana) }
        _ = await settle { c.pressing.contains("dana") }
        let postsBefore = w.posted.count
        await c.retry(f1, to: dana)
        check(w.posted.count == postsBefore && c.pending["dana"]?.first(where: { $0.id == f1 })?.failed == true,
              "a retry while a press is in the air sends nothing and the message stays not sent")
        _ = await pressThird.value
        c.discard(f1, for: "dana")
        let typed = Task { await c.post("a typed reply", to: dana) }
        let typing = await settle { c.isSending("dana") }
        check(typing, "CONTROL: a typed send is in the air")
        let during = await c.press(tue, of: choices, to: dana)
        check(during == nil, "a press while a typed send is in the air presses nothing")
        await typed.value
        // A retry still reading before it sends counts as a send in the air.
        w.sendQueue = [nil]
        await c.post("will fail", to: dana)
        let failedId = c.pending["dana"]!.last!.id
        w.threadAnswer = (200, #"{"messages":[]}"#)
        w.threadYields = 500
        w.postYields = 0
        w.sendQueue = [(200, #"{"delivery":{"state":"placed","at":"2026-10-23T20:00:10.000Z"},"recorded":true}"#)]
        let retrying = Task { await c.retry(failedId, to: dana) }
        let reading = await settle { c.isSending("dana") }
        check(reading && c.pending["dana"]?.first(where: { $0.id == failedId })?.failed == true,
              "CONTROL: a retry still reading (the message still reads as failed) is a send in the air")
        let duringRetry = await c.press(tue, of: choices, to: dana)
        check(duringRetry == nil, "a press during a retry's read presses nothing")
        await retrying.value
        w.threadYields = 0
        w.postYields = 0

        // A reset while a press is in the air: its answer is dropped.
        w.onPost = { MainActor.assumeIsolated { c.accountChanged() } }
        w.sendQueue = [(200, #"{"delivery":{"state":"placed"}}"#)]
        let across = await c.press(tue, of: choices, to: dana)
        w.onPost = nil
        check(across == nil && c.answered.isEmpty && c.pressing.isEmpty, "a press that crossed a reset leaves nothing behind")
        c.stop()
    }
    do {
        // kosmos#7016 part 2: files opened in an earlier run do not outlive it (whose they were is not known any more).
        let leftover = testFiles.appendingPathComponent("7777777777777777777777aa", isDirectory: true)
        try? FileManager.default.createDirectory(at: leftover, withIntermediateDirectories: true)
        try? Data("old".utf8).write(to: leftover.appendingPathComponent("old.pdf"))
        check(FileManager.default.fileExists(atPath: leftover.path), "CONTROL: a file from an earlier run is on disk")
        // Opening a file and its picture, against the fake Mac.
        let (c, w, _, _) = make("kst1")
        check(!FileManager.default.fileExists(atPath: leftover.path), "a new client removes it")
        c.start()
        _ = await settle { isLive(c) }
        let pdf = Board.Attachment(id: "111111111111111111111111", name: "../Plan.pdf", type: "application/pdf", size: 10, kind: "pdf",
                                   url: "/api/attachment/111111111111111111111111", preview: "/api/attachment/111111111111111111111111/preview")
        let file = await c.fetchFile(pdf)
        check(file?.lastPathComponent == "-Plan.pdf" && file.map { $0.path.hasPrefix(testFiles.path) } == true
              && (file.flatMap { try? Data(contentsOf: $0) }) == Data("%PDF-1.4 sample".utf8),
              "the file is saved under its own name, in the client's own folder, with the Mac's bytes")
        w.attachmentAnswer = (200, "text/html", Data("<html>sign in</html>".utf8))
        let page = await c.fetchFile(pdf)
        check(page == nil, "the gate's sign-in page in place of the file is no file")
        // The Mac answering with an ordinary type, so only the refusal up front can stop it.
        w.attachmentAnswer = (200, "application/octet-stream", Data("<html>".utf8))
        let html = Board.Attachment(id: "444444444444444444444444", name: "page.html", type: "text/html", size: 1, kind: "other", url: "/api/attachment/444444444444444444444444", preview: nil)
        let htmlFile = await c.fetchFile(html)
        check(htmlFile == nil, "a web page is never opened here, even one the agent sent as HTML")
        // The Mac's answer is itself markup, under an ordinary name and type.
        w.attachmentAnswer = (200, "image/svg+xml ; charset=utf-8", Data("<svg/>".utf8))
        let svgAnswer = await c.fetchFile(Board.Attachment(id: "aaaaaaaaaaaaaaaaaaaaaa01", name: "chart.png", type: "image/png", size: 1, kind: "image",
                                                           url: "/api/attachment/aaaaaaaaaaaaaaaaaaaaaa01", preview: nil))
        check(svgAnswer == nil, "an answer that is markup is no file, whatever the row said")
        let disguised = Board.Attachment(id: "8888888888888888888888aa", name: "report.html", type: "text/plain", size: 1, kind: "text",
                                         url: "/api/attachment/8888888888888888888888aa", preview: nil)
        let asksBefore = w.attachmentAsks.count
        w.attachmentAnswer = (200, "text/plain", Data("<html>".utf8))
        let disguisedFile = await c.fetchFile(disguised)
        check(disguisedFile == nil && w.attachmentAsks.count == asksBefore, "a page sent under another type is not even fetched")
        // Quick Look closed: that file goes, and only its own folder.
        w.attachmentAnswer = (200, "application/pdf", Data("%PDF-1.4 sample".utf8))
        let opened = await c.fetchFile(pdf)!
        let other = await c.fetchFile(Board.Attachment(id: "555555555555555555555555", name: "o.pdf", type: "application/pdf", size: 1, kind: "pdf", url: "/api/attachment/555555555555555555555555", preview: nil))!
        c.closed(opened)
        check(!FileManager.default.fileExists(atPath: opened.path) && FileManager.default.fileExists(atPath: other.path), "closing removes that file only")
        c.closed(testFiles.appendingPathComponent("loose.pdf"))
        c.closed(URL(fileURLWithPath: "/tmp/x/y.pdf"))
        check(FileManager.default.fileExists(atPath: other.path), "a path that is not a file's own folder removes nothing")
        w.attachmentAnswer = (404, "application/json", Data(#"{"error":"no such attachment"}"#.utf8))
        let missing = await c.fetchFile(pdf)
        check(missing == nil, "a 404 is no file")
        w.attachmentAnswer = nil
        let silent = await c.fetchFile(pdf)
        check(silent == nil, "no answer is no file")
        // A whole 1200 x 800 picture comes back from the preview route (an image's preview is the image itself).
        let big: Data = {
            let ctx = CGContext(data: nil, width: 1200, height: 800, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            ctx.setFillColor(CGColor(red: 1, green: 0, blue: 0, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: 1200, height: 800))
            let out = NSMutableData()
            let dest = CGImageDestinationCreateWithData(out, "public.png" as CFString, 1, nil)!
            CGImageDestinationAddImage(dest, ctx.makeImage()!, nil); _ = CGImageDestinationFinalize(dest)
            return out as Data
        }()
        w.attachmentAnswer = (200, "image/png", Data([0x89, 0x50]))
        await c.loadThumbnail(pdf)
        check(c.thumbnails["111111111111111111111111"] == nil, "bytes that are not a picture are no picture")
        w.attachmentAnswer = (200, "image/png", big)
        let pdf2 = Board.Attachment(id: "333333333333333333333333", name: "x.pdf", type: "application/pdf", size: 1, kind: "pdf",
                                    url: "/api/attachment/333333333333333333333333", preview: "/api/attachment/333333333333333333333333/preview")
        await c.loadThumbnail(pdf2)
        let kept = c.thumbnails["333333333333333333333333"].flatMap { CGImageSourceCreateWithData($0 as CFData, nil) }.flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) }
        check(kept.map { max($0.width, $0.height) } == 192 && (c.thumbnails["333333333333333333333333"]?.count ?? .max) < big.count,
              "the picture kept is drawn at 192 px (a 64 pt square at @3x), never the whole file")
        check(w.attachmentAsks.last == "/api/attachment/333333333333333333333333/preview", "the picture comes from its preview route")
        let flaky = Board.Attachment(id: "9999999999999999999999aa", name: "f.pdf", type: "application/pdf", size: 1, kind: "pdf",
                                     url: "/api/attachment/9999999999999999999999aa", preview: "/api/attachment/9999999999999999999999aa/preview")
        w.attachmentAnswer = (503, "application/json", Data("{}".utf8))
        await c.loadThumbnail(flaky)
        w.attachmentAnswer = (200, "image/png", big)
        await c.loadThumbnail(flaky)
        check(c.thumbnails[flaky.id] != nil, "a picture that failed with a 5xx is asked again")
        let gone = Board.Attachment(id: "9999999999999999999999bb", name: "g.pdf", type: "application/pdf", size: 1, kind: "pdf",
                                    url: "/api/attachment/9999999999999999999999bb", preview: "/api/attachment/9999999999999999999999bb/preview")
        w.attachmentAnswer = (404, "application/json", Data("{}".utf8))
        await c.loadThumbnail(gone)
        let after404 = w.attachmentAsks.count
        w.attachmentAnswer = (200, "image/png", big)
        await c.loadThumbnail(gone)
        check(w.attachmentAsks.count == after404 && c.thumbnails[gone.id] == nil, "a picture the Mac does not have (404) is not asked again")
        let svg = Board.Attachment(id: "9999999999999999999999cc", name: "logo.svg", type: "image/svg+xml", size: 1, kind: "image",
                                   url: "/api/attachment/9999999999999999999999cc", preview: "/api/attachment/9999999999999999999999cc/preview")
        w.attachmentAnswer = (200, "image/svg+xml", Data("<svg/>".utf8))
        await c.loadThumbnail(svg)
        let afterSvg = w.attachmentAsks.count
        await c.loadThumbnail(svg)
        check(w.attachmentAsks.count == afterSvg && c.thumbnails[svg.id] == nil, "a picture the phone cannot draw is not downloaded again")
        let signIn = Board.Attachment(id: "9999999999999999999999dd", name: "p.pdf", type: "application/pdf", size: 1, kind: "pdf",
                                    url: "/api/attachment/9999999999999999999999dd", preview: "/api/attachment/9999999999999999999999dd/preview")
        w.attachmentAnswer = (200, "text/html", Data("<html>sign in</html>".utf8))
        await c.loadThumbnail(signIn)
        w.attachmentAnswer = (200, "image/png", big)
        await c.loadThumbnail(signIn)
        check(c.thumbnails[signIn.id] != nil, "the gate's sign-in page in place of a picture is asked again")
        let asks = w.attachmentAsks.count
        await c.loadThumbnail(pdf2)
        check(w.attachmentAsks.count == asks, "and is asked for once")
        let doc = Board.Attachment(id: "222222222222222222222222", name: "b.docx", type: "", size: nil, kind: "other", url: "/api/attachment/222222222222222222222222", preview: nil)
        await c.loadThumbnail(doc)
        check(w.attachmentAsks.count == asks && c.thumbnails["222222222222222222222222"] == nil, "no preview: no request")
        // A sign-out while a picture is on its way: it lands in nobody's chat.
        w.attachmentYields = 50
        w.attachmentAnswer = (200, "image/png", big)
        let latePic = Board.Attachment(id: "6666666666666666666666bb", name: "l.pdf", type: "application/pdf", size: 1, kind: "pdf",
                                       url: "/api/attachment/6666666666666666666666bb", preview: "/api/attachment/6666666666666666666666bb/preview")
        let picTask = Task { await c.loadThumbnail(latePic) }
        _ = await settle { w.attachmentStarted.last == "/api/attachment/6666666666666666666666bb/preview" }
        c.accountChanged()
        await picTask.value
        check(c.thumbnails[latePic.id] == nil, "a picture fetched across a sign-out is not kept for the next account")
        _ = await settle { isLive(c) }
        // A sign-out while a file is on its way: nothing is written afterwards.
        w.attachmentYields = 50
        w.attachmentAnswer = (200, "application/pdf", Data("%PDF-1.4 late".utf8))
        let late = Task { await c.fetchFile(Board.Attachment(id: "6666666666666666666666aa", name: "late.pdf", type: "application/pdf", size: 1,
                                                             kind: "pdf", url: "/api/attachment/6666666666666666666666aa", preview: nil)) }
        _ = await settle { w.attachmentStarted.last == "/api/attachment/6666666666666666666666aa" }
        c.accountChanged()
        let lateFile = await late.value
        check(lateFile == nil && !FileManager.default.fileExists(atPath: testFiles.appendingPathComponent("6666666666666666666666aa").path),
              "a file fetched across a sign-out is not written")
        w.attachmentYields = 0
        _ = await settle { isLive(c) }
        _ = await c.fetchFile(pdf)
        check(FileManager.default.fileExists(atPath: testFiles.path), "CONTROL: the opened file's folder exists")
        c.accountChanged()
        check(!FileManager.default.fileExists(atPath: testFiles.path) && c.thumbnails.isEmpty, "a sign-out removes opened files and pictures")
        c.stop()
    }
    do {
        // kosmos#7016 part 3: a page of earlier messages through the client, against the fake Mac.
        let (c, w, _, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        let first = await c.olderPage("dana", before: 1)
        if case .page(let rows, _, let older) = first {
            check(rows.map(\.text) == ["first"] && older == 0 && w.olderAsks.last == "before=1", "a page before position 1")
        } else { check(false, "a page before position 1") }
        w.olderAnswer = (200, #"{"messages":[],"olderCount":0}"#)
        let moved = await c.olderPage("dana", before: 5)
        check(moved == .moved, "an answer that is not the range asked for is the thread moving")
        w.olderAnswer = nil
        let silent = await c.olderPage("dana", before: 5)
        check(silent == .failed(Board.olderFailed), "no answer is a failure in the board's words")
        // A reset while a page is on its way: the page belongs to the chat before.
        w.olderAnswer = (200, #"{"messages":[{"at":"2026-10-20T10:00:00Z","text":"x","from":"dana"}],"olderCount":0}"#)
        w.onOlder = { MainActor.assumeIsolated { c.accountChanged() } }
        let across = await c.olderPage("dana", before: 1)
        check(across == nil, "a page that crossed a sign-out is dropped")
        c.stop()
    }
    do {
        // An agent that is not running: a failed send cannot be retried until it runs again (the spec, state 5).
        let (c, w, _, _) = make("kst1")
        w.statusDefault = (200, #"{"agents":[{"sessionName":"gus","name":"Gus","state":"stopped","running":false}]}"#)
        c.start()
        _ = await settle { isLive(c) }
        let gus = c.agents.first { $0.session == "gus" }!
        w.sendQueue = [(409, #"{"error":"Gus is not running"}"#)]
        await c.post("Hello", to: gus)
        let sent = w.posted.count
        await c.retry(c.pending["gus"]!.last!.id, to: gus)
        check(w.posted.count == sent && !c.isRunning(gus), "no retry while it is not running")
        w.statusDefault = (200, #"{"agents":[{"sessionName":"gus","name":"Gus","state":"idle"}]}"#)
        _ = await settle { c.isRunning(gus) }
        await c.retry(c.pending["gus"]!.last!.id, to: gus)
        check(w.posted.count == sent + 1, "and once it runs, a tap sends it again")
        c.stop()
    }
    do {
        // Not connected: a read is no answer and a send is not sent, never a crash or a silent drop.
        let (c, w, _, _) = make(nil)
        let dana = Board.Agent(session: "dana", name: "Dana", role: nil, state: "working", task: nil, needsYou: false)
        let noMacRead = await c.thread(for: "dana")
        check(noMacRead == .noAnswer, "no Mac, no conversation")
        await c.post("Hello", to: dana)
        check(c.pending["dana"]?.first?.state == .failed(reason: nil) && w.posted.isEmpty, "no Mac: shown as not sent, nothing posted")
        c.drafts["dana"] = "half a thought"
        check(c.drafts["dana"] == "half a thought", "a chat's unsent words are kept by the client")
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
    check(t.press(.tasks, page: .loading) == nil && t.pending == .tasks, "a page still loading: the press waits")
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
    let second = u.press(.tasks, page: .ready)!
    check(u.answered(serial: first.serial, .refused, pageURL: roomURL) == nil && u.pending == .tasks, "a late answer to an earlier press moves nothing and ends nothing")
    check(u.answered(serial: second.serial, .refused, pageURL: roomURL) == .projects && u.pending == nil, "the latest press's refusal ends it and moves the bar to the page's tab")

    var v = PressTracker()
    let shown = v.press(.tasks, page: .ready)!
    v.loadingOwnPage()
    check(v.pending == nil && v.answered(serial: shown.serial, .refused, pageURL: settingsURL) == nil, "an agent tap ends a press, and a late refusal of it cannot move the bar")
    _ = v.press(.projects, page: .loading)
    check(v.press(.agents, page: .ready) == nil && v.pending == nil, "the native tab ends a waiting press")
    _ = v.press(.projects, page: .loading)
    check(v.press(.settings, page: .ready) == nil && v.pending == nil, "#7010: the native Settings tab runs nothing and ends a waiting press too")
    let section = v.press(.settings, page: .ready, section: true)
    check(section?.script == AppTabs.pressScript(.settings) && v.pending == .settings, "#7010: the board's own Settings, pressed on purpose (the native screen's row), runs")
    check(v.answered(serial: section?.serial ?? -1, .opened, pageURL: nil) == .settings && AppTabs.barTab(forPage: .settings, tasksTab: true) == .today, "#7010: and the bar ends on Today, with the board's Settings showing")
    var cold = PressTracker()
    check(cold.press(.settings, page: .noView, section: true) == nil && cold.pending == .settings, "#7010: pressed on purpose with no page yet, it waits for the board (and replays as a section press)")
    check(cold.press(.settings, page: .loading, section: true) == nil && cold.pending == .settings, "#7010: and while a page loads (the board loaded over a Kosmos+ page)")
    var lockedOnSettings = PressTracker()
    lockedOnSettings.drop(selected: .settings)
    check(lockedOnSettings.pending == nil, "#7010: a lock on the native Settings tab replays nothing on the fresh page")

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
    check(AppTabs.barTab(forPage: .tasks, tasksTab: false) == .projects && AppTabs.barTab(forPage: .projects, tasksTab: false) == .projects, "a hidden Tasks section belongs under Projects; any other web section lights its own tab")
    check(AppTabs.barTab(forPage: .settings, tasksTab: true) == .today, "#7010: the board's Settings section shows under Today, since the Settings tab is native")
    check(f(home, URL(string: "https://mac.kosmosplus.com/?tab=settings")!, .settings) == nil, "#7010: native Settings is not moved by the hidden page")
    check(f(home, URL(string: "https://studio.kosmosplus.com/?tab=settings")!, .today) == nil, "#7010: a board link into its Settings (a chat's fix button) keeps the bar on Today, so the page shows")
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
check(PhoneNotice.attachmentExtension(contentType: "image/webp") == nil && PhoneNotice.attachmentExtension(contentType: nil) == nil, "a kind an attachment cannot show has no ending of its own")
// A 1x1 PNG, sent as if it were WebP: redrawn as a PNG iOS can attach. Not a picture at all: nothing.
let onePixel = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")!
let redrawn = PhoneNotice.attachable(onePixel, contentType: "image/webp")
check(redrawn?.1 == "png" && redrawn.map { CGImageSourceCreateWithData($0.0 as CFData, nil) != nil } == true, "a picture in a type iOS cannot attach is redrawn as a PNG")
check(PhoneNotice.attachable(Data("not a picture".utf8), contentType: "image/webp") == nil, "bytes that are not a picture: no attachment")
check(PhoneNotice.attachable(onePixel, contentType: "image/png")?.0 == onePixel, "a small PNG goes as it came")
// A large picture is drawn small, never decoded whole.
func pngOf(_ w: Int, _ h: Int) -> Data {
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let out = NSMutableData()
    let dest = CGImageDestinationCreateWithData(out, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
    _ = CGImageDestinationFinalize(dest)
    return out as Data
}
if let (big, ext) = PhoneNotice.attachable(pngOf(3000, 1500), contentType: "image/png"),
   let src = CGImageSourceCreateWithData(big as CFData, nil),
   let p = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] {
    check(ext == "png" && (p[kCGImagePropertyPixelWidth] as? Int) == PhoneNotice.pictureMaxPixels && (p[kCGImagePropertyPixelHeight] as? Int) == PhoneNotice.pictureMaxPixels / 2,
          "a 3000x1500 picture is drawn at 300x150")
} else { check(false, "a large picture gives a small one") }

section("phone notice: the shared keychain group, checked the same in the app and the extension")
for (group, ok) in [("6563JLN5HF.io.kosmos.app.shared", true), ("io.kosmos.app.shared", false), (".io.kosmos.app.shared", false), ("$(AppIdentifierPrefix)io.kosmos.app.shared", false), ("6563jln5hf.io.kosmos.app.shared", false), ("6563JLN5HF.", false), ("", false)] {
    check(PhoneNotice.hasTeamPrefix(group) == ok && (SessionKeychain.usableGroup(group) != nil) == ok, "\(group.isEmpty ? "(empty)" : group): \(ok ? "held" : "not held")")
}


// MARK: - kosmos#7042: native sign-in

section("sign-in: the device proof matches the coordinator's own WebCrypto vector (devkey.rs a_webcrypto_vector_verifies)")
do {
    let spki = SignIn.fromBase64url("MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEg3kVSogZ6EsxikmCEN0Ayo7wzD4OVBGegXurZ-XzpB-CWClbfd9GflpSkK5gkDfjipboV234X0qmNfDCEaIAkA")!
    let id = "k1.nIuw38MT55xf0l4wuLmgpkKs-q53DRza"
    let sig = SignIn.fromBase64url("dJAzYXFx8mds36DkO6aAsWf8ALONWju7lMcfFAKvqP1iQJZl3ZPclUez-Z5lRV4JOw8RLGjbAYymUc-_8fuLhQ")!
    check(SignIn.deviceID(spki: spki) == id, "the id is the one the coordinator derives from that key")
    if let key = try? P256.Signing.PublicKey(derRepresentation: spki),
       let signature = try? P256.Signing.ECDSASignature(rawRepresentation: sig) {
        check(key.isValidSignature(signature, for: SignIn.proofMessage(email: "Her@X.test", code: "482913", deviceID: id)),
              "the message bytes are the ones WebCrypto signed")
        check(!key.isValidSignature(signature, for: SignIn.proofMessage(email: "Her@X.test", code: "482914", deviceID: id)),
              "control: the same proof for another code does not verify")
        check(!key.isValidSignature(signature, for: SignIn.proofMessage(email: "her@x.test", code: "482913", deviceID: id)),
              "control: the email is signed exactly as sent (lowercased does not verify)")
    } else { check(false, "the vector's key and signature read") }
}

section("sign-in: a fresh key's proof verifies, raw r||s, and the body carries the key and id the coordinator checks")
do {
    let priv = P256.Signing.PrivateKey()
    let key = SignIn.DeviceKey.software(priv)
    check(key.id.hasPrefix("k1.") && key.id.count == 35, "a keyed id: k1. and 32 characters")
    if let body = try? SignIn.verifyBody(email: "Ada@Example.com", code: "123456", deviceName: "Ada's iPhone", key: key),
       let sigText = body["device_sig"] as? String, let sig = SignIn.fromBase64url(sigText),
       let keyText = body["device_key"] as? String {
        check(sig.count == 64, "the signature is 64 raw bytes, not DER")
        check(SignIn.fromBase64url(keyText) == key.spki && body["device_id"] as? String == key.id, "the key and id travel together")
        check(!sigText.contains("=") && !sigText.contains("+") && !sigText.contains("/"), "base64url with no padding")
        let s = try? P256.Signing.ECDSASignature(rawRepresentation: sig)
        check(s.map { priv.publicKey.isValidSignature($0, for: SignIn.proofMessage(email: "Ada@Example.com", code: "123456", deviceID: key.id)) } == true,
              "it verifies over the email as typed")
        check(body["email"] as? String == "Ada@Example.com" && body["code"] as? String == "123456", "the email and code go as signed")
    } else { check(false, "the verify body is built") }
    check(SignIn.startBody(email: "a@b.co", deviceID: key.id, deviceName: "n").count == 3, "start sends the email, the id and the name only")
}

section("sign-in: what was typed")
for (e, ok) in [("ada@example.com", true), ("  ada@example.com ", true), ("ada@example", false), ("ada example.com", false), ("@example.com", false), ("ada@@example.com", false), ("ada@.com", false), ("ada@example.", false), ("", false)] {
    check(SignIn.looksLikeEmail(e) == ok, "\(e.isEmpty ? "(empty)" : e): \(ok ? "an email" : "not an email")")
}
check(SignIn.code("482913") == "482913" && SignIn.code("482 913") == "482913", "six digits, a space between groups dropped")
check(SignIn.code("48291") == nil && SignIn.code("4829131") == nil && SignIn.code("48291a") == nil && SignIn.code("４８２９１３") == nil, "not six ASCII digits: refused")

section("sign-in: verify's four answers")
check(SignIn.answer(status: 200, json: jsonBody(#"{"token":"t1","device_status":"acked","match_code":"AB12","addresses":["x.kosmosplus.com"]}"#))
      == .signedIn(.init(token: "t1", deviceStatus: .acked, matchCode: "AB12", hasComputer: true)), "a session, already allowed")
check(SignIn.answer(status: 200, json: jsonBody(#"{"token":"t1","device_status":"weird","addresses":[]}"#))
      == .signedIn(.init(token: "t1", deviceStatus: .pending, matchCode: nil, hasComputer: false)), "an unknown status reads as still waiting, never allowed")
check(SignIn.answer(status: 200, json: jsonBody(#"{"second":"sms","challenge":"c1","sent_to":"+1 *** 0123"}"#))
      == .second(kind: "sms", challenge: "c1", sentTo: "+1 *** 0123"), "a second step")
check(SignIn.answer(status: 200, json: jsonBody(#"{"second":"totp"}"#)) == .unknown, "a second step with no challenge is not guessed at")
check(SignIn.answer(status: 200, json: jsonBody(#"{"enrol":true,"token":"enrol-only"}"#)) == .needsSetup, "an enrol-only token is never taken as a session")
check(SignIn.answer(status: 400, json: jsonBody(#"{"error":"That code is not right.","code":"bad_code"}"#)) == .refused(message: "That code is not right.", proofRefused: false), "a refusal keeps the coordinator's sentence")
check(SignIn.answer(status: 400, json: jsonBody(#"{"error":"x","code":"device_proof_refused"}"#)) == .refused(message: "x", proofRefused: true), "a refused proof is told apart")
check(SignIn.answer(status: 200, json: jsonBody(#"{}"#)) == .unknown && SignIn.answer(status: 500, json: nil) == .refused(message: nil, proofRefused: false), "no token, or no body")
check(SignIn.companySignInRequired(json: jsonBody(#"{"ok":true,"sso_required":true}"#)) && !SignIn.companySignInRequired(json: jsonBody(#"{"ok":true,"sso_url":"https://x"}"#)), "a company sign-in only when it is required")
check(SignIn.allowRead(status: 200, json: jsonBody(#"{"device_status":"acked"}"#)) == .status(.acked, matchCode: nil, hasComputer: false), "the Allow, from an answer that is ok")
check(SignIn.allowRead(status: 200, json: jsonBody(#"{"device_status":"pending","match_code":"K7Q2","addresses":["mini.kosmosplus.com"]}"#)) == .status(.pending, matchCode: "K7Q2", hasComputer: true), "a computer connected meanwhile, and its code")
check(SignIn.allowRead(status: 401, json: jsonBody(#"{"device_status":"acked"}"#)) == .ended, "a refused session ends the watch, whatever else the answer says")
check(SignIn.allowRead(status: 503, json: nil) == .unknown && SignIn.allowRead(status: nil, json: nil) == .unknown && SignIn.allowRead(status: 200, json: jsonBody(#"{"device_status":"new"}"#)) == .unknown, "no answer, a server error, or a status not known: asked again")

section("sign-in: the steps")
let s1 = SignIn.Session(token: "t", deviceStatus: .pending, matchCode: "AB12", hasComputer: true)
check(SignIn.next(after: .signedIn(s1), email: "e").step == .allow(matchCode: "AB12", hasComputer: true) && SignIn.next(after: .signedIn(s1), email: "e").session == s1, "pending: the session is handed over, and the Allow is waited for")
check(SignIn.next(after: .signedIn(.init(token: "t", deviceStatus: .denied, matchCode: nil, hasComputer: true)), email: "e").step == .denied(asking: true), "denied at sign-in: the Mac is asked again, so the screen still waits")
check(SignIn.next(after: .needsSetup, email: "e").step == .web(reason: SignIn.webForSetup) && SignIn.next(after: .needsSetup, email: "e").session == nil, "a second step to set up: the web page, no session")
check(SignIn.next(after: .refused(message: nil, proofRefused: false), email: "e").step == .code(email: "e"), "a wrong code stays on the code")
check(SignIn.next(after: .refused(message: nil, proofRefused: true), email: "e").step == .web(reason: SignIn.webForKey), "a refused key: the web page")
check(SignIn.secondWords(kind: "sms", sentTo: nil).contains("your phone") && SignIn.secondWords(kind: "totp", sentTo: nil).contains("authenticator"), "the second step's words, as the web page's")
check(SignIn.secondWords(kind: "sms", sentTo: "+1 *** *** 0123").contains("+1\u{00A0}***\u{00A0}***\u{00A0}0123"), "a masked number stays whole (no breaking space inside it)")
check(SignIn.wrappable(email: "ada@example.com") == "ada@\u{200B}example.\u{200B}com" && SignIn.wrappable(email: "ada@example.com").replacingOccurrences(of: "\u{200B}", with: "") == "ada@example.com", "an address breaks only after @ or a dot, and reads unchanged")
check(SignIn.webTitle(reason: SignIn.webForCompany) == "Your company signs you in" && !SignIn.webTitle(reason: SignIn.webForSetup).contains("-"), "the hand-over titles (none with a hyphen to break at)")

section("sign-in: the store script puts the token where the sign-in page keeps it, as a string, never as script")
do {
    let origin = "https://login.kosmosplus.com"
    func page(_ at: String) -> JSContext {
        let ctx = JSContext()!
        ctx.evaluateScript("var location = { origin: " + "'" + at + "'" + " }; var store = {}; var localStorage = { setItem: function (k, v) { store[k] = String(v); }, getItem: function (k) { return store.hasOwnProperty(k) ? store[k] : null; } };")
        return ctx
    }
    func run(_ ctx: JSContext, _ token: String) -> Bool? { ctx.evaluateScript("(function () { " + (SignIn.storeScript(token: token, origin: origin) ?? "") + " })()")?.toBool() }
    let evil = #"t"]; localStorage.setItem("x", "pwned"); var b = [" "#
    let ctx = page(origin)
    check(run(ctx, evil) == true && ctx.exception == nil, "it runs, and says the session is stored")
    check(ctx.evaluateScript("store['kosmos_session']")?.toString() == evil, "the token arrives exactly, under the page's own key")
    check(ctx.evaluateScript("Object.keys(store).join(',')")?.toString() == "kosmos_session", "nothing else is written: a quote in the token is not script")
    check(SignIn.pageSessionKey == "kosmos_session", "the key signin.html restore() reads (kosmos-relay, localStorage only)")
    check(run(ctx, evil) == false, "the same session again changes nothing (no reload, so no loop)")
    ctx.evaluateScript("store['kosmos_session'] = 'dead-token-from-before';")
    check(run(ctx, "fresh") == true && ctx.evaluateScript("store['kosmos_session']")?.toString() == "fresh", "a different session left on the page is replaced by the app's")
    check(SignIn.pageOrigin(coordinator) == origin && SignIn.pageOrigin(URL(string: "https://LOGIN.kosmosplus.com:443/x?y")!) == origin
          && SignIn.pageOrigin(URL(string: "https://login.kosmosplus.com:8443/")!) == "https://login.kosmosplus.com:8443",
          "the coordinator's origin is written as location.origin writes it (no slash, no default port)")
    let other = page("https://mac-mini.kosmosplus.com")
    check(run(other, "fresh") == false && other.evaluateScript("Object.keys(store).length")?.toInt32() == 0, "on another origin nothing is written")
}

await boardLoopTests()

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
