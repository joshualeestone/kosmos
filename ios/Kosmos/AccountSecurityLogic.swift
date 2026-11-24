import Foundation

// kosmos#8959 slice B1c: passkeys and sign-ins from new places on the native Kosmos+ account screen. The web account
// page (kosmos-relay coordinator/src/signin.html: loadPasskeys, renderPasskeys, removePasskey, the passkey-add handler,
// loadNewPlaces, renderNewPlaces, notMe) is the model, and its words are used.
//
// Routes (kosmos-relay coordinator/src/passkey.rs and second.rs), with this iPhone's own session as the bearer:
//   GET  /v1/passkeys                    -> { passkeys: [{ credential_id, name, created_at, last_used_at, synced }] }
//                                           404 when passkeys are off on this Kosmos+: the section is not shown.
//   POST /v1/passkeys/remove             { credential_id }
//   POST /v1/passkeys/register/begin     -> challenge, rp_id, user_id, user_name, exclude, alg -7, attestation none
//   POST /v1/passkeys/register/finish    { credential_id, authenticator_data, client_data_json, name }
//   Adding and removing need a recent sign-in: Kosmos+ answers `step_up_required`.
//   GET  /v1/account/new-places          -> { new_places: [{ id, at, name, not_me_at }] }
//   POST /v1/account/new-places/not-me   { id }: signs the account out everywhere, this iPhone included.
//
// A browser hands the page `authenticator_data` directly. iOS hands back the whole attestation object (CBOR), so
// `authData(attestationObject:)` takes it out. UIKit-free, so ios/LogicTests/run-accountsecurity.sh proves it on a Mac.
enum AccountSecurity {
    static let listPath = "/v1/passkeys"
    static let removePath = "/v1/passkeys/remove"
    static let beginPath = "/v1/passkeys/register/begin"
    static let finishPath = "/v1/passkeys/register/finish"
    static let newPlacesPath = "/v1/account/new-places"
    static let notMePath = "/v1/account/new-places/not-me"

    // MARK: - Words (the page's own, except where a phone has no page to reload)

    static let passkeysTitle = "Passkeys"
    static let passkeysWords = "A passkey signs you in with your fingerprint, your face or this device's PIN, in place of the code we email you. Your second step, if you have one, still applies."
    static let noPasskeys = "No passkeys yet."
    static let addButton = "Add a passkey"
    static let added = "Passkey added."
    static let removed = "Passkey removed."
    static let stepUp = "For this, your sign-in has to be recent. Sign out, sign in again (with your email code or a passkey), and do it straight away."
    static let addCancelled = "No passkey was added. Press Add a passkey to try again."
    static let addHave = "This device already has a passkey for this account."
    static let addFailed = "That passkey could not be added."
    static let addNotNow = "A passkey could not be added just now."
    static let removeFailed = "That passkey could not be removed."
    /// The page says "Reload this page"; the phone's screen is refreshed by pulling it down (B1a's dotsRefresh).
    static let listFailed = "Your passkeys could not be listed just now. Pull down to try again."

    static let newPlacesTitle = "Sign-ins from new places"
    static let newPlacesWords = "When your account is signed in to from a phone, computer or browser it had not been signed in from before, we email you and list it here for 30 days. If one was not you, press Not me: it signs your account out everywhere, this sign-in included."
    static let notMeButton = "Not me: sign out everywhere"
    static let notMeAsk = "Press it again to sign your account out everywhere, this sign-in included."
    static let notMeFailed = "That did not work. Try again in a moment."
    static let unnamedDevice = "An unnamed device"

    static func removeAsk(name: String) -> String { "Press it again to remove \(name)." }

    // MARK: - Passkeys

    struct Passkey: Equatable {
        let credentialID: String
        let name: String
        let createdAt: Int?
        let lastUsedAt: Int?
    }

    enum List: Equatable {
        case passkeys([Passkey])
        /// 404: passkeys are off on this Kosmos+. Nothing is shown, as on the page.
        case off
        case signedOut
        /// Anything else: the section stays, and says so.
        case failed
    }

    static func list(status: Int, json: Any?) -> List {
        if status == 404 { return .off }
        if status == 401 { return .signedOut }
        guard (200..<300).contains(status), let rows = (json as? [String: Any])?["passkeys"] as? [Any] else { return .failed }
        // A row with no id cannot be removed, so it is not listed (the page would send an empty id); the others stay.
        return .passkeys(rows.compactMap { any in
            guard let r = any as? [String: Any], let id = r["credential_id"] as? String, !id.isEmpty else { return nil }
            let name = (r["name"] as? String).flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } ?? "Passkey"
            return Passkey(credentialID: id, name: name, createdAt: seconds(r["created_at"]), lastUsedAt: seconds(r["last_used_at"]))
        })
    }

    /// The row's line, as renderPasskeys says it. `day` writes a date the way the page's passkeyWhen does (day, short
    /// month, year), and is passed in so the tests do not depend on this Mac's locale; an empty answer drops the part.
    static func passkeyLine(_ p: Passkey, day: (Int) -> String) -> String {
        let added = p.createdAt.map(day).flatMap { $0.isEmpty ? nil : "Added \($0). " } ?? ""
        let used = p.lastUsedAt.map(day).flatMap { $0.isEmpty ? nil : "Last used \($0)." } ?? "Not used yet."
        return added + used
    }

    static func removeBody(_ p: Passkey) -> [String: Any] { ["credential_id": p.credentialID] }

    /// What a refused add or remove says: the step-up words when Kosmos+ asks for a recent sign-in, else its own
    /// sentence, else the fallback.
    static func refusal(json: Any?, fallback: String) -> String {
        let body = json as? [String: Any] ?? [:]
        if body["code"] as? String == "step_up_required" { return stepUp }
        return SignIn.refusal(body["error"]) ?? fallback
    }

    // MARK: - Adding one

    /// What register/begin asks the authenticator for. Only what an iPhone passkey makes is taken (ES256, a key kept
    /// on the device, the person's face or passcode, no attestation); anything else is refused here rather than making
    /// a passkey that finish would turn away, which would sit on the phone signing in to nothing.
    struct Registration: Equatable {
        let challenge: Data
        let rpID: String
        let userID: Data
        let userName: String
        let exclude: [Data]
    }

    static func registration(status: Int, json: Any?) -> Registration? {
        guard (200..<300).contains(status), let b = json as? [String: Any] else { return nil }
        guard let challenge = (b["challenge"] as? String).flatMap(SignIn.fromBase64url), !challenge.isEmpty,
              let rp = b["rp_id"] as? String, !rp.isEmpty,
              let user = (b["user_id"] as? String).flatMap(SignIn.fromBase64url), !user.isEmpty,
              let name = b["user_name"] as? String, !name.isEmpty,
              (b["alg"] as? Int) == -7,
              (b["attestation"] as? String ?? "none") == "none" else { return nil }
        let exclude = (b["exclude"] as? [Any] ?? []).compactMap { ($0 as? String).flatMap(SignIn.fromBase64url) }
        return Registration(challenge: challenge, rpID: rp, userID: user, userName: name, exclude: exclude)
    }

    /// The finish request from what iOS hands back. nil when the attestation object holds no readable authData.
    static func finishBody(credentialID: Data, attestationObject: Data, clientDataJSON: Data, name: String) -> [String: Any]? {
        guard !credentialID.isEmpty, !clientDataJSON.isEmpty, let auth = authData(attestationObject: attestationObject) else { return nil }
        return ["credential_id": SignIn.base64url(credentialID), "authenticator_data": SignIn.base64url(auth),
                "client_data_json": SignIn.base64url(clientDataJSON), "name": name.isEmpty ? "Passkey" : name]
    }

    /// `authData` from a WebAuthn attestation object: a CBOR map of text keys ("fmt", "attStmt", "authData"). Every
    /// other value is stepped over whatever its type, so a format with a statement reads as well as "none" does. Only
    /// definite lengths (WebAuthn's CTAP2 canonical CBOR has no other); anything else is nil, never a guess.
    static func authData(attestationObject d: Data) -> Data? {
        var r = CBORReader(bytes: [UInt8](d))
        guard let (major, count) = r.head(), major == 5 else { return nil }
        var found: Data?
        for _ in 0..<count {
            guard let (km, klen) = r.head(), km == 3, let key = r.take(klen) else { return nil }
            if String(bytes: key, encoding: .utf8) == "authData" {
                guard let (vm, vlen) = r.head(), vm == 2, let v = r.take(vlen), found == nil else { return nil }
                found = Data(v)
            } else if !r.skip() { return nil }
        }
        // The whole object is one map: bytes left over mean it was not read right.
        return r.atEnd ? found : nil
    }

    struct CBORReader {
        let bytes: [UInt8]
        var at = 0
        var atEnd: Bool { at == bytes.count }

        /// A data item's major type and its argument (a length, a count or a value). nil for an indefinite length or a
        /// head cut short.
        mutating func head() -> (Int, Int)? {
            guard at < bytes.count else { return nil }
            let b = bytes[at]; at += 1
            let major = Int(b >> 5), info = Int(b & 0x1f)
            if info < 24 { return (major, info) }
            let size: Int
            switch info { case 24: size = 1; case 25: size = 2; case 26: size = 4; case 27: size = 8; default: return nil }
            guard at + size <= bytes.count else { return nil }
            var v: UInt64 = 0
            for i in 0..<size { v = v << 8 | UInt64(bytes[at + i]) }
            at += size
            guard v <= UInt64(Int32.max) else { return nil }   // no real attestation is this long; refuse rather than wrap
            return (major, Int(v))
        }

        mutating func take(_ n: Int) -> ArraySlice<UInt8>? {
            guard n >= 0, at + n <= bytes.count else { return nil }
            defer { at += n }
            return bytes[at..<(at + n)]
        }

        /// Steps over one whole item. A nesting deeper than any attestation has is refused.
        mutating func skip(depth: Int = 0) -> Bool {
            guard depth < 16, let (major, arg) = head() else { return false }
            switch major {
            case 0, 1, 7: return true                   // integers, simple values and floats carry no body past the head
            case 2, 3: return take(arg) != nil
            case 4: for _ in 0..<arg { if !skip(depth: depth + 1) { return false } }; return true
            case 5: for _ in 0..<(arg * 2) { if !skip(depth: depth + 1) { return false } }; return true
            case 6: return skip(depth: depth + 1)       // a tag, then the item it tags
            default: return false
            }
        }
    }

    // MARK: - Sign-ins from new places

    struct NewPlace: Equatable {
        let id: String
        let name: String
        let at: Int?
        let notMeAt: Int?
    }

    /// The list, newest first as Kosmos+ sends it. Anything but a readable answer is an empty list: the page shows
    /// nothing on a blip, and the email is still how the owner hears of one.
    static func newPlaces(status: Int, json: Any?) -> [NewPlace] {
        guard (200..<300).contains(status), let rows = (json as? [String: Any])?["new_places"] as? [Any] else { return [] }
        return rows.compactMap { any in
            guard let r = any as? [String: Any], let id = r["id"] as? String, !id.isEmpty else { return nil }
            let name = (r["name"] as? String).flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } ?? unnamedDevice
            return NewPlace(id: id, name: name, at: seconds(r["at"]), notMeAt: seconds(r["not_me_at"]))
        }
    }

    /// The row's line, as renderNewPlaces says it. `when` writes a date and time as the page's newPlaceWhen does.
    static func newPlaceLine(_ p: NewPlace, when: (Int) -> String) -> String {
        let at = p.at.map(when).flatMap { $0.isEmpty ? nil : $0 } ?? "at a time this iPhone could not show"
        guard let nm = p.notMeAt else { return "Signed in \(at)." }
        let on = when(nm)
        return "Signed in \(at). Not me was pressed" + (on.isEmpty ? "" : " on \(on)") + "."
    }

    /// Not me is offered only on a row it has not been pressed for.
    static func offersNotMe(_ p: NewPlace) -> Bool { p.notMeAt == nil }

    static func notMeBody(_ p: NewPlace) -> [String: Any] { ["id": p.id] }

    enum NotMe: Equatable {
        /// Kosmos+ signed the account out everywhere (or this session was already gone): this iPhone signs out too.
        case signedOutEverywhere
        case refused(String)
    }

    static func notMe(status: Int, json: Any?) -> NotMe {
        if (200..<300).contains(status) || status == 401 { return .signedOutEverywhere }
        return .refused(SignIn.refusal((json as? [String: Any])?["error"]) ?? notMeFailed)
    }

    // MARK: - Requests (built as AccountLogic builds its own: server.ios-routes-6838 reads this form)

    static func listRequest(coordinator: URL, session: String) -> URLRequest { request(listPath, coordinator: coordinator, session: session) }
    static func removeRequest(coordinator: URL, session: String, _ p: Passkey) -> URLRequest {
        request(removePath, coordinator: coordinator, session: session, body: removeBody(p))
    }
    static func beginRequest(coordinator: URL, session: String) -> URLRequest {
        request(beginPath, coordinator: coordinator, session: session, body: [:])
    }
    static func finishRequest(coordinator: URL, session: String, body: [String: Any]) -> URLRequest {
        request(finishPath, coordinator: coordinator, session: session, body: body)
    }
    static func newPlacesRequest(coordinator: URL, session: String) -> URLRequest {
        request(newPlacesPath, coordinator: coordinator, session: session)
    }
    static func notMeRequest(coordinator: URL, session: String, _ p: NewPlace) -> URLRequest {
        request(notMePath, coordinator: coordinator, session: session, body: notMeBody(p))
    }

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

    /// The name a passkey made here is listed under: the page sends its device name, and an iPhone's own name is not
    /// readable by an app since iOS 16, so the kind of device is the name.
    static let passkeyName = "iPhone"

    // MARK: -

    /// A time in seconds as Kosmos+ sends it; 0, a negative number, a fraction or a string are not a time.
    static func seconds(_ v: Any?) -> Int? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        guard d > 0, d == d.rounded(), d < 1e12 else { return nil }
        return Int(d)
    }
}
