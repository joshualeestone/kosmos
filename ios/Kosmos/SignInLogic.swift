import Foundation
import CryptoKit

// kosmos#7042 (iPhone slice 5a, #6838): the native sign-in's logic, UIKit-free so ios/LogicTests proves it on a Mac.
// The routes are Kosmos+'s phone sign-in (kosmos-relay coordinator/src/signin.rs, second.rs, websession.rs, devkey.rs):
//   POST /v1/signin/start   { email, device_id, device_name }            the same answer for any address
//   POST /v1/signin/verify  { email, device_id, device_name, code, device_key, device_sig }
//   POST /v1/signin/second  { challenge, code }
//   GET  /v1/account/me     the Allow, watched every 3 s while it is pending (as the web sign-in page does)
// A company's own sign-in, a second step not set up yet, and passkeys stay on the web sign-in page (slices 5b, 5c).
enum SignIn {
    static let startPath = "/v1/signin/start"
    static let verifyPath = "/v1/signin/verify"
    static let secondPath = "/v1/signin/second"
    static let mePath = "/v1/account/me"
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
        case needsSetup
        /// Refused, with the coordinator's own sentence when it sent one. `proofRefused`: the device key was refused.
        case refused(message: String?, proofRefused: Bool)
        /// Not an answer this screen understands (a newer coordinator): the web sign-in page takes over.
        case unknown
    }

    static func answer(status: Int, json: Any?) -> Answer {
        let body = json as? [String: Any] ?? [:]
        guard (200..<300).contains(status) else {
            let code = body["code"] as? String
            return .refused(message: cleanMessage(body["error"]), proofRefused: code == "device_proof_refused")
        }
        if body["enrol"] as? Bool == true { return .needsSetup }
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

    /// The Allow, read from /v1/account/me.
    enum AllowRead: Equatable {
        case status(DeviceStatus)
        /// The session itself was refused (signed out everywhere, the account going): the watch stops, as the web
        /// page's does on a 401.
        case ended
        /// Nothing usable (no answer, a server error): asked again on the next tick.
        case unknown
    }

    static func allowRead(status: Int?, json: Any?) -> AllowRead {
        guard let status else { return .unknown }
        if status == 401 { return .ended }
        guard (200..<300).contains(status), let s = (json as? [String: Any])?["device_status"] as? String,
              let known = DeviceStatus(rawValue: s) else { return .unknown }
        return .status(known)
    }

    /// The coordinator's sentence, kept short and on one line; nil when it sent none.
    static func cleanMessage(_ value: Any?) -> String? {
        guard let s = value as? String else { return nil }
        let one = s.components(separatedBy: .newlines).joined(separator: " ").trimmingCharacters(in: .whitespaces)
        if one.isEmpty { return nil }
        return one.count > 200 ? String(one.prefix(200)) : one
    }

    // MARK: - The web view, signed in too

    /// The script the app runs ON the sign-in page (login.kosmosplus.com, its main frame) so the page holds the session
    /// the native sign-in made, where the page itself keeps it (localStorage, `pageSessionKey`). The page is reloaded
    /// after, and its restore() opens signed in. The token goes in as a JSON string literal, never spliced as text.
    /// Returns true once it is stored. (Review round 1: the first version used the server's adopt cookie, which this
    /// page never reads.)
    /// Only when the page holds no session of its own (review round 2): the app's keychain is the source, and a page
    /// signed in as somebody (it handed that session to the app already) is left as it is.
    static func storeScript(token: String) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: [token, pageSessionKey], options: []),
              let array = String(data: data, encoding: .utf8) else { return nil }
        return "var a = \(array); if (localStorage.getItem(a[1])) return false; localStorage.setItem(a[1], a[0]); return localStorage.getItem(a[1]) === a[0];"
    }

    // MARK: - The screens' steps

    enum Step: Equatable {
        case email
        case code(email: String)
        case second(email: String, kind: String, challenge: String, sentTo: String?)
        /// Signed in; the Mac has not answered the Allow yet (or has no computer to answer it).
        case allow(matchCode: String?, hasComputer: Bool)
        /// The Mac said no. `asking`: told at sign-in, when Kosmos+ has already made it a fresh Allow on the Mac
        /// (signin.rs), so the screen still waits; false once the Mac has said no to that one too.
        case denied(asking: Bool)
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
        case .needsSetup:
            return (.web(reason: webForSetup), nil, nil)
        case .refused(let message, let proofRefused):
            return (proofRefused ? .web(reason: webForKey) : .code(email: email), nil,
                    proofRefused ? nil : (message ?? "That code is not right or has expired."))
        case .unknown:
            return (.web(reason: webForUnknown), nil, nil)
        }
    }

    static let webForCompany = "This continues on the Kosmos+ sign-in page, where your company's own sign-in opens."
    static let webForSetup = "Your account needs its second sign-in step set up first. That continues on the sign-in page."
    static let webForKey = "This iPhone could not prove its key to Kosmos+, so this continues on the sign-in page."
    static let webForUnknown = "Kosmos+ answered in a way this app does not know yet, so this continues on the sign-in page."

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
