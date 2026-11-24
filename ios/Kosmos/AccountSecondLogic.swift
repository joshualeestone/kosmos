import Foundation

// kosmos#8959 slice B1b: the second sign-in step on the native Kosmos+ account screen. The web account page
// (kosmos-relay coordinator/src/signin.html, `offerSecond`, the `enrol` and `confirm` handlers, `showEnrolDone`) does two
// things here, and this does the same two, with its words:
//   - when a step is set up, says so;
//   - when none is, offers one (a text message, when Kosmos+ can send them, or an authenticator app).
// It never changes or removes a step; the page does not either (a computer connected to the account resets it).
//
// The routes are Kosmos+'s (kosmos-relay coordinator/src/second.rs), with this iPhone's own session as the bearer:
//   GET  /v1/second          -> { enrolled: "sms" | "totp" | null, sms_available }
//   POST /v1/second/enrol    -> slice A's SignIn.enrolPath, enrolBody and enrolled(status:json:)
//   POST /v1/second/confirm  -> a FRESH session (second.rs confirm, kosmos#3860), see `confirmed`.
// UIKit-free, so ios/LogicTests/run-accountsecond.sh proves it on a Mac.
enum AccountSecond {
    static let statusPath = "/v1/second"

    /// What `GET /v1/second` says. `enrolled` is the kind set up, nil when none is.
    struct Status: Equatable {
        let enrolled: String?
        let smsAvailable: Bool
    }

    enum Read: Equatable {
        case status(Status)
        /// 401: this session is no longer taken, with Kosmos+'s sentence when it sent one (after a second step is set up
        /// elsewhere, or a confirm whose answer was lost, it says to sign in again with it).
        case signedOut(String?)
        /// Anything else (a refusal with its sentence, or an answer this app cannot read): the section says it could not
        /// be read, and nothing is offered. Offering a step on an account that may already have one would replace it.
        case unreadable(String)
    }

    static let unreadableWords = "Kosmos+ could not say whether two-step sign-in is on just now."

    // MARK: - Requests (built as AccountLogic builds its own: server.ios-routes-6838 reads this form)

    private static func request(_ path: String, coordinator: URL, session: String, body: [String: Any]? = nil) -> URLRequest {
        var r = URLRequest(url: coordinator.appendingPathComponent(String(path.dropFirst())))
        r.httpMethod = body == nil ? "GET" : "POST"
        r.timeoutInterval = 15
        r.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        r.httpShouldHandleCookies = false
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    static func statusRequest(coordinator: URL, session: String) -> URLRequest {
        request(statusPath, coordinator: coordinator, session: session)
    }

    /// Slice A's own bodies. A text waits as long as slice A's does (SignIn.textSendTimeout): Kosmos+ answers once the
    /// text is handed to the sender.
    static func enrolRequest(coordinator: URL, session: String, phone: String?) -> URLRequest {
        var r = request(SignIn.enrolPath, coordinator: coordinator, session: session,
                        body: phone.map { SignIn.enrolBody(phone: $0) } ?? SignIn.enrolBody())
        if let wait = SignIn.enrolTimeout(phone: phone) { r.timeoutInterval = wait }
        return r
    }

    static func confirmRequest(coordinator: URL, session: String, code: String) -> URLRequest {
        request(SignIn.confirmPath, coordinator: coordinator, session: session, body: SignIn.confirmBody(code: code))
    }

    static func read(status: Int, json: Any?) -> Read {
        let body = json as? [String: Any] ?? [:]
        if status == 401 { return .signedOut(SignIn.refusal(body["error"])) }
        guard (200..<300).contains(status) else { return .unreadable(SignIn.refusal(body["error"]) ?? unreadableWords) }
        // `enrolled` must be present: a missing key and null are not the same answer, and only null means none.
        guard let value = body["enrolled"] else { return .unreadable(unreadableWords) }
        let kind: String?
        if value is NSNull {
            kind = nil
        } else if let s = value as? String, !s.isEmpty {
            kind = s
        } else {
            return .unreadable(unreadableWords)
        }
        return .status(Status(enrolled: kind, smsAvailable: body["sms_available"] as? Bool == true))
    }

    // MARK: - Words (the page's own)

    static let onTitle = "Two-step sign-in is on"
    /// The page's showEnrolDone sentence. Any kind but a text reads as the authenticator, as the page's does.
    static func onWords(kind: String) -> String {
        "From now on, signing in asks for the email code and then a code " + (kind == "sms" ? "texted to your phone." : "from your authenticator app.")
    }
    static let resetWords = "Any computer connected to this account can reset this step, so only connect computers you own."
    static let lostPhoneTitle = "Lost your phone?"
    static let lostPhoneWords = "On a computer already connected to this account, open Kosmos and go to Settings, then Kosmos+. Choose Lost your phone, then Reset the second step. Then sign in here again and set up your new phone."

    static let offerTitle = "Add a second step"
    static let offerWords = "Signing in would then ask for a code from your phone after the email code, every time, on every device. What is behind this door is your computer."
    static let noTextsWords = "Text messages are not set up on this service yet, so the authenticator app is the one on offer."

    /// The choices the offer shows, texts first when they can be sent, as the page's chooser (it picks texts when shown).
    enum Kind: String, Equatable { case sms, totp }
    static func choices(_ s: Status) -> [Kind] { s.smsAvailable ? [.sms, .totp] : [.totp] }

    /// kosmos#5131: the text service, not the number, refused an enrol. The page turns the chooser to the app.
    static func textsUnavailable(status: Int, json: Any?) -> Bool {
        guard !(200..<300).contains(status) else { return false }
        return (json as? [String: Any])?["code"] as? String == "sms_unavailable"
    }

    // MARK: - Confirming

    static let codeNotSix = "The code is six digits."
    /// The typed code when it is six digits (spaces and dashes a person or a paste adds are dropped), else nil.
    static func code(_ raw: String) -> String? {
        let digits = raw.filter { !$0.isWhitespace && $0 != "-" }
        return digits.count == 6 && digits.allSatisfy({ $0.isASCII && $0.isNumber }) ? digits : nil
    }

    enum Confirmed: Equatable {
        /// The step is on. `fresh` is the session Kosmos+ handed back, which this iPhone must keep from now on: Kosmos+
        /// refuses the old one on an account that has a second step (second.rs, kosmos#3860), so dropping it signs the
        /// person out on the next request. nil only from an older Kosmos+ that sends none; the old session then stays.
        case on(kind: String, fresh: String?)
        /// The step is on, but the fresh session Kosmos+ sent cannot be read. The old one will be refused, so the person
        /// is told to sign in again rather than finding out on the next tap.
        case onSignInAgain(kind: String)
        /// A wrong or expired code: the sheet stays, with Kosmos+'s sentence under the field.
        case refused(String)
        /// A refusal no new code can fix (nothing is being set up any more, the setup is damaged): the sheet closes and
        /// the screen shows the sentence, so the person starts again from the offer.
        case startOver(String)
        /// Kosmos+ says the sign-in itself is over (signed out everywhere, this device removed, the account gone). The screen
        /// shows that sentence; signing this iPhone out is left to the person's own Sign out, as for the computers list.
        case signedOut(String)
    }

    static func signInAgainWords(kind: String) -> String {
        onTitle + ". " + onWords(kind: kind) + " Sign in again on this iPhone to keep going."
    }

    static let codeRefused = "That code is not right."

    static func confirmed(status: Int, json: Any?) -> Confirmed {
        let body = json as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            let sentence = SignIn.refusal(body["error"])
            // second.rs confirm: a wrong code is a 401 whose sentence names the code, and it is the only refusal a new
            // code can fix. Every other 401 comes from the session check (signed out everywhere, this device removed,
            // the account gone, a token that is missing or no longer good). A 403 is a refused device or the review
            // account. A 400 ends the setup when its sentence says to start again.
            switch status {
            case 401:
                guard let sentence else { return .refused(codeRefused) }
                if sentence.range(of: "code", options: .caseInsensitive) != nil, !SignIn.startsOver(sentence) { return .refused(sentence) }
                return .signedOut(sentence)
            case 403:
                return .startOver(sentence ?? "Kosmos+ refused this.")
            default:
                if let sentence, SignIn.startsOver(sentence) { return .startOver(sentence) }
                return .refused(sentence ?? codeRefused)
            }
        }
        let kind = (body["kind"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "totp"
        // The same session shape a sign-in answers with, read by sign-in's own reader.
        if case .signedIn(let session) = SignIn.answer(status: status, json: json) { return .on(kind: kind, fresh: session.token) }
        // A token that is there but unreadable is not "none sent": keeping the old session would sign her out.
        if body["token"] != nil { return .onSignInAgain(kind: kind) }
        return .on(kind: kind, fresh: nil)
    }
}
