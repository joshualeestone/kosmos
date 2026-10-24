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
check(categories.first { $0.identifier == NotificationCategories.agentPermission }?.actions.isEmpty == true, "the permission category still offers no buttons (part 2, #7017)")
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
check(r?.timeoutInterval == 10, "an idle limit under the sessions' total limits")
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
if case .unreadable(let said) = v(0, nil) { check(said.hasPrefix("Kosmos could not reach your computer"), "no answer: 'could not reach'") } else { check(false, "no answer: unreadable") }
if case .unreadable(let said) = v(401, #"{"error":"x"}"#) { check(said.hasPrefix("Your computer did not let this phone in"), "a 401: the sign-in, not 'could not reach'") } else { check(false, "a 401: unreadable") }
if case .unreadable(let said) = v(404, #"{"error":"x"}"#) { check(said.hasPrefix("Kosmos could not read your chat with Ada"), "a 404: 'could not read', not 'could not reach'") } else { check(false, "a 404: unreadable") }
check(NotificationAction.checkRequest(userInfo: info, stored: kept(), session: session, coordinator: coordinator).map { $0.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/ada/thread" && $0.httpMethod != "POST" } == true, "the check reads that agent's chat on that computer")
check(NotificationAction.askingNotice(agent: "Ada").contains("was not sent"), "the person is told the reply was not sent, and why")
check(manager.contains("case .asking:\n            tell(NotificationAction.askingNotice(agent: agent), about: userInfo)\n            return"), "asking: the app tells the person and returns before any send")
check(manager.contains("case .unreadable(let said):\n            tell(said, about: userInfo)\n            return"), "unreadable: the app tells the person and returns before any send")
if let checkAt = manager.range(of: "NotificationAction.verdict("), let sendAt = manager.range(of: "Self.sendHTTP.data(for: request)") {
    check(checkAt.lowerBound < sendAt.lowerBound, "the app reads the chat before it sends")
} else { check(false, "the app reads the chat before it sends") }
check(manager.contains("replySession(total: 8)") && manager.contains("replySession(total: 14)"), "the read and the send have hard total limits, together inside iOS's time for an action")
let service = (try? String(contentsOf: repo.appendingPathComponent("ios/KosmosNotice/NotificationService.swift"), encoding: .utf8)) ?? ""
check(service.contains("if PhoneNotice.offersReply(words) { content.categoryIdentifier = PhoneNotice.replyCategory }"), "the extension sets Reply only through offersReply")

section("Reply: what the person is told, and nothing is ever sent twice")
check(NotificationAction.notice(after: .kept(at: "t"), agent: "Ada") == nil, "kept: nothing to say, it is in the chat")
check(NotificationAction.notice(after: .taken, agent: "Ada") == nil, "taken: nothing to say")
check(NotificationAction.notice(after: .keptUndelivered(at: "t", note: "Waiting to send"), agent: "Ada") == nil, "held: it goes by itself once the agent is ready")
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
