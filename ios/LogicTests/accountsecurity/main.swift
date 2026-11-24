import Foundation

var total = 0, failures = 0
func check(_ ok: Bool, _ what: String) { total += 1; if !ok { failures += 1; print("FAIL: " + what) } }

typealias S = AccountSecurity

// MARK: passkey list
let rows: [String: Any] = ["passkeys": [
    ["credential_id": "AAA", "name": "iPhone", "created_at": 1_700_000_000, "last_used_at": 1_700_100_000, "synced": true],
    ["credential_id": "BBB", "name": "  ", "created_at": 1_700_000_000, "last_used_at": NSNull()],
    ["name": "no id"],
    ["credential_id": "", "name": "empty id"],
]]
check(S.list(status: 200, json: rows) == .passkeys([
    .init(credentialID: "AAA", name: "iPhone", createdAt: 1_700_000_000, lastUsedAt: 1_700_100_000),
    .init(credentialID: "BBB", name: "Passkey", createdAt: 1_700_000_000, lastUsedAt: nil)]), "rows with an id, a blank name read as Passkey")
check(S.list(status: 200, json: ["passkeys": []]) == .passkeys([]), "none")
check(S.list(status: 404, json: nil) == .off, "404 is off: nothing shown")
check(S.list(status: 401, json: nil) == .signedOut, "401 is signed out")
check(S.list(status: 500, json: nil) == .failed, "a failure keeps the section and says so")
check(S.list(status: 200, json: ["keys": []]) == .failed, "an answer with no list is a failure, not none")

let day: (Int) -> String = { $0 == 1_700_000_000 ? "14 Nov 2023" : $0 == 1_700_100_000 ? "16 Nov 2023" : "" }
check(S.passkeyLine(.init(credentialID: "A", name: "x", createdAt: 1_700_000_000, lastUsedAt: 1_700_100_000), day: day) == "Added 14 Nov 2023. Last used 16 Nov 2023.", "added and used")
check(S.passkeyLine(.init(credentialID: "A", name: "x", createdAt: 1_700_000_000, lastUsedAt: nil), day: day) == "Added 14 Nov 2023. Not used yet.", "never used")
check(S.passkeyLine(.init(credentialID: "A", name: "x", createdAt: nil, lastUsedAt: nil), day: day) == "Not used yet.", "no dates")
check(S.passkeyLine(.init(credentialID: "A", name: "x", createdAt: 5, lastUsedAt: nil), day: day) == "Not used yet.", "a date that cannot be written is dropped")
check(S.removeBody(.init(credentialID: "AAA", name: "x", createdAt: nil, lastUsedAt: nil))["credential_id"] as? String == "AAA", "remove sends the id")
check(S.removeAsk(name: "iPhone") == "Press it again to remove iPhone.", "the remove ask")

check(S.refusal(json: ["error": "sign in again first", "code": "step_up_required"], fallback: "x") == S.stepUp, "step-up words")
check(S.refusal(json: ["error": "no such passkey"], fallback: "x") == "No such passkey.", "Kosmos+'s own sentence")
check(S.refusal(json: nil, fallback: S.removeFailed) == S.removeFailed, "the fallback")

// MARK: requests (the account screen's calls)

do {
    let c = URL(string: "https://login.example")!
    func body(_ r: URLRequest) -> [String: Any] { (r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]) ?? [:] }
    func bearer(_ r: URLRequest) -> Bool { r.value(forHTTPHeaderField: "Authorization") == "Bearer tok" }
    let pk = S.Passkey(credentialID: "CRED", name: "iPhone", createdAt: nil, lastUsedAt: nil)
    let np = S.NewPlace(id: "NP", name: "x", at: nil, notMeAt: nil)
    let list = S.listRequest(coordinator: c, session: "tok")
    check(list.url?.absoluteString == "https://login.example/v1/passkeys" && list.httpMethod == "GET" && bearer(list) && list.httpBody == nil, "list: GET /v1/passkeys with the session")
    let rm = S.removeRequest(coordinator: c, session: "tok", pk)
    check(rm.url?.path == "/v1/passkeys/remove" && rm.httpMethod == "POST" && bearer(rm) && body(rm)["credential_id"] as? String == "CRED", "remove: POST with the id")
    let begin = S.beginRequest(coordinator: c, session: "tok")
    check(begin.url?.path == "/v1/passkeys/register/begin" && begin.httpMethod == "POST" && bearer(begin) && begin.httpBody != nil && body(begin).isEmpty, "begin: POST with an empty body, as the page sends")
    let fin = S.finishRequest(coordinator: c, session: "tok", body: ["name": "iPhone"])
    check(fin.url?.path == "/v1/passkeys/register/finish" && fin.httpMethod == "POST" && bearer(fin) && body(fin)["name"] as? String == "iPhone", "finish: POST with its body")
    let places = S.newPlacesRequest(coordinator: c, session: "tok")
    check(places.url?.path == "/v1/account/new-places" && places.httpMethod == "GET" && bearer(places), "new places: GET")
    let nm = S.notMeRequest(coordinator: c, session: "tok", np)
    check(nm.url?.path == "/v1/account/new-places/not-me" && nm.httpMethod == "POST" && bearer(nm) && body(nm)["id"] as? String == "NP", "not me: POST with the row's id")
    check([list, rm, begin, fin, places, nm].allSatisfy { !$0.httpShouldHandleCookies && $0.cachePolicy == .reloadIgnoringLocalCacheData }, "no cookies, no cache")
    // A coordinator under a path keeps it (appendingPathComponent, not relativeTo:).
    check(S.listRequest(coordinator: URL(string: "https://h.example/k/")!, session: "tok").url?.absoluteString == "https://h.example/k/v1/passkeys", "a coordinator's own path is kept")
    check(S.passkeyName == "iPhone", "a passkey made here is named for the device kind")
}

// MARK: the passkey's host (review 1: as the sign-in side and the page require)
do {
    let r = S.Registration(challenge: Data([1]), rpID: "login.example", userID: Data([2]), userName: "a", exclude: [])
    check(S.rpRefusal(r, coordinator: URL(string: "https://login.example")!) == nil, "the coordinator's own host: no refusal")
    check(S.rpRefusal(r, coordinator: URL(string: "https://LOGIN.example/k/")!) == nil, "host compared without case or path")
    check(S.rpRefusal(r, coordinator: URL(string: "https://other.example")!) == "Passkeys can be added only at login.example.", "another host: the page's own words")
    check(S.heldChallengeSeconds < 300, "a kept challenge is used again only inside its five minutes")
}

// MARK: register/begin
func b64(_ d: [UInt8]) -> String { SignIn.base64url(Data(d)) }
var begin: [String: Any] = ["challenge": b64([1, 2, 3, 4]), "rp_id": "kosmos.example", "rp_name": "Kosmos+", "user_id": b64([9, 9]),
                            "user_name": "a@b.c", "exclude": [b64([7]), b64([8])], "timeout_ms": 300000, "alg": -7,
                            "resident_key": "required", "user_verification": "required", "attestation": "none"]
check(S.registration(status: 200, json: begin) == .init(challenge: Data([1, 2, 3, 4]), rpID: "kosmos.example", userID: Data([9, 9]),
                                                     userName: "a@b.c", exclude: [Data([7]), Data([8])]), "a begin read")
for (key, bad) in [("alg", -257 as Any), ("attestation", "direct" as Any), ("challenge", "" as Any), ("rp_id", "" as Any),
                   ("user_id", "!!" as Any), ("user_name", "" as Any)] {
    var b = begin; b[key] = bad
    check(S.registration(status: 200, json: b) == nil, "a begin with \(key) = \(bad) is refused")
}
var noAlg = begin; noAlg.removeValue(forKey: "alg")
check(S.registration(status: 200, json: noAlg) == nil, "a begin with no alg is refused")
check(S.registration(status: 403, json: begin) == nil, "a refusal is not a begin")
check(S.registration(status: 200, json: begin) != nil, "CONTROL: the unchanged begin still reads")

// MARK: authData out of the attestation object
func text(_ s: String) -> [UInt8] { let u = Array(s.utf8); precondition(u.count < 24); return [0x60 | UInt8(u.count)] + u }
func bytes(_ b: [UInt8]) -> [UInt8] {
    if b.count < 24 { return [0x40 | UInt8(b.count)] + b }
    if b.count < 256 { return [0x58, UInt8(b.count)] + b }
    return [0x59, UInt8(b.count >> 8), UInt8(b.count & 0xff)] + b
}
let auth: [UInt8] = (0..<164).map { UInt8($0 & 0xff) }   // a real one with a P-256 key is about this long, so the 1-byte length is used
let none: [UInt8] = [0xa3] + text("fmt") + text("none") + text("attStmt") + [0xa0] + text("authData") + bytes(auth)
check(S.authData(attestationObject: Data(none)) == Data(auth), "fmt none")
// "packed", with a statement holding an int, bytes and an array: every value stepped over, in another key order.
let stmt: [UInt8] = [0xa3] + text("alg") + [0x26] + text("sig") + bytes([1, 2, 3]) + text("x5c") + [0x81] + bytes(Array(repeating: 5, count: 300))
let packed: [UInt8] = [0xa3] + text("authData") + bytes(auth) + text("fmt") + text("packed") + text("attStmt") + stmt
check(S.authData(attestationObject: Data(packed)) == Data(auth), "fmt packed, authData first, a nested statement stepped over")
let tagged: [UInt8] = [0xa3] + text("fmt") + text("none") + text("attStmt") + [0xc1, 0x1a, 0, 0, 0, 1] + text("authData") + bytes(auth)
check(S.authData(attestationObject: Data(tagged)) == Data(auth), "a tagged value is stepped over")
check(S.authData(attestationObject: Data(none.dropLast())) == nil, "cut short")
check(S.authData(attestationObject: Data(none + [0x00])) == nil, "bytes left over")
check(S.authData(attestationObject: Data([0xa2] + text("fmt") + text("none") + text("attStmt") + [0xa0])) == nil, "no authData")
check(S.authData(attestationObject: Data([0xa1] + text("authData") + text("notbytes"))) == nil, "authData that is not bytes")
check(S.authData(attestationObject: Data([0xa2] + text("authData") + bytes([1]) + text("authData") + bytes([2]))) == nil, "two authData")
check(S.authData(attestationObject: Data([0xbf] + text("authData") + bytes(auth) + [0xff])) == nil, "an indefinite map is refused")
check(S.authData(attestationObject: Data([0x83, 1, 2, 3])) == nil, "an array is not the object")
check(S.authData(attestationObject: Data([0xa1] + text("authData") + [0x5b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])) == nil, "a huge length is refused, not wrapped")
var deep: [UInt8] = [0xa2] + text("authData") + bytes(auth) + text("x")
deep += Array(repeating: 0x81, count: 40) + [0x00]
check(S.authData(attestationObject: Data(deep)) == nil, "a nesting deeper than any attestation is refused")
check(S.authData(attestationObject: Data()) == nil, "empty")

let fin = S.finishBody(credentialID: Data([1, 2]), attestationObject: Data(none), clientDataJSON: Data("{}".utf8), name: "iPhone")
check(fin?["credential_id"] as? String == "AQI", "credential id base64url")
check(fin?["authenticator_data"] as? String == SignIn.base64url(Data(auth)), "authenticator_data is authData, not the attestation object")
check(fin?["client_data_json"] as? String == SignIn.base64url(Data("{}".utf8)), "client data")
check(fin?["name"] as? String == "iPhone", "the name")
check(S.finishBody(credentialID: Data([1]), attestationObject: Data(none), clientDataJSON: Data("{}".utf8), name: "")?["name"] as? String == "Passkey", "an empty name is Passkey, as the page")
check(S.finishBody(credentialID: Data(), attestationObject: Data(none), clientDataJSON: Data("{}".utf8), name: "x") == nil, "no id")
check(S.finishBody(credentialID: Data([1]), attestationObject: Data([0xa0]), clientDataJSON: Data("{}".utf8), name: "x") == nil, "no authData")

// MARK: new places
let places: [String: Any] = ["new_places": [
    ["id": "p1", "at": 1_700_000_000, "name": "Pixel", "not_me_at": NSNull()],
    ["id": "p2", "at": 1_700_000_000, "name": NSNull(), "not_me_at": 1_700_100_000],
    ["at": 1_700_000_000, "name": "no id"],
]]
let got = S.newPlaces(status: 200, json: places)
check(got == [.init(id: "p1", name: "Pixel", at: 1_700_000_000, notMeAt: nil), .init(id: "p2", name: S.unnamedDevice, at: 1_700_000_000, notMeAt: 1_700_100_000)], "rows with an id, a nameless one named as the page names it")
check(S.newPlaces(status: 500, json: places).isEmpty, "a blip shows nothing")
check(S.newPlaces(status: 200, json: ["other": 1]).isEmpty, "no list shows nothing")
check(S.offersNotMe(got[0]) && !S.offersNotMe(got[1]), "Not me only where it was not pressed")
let when: (Int) -> String = { $0 == 1_700_000_000 ? "14 Nov 2023, 22:13" : $0 == 1_700_100_000 ? "16 Nov 2023, 02:00" : "" }
check(S.newPlaceLine(got[0], when: when) == "Signed in 14 Nov 2023, 22:13.", "a row")
check(S.newPlaceLine(got[1], when: when) == "Signed in 14 Nov 2023, 22:13. Not me was pressed on 16 Nov 2023, 02:00.", "a pressed row")
check(S.newPlaceLine(.init(id: "x", name: "y", at: nil, notMeAt: 9), when: when) == "Signed in at a time this iPhone could not show. Not me was pressed.", "no times")
check(S.notMeBody(got[0])["id"] as? String == "p1", "not-me sends the id")
check(S.notMe(status: 200, json: ["ok": true]) == .signedOutEverywhere, "done: signed out everywhere")
check(S.notMe(status: 401, json: nil) == .signedOutEverywhere, "401: already gone, so the same")
check(S.notMe(status: 404, json: ["error": "no such sign-in"]) == .refused("No such sign-in."), "its own sentence")
check(S.notMe(status: 500, json: nil) == .refused(S.notMeFailed), "the page's line")

// MARK: times
check(S.seconds(1_700_000_000) == 1_700_000_000, "an int")
check(S.seconds(1_700_000_000.0) == 1_700_000_000, "a whole double")
check(S.seconds(1.5) == nil && S.seconds(0) == nil && S.seconds(-4) == nil, "a fraction, zero, negative")
check(S.seconds("1700000000") == nil && S.seconds(true) == nil && S.seconds(nil) == nil, "a string, a bool, nothing")

// MARK: the page's words, when kosmos-relay is at hand (KOSMOS_RELAY, or ~/work/kosmos-relay)
let relay = ProcessInfo.processInfo.environment["KOSMOS_RELAY"] ?? (NSHomeDirectory() + "/work/kosmos-relay")
if let page = try? String(contentsOfFile: relay + "/coordinator/src/signin.html", encoding: .utf8) {
    for (n, w) in [("passkeysWords", S.passkeysWords), ("noPasskeys", S.noPasskeys), ("addButton", S.addButton), ("added", S.added),
                   ("removed", S.removed), ("stepUp", S.stepUp), ("addCancelled", S.addCancelled), ("addHave", S.addHave),
                   ("addFailed", S.addFailed), ("addNotNow", S.addNotNow), ("removeFailed", S.removeFailed),
                   ("newPlacesTitle", S.newPlacesTitle), ("newPlacesWords", S.newPlacesWords), ("notMeButton", S.notMeButton),
                   ("notMeAsk", S.notMeAsk), ("notMeFailed", S.notMeFailed), ("unnamedDevice", S.unnamedDevice),
                   ("addOnlyAt", S.addOnlyAt("login.example").replacingOccurrences(of: "login.example.", with: ""))] {
        check(page.contains(w), "\(n) is the page's own words")
    }
    check(page.contains("Your passkeys could not be listed just now. "), "listFailed starts as the page's")
} else {
    print("NOTE: kosmos-relay's signin.html not found, so the words were not compared with the page")
}

print(failures == 0 ? "VERDICT: PASS \(total)/\(total)" : "VERDICT: FAIL \(total - failures)/\(total)")
exit(failures == 0 ? 0 : 1)
