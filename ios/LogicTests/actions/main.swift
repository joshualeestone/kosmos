import Foundation
import UserNotifications
// Tests for answering from the notification (#7017), compiled for macOS with the app files run-actions.sh lists.
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
let session = "sess-abc"
func kept(_ address: String = "studio.kosmosplus.com", owner: String = Board.owner(of: "sess-abc")) -> String {
    Board.encode(Board.SavedMacSession(name: "Studio Mac", address: address, cookie: "c00kie", owner: owner))!
}
let info: [AnyHashable: Any] = ["kind": "replied", "id": "reply:2026-10-23T12:00:00.000Z:ada", "session": "ada", "address": "studio.kosmosplus.com"]

section("Reply: one category, set by the extension and registered by the app")
check(NotificationAction.replyCategory == PhoneNotice.replyCategory, "the app and the extension name the same category")
let categories = NotificationCategories.all()
let reply = categories.first { $0.identifier == NotificationAction.replyCategory }
check(reply != nil, "the app registers the Reply category")
check(reply?.actions.count == 1 && reply?.actions.first?.identifier == NotificationAction.replyAction, "it offers exactly one action, Reply")
check(reply?.actions.first is UNTextInputNotificationAction, "Reply takes typed text")
check(reply?.actions.first?.options == [], "Reply does not ask to unlock, and does not open the app")
check(categories.first { $0.identifier == NotificationCategories.agentPermission }?.actions.isEmpty == true, "the coordinator's permission category still offers no buttons: it rides pushes the computer was never asked about (#3870)")
func words(_ kind: String) -> PhoneNotice.Words { PhoneNotice.Words(kind: kind, session: "ada", agent: "Ada", text: "Done.", picture: nil) }
check(PhoneNotice.offersReply(words("reply")), "Reply is offered on an agent's own reply to the person")
check(!PhoneNotice.offersReply(words("report")), "never on a needs-you (a question or a permission prompt): typed words there could answer a menu the person cannot see")
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? ".")
let manager = (try? String(contentsOf: repo.appendingPathComponent("ios/Kosmos/PushNotificationManager.swift"), encoding: .utf8)) ?? ""
check(manager.contains("case NotificationAction.replyAction:") && manager.contains("NotificationAction.replyRequest("), "the app handles Reply, so it is never a dead button (#3870)")

section("Reply: the request goes only to the computer the notice came from, with its kept sign-in")
let r = NotificationAction.replyRequest(userInfo: info, text: "  On it, thanks  ", stored: kept(), session: session, coordinator: coordinator)
check(r?.httpMethod == "POST" && r?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/ada/thread", "a POST to that agent's chat on that computer")
check(r?.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && r?.httpShouldHandleCookies == false, "with the kept cookie, by hand")
check(r?.timeoutInterval == 13, "the send's idle limit sits just under its 14 s total")
check(NotificationAction.checkRequest(userInfo: info, stored: kept(), session: session, coordinator: coordinator)?.timeoutInterval == 7, "the read's idle limit sits just under its 8 s total")
let sent = r.flatMap { $0.httpBody }.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
check(sent?["text"] as? String == "On it, thanks", "the text, trimmed, as the chat sends it (Board.sendRequest)")
var other = info; other["address"] = "office.kosmosplus.com"
check(NotificationAction.replyRequest(userInfo: other, text: "hi", stored: kept(), session: session, coordinator: coordinator) == nil, "a notice from another computer than the kept one: nothing sent")
check(NotificationAction.replyRequest(userInfo: info, text: "hi", stored: kept(owner: Board.owner(of: "someone-else")), session: session, coordinator: coordinator) == nil, "another account's computer: nothing sent")
check(NotificationAction.replyRequest(userInfo: info, text: "hi", stored: kept(), session: nil, coordinator: coordinator) == nil, "signed out: nothing sent")
var noAgent = info; noAgent["session"] = "../etc"
check(NotificationAction.replyRequest(userInfo: noAgent, text: "hi", stored: kept(), session: session, coordinator: coordinator) == nil, "a malformed agent name: nothing sent")
check(NotificationAction.replyRequest(userInfo: info, text: "   ", stored: kept(), session: session, coordinator: coordinator) == nil, "nothing typed: nothing sent")

section("Reply: not sent while the agent is asking, whatever the board could read")
func v(_ status: Int, _ json: String?) -> NotificationAction.ReadVerdict { NotificationAction.verdict(status: status, data: json.map { Data($0.utf8) }, agent: "Ada") }
check(v(200, #"{"messages":[],"olderCount":0,"asking":true,"question":null}"#) == .asking, "asking with no question row (a menu the board could not read): not sent")
check(v(200, #"{"messages":[{"at":"2026-10-23T12:00:00.000Z","text":"Deploy? 1 yes 2 no","from":"ada","kind":"question"}],"olderCount":0,"asking":true}"#) == .asking, "a question the agent reported itself (dated, among the rows): not sent")
check(v(200, #"{"messages":[{"at":"2026-10-23T11:00:00.000Z","text":"Pick one","from":"ada","kind":"question"}],"olderCount":0,"asking":false}"#) == .go, "a past question last, the agent no longer asking: the reply goes")
check(v(200, #"{"messages":null,"olderCount":0,"asking":false}"#) == .go, "a history it could not read, the agent not asking: the reply goes (the send itself can work)")
check(v(200, #"{"messages":[{"at":"2026-10-23T12:00:00.000Z","text":"hi","from":"ada"},{"text":"Pick one","from":"ada","kind":"question"}],"olderCount":0}"#) == .asking, "an older board with no asking field: its live question row (last, no time) still stops it")
check(v(200, #"{"messages":[{"at":"2026-10-23T12:00:00.000Z","text":"Done.","from":"ada"}],"olderCount":0}"#) == .go, "an older board, nothing asked: the reply goes")
if case .unreadable = v(200, #"{"olderCount":0}"#) { check(true, "an older board's answer that is not a chat: fails closed") } else { check(false, "an older board's answer that is not a chat: fails closed") }
if case .unreadable = v(200, "<html>") { check(true, "a 200 that is not JSON: fails closed") } else { check(false, "a 200 that is not JSON: fails closed") }
if case .unreadable(let said) = v(0, nil) { check(said.hasPrefix("Kosmos could not reach your computer"), "no answer: 'could not reach'") } else { check(false, "no answer: unreadable") }
if case .unreadable(let said) = v(401, #"{"error":"x"}"#) { check(said.hasPrefix("Your computer did not let this phone in"), "a 401: the sign-in, not 'could not reach'") } else { check(false, "a 401: unreadable") }
if case .unreadable(let said) = v(404, #"{"error":"x"}"#) { check(said.hasPrefix("Kosmos could not read your chat with Ada"), "a 404: 'could not read', not 'could not reach'") } else { check(false, "a 404: unreadable") }
check(NotificationAction.checkRequest(userInfo: info, stored: kept(), session: session, coordinator: coordinator).map { $0.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/ada/thread" && $0.httpMethod != "POST" } == true, "the check reads that agent's chat on that computer")
check(NotificationAction.askingNotice(agent: "Ada").contains("was not sent"), "the person is told the reply was not sent, and why")
check(manager.contains("case .asking:\n            tell(NotificationAction.askingNotice(agent: agent), about: userInfo)\n            return"), "asking: the app tells the person and returns before any send")
check(manager.contains("case .unreadable(let said):\n            tell(said, about: userInfo)\n            return"), "unreadable: the app tells the person and returns before any send")
// Inside sendReply only: the Allow and Deny handler has its own send (checked in its own section).
let replyFn = manager.range(of: "private func sendReply(").map { String(manager[$0.lowerBound...]) } ?? ""
if let checkAt = replyFn.range(of: "NotificationAction.verdict("), let sendAt = replyFn.range(of: "Self.sendHTTP.data(for: request)") {
    check(checkAt.lowerBound < sendAt.lowerBound, "the app reads the chat before it sends")
} else { check(false, "the app reads the chat before it sends") }
check(manager.contains("replySession(total: 8)") && manager.contains("replySession(total: 14)"), "the read and the send have hard total limits, together inside iOS's time for an action")
let service = (try? String(contentsOf: repo.appendingPathComponent("ios/KosmosNotice/NotificationService.swift"), encoding: .utf8)) ?? ""
check(service.contains("if PhoneNotice.offersReply(words) { content.categoryIdentifier = PhoneNotice.replyCategory }"), "the extension sets Reply only through offersReply")

section("Reply: what the person is told, and nothing is ever sent twice")
check(NotificationAction.notice(after: .kept(at: "t"), agent: "Ada") == nil, "kept: nothing to say, it is in the chat")
check(NotificationAction.notice(after: .taken, agent: "Ada") == nil, "taken: nothing to say")
check(NotificationAction.notice(after: .keptUndelivered(at: "t", note: "Waiting to send"), agent: "Ada") == nil, "held: it goes by itself once the agent is ready")
section("Allow and Deny (part 2): only from the computer's own answer, never lasting, both ask to unlock")
check(NotificationCategories.permissionCategory == PhoneNotice.permissionCategory, "the app and the extension name the same category")
check(NotificationCategories.permissionInfoKey == PhoneNotice.permissionInfoKey, "the app reads Allow and Deny under the key the extension writes")
let permCat = categories.first { $0.identifier == NotificationCategories.permissionCategory }
check(permCat?.actions.map { $0.identifier } == [NotificationCategories.allowAction, NotificationCategories.denyAction], "it offers exactly Allow then Deny")
check(permCat?.actions.map { $0.title } == ["Allow", "Deny"], "worded Allow and Deny, as the chat's card")
check(permCat?.actions.allSatisfy { $0.options == [.authenticationRequired] } == true, "both ask to unlock, and neither is marked destructive (equal weight)")
let fp = String(repeating: "a1", count: 32)
func permJSON(kind: String = "report", allow: Int = 1, deny: Int = 3, request: String = fp, asked: String = "Do you want to proceed?") -> PhoneNotice.Words? {
    let body = #"{"kind":"\#(kind)","session":"ada","agent":"Ada","text":"Claude needs your permission to use Bash","picture":null,"permission":{"kind":"command","allow":{"n":\#(allow),"label":"Yes"},"deny":{"n":\#(deny),"label":"No"},"asked":"\#(asked)","request":"\#(request)"}}"#
    return PhoneNotice.words(status: 200, contentType: "application/json", data: Data(body.utf8), userInfo: ["session": "ada"])
}
let pw = permJSON()
check(pw?.permission?.allow == PhoneNotice.Choice(n: 1, label: "Yes") && pw?.permission?.request == fp, "the notice's permission decodes")
check(pw.flatMap(PhoneNotice.offeredPermission) != nil, "a needs-you carrying a usable permission offers Allow and Deny")
check(permJSON(kind: "reply").flatMap(PhoneNotice.offeredPermission) == nil, "CONTROL: never on an agent's reply")
check(permJSON(deny: 1).flatMap(PhoneNotice.offeredPermission) == nil, "CONTROL: Allow and Deny on the same key")
check(permJSON(request: "short").flatMap(PhoneNotice.offeredPermission) == nil, "CONTROL: no fingerprint, no buttons")
check(permJSON(asked: "").flatMap(PhoneNotice.offeredPermission) == nil, "CONTROL: no question identity, no buttons")
check(words("report").permission == nil && PhoneNotice.offeredPermission(words("report")) == nil, "CONTROL: an older computer's answer with no permission offers nothing")
let pinfo = pw.flatMap(PhoneNotice.offeredPermission).map(PhoneNotice.permissionInfo)
check(pinfo?["allowN"] as? Int == 1 && pinfo?["denyLabel"] as? String == "No" && pinfo?["request"] as? String == fp, "it rides the notice as plist values")
check(service.contains("PhoneNotice.offeredPermission(words)") && service.contains("content.categoryIdentifier = PhoneNotice.permissionCategory"), "the extension sets the category only through offeredPermission")

section("Allow and Deny: the press, checked against the chat read just before it")
var pinfoNotice = info
pinfoNotice[PhoneNotice.permissionInfoKey] = pinfo ?? [:]
let pAllow = NotificationAction.permissionPress(pinfoNotice, action: NotificationAction.allowAction)
let pDeny = NotificationAction.permissionPress(pinfoNotice, action: NotificationAction.denyAction)
check(pAllow == NotificationAction.PermissionPress(n: 1, label: "Yes", asked: "Do you want to proceed?", request: fp, allow: true), "Allow presses the prompt's own Yes")
check(pDeny?.n == 3 && pDeny?.label == "No" && pDeny?.allow == false, "Deny presses the prompt's own No")
check(NotificationAction.permissionPress(info, action: NotificationAction.allowAction) == nil, "CONTROL: a notice with no permission on it presses nothing")
check(NotificationAction.permissionPress(pinfoNotice, action: NotificationAction.replyAction) == nil, "CONTROL: Reply is not a press")
func thread(asking: Bool = true, asked: String = "Do you want to proceed?", request: String = fp) -> Data {
    Data(#"{"asking":\#(asking),"asked":"\#(asked)","messages":[{"at":null,"text":"Do you want to proceed?","from":"ada","kind":"question","permission":{"kind":"command","allow":1,"deny":3,"request":"\#(request)"}}]}"#.utf8)
}
check(NotificationAction.permissionVerdict(status: 200, data: thread(), press: pAllow!, agent: "Ada") == .go, "the same request still up: it goes")
check(NotificationAction.permissionVerdict(status: 200, data: thread(request: String(repeating: "b2", count: 32)), press: pAllow!, agent: "Ada") == .changed, "CONTROL: another command under the same question and options: refused (the minutes-old notice)")
check(NotificationAction.permissionVerdict(status: 200, data: thread(asking: false), press: pAllow!, agent: "Ada") == .changed, "CONTROL: answered on the computer since: refused")
check(NotificationAction.permissionVerdict(status: 200, data: thread(asked: "Something else?"), press: pAllow!, agent: "Ada") == .changed, "CONTROL: a different question: refused")
check(NotificationAction.permissionVerdict(status: 200, data: Data(#"{"asking":true,"asked":"Do you want to proceed?","messages":[]}"#.utf8), press: pAllow!, agent: "Ada") == .changed, "CONTROL: no card on the chat (an older computer, or the box scrolled): refused")
if case .unreadable(let said) = NotificationAction.permissionVerdict(status: 0, data: nil, press: pDeny!, agent: "Ada") {
    check(said.contains("nothing was denied") && said.contains("Open the chat"), "no answer: says nothing was denied, and where to answer")
} else { check(false, "no answer reads as unreadable") }
check(NotificationAction.changedNotice(agent: "Ada", allow: true).contains("nothing was allowed"), "the refusal says nothing was allowed")

section("Allow and Deny: the request is the chat's own press, and the app handles both buttons")
let pr = NotificationAction.pressRequest(userInfo: pinfoNotice, press: pAllow!, stored: kept(), session: session, coordinator: coordinator)
let prBody = pr?.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
check(pr?.httpMethod == "POST" && pr?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/ada/thread", "a POST to that agent's chat on that computer")
check(prBody?["text"] as? String == "1" && prBody?["chose"] as? String == "Yes" && prBody?["asked"] as? String == "Do you want to proceed?", "the body is the board's press: the digit, the option's own words, the question")
check(prBody?["lasting"] == nil, "never a lasting choice")
check(pr?.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && pr?.httpShouldHandleCookies == false && pr?.timeoutInterval == 13, "the kept cookie by hand, the send's idle limit")
check(NotificationAction.pressRequest(userInfo: pinfoNotice, press: pAllow!, stored: kept(owner: Board.owner(of: "someone-else")), session: session, coordinator: coordinator) == nil, "another account's computer: nothing sent")
check(NotificationAction.pressNotice(after: .sent, agent: "Ada", allow: true) == nil, "sent: quiet, as the chat's Allowed.")
check(NotificationAction.pressNotice(after: .notSure("x"), agent: "Ada", allow: true)?.contains("check before pressing again") == true, "not sure: look before pressing again")
check(NotificationAction.pressNotice(after: .refused("Its screen moved"), agent: "Ada", allow: false) == "Nothing was denied for Ada: Its screen moved.", "refused: the computer's reason")
check(manager.contains("case NotificationAction.allowAction, NotificationAction.denyAction:") && manager.contains("NotificationAction.permissionVerdict(") && manager.contains("NotificationAction.pressRequest("), "the app handles Allow and Deny, checking the request before it sends (no dead buttons, #3870)")
if let a = manager.range(of: "NotificationAction.permissionVerdict("), let b = manager.range(of: "Self.sendHTTP.data(for: request)\n        let result = Board.pressResult") {
    check(a.lowerBound < b.lowerBound, "the check comes before the send")
} else { check(false, "the check and the send are both in the handler") }

let couldNot = Data(#"{"delivery":{"state":"could_not","because":"Ada is not running","at":"t"},"recorded":true}"#.utf8)
let refusedKept = Board.sendResult(status: 200, body: couldNot)
check(NotificationAction.notice(after: refusedKept, agent: "Ada", body: couldNot) == "Kosmos could not send your reply to Ada: Ada is not running.", "kept but not typed (the board refused): never silent, with the board's reason")
check(NotificationAction.notice(after: .keptUndelivered(at: "t", note: "Not confirmed"), agent: "Ada")?.contains("check before sending it again") == true, "kept, typing not confirmed: look before sending again")
check(NotificationAction.notice(after: .unconfirmed, agent: "Ada")?.contains("check before sending it again") == true, "unconfirmed: look before sending again")
check(NotificationAction.notice(after: .noAnswer, agent: "Ada")?.contains("may not have gone") == true, "no answer: it may not have gone")
check(NotificationAction.notice(after: .refused("Ada is not running"), agent: "Ada") == "Kosmos could not send your reply to Ada: Ada is not running.", "refused: the computer's reason, as a sentence")
check(NotificationAction.notice(after: .refused(nil), agent: "") == "Kosmos could not send your reply to your agent. Open the chat to try again.", "no name: 'your agent'")
check(NotificationAction.cannotSend(agent: "Ada").contains("Open the chat"), "no kept computer: says where to send it instead")
let follow = NotificationAction.followUpInfo(info)
check(follow.count == 2 && PushBridge.boardURL(fromNotification: follow, coordinator: coordinator)?.host == "studio.kosmosplus.com", "the follow-up notice opens that computer's chat for that agent when tapped")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
