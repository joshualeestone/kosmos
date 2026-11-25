import Foundation

// kosmos#8959 slice C: deleting the Kosmos+ account, native. The web page (kosmos-relay coordinator/src/signin.html at
// /delete-account: DELETE mode, `delConfirm`, `delSend`) and this screen are two clients of the same four routes
// (kosmos-relay coordinator/src/account_delete.rs), which enforce every step themselves:
//   POST /v1/account/delete/start    {email}               -> a code is emailed (the same answer for any address)
//   POST /v1/account/delete/verify   {email, code}         -> a grant, or a second-step challenge when one is set up
//   POST /v1/account/delete/second   {challenge, code}     -> the grant
//   POST /v1/account/delete/confirm  {grant, understood}   -> outcome: deleted | still_deleting | nothing_changed
// None takes a session: an old sign-in is never enough to delete (account_delete.rs). Every route refuses with
// `deletion_off` while KOSMOS_ACCOUNT_DELETION is unset; that refusal is shown as Kosmos+'s own sentence.
// 🛑 Confirming ends billing (money) and cannot be undone. Every word here is the page's; billing's are Josh's calls in
// account_delete.rs's header, and the phone only repeats them. UIKit-free, so ios/LogicTests/run-deleteaccount.sh proves
// it on a Mac.
enum DeleteAccount {
    static let startPath = "/v1/account/delete/start"
    static let verifyPath = "/v1/account/delete/verify"
    static let secondPath = "/v1/account/delete/second"
    static let confirmPath = "/v1/account/delete/confirm"

    // MARK: - Requests (built as AccountSecond builds its own: server.ios-routes-6838 reads this form)

    private static func request(_ path: String, coordinator: URL, body: [String: Any]) -> URLRequest {
        var r = URLRequest(url: coordinator.appendingPathComponent(String(path.dropFirst())))
        r.httpMethod = "POST"
        r.timeoutInterval = 15
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        r.httpShouldHandleCookies = false
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    static func startRequest(coordinator: URL, email: String) -> URLRequest {
        request(startPath, coordinator: coordinator, body: ["email": email])
    }

    static func verifyRequest(coordinator: URL, email: String, code: String) -> URLRequest {
        request(verifyPath, coordinator: coordinator, body: ["email": email, "code": code])
    }

    static func secondRequest(coordinator: URL, challenge: String, code: String) -> URLRequest {
        request(secondPath, coordinator: coordinator, body: ["challenge": challenge, "code": code])
    }

    /// `understood` is the screen's "I understand" switch; the request is only built once it is on, as the page's
    /// Delete my account does nothing while the box is unticked.
    /// It waits as long as Kosmos+ takes: confirm ends billing at Stripe before it answers (several calls in a row, each
    /// allowed 20 s, account_delete.rs `finish`), and the page waits with no limit. A phone that gave up sooner would say
    /// "could not be reached" about a deletion that is going ahead.
    static func confirmRequest(coordinator: URL, grant: String) -> URLRequest {
        var r = request(confirmPath, coordinator: coordinator, body: ["grant": grant, "understood": true])
        r.timeoutInterval = confirmTimeout
        return r
    }
    static let confirmTimeout: TimeInterval = 180

    /// The email as typed, trimmed (Kosmos+ normalises it again). The page's own check comes first: SignIn.looksLikeEmail.
    static func email(_ raw: String) -> String? {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return SignIn.looksLikeEmail(t) ? t : nil
    }

    // MARK: - Answers

    /// What the confirm screen shows (account_delete.rs `preview`).
    struct Preview: Equatable {
        let email: String?
        /// The page's two variants. Only "none" reads as no subscription: a value this app does not know reads as the
        /// subscription words, because an irreversible screen must never understate what it ends (account_delete.rs).
        let subscription: Bool
        /// Companies this account is the only admin of (kosmos#5555); an unnamed one reads "your company", as the page.
        let onlyAdminOf: [String]
    }

    struct Grant: Equatable {
        let token: String
        let preview: Preview
    }

    static func preview(_ value: Any?) -> Preview {
        let p = value as? [String: Any] ?? [:]
        let email = (p["email"] as? String).flatMap { e -> String? in
            let t = e.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }
        let orgs = (p["onlyAdminOf"] as? [Any] ?? []).map { n -> String in
            let t = (n as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return t.isEmpty ? "your company" : t
        }
        return Preview(email: email, subscription: p["plan"] as? String != "none", onlyAdminOf: orgs)
    }

    enum Started: Equatable {
        /// A code is on its way (or no account has that address: Kosmos+ answers the same, #2664).
        case sent
        /// Kosmos+'s sentence (the off switch, too many codes, an address it will not take).
        case refused(String)
    }

    static func started(status: Int, json: Any?) -> Started {
        guard (200..<300).contains(status) else { return .refused(sentence(json) ?? couldNotWords) }
        return .sent
    }

    /// Kosmos+'s refusal, with a long wait in words, as the page's plainWait: "in 1290 seconds" reads "in about 22 minutes".
    static func sentence(_ json: Any?) -> String? {
        let body = json as? [String: Any] ?? [:]
        guard var t = body["error"] as? String else { return nil }
        if let secs = (body["retry_after_secs"] as? NSNumber)?.intValue, secs >= 120,
           let r = t.range(of: #"in \d+ seconds?"#, options: .regularExpression) {
            t.replaceSubrange(r, with: "in " + waitWords(secs))
        }
        return SignIn.refusal(t)
    }

    static func waitWords(_ secs: Int) -> String {
        if secs < 120 { return "\(secs)" + (secs == 1 ? " second" : " seconds") }
        let m = (secs + 59) / 60
        return m == 60 ? "about an hour" : "about \(m) minutes"
    }

    /// How long "Send the code again" waits after a send, as the page's: 90 s after a code went, Kosmos+'s own wait after
    /// a 429, none after any other refusal.
    static func resendWait(status: Int, json: Any?) -> Int {
        if (200..<300).contains(status) { return 90 }
        if status == 429, let secs = ((json as? [String: Any])?["retry_after_secs"] as? NSNumber)?.intValue, secs > 0 { return secs }
        return 0
    }

    enum Checked: Equatable {
        /// The grant: the confirm screen opens.
        case grant(Grant)
        /// A second step is set up: one more code. `sentTo` is where a text went.
        case second(kind: String, challenge: String, sentTo: String?)
        /// A wrong code: the screen stays, with Kosmos+'s sentence under the field ("...; 4 tries left").
        case refused(String)
        /// Nothing more can be done on this code (an expired step, too many tries, an answer with no grant): back to the
        /// email screen with the sentence, as the page's "Start again from the email".
        case startOver(String)
    }

    /// verify's and second's answers. The delete door never enrols and never signs in: a grant, a challenge, or nothing.
    static func checked(status: Int, json: Any?) -> Checked {
        let body = json as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            let sentence = sentence(json)
            if let sentence, SignIn.startsOver(sentence) { return .startOver(sentence) }
            return .refused(sentence ?? codeRefused)
        }
        if let kind = body["second"] as? String, !kind.isEmpty {
            guard let challenge = body["challenge"] as? String, !challenge.isEmpty else { return .startOver(didNotWork) }
            return .second(kind: kind, challenge: challenge, sentTo: SignIn.cleanMessage(body["sent_to"]))
        }
        guard let grant = body["grant"] as? String, !grant.isEmpty else { return .startOver(didNotWork) }
        return .grant(Grant(token: grant, preview: preview(body["preview"])))
    }

    enum Outcome: Equatable {
        case deleted
        case stillDeleting
        /// Nothing was deleted; the same grant may be sent again (Try again).
        case nothingChanged
        /// The grant is spent or expired (a 401), or a refusal: back to the email screen with the sentence. A dead grant is
        /// never sent again.
        case startOver(String)
        /// No answer this app can read (a proxy's page, no body): as if nothing came back. The same grant stays, with Try
        /// again, as the page's catch.
        case noAnswer
        /// An earlier confirm on this grant went out and its answer never came back, and now the grant is refused: the
        /// deletion may have finished with it (it spends the grant in the same transaction). Saying "start again" would
        /// tell someone whose account is gone that it is not.
        case unknown
    }

    /// The page reads `outcome` whatever the status (deleted 200, still_deleting 202, nothing_changed 503). `answerLost`:
    /// a confirm on this same grant was sent before and no answer came back.
    static func outcome(status: Int, json: Any?, answerLost: Bool = false) -> Outcome {
        let body = json as? [String: Any] ?? [:]
        switch body["outcome"] as? String {
        case "deleted": return .deleted
        case "still_deleting": return .stillDeleting
        case "nothing_changed": return .nothingChanged
        default:
            guard let sentence = SignIn.refusal(body["error"]) else { return .noAnswer }
            // A valid grant for an account that no longer exists (account_delete.rs confirm): the sweep finished it.
            if status == 401, sentence == alreadyGone { return .deleted }
            if answerLost { return .unknown }
            return .startOver(sentence)
        }
    }
    static let alreadyGone = "That account is already gone."

    // MARK: - Signing this iPhone out after a deletion

    /// Whether the session this iPhone holds goes, once a deletion is done (`deleted` true); asked when the person leaves
    /// the done screen, or at the answer when the screen is gone already. Never twice, never before `deleted`, never for another
    /// account: when Kosmos+ said whose account this iPhone holds (`ownEmail`, from /v1/account/me) and the deleted one
    /// is a different address, this iPhone's account still exists. When either is unknown it signs out, as the page
    /// forgets every session it holds: a dead session kept is worse than a live one ended.
    static func signsOut(deleted: Bool, already: Bool, ownEmail: String?, deletedEmail: String?) -> Bool {
        guard deleted, !already else { return false }
        if let own = ownEmail?.lowercased(), let gone = deletedEmail?.lowercased(), own != gone { return false }
        return true
    }

    // MARK: - Words (the page's own, signin.html)

    static let title = "Delete your Kosmos+ account"
    static let intro = "For the Kosmos app's Kosmos+ account. We will email you a code first, so we know it is yours."
    static let continueWord = "Continue"
    static let howTitle = "How it works"
    static let howWords = "We email you a code. You enter it, then your second sign-in code if you set one up: the one from your authenticator app, or the one we text to your phone. You confirm, and your account is deleted."
    static let whatTitle = "What is deleted"
    static let whatWords = "Your Kosmos+ address, reaching your computers from anywhere, the devices you allowed, notifications on your phone, and your sign-in. Kosmos on your computers is not touched."
    static let keptTitle = "What we keep"
    static let keptWords = "Your billing records, because the law requires them, and entries already written to our server logs. Everything else is deleted."

    static let codeTitle = "Check your email"
    static let codeLife = "It is good for ten minutes."
    static func codeWords(email: String) -> String { "Type the six-digit code we sent to \(email). " + codeLife }
    static let secondTitle = "One more code"
    static func secondWords(kind: String, sentTo: String?) -> String {
        // A texted code lasts as the emailed one, and the page says so beside it (secondClock); an app's code has no lifetime line.
        if kind == "sms" { return "Type the six-digit code we texted to " + (sentTo ?? "your phone") + ". " + codeLife }
        return "Type the six-digit code your authenticator app shows for Kosmos."
    }
    static let startAgain = "Start again from the email"

    static let confirmTitle = "Delete your Kosmos+ account?"
    static func deletingFor(_ email: String) -> String { "Deleting the account for \(email)." }
    static let deletesTitle = "This deletes"
    static let deletes = ["Your Kosmos+ address", "Reaching your computers from anywhere", "The devices you allowed",
                          "Notifications on your phone", "Your sign-in and two-factor settings"]
    static let notDeletedTitle = "This does not delete"
    static let notDeletedWords = "Kosmos on your computers. Your agents, projects and files stay there and keep working."
    static let companyTitle = "Your company"
    static func companyWords(_ orgs: [String]) -> String? {
        orgs.isEmpty ? nil : "You are the only admin of " + orgs.joined(separator: ", ") + ". Make someone else an admin there first, or your company is left without one."
    }
    static let subscriptionTitle = "Your subscription"
    static func subscriptionWords(_ subscription: Bool) -> String {
        subscription ? "It ends now, and you will not be charged again. What is left of this billing period is not refunded."
                     : "You have no subscription to cancel."
    }
    static func keepWords(_ subscription: Bool) -> String {
        subscription ? "Your billing records, because the law requires them, and entries already written to our server logs. Everything else is deleted now."
                     : "Your billing records, if you ever paid, because the law requires them, and entries already written to our server logs. Everything else is deleted now."
    }
    static let understood = "I understand this cannot be undone."
    static let deleteButton = "Delete my account"
    static let tickHint = "Tick the box above to delete."
    static let keepButton = "Keep my account"

    static let doneTitle = "Your Kosmos+ account is deleted"
    static func doneNote(_ email: String) -> String { "We sent a note to \(email) saying so." }
    static let doneWords = "Kosmos keeps working on your computers. You can make a new Kosmos+ account any time."
    static let failedTitle = "We could not delete your account"
    static let failedWords = "Nothing was deleted. Something on our side did not answer. Try again in a minute."
    static let tryAgain = "Try again"
    static let sendAgain = "Send the code again"
    static let newCodeSent = "New code sent."
    static let pendingTitle = "We are still deleting your account"
    static let pendingWords = "Part of it did not finish just now. We will finish it and email you when it is done. You will not be charged again."
    /// The page's line without "and you can close this page": there is no page to close here.
    static let pendingClose = "You do not need to do anything."

    static let unreachable = "Kosmos+ could not be reached just now. Try again in a minute."
    // Not on the page (its flow has the same gap): what the phone says when it cannot tell. Kosmos+ emails the address
    // when a deletion finishes (account_delete.rs finish), so the email is where the person can find out.
    static let unknownTitle = "We could not tell whether your account was deleted"
    static let unknownWords = "Kosmos+ did not answer in time, and the confirmation cannot be used again. If your account was deleted, we emailed you to say so. If no email comes, start again from the email."
    static let didNotWork = "That did not work. Start again from the email."
    static let codeRefused = "That code is not right."
    static let notAnEmail = "That does not look like an email address."
    static let couldNotWords = "Something went wrong. Try again."
}
