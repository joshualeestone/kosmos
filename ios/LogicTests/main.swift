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

// kosmos#7197 (Josh, 10-26, with two Macs): the Mac that is not answering is named.
check(Shell.macName(fromHost: "10102026.kosmosplus.com") == "10102026", "a Mac's name is its address label")
check(Shell.macName(fromHost: nil) == nil && Shell.macName(fromHost: "") == nil, "no host, no name")
check(Shell.macUnreachableTitle("10102026") == "10102026 isn't answering", "the title names the Mac")
check(Shell.macUnreachableMessage("tmnt").contains("the Mac called tmnt didn't reply"), "the message names the Mac")
check(Shell.macUnreachableTitle(nil) == "Your Mac isn't answering" && Shell.macUnreachableTitle("  ") == "Your Mac isn't answering",
      "CONTROL: no name keeps the old wording")
check(Shell.macUnreachableMessage(nil) == "Your phone is online, but your Mac didn't reply. It may be asleep or turned off. Wake it, then try again.",
      "CONTROL: the unnamed message is the old one, word for word")
check(Shell.notUpdatingLine("tmnt") == "Not updating. tmnt isn't answering." && Shell.notUpdatingLine(nil) == "Not updating. Your Mac isn't answering.",
      "the banner over a list names the Mac, and keeps the old words with no name")
check(BoardClient.Phase.unreachable(mac: "10102026").macName == "10102026" && BoardClient.Phase.live(mac: Board.Mac(name: "tmnt", address: "tmnt.kosmosplus.com", usable: true)).macName == "tmnt"
      && BoardClient.Phase.starting.macName == nil, "a phase names its Mac, or none")
check(Board.sessionRequest(mac: URL(string: "https://studio.kosmosplus.com")!, handoffToken: "t").timeoutInterval == 8, "a session request waits 8 s, so three tries take about 30 s")
// Review 3: a shown list and its chat belong to their Mac, even after the app moved on to the account's other one.
check(Board.failingMacName(shown: "tmnt", phase: "10102026") == "tmnt", "the shown Mac is named, not the one the app moved on to")
check(Board.failingMacName(shown: nil, phase: "10102026") == "10102026" && Board.failingMacName(shown: "", phase: "10102026") == "10102026",
      "with nothing shown, the phase's Mac")
check(Board.failingMacName(shown: nil, phase: nil) == nil, "neither: no name (the old words)")
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
    // kosmos#7266: the switcher's choice wins while usable, connected or not, and never a Mac that cannot be opened.
    check(Board.pickMac(r, remembered: "mini.kosmosplus.com", chosen: "old.kosmosplus.com")?.address == "old.kosmosplus.com", "a chosen Mac wins even when it is not connected (its own screen says so)")
    check(Board.pickMac(Board.parseMacs(Data(refused.utf8)) ?? [], remembered: nil, chosen: "new.kosmosplus.com")?.address == "new.kosmosplus.com", "a chosen Mac wins even when it refused this iPhone (the person asked for it)")
    check(Board.pickMac(macs, remembered: nil, chosen: "old.kosmosplus.com")?.address == "laptop.kosmosplus.com", "a chosen Mac that was retired is not opened")
    check(Board.pickMac(r, remembered: nil, chosen: "gone.kosmosplus.com")?.address == "studio.kosmosplus.com", "a chosen Mac no longer listed falls back to the usual pick")
    let rows = Board.switcherRows(macs + r, shown: "mini.kosmosplus.com")
    check(rows.map(\.name) == ["laptop.kosmosplus.com", "Mini", "Old laptop", "Studio", "Studio"], "the switcher lists the usable Macs by name, retired and switched-off ones left out")
    let twins = [Board.Mac(name: "Mac", address: "b.kosmosplus.com", usable: true), Board.Mac(name: "Mac", address: "a.kosmosplus.com", usable: true)]
    check(Board.switcherRows(twins, shown: nil).map(\.address) == ["a.kosmosplus.com", "b.kosmosplus.com"], "two of one name keep the order of their addresses")
    check(rows.filter(\.shown).map(\.address) == ["mini.kosmosplus.com"], "only the shown Mac is checked")
    check(rows.first(where: { $0.name == "Old laptop" })?.status == "Offline" && rows.first(where: { $0.name == "Mini" })?.status == "Online", "each row says online or offline from not_connected")
    check(Board.switcherRows(heldRefused, shown: nil).isEmpty, "a held or refused Mac is not offered")
    // kosmos#7266 slice B: the person's name and picture.
    let mac0 = URL(string: "https://studio.kosmosplus.com/")!
    check(Board.youRequest(mac: mac0).url?.path == "/api/you" && Board.youPictureRequest(mac: mac0).url?.path == "/api/you/avatar", "the person's record and picture are the board's own routes")
    check(Board.parseYouName(Data(#"{"state":"saved","you":{"name":"  Sam Carter ","does":"x"}}"#.utf8)) == "Sam Carter", "a saved name, trimmed")
    check(Board.parseYouName(Data(#"{"state":"absent","you":null}"#.utf8)) == nil && Board.parseYouName(Data(#"{"state":"saved","you":{"name":"   "}}"#.utf8)) == nil, "no name when none is saved, or it is blank")
    check(Board.parseYouName(Data(#"{"state":"unknown","you":{"name":"Old"}}"#.utf8)) == nil && Board.parseYouName(Data("<html>".utf8)) == nil, "nor from an unreadable record or a page")
    // Mona Lisa's review: no picture shows the person's letter, as an agent with none; never a letter for no name.
    check(Board.youLetter("Sam Carter") == "S" && Board.youLetter("  sam ") == "S", "the name's first letter, upper-cased, spaces ignored")
    check(Board.youLetter(nil) == nil && Board.youLetter("   ") == nil, "no letter while the name is not known (the gear shows then)")
    check(Board.youLetter("élodie") == "É" && Board.youLetter("李明") == "李", "a first letter outside A to Z is kept whole")
    // Review 1: only "no record" or a saved blank name clears the name; anything that is not the record keeps it.
    check(Board.youName(Data(#"{"state":"saved","you":{"name":"Sam"}}"#.utf8)) == .name("Sam"), "a saved name")
    check(Board.youName(Data(#"{"state":"absent","you":null}"#.utf8)) == .none && Board.youName(Data(#"{"state":"saved","you":{"name":" "}}"#.utf8)) == .none, "absent or blank: no name")
    check(Board.youName(Data("<html>sign in</html>".utf8)) == .unknown && Board.youName(Data(#"{"state":"unknown","you":null}"#.utf8)) == .unknown, "the gate's page or an unreadable record learns nothing")
    let png = Data([0x89, 0x50, 0x4e, 0x47])
    check(Board.youPicture(status: 200, contentType: "image/png", data: png) == .picture(png), "a picture")
    check(Board.youPicture(status: 204, contentType: nil, data: Data()) == .none && Board.youPicture(status: 404, contentType: "text/plain", data: Data("x".utf8)) == .none, "204 (none yet) and an older board's 404 are no picture")
    check(Board.youPicture(status: 200, contentType: "text/html", data: Data("<html>".utf8)) == .unknown, "the gate's sign-in page at 200 is not a picture, and does not clear one")
    check(Board.youPicture(status: 500, contentType: nil, data: nil) == .unknown && Board.youPicture(status: nil, contentType: nil, data: nil) == .unknown, "a 5xx or no answer learns nothing")
    check(Board.switcherRows([Board.Mac(name: "b", address: "b.kosmosplus.com", usable: true), Board.Mac(name: "A", address: "a.kosmosplus.com", usable: true)], shown: nil).map(\.name) == ["A", "b"], "by name, whatever its case")
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
    // #7034: the person's starred agents first, each group still longest waiting first.
    let starred = Board.today(agents: agents, tasks: [], stars: ["bo", "cleo", "wes"])
    check(starred.needsYou.map(\.session) == ["cleo", "bo", "ada", "abe", "old"], "needs you: starred first, each group in its own order")
    check(starred.working.map(\.session) == ["una", "wes"], "working now is not reordered by stars")
    check(Board.today(agents: agents, tasks: [], stars: nil).needsYou.map(\.session) == m.needsYou.map(\.session), "no stars known: the same order")

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

section("Today: when the held order is taken (kosmos#7034)")
do {
    var o = Board.TodayOrder()
    o.updated(["a", "b"])
    check(o.sessions == ["a", "b"], "an empty order is taken at the first list")
    o.updated(["b", "a"])
    check(o.sessions == ["a", "b"], "a live update never moves a card under the thumb")
    o.resorted(["b", "a"])
    check(o.sessions == ["b", "a"], "a re-sort re-takes the order with the stars it read, even when one is held")
    o.pullStarted()
    o.updated(["a", "b"])
    check(o.sessions.isEmpty, "during a pull a live read landing (old stars) takes no order")
    o.resorted(["a", "b"])
    o.pullEnded(["b", "a"])
    check(o.sessions == ["a", "b"], "the pull's own re-sort decides it, not the state when the pull ends")
    o.pullStarted()
    o.pullEnded(["b", "a"])
    check(o.sessions == ["b", "a"] && !o.pulling, "a pull that re-sorted nothing settles the order when it ends")
    o.resorted(["a", "b"])
    check(o.sessions == ["a", "b"], "and the reconnect's re-sort after it still re-takes it")
    o.updated(["b", "a"])
    check(o.sessions == ["a", "b"], "CONTROL: after the pull a live update keeps the order again")
    o.clear()
    o.updated([])
    check(o.sessions.isEmpty, "nothing needing you leaves the order empty")
    o.updated(["b"])
    check(o.sessions == ["b"], "so the first card to arrive later is taken")

    let agent = { (s: String) in Board.Agent(session: s, name: s, role: nil, state: "needs_you", task: nil, needsYou: true) }
    let m = Board.TodayModel(needsYou: ["c", "a", "b", "d"].map(agent), ready: nil, working: [])
    var held = Board.TodayOrder()
    check(held.apply(m) == m, "no held order: the model's own")
    held.resorted(["b", "a"])
    check(held.apply(m).needsYou.map(\.session) == ["b", "a", "c", "d"], "held cards keep their places; new ones follow in the model's order")
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
    let json = #"{"messages":[{"at":"2026-10-23T13:32:00Z","text":"Morning","from":null,"delivery":{"state":"placed"}},{"at":"2026-10-23T13:33:00Z","text":"Hi","from":"dana"},{"at":"2026-10-23T13:33:00Z","text":"And again","from":"dana"},{"at":"2026-10-23T13:40:00Z","text":"Paused","from":null,"kind":"kosmos"},{"at":"2026-10-23T13:41:00Z","text":"Tue or Wed?","from":"dana","kind":"question","id":"q1"},{"at":"2026-10-23T13:42:00Z","text":"May I run it?","from":"dana","kind":"question","permission":{"title":"x"}},{"at":"2026-10-23T13:43:00Z","text":"File","from":"dana","attachments":[{"id":"a"}]},{"at":"2026-10-23T13:44:00Z","text":"Lost","from":null,"delivery":{"state":"could_not","retryable":true}},{"at":"2026-10-23T13:45:00Z","text":"Later","from":null,"delivery":{"state":"held"}},{"at":"2026-10-23T13:46:00Z","text":"Maybe","from":null,"delivery":{"state":"unconfirmed"}},{"from":"dana"}],"olderCount":12}"#
    let t = Board.parseThread(Data(json.utf8))
    let rows = t?.rows ?? []
    check(rows.count == 10, "a row with no text is dropped")
    check(rows[0].who == .person && rows[1].who == .agent && rows[3].who == .kosmos, "no from is the person's, a from is the agent's, kind kosmos is Kosmos's own")
    check(rows[1].id != rows[2].id && Set(rows.map(\.id)).count == rows.count, "two rows at the same time keep different ids")
    check(rows[4].id.hasPrefix("id|q1"), "the Mac's own id is used where it gives one")
    check(rows[0].atRaw == "2026-10-23T13:32:00Z", "the Mac's own time is kept as sent, to match a sent message to its row")
    check(rows[4].wayThrough == .question && rows[5].wayThrough == .permission && rows[6].wayThrough == .attachment && rows[1].wayThrough == nil,
          "a question, a permission card and a file each get their way-through row")
    check(rows[0].notSent == nil && rows[7].notSent == "Message failed to deliver" && rows[8].notSent == "Waiting to send" && rows[9].notSent == "Not confirmed",
          "placed reached the agent; could_not (the board's failed line, #7136), held and unconfirmed (it may have arrived) say which")
    check(rows[7].canSendAgain && !rows[8].canSendAgain && !rows[0].canSendAgain,
          "only a message the Mac could not deliver can be sent again; one it holds goes by itself")
    check(!rows[9].canSendAgain, "one not confirmed is not offered again: it may have arrived, and a second copy would duplicate it")
    // Not every could_not is a plain message to send again: a copy the Mac already marked as one, and a menu answer.
    let odd = Board.parseThread(Data(#"{"messages":[{"at":"T1","text":"Hello","from":null,"delivery":{"state":"could_not","duplicateOf":"T0","because":"the same message was already kept above"}},{"at":"T2","text":"Yes, and don't ask again","wire":"2","from":null,"delivery":{"state":"could_not"}},{"at":"T3","text":"Plain","from":null,"delivery":{"state":"could_not","because":"Dana is not running","retryable":true}}]}"#.utf8))?.rows ?? []
    check(!odd[0].canSendAgain && !odd[1].canSendAgain && odd[2].canSendAgain, "a duplicate and a menu answer are not sent again; a plain one is")
    check(odd[0].notSent == "Not sent", "a copy the Mac kept as one keeps its own word, not the failed line (#6774, as the board)")
    check(odd[0].because == "the same message was already kept above" && odd[2].because == "Dana is not running", "the Mac's own reason is kept, to show as the board shows it")
    check(t?.olderCount == 12, "older messages are counted")
    check(Board.parseThread(Data("{}".utf8)) == nil && Board.parseThread(Data("not json".utf8)) == nil, "an answer that is not a conversation is nil")
    let empty = Board.parseThread(Data(#"{"messages":[]}"#.utf8))
    check(empty?.rows.isEmpty == true && empty?.olderCount == 0, "an empty conversation is one, not a failure")

    // kosmos#7136: the board's failed line and Try again (web/index.html dmFailedLine, dmRetrySend).
    do {
        let rowsJSON = #"{"messages":[{"at":"A1","text":"Plain","from":null,"delivery":{"state":"could_not","because":"dana is not running","retryable":true}},{"at":"A2","text":"Old","from":null,"delivery":{"state":"could_not"}},{"at":"A3","text":"Going","from":null,"delivery":{"state":"unconfirmed","retrying":true,"retryable":true}},{"at":"A4","text":"Copy","from":null,"delivery":{"state":"could_not","duplicateOf":"A1","retryable":true}},{"at":"A5","text":"Yes","wire":"1","from":null,"delivery":{"state":"could_not","retryable":true}}]}"#
        let r = Board.parseThread(Data(rowsJSON.utf8))?.rows ?? []
        check(r.count == 5 && r[0].retryable && !r[1].retryable && r[2].retrying && !r[0].retrying, "retryable and retrying are read from the Mac's delivery")
        check(Board.newestMineAt(r) == "A5", "the person's newest message is the last of theirs in the thread")
        check(Board.newestMineAt(r + [Board.ChatRow(id: "k", atRaw: "A6", at: nil, text: "Paused", who: .kosmos)]) == "A5",
              "a Kosmos line is not the person's (the board's DM_NEWEST_MINE_AT skips kind kosmos, questions and from)")
        let newest = Board.failedLine(r[0], newestMineAt: "A1", flying: false)
        check(newest == Board.FailedLine(button: "try again", canRetry: true, because: "Dana is not running."),
              "a retryable plain message that is the newest: try again, the reason as a sentence")
        check(newest?.text == "Message failed to deliver, try again.", "and the line reads as the board's")
        let behind = Board.failedLine(r[0], newestMineAt: "A9", flying: false)
        check(behind == Board.FailedLine(button: nil, canRetry: false, because: "Dana is not running.") && behind?.text == "Message failed to deliver.",
              "behind a newer message of the person's: no try again, and the line ends at deliver")
        check(Board.failedLine(r[1], newestMineAt: "A2", flying: false)?.canRetry == false, "not marked retryable by the Mac: no try again")
        check(Board.failedLine(r[1], newestMineAt: "A2", flying: false)?.because == "We could not reach them.", "no reason from the Mac: the board's own words")
        var reply = r[0]; reply.replyTo = "Z"
        var files = r[0]
        files.attachments = [Board.Attachment(id: "f", name: "f.txt", type: "text/plain", size: 1, kind: "file", url: "/api/attachment/f", preview: nil)]
        check(Board.failedLine(reply, newestMineAt: "A1", flying: false)?.canRetry == false
              && Board.failedLine(files, newestMineAt: "A1", flying: false)?.canRetry == false,
              "a reply or a message with files: no try again")
        check(Board.failedLine(r[4], newestMineAt: "A5", flying: false)?.canRetry == false, "a menu answer (wire): no try again")
        check(Board.failedLine(r[3], newestMineAt: "A4", flying: false) == nil, "a copy the Mac kept as one gets no failed line")
        check(Board.failedLine(r[0], newestMineAt: "A1", flying: true) == Board.FailedLine(button: "sending\u{2026}", canRetry: false, because: "Dana is not running."),
              "while this phone sends it again: sending…, not pressable")
        check(Board.failedLine(r[2], newestMineAt: "A3", flying: true)?.button == "sending\u{2026}" && Board.failedLine(r[2], newestMineAt: "A3", flying: false) == nil,
              "a row being sent again shows sending… only while this phone is the one sending it")
        let agentRow = Board.ChatRow(id: "g", atRaw: "A7", at: nil, text: "hi", who: .agent, notSent: Board.failedWords, resendable: true, retryable: true)
        check(Board.failedLine(agentRow, newestMineAt: nil, flying: false) == nil, "only the person's own messages")
        let mac = URL(string: "https://mac.example")!
        let req = Board.retryRequest(mac: mac, session: "dana", text: " Plain ", retryOf: "A1")
        let body = req?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        check(req?.httpMethod == "POST" && req?.url?.absoluteString == "https://mac.example/api/agent/dana/thread"
              && body?["text"] as? String == " Plain " && body?["retry_of"] as? String == "A1" && body?.count == 2,
              "Try again posts {text, retry_of} to the thread, the words exactly as the row holds them")
        check(Board.retryRequest(mac: mac, session: "dana", text: "x", retryOf: "") == nil && Board.retryRequest(mac: mac, session: "../x", text: "x", retryOf: "A1") == nil,
              "no row named, or a name the app does not accept: no request")
        check(Board.retryResult(status: 200, body: Data(#"{"delivery":{"state":"placed"}}"#.utf8)) == Board.RetrySaid(said: "Sent.", refused: false)
              && Board.retryResult(status: 200, body: Data(#"{"delivery":{"state":"unconfirmed"}}"#.utf8)).said == "We could not confirm it went. Check its window before sending it again."
              && Board.retryResult(status: 200, body: Data(#"{"delivery":{"state":"could_not"}}"#.utf8)) == Board.RetrySaid(said: "Message failed to deliver.", refused: false),
              "placed, unconfirmed and failed again are said as the board says them")
        check(Board.retryResult(status: 400, body: Data(#"{"error":"that message cannot be sent again"}"#.utf8)) == Board.RetrySaid(said: "That message cannot be sent again.", refused: true)
              && Board.retryResult(status: 503, body: nil) == Board.RetrySaid(said: "We could not send it again.", refused: true)
              && Board.retryResult(status: 0, body: nil) == Board.RetrySaid(said: Board.retryNoAnswer, refused: true),
              "a refusal says the Mac's words; no words, the board's; no answer, the board's no-answer line")
    }

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
    // kosmos#7265 (Josh 10-27): an open chat keeps the rows a read slides out of the latest window (carryDropped), and its
    // eager stack starts where it started at opening (eagerStart), so nothing above the reader moves.
    do {
        func rows(_ ids: ClosedRange<Int>) -> [Board.ChatRow] { ids.map { r("m\($0)", nil) } }
        let before = Board.Thread(rows: rows(10...14), olderCount: 10)   // m10..m14 at positions 10..14
        let slid = Board.Thread(rows: rows(12...16), olderCount: 12)     // two new messages pushed m10, m11 out
        let kept = Board.carryDropped(Board.Earlier(), previous: before, fresh: slid)
        check(kept.open && kept.rows.map(\.id) == ["m10", "m11"] && kept.before == 10 && kept.end == 12,
              "kosmos#7265: rows a read slid out are kept above the window (\(kept.rows.map(\.id)), \(kept.before)..<\(kept.end))")
        check(Board.shownRows(kept, thread: slid).map(\.id) == (10...16).map { "m\($0)" }, "and the chat still shows every row it showed, in order")
        check(!Board.hasGap(end: kept.end, olderCount: slid.olderCount), "with no gap left for a page to fetch")
        // Open already (a page loaded up to the window): only the new part is added, never a duplicate.
        var open = Board.Earlier(); open.open = true; open.rows = rows(5...9); open.before = 5; open.end = 10
        let more = Board.carryDropped(open, previous: before, fresh: slid)
        check(more.rows.map(\.id) == (5...11).map { "m\($0)" } && more.end == 12, "an open chat appends only what left: \(more.rows.map(\.id))")
        // CONTROLS: reads that do not overlap by id, a window that did not slide, and a page in flight change nothing.
        let other = Board.Thread(rows: [r("x1", nil), r("x2", nil)], olderCount: 12)
        check(Board.carryDropped(Board.Earlier(), previous: before, fresh: other) == Board.Earlier(), "CONTROL: reads that do not overlap carry nothing")
        check(Board.carryDropped(Board.Earlier(), previous: before, fresh: before) == Board.Earlier(), "CONTROL: an unchanged window carries nothing")
        var loading = Board.Earlier(); loading.loading = true
        check(Board.carryDropped(loading, previous: before, fresh: slid) == loading, "CONTROL: nothing is carried while a page is loading")
        check(Board.carryDropped(Board.Earlier(), previous: nil, fresh: slid) == Board.Earlier(), "CONTROL: nothing before the first read")
        // The eager stack keeps its first row as messages arrive: no row moves back to the lazy rows above the reader.
        let items = Board.chatItems(rows(1...50), now: Date(), calendar: .current)
        let from = items[Board.eagerStart(items, from: nil, eager: 40)].id
        let grown = Board.chatItems(rows(1...53), now: Date(), calendar: .current)
        check(grown[Board.eagerStart(grown, from: from, eager: 40)].id == from, "kosmos#7265: new messages leave the eager stack's first row where it was")
        check(grown[Board.eagerStart(grown, from: nil, eager: 40)].id != from, "CONTROL: without the kept start the boundary moves with each new message")
        check(Board.eagerStart(grown, from: "gone", eager: 40) == grown.count - 40, "a start no longer shown falls back to the last 40")
    }
    // kosmos#7346 review: with no send arrow, a Send that cannot go says why; nothing to send says nothing.
    do {
        let long = String(repeating: "word ", count: 2500)
        check(Board.dmSendBlocked(said: long, files: 0, uploading: 0, dictating: false, finishing: false) == Board.tooLongLine, "kosmos#7346: a message over the board's limit says it is too long")
        check(Board.dmSendBlocked(said: "hi", files: 0, uploading: 0, dictating: false, finishing: false) == nil, "CONTROL: a message that can go has no reason")
        check(Board.dmSendBlocked(said: "  ", files: 0, uploading: 0, dictating: false, finishing: false) == nil, "an empty box says nothing")
        check(Board.dmSendBlocked(said: "hi", files: 0, uploading: 0, dictating: true, finishing: false) == Board.sendStopDictating, "dictating says stop first")
        check(Board.dmSendBlocked(said: "a.png", files: 1, uploading: 1, dictating: false, finishing: false) == Board.stillAddingLine, "a file on its way says so")
        check(Board.dmSendBlocked(said: "hi", files: 0, uploading: 1, dictating: false, finishing: false) == nil, "CONTROL: words alone go while another upload runs (no file of theirs waits)")
        check(Board.roomPostBlocked(words: "@ann ", mentionOnly: true, read: true, files: 0, uploading: 0, dictating: false, finishing: false) == Board.roomOnlyMentionLine, "a room post of only the @name asks for words")
        check(Board.roomPostBlocked(words: "hello", mentionOnly: false, read: false, files: 0, uploading: 0, dictating: false, finishing: false) == Board.roomNotReadLine, "a room not read yet says it is loading")
        check(Board.roomPostBlocked(words: "hello", mentionOnly: false, read: true, files: Board.maxFiles + 1, uploading: 0, dictating: false, finishing: false) != nil, "too many files says so")
        check(Board.roomPostBlocked(words: "hello", mentionOnly: false, read: true, files: 1, uploading: 0, dictating: false, finishing: false) == nil, "CONTROL: a room post that can go has no reason")
        check(Board.roomPostBlocked(words: "", mentionOnly: false, read: false, files: 0, uploading: 0, dictating: false, finishing: false) == nil, "an empty room box says nothing")
        check(Board.dmSendBlocked(said: long, files: 1, uploading: 1, dictating: true, finishing: true) == Board.sendWaitWords, "the last words landing comes first, before every other reason")
        check(Board.roomPostBlocked(words: "hi", mentionOnly: true, read: false, files: 1, uploading: 1, dictating: true, finishing: true) == Board.sendWaitWords, "and in a room")
        check(Board.roomPostBlocked(words: "hi", mentionOnly: true, read: false, files: 1, uploading: 1, dictating: true, finishing: false) == Board.sendStopDictating, "then dictating")
    }
    // kosmos#7348 (Josh 10-27): the sent text filling back into the box just after a send is caught; anything else is not.
    do {
        let t0 = Date(timeIntervalSince1970: 1_000_000)
        let sent = "Let's add a little margin inside the bubbles"
        check(Board.refilledWithSent(sent, was: "", sent: sent, sentAt: t0, now: t0.addingTimeInterval(1)), "kosmos#7348: the sent text back in the box a second later is caught")
        check(Board.refilledWithSent(sent + " ", was: "", sent: sent, sentAt: t0, now: t0.addingTimeInterval(4)), "and with a trailing space, as dictation leaves it")
        check(!Board.refilledWithSent(sent, was: "", sent: sent, sentAt: t0, now: t0.addingTimeInterval(6)), "CONTROL: after the window it is the person typing it again")
        check(!Board.refilledWithSent("Let's add a little", was: "", sent: sent, sentAt: t0, now: t0.addingTimeInterval(1)), "CONTROL: different words are the person's")
        check(!Board.refilledWithSent("", was: "", sent: sent, sentAt: t0, now: t0.addingTimeInterval(1)), "CONTROL: an empty box is not a refill")
        check(!Board.refilledWithSent(sent, was: "", sent: nil, sentAt: nil, now: t0), "CONTROL: nothing sent, nothing to catch")
        // Review: typing a longer word that begins with the sent text passes through it one letter at a time.
        check(!Board.refilledWithSent("ok", was: "o", sent: "ok", sentAt: t0, now: t0.addingTimeInterval(1)), "kosmos#7348 review: typing through the sent text is not a refill")
        check(Board.refilledWithSent("ok", was: "", sent: "ok", sentAt: t0, now: t0.addingTimeInterval(1)), "CONTROL: the same text from an empty box in one change is")
    }
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
    check(res(200, #"{"delivery":{"state":"could_not","at":"T3","because":"x"},"recorded":true}"#) == .keptUndelivered(at: "T3", note: "Message failed to deliver")
          && res(200, #"{"delivery":{"state":"could_not","at":"T4","duplicateOf":"T1"},"recorded":true}"#) == .keptUndelivered(at: "T4", note: "Not sent"),
          "could_not is kept, undelivered: never shown as sent; its row says the board's failed words (a kept copy, Not sent), as the row will once read")
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

section("native chat: replying and reacting (kosmos#7083)")
do {
    let mac = URL(string: "https://studio.kosmosplus.com")!
    let json = #"{"messages":[{"at":"2026-10-24T10:00:00.000Z","text":"Here are pages 1 to 8.","from":"dana","reactions":[{"emoji":"\#u{1F44D}","count":1,"who":["you"],"mine":true}]},{"at":"2026-10-24T10:01:00.000Z","text":"Thanks, the captions next?","from":null,"replyTo":"2026-10-24T10:00:00.000Z","delivery":{"state":"placed"}},{"at":"2026-10-24T10:02:00.000Z","text":"On it","from":"dana","replyTo":"2026-10-20T09:00:00.000Z"},{"at":"2026-10-24T10:03:00.000Z","text":"ok","from":null,"replyTo":"2026-10-24T10:00:30.000Z"}],"olderCount":4}"#
    let rows = Board.parseThread(Data(json.utf8))?.rows ?? []
    check(rows.count == 4, "premise: four rows")
    check(rows[0].reactions == [Board.ChatReaction(emoji: "\u{1F44D}", count: 1, mine: true)] && rows[1].replyTo == "2026-10-24T10:00:00.000Z",
          "a row carries its reaction pills and the `at` of what it answers")
    check(Board.replyHead(to: rows[1].replyTo, in: rows, agentName: "Dana", olderLeft: 4) == .answers(who: "Dana", gist: "Here are pages 1 to 8."),
          "a reply names who and what it answers")
    check(Board.replyHead(to: rows[2].replyTo, in: rows, agentName: "Dana", olderLeft: 4) == .furtherBack,
          "an original older than the oldest row, with older messages left out: further back")
    check(Board.replyHead(to: rows[3].replyTo, in: rows, agentName: "Dana", olderLeft: 4) == .unavailable,
          "an original that should be here but is not: unavailable")
    check(Board.replyHead(to: rows[2].replyTo, in: rows, agentName: "Dana", olderLeft: 0) == .unavailable, "nothing older left out: unavailable, never further back")
    check(Board.replyHead(to: rows[0].replyTo, in: rows, agentName: "Dana", olderLeft: 4) == nil, "a message that answers nothing has no header")
    check(Board.repliesUnderOriginal(rows) == [rows[1].id], "a reply right under what it answers has its header left out; others keep theirs")
    var chained = rows
    var second = Board.ChatRow(id: "second", atRaw: "2026-10-24T10:01:30.000Z", at: nil, text: "and the cover", who: .person)
    second.replyTo = "2026-10-24T10:00:00.000Z"
    chained.insert(second, at: 2)
    check(Board.repliesUnderOriginal(chained) == [rows[1].id, "second"], "a second reply to the same message, right under the first, is left out too (the chain)")
    let filesOnly = Board.ChatRow(id: "f", atRaw: "T", at: nil, text: "deck.pdf", who: .agent,
                                  attachments: [Board.Attachment(id: "0123456789abcdef01234567", name: "deck.pdf", type: "application/pdf", size: 1, kind: "pdf", url: "/api/attachment/0123456789abcdef01234567", preview: nil)])
    check(Board.replyGist(filesOnly) == "deck.pdf" && Board.replyGist(Board.ChatRow(id: "e", atRaw: "T", at: nil, text: "  ", who: .agent)) == "a message"
          && Board.replyGist(Board.ChatRow(id: "w", atRaw: "T", at: nil, text: "\n  two\nlines", who: .agent)) == "two",
          "the gist: the first line with words, else the file's name, else a message (pjReplyWords)")
    check(Board.replyWords(String(repeating: "a", count: 90)) == String(repeating: "a", count: 80) + "\u{2026}" && Board.replyWords("ok") == "ok", "cut to 80 with an ellipsis")
    check(Board.replyWords("e\u{301}\u{301}\u{301}\u{301}x") == "e\u{301}\u{301}x", "at most two marks on a letter")
    check(Board.dropSelfName("Dana: here it is", names: ["Dana", "dana"]) == "here it is" && Board.dropSelfName("**Dana**: hi", names: ["Dana"]) == "hi"
          && Board.dropSelfName("Dana - hi", names: ["Dana"]) == "hi", "the agent's own leading name is dropped (colon, bold, dash)")
    check(Board.dropSelfName("Dana-style copy", names: ["Dana"]) == "Dana-style copy" && Board.dropSelfName("dana: x", names: ["Dana"]) == "dana: x"
          && Board.dropSelfName("Dana:", names: ["Dana"]) == "Dana:" && Board.dropSelfName("Dana:/x", names: ["Dana"]) == "Dana:/x",
          "kept when it is part of a word, another case, the whole message, or a colon before a slash")
    check(Board.replyGist(Board.ChatRow(id: "n", atRaw: "T", at: nil, text: "Dana: pages are in", who: .agent), agentName: "Dana", session: "dana") == "pages are in",
          "a gist drops the agent's own name, which the header says beside it")
    // Parity edges (review 2): code points, not characters; CRLF and the BOM trimmed; inner colon and __ forms; longest first.
    let flags = String(repeating: "a", count: 79) + "\u{1F1FA}\u{1F1F8}" + "bbb"
    check(Board.replyWords(flags) == String(repeating: "a", count: 79) + "\u{1F1FA}" + "\u{2026}", "the cut is by code point (a flag can be split, as the board's Array.from)")
    check(Board.replyWords("\r\n\u{FEFF}  \r\nhello\r\nworld") == "hello", "a CRLF or a byte-order mark line is blank, as JavaScript's trim reads it")
    check(Board.dropSelfName("**Dana:** hi", names: ["Dana"]) == "hi" && Board.dropSelfName("__Dana__: hi", names: ["Dana"]) == "hi",
          "the bold forms with the colon inside or after")
    check(Board.dropSelfName("Dana Claude: hi", names: ["Dana", "Dana Claude"]) == "hi", "the longest name first")
    check(Board.dropSelfName("Dana:\u{663}", names: ["Dana"]) == "\u{663}", "a colon before a non-ASCII digit is still a name's colon (JavaScript's \\d is ASCII)")
    let fromOther = Board.parseThread(Data(#"{"messages":[{"at":"T1","text":"hi","from":"dana"},{"at":"T2","text":"from elsewhere","from":"cleo"},{"at":"T3","text":"Tue or Wed?","from":"dana","kind":"question"},{"at":"T4","text":"me","from":null}]}"#.utf8))?.rows ?? []
    check(fromOther.count == 4 && fromOther[0].answerable(by: "dana") && !fromOther[1].answerable(by: "dana") && !fromOther[2].answerable(by: "dana")
          && !fromOther[3].answerable(by: "dana"),
          "Reply and reactions only on this agent's own messages: not another sender's, not a question, not the person's")
    check(Board.replyRefusedForGood("That message is no longer in this conversation. Press \u{00D7} to send this as a new message.")
          && Board.replyRefusedForGood("This conversation is not kept on this computer, so there is no message to reply to. Send it as a new message.")
          && !Board.replyRefusedForGood("Dana is at its trust prompt") && !Board.replyRefusedForGood(nil),
          "Send as a new message only for the Mac's two refusals that ask for it")
    check(Board.withoutStripInstruction("That message is no longer in this conversation. Press \u{00D7} to send this as a new message.")
          == "That message is no longer in this conversation.", "the board's Press x is dropped where the bubble has its own button")
    // A pending reply right under its original (the newest shown row) draws no header, as the kept row will not.
    var pendingReply = Board.PendingSend(id: "pr", text: "yes", at: Date())
    pendingReply.replyTo = rows.last!.atRaw
    var pendingOther = Board.PendingSend(id: "po", text: "and", at: Date())
    pendingOther.replyTo = "2026-10-24T10:00:00.000Z"
    check(Board.pendingRepliesUnderOriginal([pendingReply], after: rows) == ["pr"] && Board.pendingRepliesUnderOriginal([pendingOther], after: rows).isEmpty,
          "a pending reply right under its original is left out; one answering something further up is not")
    // The chain through pending bubbles: a second pending reply to the same original follows the first's left-out header.
    var pendingSecond = Board.PendingSend(id: "ps", text: "also", at: Date())
    pendingSecond.replyTo = rows.last!.atRaw
    check(Board.pendingRepliesUnderOriginal([pendingReply, pendingSecond], after: rows) == ["pr", "ps"],
          "two pending replies to the newest message: both left out (the chain)")
    // Rows ending in a reply whose header was left out: a pending reply to the same original continues the chain.
    var ended = Array(rows.prefix(2))
    var tail = Board.PendingSend(id: "pt", text: "one more", at: Date())
    tail.replyTo = "2026-10-24T10:00:00.000Z"
    check(Board.repliesUnderOriginal(ended).contains(ended[1].id) && Board.pendingRepliesUnderOriginal([tail], after: ended) == ["pt"],
          "a pending reply under a left-out reply to the same message is left out too")
    ended.removeLast()

    let reply = Board.sendRequest(mac: mac, session: "dana", text: "yes", replyTo: "2026-10-24T10:00:00.000Z")
    let replyBody = reply?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    check(replyBody?["reply_to"] as? String == "2026-10-24T10:00:00.000Z", "a reply sends reply_to, the message's `at` (the board's form)")
    let plainBody = Board.sendRequest(mac: mac, session: "dana", text: "yes", replyTo: "")?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    check(plainBody?["reply_to"] == nil, "no reply: no reply_to key")

    let react = Board.reactRequest(mac: mac, session: "dana", at: "2026-10-24T10:00:00.000Z", emoji: "\u{1F525}")
    let reactBody = react?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    check(react?.httpMethod == "POST" && react?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/dana/thread/react"
          && reactBody?["at"] as? String == "2026-10-24T10:00:00.000Z" && reactBody?["emoji"] as? String == "\u{1F525}",
          "a reaction: POST the agent's thread/react with the message's `at` and the emoji")
    check(Board.reactRequest(mac: mac, session: "../x", at: "T", emoji: "x") == nil && Board.reactRequest(mac: mac, session: "dana", at: "", emoji: "x") == nil,
          "no agent name the app accepts, or no `at`: no request")
    check(Board.reactResult(status: 200, body: Data(#"{"ok":true,"op":"add","emoji":"x","at":"T1","reactions":[{"emoji":"x","count":1,"who":["you"],"mine":true}]}"#.utf8))
          == .reacted(at: "T1", pills: [Board.ChatReaction(emoji: "x", count: 1, mine: true)]), "added: the message's fresh pills")
    check(Board.reactResult(status: 400, body: Data(#"{"ok":false,"because":"there is no message from this agent at that time to react to"}"#.utf8))
          == .refused("There is no message from this agent at that time to react to."), "refused: the Mac's reason, as a sentence")
    check(Board.reactResult(status: 404, body: Data(#"{"error":"no agent by that name"}"#.utf8)) == .refused("No agent by that name.")
          && Board.reactResult(status: 0, body: nil) == .refused("We could not react to that just now."), "the route's error, or no answer")
    let after = Board.withReactions(rows, at: "2026-10-24T10:00:00.000Z", pills: [])
    check(after[0].reactions.isEmpty && after[1] == rows[1], "a react answer repaints only the agent's row it names")
    check(Board.withReactions(rows, at: "2026-10-24T10:01:00.000Z", pills: [Board.ChatReaction(emoji: "x", count: 1, mine: true)])[1].reactions.isEmpty,
          "never a row of the person's (the Mac reacts only on the agent's)")
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

section("native chat: sending a photo or a file (kosmos#7071)")
do {
    let mac = URL(string: "https://studio.kosmosplus.com")!
    let up = Board.uploadRequest(mac: mac, session: "dana", name: "Q3 report (final) \u{00FC}.pdf", type: "application/pdf")
    check(up?.httpMethod == "PUT" && up?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/dana/attachment",
          "an upload is a PUT to the agent's own attachment route on the connected Mac")
    check(up?.value(forHTTPHeaderField: "Content-Type") == "application/pdf", "with the file's type")
    check(up?.value(forHTTPHeaderField: "X-Attachment-Name") == "Q3%20report%20(final)%20%C3%BC.pdf",
          "and its name as encodeURIComponent writes it (the Mac decodes it with decodeURIComponent)")
    check(Board.headerName("a&b+c/d#e?f=g") == "a%26b%2Bc%2Fd%23e%3Ff%3Dg" && Board.headerName("it's!~*()-_.") == "it's!~*()-_.",
          "encodeURIComponent's own set: reserved characters escaped, its unreserved ones kept")
    check(Board.uploadRequest(mac: mac, session: "dana", name: "x", type: "")?.value(forHTTPHeaderField: "Content-Type") == "application/octet-stream",
          "no type: the board's octet-stream")
    check(Board.uploadRequest(mac: mac, session: "../status", name: "x", type: "text/plain") == nil, "a name the app does not accept: no request")

    check(Board.uploadRefusal(size: 100 * 1024 * 1024, waiting: 9) == nil, "exactly 100 MB, and a tenth file: allowed")
    check(Board.uploadRefusal(size: 100 * 1024 * 1024 + 1, waiting: 0) == "That file is over 100 MB, which is the most a message can carry.",
          "one byte over: the board's sentence, before any byte is sent")
    check(Board.uploadRefusal(size: 10, waiting: 10) == "A message can carry 10 files; send these first.", "an eleventh file: the board's sentence")
    check(Board.uploadRefusal(size: nil, waiting: 0) == nil, "a size the phone could not read is left to the Mac")

    func res(_ status: Int, _ body: String?, size: Int? = 1000) -> Board.UploadResult {
        Board.uploadResult(status: status, body: body.map { Data($0.utf8) }, name: "deck.pdf", size: size)
    }
    let id = "0123456789abcdef01234567"
    check(res(200, #"{"attachment":{"id":"\#(id)","name":"deck (1).pdf"}}"#) == .added(Board.Attached(id: id, name: "deck (1).pdf")),
          "added: the Mac's id and the name it kept")
    check(res(200, #"{"attachment":{"id":"\#(id)"}}"#) == .added(Board.Attached(id: id, name: "deck.pdf")), "no name back: the one sent")
    check(res(200, #"{"attachment":{"id":"../../x"}}"#) == .refused("We could not add that file (status 200)."),
          "an id that is not the Mac's shape is never sent on (control for the shape check)")
    check(res(200, "{}") == .refused("We could not add that file (status 200)."), "a 200 with no attachment is not added")
    check(res(408, #"{"error":"it took too long"}"#) == .refused("We could not finish adding deck.pdf: it took too long to arrive. Try again on a faster connection."),
          "408: too slow, in the board's words (before the Mac's own)")
    check(res(413, #"{"error":"that file is over 100 MB"}"#) == .refused("that file is over 100 MB"), "a refusal: the Mac's own words")
    check(res(502, nil, size: 30 * 1024 * 1024) == .refused("We could not reach Kosmos to add deck.pdf. If your connection is slow, a file this large can take longer than Kosmos waits for one."),
          "a relay's 502 on a large file: maybe too slow")
    check(res(502, nil) == .refused("We could not add that file (status 502)."), "the same 502 on a small file: the status")
    check(res(0, nil) == .refused("We could not reach Kosmos to add that file."), "no answer: not reached")
    check(res(0, nil, size: 30 * 1024 * 1024) == .refused("We could not reach Kosmos to add deck.pdf. If your connection is slow, a file this large can take longer than Kosmos waits for one."),
          "no answer on a large file: maybe too slow")

    let files = [Board.Attached(id: id, name: "a.pdf"), Board.Attached(id: id, name: "b.png")]
    check(Board.sendWords("  see these \n", files: files) == "see these", "words typed: the words")
    check(Board.sendWords("  \n", files: files) == "a.pdf, b.png", "no words: the files' names, as the board sends them")
    check(Board.wordsShown("a.pdf, b.png", names: ["a.pdf", "b.png"]) == "" && Board.wordsShown("see these", names: ["a.pdf"]) == "see these",
          "a bubble on its way draws no words that are only its files' names")

    let withFiles = Board.sendRequest(mac: mac, session: "dana", text: "a.pdf", attachments: [id])
    let sent = withFiles?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    check(sent?["text"] as? String == "a.pdf" && sent?["attachments"] as? [String] == [id], "a send with files carries their ids")
    let plain = Board.sendRequest(mac: mac, session: "dana", text: "hi")?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    check(plain?["attachments"] == nil, "and one with none carries no attachments key (the board's own shape)")
    check(Board.sendRequest(mac: mac, session: "dana", text: "x", attachments: Array(repeating: id, count: 11)) == nil, "eleven files: not sent")
    check(Board.sendRequest(mac: mac, session: "dana", text: "x", attachments: ["nope"]) == nil, "an id not of the Mac's shape: not sent")

    check(Board.mimeType(forName: "deck.pdf") == "application/pdf" && Board.mimeType(forName: "Photo.jpg") == "image/jpeg"
          && Board.mimeType(forName: "notes") == "application/octet-stream", "the type from the name, octet-stream when there is none")
    check(Board.photoName(at: Date(timeIntervalSince1970: 1_761_330_605), ext: "jpg", zone: TimeZone(identifier: "UTC")!) == "Photo 2025-10-24 at 18.30.05.jpg",
          "a photo is named by when it was added, with no slash or colon")
    check(Board.photoName(at: Date(timeIntervalSince1970: 1_761_330_605), ext: "png", number: 2, zone: TimeZone(identifier: "UTC")!) == "Photo 2025-10-24 at 18.30.05 (2).png",
          "the second photo of one pick is numbered, so no two share a name")
    check(Board.imageExtension(Data([0xFF, 0xD8, 0xFF, 0xE0])) == "jpg" && Board.imageExtension(Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) == "png"
          && Board.imageExtension(Data([0, 0, 0, 24] + Array("ftypheic".utf8))) == "heic" && Board.imageExtension(Data("GIF89a".utf8)) == "gif"
          && Board.imageExtension(Data("RIFF\0\0\0\0WEBP".utf8)) == "webp" && Board.imageExtension(Data("hello".utf8)) == nil,
          "the image type from its own bytes")
    let six = Date(timeIntervalSince1970: 1_761_330_605)
    check(Board.filesRowSpoken(who: "You", at: six, text: "", count: 2, notSent: "Not sent")
          == "You, " + six.formatted(date: .omitted, time: .shortened) + ": 2 files, not sent",
          "a row of files says who sent it, when, how many, and that it was not sent")
    check(Board.filesRowSpoken(who: "Dana", at: nil, text: "the deck", count: 1, notSent: nil) == "Dana: the deck, 1 file", "and its words, when it has any")
    check(Board.filesSpoken(["a.pdf"]) == "1 file: a.pdf" && Board.filesSpoken(["a.pdf", "b.png"]) == "2 files: a.pdf, b.png", "VoiceOver names the files")
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
    // kosmos#7197: this many session requests get no answer before the gate answers as usual.
    var sessionNoAnswerFirst = 0
    // Each status request takes the first queued answer; nil is no answer at all. Empty queue: statusDefault.
    var statusQueue: [(Int, String)?] = []
    var statusDefault: (Int, String)? = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"}]}"#)
    // kosmos#7030: the tasks read (GET /api/tasks?view=tasks); nil is no answer at all.
    var tasksAnswer: (Int, String)? = (200, #"{"tasks":[{"projectId":"p1","projectName":"Catalogue","number":4,"sentence":"Pages 1 to 8","state":"built","builtBy":"dana"}]}"#)
    // #7034: the board's starred agents (GET /api/agent-stars); nil answers nothing, as before the route.
    var starsAnswer: (Int, String)? = nil
    // kosmos#7034: the answer to a star pressed on the phone (PUT /api/agent-stars), and the last body it carried.
    var starWriteAnswer: (Int, String)? = nil
    var starWriteBodies: [String] = []
    var starWriteYields = 0   // review 2: hold a star's save this many turns
    // Each stars read waits the first count's yields before it answers; empty: none.
    var starsYields: [Int] = []
    // Each status read waits the first count's yields before it is sent; statusStarted counts the status reads begun.
    var statusYields: [Int] = []
    var statusStarted = 0
    var admitted = 0
    // The Mac cookie each status request carried, as the real session would send it from the jar.
    var presented: [String] = []
    var macsStatus = 200
    // kosmos#7266 slice B: the person's record and picture (nil: no answer at all).
    var youAnswer: (Int, String)? = nil
    var youPictureAnswer: (Int, String, Data)? = nil
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
    // kosmos#7071: uploads (each takes the first queued answer; nil is no answer; empty queue: a new id each time), what
    // each carried (path, type, name header, the bytes read from the file), and each post's `attachments`.
    var uploadQueue: [(Int, String)?] = []
    var uploads: [(path: String, type: String, name: String, bytes: Data, file: String)] = []
    var uploadYields = 0
    var postedAttachments: [[String]] = []
    // kosmos#7083: each post's reply_to ("" when none), and each reaction asked for ("at|emoji") with its answer.
    var postedReplies: [String] = []
    var postedRetryOf: [String] = []
    var reacted: [String] = []
    var reactAnswer: (Int, String)? = (200, #"{"ok":true,"reactions":[]}"#)
    // kosmos#7075: each request's Sec-Fetch-Site, by "METHOD path" ("" when it had none).
    var fetchSites: [(String, String)] = []
    let cookies = URLSessionConfiguration.ephemeral.httpCookieStorage!

    func count(_ path: String) -> Int { requests.filter { $0.hasSuffix(path) }.count }

    func upload(_ r: URLRequest, _ file: URL) -> (Data, HTTPURLResponse)? {
        let url = r.url!
        requests.append("\(r.httpMethod ?? "GET") \(url.host ?? "")\(url.path)")
        fetchSites.append(("\(r.httpMethod ?? "GET") \(url.host ?? "")\(url.path)", r.value(forHTTPHeaderField: "Sec-Fetch-Site") ?? ""))
        uploads.append((url.path, r.value(forHTTPHeaderField: "Content-Type") ?? "", r.value(forHTTPHeaderField: "X-Attachment-Name") ?? "",
                        (try? Data(contentsOf: file)) ?? Data(), file.standardizedFileURL.path))
        let next: (Int, String)? = uploadQueue.isEmpty
            ? (200, #"{"attachment":{"id":"\#(String(format: "%024lx", uploads.count))","name":"\#(r.value(forHTTPHeaderField: "X-Attachment-Name")?.removingPercentEncoding ?? "")"}}"#)
            : uploadQueue.removeFirst()
        return next.map { (Data($0.1.utf8), HTTPURLResponse(url: url, statusCode: $0.0, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!) }
    }

    func send(_ r: URLRequest) -> (Data, HTTPURLResponse)? {
        let url = r.url!
        requests.append("\(r.httpMethod ?? "GET") \(url.host ?? "")\(url.path)")
        fetchSites.append(("\(r.httpMethod ?? "GET") \(url.host ?? "")\(url.path)", r.value(forHTTPHeaderField: "Sec-Fetch-Site") ?? ""))
        func answer(_ code: Int, _ body: String) -> (Data, HTTPURLResponse) {
            (Data(body.utf8), HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
        }
        switch url.path {
        case "/v1/account/macs": return answer(macsStatus, macsStatus == 200 ? macsBody : "{}")
        case "/v1/account/handoff": return answer(200, #"{"token":"hand"}"#)
        case "/_kosmos/session":
            if sessionNoAnswer { return nil }
            if sessionNoAnswerFirst > 0 { sessionNoAnswerFirst -= 1; return nil }
            if sessionAnswer.0 == 200 {
                admitted += 1
                cookies.setCookie(HTTPCookie(properties: [.name: Board.macCookieName, .value: "fresh-\(admitted)", .domain: (admitKeyedApart ? "." : "") + url.host!, .path: "/", .secure: "TRUE"])!)
            }
            return answer(sessionAnswer.0, sessionAnswer.1)
        case "/api/tasks":
            return tasksAnswer.map { answer($0.0, $0.1) }
        case "/api/agent-stars":
            if r.httpMethod == "PUT" {
                starWriteBodies.append(r.httpBody.map { String(decoding: $0, as: UTF8.self) } ?? "")
                return starWriteAnswer.map { answer($0.0, $0.1) }
            }
            return starsAnswer.map { answer($0.0, $0.1) }
        case "/api/you":
            return youAnswer.map { answer($0.0, $0.1) }
        case "/api/you/avatar":
            return youPictureAnswer.map { (code, type, body) in (body, HTTPURLResponse(url: url, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": type])!) }
        case "/api/status":
            presented.append((cookies.cookies(for: url) ?? []).filter { $0.name == Board.macCookieName }.map(\.value).joined(separator: ","))
            if let hook = onStatusRead { onStatusRead = nil; hook() }
            let next: (Int, String)? = statusQueue.isEmpty ? statusDefault : statusQueue.removeFirst()
            return next.map { answer($0.0, $0.1) }
        default:
            if url.path.hasPrefix("/api/agent/") && url.path.hasSuffix("/thread/react") {
                let body = r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                reacted.append((body?["at"] as? String ?? "") + "|" + (body?["emoji"] as? String ?? ""))
                return reactAnswer.map { answer($0.0, $0.1) }
            }
            if url.path.hasPrefix("/api/agent/") && url.path.hasSuffix("/thread") {
                if r.httpMethod == "POST" {
                    let body = r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                    posted.append(body?["text"] as? String ?? "")
                    postedRequests.append(body?["request"] as? String ?? "")
                    postedAttachments.append(body?["attachments"] as? [String] ?? [])
                    postedReplies.append(body?["reply_to"] as? String ?? "")
                    postedRetryOf.append(body?["retry_of"] as? String ?? "")
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
// And for copies of picked files (#7071), a folder apart from it, as in the app (so neither's clearing hides the other's).
let testUploads = FileManager.default.temporaryDirectory.appendingPathComponent("kosmos-logic-tests-uploads-\(getpid())", isDirectory: true)

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
                                                if r.url?.path == "/api/agent-stars", r.httpMethod == "PUT" { for _ in 0..<world.starWriteYields { await Task.yield() } }
                                                else if r.url?.path == "/api/agent-stars", r.httpMethod != "PUT", !world.starsYields.isEmpty { for _ in 0..<world.starsYields.removeFirst() { await Task.yield() } }
                                                else if r.url?.path == "/api/status" { world.statusStarted += 1; if !world.statusYields.isEmpty { for _ in 0..<world.statusYields.removeFirst() { await Task.yield() } } }
                                                else if r.url?.path.hasPrefix("/api/attachment/") == true { world.attachmentStarted.append(r.url!.path); for _ in 0..<world.attachmentYields { await Task.yield() } }
                                                return world.send(r)
                                            },
                                            sleep: { world.clock += $0; await Task.yield() },
                                            now: { world.clock },
                                            defaults: defaults,
                                            files: testFiles,
                                            upload: { r, file in
                                                for _ in 0..<world.uploadYields { await Task.yield() }
                                                return world.upload(r, file)
                                            },
                                            uploads: testUploads))
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
    // #7034: the person's starred agents first, each group in its own order.
    check(Board.sorted(mixed, stars: ["i", "q"]).map(\.session) == ["q", "i", "p", "w"], "starred first, then the rest, each in the tone order")
    check(Board.sorted(mixed, stars: nil).map(\.session) == ["p", "q", "w", "i"] && Board.sorted(mixed, stars: []).map(\.session) == ["p", "q", "w", "i"], "no stars known, or none, change no order")
    check(Board.sorted(mixed, stars: ["nobody"]).map(\.session) == ["p", "q", "w", "i"], "a star for an agent not listed changes no order")
    let keptStarred = Board.keepingOrder(shown, with: fresh, stars: ["i", "b"])
    check(keptStarred.map(\.session) == ["w", "i", "b", "z"], "a live update never moves a shown row for a star; new agents come starred first among themselves")
    check(Board.parseStars(Data(#"{"names":["dana","wes"],"ok":true}"#.utf8)) == ["dana", "wes"], "the stars are read from the board's answer")
    check(Board.parseStars(Data(#"{"names":["dana"],"ok":false}"#.utf8)) == nil, "an answer the board could not read its list for is no stars")
    check(Board.parseStars(Data(#"{"names":"dana","ok":true}"#.utf8)) == nil && Board.parseStars(Data("not json".utf8)) == nil, "nor is one in another shape")
    check(Board.starsRequest(mac: URL(string: "https://studio.kosmosplus.com/")!).url?.absoluteString == "https://studio.kosmosplus.com/api/agent-stars", "from the board's own route")
    check(Board.starsRequest(mac: URL(string: "https://studio.kosmosplus.com/")!).timeoutInterval == Board.starsTimeout && Board.starsTimeout < 15, "and gives up sooner than the session's 15 s, since the list waits for it")
    let mac = URL(string: "https://studio.kosmosplus.com/")!
    check(Board.avatarRequest(mac: mac, session: "dana")?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/dana/avatar", "an agent's picture comes from its Mac")
    check(Board.avatarRequest(mac: mac, session: "../x") == nil && Board.avatarRequest(mac: mac, session: "a/b") == nil, "never for a name outside the agent-name characters")
    let pic = Board.parseAgents(Data(#"{"agents":[{"sessionName":"d","name":"D","state":"idle","hasAvatar":true,"avatarVer":3}]}"#.utf8))?.first
    check(pic?.hasAvatar == true && pic?.avatarVer == "3", "the picture flag and version are read from the snapshot")
}

section("starring from the phone (kosmos#7034)")
    do {
        let mac = URL(string: "https://studio.kosmosplus.com/")!
        let put = Board.starWriteRequest(mac: mac, name: "wes", on: true)
        let sent = put?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        check(put?.httpMethod == "PUT" && put?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent-stars" && sent?["name"] as? String == "wes" && sent?["on"] as? Bool == true,
              "a star is the board's own write: PUT /api/agent-stars { name, on }")
        check(Board.starFailure(on: true, status: 400, data: Data(#"{"error":"too many starred agents"}"#.utf8)).contains("500 agents are starred already")
              && Board.starFailure(on: true, status: 400, data: Data(#"{"error":"x"}"#.utf8)) == "That agent cannot be starred."
              && Board.starFailure(on: false, status: 500, data: Data(#"{"error":"we could not save that star"}"#.utf8)).hasPrefix("Stars cannot be changed right now")
              && Board.starFailure(on: false, status: 502, data: nil) == "That star could not be removed. Try again in a moment.",
              "a star that did not save says why in the board's words (STAR_MSG), retry only where a retry can help")
        let (c, w, _, _) = make("kst1")
        c.setAgentSort(.name, projects: [:])
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"},{"sessionName":"wes","name":"Wes","state":"working"}]}"#)
        w.starsAnswer = (200, #"{"names":[],"ok":true}"#)
        c.start()
        let ok = await settle { isLive(c) }
        check(ok && c.agents.map(\.session) == ["dana", "wes"] && !c.isStarred("wes"), "premise: nobody starred, Name A to Z")
        w.starWriteAnswer = (200, #"{"names":["wes"],"ok":true}"#)
        await c.toggleStar("wes")
        check(c.isStarred("wes") && c.agents.map(\.session) == ["wes", "dana"] && c.starNote == nil, "a star pressed on the phone saves, and the agent moves to the top at once")
        check(w.starWriteBodies.last?.contains("\"on\":true") == true && w.starWriteBodies.last?.contains("\"name\":\"wes\"") == true, "it sends the agent and on")
        w.starWriteAnswer = (500, #"{"error":"we could not save that star"}"#)
        await c.toggleStar("wes")
        check(c.isStarred("wes") && c.agents.map(\.session) == ["wes", "dana"] && c.starNote?.hasPrefix("Stars cannot be changed right now") == true,
              "an unstar that did not save goes back, with the board's words why")
        w.starWriteAnswer = (200, #"{"names":[],"ok":true}"#)
        await c.toggleStar("wes")
        check(!c.isStarred("wes") && c.agents.map(\.session) == ["dana", "wes"] && c.starNote == nil, "an unstar that saves takes the agent back to its place, and the note goes")
        w.starWriteAnswer = (200, #"{"names":["dana","wes"],"ok":true}"#)
        await c.toggleStar("dana")
        check(c.isStarred("wes") && c.isStarred("dana"), "the board's answer decides: a star set elsewhere meanwhile shows too")
        // Review 1: a pull whose stars read began before a press never undoes the press.
        w.starsAnswer = (200, #"{"names":["dana","wes"],"ok":true}"#)   // the stars as they were when the pull began
        w.starsYields = [400]
        let epochBefore = c.sortEpoch
        let starGets = w.requests.filter { $0 == "GET studio.kosmosplus.com/api/agent-stars" }.count
        async let pull: () = c.refreshNow()
        let inRead = await settle { w.requests.filter { $0 == "GET studio.kosmosplus.com/api/agent-stars" }.count > starGets }
        check(inRead, "premise: the pull's stars read is out (held) before the press")
        w.starWriteAnswer = (200, #"{"names":["dana"],"ok":true}"#)
        await c.toggleStar("wes")
        await pull
        check(!c.isStarred("wes") && c.isStarred("dana"), "a pull that was already reading when wes was unstarred does not put his star back")
        check(c.sortEpoch > epochBefore, "review 1: a star tells Today to re-take its order")
        // Review 1: a failed save puts back only its own agent, never another star the board confirmed meanwhile.
        w.starWriteAnswer = (502, "{}")
        await c.toggleStar("dana")
        check(c.isStarred("dana") && !c.isStarred("wes"), "a failed unstar puts back only that agent")
        c.stop()
    }

    do {
        // Review 2: a pull that begins while a star is still saving never undoes it (its read may predate the save).
        let (c, w, _, _) = make("kst1")
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"},{"sessionName":"wes","name":"Wes","state":"working"}]}"#)
        w.starsAnswer = (200, #"{"names":[],"ok":true}"#)
        c.start()
        let ok = await settle { isLive(c) }
        w.starsAnswer = (200, #"{"names":[],"ok":true}"#)   // the board's list before it applied the press
        // The save is out first; the pull begins while it is out; the save ends; only then does the pull's stars read land.
        w.starWriteYields = 60
        w.starWriteAnswer = (200, #"{"names":["wes"],"ok":true}"#)
        async let press: () = c.toggleStar("wes")
        let outNow = await settle { c.starring.contains("wes") }
        check(ok && outNow && c.isStarred("wes"), "premise: the star is out (held) and already shown")
        w.starsYields = [600]
        async let pull: () = c.refreshNow()
        await press
        await pull
        check(c.isStarred("wes"), "review 2: a pull begun while the star was saving does not take it away")
        // Review 3: a computer switch while a save is out leaves nothing pending for the next computer.
        w.starWriteYields = 400
        async let late: () = c.toggleStar("dana")
        let out2 = await settle { c.starring.contains("dana") }
        c.showMac(address: "laptop.kosmosplus.com")
        check(out2 && c.starring.isEmpty, "review 3: switching computers drops a save still out, so the next computer's stars are read")
        await late
        check(c.starring.isEmpty, "and its late answer leaves nothing behind")
        c.stop()
    }

section("native board loop: connecting")
    do {
        // #7034: the list comes starred first; an unreadable answer on a later pull keeps the order; a pull re-reads.
        let (c, w, _, _) = make("kst1")
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"},{"sessionName":"wes","name":"Wes","state":"working"}]}"#)
        w.starsAnswer = (200, #"{"names":["wes"],"ok":true}"#)
        c.start()
        let okS = await settle { isLive(c) }
        check(okS && c.agents.map(\.session) == ["wes", "dana"], "a starred agent comes first in the list")
        w.starsAnswer = (200, #"{"names":[],"ok":false}"#)
        await c.refreshNow()
        check(c.agents.map(\.session) == ["wes", "dana"], "a pull while the stars cannot be read keeps the last ones")
        w.starsAnswer = (200, #"{"names":["dana"],"ok":true}"#)
        await c.refreshNow()
        check(c.agents.map(\.session) == ["dana", "wes"], "a pull reads the stars again")
        check(c.shownStars == ["dana"], "Today reads the shown Mac's stars")
        c.stop()
    }
    do {
        // #7034: one Mac's stars never order another's list.
        let (c, w, _, _) = make("kst1")
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"},{"sessionName":"wes","name":"Wes","state":"working"}]}"#)
        w.starsAnswer = (200, #"{"names":["wes"],"ok":true}"#)
        c.start()
        let okA = await settle { isLive(c) }
        check(okA && c.agents.map(\.session) == ["wes", "dana"], "CONTROL: the first Mac's star orders its list")
        w.starsAnswer = nil
        w.macsBody = #"{"macs":[{"name":"Office","address":"office.kosmosplus.com","last_seen":100}]}"#
        c.retry()
        let moved = await settle { if case .live(let m) = c.phase { return m.address == "office.kosmosplus.com" }; return false }
        check(moved && c.agents.map(\.session) == ["dana", "wes"], "another Mac whose stars cannot be read is listed without the first Mac's")
        check(c.shownStars == nil, "and Today is not given the first Mac's stars")
        c.stop()
    }
    do {
        // #7034: a sign-out forgets the stars with everything else learned under it.
        let (c, w, _, _) = make("kst1")
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"},{"sessionName":"wes","name":"Wes","state":"working"}]}"#)
        w.starsAnswer = (200, #"{"names":["wes"],"ok":true}"#)
        c.start()
        let okF = await settle { isLive(c) }
        check(okF && c.agents.map(\.session) == ["wes", "dana"], "CONTROL: the star orders the list")
        w.starsAnswer = nil
        c.accountChanged()
        let back = await settle { isLive(c) }
        check(back && c.agents.map(\.session) == ["dana", "wes"], "after a sign-out, stars that cannot be read are no stars")
        c.stop()
    }
    do {
        // #7034: a read that started before the list now shown never puts its older rows back over it.
        let (c, w, _, _) = make("kst1")
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"idle"}]}"#)
        w.starsAnswer = (200, #"{"names":[],"ok":true}"#)
        c.start()
        _ = await settle { isLive(c) }
        let reads = w.requests.filter { $0.hasSuffix("/api/status") }.count
        w.statusQueue = [(200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"needs_you"}]}"#)]
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"}]}"#)
        w.starsYields = [2000]
        await c.refreshNow()
        check(w.requests.filter { $0.hasSuffix("/api/status") }.count >= reads + 2, "CONTROL: a newer read answered while the pull waited for its stars")
        check(c.agents.first?.state == "working", "the pull's older rows are not put back over the newer list")
        c.stop()
    }
    do {
        // #7034: a pull that read nothing leaves no re-sort behind, even when a read already in the air landed meanwhile.
        let (c, w, _, _) = make("kst1")
        c.setAgentSort(.needs, projects: [:])   // kosmos#7421: the re-sort mechanics, under Needs you first
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"},{"sessionName":"wes","name":"Wes","state":"working"}]}"#)
        w.starsAnswer = (200, #"{"names":[],"ok":true}"#)
        c.start()
        _ = await settle { isLive(c) }
        check(c.agents.map(\.session) == ["dana", "wes"], "CONTROL: the list starts by name")
        let epoch = c.sortEpoch
        check(epoch >= 1, "CONTROL: the first list was a re-sort, counted for Today")
        // Wes now needs the person: a re-sort would move him first, a live update keeps him where he is.
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"working"},{"sessionName":"wes","name":"Wes","state":"needs_you"}]}"#)
        let started = w.statusStarted
        // Status reads take these yields in the order they begin: the read in the air lands at about 1000, the pull's
        // own read answers at once (a 500) and the pull ends when its stars answer, at about 1100; the loop's next read,
        // begun while the pull waited, lands at about 3000, after the pull ended.
        w.statusYields = [1000, 0, 2000]
        let inAir = await settle { w.statusStarted > started }
        w.statusQueue = [(500, "{}")]
        w.starsYields = [1100]
        // Dana is starred meanwhile: the loop read begun during the pull reads that, but its re-sort is withdrawn.
        w.starsAnswer = (200, #"{"names":["dana"],"ok":true}"#)
        await c.refreshNow()
        check(inAir && c.agents.first(where: { $0.session == "wes" })?.state == "needs_you", "CONTROL: the read in the air landed while the pull waited")
        let reads = w.statusStarted
        _ = await settle { w.statusStarted > reads + 2 }
        check(c.agents.map(\.session) == ["dana", "wes"], "the next live updates keep the order: the failed pull left no re-sort")
        check(c.sortEpoch == epoch, "Today is told of no re-sort: neither the read in the air nor the withdrawn one sorted")
        check(c.shownStars == [], "a read whose re-sort was withdrawn takes no new stars, so Today never orders by them alone")
        let starReads = w.requests.filter { $0.hasSuffix("/api/agent-stars") }.count
        let more = w.statusStarted
        _ = await settle { w.statusStarted > more + 2 }
        check(w.requests.filter { $0.hasSuffix("/api/agent-stars") }.count == starReads, "a live update does not read the stars")
        w.starsAnswer = (200, #"{"names":[],"ok":true}"#)
        await c.refreshNow()
        check(c.agents.map(\.session) == ["wes", "dana"], "CONTROL: a pull that reads re-sorts, moving Wes first")
        check(c.sortEpoch == epoch + 1, "and Today is told of exactly that re-sort")
        c.stop()
    }
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

    section("the Kosmos switcher (kosmos#7266 slice C)")
    do {
        // Review 2 (a blocker): the common launch restores the kept session and never ran chooseMac, so the list was empty.
        let (c, w, _, _) = make("kst1", kept: keptRecord("kst1", cookie: "kept"))
        w.macsBody = #"{"macs":[{"name":"Studio","address":"studio.kosmosplus.com","last_seen":300},{"name":"Laptop","address":"laptop.kosmosplus.com","last_seen":100}]}"#
        c.start()
        let listed = await settle { isLive(c) && c.macs.count == 2 }
        check(listed, "a launch from the kept session still lists the account's computers for the switcher")
        check(w.count("/v1/account/handoff") == 0 && w.count("/_kosmos/session") == 0, "without a new sign-in to the Mac")
        c.stop()
    }
    do {
        let (c, w, sessions, _) = make("kst1", kept: keptRecord("kst1", cookie: "kept"))
        w.macsBody = #"{"macs":[{"name":"Studio","address":"studio.kosmosplus.com","last_seen":300},{"name":"Laptop","address":"laptop.kosmosplus.com","last_seen":100,"not_connected":true}]}"#
        w.starsAnswer = (200, #"{"stars":["dana"]}"#)
        c.start()
        let live = await settle { isLive(c) }
        check(live && c.switcherShown == "studio.kosmosplus.com", "on Studio, from its kept session")
        // The kept session skips the Mac list, so a first Try again asks Kosmos+ for it.
        c.retry(); c.retry()
        let listed = await settle { c.macs.count == 2 && isLive(c) }
        check(listed, "the switcher has the account's two computers once Kosmos+ is asked")
        let before = Board.switcherRows(c.macs, shown: c.switcherShown)
        check(before.map(\.name) == ["Laptop", "Studio"] && before.filter(\.shown).map(\.name) == ["Studio"], "Studio checked, Laptop listed")
        let epoch = c.chatEpoch
        let studioReads = w.requests.filter { $0 == "GET studio.kosmosplus.com/api/status" }.count
        c.showMac(address: "studio.kosmosplus.com")
        check(c.chatEpoch == epoch && isLive(c), "choosing the computer already shown does nothing")
        w.sessionNoAnswer = true   // Laptop does not answer
        c.showMac(address: "laptop.kosmosplus.com")
        check(c.agents.isEmpty && c.shownMacName == nil && c.chatEpoch > epoch, "a switch clears Studio's list and chats at once")
        check(c.switcherShown == "laptop.kosmosplus.com", "and the switcher checks Laptop while it opens")
        let down = await settle { if case .unreachable = c.phase { return true }; return false }
        check(down && c.phase.macName == "Laptop" && c.failingMacName == "Laptop", "an offline choice says Laptop is not answering, never Studio")
        // The bug review 1 found: any later start restored Studio's kept session and undid the choice.
        c.retry()
        _ = await settle { if case .unreachable = c.phase { return true }; return false }
        c.start()
        _ = await settle { if case .unreachable = c.phase { return true }; return false }
        check(c.phase.macName == "Laptop" && c.agents.isEmpty && c.switcherShown == "laptop.kosmosplus.com", "a Try again or a return to the app stays on Laptop")
        check(w.requests.filter { $0 == "GET studio.kosmosplus.com/api/status" }.count == studioReads, "and never reads Studio again")
        w.sessionNoAnswer = false
        c.retry()
        let onLaptop = await settle { isLive(c) && c.shownMacName == "Laptop" }
        check(onLaptop, "once Laptop answers, its list shows")
        check(UserDefaults(suiteName: "kosmos-board-loop-tests")!.string(forKey: Board.rememberedMacKey) == "laptop.kosmosplus.com", "and Laptop is remembered for the next launch")
        sessions.value = nil
        c.start()
        check(c.macs.isEmpty && c.switcherShown == nil, "a sign-out clears the switcher")
        c.stop()
    }
    section("the person's name and picture (kosmos#7266 slice B)")
    do {
        let (c, w, _, _) = make("kst1")
        w.macsBody = #"{"macs":[{"name":"Studio","address":"studio.kosmosplus.com","last_seen":300},{"name":"Laptop","address":"laptop.kosmosplus.com","last_seen":100}]}"#
        let face = Data([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
        w.youAnswer = (200, #"{"state":"saved","you":{"name":"Sam Carter","does":"runs the shop"}}"#)
        w.youPictureAnswer = (200, "image/png", face)
        c.start()
        let got = await settle { c.youName == "Sam Carter" && c.youPicture == face }
        check(got, "the shown computer's name and picture are read with its first list")
        let reads = w.count("/api/you/avatar"), names = w.count("/api/you")
        w.youPictureAnswer = (200, "text/html", Data("<html>sign in</html>".utf8))
        w.youAnswer = (200, "<html>sign in</html>")
        for _ in 0..<3 { await c.refreshNow() }
        check(w.count("/api/you/avatar") == reads && w.count("/api/you") == names, "and not on every 5-second read")
        w.clock += Board.youEvery + 1
        await c.refreshNow()
        // No idle settle here: each pass of the poll advances the fake clock 5 s, so idling would pass 30 minutes.
        _ = await settle { w.count("/api/you") > names }
        check(w.count("/api/you") > names, "after 5 minutes the name is read again (\(w.count("/api/you")) after \(names))")
        check(w.count("/api/you/avatar") == reads, "and the picture is not (review 1: every 30 minutes; \(w.count("/api/you/avatar")) after \(reads))")
        check(c.youName == "Sam Carter", "a name read that is the gate's page keeps the name (review 1)")
        w.clock += Board.youPictureEvery + 1
        await c.refreshNow()
        _ = await settle { w.count("/api/you/avatar") > reads }
        _ = await settle { false }
        check(w.count("/api/you/avatar") > reads && c.youPicture == face, "after 30 minutes the picture is read; the gate's page keeps the picture shown")
        w.youPictureAnswer = (204, "text/plain", Data())
        w.youAnswer = (200, #"{"state":"absent","you":null}"#)
        c.showMac(address: "laptop.kosmosplus.com")
        check(c.youName == nil && c.youPicture == nil, "a switch forgets the other computer's person at once")
        let laptop = await settle { isLive(c) && c.shownMacName == "Laptop" }
        _ = await settle { w.requests.contains("GET laptop.kosmosplus.com/api/you/avatar") }
        check(laptop && c.youName == nil && c.youPicture == nil, "a computer with no name or picture shows none (the gear and You)")
        c.stop()
    }
    do {
        // Review 4: a first read that learns nothing (the Mac's startup sign-in window) is tried again after youRetry, not
        // after 5 minutes; the elapsed fake time is checked so a 5-minute re-read cannot pass this.
        let (c, w, _, _) = make("kst1")
        let face = Data([0x89, 0x50, 0x4e, 0x47, 4, 5])
        w.youAnswer = (200, "<html>sign in</html>")
        w.youPictureAnswer = (200, "text/html", Data("<html>sign in</html>".utf8))
        c.start()
        _ = await settle { w.count("/api/you/avatar") > 0 }
        check(c.youName == nil && c.youPicture == nil, "a first read that is the sign-in page shows nothing yet")
        let from = w.clock
        w.youAnswer = (200, #"{"state":"saved","you":{"name":"Sam Carter"}}"#)
        w.youPictureAnswer = (200, "image/png", face)
        let got = await settle { c.youName == "Sam Carter" && c.youPicture == face }
        check(got && w.clock.timeIntervalSince(from) <= Board.youRetry + 10, "both are read again after youRetry plus up to two polls, not 5 minutes later (\(w.clock.timeIntervalSince(from)) s)")
        // The picture alone: a name read that worked, then a picture read that learned nothing, retries the picture by itself.
        let names = w.count("/api/you"), pics = w.count("/api/you/avatar")
        w.youPictureAnswer = (500, "text/plain", Data())
        w.clock += Board.youPictureEvery + 1
        await c.refreshNow()
        _ = await settle { w.count("/api/you/avatar") > pics }
        let mid = w.clock, namesMid = w.count("/api/you")
        w.youPictureAnswer = (200, "image/png", Data([0x89, 0x50, 0x4e, 0x47, 6]))
        let again = await settle { c.youPicture == Data([0x89, 0x50, 0x4e, 0x47, 6]) }
        check(again && w.clock.timeIntervalSince(mid) <= Board.youRetry + 10, "a picture read that failed is retried on its own after youRetry plus up to two polls (\(w.clock.timeIntervalSince(mid)) s)")
        check(w.count("/api/you") == namesMid && namesMid > names, "and the name is not read again with it")
        // Review 5: an older board answers the name read with 404; that is no name, learned, so it is not asked every 30 s.
        // CONTROL first: the same loop with the sign-in page (nothing learned) does ask again, so the loop can see a retry.
        // Each arm on its own client: a read still in flight from one arm would otherwise land in the next.
        func namesAfterRetries(_ answer: (Int, String)) async -> Int {
            let (c, w, _, _) = make("kst1")
            w.youAnswer = answer
            w.youPictureAnswer = (204, "text/plain", Data())
            c.start()
            _ = await settle { isLive(c) && w.count("/api/you") > 0 }
            defer { c.stop() }
            w.clock += Board.youEvery + 1
            let before = w.count("/api/you")
            await c.refreshNow()
            _ = await settle { w.count("/api/you") > before }
            let first = w.count("/api/you"), start = w.clock
            for _ in 0..<2 {
                w.clock += Board.youRetry + 1
                await c.refreshNow()
                // A bounded wait: settle idles through enough 5 s polls to reach the 5-minute re-read itself.
                for _ in 0..<40 where w.count("/api/you") == first { await Task.yield() }
            }
            check(w.clock.timeIntervalSince(start) < Board.youEvery, "#7266 review 5: the retry loop stays inside 5 minutes (\(w.clock.timeIntervalSince(start)) s)")
            return w.count("/api/you") - first
        }
        let signInAgain = await namesAfterRetries((200, "<html>sign in</html>"))
        check(signInAgain > 0, "#7266 review 5: CONTROL: a sign-in page answer is asked again after youRetry (\(signInAgain) more)")
        let olderAgain = await namesAfterRetries((404, "not found"))
        check(olderAgain == 0, "#7266 review 5: a 404 (an older board) is not asked again every 30 s (\(olderAgain) more)")
        do {
            // Review 6: a 404 keeps a name already shown (something other than the board may answer 404).
            let (c, w, _, _) = make("kst1")
            w.youAnswer = (200, #"{"state":"saved","you":{"name":"Sam Carter"}}"#)
            w.youPictureAnswer = (204, "text/plain", Data())
            c.start()
            let named = await settle { c.youName == "Sam Carter" }
            w.youAnswer = (404, "not found")
            let before = w.count("/api/you")
            w.clock += Board.youEvery + 1
            await c.refreshNow()
            _ = await settle { w.count("/api/you") > before }
            for _ in 0..<40 { await Task.yield() }
            check(named && w.count("/api/you") > before && c.youName == "Sam Carter", "#7266 review 6: a 404 read keeps the name shown")
            c.stop()
        }
        c.stop()
    }
    do {
        // Review 1: a sign-out forgets the person too, not only a switch.
        let (c, w, sessions, _) = make("kst1")
        w.youAnswer = (200, #"{"state":"saved","you":{"name":"Sam Carter"}}"#)
        w.youPictureAnswer = (200, "image/png", Data([0x89, 0x50, 0x4e, 0x47, 9]))
        c.start()
        let got = await settle { c.youName == "Sam Carter" && c.youPicture != nil }
        sessions.value = nil
        c.start()
        check(got && c.youName == nil && c.youPicture == nil, "a sign-out forgets the person's name and picture")
        c.stop()
    }

    section("every request to the computer says it is the board's own; Kosmos+ itself is left alone (kosmos#7075)")
    do {
        let (c, w, _, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        let dana = c.agents.first { $0.session == "dana" }!
        _ = await c.thread(for: "dana")
        await c.post("hello", to: dana)
        let file = testFiles.appendingPathComponent("fs-7075.txt")
        try? FileManager.default.createDirectory(at: testFiles, withIntermediateDirectories: true)
        try? Data("x".utf8).write(to: file)
        await c.attach(.file(file), epoch: c.chatEpoch, to: dana)
        let toMac = w.fetchSites.filter { $0.0.contains(" studio.kosmosplus.com/") }
        let toCoordinator = w.fetchSites.filter { $0.0.contains(" " + (coordinator.host ?? "") + "/") }
        check(toMac.count >= 4 && toMac.allSatisfy { $0.1 == "same-origin" }, "the gate, status, chat read, send and upload all say same-origin: \(toMac.filter { $0.1 != "same-origin" }.map(\.0))")
        check(toMac.contains { $0.0.hasSuffix("/_kosmos/session") } && toMac.contains { $0.0.hasSuffix("/attachment") }, "premise: the sign-in to the computer and an upload were among them")
        check(!toCoordinator.isEmpty && toCoordinator.allSatisfy { $0.1.isEmpty }, "requests to Kosmos+ itself carry none")
        c.stop()
    }
    check(Board.forMac(URLRequest(url: URL(string: "https://LOGIN.kosmosplus.com/v1/x")!), coordinator: URL(string: "https://login.kosmosplus.com")!)
            .value(forHTTPHeaderField: "Sec-Fetch-Site") == nil, "the coordinator is matched without regard to case")

    section("native chat: a reply and a reaction through the client, against a fake Mac (kosmos#7083)")
    do {
        let (c, w, _, _) = make("kst1")
        c.start()
        _ = await settle { isLive(c) }
        let dana = c.agents.first { $0.session == "dana" }!
        w.sendQueue = [(409, #"{"error":"Dana is at its trust prompt"}"#), (200, #"{"delivery":{"state":"placed","at":"2026-10-24T11:00:00.000Z"},"recorded":true}"#)]
        await c.post("yes", replyTo: "2026-10-24T10:00:00.000Z", to: dana)
        check(w.postedReplies.last == "2026-10-24T10:00:00.000Z" && c.pending["dana"]?.last?.replyTo == "2026-10-24T10:00:00.000Z",
              "a reply posts its reply_to, and the bubble keeps it")
        await c.retry(c.pending["dana"]!.last!.id, to: dana)
        check(w.postedReplies.suffix(2) == ["2026-10-24T10:00:00.000Z", "2026-10-24T10:00:00.000Z"], "a retry sends the same reply_to")
        // The Mac refuses a reply whose original has gone: "Send as a new message" sends it without one.
        w.sendQueue = [(409, #"{"error":"That message is no longer in this conversation."}"#), (200, #"{"delivery":{"state":"placed","at":"2026-10-24T11:01:00.000Z"},"recorded":true}"#)]
        await c.post("about that", replyTo: "2026-10-20T09:00:00.000Z", to: dana)
        let stale = c.pending["dana"]!.last!
        check(stale.failed && stale.replyTo == "2026-10-20T09:00:00.000Z", "premise: the stale reply failed and keeps its reply_to")
        let before = w.posted.count
        // Dana stopped: the retry does not go, and the reply stays on the bubble.
        let wasStatus = w.statusDefault
        w.statusDefault = (200, #"{"agents":[{"sessionName":"dana","name":"Dana","state":"stopped","running":false}]}"#)
        await c.refreshNow()
        check(!c.isRunning(dana), "premise: Dana is not running now")
        await c.retryWithoutReply(stale.id, to: dana)
        check(w.posted.count == before && c.pending["dana"]?.first(where: { $0.id == stale.id })?.replyTo == "2026-10-20T09:00:00.000Z",
              "a retry that does not go (the agent stopped) keeps the reply")
        w.statusDefault = wasStatus
        await c.refreshNow()
        await c.retryWithoutReply(stale.id, to: dana)
        check(w.postedReplies.last == "" && w.posted.last == "about that", "Send as a new message: the same words, with no reply_to")
        // kosmos#7136: a reply that failed is not offered again (the board's rule; the Mac refuses retry_of on a reply).
        var lostReply = Board.ChatRow(id: "lr", atRaw: "T8", at: nil, text: "still yes", who: .person, notSent: Board.failedWords,
                                      resendable: true, retryable: true)
        lostReply.replyTo = "2026-10-24T10:00:00.000Z"
        let postsBeforeReply = w.posted.count
        let replyAgain = await c.sendAgain(lostReply, newestMineAt: nil, to: dana)
        check(replyAgain == nil && w.posted.count == postsBeforeReply, "a failed reply is not sent again, as on the board")
        w.reactAnswer = (200, #"{"ok":true,"op":"add","emoji":"x","at":"T1","reactions":[{"emoji":"x","count":1,"who":["you"],"mine":true}]}"#)
        let r = await c.react("x", at: "T1", to: dana)
        check(r == .reacted(at: "T1", pills: [Board.ChatReaction(emoji: "x", count: 1, mine: true)]) && w.reacted.last == "T1|x",
              "a reaction goes to the agent's thread/react and comes back with the pills")
        c.stop()
    }

    section("native chat: adding files and sending them, against a fake Mac (kosmos#7071)")
    do {
        // A copy an earlier run never finished sending (the app was closed mid-upload).
        let stale = testUploads.appendingPathComponent("earlier-run", isDirectory: true)
        try? FileManager.default.createDirectory(at: stale, withIntermediateDirectories: true)
        try? Data("half sent".utf8).write(to: stale.appendingPathComponent("deck.pdf"))
        let staleWritten = FileManager.default.fileExists(atPath: stale.appendingPathComponent("deck.pdf").path)
        let (c, w, _, _) = make("kst1")
        check(staleWritten && !FileManager.default.fileExists(atPath: stale.path), "a copy left by an earlier run is removed at launch")
        c.start()
        _ = await settle { isLive(c) }
        let dana = c.agents.first { $0.session == "dana" }!
        let uploadsRoot = testUploads
        func pending() -> [Board.PendingSend] { c.pending["dana"] ?? [] }
        func attached() -> [Board.Attached] { c.attached["dana"] ?? [] }
        func leftOver() -> [String] { (try? FileManager.default.contentsOfDirectory(atPath: uploadsRoot.path)) ?? [] }
        func picked(_ name: String, _ bytes: String = "bytes") -> URL {
            let folder = testFiles.appendingPathComponent("picked-\(UUID().uuidString)", isDirectory: true)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let file = folder.appendingPathComponent(name)
            try? Data(bytes.utf8).write(to: file)
            return file
        }
        func add(_ url: URL) async { await c.attach(.file(url), epoch: c.chatEpoch, to: dana) }

        let a = picked("deck.pdf", "%PDF-1.4 deck")
        await add(a)
        check(w.uploads.count == 1 && w.uploads[0].path == "/api/agent/dana/attachment" && w.uploads[0].type == "application/pdf"
              && w.uploads[0].name == "deck.pdf" && w.uploads[0].bytes == Data("%PDF-1.4 deck".utf8),
              "a picked file goes up at once: the agent's route, its type from its name, its name and its bytes")
        check(attached().map(\.name) == ["deck.pdf"] && c.uploading["dana"] == 0, "and waits on the composer")
        check(FileManager.default.fileExists(atPath: a.path), "the person's own file is never removed (the client sends a copy)")
        check(w.uploads[0].file.hasPrefix(uploadsRoot.standardizedFileURL.path + "/") && w.uploads[0].file != a.standardizedFileURL.path,
              "what was sent is the client's copy, in the app's uploads folder (control for the checks that it is gone)")
        check(leftOver().isEmpty, "and the copy, with its folder, is gone once sent")

        w.uploadQueue = [(413, #"{"error":"that file is over 100 MB"}"#)]
        await add(picked("big.mov"))
        check(attached().count == 1 && c.attachLine["dana"] == "that file is over 100 MB", "a refused file is not added, and the line says the Mac's words")
        check(leftOver().isEmpty, "its copy is removed too")

        // Too large: refused before any copy or byte is sent (a sparse file, so the test writes nothing large).
        let huge = picked("huge.mov")
        if let h = try? FileHandle(forWritingTo: huge) { try? h.truncate(atOffset: UInt64(Board.maxFileBytes + 1)); try? h.close() }
        let uploadsBefore = w.uploads.count
        await add(huge)
        check(w.uploads.count == uploadsBefore && c.attachLine["dana"] == "That file is over 100 MB, which is the most a message can carry." && leftOver().isEmpty,
              "too large: refused before it is copied or sent")

        // A folder (a package from Files): said plainly, never sent as a failed upload.
        let folderPick = testFiles.appendingPathComponent("Report.pages", isDirectory: true)
        try? FileManager.default.createDirectory(at: folderPick, withIntermediateDirectories: true)
        await add(folderPick)
        check(w.uploads.count == uploadsBefore && c.attachLine["dana"] == "Report.pages is a folder, so it cannot go in a message. Add the files inside it, or a zip of it.",
              "a folder is refused with its own sentence")

        // A photo: its name and bytes from the picker.
        await c.attach(.photo(load: { ("Photo 2026-10-24 at 18.30.05.jpg", Data([0xFF, 0xD8, 0xFF, 0xE0])) }), epoch: c.chatEpoch, to: dana)
        check(w.uploads.last?.type == "image/jpeg" && w.uploads.last?.name == "Photo%202026-10-24%20at%2018.30.05.jpg" && w.uploads.last?.bytes == Data([0xFF, 0xD8, 0xFF, 0xE0]),
              "a photo goes up as a JPEG under its own name")
        check(attached().count == 2 && c.attachLine["dana"] == "Report.pages is a folder, so it cannot go in a message. Add the files inside it, or a zip of it.",
              "a refusal stays while the next file goes up (the screen clears the line once per pick)")
        c.attachLine["dana"] = nil
        await c.attach(.photo(load: { nil }), epoch: c.chatEpoch, to: dana)
        check(c.attachLine["dana"] == "We could not read that photo." && c.uploading["dana"] == 0, "a photo that cannot be read is said, and nothing waits")
        c.unattach(attached()[1].id, for: "dana")
        check(attached().map(\.name) == ["deck.pdf"], "the x takes one off the composer")

        // Sent with no words: the names are the words, the ids ride along, and the composer is free again.
        let deckId = attached()[0].id
        await c.post("  ", files: attached(), to: dana)
        check(w.posted.last == "deck.pdf" && w.postedAttachments.last == [deckId], "files with no words: their names as the words, and their ids")
        check(attached().isEmpty && pending().last?.files.map(\.id) == [deckId], "the files leave the composer and ride the bubble")

        // A failed send keeps its files on the bubble, and the retry sends them again.
        await add(picked("shot.png"))
        let shot = attached()
        w.sendQueue = [(409, #"{"error":"Dana is at its trust prompt"}"#), (200, #"{"delivery":{"state":"placed","at":"2026-10-23T21:00:00.000Z"},"recorded":true}"#)]
        await c.post("look at this", files: shot, to: dana)
        check(pending().last?.failed == true && pending().last?.files == shot, "a refused send keeps its files")
        await c.retry(pending().last!.id, to: dana)
        check(w.postedAttachments.suffix(2) == [shot.map(\.id), shot.map(\.id)] && w.posted.last == "look at this",
              "the retry sends the same words and the same files")

        // Ten waiting: the eleventh is refused before it is sent.
        for i in 0..<10 { await add(picked("f\(i).txt")) }
        let tenth = w.uploads.count
        await add(picked("f10.txt"))
        check(attached().count == 10 && w.uploads.count == tenth && c.attachLine["dana"] == "A message can carry 10 files; send these first.",
              "an eleventh file is refused, and nothing is sent")
        for f in attached().dropFirst() { c.unattach(f.id, for: "dana") }

        // A send with the composer's files waits while another file is on its way; one sent again from a row does not.
        w.uploadYields = 50
        let going = Task { await add(picked("slow.pdf")) }
        _ = await settle { c.uploading["dana"] == 1 }
        let postsBefore = w.posted.count
        let sentWithChips = await c.post("now", files: attached(), to: dana)
        check(!sentWithChips && w.posted.count == postsBefore && attached().count == 1, "the composer's files are not sent while another is still going up")
        let wordsOnly = await c.post("words only", to: dana)
        check(wordsOnly && w.posted.last == "words only", "words alone still go, as on the board")
        // kosmos#7136: a failed message with a file is not offered again (the board's rule; retry_of takes words only).
        var lost = Board.ChatRow(id: "y", atRaw: "T9", at: nil, text: "deck.pdf", who: .person, notSent: Board.failedWords,
                                 resendable: true, retryable: true)
        lost.attachments = [Board.Attachment(id: deckId, name: "deck.pdf", type: "application/pdf", size: 13, kind: "pdf",
                                             url: "/api/attachment/" + deckId, preview: nil)]
        let postsBeforeLost = w.posted.count
        let lostAgain = await c.sendAgain(lost, newestMineAt: nil, to: dana)
        check(lostAgain == nil && w.posted.count == postsBeforeLost, "a failed message with a file is not sent again, as on the board")
        await going.value
        w.uploadYields = 0
        check(attached().map(\.name) == ["f0.txt", "slow.pdf"] && c.uploading["dana"] == 0, "and the file that was going up lands on the composer")

        // Another account meanwhile: an upload that answers late adds nothing, and a pick made before is never sent.
        w.uploadYields = 50
        let before = c.chatEpoch
        let late = Task { await add(picked("late.pdf")) }
        _ = await settle { c.uploading["dana"] == 1 }
        c.accountChanged()
        await late.value
        w.uploadYields = 0
        check(c.attached.isEmpty && c.uploading.isEmpty && c.attachLine.isEmpty, "a sign-out drops the waiting files, and a late answer adds nothing")
        let afterSignOut = w.uploads.count
        await c.attach(.file(picked("queued.pdf")), epoch: before, to: dana)
        check(w.uploads.count == afterSignOut && c.attached.isEmpty && (c.uploading["dana"] ?? 0) == 0,
              "a pick from before the sign-out is never sent under the new one, and leaves nothing counted as on its way")
        check(leftOver().isEmpty, "and no copy is left on the phone")
        c.stop()
    }

    section("native chat: the client's sends and reads, against a fake Mac (kosmos#7008)")
    // kosmos#7093: a project room's files go through the same attach, under the room's own key and its own request
    // (this suite compiles without BoardRoom.swift, so the room's route and key are written out here), and a post that
    // did not go puts its files back in front of any added since, never twice.
    do {
        let (c, w, _, _) = make("kst-room")
        c.start()
        _ = await settle { isLive(c) }
        let key = "room:springcatalogue"
        let folder = testFiles.appendingPathComponent("picked-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("cover.jpg")
        try? Data("jpeg bytes".utf8).write(to: file)
        await c.attach(.file(file), epoch: c.chatEpoch, key: key, sample: false) { mac, name, type in
            var r = URLRequest(url: URL(string: "/api/project/springcatalogue/attachment", relativeTo: mac)!.absoluteURL)
            r.httpMethod = "PUT"
            return Board.uploadHeaders(r, name: name, type: type)
        }
        check(w.uploads.last?.path == "/api/project/springcatalogue/attachment" && c.attached[key]?.map(\.name) == ["cover.jpg"]
              && (c.attached["dana"] ?? []).isEmpty, "a room's pick goes to the project's route and waits under the room's key, not an agent's")
        let sent = c.attached[key] ?? []
        for f in sent { c.unattach(f.id, for: key) }
        let later = Board.Attached(id: "0000000000000000000000ff", name: "later.pdf")
        c.reattach([later], for: key)
        c.reattach(sent, for: key)
        c.reattach(sent, for: key)
        check(c.attached[key]?.map(\.name) == ["cover.jpg", "later.pdf"], "files put back go in front of those added since, and never twice")
    }

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

        // kosmos#7136: a message the Mac could not deliver is sent again into the SAME row (retry_of), as the board's
        // dmRetrySend, so the person sees one message, not two.
        let lostRow = Board.ChatRow(id: "x", atRaw: "T", at: nil, text: "Are you there?", who: .person, notSent: Board.failedWords,
                                    resendable: true, retryable: true)
        let postedBefore = w.posted.count
        w.postYields = 50
        let first = Task { await c.sendAgain(lostRow, newestMineAt: "T", to: dana) }
        let going = await settle { c.isSendingAgain(lostRow, for: "dana") }
        let busyMeanwhile = c.isSending("dana")
        let second = await c.sendAgain(lostRow, newestMineAt: "T", to: dana)
        let firstSaid = await first.value
        w.postYields = 0
        check(going && second == nil, "while it is going the row is marked as going (\"sending…\"), and a second tap sends nothing")
        check(w.posted.last == "Are you there?" && w.postedRetryOf.last == "T" && w.postedReplies.last == "" && w.postedAttachments.last == [],
              "Try again sends the same words with retry_of naming the row, and no reply or files")
        check(w.posted.count == postedBefore + 1, "it posted once")
        check(busyMeanwhile && !c.isSending("dana"), "a Try again counts as a send in the air while it goes (so a press waits), and not after")
        check(firstSaid == Board.RetrySaid(said: "Sent.", refused: false) && !c.isSendingAgain(lostRow, for: "dana"),
              "placed says Sent., and the row is no longer marked as going")
        let behind = await c.sendAgain(lostRow, newestMineAt: "T-later", to: dana)
        check(behind == nil && w.posted.count == postedBefore + 1, "not the newest message of the person's: not sent again (it would arrive out of order)")
        w.sendQueue = [(409, #"{"error":"that message is being sent again now"}"#)]
        let busy = await c.sendAgain(lostRow, newestMineAt: "T", to: dana)
        check(busy == Board.RetrySaid(said: "That message is being sent again now.", refused: true), "a refusal keeps the Mac's words, as a sentence")

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
        check(c.pending.isEmpty && c.drafts.isEmpty && c.resending.isEmpty && c.chatEpoch > epoch,
              "another session after a read with none: all of it is gone, and the open chat resets")
        _ = await settle { isLive(c) }
        await hold()
        let before = c.chatEpoch
        c.accountChanged()
        check(c.pending.isEmpty && c.drafts.isEmpty && c.resending.isEmpty && c.chatEpoch > before,
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
        let lostRow = Board.ChatRow(id: "lost", atRaw: "T", at: nil, text: "Are you there?", who: .person, notSent: Board.failedWords,
                                    resendable: true, retryable: true)
        let pressPosts = w.posted.count
        let duringPress = await c.sendAgain(lostRow, newestMineAt: "T", to: dana)
        check(duringPress == nil && w.posted.count == pressPosts && !c.isSendingAgain(lostRow, for: "dana"),
              "Try again while a press is in the air does nothing, and the row still offers it")
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

    section("native board loop: one or two missed session requests are not \"not answering\" (kosmos#7197)")
    do {
        // Josh, 10-26 08:29: the relay delivered the request to his Mac and the app said "isn't answering" on the first
        // miss. Two misses, then the gate answers: the board opens, and the screen never said the Mac was not answering.
        let (c, w, _, _) = make("kst1")
        w.sessionNoAnswerFirst = 2
        var saidUnreachable = false
        c.start()
        let opened = await settle {
            if case .unreachable = c.phase { saidUnreachable = true }
            return isLive(c)
        }
        check(opened && !saidUnreachable && w.sessionNoAnswerFirst == 0, "two misses then an answer: live, never \"not answering\"")
        check(c.shownMacName == "Studio", "the shown Mac is named for a chat that stops updating while the phase names none")
        c.stop()
        // CONTROL: three misses in a row still say it, naming the Mac.
        let (c2, w2, _, _) = make("kst1")
        w2.sessionNoAnswer = true
        c2.start()
        let said = await settle { c2.phase == .unreachable(mac: "Studio") }
        check(said, "CONTROL: three misses in a row say the Mac (Studio) is not answering")
        check(w2.count("/_kosmos/session") == 3, "after exactly three session requests, not one: \(w2.count("/_kosmos/session"))")
        c2.stop()
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
        check(c.agentSort == .talked, "kosmos#7421: a new phone starts on the desktop's default, Last talked to")
        c.setAgentSort(.needs, projects: [:])   // kosmos#7421: the order these rows are held in, Needs you first
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
check(AppTabs.visible(tasksTab: true, todayTab: true) == [.today, .agents, .projects, .tasks, .settings], "five tabs in Mona Lisa's order once Tasks is earned")
check(AppTabs.visible(tasksTab: false, todayTab: true) == [.today, .agents, .projects, .settings], "four before it, Tasks left out (#3559)")
check(AppTabs.keep(.tasks, tasksTab: false, todayTab: true) == .today, "Tasks leaving the bar while showing goes to Today")
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
check(AppTabs.visible(tasksTab: true, todayTab: true).map(\.title) == ["Today", "Agents", "Projects", "Tasks", "Settings"], "the bar's words, in order")
check(AppTabs.visible(tasksTab: true, todayTab: true).map(\.symbol) == ["sun.max", "person.2", "briefcase", "checklist", "gearshape"], "the spec's symbols (#7266: a briefcase for Projects)")
check(AppTabs.Tab.agents.asset == "TabAgent" && AppTabs.Tab.allCases.filter { $0 != .agents }.allSatisfy { $0.asset == nil }, "#7266: Agents draws its own icon, the rest SF Symbols")

section("app tabs: press bookkeeping")
do {
    var t = PressTracker()
    // kosmos#7032 + #7031: every tab in the bar is native now (Projects and Tasks too), so a board press is a section
    // press (section: true), the way a native screen opens the board's own section; the board's Tasks section is the
    // example.
    check(t.press(.tasks, page: .noView, section: true) == nil && t.pending == .tasks, "with no web view yet (a signed-in launch on Agents) the tracker keeps the press (BoardWeb runs it at the load)")
    check(t.press(.tasks, page: .loading, section: true) == nil && t.pending == .tasks, "a page still loading: the press waits")
    var native = PressTracker()
    check(native.press(.projects, page: .ready) == nil && native.pending == nil, "#7032: the native Projects tab runs nothing")
    check(native.press(.tasks, page: .ready) == nil && native.pending == nil, "#7031: the native Tasks tab runs nothing")
    let serialBefore = t.serial
    let run = t.press(.tasks, page: .ready, section: true)
    check(run != nil && run?.script == AppTabs.pressScript(.tasks) && run?.serial == serialBefore + 1, "a ready page: the press runs, with a new number")
    check(t.answered(serial: run!.serial, .absent, pageURL: nil) == nil && t.pending == .tasks, "no door: it still waits")
    let waiting = t.press(.tasks, page: .ready, section: true)!
    check(t.running, "the press is running while it waits for its answer")
    check(t.answered(serial: waiting.serial, .absent, pageURL: nil) == nil && !t.running && t.pending == .tasks, "no answer: it waits for a load, but no longer holds the bar")
    let again = t.press(.tasks, page: .ready, section: true)!
    check(t.answered(serial: again.serial, .opened, pageURL: nil) == .tasks && t.pending == nil && !t.running, "opened: over, and the bar goes to the tab pressed")

    var u = PressTracker()
    let first = u.press(.tasks, page: .ready, section: true)!
    let second = u.press(.tasks, page: .ready, section: true)!
    check(u.answered(serial: first.serial, .refused, pageURL: roomURL) == nil && u.pending == .tasks, "a late answer to an earlier press moves nothing and ends nothing")
    check(u.answered(serial: second.serial, .refused, pageURL: roomURL) == .projects && u.pending == nil, "the latest press's refusal ends it and moves the bar to the page's tab")

    var v = PressTracker()
    let shown = v.press(.tasks, page: .ready, section: true)!
    v.loadingOwnPage()
    check(v.pending == nil && v.answered(serial: shown.serial, .refused, pageURL: settingsURL) == nil, "an agent tap ends a press, and a late refusal of it cannot move the bar")
    _ = v.press(.tasks, page: .loading, section: true)
    check(v.press(.agents, page: .ready) == nil && v.pending == nil, "the native tab ends a waiting press")
    _ = v.press(.tasks, page: .loading, section: true)
    check(v.press(.settings, page: .ready) == nil && v.pending == nil, "#7010: the native Settings tab runs nothing and ends a waiting press too")
    _ = v.press(.tasks, page: .loading, section: true)
    check(v.press(.projects, page: .ready) == nil && v.pending == nil, "#7032: the native Projects tab runs nothing and ends a waiting press too")
    _ = v.press(.tasks, page: .loading, section: true)
    check(v.press(.tasks, page: .ready) == nil && v.pending == nil, "#7031: the native Tasks tab (a tab press, not the board's section) runs nothing and ends a waiting press too")
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
    let before = w.press(.tasks, page: .ready, section: true)!
    let page = w.generation
    check(w.read(true, generation: page) == true && w.readThisLaunch, "a read before the lock counts")
    w.drop(selected: .tasks)
    check(w.pending == nil && !w.readThisLaunch, "#7031: after a lock the fresh page reads again; on the native Tasks tab there is nothing to replay")
    check(w.answered(serial: before.serial, .opened, pageURL: nil) == nil && w.pending == nil, "a late answer from the dropped page moves nothing")
    check(w.read(true, generation: page) == nil && !w.readThisLaunch, "nor does a late Tasks read from it count")
    check(AppTabs.Tab.allCases.allSatisfy { tab in var x = PressTracker(); x.drop(selected: tab); return x.pending == nil }, "#7032 + #7031: a lock on any tab leaves nothing to press, since every tab in the bar is native")
}

section("app tabs: the bar follows the page")
do {
    let home = URL(string: "https://studio.kosmosplus.com/")
    let signIn = URL(string: "https://\(AppTabs.signInHost)/")
    func f(_ from: URL?, _ to: URL?, _ selected: AppTabs.Tab, held: Bool = false, tasks: Bool = false) -> AppTabs.Tab? {
        AppTabs.follow(from: from, to: to, selected: selected, barHeld: held, tasksTab: tasks)
    }
    // kosmos#7032: Projects is native, so the board's project pages show under Today and never move the native list.
    check(f(home, roomURL, .today) == nil, "#7032: a link from the board's home into a project room stays under Today")
    check(f(roomURL, home, .projects) == nil, "#7032: the native Projects tab is not moved by the hidden page")
    check(f(roomURL, home, .tasks, tasks: true) == nil, "#7031: the native Tasks tab is not moved by the hidden page")
    let tasksURL = URL(string: "https://studio.kosmosplus.com/?tab=tasks")
    // kosmos#7031: with Tasks native as well as Projects (#7032), every board section shows under Today (the board's own
    // "agents" section IS Today), so the hidden page can no longer move the bar from any tab. No control can show a move
    // because none exists; this sweeps every section against every tab instead, so a section that starts lighting a
    // tab again fails here by name.
    let sections = ["", "?tab=agents", "?tab=detail&agent=a", "?tab=projects", "?tab=projects&project=x", "?tab=tasks", "?tab=settings"]
    for q in sections {
        for tab in AppTabs.Tab.allCases {
            for offered in [false, true] {
                check(f(signIn, URL(string: "https://studio.kosmosplus.com/" + q), tab, tasks: offered) == nil, "#7031: the page \(q.isEmpty ? "home" : q) moves nothing from \(tab.title) (Tasks \(offered ? "offered" : "not offered"))")
            }
        }
    }
    check(f(home, settingsURL, .today, held: true) == nil, "the bar held for a press: its answer decides, not the address")
    check(f(home, settingsURL, .agents) == nil, "never from Agents, which shows no page")
    check(f(home, nil, .settings) == nil, "no address: nothing moves")
    check(f(home, signIn, .today) == nil, "never on the sign-in page")
    let roomTwo = URL(string: "https://studio.kosmosplus.com/?tab=projects&project=y")
    check(f(roomURL, roomTwo, .settings) == nil, "an address rewritten within one section (Settings opened over the consolidated layout keeps ?tab=projects) moves nothing")
    check(f(home, tasksURL, .today) == nil && f(home, tasksURL, .today, tasks: true) == nil, "#7032 + #7031: the board's Tasks section shows under Today, whether or not the bar offers Tasks")
    check(f(roomURL, tasksURL, .today, tasks: true) == nil, "#7031: a project's View all onto the board's Tasks section stays under Today")
    check(f(signIn, roomURL, .today) == nil, "from the sign-in page to a project page keeps Today")
    check(AppTabs.barTab(forPage: .tasks, tasksTab: false) == .today && AppTabs.barTab(forPage: .tasks, tasksTab: true) == .today && AppTabs.barTab(forPage: .projects, tasksTab: false) == .today, "#7032 + #7031: the board's Tasks section and its project pages show under Today")
    check(AppTabs.barTab(forPage: .agents, tasksTab: true) == .agents, "the board's Agents page lights the Agents tab, which the bar offers")
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
    check(r.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin", "as the board's own, so Kosmos+ gives it the computer's token (kosmos#7075)")
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

section("no banner for the conversation on screen (kosmos#7420)")
// Josh 10-27: a banner for the chat he had open dropped over it. The relay's push shape (kind, session, address).
let openDana = PushBridge.OpenChat(host: "M-ABC123.kosmosplus.com", session: "dana")
let danaReplied: [AnyHashable: Any] = ["kind": "replied", "id": "reply:x:dana", "address": "m-abc123.kosmosplus.com", "session": "dana"]
check(!PushBridge.showsBanner(danaReplied, openChat: openDana), "an answer from the chat on screen: no banner (address without case)")
var danaAsks = danaReplied; danaAsks["kind"] = "needs_you"
check(!PushBridge.showsBanner(danaAsks, openChat: openDana), "a question from the chat on screen: no banner")
check(PushBridge.showsBanner(danaReplied, openChat: nil), "CONTROL: no chat open: the banner shows")
var eliReplied = danaReplied; eliReplied["session"] = "eli"
check(PushBridge.showsBanner(eliReplied, openChat: openDana), "another agent: the banner shows")
var danaElsewhere = danaReplied; danaElsewhere["address"] = "m-zzz999.kosmosplus.com"
check(PushBridge.showsBanner(danaElsewhere, openChat: openDana), "the same name on another computer: the banner shows")
for kind in ["posted", "ready"] {
    var k = danaReplied; k["kind"] = kind
    check(PushBridge.showsBanner(k, openChat: openDana), "a \(kind) notice from that agent is not the conversation itself: the banner shows")
}
var noKind = danaReplied; noKind["kind"] = nil
check(PushBridge.showsBanner(noKind, openChat: openDana), "a notice with no kind shows, as before")

section("phone notice: a room post names its room (kosmos#7032)")
// The push exactly as the relay sends it (kosmos-relay coordinator/src/apns.rs payload): no project in it.
let postPush: [AnyHashable: Any] = ["aps": ["alert": ["title": "Dana posted"], "mutable-content": 1], "kind": "posted", "id": "post:m901", "address": "m-abc123.kosmosplus.com", "session": "dana"]
check(PushBridge.roomToOpen(fromNotification: postPush, coordinator: coordinator) == nil, "CONTROL: the push alone opens no room (it never names one)")
let postAnswer = Data(#"{"kind":"post","session":"dana","agent":"Dana","text":"Copy is done.","picture":null,"project":"springcatalogue"}"#.utf8)
if let pw = PhoneNotice.words(status: 200, contentType: json, data: postAnswer, userInfo: postPush) {
    check(pw.project == "springcatalogue", "the computer's answer names the room")
    let filled = PhoneNotice.withRoom(pw, userInfo: postPush)
    check(PushBridge.roomToOpen(fromNotification: filled, coordinator: coordinator) == PushBridge.RoomTarget(host: "m-abc123.kosmosplus.com", project: "springcatalogue"), "once the extension writes it, a tap opens that room")
    var replied = postPush; replied["kind"] = "replied"
    check(PhoneNotice.withRoom(pw, userInfo: replied)[PhoneNotice.roomInfoKey] == nil, "CONTROL: only a posted notice is given a room")
    check(PhoneNotice.conversation(pw) == "room|springcatalogue", "a room post joins its room's thread in Notification Center, not the agent's")
} else { check(false, "a room post's answer is read") }
if let rw = PhoneNotice.words(status: 200, contentType: json, data: Data(#"{"kind":"post","session":"dana","agent":"Dana","text":"Copy is done.","picture":null}"#.utf8), userInfo: postPush) {
    check(PhoneNotice.withRoom(rw, userInfo: postPush)[PhoneNotice.roomInfoKey] == nil, "an older computer that names no room: the notice opens the agent, as before")
    check(PhoneNotice.conversation(rw) == "dana", "CONTROL: with no room named, the agent's thread")
} else { check(false, "an answer with no project is still read") }
check(PhoneNotice.words(status: 200, contentType: json, data: Data(#"{"kind":"post","session":"dana","agent":"Dana","text":"Hi","picture":null,"project":7}"#.utf8), userInfo: postPush)?.text == "Hi", "a project this build cannot read costs only the room, never the words")

section("phone notice: the agent's picture")
if let w {
    check(PhoneNotice.pictureRequest(w, userInfo: pushed, stored: savedMac)?.url?.absoluteString == "https://m-abc123.kosmosplus.com/api/agent/irma/avatar", "the picture comes from the same computer's avatar route")
    check(PhoneNotice.pictureRequest(w, userInfo: pushed, stored: savedMac)?.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin", "and says it is the board's own (kosmos#7075)")
    for bad in ["https://evil.example/api/agent/irma/avatar", "//evil.example/api/agent/irma/avatar", "/api/agent/../../etc/avatar", "/api/status", "/api/agent/irma/avatar?x=1"] {
        let b = PhoneNotice.Words(kind: w.kind, session: w.session, agent: w.agent, text: w.text, picture: bad)
        check(PhoneNotice.pictureRequest(b, userInfo: pushed, stored: savedMac) == nil, "a picture address off that route is refused: \(bad)")
    }
    check(PhoneNotice.pictureRequest(PhoneNotice.Words(kind: "report", session: "irma", agent: "Irma", text: "x", picture: nil), userInfo: pushed, stored: savedMac) == nil, "no picture: no request")
}
// kosmos#7345: a "ready" (work waiting for the person's check) has no words to ask for, and still shows its agent's picture.
do {
    // Shaped as the relay sends it (kosmos-relay apns.rs payload: kind, id, address, session; no shown name).
    let ready: [AnyHashable: Any] = ["id": "built:p1:4:1793000000000", "address": "m-abc123.kosmosplus.com", "session": "irma", "kind": "ready"]
    check(PhoneNotice.wordsRequest(userInfo: ready, stored: savedMac) == nil, "kosmos#7345: a ready push has no words to ask for (its id is not askable)")
    check(PhoneNotice.pictureOnlyRequest(userInfo: ready, stored: savedMac)?.url?.absoluteString == "https://m-abc123.kosmosplus.com/api/agent/irma/avatar",
          "its picture comes from the same computer's avatar route, for the session the push names")
    check(PhoneNotice.pictureOnlyRequest(userInfo: ready, stored: savedMac)?.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin", "and says it is the board's own")
    for bad in ["../x", "Irma", "", "a/b", "a.b", "a%2Fb", String(repeating: "a", count: 65)] {
        var b = ready; b["session"] = bad
        check(PhoneNotice.pictureOnlyRequest(userInfo: b, stored: savedMac) == nil, "CONTROL: a session the app would not accept is never asked for: \(bad)")
    }
    var other = ready; other["address"] = "m-other.kosmosplus.com"
    check(PhoneNotice.pictureOnlyRequest(userInfo: other, stored: savedMac) == nil, "CONTROL: never another computer's")
    check(PhoneNotice.pictureOnlyRequest(userInfo: ready, stored: nil) == nil, "CONTROL: nothing without the app's kept session")
    // The extension's copy of the app's session rule agrees with the app's on every case here.
    for s in ["irma", "a-b_c", "9x", "Irma", "-a", "_a", "a.b", "", String(repeating: "a", count: 64), String(repeating: "a", count: 65)] {
        check(PhoneNotice.isAgentSession(s) == PushBridge.isAgentSession(s), "the extension's session rule matches the app's: \(s.prefix(10))")
    }
    check(PhoneNotice.soundName == "bubble-pop.caf", "the notification sound is the bubble pop shipped in the app")
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

section("sign-in: the App Store review door (kosmos#7357)")
do {
    check(SignIn.reviewDoorOpen(status: 405) == true, "open: the door takes POST only, so a GET answers 405 (kosmos-relay review.rs)")
    check(SignIn.reviewDoorOpen(status: 404) == false, "closed: it answers like a path that does not exist")
    check(SignIn.reviewDoorOpen(status: 200) == nil && SignIn.reviewDoorOpen(status: 429) == nil && SignIn.reviewDoorOpen(status: 503) == nil,
          "CONTROL: any other answer is not read as open (no password sign-in on a guess)")
    let body = SignIn.reviewBody(email: "review@example.com", password: "p", deviceName: "iPhone")
    check(body.count == 3 && body["email"] as? String == "review@example.com" && body["password"] as? String == "p"
          && body["device_name"] as? String == "iPhone", "the review sign-in sends the email, the password and the name only")
    check(body["device_id"] == nil, "and no device id: the server makes its own review device")
    check(SignIn.reviewPath == "/v1/signin/review", "the door's path")
    // Its answer is verify's: a session that waits for the computer's Allow, and the server's device id is ignored.
    let admitted = SignIn.answer(status: 200, json: ["token": "t", "device_status": "pending", "match_code": "K7Q2",
                                                     "addresses": ["a"], "device_id": "review-1"] as [String: Any])
    check(admitted == .signedIn(SignIn.Session(token: "t", deviceStatus: .pending, matchCode: "K7Q2", hasComputer: true)),
          "an admitted review sign-in waits for the review computer's Allow, as any sign-in does")
    // Review 1: a refusal stays on the password step (never the code step: no code was sent), a 404 is the door closed.
    // The server's real bodies (kosmos-relay review.rs REFUSED, ratelimit::code_sends_refused).
    check(SignIn.reviewAnswer(status: 401, json: ["error": "that email and password do not match"]) == .refused("That email and password do not match."),
          "a wrong password stays on the password step, in Kosmos+'s words as a sentence")
    check(SignIn.reviewAnswer(status: 429, json: ["error": "too many codes asked for from this network; wait a moment and try again", "retry_after_secs": 20] as [String: Any]) == .refused(SignIn.reviewTooMany),
          "review 3: the door's rate limit says wait, never the code limiter's words about codes")
    check(SignIn.reviewAnswer(status: 401, json: ["error": "this account is being deleted"]) == .refused("This account is being deleted."),
          "CONTROL: a 401 that is not about the password keeps its own sentence")
    check(SignIn.sentence("Done already.") == "Done already." && SignIn.sentence("") == "", "a sentence that already ends is left as it is")
    check(SignIn.reviewAnswer(status: 403, json: ["error": "this account signs in through its company"]) == .refused("This account signs in through its company."),
          "and so does any other refusal")
    check(SignIn.reviewAnswer(status: 503, json: [:] as [String: Any]) == .refused(SignIn.reviewNoAnswer) && SignIn.reviewAnswer(status: 400, json: [:] as [String: Any]) == .refused(SignIn.reviewNoAnswer),
          "and a server error or a bad request says try again")
    check(SignIn.reviewAnswer(status: 401, json: [:] as [String: Any]) == .refused(SignIn.reviewRefused), "with no sentence from Kosmos+, the phone's own")
    check(SignIn.reviewAnswer(status: 404, json: nil) == .closed, "a 404 is the door closed since the link showed")
    // m733: on the very value the password step switches on (SignIn.reviewAnswer), from the server's answers.
    let admittedReview = SignIn.reviewAnswer(status: 200, json: ["token": "t", "device_status": "pending", "device_id": "review-1"] as [String: Any])
    check(SignIn.reviewDropsKey(admittedReview), "m733: an admitted review sign-in drops a key kept by an earlier code sign-in (its device is the server's review-*)")
    check(SignIn.reviewDropsKey(.answered(.second(kind: "totp", challenge: "c", sentTo: nil))), "and so would one going on to a second step, should the door ever ask")
    check(!SignIn.reviewDropsKey(SignIn.reviewAnswer(status: 401, json: ["error": "that email and password do not match"])), "CONTROL: a wrong password keeps the key")
    check(!SignIn.reviewDropsKey(SignIn.reviewAnswer(status: 404, json: nil)), "CONTROL: a closed door keeps the key")
    check(!SignIn.reviewDropsKey(SignIn.reviewAnswer(status: 200, json: ["nothing": true] as [String: Any])), "CONTROL: an answer this cannot read keeps the key")
    check(SignIn.reviewAnswer(status: 200, json: ["token": "t", "device_status": "pending"] as [String: Any]) == .answered(.signedIn(SignIn.Session(token: "t", deviceStatus: .pending, matchCode: nil, hasComputer: false))),
          "an admitted sign-in goes on to the Allow")
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
check(SignIn.answer(status: 200, json: jsonBody(#"{"enrol":true,"token":"enrol-only","sms_available":true}"#)) == .needsSetup(token: "enrol-only", sms: true), "an enrol-only token is never taken as a session")
check(SignIn.answer(status: 200, json: jsonBody(#"{"enrol":true}"#)) == .unknown, "enrol with no token is not guessed at")
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
check(SignIn.next(after: .needsSetup(token: "t", sms: false), email: "e").step == .setup(token: "t", sms: false) && SignIn.next(after: .needsSetup(token: "t", sms: false), email: "e").session == nil, "a second step to set up: set up here, and still no session")
check(SignIn.enrolled(status: 200, json: jsonBody(#"{"kind":"totp","otpauth":"otpauth://totp/Kosmos:a%40b.co?secret=ABCD","secret":"ABCDEFGHIJ"}"#)) == .totp(otpauth: "otpauth://totp/Kosmos:a%40b.co?secret=ABCD", secret: "ABCDEFGHIJ"), "the authenticator's link and secret")
check(SignIn.enrolled(status: 200, json: jsonBody(#"{"kind":"totp","otpauth":"https://evil.example/?secret=ABCD","secret":"ABCD"}"#)) == .refused("That did not work. Try again.") && SignIn.enrolled(status: 200, json: jsonBody(#"{"kind":"sms","sent_to":"x"}"#)) == .refused("That did not work. Try again."), "only an otpauth://totp/ link, and only for an authenticator")
check(SignIn.enrolled(status: 429, json: jsonBody(#"{"error":"Too many tries; wait a minute."}"#)) == .refused("Too many tries; wait a minute."), "a refusal keeps the coordinator's sentence")
check(SignIn.grouped(secret: "ABCDEFGHIJ") == "ABCD EFGH IJ" && SignIn.grouped(secret: "") == "", "the secret in groups of four")
check(SignIn.answer(status: 200, json: jsonBody(#"{"ok":true,"kind":"totp","token":"real","device_status":"pending","match_code":"K7Q2","addresses":["mini.kosmosplus.com"]}"#))
      == .signedIn(.init(token: "real", deviceStatus: .pending, matchCode: "K7Q2", hasComputer: true)), "confirm's answer (a session with ok and kind) is the first real session")
check(SignIn.startsOver("token invalid or expired; start again from the email") && SignIn.startsOver("nothing is being enrolled; Start again")
      && SignIn.startsOver("no such account") && SignIn.startsOver("this Kosmos+ account no longer exists")
      && SignIn.startsOver("this account signed out everywhere since; sign in again") && !SignIn.startsOver("that code is not the one we texted")
      && !SignIn.startsOver("that code is not what the app shows right now; wait for the next one and try again") && !SignIn.startsOver(nil), "only a refusal that says start again, or that the account is gone, leaves the screen")
check(SignIn.enrolBody()["kind"] as? String == "totp" && SignIn.confirmBody(code: "123456")["code"] as? String == "123456" && SignIn.confirmBody(code: "1").count == 1, "the setup requests carry only the kind, then only the code")
check(SignIn.next(after: .refused(message: nil, proofRefused: false), email: "e").step == .code(email: "e"), "a wrong code stays on the code")
check(SignIn.next(after: .refused(message: nil, proofRefused: true), email: "e").step == .web(reason: SignIn.webForKey), "a refused key: the web page")
check(SignIn.secondWords(kind: "sms", sentTo: nil).contains("your phone") && SignIn.secondWords(kind: "totp", sentTo: nil).contains("authenticator"), "the second step's words, as the web page's")
check(SignIn.secondWords(kind: "sms", sentTo: "+1 *** *** 0123").contains("+1\u{00A0}***\u{00A0}***\u{00A0}0123"), "a masked number stays whole (no breaking space inside it)")
check(SignIn.wrappable(email: "ada@example.com") == "ada@\u{200B}example.\u{200B}com" && SignIn.wrappable(email: "ada@example.com").replacingOccurrences(of: "\u{200B}", with: "") == "ada@example.com", "an address breaks only after @ or a dot, and reads unchanged")
check(SignIn.webTitle(reason: SignIn.webForCompany) == "Your company signs you in" && !SignIn.webTitle(reason: SignIn.webForSetup).contains("-"), "the hand-over titles (none with a hyphen to break at)")

section("sign-in: the document-start script puts the token where the sign-in page keeps it, as a string, never as script")
do {
    let origin = "https://login.kosmosplus.com"
    func page(_ at: String) -> JSContext {
        let ctx = JSContext()!
        ctx.evaluateScript("var location = { origin: " + "'" + at + "'" + " }; var writes = 0; var store = {}; var localStorage = { setItem: function (k, v) { writes++; store[k] = String(v); }, getItem: function (k) { return store.hasOwnProperty(k) ? store[k] : null; }, removeItem: function (k) { delete store[k]; } };")
        return ctx
    }
    func run(_ ctx: JSContext, _ token: String) { ctx.evaluateScript(SignIn.sessionScript(token: token, origin: origin) ?? "throw 'no script'") }
    let evil = #"t"]; localStorage.setItem("x", "pwned"); var b = [" "#
    let ctx = page(origin)
    run(ctx, evil)
    check(ctx.exception == nil && ctx.evaluateScript("store['kosmos_session']")?.toString() == evil, "the token arrives exactly, under the page's own key")
    check(ctx.evaluateScript("Object.keys(store).join(',')")?.toString() == "kosmos_session", "nothing else is written: a quote in the token is not script")
    check(SignIn.pageSessionKey == "kosmos_session", "the key signin.html restore() reads (kosmos-relay, localStorage only)")
    run(ctx, evil)
    check(ctx.evaluateScript("writes")?.toInt32() == 1, "the same session again writes nothing")
    ctx.evaluateScript("store['kosmos_session'] = 'dead-token-from-before';")
    run(ctx, "fresh")
    check(ctx.evaluateScript("store['kosmos_session']")?.toString() == "fresh", "a different session left on the page is replaced by the app's, before the page reads it")
    let other = page("https://mac-mini.kosmosplus.com")
    run(other, "fresh")
    check(other.evaluateScript("Object.keys(store).length")?.toInt32() == 0, "on another origin nothing is written")
    let throwing = JSContext()!
    throwing.evaluateScript("var location = { origin: '" + origin + "' }; var localStorage = { getItem: function () { throw new Error('denied'); }, setItem: function () { throw new Error('denied'); } };")
    throwing.evaluateScript(SignIn.sessionScript(token: "t", origin: origin) ?? "")
    check(throwing.exception == nil, "storage that throws breaks nothing on the page")
    let forgot = page(origin)
    forgot.evaluateScript("store['kosmos_session'] = 'abandoned';")
    forgot.evaluateScript(SignIn.sessionScript(token: nil, forget: ["abandoned"], origin: origin) ?? "")
    check(forgot.evaluateScript("store.hasOwnProperty('kosmos_session')")?.toBool() == false, "a session the app dropped is removed from the page")
    forgot.evaluateScript("store['kosmos_session'] = 'theirs';")
    forgot.evaluateScript(SignIn.sessionScript(token: nil, forget: ["abandoned"], origin: origin) ?? "")
    check(forgot.evaluateScript("store['kosmos_session']")?.toString() == "theirs", "any other session the page holds is left as it is")
    check(SignIn.sessionScript(token: nil, forget: [], origin: origin) == nil, "nothing held and nothing dropped: no script")
    check(SignIn.pageOrigin(coordinator) == origin && SignIn.pageOrigin(URL(string: "https://LOGIN.kosmosplus.com:443/x?y")!) == origin
          && SignIn.pageOrigin(URL(string: "https://login.kosmosplus.com:8443/")!) == "https://login.kosmosplus.com:8443",
          "the coordinator's origin is written as location.origin writes it (no slash, no default port)")
}

section("sign-in: a company's own sign-in in Apple's sheet (kosmos#7045)")
do {
    let begin = SignIn.companySignInURL(json: jsonBody(#"{"ok":true,"sso_url":"/v1/sso/begin?email=ann%40acme.test&device_id=k1.abc"}"#), coordinator: coordinator)
    check(begin?.absoluteString == "https://login.kosmosplus.com/v1/sso/begin?email=ann%40acme.test&device_id=k1.abc", "Kosmos+'s begin address, on the coordinator, as given")
    check(SignIn.companySignInURL(json: jsonBody(#"{"sso_url":"/v1/sso/begin?email=ann%2Bwork%40acme.test&device_id=k1.abc"}"#), coordinator: coordinator)?.absoluteString
          == "https://login.kosmosplus.com/v1/sso/begin?email=ann%2Bwork%40acme.test&device_id=k1.abc", "an address with a + is kept exactly as Kosmos+ encoded it")
    for bad in [#"{"sso_url":"https://evil.example/v1/sso/begin?x"}"#, #"{"sso_url":"//evil.example/v1/sso/begin?x"}"#, #"{"sso_url":"/v1/other?x"}"#, #"{"sso_url":"/v1/sso/begin?x#y"}"#, #"{"ok":true}"#, #"{"sso_url":7}"#] {
        check(SignIn.companySignInURL(json: jsonBody(bad), coordinator: coordinator) == nil, "not opened: \(bad)")
    }
    let ret = { (s: String) in SignIn.companyReturn(URL(string: s)!, coordinator: coordinator) }
    check(ret("https://login.kosmosplus.com/signin#sso_grant=ksso1_abc&email=ann%40acme.test") == .grant("ksso1_abc", email: "ann@acme.test"), "the grant and the vouched email, from Kosmos+'s own /signin")
    check(ret("https://login.kosmosplus.com/signin?sso_error=not_member") == .refused(SignIn.companyWords["not_member"]!), "a refusal, in the page's sentence")
    check(ret("https://login.kosmosplus.com/signin?sso_error=whatever") == .refused(SignIn.companyWords["failed"]!), "a word not known: the general sentence")
    for bad in ["https://login.kosmosplus.com/signin#sso_grant=abc&email=ann%40acme.test", "https://login.kosmosplus.com/signin#sso_grant=ksso1_abc",
                "https://evil.example/signin#sso_grant=ksso1_abc&email=a%40b.co", "https://login.kosmosplus.com/other#sso_grant=ksso1_abc&email=a%40b.co",
                "http://login.kosmosplus.com/signin#sso_grant=ksso1_abc&email=a%40b.co", "kosmos-signin://sso#sso_grant=ksso1_abc&email=a%40b.co",
                "https://login.kosmosplus.com/signin#sso_grant=ksso1_abc&email=not-an-email"] {
        check(ret(bad) == nil, "nothing taken from \(bad)")
    }
    check(SignIn.answer(status: 400, json: jsonBody(#"{"error":"agree first","code":"terms_required"}"#)) == .needsTerms && SignIn.next(after: .needsTerms, email: "e").step == .web(reason: SignIn.webForTerms), "a first company sign-in needs the terms: the web page")
}

section("sign-in: passkey sign-in (kosmos#7050 slice C)")
do {
    let challenge = Data([1, 2, 3, 250, 251, 252])
    let ok = #"{"challenge":"\#(SignIn.base64url(challenge))","rp_id":"login.kosmosplus.com","timeout_ms":300000,"user_verification":"required"}"#
    check(SignIn.passkeyOffer(status: 200, json: jsonBody(ok), coordinator: coordinator) == SignIn.PasskeyOffer(challenge: challenge, rpID: "login.kosmosplus.com"),
          "control: begin's offer for the coordinator's own host is taken, the challenge decoded")
    for (why, status, json) in [
        ("passkeys off (404)", 404, #"{}"#),
        ("another host's relying party", 200, ok.replacingOccurrences(of: "login.kosmosplus.com", with: "kosmosplus.com")),
        ("the host in another case (the coordinator would refuse every assertion)", 200, ok.replacingOccurrences(of: "login.kosmosplus.com", with: "LOGIN.kosmosplus.com")),
        ("a lookalike host", 200, ok.replacingOccurrences(of: "login.kosmosplus.com", with: "login.kosmosplus.com.evil.example")),
        ("user verification not required", 200, ok.replacingOccurrences(of: "required", with: "preferred")),
        ("no challenge", 200, #"{"rp_id":"login.kosmosplus.com","user_verification":"required"}"#),
        ("an empty challenge", 200, #"{"challenge":"","rp_id":"login.kosmosplus.com","user_verification":"required"}"#),
        ("no relying party", 200, #"{"challenge":"AQID","user_verification":"required"}"#),
        ("no user verification", 200, #"{"challenge":"AQID","rp_id":"login.kosmosplus.com"}"#),
        ("a challenge that is not base64url", 200, ok.replacingOccurrences(of: SignIn.base64url(challenge), with: "%%%")),
    ] {
        check(SignIn.passkeyOffer(status: status, json: jsonBody(json), coordinator: coordinator) == nil, "no passkey offered: \(why)")
    }

    let body = SignIn.passkeyFinishBody(credentialID: Data([9, 9]), authenticatorData: Data([1]), clientDataJSON: Data("{}".utf8),
                                        signature: Data([2, 3]), userHandle: Data("acct".utf8), deviceID: "k1.dev")
    check(body["authenticator_data"] as? String == SignIn.base64url(Data([1])) && body["signature"] as? String == SignIn.base64url(Data([2, 3])),
          "finish's body: authenticator data and signature each in their own field (a swap would fail every assertion)")
    check(body["credential_id"] as? String == SignIn.base64url(Data([9, 9])) && body["client_data_json"] as? String == SignIn.base64url(Data("{}".utf8))
          && body["user_handle"] as? String == SignIn.base64url(Data("acct".utf8)) && body["device_id"] as? String == "k1.dev",
          "finish's body: the assertion in base64url and this iPhone's device id")
    let noHandle = SignIn.passkeyFinishBody(credentialID: Data([9]), authenticatorData: Data([1]), clientDataJSON: Data([1]), signature: Data([1]),
                                            userHandle: nil, deviceID: "k1.dev")
    check(noHandle["user_handle"] == nil, "no user handle: none sent (the coordinator accepts its absence)")

    check(SignIn.passkeyFinish(status: 200, json: jsonBody(#"{"email":"ada@example.com","code":"kpk1_abc"}"#)) == .grant("kpk1_abc", email: "ada@example.com"),
          "control: the grant and the account's email")
    check(SignIn.passkeyFinish(status: 200, json: jsonBody(#"{"email":"ada@example.com","code":"ksso1_abc"}"#)) == .refused(SignIn.passkeyWords.failed),
          "a code that is not a passkey grant is not spent")
    check(SignIn.passkeyFinish(status: 200, json: jsonBody(#"{"email":"not-an-email","code":"kpk1_abc"}"#)) == .refused(SignIn.passkeyWords.failed),
          "a grant without a usable email is not spent")
    check(SignIn.passkeyFinish(status: 403, json: jsonBody(#"{"error":"your company requires signing in through its own provider","code":"sso_required"}"#)) == .refused(SignIn.passkeyWords.company),
          "a company that requires its own sign-in: the app's sentence, which says what to do here")
    check(SignIn.passkeyFinish(status: 401, json: jsonBody(#"{"error":"that passkey sign-in did not work. Try again, or sign in with your email"}"#)) == .refused("that passkey sign-in did not work. Try again, or sign in with your email"),
          "any other refusal: the coordinator's sentence, cleaned as every refusal is")
    check(SignIn.passkeyFinish(status: 500, json: nil) == .refused(SignIn.passkeyWords.failed), "no words at all: the general sentence")
}

// kosmos#7089: the chat's search, against the board's talkFilterRows and pjNoMatchSentence.
do {
    func row(_ id: String, _ text: String, _ who: Board.ChatRow.Who) -> Board.ChatRow {
        Board.ChatRow(id: id, atRaw: nil, at: nil, text: text, who: who)
    }
    let rows = [row("a", "Pushed the fix to main", .agent), row("p", "Thanks, ship it", .person),
                row("k", "Mona Lisa joined the chat", .kosmos), row("q", "Which branch?", .agent),
                row("b", "Build finished", .kosmos)]
    func ids(_ q: String) -> [String] { Board.chatFilter(rows, agentName: "Mona Lisa", query: q).map(\.id) }
    check(ids("") == ["a", "p", "k", "q", "b"], "chat search: no words keeps every row, in order")
    check(ids("   \n") == ["a", "p", "k", "q", "b"], "chat search: only spaces is no search")
    check(!Board.chatSearching("  ") && Board.chatSearching(" x "), "chat search: searching only when words are left after trimming")
    check(ids("FIX") == ["a"], "chat search: any case matches the text")
    check(ids("  ship  ") == ["p"], "chat search: the words are trimmed before matching")
    check(ids("lisa") == ["a", "k", "q"], "chat search: the agent's name keeps every one of its rows; a Kosmos line only by its text (b has no name in it)")
    check(ids("mona lisa j") == ["k"], "chat search: words past the name match only text")
    check(ids("nothing like this") == [], "chat search: no match gives no rows")
    check(Board.chatNoMatch("  fix  ") == "Nothing here matches \"fix\". Clearing the search brings the conversation back.",
          "chat search: the board's no-match sentence, with the words trimmed")
    check(Board.chatFilter(rows, agentName: "MONA LISA", query: "lisa").map(\.id) == ["a", "k", "q"],
          "chat search: the agent's name matches in any case")
    check(Board.chatFilter(rows, agentName: "", query: "lisa").map(\.id) == ["k"], "chat search: with no name known, an agent's row matches by text only")
    check(Board.chatSentWhileSearching == "Once it arrives, your message shows only if it matches the search.",
          "chat search: the line under a message sent while searching")
}

// kosmos#7120: the context ring, against the board's pctOf, memBand and memPrint.
do {
    func ctx(_ json: String) -> Any? { (try? JSONSerialization.jsonObject(with: Data(json.utf8))) }
    check(Board.contextPercent(ctx(#"{"percent":82}"#)) == 82, "context: a number is the percent")
    check(Board.contextPercent(ctx(#"{"percent":12.5}"#)) == 12.5, "context: a fraction is kept")
    check(Board.contextPercent(ctx(#"{"percent":true}"#)) == nil, "context: true is not a percent (the board's Number.isFinite)")
    check(Board.contextPercent(ctx(#"{"percent":"82"}"#)) == nil, "context: a string is not a percent")
    check(Board.contextPercent(ctx(#"{}"#)) == nil && Board.contextPercent(nil) == nil, "context: none is unknown")
    check(Board.memBand(nil) == nil, "memory band: unknown draws nothing")
    check(Board.memBand(59.9) == .ok && Board.memBand(60) == .warn && Board.memBand(79.9) == .warn && Board.memBand(80) == .high,
          "memory band: amber from 60, red from 80, as the board's WARM and NEARLY_FULL")
    // In an array: JSONSerialization reads no bare true or 1 without fragments allowed.
    check(Board.isRealTrue(ctx(#"[true]"#).flatMap { ($0 as? [Any])?.first }) && !Board.isRealTrue(ctx(#"[1]"#).flatMap { ($0 as? [Any])?.first }),
          "overCeiling: a real true, never a 1 (the board's === true)")
    check(Board.memoryWords(82, full: false) == "memory 82%" && Board.memoryWords(12.5, full: false) == "memory 12.5%",
          "memory words: the percent, as the board's memPrint")
    check(Board.memoryWords(95, full: true) == "memory Full" && Board.memoryWords(nil, full: true) == nil,
          "memory words: Full over the ceiling; nothing when unknown")
    let row = #"{"agents":[{"sessionName":"cleo","name":"Cleo","state":"working","context":{"percent":83,"overCeiling":false}}]}"#
    let parsed = Board.parseAgents(Data(row.utf8))?.first
    check(parsed?.contextPercent == 83 && parsed?.contextFull == false, "status: an agent's context is read from /api/status")
    let full = #"{"agents":[{"sessionName":"eli","state":"working","context":{"percent":100,"overCeiling":true}}]}"#
    check(Board.parseAgents(Data(full.utf8))?.first?.contextFull == true, "status: overCeiling true reads as Full")
    check(Board.contextPercent(ctx(#"{"percent":1e300}"#)) == 100 && Board.contextPercent(ctx(#"{"percent":-5}"#)) == 0,
          "context: held to 0...100")
    // The board's page, found from this file (ios/LogicTests/main.swift), so the check runs wherever run.sh is called from.
    let page = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("web/index.html")
    let boardPage = (try? String(contentsOf: page, encoding: .utf8)) ?? ""
    check(boardPage.contains("const NEARLY_FULL = 80;") && boardPage.contains("const WARM = 60;"),
          "the board's bands are still 60 and 80 (read from web/index.html)")
    // kosmos#7421: the eight orders are the desktop's own, keys and words in its order (read from web/index.html).
    let deskKeys = boardPage.range(of: "const AGENT_SORTS = [").map { String(boardPage[$0.upperBound...].prefix(while: { $0 != "]" })) } ?? ""
    check(deskKeys.replacingOccurrences(of: "'", with: "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) } == Board.AgentSort.allCases.map(\.rawValue), "the phone's orders are the desktop's AGENT_SORTS, in its order")
    check(Board.AgentSort.allCases.allSatisfy { boardPage.contains("['\($0.rawValue)', '\(Board.agentSortLabel($0))']") }, "each order's words are the desktop's menu words (agentSortControlHtml)")
    check(boardPage.contains("const AGENT_SORT_DEFAULT = '\(Board.agentSortDefault.rawValue)';"), "the default order is the desktop's")
    // kosmos#7341: the avatar dot's presence table is the board's CARD_ST pres, state for state (read from web/index.html).
    do {
        var board: [String: Board.Presence] = [:]
        if let start = boardPage.range(of: "const CARD_ST = {"), let end = boardPage.range(of: "\n};", range: start.upperBound..<boardPage.endIndex) {
            let block = String(boardPage[start.upperBound..<end.lowerBound])
            let rx = try! NSRegularExpression(pattern: #"^\s*([a-z_]+):\s*\{[^}]*pres:\s*'(on|off|unsure)'"#, options: [.anchorsMatchLines])
            for m in rx.matches(in: block, range: NSRange(block.startIndex..., in: block)) {
                let key = String(block[Range(m.range(at: 1), in: block)!]), pres = String(block[Range(m.range(at: 2), in: block)!])
                board[key] = pres == "on" ? .on : pres == "off" ? .off : .unsure
            }
        }
        check(board.count >= 10, "kosmos#7341: the board's CARD_ST was read (\(board.count) states)")
        check(board == Board.presenceOf, "kosmos#7341: the phone's presence table is the board's CARD_ST pres for every state")
        func a(_ state: String, running: Bool = true, trust: Bool = false, failed: Bool = false) -> Board.Agent {
            var x = Board.Agent(session: "s", name: "S", role: nil, state: state, task: nil, needsYou: false)
            x.running = running; x.needsTrust = trust; x.restartFailed = failed
            return x
        }
        check(Board.presence(a("idle")) == .on && Board.presence(a("working")) == .on && Board.presence(a("needs_you")) == .on,
              "kosmos#7341: idle, working and stuck agents that run are green (Josh: every agent looked red or grey)")
        check(Board.presence(a("stopped")) == .off, "a stopped agent is grey")
        check(Board.presence(a("working", running: false)) == .off, "an agent not running is grey whatever its last state")
        check(Board.presence(a("restarting", running: false)) == .on, "CONTROL: except while restarting")
        check(Board.presence(a("idle", trust: true)) == .unsure, "an agent waiting on a trust prompt is hollow, never green")
        check(Board.presence(a("idle", running: false, trust: true)) == .unsure, "and the trust prompt comes before not running")
        check(Board.presence(a("needs_you", failed: true)) == .off, "a failed restart is grey (the board's CARD_ST_FAILED_RESTART)")
        check(Board.presence(a("working", failed: true)) == .on, "CONTROL: only on needs_you, as the board")
        check(Board.presence(a("unknown")) == .unsure && Board.presence(a("something_new")) == .unsure,
              "unknown, and a state the phone does not know, are hollow")
        let parsed = Board.parseAgents(Data(#"{"agents":[{"sessionName":"f","state":"needs_you","disruption":{"failed":true}}]}"#.utf8))
        check(parsed?.first?.restartFailed == true, "kosmos#7341: disruption.failed is read from /api/status")
        // kosmos#7342: a pill only when there is something to see; its colour follows the state the word comes from.
        func q(_ x: Board.Agent, _ f: (inout Board.Agent) -> Void) -> Board.Agent { var y = x; f(&y); return y }
        check(Board.pill(a("idle")) == nil, "kosmos#7342: Idle shows no pill (Josh: no pill means all is well)")
        // Mona Lisa's ruling (10-27 15:4x): a red pill never says Idle or Working; it says Issue. Other words stay as sent.
        let redIdle = q(a("idle")) { $0 = Board.Agent(session: $0.session, name: $0.name, role: nil, state: "idle", task: nil, needsYou: true) }
        let redWorking = q(a("working")) { $0.macTone = .needsYou }
        check(Board.pill(redIdle) == .problem && Board.pillWord(redIdle) == "Issue", "kosmos#7342: a red pill that would say Idle says Issue")
        check(Board.pill(redWorking) == .problem && Board.pillWord(redWorking) == "Issue", "kosmos#7342: a red pill that would say Working says Issue")
        check(Board.pillWord(a("working")) == "Working" && Board.pillWord(a("idle")) == "Idle", "CONTROL: a green Working and a plain Idle keep their words")
        let stuckWord = q(a("working")) { $0.macTone = .needsYou; $0.macWord = "Messages stuck" }
        check(Board.pillWord(stuckWord) == "Messages stuck", "kosmos#7342: a word the Mac sent other than Idle or Working stays as sent")
        // Review 1: the word and its colour never disagree, by either rule, over every red route found.
        let routes: [Board.Agent] = [redIdle, redWorking, q(a("idle")) { $0.crashLooping = true }, q(a("working")) { $0.crashLooping = true },
                                     a("idle", failed: true), q(a("idle")) { $0 = Board.Agent(session: $0.session, name: $0.name, role: nil, state: "idle", task: nil, needsYou: true, macTone: .quiet) },
                                     a("working"), a("idle"), stuckWord]
        check(routes.allSatisfy { r in (Board.pillWord(r) == "Issue") == (Board.pill(r) == .problem && ["Idle", "Working"].contains(Board.statusWord(r)))
                                    && (Board.toneWord(r) == "Issue") == (Board.tone(r) == .needsYou && ["Idle", "Working"].contains(Board.statusWord(r))) },
              "review 1: Issue appears exactly where its colour is red, for the pill and for the tone (\(routes.count) routes)")
        let quietTone = Board.Agent(session: "z", name: "Z", role: nil, state: "idle", task: nil, needsYou: true, macTone: .quiet)
        check(Board.pillWord(quietTone) == "Issue" && Board.toneWord(quietTone) == "Idle" && Board.tone(quietTone) == .quiet,
              "review 2: a red pill (Issue) on the row, and the Mac's quiet tone (Idle, grey) on Today and the header: each word matches its own colour")
        check(Board.pill(a("working")) == .working, "working is the green pill with the Sweep")
        check(Board.pill(q(a("needs_you")) { $0.reportedByAgent = true }) == .asks, "an agent's question is blue")
        check(Board.pill(q(a("needs_you")) { $0.awaitingApproval = true }) == .asks, "a permission waiting is blue")
        check(Board.pill(a("needs_you")) == .problem, "CONTROL: a plain needs_you (the board's Issue) is a real problem, red")
        check(Board.pill(a("idle", running: false, trust: true)) == .asks, "a trust prompt is the person's to answer: blue")
        check(Board.pill(a("rate_limited")) == .held && Board.pill(a("blocked")) == .held && Board.pill(a("restarting", running: false)) == .held,
              "rate limited, waiting and restarting are amber: held by something outside the agent")
        check(Board.pill(a("idle", running: false)) == .problem && Board.pill(a("stopped")) == .problem, "not running is red")
        check(Board.pill(q(a("idle", running: false)) { $0.jobRunningUnseen = true }) == .cantTell, "a job Kosmos cannot see is grey, not red")
        check(Board.pill(q(a("working")) { $0.crashLooping = true }) == .problem, "a crash loop is red")
        check(Board.pill(a("unknown")) == .cantTell && Board.pill(a("something_new")) == .cantTell, "unknown and unrecognised states are grey")
        // kosmos#7354: the red count on each avatar is the Mac's waiting total (engine/status.js waitingTotal), agent by agent.
        do {
            let rows = Board.parseAgents(Data(#"{"agents":[{"sessionName":"a","state":"needs_you","dmUnread":2},{"sessionName":"b","state":"idle","dmUnread":3},{"sessionName":"g","state":"needs_you","dmUnread":4,"isGuide":true},{"sessionName":"c","state":"working","dmUnread":null},{"sessionName":"d","state":"idle"},{"sessionName":"e","state":"working","deliveryStall":{"since":"2026-10-27T10:00:00Z"}},{"sessionName":"f","state":"idle","deliveryStall":null}]}"#.utf8)) ?? []
            check(rows.map(\.dmUnread) == [2, 3, 4, 0, 0, 0, 0] && rows.map(\.isGuide) == [false, false, true, false, false, false, false],
                  "kosmos#7354: dmUnread and isGuide are read; a null or missing count is 0")
            // Expected values written out from the Mac's rules (engine/status.js needsPerson and waitingTotal, server.js
            // countAgents over non-guide rows), not from the phone's own needsYou: a needs_you agent counts 1, each unread
            // reply 1, a stalled delivery 1, the guide nothing, a null stall nothing.
            check(rows.map(Board.noticeCount) == [3, 3, 0, 0, 0, 1, 0], "review: each avatar's count is its share of the Mac's total (\(rows.map(Board.noticeCount)))")
            check(rows.map(Board.noticeCount).reduce(0, +) == 7, "the rows add up to the Mac's total for agents: 7")
            check(Board.jsTruthy(["since": "x"]) && !Board.jsTruthy(NSNull()) && !Board.jsTruthy(nil) && !Board.jsTruthy(false) && !Board.jsTruthy(0) && !Board.jsTruthy(""),
                  "a field reads as the Mac's Boolean() reads it")
            check(Board.noticeCount(Board.Agent(session: "x", name: "x", role: nil, state: "idle", task: nil, needsYou: false)) == 0,
                  "CONTROL: an agent with nothing waiting shows no count")
            check(Board.noticeWords(3) == "3 waiting" && Board.noticeWords(0) == nil, "VoiceOver hears the count, never a zero")
            let seen = Board.dmSeenRequest(mac: URL(string: "https://studio.kosmosplus.com")!, session: "dana")
            check(seen?.httpMethod == "POST" && seen?.url?.path == "/api/agent/dana/seen", "opening the chat moves the board's read cursor (server.js dmSeen)")
            check(Board.dmSeenRequest(mac: URL(string: "https://studio.kosmosplus.com")!, session: "../x") == nil, "CONTROL: a name the board would refuse is never sent")
        }
        check(Board.presenceWords(.off, word: "Issue") == "not running", "review: a grey dot beside another word is spoken")
        check(Board.presenceWords(.off, word: "Not running") == nil, "CONTROL: not said twice when the word says it")
        check(Board.presenceWords(.unsure, word: "Idle") != nil && Board.presenceWords(.on, word: "Idle") == nil, "a hollow dot is spoken; a green one adds nothing")
        // Review: the pill is never calmer than what the board counts as needing the person.
        func needing(_ s: String) -> Board.Agent { Board.Agent(session: "x", name: "x", role: nil, state: s, task: nil, needsYou: true) }
        check(Board.pill(needing("connection_lost")) == .problem, "review: a reconnect that gave up is red, not amber")
        check(Board.pill(a("connection_lost")) == .held, "CONTROL: a connection still being retried stays amber")
        check(Board.pill(needing("rate_limited")) == .problem, "review: a rate limit stuck on its error is red")
        check(Board.pill(needing("idle")) == .problem, "review: an idle agent whose helper gave up shows a red pill, not none")
        check(Board.pill(q(a("working")) { $0.macWord = "Messages stuck"; $0.macTone = .needsYou }) == .problem,
              "review: a word the Mac counts as needs you (Messages stuck) is red, not a green Working pill")
        check(Board.pill(q(a("unknown")) { $0.macWord = "Can't tell"; $0.macTone = .needsYou }) == .cantTell,
              "review: Can't tell stays grey though the Mac's tone for it is needs you")
        check(Board.pill(q(a("idle", running: false)) { $0.jobRunningUnseen = true; $0.macWord = "Can't tell"; $0.macTone = .needsYou }) == .cantTell,
              "review: and so does a job Kosmos cannot see, as a current Mac sends it")
        check(Board.pill(q(a("rate_limited")) { $0.macTone = .needsYou }) == .held, "CONTROL: the Mac's needs-you tone leaves a held state amber")
        check(Board.pill(q(needing("needs_you")) { $0.reportedByAgent = true }) == .asks,
              "CONTROL: an agent's question stays blue though the board counts it as needing the person")
        // kosmos#7421: the desktop's eight orders (web/index.html sortAgents), each with a tie on name and on position.
        func ag(_ s: String, _ n: String, state: String = "idle", needs: Bool = false, role: String? = nil, model: String? = nil,
                talked: Double? = nil, active: Double? = nil, made: Double? = nil) -> Board.Agent {
            var a = Board.Agent(session: s, name: n, role: role, state: state, task: nil, needsYou: needs)
            a.model = model
            a.lastTalkedAt = talked.map { Date(timeIntervalSince1970: $0) }
            a.lastActiveAt = active.map { Date(timeIntervalSince1970: $0) }
            a.createdAt = made.map { Date(timeIntervalSince1970: $0) }
            return a
        }
        let crew = [ag("b", "bea", state: "working", role: "writer", model: "Claude Opus 5", talked: 100, active: 50, made: 1),
                    ag("a", "Al", state: "blocked", role: nil, model: nil, talked: 300, active: nil, made: 3),
                    ag("c", "al", needs: true, role: "Analyst", model: "codex", talked: nil, active: 90, made: 2),
                    ag("d", "Dee", role: "writer", model: "Claude Opus 5", talked: 100, active: 50, made: nil)]
        func order(_ s: Board.AgentSort, projects: [String: String] = [:], stars: Set<String>? = nil) -> [String] {
            Board.agentOrder(crew, sort: s, projects: projects, stars: stars).map(\.session)
        }
        check(order(.name) == ["a", "c", "b", "d"], "Name A to Z: without case, a tie keeps the computer's order")
        check(order(.talked) == ["a", "b", "d", "c"], "Last talked to: newest first, a tie by name, never talked to last")
        check(order(.active) == ["c", "b", "d", "a"], "Recently active: newest first, unknown last")
        check(order(.newest) == ["a", "c", "b", "d"], "Newest first: by when it was made, unknown last")
        check(order(.needs) == ["c", "a", "b", "d"], "Needs you first: needs you, blocked, working, idle (the desktop's needsRank)")
        check(order(.model) == ["b", "d", "c", "a"], "By model: A to Z, no model last")
        check(order(.role) == ["c", "b", "d", "a"], "By role: A to Z by the role line, none last")
        check(order(.project, projects: ["d": "Alpha", "a": "beta"]) == ["d", "a", "c", "b"], "By project: the first project A to Z, none last (by name)")
        check(order(.name, stars: ["d"]) == ["d", "a", "c", "b"] && order(.talked, stars: ["d", "c"]) == ["d", "c", "a", "b"], "starred agents first in every order, the order applied within each group (#6719)")
        check(Board.agentSort(saved: "board") == .needs && Board.agentSort(saved: "name") == .name && Board.agentSort(saved: "x") == .talked, "the phone's older saved choice still means Needs you first; anything unknown is the desktop's default")
        check(Board.sortModel(["earlierModelName": "Opus 4.5"]) == "Claude Opus 4.5" && Board.sortModel(["modelName": "Claude Sonnet 5", "plannedModelName": "x"]) == "Claude Sonnet 5" && Board.sortModel(["runner": "claude"]) == nil && Board.sortModel(["runner": "codex"]) == "OpenAI Codex", "the model the order reads: live, then planned, then the earlier session's")
        check(Board.sortModel(["runner": "codex", "modelName": "o3"]) == "OpenAI o3" && Board.sortModel(["runner": "codex", "modelName": "GPT 5.6"]) == "GPT 5.6"
              && Board.sortModel(["runner": "codex", "account": ["provider": "alibaba"], "modelName": "3 Max"]) == "Qwen 3 Max"
              && Board.sortModel(["runner": "antigravity"]) == "Gemini (Google subscription)" && Board.sortModel(["runner": "muse"]) == "Meta Muse"
              && Board.sortModel(["runner": "gemini", "modelName": "Gemini 3.8 Flash", "settingModelName": "Gemini 3 Pro"]) == "Gemini 3.8 Flash (set to Gemini 3 Pro)"
              && Board.sortModel(["state": "stopped", "modelName": "Haiku 4.5", "plannedModelName": "Opus 5"]) == "Claude Opus 5"
              && Board.sortModel(["state": "working", "modelName": "Haiku 4.5", "plannedModelName": "Opus 5"]) == "Claude Haiku 4.5",
              "review 1: By model reads the desktop's own model line (modelLine), provider words and a stopped agent's planned model included")
        let row = #"{"agents":[{"sessionName":"eli","name":"Eli","state":"idle","lastTalkedAt":"2026-10-27T20:00:00Z","lastActiveAt":"2026-10-27T21:00:00Z","createdAt":"2026-10-01T09:00:00Z","modelName":"Opus 5","role":"writes copy","profile":{"role":"Designer"},"deliveryStall":{"since":"2026-10-27T20:00:00Z"}}]}"#
        let parsedRow = Board.parseAgents(Data(row.utf8))?.first
        check(parsedRow?.lastTalkedAt == Board.isoDate("2026-10-27T20:00:00Z") && parsedRow?.lastActiveAt == Board.isoDate("2026-10-27T21:00:00Z")
              && parsedRow?.createdAt == Board.isoDate("2026-10-01T09:00:00Z") && parsedRow?.model == "Claude Opus 5"
              && parsedRow?.profileRole == "Designer" && parsedRow?.deliveryStall == true && parsedRow?.lastTalkedAt != nil,
              "review 1: the status row's times, model, picked role and stuck messages are read")
        var picked = ag("e", "Eve", role: "zz parsed"); picked.profileRole = "Aa picked"
        check(Board.agentOrder([crew[0], picked], sort: .role).map(\.session) == ["e", "b"], "review 1: By role reads the role picked on the profile before the parsed line (the desktop's roleLine)")
        check(Board.keepingOrder([crew[0]], with: [crew[0], crew[3], crew[1]], sort: .name).map(\.session) == ["b", "a", "d"], "review 2: agents new on a live update join the end in the chosen order, the shown rows held still")
        check(Board.sortModel(["state": "needs_you", "disruption": ["failed": true], "modelName": "Haiku 4.5", "plannedModelName": "Opus 5"]) == "Claude Opus 5", "review 2: a failed restart counts as not running, as on the desktop (its planned model)")
        var stuck = ag("f", "Fay", state: "idle"); stuck.deliveryStall = true
        check(Board.agentOrder([crew[0], stuck], sort: .needs).map(\.session) == ["f", "b"], "review 1: stuck messages rank with needs you (the desktop's agentNeedsAttention)")
    }
}

await boardLoopTests()

// MARK: - kosmos#7222: notification permission is asked on the Agents tab, not at launch

do {
    typealias P = PushBridge.Permission
    // A launch registers only a phone that already said yes; it never asks.
    check(PushBridge.registersAtLaunch(.allowed), "#7222 launch: an allowed phone re-registers with APNs")
    for p in [P.notDetermined, .denied, .unknown] {
        check(!PushBridge.registersAtLaunch(p), "#7222 launch: \(p) does not register (and nothing at launch asks)")
    }
    // The ask is offered only when it can mean something.
    check(PushBridge.offersAsk(permission: .notDetermined, agentsCurrent: true, dismissed: false),
          "#7222 never asked, agents of a connected Mac current on screen: offered")
    check(!PushBridge.offersAsk(permission: .notDetermined, agentsCurrent: false, dismissed: false),
          "#7222 no current agents list (signed out, no Mac, reaching, not updating): not offered")
    check(!PushBridge.offersAsk(permission: .notDetermined, agentsCurrent: true, dismissed: true),
          "#7222 the person said not now: not offered again")
    for p in [P.allowed, .denied, .unknown] {
        check(!PushBridge.offersAsk(permission: p, agentsCurrent: true, dismissed: false),
              "#7222 permission \(p) (already answered, or not read yet): not offered")
    }
}

// MARK: - kosmos#7252: the Today tab switched off (Josh, 2026-10-26: "kill the today tab for now")

check(AppTabs.todayTab == false, "#7252: the shipped app has the Today tab switched off")
check(AppTabs.visible(tasksTab: true) == [.agents, .projects, .tasks, .settings], "#7252: no Today in the bar, Tasks earned")
check(AppTabs.visible(tasksTab: false) == [.agents, .projects, .tasks, .settings], "#7266: four tabs, Tasks shown whether or not the board has earned it")
check(AppTabs.keep(.tasks, tasksTab: false) == .tasks, "#7266: Tasks never leaves the four-tab bar")
check(AppTabs.visible(tasksTab: false, todayTab: true) == [.today, .agents, .projects, .settings], "#7266: the five-tab bar (screenshot build) still earns Tasks")
check(AppTabs.keep(.today, tasksTab: true) == .agents, "#7252: a selection on the hidden Today goes to Agents")
check(AppTabs.barTab(forPage: .today, tasksTab: true) == .today, "#7252: the board's home page is still the board page (shown over the tabs)")
check(AppTabs.barTab(forPage: .settings, tasksTab: true) == .today, "#7252: the board's Settings is the board page, not the native Settings")
// Review 2: with Today off every tab the bar offers is native, so the board page moving by itself never moves the bar.
for sel in AppTabs.visible(tasksTab: true) {
    let a = URL(string: "https://mac.example/#agents"), b = URL(string: "https://mac.example/#settings")
    check(AppTabs.follow(from: a, to: b, selected: sel, barHeld: false, tasksTab: true) == nil, "#7252: a page move leaves \(sel) where it is")
}

// MARK: - kosmos#7266: the + buttons ask the board's door for a create

check(AppTabs.pressScript(door: "new-agent").contains("window.kosmosAppTab('new-agent')"), "#7266: the create name goes to the door")
check(AppTabs.pressScript(.agents) == nil && AppTabs.pressScript(.projects) == AppTabs.pressScript(door: "projects"), "#7266: a section press is unchanged")
check(AppTabs.pressScript(door: "new-agent").contains("return 'covered'; return 'refused'") && !AppTabs.pressScript(door: "projects").contains(".rm-back"), "#7266 review 2: only a create reads a covered board as covered; a section press is unchanged")
// Review 3 (switcher): a + goes to the computer the switcher shows.
let studioURL = URL(string: "https://studio.kosmosplus.com/")!, laptopURL = URL(string: "https://laptop.kosmosplus.com/")!
check(AppTabs.createTarget(pageURL: URL(string: "https://studio.kosmosplus.com/?tab=agents"), shown: laptopURL) == laptopURL, "#7266 review 3: the page on Studio while Laptop is shown loads Laptop's board first")
check(AppTabs.createTarget(pageURL: URL(string: "https://LAPTOP.kosmosplus.com/?tab=agents"), shown: laptopURL) == nil && AppTabs.createTarget(pageURL: studioURL, shown: nil) == nil, "#7266 review 3: already there, or no computer shown: press where the page is")
// Review 3: through the real answer parsing, the covered answer waits and never falls back (review 2 returned 'absent',
// which answer() reads as .noDoor and the fallback fired).
let coveredMac = URL(string: "https://studio.kosmosplus.com/?tab=agents")!
check(AppTabs.answer("covered", error: nil) == .absent && AppTabs.createFallback(door: "new-agent", AppTabs.answer("covered", error: nil), pageURL: coveredMac) == nil, "#7266 review 3: a covered create's own answer string waits and has no fallback")
check(AppTabs.createFallback(door: "new-agent", AppTabs.answer("refused", error: nil), pageURL: coveredMac) != nil, "#7266 review 3: CONTROL: a plain refusal through the same parsing does fall back")
var lateT = PressTracker()
let firstRun = lateT.press(.projects, page: .ready, section: true, door: "new-project")
_ = lateT.press(.tasks, page: .ready, section: true)
check(firstRun.map { !lateT.isCurrent($0.serial) } == true, "#7266 review 3: an answer to an earlier press is not current (its fallback is skipped)")
do {
    var t = PressTracker()
    let waited = t.press(.agents, page: .loading, section: true, door: AppTabs.Create.agent.rawValue)
    check(waited == nil && t.pending == .agents && t.pendingDoor == "new-agent", "#7266: a create on a loading page waits, with its door kept for the replay")
    // Review 1: through the tracker's own replay rule (ContentView.loaded uses it), not a hand-built door.
    check(t.replay?.tab == .agents && t.replay?.door == "new-agent", "#7266: a waiting create has a replay with its door")
    let replay = t.replay ?? (tab: .agents, door: nil, host: nil)
    let run = t.press(replay.tab, page: .ready, section: true, door: replay.door)
    check(run?.script.contains("'new-agent'") == true, "#7266: the replay presses the create, not the bare section")
    _ = t.press(.agents, page: .ready)   // the native Agents tab
    check(t.pending == nil && t.pendingDoor == nil, "#7266: the native tab ends a waiting create")
    _ = t.press(.projects, page: .loading, section: true, door: AppTabs.Create.project.rawValue)
    t.loadingOwnPage()
    check(t.pendingDoor == nil, "#7266: a page the app loads itself clears a waiting create")
    // Review 1: a create the board turned down falls back; a waiting or opened press, or no create, does not.
    let mac = URL(string: "https://studio.kosmosplus.com/?tab=agents#x")!
    check(AppTabs.createFallback(door: "new-project", .refused, pageURL: mac) == .projects, "#7266: a refused project create opens the board's Projects")
    check(AppTabs.createFallback(door: "new-agent", .refused, pageURL: mac) == .load(URL(string: "https://studio.kosmosplus.com/?tab=create")!), "#7266: a refused agent create loads the board's create page on the same Mac")
    check(AppTabs.createFallback(door: "new-agent", .noDoor, pageURL: mac) != nil, "#7266: an older board without the door falls back too")
    check(AppTabs.createFallback(door: "new-agent", .opened, pageURL: mac) == nil && AppTabs.createFallback(door: "new-agent", .absent, pageURL: mac) == nil, "#7266: an opened or still-waiting create has no fallback")
    check(AppTabs.createFallback(door: "new-agent", .noDoor, pageURL: URL(string: "https://login.kosmosplus.com/")!) == nil, "#7266: on the sign-in page the create still waits")
    check(AppTabs.createFallback(door: nil, .refused, pageURL: mac) == nil, "#7266: a plain section press has no create fallback")
}
do {
    // Review 5: a create meant for one computer (its board loaded for it) replays only on that computer's board.
    var t = PressTracker()
    _ = t.press(.agents, page: .loading, section: true, door: "new-agent", host: "laptop.kosmosplus.com")
    check(t.replay(host: "studio.kosmosplus.com") == nil, "#7266 review 5: a load on another computer does not replay the create")
    check(t.pending == .agents && t.pendingDoor == "new-agent", "#7266 review 5: and the create keeps waiting (a sign-in hop on the way is not a drop)")
    let back = t.replay(host: "laptop.kosmosplus.com")
    check(back?.door == "new-agent" && back?.host == "laptop.kosmosplus.com", "#7266 review 5: the named computer's load replays it, its host carried")
    _ = t.press(.agents, page: .ready, section: true, door: back?.door, host: back?.host)
    check(t.pendingHost == "laptop.kosmosplus.com", "#7266 review 5: a replayed create that waits again keeps its computer")
    t.loadingOwnPage()
    check(t.pendingHost == nil, "#7266 review 5: a page the app loads itself clears it")
    var any = PressTracker()
    _ = any.press(.agents, page: .loading, section: true, door: "new-agent")
    check(any.replay(host: "studio.kosmosplus.com")?.door == "new-agent", "#7266 review 5: CONTROL: a create with no computer named replays on any page")
}
do {
    // Review 6: a failed load of the named computer ends its create; a failed load elsewhere does not (the control).
    var t = PressTracker()
    _ = t.press(.agents, page: .loading, section: true, door: "new-agent", host: "laptop.kosmosplus.com")
    t.loadFailed(host: "studio.kosmosplus.com")
    check(t.pending == .agents && t.pendingHost == "laptop.kosmosplus.com", "#7266 review 6: CONTROL: a failed load of another computer leaves the create waiting")
    t.loadFailed(host: "Laptop.KosmosPlus.com")
    check(t.pending == nil && t.pendingDoor == nil && t.pendingHost == nil, "#7266 review 6: a failed load of the named computer (any case) ends the create")
    var u = PressTracker()
    _ = u.press(.agents, page: .loading, section: true, door: "new-agent", host: "laptop.kosmosplus.com")
    check(u.replay(host: "LAPTOP.kosmosplus.com")?.door == "new-agent", "#7266 review 6: the replay's host match ignores case, as createTarget's does")
    let run = u.press(.agents, page: .ready, section: true, door: "new-agent", host: "laptop.kosmosplus.com")
    _ = u.answered(serial: run?.serial ?? -1, .opened, pageURL: URL(string: "https://laptop.kosmosplus.com/"))
    check(u.pendingHost == nil, "#7266 review 6: an opened create clears its computer")
    var d = PressTracker()
    _ = d.press(.agents, page: .loading, section: true, door: "new-agent", host: "laptop.kosmosplus.com")
    d.drop(selected: .agents)
    check(d.pendingHost == nil, "#7266 review 6: a dropped page clears it")
    var n = PressTracker()
    _ = n.press(.agents, page: .loading, section: true, door: "new-agent", host: "laptop.kosmosplus.com")
    _ = n.press(.agents, page: .ready)
    check(n.pendingHost == nil, "#7266 review 6: the native tab clears it")
}

section("kosmos#7389: a Kosmos+ download, saved through the share sheet (the Mac's #5167 rules)")
do {
    let coord = URL(string: "https://login.kosmosplus.com")!
    let page = URL(string: "https://studio.kosmosplus.com/?tab=files")!
    let file = URL(string: "https://studio.kosmosplus.com/api/files/report.pdf")!
    check(Download.isBoardPage(page, coordinator: coord), "a computer's Kosmos+ address is a board")
    for bad in ["https://login.kosmosplus.com/", "https://www.kosmosplus.com/", "https://billing.kosmosplus.com/", "https://evil.example/",
                "http://studio.kosmosplus.com/", "https://a.b.kosmosplus.com/", "https://studio.kosmosplus.com:8443/", "https://u@studio.kosmosplus.com/"] {
        check(!Download.isBoardPage(URL(string: bad)!, coordinator: coord), "CONTROL: not a board: \(bad)")
    }
    check(!Download.isBoardPage(nil, coordinator: coord), "no page is not a board")
    check(Download.isSameOrigin(file, page: page) && Download.isSameOrigin(URL(string: "https://studio.kosmosplus.com:443/x")!, page: page),
          "the same origin, the default port written or not")
    check(!Download.isSameOrigin(URL(string: "https://other.kosmosplus.com/x")!, page: page) && !Download.isSameOrigin(URL(string: "http://studio.kosmosplus.com/x")!, page: page),
          "CONTROL: another computer or another scheme is not the same origin")
    // A download the page asked for (<a download>).
    check(Download.decideAction(target: file, page: page, coordinator: coord) == .save, "a board's own file is saved")
    check(Download.decideAction(target: URL(string: "https://other.kosmosplus.com/x")!, page: page, coordinator: coord) == .refuse(Download.notFromThisBoard),
          "CONTROL: a file from another address is refused, in the Mac's words")
    check(Download.decideAction(target: file, page: URL(string: "https://evil.example/")!, coordinator: coord) == .refuse(Download.notABoard),
          "CONTROL: a page that is not a board cannot save")
    // A main-frame answer.
    func resp(_ status: Int, attachment: Bool = true, canShow: Bool = false, target: URL? = file, page p: URL? = page) -> Download.ResponseDecision {
        Download.decideResponse(status: status, attachment: attachment, canShow: canShow, target: target, page: p, coordinator: coord)
    }
    check(resp(200) == .save, "an attachment from the board is saved")
    check(resp(200, attachment: false, canShow: false) == .save, "a board file the window cannot show (a .zip) is saved")
    check(resp(200, attachment: false, canShow: true) == .show, "CONTROL: a page the window can show is shown, not saved")
    check(resp(204) == .show && resp(205) == .show, "a 204 or 205 has nothing to save")
    check(resp(200, target: URL(string: "https://other.kosmosplus.com/x")!) == .refuse(Download.fromElsewhere), "an attachment from elsewhere is refused")
    check(resp(200, attachment: false, target: URL(string: "https://other.kosmosplus.com/x")!) == .refuse(Download.notOpenedElsewhere),
          "review 1: a file the window cannot show, from elsewhere, is said as not opened or saved (the Mac's words)")
    check(resp(200, page: URL(string: "https://evil.example/")!) == .refuse(Download.notABoard)
          && resp(200, attachment: false, page: URL(string: "https://evil.example/")!) == .refuse(Download.notOpenedNotABoard),
          "a page that is not a board cannot save, in the Mac's two wordings")
    check(resp(200, page: nil) == .refuse(nil), "no page yet (the app's own load): refused and not said")
    // Review 1: every board download is an <a download>, which never reaches the response policy: what arrives is judged
    // at its destination (Download.decideDestination), the Mac's decideDestinationUsing.
    let dl = URL(string: "https://studio.kosmosplus.com/api/attachments/a1")!
    let filesDl = URL(string: "https://studio.kosmosplus.com/api/agent/dana/files/download?path=x")!
    check(Download.decideDestination(status: 200, mimeType: "application/pdf", attachment: true, url: dl) == .keep, "a file that arrived is kept")
    check(Download.decideDestination(status: 204, mimeType: nil, attachment: false, url: dl) == .drop(nil),
          "review 1: a 204 (the board refused the download and its page says why) keeps nothing and says nothing")
    check(Download.decideDestination(status: 404, mimeType: "application/json", attachment: false, url: dl) == .drop(Download.couldNotGet),
          "an error answer is never kept as the file, and is said")
    check(Download.decideDestination(status: 200, mimeType: "text/html", attachment: false, url: dl) == .drop(Download.couldNotGet),
          "review 1: a web page where a file was expected (a signed-out computer's sign-in page) is never kept")
    check(Download.decideDestination(status: 200, mimeType: "text/html", attachment: true, url: dl) == .keep,
          "review 1: CONTROL: a web page sent as an attachment IS the file (an agent's .html attachment)")
    check(Download.decideDestination(status: 500, mimeType: "text/html", attachment: false, url: filesDl) == .drop(nil),
          "the Files lists' own routes say a refusal on the page, so the app says nothing")
    check(Download.pageSaysRefusal(filesDl) && Download.pageSaysRefusal(URL(string: "https://s.kosmosplus.com/api/project/p1/file-download")!)
          && !Download.pageSaysRefusal(dl), "the routes whose page says it themselves (the Mac's pageSaysDownloadRefusal)")
    check(Download.pageSaysRefusal(URL(string: "https://s.kosmosplus.com/api/agent/dana/files/download-folder?path=x")!),
          "review 3: the folder download (#6724) says its refusals on the page too")
    check(Download.redirectedElsewhere == "The file pointed somewhere Kosmos does not save from, so it was not saved.", "a redirect elsewhere in the Mac's words")
    // The name.
    check(Download.fileName("report.pdf") == "report.pdf" && Download.fileName(nil) == "download" && Download.fileName("../../etc/x") == "-..-etc-x"
          && Download.fileName(".hidden") == "hidden" && Download.fileName("   ") == "download", "the name is safe for a file")
    // The Mac's guard.
    let t0 = Date(timeIntervalSince1970: 1_000_000)
    check(Download.shouldSay(up: false, refusal: true, lastAt: nil, now: t0, shownThisPage: 0), "the first refusal is said")
    check(!Download.shouldSay(up: true, refusal: true, lastAt: nil, now: t0, shownThisPage: 0), "none while one is on screen")
    check(!Download.shouldSay(up: false, refusal: true, lastAt: t0, now: t0.addingTimeInterval(5), shownThisPage: 1), "none within 10 s of the last, whatever its sentence")
    check(Download.shouldSay(up: false, refusal: true, lastAt: t0, now: t0.addingTimeInterval(10), shownThisPage: 1), "CONTROL: said again after 10 s")
    check(!Download.shouldSay(up: false, refusal: true, lastAt: nil, now: t0, shownThisPage: 2), "at most twice for one sentence on one page")
    check(Download.fileName(String(repeating: "a", count: 130) + "." + String(repeating: "b", count: 119)).first != "." && Download.fileName(String(repeating: "a", count: 200)).count == 120,
          "review 4: a long name is cut to 120 and never starts on a dot")
    check(Download.fileName("photo\u{202E}gpj.exe") == "photogpj.exe" && Download.fileName("a\u{2028}b") == "ab", "review 1: no direction or separator characters in a name")
    check(Download.getting("report.pdf") == "Getting report.pdf" && Download.failed("The network connection was lost.") == "The file could not be downloaded (The network connection was lost.).",
          "Mona Lisa's words")
}

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
