import Foundation
// Tests for the native Kosmos+ account screen's logic (kosmos#8959 slice B1a), compiled for macOS with AccountLogic.swift
// alone (run-account.sh). It prints every case and ends with one verdict line; a missing verdict means it did not finish.
// The expected words are the web account page's own (kosmos-relay coordinator/src/signin.html macWhen, askRetire,
// signout-all-yes), copied here: that page lives in the other repo, so this suite cannot read it.
setvbuf(stdout, nil, _IOLBF, 0)
var passed = 0
var failed = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: Int = #line) {
    if cond() { passed += 1; print("  ok   \(name)") } else { failed += 1; print("  FAIL \(name) (line \(line))") }
}
func section(_ name: String) { print(name) }
func json(_ s: String) -> Data { Data(s.utf8) }
let coordinator = URL(string: "https://login.kosmosplus.com")!
let now: Double = 1_800_000_000
typealias C = Account.Computer

section("the list: every row kept, as Kosmos+ sends it")
let rows = Account.parseComputers(json(#"""
{"macs":[
 {"name":"studio","address":"studio.kosmosplus.com","last_seen":1799999990,"retired_at":null,"remote_off":false,"not_connected":false,"held":false,"refused":false,"updating_until":null},
 {"name":"old","address":"old.kosmosplus.com","last_seen":1700000000,"retired_at":1750000000},
 {"name":"old","address":"old.kosmosplus.com","last_seen":0},
 {"name":"waiting","held":true,"last_seen":1799990000},
 {"name":"","address":"x.kosmosplus.com"},
 {"name":"upd","last_seen":1799999000,"updating_until":1800000100}
]}
"""#))
check(rows?.count == 5, "a row with no name is dropped (Retire needs the name); the other five are kept")
check(rows?[0] == C(name: "studio", lastSeen: 1799999990, position: 0), "a plain computer: name, last heard from, nothing else set")
check(rows?[1].retired == true && rows?[2].retired == false, "retired_at is read as retired, null or missing as not")
check(rows?[2].lastSeen == nil, "last_seen 0 is never heard from, not 1970")
check(rows?[3].held == true && rows?[4].updating == true, "held and updating_until are read")
check(Set(rows?.map(\.id) ?? []).count == 5 && rows?[1].name == rows?[2].name, "two rows with one name (retired, then set up again) are two rows")
let zeros = Account.parseComputers(json(#"{"macs":[{"name":"z","last_seen":1799999990,"retired_at":0,"updating_until":0}]}"#))
check(zeros?.first?.retired == false && zeros?.first?.updating == false, "a time of 0 is unset, as the page tests it")
check(Account.parseComputers(json(#"{"error":"x"}"#)) == nil && Account.parseComputers(nil) == nil, "an answer with no list is not an empty list")
check(Account.parseComputers(json(#"{"macs":[]}"#)) == [], "an empty list is no computers")

section("the words: the web page's macWhen, word for word")
func w(_ c: C, allow: Int = 1) -> String { Account.words(c, now: now, canAllow: allow) }
check(w(C(name: "a", lastSeen: now - 30)) == "Answering now", "heard from under two minutes ago: Answering now")
check(w(C(name: "a", lastSeen: now - 30 * 60)) == "Answered 30 minutes ago", "minutes")
check(w(C(name: "a", lastSeen: now - 60)) == "Answering now" && w(C(name: "a", lastSeen: now - 119)) == "Answering now" && w(C(name: "a", lastSeen: now - 120)) == "Answered 2 minutes ago", "the two-minute edge")
check(w(C(name: "a", lastSeen: now - 5 * 3600)) == "Answered 5 hours ago", "hours")
check(w(C(name: "a", lastSeen: now - 3600)) == "Answered 1 hour ago", "one hour, not one hours")
check(w(C(name: "a", lastSeen: now - 3 * 86400)) == "Answered 3 days ago", "days, under the fortnight")
check(w(C(name: "a", lastSeen: now - 20 * 86400)) == "Has not answered in 20 days. It may be off, or gone.", "silent a fortnight or more")
check(w(C(name: "a")) == "Has not answered yet.", "never heard from")
check(w(C(name: "a", lastSeen: now, retired: true)) == "Retired. Its address is free again.", "retired comes first")
check(w(C(name: "a", lastSeen: now - 30, updating: true)) == "Applying an update, back in a moment.", "an update is not silence")
check(w(C(name: "a", lastSeen: now - 600, remoteOff: true)) == "Remote access off, last heard from 10 minutes ago", "remote access off is never Answering now")
check(w(C(name: "a", lastSeen: now - 30, notConnected: true)) == "Remote access on, but not connected, last heard from just now", "not connected")
check(w(C(name: "a", lastSeen: now - 600, refused: true)) == "Not allowed on your account. Retire it, and set it up again if it is yours. Last heard from 10 minutes ago.", "refused")
check(w(C(name: "a", held: true), allow: 2) == "Waiting for approval on one of your other computers. If you did not set it up, do not allow it there. It has not answered yet.", "waiting, two others can allow")
check(w(C(name: "a", lastSeen: now - 30, held: true), allow: 1) == "Waiting for approval on your other computer. If you did not set it up, do not allow it there. Last heard from just now.", "waiting, one other")
check(w(C(name: "a", held: true), allow: 0) == "Waiting to be allowed, but no other computer on your account is left to allow it. Retire it and set it up again. It has not answered yet.", "waiting, nobody left to allow it")
check(Account.canAllow([C(name: "a"), C(name: "b", retired: true), C(name: "c", held: true), C(name: "d", refused: true)]) == 1, "only a computer neither retired, waiting nor refused can allow")
check(Account.stale(C(name: "a"), now: now) && Account.stale(C(name: "a", lastSeen: now - 15 * 86400), now: now), "never heard from, or silent a fortnight: dimmer")
check(!Account.stale(C(name: "a", lastSeen: now - 15 * 86400, retired: true), now: now) && !Account.stale(C(name: "a", held: true), now: now), "retired and waiting have their own look")

section("the requests")
let retire = Account.retireRequest(coordinator: coordinator, session: "s1", name: "studio")
let body = (try? JSONSerialization.jsonObject(with: retire.httpBody ?? Data())) as? [String: Any]
check(retire.httpMethod == "POST" && retire.url?.absoluteString == "https://login.kosmosplus.com/v1/account/macs/remove", "retire is POST /v1/account/macs/remove")
check(body?["name"] as? String == "studio" && body?["confirm"] == nil, "the first ask carries the name and no code")
let retire2 = Account.retireRequest(coordinator: coordinator, session: "s1", name: "studio", confirm: "K7QX")
check(((try? JSONSerialization.jsonObject(with: retire2.httpBody ?? Data())) as? [String: Any])?["confirm"] as? String == "K7QX", "the second carries the typed code")
check(retire.value(forHTTPHeaderField: "Authorization") == "Bearer s1" && !retire.httpShouldHandleCookies, "the session goes as the Bearer, with no cookie jar")
let forget = Account.forgetRequest(coordinator: coordinator, session: "s1")
check(forget.url?.path == "/v1/session/forget" && forget.value(forHTTPHeaderField: "x-kosmos-web") == "1" && forget.value(forHTTPHeaderField: "Authorization") == "Bearer s1", "sign out is /v1/session/forget with the header the route requires")
check(Account.signOutEverywhereRequest(coordinator: coordinator, session: "s1").url?.path == "/v1/account/sign-out-everywhere", "sign out everywhere")
check(Account.signOutEverywhereRequest(coordinator: coordinator, session: "s1").value(forHTTPHeaderField: "x-kosmos-web") == nil, "only forget carries the page header")

section("retire: the code comes from Kosmos+, never from the app")
let ask = json(#"{"confirm":"K7QX","name":"studio","message":"type K7QX to retire studio; it will stop answering and its name is free again after a day"}"#)
check(Account.retireAnswer(status: 409, data: ask, name: "studio", typed: nil) == .confirm(code: "K7QX", words: "Type K7QX to retire studio; it will stop answering and its name is free again after a day."), "409 with a code: Kosmos+'s own sentence, capitalised")
check(Account.retireAnswer(status: 409, data: json(#"{"confirm":"K7QX"}"#), name: "studio", typed: nil) == .confirm(code: "K7QX", words: "Type K7QX to retire studio."), "no sentence: the page's own fallback")
check(Account.retireAnswer(status: 409, data: ask, name: "studio", typed: "ABCD") == .refused("That is not the code shown for studio. Nothing was retired."), "a wrong code is said, not shown again as if nothing happened")
check(Account.retireAnswer(status: 200, data: json(#"{"ok":true,"name":"studio"}"#), name: "studio", typed: "K7QX") == .retired, "200 ok: retired")
check(Account.retireAnswer(status: 200, data: json(#"{}"#), name: "studio", typed: "K7QX") == .refused(Account.tryAgain), "200 without ok is not taken as retired")
check(Account.retireAnswer(status: 403, data: json(#"{"error":"that computer has been heard from in the last day; allow this device on one of your computers first, or retire it once it has been silent for a day","code":"recently_online"}"#), name: "studio", typed: nil)
      == .refused("That computer has been heard from in the last day; allow this device on one of your computers first, or retire it once it has been silent for a day."), "a refusal shows Kosmos+'s reason")
check(Account.retireAnswer(status: nil, data: nil, name: "studio", typed: nil) == .refused(Account.reach), "no answer: could not reach")
check(Account.typedCode("  k7qx \n") == "K7QX", "typed: trimmed and upper case, as the page reads it")

section("sign out: this iPhone signs out only once Kosmos+ has ended it, or the person chooses")
check(Account.forgetAnswer(status: 200) == .signOutHere && Account.forgetAnswer(status: 401) == .signOutHere, "200, or 401 (nothing left to end): sign out here")
check(Account.forgetAnswer(status: 500) == .stay(Account.forgetFailed) && Account.forgetAnswer(status: nil) == .stay(Account.forgetFailed) && Account.forgetAnswer(status: 403) == .stay(Account.forgetFailed), "anything else stays signed in and says so")
check(Account.everywhereAnswer(status: 200, data: nil) == .signOutHere && Account.everywhereAnswer(status: 401, data: nil) == .signOutHere, "everywhere: 200 or 401 signs out here (the page's rule)")
check(Account.everywhereAnswer(status: 503, data: json(#"{"error":"try again shortly"}"#)) == .stay("Try again shortly."), "everywhere: a refusal keeps the sign-in and gives the reason")
check(Account.everywhereAnswer(status: nil, data: nil) == .stay(Account.reach), "everywhere: no answer")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
