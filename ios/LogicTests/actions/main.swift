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
check(categories.first { $0.identifier == NotificationCategories.agentPermission }?.actions.isEmpty == true, "permission notices still offer no buttons (part 2, #7017)")

section("Reply: the request goes only to the computer the notice came from, with its kept sign-in")
let r = NotificationAction.replyRequest(userInfo: info, text: "  On it, thanks  ", stored: kept(), session: session, coordinator: coordinator)
check(r?.httpMethod == "POST" && r?.url?.absoluteString == "https://studio.kosmosplus.com/api/agent/ada/thread", "a POST to that agent's chat on that computer")
check(r?.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && r?.httpShouldHandleCookies == false, "with the kept cookie, by hand")
let sent = r.flatMap { $0.httpBody }.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
check(sent?["text"] as? String == "On it, thanks", "the text, trimmed, as the chat sends it (Board.sendRequest)")
var other = info; other["address"] = "office.kosmosplus.com"
check(NotificationAction.replyRequest(userInfo: other, text: "hi", stored: kept(), session: session, coordinator: coordinator) == nil, "a notice from another computer than the kept one: nothing sent")
check(NotificationAction.replyRequest(userInfo: info, text: "hi", stored: kept(owner: Board.owner(of: "someone-else")), session: session, coordinator: coordinator) == nil, "another account's computer: nothing sent")
check(NotificationAction.replyRequest(userInfo: info, text: "hi", stored: kept(), session: nil, coordinator: coordinator) == nil, "signed out: nothing sent")
var noAgent = info; noAgent["session"] = "../etc"
check(NotificationAction.replyRequest(userInfo: noAgent, text: "hi", stored: kept(), session: session, coordinator: coordinator) == nil, "a malformed agent name: nothing sent")
check(NotificationAction.replyRequest(userInfo: info, text: "   ", stored: kept(), session: session, coordinator: coordinator) == nil, "nothing typed: nothing sent")

section("Reply: what the person is told, and nothing is ever sent twice")
check(NotificationAction.notice(after: .kept(at: "t"), agent: "Ada") == nil, "kept: nothing to say, it is in the chat")
check(NotificationAction.notice(after: .taken, agent: "Ada") == nil, "taken: nothing to say")
check(NotificationAction.notice(after: .keptUndelivered(at: "t", note: "Waiting to send"), agent: "Ada") == nil, "kept to send later: the chat shows it")
check(NotificationAction.notice(after: .unconfirmed, agent: "Ada")?.contains("check before sending it again") == true, "unconfirmed: look before sending again")
check(NotificationAction.notice(after: .noAnswer, agent: "Ada")?.contains("may not have gone") == true, "no answer: it may not have gone")
check(NotificationAction.notice(after: .refused("Ada is not running"), agent: "Ada") == "Kosmos could not send your reply to Ada: Ada is not running.", "refused: the computer's reason, as a sentence")
check(NotificationAction.notice(after: .refused(nil), agent: "") == "Kosmos could not send your reply to your agent. Open the chat to try again.", "no name: 'your agent'")
check(NotificationAction.cannotSend(agent: "Ada").contains("Open the chat"), "no kept computer: says where to send it instead")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
