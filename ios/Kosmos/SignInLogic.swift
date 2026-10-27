import Foundation
import CryptoKit

// kosmos#7042 (iPhone slice 5a, #6838): the native sign-in's logic, UIKit-free so ios/LogicTests proves it on a Mac.
// The routes are Kosmos+'s phone sign-in (kosmos-relay coordinator/src/signin.rs, second.rs, websession.rs, devkey.rs):
//   POST /v1/signin/start   { email, device_id, device_name }            the same answer for any address
//   POST /v1/signin/verify  { email, device_id, device_name, code, device_key, device_sig }
//   POST /v1/signin/second  { challenge, code }
//   GET  /v1/account/me     the Allow, watched every 3 s while it is pending (as the web sign-in page does)
// A company's own sign-in (kosmos#7045), an authenticator app as the second step to set up (kosmos#7046) and passkeys
// (kosmos#7050) are native too; the web sign-in page is the fallback for what this app cannot do, such as a company sign-in before iOS 17.4.
enum SignIn {
    static let startPath = "/v1/signin/start"
    static let verifyPath = "/v1/signin/verify"
    static let secondPath = "/v1/signin/second"
    static let mePath = "/v1/account/me"

    // kosmos#7357: the App Store review door (kosmos-relay review.rs). ONE review account signs in with a password and
    // no second step; its session still waits for the review computer's Allow, like any sign-in. The door is closed
    // unless Kosmos+ is configured for a review window, and closed it answers like a path that does not exist (404);
    // open, it takes POST only, so a GET answers 405. Its answer is verify's, plus the server's own device id, which
    // the phone does not need (the session is the token).
    static let reviewPath = "/v1/signin/review"
    static func reviewBody(email: String, password: String, deviceName: String) -> [String: Any] {
        ["email": email, "password": password, "device_name": deviceName]
    }
    /// What a review sign-in's answer means for the screen. A refusal stays on the password step with its sentence (it
    /// is never a code step: no code was sent), and a 404 means the door closed since the link showed.
    enum ReviewAnswer: Equatable { case closed, refused(String), answered(Answer) }
    static let reviewRefused = "That email and password do not match."
    static let reviewTooMany = "Too many tries. Wait a minute, then try again."
    static let reviewNoAnswer = "Kosmos+ could not answer. Try again."
    static let reviewClosed = "Password sign-in is not open now. Sign in with a code instead."
    static func reviewAnswer(status: Int, json: Any?) -> ReviewAnswer {
        if status == 404 { return .closed }
        let answer = answer(status: status, json: json)
        if case .refused(let message, _) = answer {
            // Kosmos+'s own sentence when it gave one; otherwise only a 401 says the password is wrong.
            if let message { return .refused(message) }
            return .refused(status == 401 ? reviewRefused : status == 429 ? reviewTooMany : reviewNoAnswer)
        }
        return .answered(answer)
    }
    /// Whether the review door is open, from a GET's status: nil when the answer says neither (asked again later).
    static func reviewDoorOpen(status: Int) -> Bool? {
        switch status {
        case 405: return true
        case 404: return false
        default: return nil
        }
    }
    /// Where the sign-in page keeps its session (kosmos-relay signin.html restore(): localStorage only; the page never
    /// sends `x-kosmos-web`, so the server's HttpOnly cookie, websession.rs, is not what it reads).
    static let pageSessionKey = "kosmos_session"
    /// How often the Allow is asked about while it is pending: the web sign-in page's own interval.
    static let allowPollSeconds: Double = 3

    // MARK: - What the person typed

    /// The coordinator's own test, loosely: something@something.something, no spaces. The coordinator decides; this
    /// only keeps an obvious typo from costing a round trip.
    static func looksLikeEmail(_ raw: String) -> Bool {
        let email = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !email.contains(where: { $0.isWhitespace }), let at = email.firstIndex(of: "@"),
              email.filter({ $0 == "@" }).count == 1 else { return false }
        let local = email[..<at], domain = email[email.index(after: at)...]
        guard !local.isEmpty, let dot = domain.lastIndex(of: "."), dot != domain.startIndex else { return false }
        return domain.index(after: dot) != domain.endIndex
    }

    /// A six-digit code, as the web page checks before sending (spaces a person may type between groups dropped).
    static func code(_ raw: String) -> String? {
        let digits = raw.filter { !$0.isWhitespace }
        return digits.count == 6 && digits.allSatisfy({ $0.isASCII && $0.isNumber }) ? digits : nil
    }

    // MARK: - The device's proof (kosmos#5422)

    /// The coordinator's device id for a public key (devkey.rs derive_id): "k1." and the first 32 characters of the
    /// base64url SHA-256 of the key's SPKI DER.
    static func deviceID(spki: Data) -> String {
        "k1." + String(base64url(Data(SHA256.hash(data: spki))).prefix(32))
    }

    /// What a device signs (devkey.rs message): one field per line. `email` exactly as the request carries it.
    static func proofMessage(door: String = "signin", email: String, code: String, deviceID: String) -> Data {
        Data("kosmos-device-v1\n\(door)\n\(email)\n\(code)\n\(deviceID)".utf8)
    }

    /// base64url with no padding, the coordinator's written form.
    static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func fromBase64url(_ text: String) -> Data? {
        var s = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        return Data(base64Encoded: s)
    }

    /// A key that can sign the proof: the app's Secure Enclave key on a device, a software key on the simulator and in
    /// the tests. `spki` is the public key as SPKI DER; `sign` gives ECDSA P-256 SHA-256 as raw r||s (64 bytes).
    struct DeviceKey {
        let spki: Data
        let sign: (Data) throws -> Data
        var id: String { SignIn.deviceID(spki: spki) }

        static func software(_ key: P256.Signing.PrivateKey) -> DeviceKey {
            DeviceKey(spki: key.publicKey.derRepresentation, sign: { try key.signature(for: $0).rawRepresentation })
        }
    }

    // MARK: - Request bodies

    static func startBody(email: String, deviceID: String, deviceName: String) -> [String: Any] {
        ["email": email, "device_id": deviceID, "device_name": deviceName]
    }

    /// The verify body, with the proof. The email goes exactly as signed: the coordinator checks the proof over the
    /// email as sent, before it normalises it.
    static func verifyBody(email: String, code: String, deviceName: String, key: DeviceKey) throws -> [String: Any] {
        let sig = try key.sign(proofMessage(email: email, code: code, deviceID: key.id))
        return ["email": email, "device_id": key.id, "device_name": deviceName, "code": code,
                "device_key": base64url(key.spki), "device_sig": base64url(sig)]
    }

    static func secondBody(challenge: String, code: String) -> [String: Any] { ["challenge": challenge, "code": code] }

    // MARK: - Answers

    /// What a signed-in answer carries that the screens use. The token is the session the web bridge hands over.
    struct Session: Equatable {
        let token: String
        let deviceStatus: DeviceStatus
        let matchCode: String?
        let hasComputer: Bool
    }

    enum DeviceStatus: String { case pending, acked, denied }

    /// One of verify's (or second's) answers.
    enum Answer: Equatable {
        case signedIn(Session)
        /// A second step is set up: the email code opened a challenge. `sentTo` is where an SMS went.
        case second(kind: String, challenge: String, sentTo: String?)
        /// A second step is required and not set up yet: that happens on the web sign-in page for now.
        /// kosmos#7046: the token is good only for setting up the step (never a session); `sms` whether texts can be sent.
        case needsSetup(token: String, sms: Bool)
        /// Refused, with the coordinator's own sentence when it sent one. `proofRefused`: the device key was refused.
        case refused(message: String?, proofRefused: Bool)
        /// Not an answer this screen understands (a newer coordinator): the web sign-in page takes over.
        case unknown
        /// kosmos#7045: a first company sign-in makes the account, and its terms are agreed on the sign-in page.
        case needsTerms
    }

    static func answer(status: Int, json: Any?) -> Answer {
        let body = json as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            let code = body["code"] as? String
            // kosmos#7045: a first company sign-in creates the account, and the terms are agreed on the page.
            if code == "terms_required" { return .needsTerms }
            return .refused(message: cleanMessage(body["error"]), proofRefused: code == "device_proof_refused")
        }
        if body["enrol"] as? Bool == true {
            guard let token = body["token"] as? String, !token.isEmpty else { return .unknown }
            return .needsSetup(token: token, sms: body["sms_available"] as? Bool == true)
        }
        if let kind = body["second"] as? String, !kind.isEmpty {
            guard let challenge = body["challenge"] as? String, !challenge.isEmpty else { return .unknown }
            return .second(kind: kind, challenge: challenge, sentTo: cleanMessage(body["sent_to"]))
        }
        guard let token = body["token"] as? String, !token.isEmpty else { return .unknown }
        // A status this app does not know is read as still waiting: the watch then asks again, and nothing says allowed.
        let status = (body["device_status"] as? String).flatMap(DeviceStatus.init(rawValue:)) ?? .pending
        let match = (body["match_code"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let hasComputer = !((body["addresses"] as? [Any]) ?? []).isEmpty
        return .signedIn(Session(token: token, deviceStatus: status, matchCode: match, hasComputer: hasComputer))
    }

    /// start's answer: whether this address's company signs in through its own provider and requires it. Then no code
    /// is coming, and the web sign-in page (with its company sign-in) takes over.
    static func companySignInRequired(json: Any?) -> Bool {
        (json as? [String: Any])?["sso_required"] as? Bool == true
    }

    // MARK: - A company's own sign-in (kosmos#7045), in Apple's sign-in sheet

    /// Where Kosmos+ returns a company sign-in (kosmos-relay sso.rs callback): its own /signin page, the grant in the
    /// fragment. Apple's sheet finishes there (an https callback, iOS 17.4+) only for an app associated with the host
    /// (webcredentials, the app's entitlement and Kosmos+'s apple-app-site-association), so no other app can receive
    /// it. (A custom-scheme return was built first and abandoned: any app can register a scheme; #7045.)
    static let returnPath = "/signin"
    /// What a company sign-in's grant starts with (sso.rs GRANT_PREFIX); it is spent at verify in place of the code.
    static let grantPrefix = "ksso1_"

    /// start's company sign-in address (`sso_url`), as the page to open in Apple's sheet. Only Kosmos+'s own begin path
    /// on the coordinator: an address anywhere else is never opened. Kept byte for byte (rebuilding its query would
    /// decode `%2B` in an address like ann+work@ into a `+`, which the server reads as a space).
    static func companySignInURL(json: Any?, coordinator: URL) -> URL? {
        guard let path = (json as? [String: Any])?["sso_url"] as? String, path.hasPrefix("/v1/sso/begin?"),
              !path.contains("#"),
              let url = URL(string: path, relativeTo: coordinator)?.absoluteURL,
              url.scheme == coordinator.scheme, url.host == coordinator.host, url.port == coordinator.port else { return nil }
        return url
    }

    /// What Apple's sheet brought back.
    enum CompanyReturn: Equatable {
        /// The grant, and the email the provider vouched for (sign in with exactly this one, as the page does).
        case grant(String, email: String)
        /// The coordinator's one-word refusal, already in the page's sentence.
        case refused(String)
    }

    /// Only Kosmos+'s own /signin on the coordinator, the grant in the fragment, a refusal in the query. Nil for anything
    /// else (nothing is guessed).
    static func companyReturn(_ url: URL, coordinator: URL) -> CompanyReturn? {
        guard url.scheme?.lowercased() == "https", url.host?.lowercased() == coordinator.host?.lowercased(),
              url.port == coordinator.port, url.path == returnPath else { return nil }
        let pairs = { (text: String?) -> [String: String] in
            var out: [String: String] = [:]
            for kv in (text ?? "").split(separator: "&") {
                let p = kv.split(separator: "=", maxSplits: 1).map(String.init)
                if p.count == 2, let v = p[1].removingPercentEncoding { out[p[0]] = v }
            }
            return out
        }
        let fragment = pairs(url.fragment), query = pairs(URLComponents(url: url, resolvingAgainstBaseURL: false)?.query)
        if let word = query["sso_error"] { return .refused(companyWords[word] ?? companyWords["failed"]!) }
        if let grant = fragment["sso_grant"], grant.hasPrefix(grantPrefix), let email = fragment["email"], looksLikeEmail(email) {
            return .grant(grant, email: email)
        }
        return nil
    }

    /// The page's sentences for each refusal (kosmos-relay signin.html ssoReturn SSO_WORDS), word for word.
    static let companyWords: [String: String] = [
        "cancelled": "You did not finish signing in with your company's account. Try again, or use your email code.",
        "expired": "That company sign-in took too long or was already used. Try again.",
        "not_provisioned": "Your company has not given you access to Kosmos+. Ask the people who run your company's accounts.",
        "not_member": "Your company's sign-in vouched for this address, but it is not a member of that company in Kosmos+. Sign in with your email code.",
        "wrong_person": "Your company's sign-in said you are someone else. Sign in again with the account for this address.",
        "unavailable": "Your company's sign-in is turned off right now. Sign in with your email code.",
        "failed": "Signing in with your company's account did not work. Try again, or use your email code.",
    ]

    // MARK: - Passkey sign-in (kosmos#7050 slice C)

    // Kosmos+'s passkey routes (kosmos-relay passkey.rs): begin answers a signed challenge and takes nothing; finish
    // checks the assertion and answers a one-time grant, spent at verify in place of the code, as a company sign-in's
    // is. With passkeys off on the coordinator both routes answer 404, and the app offers no passkey.
    static let passkeyBeginPath = "/v1/signin/passkey/begin"
    static let passkeyFinishPath = "/v1/signin/passkey/finish"
    static let passkeyGrantPrefix = "kpk1_"

    /// What begin offered: the challenge to sign and the relying party it is for.
    struct PasskeyOffer: Equatable {
        let challenge: Data
        let rpID: String
    }

    /// begin's answer, only when a passkey can work here: a 200 with a challenge, user verification required, and the
    /// relying party exactly the coordinator's host (the app's webcredentials association is for that host, and the
    /// coordinator checks the origin and the rpId hash against its own spelling, which iOS builds from what it is
    /// given). Anything else: no passkey offered.
    static func passkeyOffer(status: Int, json: Any?, coordinator: URL) -> PasskeyOffer? {
        guard status == 200, let body = json as? [String: Any],
              let challenge = (body["challenge"] as? String).flatMap(fromBase64url), !challenge.isEmpty,
              let rp = body["rp_id"] as? String, let host = coordinator.host, rp == host,
              body["user_verification"] as? String == "required" else { return nil }
        return PasskeyOffer(challenge: challenge, rpID: rp)
    }

    /// finish's body: the assertion as the page sends it (base64url), and this iPhone's device id, which the grant is
    /// bound to and which verify then proves.
    static func passkeyFinishBody(credentialID: Data, authenticatorData: Data, clientDataJSON: Data, signature: Data,
                                  userHandle: Data?, deviceID: String) -> [String: Any] {
        var body: [String: Any] = [
            "credential_id": base64url(credentialID),
            "authenticator_data": base64url(authenticatorData),
            "client_data_json": base64url(clientDataJSON),
            "signature": base64url(signature),
            "device_id": deviceID,
        ]
        if let userHandle, !userHandle.isEmpty { body["user_handle"] = base64url(userHandle) }
        return body
    }

    /// What finish said.
    enum PasskeyFinish: Equatable {
        /// The grant, and the account's email to spend it with at verify.
        case grant(String, email: String)
        /// A sentence to show on the email step.
        case refused(String)
    }

    static func passkeyFinish(status: Int, json: Any?) -> PasskeyFinish {
        let body = json as? [String: Any]
        if status == 200, let code = body?["code"] as? String, code.hasPrefix(passkeyGrantPrefix),
           let email = body?["email"] as? String, looksLikeEmail(email) {
            return .grant(code, email: email)
        }
        if body?["code"] as? String == "sso_required" { return .refused(passkeyWords.company) }
        return .refused(cleanMessage(body?["error"]) ?? passkeyWords.failed)
    }

    /// The page's sentences for passkey sign-in (kosmos-relay signin.html), in the app's words for its own buttons.
    static let passkeyWords = (
        notUsed: "The passkey was not used. Try again, or use the code we email you.",
        failed: "That passkey sign-in did not work. Try again, or use the code we email you.",
        company: "Your company asks you to sign in with its own account. Enter your email and press Send code.",
        off: "Passkey sign-in is not available right now. Use the code we email you."
    )

    /// The Allow, read from /v1/account/me.
    enum AllowRead: Equatable {
        /// With what the same answer says about the account's computers (signin.rs session_view carries addresses and
        /// the match code), so a computer connected meanwhile shows its code (review round 3).
        case status(DeviceStatus, matchCode: String?, hasComputer: Bool)
        /// The session itself was refused (signed out everywhere, the account going): the watch stops, as the web
        /// page's does on a 401.
        case ended
        /// Nothing usable (no answer, a server error): asked again on the next tick.
        case unknown
    }

    static func allowRead(status: Int?, json: Any?) -> AllowRead {
        guard let status else { return .unknown }
        if status == 401 { return .ended }
        let body = json as? [String: Any]
        guard (200..<300).contains(status), let s = body?["device_status"] as? String,
              let known = DeviceStatus(rawValue: s) else { return .unknown }
        let match = (body?["match_code"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return .status(known, matchCode: match, hasComputer: !((body?["addresses"] as? [Any]) ?? []).isEmpty)
    }

    /// The coordinator's sentence, kept short and on one line; nil when it sent none.
    static func cleanMessage(_ value: Any?) -> String? {
        guard let s = value as? String else { return nil }
        let one = s.components(separatedBy: .newlines).joined(separator: " ").trimmingCharacters(in: .whitespaces)
        if one.isEmpty { return nil }
        return one.count > 200 ? String(one.prefix(200)) : one
    }

    // MARK: - The web view, signed in too

    /// A URL's origin as a browser's `location.origin` writes it: scheme://host, and :port only when it is not the
    /// scheme's default. Lowercased, as browsers give it.
    static func pageOrigin(_ url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return nil }
        let defaultPort = scheme == "https" ? 443 : scheme == "http" ? 80 : nil
        if let port = url.port, port != defaultPort { return "\(scheme)://\(host):\(port)" }
        return "\(scheme)://\(host)"
    }

    /// A script for the start of every main-frame document (WKUserScript, atDocumentStart): on the sign-in page's own
    /// origin it puts the app's session where the page keeps its own (localStorage, `pageSessionKey`; the page reads no
    /// cookie, review round 1), BEFORE the page's restore() reads it. Run later (at didFinish, as rounds 1 to 3 did) it
    /// loses to restore(), which has already sent the old value to /v1/account/me, and a dead old value then signs out
    /// the fresh native session (review round 4). The app's keychain is the source: every session the page makes it
    /// hands to the app, so a page holding anything else holds one the app no longer has and is overwritten. Nothing
    /// reloads. The token goes in as a JSON string literal, never spliced as text.
    /// `token` nil (the app holds no session): a value the app dropped (`forget`: sessions backed out of, or ended) is
    /// removed from the page instead, so the page cannot hand it back to the app (review round 7). Anything else the
    /// page holds is left as it is. Nil when there is nothing to do.
    static func sessionScript(token: String?, forget: [String] = [], origin: String) -> String? {
        if token == nil && forget.isEmpty { return nil }
        let held: Any = token ?? NSNull()
        guard let data = try? JSONSerialization.data(withJSONObject: [held, pageSessionKey, origin, forget], options: []),
              let array = String(data: data, encoding: .utf8) else { return nil }
        return "(function () { var a = \(array); if (location.origin !== a[2]) return; try { var v = localStorage.getItem(a[1]); "
            + "if (a[0] !== null) { if (v !== a[0]) localStorage.setItem(a[1], a[0]); } "
            + "else if (v !== null && a[3].indexOf(v) >= 0) localStorage.removeItem(a[1]); } catch (e) {} })();"
    }

    // MARK: - The screens' steps

    enum Step: Equatable {
        case email
        case code(email: String)
        /// kosmos#7357: the review account's email and password, offered only while the review door is open.
        case password
        case second(email: String, kind: String, challenge: String, sentTo: String?)
        /// Signed in; the Mac has not answered the Allow yet (or has no computer to answer it).
        case allow(matchCode: String?, hasComputer: Bool)
        /// The Mac said no. `asking`: told at sign-in, when Kosmos+ has already made it a fresh Allow on the Mac
        /// (signin.rs), so the screen still waits; false once the Mac has said no to that one too.
        case denied(asking: Bool)
        /// kosmos#7046: a second step must be set up before this sign-in finishes. `token` is the enrol-only one.
        case setup(token: String, sms: Bool)
        /// The authenticator's secret to add, then its first code to confirm.
        case setupConfirm(token: String, otpauth: String, secret: String)
        /// Over to the web sign-in page, with why (one line the screen shows first).
        case web(reason: String)
        case done
    }

    /// The step a verify or second answer leads to, and the session to hand over when there is one.
    static func next(after answer: Answer, email: String) -> (step: Step, session: Session?, error: String?) {
        switch answer {
        case .signedIn(let s):
            switch s.deviceStatus {
            case .acked: return (.done, s, nil)
            case .denied: return (.denied(asking: true), s, nil)
            case .pending: return (.allow(matchCode: s.matchCode, hasComputer: s.hasComputer), s, nil)
            }
        case .second(let kind, let challenge, let sentTo):
            return (.second(email: email, kind: kind, challenge: challenge, sentTo: sentTo), nil, nil)
        case .needsSetup(let token, let sms):
            return (.setup(token: token, sms: sms), nil, nil)
        case .refused(let message, let proofRefused):
            return (proofRefused ? .web(reason: webForKey) : .code(email: email), nil,
                    proofRefused ? nil : (message ?? "That code is not right or has expired."))
        case .unknown:
            return (.web(reason: webForUnknown), nil, nil)
        case .needsTerms:
            return (.web(reason: webForTerms), nil, nil)
        }
    }

    static let webForCompany = "This continues on the Kosmos+ sign-in page, where your company's own sign-in opens."
    static let webForSetup = "Your account needs its second sign-in step set up first. That continues on the sign-in page."
    static let webForKey = "This iPhone could not prove its key to Kosmos+, so this continues on the sign-in page."
    static let webForTerms = "Your company's sign-in will make your Kosmos+ account, and that starts with agreeing to its terms on the sign-in page."
    static let webForUnknown = "Kosmos+ answered in a way this app does not know yet, so this continues on the sign-in page."

    // MARK: - Setting up a required second step (kosmos#7046)

    static let enrolPath = "/v1/second/enrol"
    static let confirmPath = "/v1/second/confirm"

    static func enrolBody() -> [String: Any] { ["kind": "totp"] }
    static func confirmBody(code: String) -> [String: Any] { ["code": code] }

    /// enrol's answer for an authenticator: the otpauth link and the secret (kosmos-relay second.rs EnrolResp), or the
    /// coordinator's own sentence. Only an otpauth://totp/ link is taken.
    enum Enrolled: Equatable { case totp(otpauth: String, secret: String), refused(String) }

    static func enrolled(status: Int, json: Any?) -> Enrolled {
        let body = json as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else { return .refused(cleanMessage(body["error"]) ?? "That did not work. Try again.") }
        guard body["kind"] as? String == "totp", let link = body["otpauth"] as? String, link.hasPrefix("otpauth://totp/"),
              let secret = body["secret"] as? String, !secret.isEmpty else { return .refused("That did not work. Try again.") }
        return .totp(otpauth: link, secret: secret)
    }

    /// The secret as a person types it: groups of four.
    static func grouped(secret: String) -> String {
        stride(from: 0, to: secret.count, by: 4).map { i -> String in
            let start = secret.index(secret.startIndex, offsetBy: i)
            return String(secret[start..<(secret.index(start, offsetBy: 4, limitedBy: secret.endIndex) ?? secret.endIndex)])
        }.joined(separator: " ")
    }

    static let setupWords = "Your account needs a second sign-in step. Set up an authenticator app now: it shows a new six-digit code every 30 seconds."
    static let webForTexts = "Setting up text messages continues on the sign-in page."

    /// A refusal no new code can fix: Kosmos+ says to start again (the enrol-only token expired, nothing is being set
    /// up any more, the setup is damaged) or the account is gone (second.rs). The person goes back to the email rather
    /// than retrying here. A wrong code says neither, and stays.
    static func startsOver(_ message: String?) -> Bool {
        let m = message ?? ""
        // "sign in again": signed out everywhere, or this device removed, since the setup began (second.rs refuse_signed_out).
        return ["start again", "sign in again", "no such account", "no longer exists", "being deleted"].contains { m.range(of: $0, options: .caseInsensitive) != nil }
    }

    /// The second step's line, as the web page words it (secondWords). The authenticator shows "Kosmos" (the issuer
    /// in kosmos-relay totp.rs). A masked number stays whole on one line (non-breaking spaces; Mona Lisa's review).
    static func secondWords(kind: String, sentTo: String?) -> String {
        let to = sentTo.map { $0.replacingOccurrences(of: " ", with: "\u{00A0}") } ?? "your phone"
        return kind == "sms" ? "Type the six-digit code we texted to \(to). It is good for ten minutes."
            : "Type the six-digit code your authenticator app shows for Kosmos."
    }

    /// An email address that wraps only after its @ or a dot, never inside a word with an inserted hyphen (an inserted
    /// hyphen reads as part of the address; Mona Lisa's review). Zero-width spaces give the line those breaks.
    static func wrappable(email: String) -> String {
        email.replacingOccurrences(of: "@", with: "@\u{200B}").replacingOccurrences(of: ".", with: ".\u{200B}")
    }

    /// The hand-over screen's title: a company sign-in names itself; the others say what happens next.
    static func webTitle(reason: String) -> String {
        reason == webForCompany ? "Your company signs you in" : "Finish signing in on the next page"
    }
}
