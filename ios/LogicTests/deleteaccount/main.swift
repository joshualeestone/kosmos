import Foundation

var total = 0, failures = 0
func check(_ ok: Bool, _ what: String) { total += 1; if !ok { failures += 1; print("FAIL: " + what) } }

typealias D = DeleteAccount
let coordinator = URL(string: "https://login.kosmosplus.com")!

func body(_ r: URLRequest) -> [String: Any] {
    (r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:]
}

// The four routes (kosmos-relay coordinator/src/lib.rs), each a POST with JSON and no session.
for (r, path) in [(D.startRequest(coordinator: coordinator, email: "a@b.co"), "/v1/account/delete/start"),
                  (D.verifyRequest(coordinator: coordinator, email: "a@b.co", code: "123456"), "/v1/account/delete/verify"),
                  (D.secondRequest(coordinator: coordinator, challenge: "ch1", code: "654321"), "/v1/account/delete/second"),
                  (D.confirmRequest(coordinator: coordinator, grant: "kdg1_x"), "/v1/account/delete/confirm")] {
    check(r.url?.absoluteString == "https://login.kosmosplus.com" + path, "\(path): the route")
    check(r.httpMethod == "POST", "\(path): a POST")
    check(r.value(forHTTPHeaderField: "Content-Type") == "application/json", "\(path): JSON")
    check(r.value(forHTTPHeaderField: "Authorization") == nil, "\(path): no session is sent (an old sign-in is never enough)")
    check(!r.httpShouldHandleCookies, "\(path): no cookies")
}
check(body(D.startRequest(coordinator: coordinator, email: "a@b.co")) as NSDictionary == ["email": "a@b.co"], "start's body")
check(body(D.verifyRequest(coordinator: coordinator, email: "a@b.co", code: "123456")) as NSDictionary == ["email": "a@b.co", "code": "123456"], "verify's body")
check(body(D.secondRequest(coordinator: coordinator, challenge: "ch1", code: "654321")) as NSDictionary == ["challenge": "ch1", "code": "654321"], "second's body")
let cb = body(D.confirmRequest(coordinator: coordinator, grant: "kdg1_x"))
check(cb["grant"] as? String == "kdg1_x" && cb["understood"] as? Bool == true && cb.count == 2, "confirm sends the grant and understood: true")

// The email, as the page checks it before a round trip.
check(D.email("  a@b.co \n") == "a@b.co", "trimmed")
check(D.email("a@b") == nil && D.email("ab.co") == nil && D.email("a b@c.co") == nil && D.email("") == nil, "not an email")

// start: the same answer for any address; refusals in Kosmos+'s own sentence.
check(D.started(status: 200, json: ["ok": true, "message": "if that email has a Kosmos+ account, a code is on its way"]) == .sent, "sent")
check(D.started(status: 503, json: ["error": "deleting an account is not open yet", "code": "deletion_off"]) == .refused("Deleting an account is not open yet."),
      "the off switch reads as Kosmos+'s sentence")
check(D.started(status: 400, json: ["error": "that does not look like an email address"]) == .refused("That does not look like an email address."), "a refused address")
check(D.started(status: 429, json: nil) == .refused(D.couldNotWords), "no sentence: the page's own")

// verify and second: a grant, a challenge, a wrong code, or start over.
let grant: [String: Any] = ["grant": "kdg1_abc", "expires_at": 1, "preview": ["email": "a@b.co", "plan": "subscription", "onlyAdminOf": ["Acme", "", 4]]]
check(D.checked(status: 200, json: grant) == .grant(.init(token: "kdg1_abc", preview: .init(email: "a@b.co", subscription: true, onlyAdminOf: ["Acme", "your company", "your company"]))),
      "a grant, with the preview; an unnamed company reads as the page's")
check(D.checked(status: 200, json: ["grant": "g", "preview": ["plan": "none"]]) == .grant(.init(token: "g", preview: .init(email: nil, subscription: false, onlyAdminOf: []))), "no plan")
// Never understate: anything but "none" reads as the subscription words.
check(D.preview(["plan": "enterprise"]).subscription && D.preview([:]).subscription && D.preview(nil).subscription, "an unknown or missing plan reads as a subscription")
check(D.preview(["email": "  "]).email == nil, "a blank email is none")
check(D.checked(status: 200, json: ["second": "sms", "challenge": "ch1", "sent_to": "•••• 42"]) == .second(kind: "sms", challenge: "ch1", sentTo: "•••• 42"), "a texted second step")
check(D.checked(status: 200, json: ["second": "totp", "challenge": "ch1", "sent_to": NSNull()]) == .second(kind: "totp", challenge: "ch1", sentTo: nil), "an authenticator")
check(D.checked(status: 200, json: ["second": "sms"]) == .startOver(D.didNotWork), "a challenge with no id")
check(D.checked(status: 200, json: ["token": "a-session"]) == .startOver(D.didNotWork), "a session is never taken as a grant (the delete door never signs in)")
check(D.checked(status: 200, json: ["grant": ""]) == .startOver(D.didNotWork), "an empty grant")
check(D.checked(status: 401, json: ["error": "that code is not right or has expired"]) == .refused("That code is not right or has expired."), "a wrong email code stays")
check(D.checked(status: 401, json: ["error": "that code is not the one we texted; 4 tries left"]) == .refused("That code is not the one we texted; 4 tries left."), "a wrong second code stays")
check(D.checked(status: 401, json: ["error": "too many wrong second codes; start again from the email"]) == .startOver("Too many wrong second codes; start again from the email."), "too many: start over")
check(D.checked(status: 401, json: ["error": "that step has expired or was already finished; start again from the email"]) == .startOver("That step has expired or was already finished; start again from the email."), "an expired step: start over")
check(D.checked(status: 503, json: ["error": "deleting an account is not open yet"]) == .refused("Deleting an account is not open yet."), "the off switch")
check(D.checked(status: 500, json: nil) == .refused(D.codeRefused), "no sentence")

// confirm: the three outcomes, whatever the status; anything else starts over and the grant is not sent again.
check(D.outcome(status: 200, json: ["outcome": "deleted"]) == .deleted, "deleted")
check(D.outcome(status: 202, json: ["outcome": "still_deleting"]) == .stillDeleting, "still deleting")
check(D.outcome(status: 503, json: ["outcome": "nothing_changed"]) == .nothingChanged, "nothing changed")
check(D.outcome(status: 401, json: ["error": "that confirmation has expired; start again from the email"]) == .startOver("That confirmation has expired; start again from the email."), "an expired grant")
check(D.outcome(status: 400, json: ["error": "tick the box to say you understand this cannot be undone"]) == .startOver("Tick the box to say you understand this cannot be undone."), "understood missing")
check(D.outcome(status: 200, json: ["outcome": "gone"]) == .startOver(D.didNotWork), "an outcome this app does not know is not read as deleted")
check(D.outcome(status: 200, json: nil) == .startOver(D.didNotWork), "no body")

// The variants.
check(D.subscriptionWords(true) == "It ends now, and you will not be charged again. What is left of this billing period is not refunded.", "subscription")
check(D.subscriptionWords(false) == "You have no subscription to cancel.", "none")
check(D.keepWords(true) != D.keepWords(false), "the two keep lines")
check(D.companyWords([]) == nil, "no company line")
check(D.companyWords(["Acme", "your company"]) == "You are the only admin of Acme, your company. Make someone else an admin there first, or your company is left without one.", "the company line")
check(D.secondWords(kind: "sms", sentTo: nil) == "Type the six-digit code we texted to your phone.", "a text with no number")
check(D.secondWords(kind: "totp", sentTo: "x") == "Type the six-digit code your authenticator app shows for Kosmos.", "the authenticator")
check(D.codeWords(email: "a@b.co") == "Type the six-digit code we sent to a@b.co. It is good for ten minutes.", "the code line")

// Read the page itself when the repo is at hand (both repos side by side under ~/work, or KOSMOS_RELAY set): the words
// must not drift from the page they copy. Without the page this says so and checks nothing, rather than passing.
let relay = ProcessInfo.processInfo.environment["KOSMOS_RELAY"] ?? (NSHomeDirectory() + "/work/kosmos-relay")
if !relay.isEmpty, let page = try? String(contentsOfFile: relay + "/coordinator/src/signin.html", encoding: .utf8) {
    var words: [(String, String)] = [
        ("title", D.title), ("intro", D.intro), ("continueWord", D.continueWord), ("howTitle", D.howTitle), ("howWords", D.howWords),
        ("whatTitle", D.whatTitle), ("whatWords", D.whatWords), ("keptTitle", D.keptTitle), ("keptWords", D.keptWords),
        ("codeTitle", D.codeTitle), ("codeLife", D.codeLife), ("secondTitle", D.secondTitle), ("startAgain", D.startAgain),
        ("confirmTitle", D.confirmTitle), ("deletesTitle", D.deletesTitle), ("notDeletedTitle", D.notDeletedTitle),
        ("notDeletedWords", D.notDeletedWords), ("companyTitle", D.companyTitle), ("subscriptionTitle", D.subscriptionTitle),
        ("subscription", D.subscriptionWords(true)), ("none", D.subscriptionWords(false)), ("keep", D.keepWords(true)),
        ("keepNone", D.keepWords(false)), ("understood", D.understood), ("deleteButton", D.deleteButton), ("tickHint", D.tickHint),
        ("keepButton", D.keepButton), ("doneTitle", D.doneTitle), ("doneWords", D.doneWords), ("failedTitle", D.failedTitle),
        ("failedWords", D.failedWords), ("tryAgain", D.tryAgain), ("pendingTitle", D.pendingTitle), ("pendingWords", D.pendingWords),
        ("unreachable", D.unreachable), ("didNotWork", D.didNotWork), ("codeRefused", D.codeRefused),
        ("notAnEmail", D.notAnEmail), ("couldNotWords", D.couldNotWords),
        ("company sentence", "Make someone else an admin there first, or your company is left without one."),
        ("deletingFor", "Deleting the account for "), ("doneNote", "saying so."),
        ("secondWords sms", "Type the six-digit code we texted to "), ("secondWords app", D.secondWords(kind: "totp", sentTo: nil)),
        ("codeWords", "Type the six-digit code we sent to "),
    ]
    words += D.deletes.map { ("deletes: " + $0, "<li>" + $0 + "</li>") }
    for (name, w) in words { check(page.contains(w), "\(name) is the page's own words") }
    // The one the phone shortens: the page's line, less the page it closes.
    check(page.contains(D.pendingClose.dropLast() + ", and you can close this page."), "pendingClose is the page's line less its last clause")
    // The page's own verdict on an unknown plan, which the phone deliberately does not copy (it never understates).
    check(page.contains(#"if (p.plan === "subscription") {"#), "the page's plan test is still the one this file departs from")
} else {
    print("NOTE: kosmos-relay's signin.html is not beside this checkout; the words were not compared with the page")
}

print(failures == 0 ? "VERDICT: PASS \(total)/\(total)" : "VERDICT: FAIL \(total - failures)/\(total)")
exit(failures == 0 ? 0 : 1)
