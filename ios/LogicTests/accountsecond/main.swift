import Foundation

var total = 0, failures = 0
func check(_ ok: Bool, _ what: String) { total += 1; if !ok { failures += 1; print("FAIL: " + what) } }

typealias A = AccountSecond

// GET /v1/second: what is set up, and whether texts can be sent.
check(A.statusPath == "/v1/second", "the status route")
check(A.read(status: 200, json: ["enrolled": NSNull(), "sms_available": true]) == .status(.init(enrolled: nil, smsAvailable: true)), "none set up, texts on")
check(A.read(status: 200, json: ["enrolled": "totp", "sms_available": false]) == .status(.init(enrolled: "totp", smsAvailable: false)), "an authenticator set up")
check(A.read(status: 200, json: ["enrolled": "sms"]) == .status(.init(enrolled: "sms", smsAvailable: false)), "a missing sms_available is no texts")
check(A.read(status: 200, json: ["enrolled": NSNull(), "sms_available": "yes"]) == .status(.init(enrolled: nil, smsAvailable: false)), "only a true is texts on")
// A missing or odd `enrolled` is not "none": offering a step there could replace one that is set up.
check(A.read(status: 200, json: ["sms_available": true]) == .unreadable(A.unreadableWords), "a missing enrolled is unreadable, not none")
check(A.read(status: 200, json: ["enrolled": ""]) == .unreadable(A.unreadableWords), "an empty kind is unreadable")
check(A.read(status: 200, json: ["enrolled": 3]) == .unreadable(A.unreadableWords), "a number is unreadable")
check(A.read(status: 200, json: nil) == .unreadable(A.unreadableWords), "no body is unreadable")
check(A.read(status: 401, json: ["error": "session expired"]) == .signedOut, "401 is signed out")
check(A.read(status: 403, json: ["error": "this device was refused"]) == .unreadable("This device was refused."), "a refusal says its own sentence")
check(A.read(status: 500, json: nil) == .unreadable(A.unreadableWords), "a failure with no sentence says the screen's")

// The page's words, as signin.html says them.
check(A.onWords(kind: "sms") == "From now on, signing in asks for the email code and then a code texted to your phone.", "texts")
check(A.onWords(kind: "totp") == "From now on, signing in asks for the email code and then a code from your authenticator app.", "authenticator")
check(A.onWords(kind: "webauthn") == A.onWords(kind: "totp"), "any other kind reads as the page reads it")
// Read the page itself when the repo is at hand (both repos side by side under ~/work, or KOSMOS_RELAY set): the words
// must not drift from the page they copy. Without the page this says so and checks nothing, rather than passing.
let relay = ProcessInfo.processInfo.environment["KOSMOS_RELAY"] ?? (NSHomeDirectory() + "/work/kosmos-relay")
if let page = try? String(contentsOfFile: relay + "/coordinator/src/signin.html", encoding: .utf8) {
    for (name, words) in [("onTitle", A.onTitle), ("resetWords", A.resetWords), ("lostPhoneTitle", A.lostPhoneTitle),
                          ("lostPhoneWords", A.lostPhoneWords), ("offerTitle", A.offerTitle), ("offerWords", A.offerWords),
                          ("noTextsWords", A.noTextsWords), ("codeNotSix", A.codeNotSix), ("codeRefused", A.codeRefused)] {
        check(page.contains(words), "\(name) is the page's own words")
    }
    check(page.contains("From now on, signing in asks for the email code and then a code "), "onWords starts as the page's")
    check(!page.contains("CONTROL: words no page has"), "CONTROL: the page check can fail")
} else {
    print("NOTE: kosmos-relay's signin.html not found, so the words were not compared with the page")
}

// The offer's choices: texts first when they can be sent.
check(A.choices(.init(enrolled: nil, smsAvailable: true)) == [.sms, .totp], "texts and the app")
check(A.choices(.init(enrolled: nil, smsAvailable: false)) == [.totp], "the app alone")
check(A.textsUnavailable(status: 400, json: ["error": "texts are off", "code": "sms_unavailable"]), "the text service refused")
check(!A.textsUnavailable(status: 400, json: ["error": "that number has no country code"]), "a number refusal is not it")
check(!A.textsUnavailable(status: 200, json: ["code": "sms_unavailable"]), "a success is never it")

// The code.
check(A.code("123456") == "123456", "six digits")
check(A.code(" 123 456 ") == "123456", "spaces dropped")
check(A.code("123-456") == "123456", "a dash dropped")
check(A.code("12345") == nil, "five is not six")
check(A.code("1234567") == nil, "seven is not six")
check(A.code("12345a") == nil, "a letter is not a digit")
check(A.code("١٢٣٤٥٦") == nil, "only ASCII digits, as the page's [0-9]")

// Confirm: the fresh session is the one to keep.
let fresh: [String: Any] = ["ok": true, "kind": "sms", "token": "NEW", "device_status": "acked", "addresses": []]
check(A.confirmed(status: 200, json: fresh) == .on(kind: "sms", fresh: "NEW"), "the fresh session comes back")
check(A.confirmed(status: 200, json: ["ok": true, "kind": "totp"]) == .on(kind: "totp", fresh: nil), "an older Kosmos+ with no token keeps the old")
check(A.confirmed(status: 200, json: ["ok": true]) == .on(kind: "totp", fresh: nil), "no kind reads as the authenticator, as the page")
check(A.confirmed(status: 200, json: ["ok": true, "kind": "sms", "token": ""]) == .onSignInAgain(kind: "sms"), "an empty token is not none sent")
check(A.confirmed(status: 200, json: ["ok": true, "kind": "sms", "token": 7]) == .onSignInAgain(kind: "sms"), "an unreadable token is not none sent")
check(A.confirmed(status: 400, json: ["error": "that code is not right or has expired"]) == .refused("That code is not right or has expired."), "Kosmos+'s own sentence")
check(A.confirmed(status: 400, json: nil) == .refused(A.codeRefused), "the page's line with none")
check(A.confirmed(status: 401, json: nil) == .signedOut, "401 is signed out")
check(A.signInAgainWords(kind: "sms").hasPrefix(A.onTitle + ". "), "it still says the step is on")
check(A.signInAgainWords(kind: "sms").hasSuffix("Sign in again on this iPhone to keep going."), "and what to do")

print(failures == 0 ? "VERDICT: PASS \(total)/\(total)" : "VERDICT: FAIL \(total - failures)/\(total)")
exit(failures == 0 ? 0 : 1)
