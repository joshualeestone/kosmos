import Foundation
// Tests for the native Updates screen's logic (kosmos#8959 slice D1c1), compiled for macOS with the app files
// run-updates.sh lists. It prints every case and ends with one verdict line; a missing verdict means the run did not
// finish.
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
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? FileManager.default.currentDirectoryPath)
func repoText(_ path: String) -> String { (try? String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)) ?? "" }
func json(_ s: String) -> Data { Data(s.utf8) }
let mac = Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "c00kie")
let U = Updates.self
let W = Updates.Words.self

section("the requests: the board's routes on the kept computer, signed as the board's own")
let st = U.statusRequest(mac), ck = U.checkRequest(mac), ins = U.installRequest(mac), au = U.autoRequest(mac), aus = U.autoSaveRequest(mac, on: false)
for r in [st, ck, ins, au, aus] {
    check(r.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && r.httpShouldHandleCookies == false
          && r.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin", "\(r.httpMethod ?? "?") \(r.url?.path ?? "?"): the kept cookie by hand and the board's header")
}
check(st.httpMethod == "GET" && st.url?.absoluteString == "https://studio.kosmosplus.com/api/status", "the state is GET /api/status")
check(ck.httpMethod == "POST" && ck.url?.path == "/api/update/check" && ck.timeoutInterval == 10, "a check POSTs /api/update/check and gives up after 10 s, as the page")
check(ins.httpMethod == "POST" && ins.url?.path == "/api/update", "Update POSTs /api/update")
check(au.httpMethod == "GET" && au.url?.path == "/api/autoupdate", "the switch reads GET /api/autoupdate")
let ausBody = aus.httpBody.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
check(aus.httpMethod == "PUT" && aus.url?.path == "/api/autoupdate" && ausBody?["on"] as? Bool == false && ausBody?.count == 1, "the switch PUTs { on }")

section("the state, from /api/status's fields")
let full = U.state(status: 200, data: json(#"{"version":"0.8.21","update":{"version":"0.8.22"},"updateLook":{"looked":true,"reached":true,"readable":true},"updateManual":null,"updateChannel":"staging","platform":"linux","cloudMachine":true,"bootedAt":"B1","updateLog":"/k/update.log","updateAttempt":{"startedAt":"S1","endedAt":"E1","code":3,"log":"/k/a.log","refused":{"why":"locked","at":"/k/app","paths":["/k/app","/k/it's"]}}}"#))
check(full?.version == "0.8.21" && full?.offer == "0.8.22" && full?.channel == "staging" && full?.platform == "linux" && full?.cloud == true, "version, offer, channel, platform, cloud")
check(full?.look == U.Look(looked: true, reached: true, readable: true) && full?.bootedAt == "B1" && full?.log == "/k/update.log", "the look, the boot, the installer's log")
check(full?.attempt == U.Attempt(startedAt: "S1", endedAt: "E1", code: 3, log: "/k/a.log", refusedWhy: "locked", refusedAt: "/k/app", refusedPaths: ["/k/app", "/k/it's"]), "the last attempt and its refusal")
check(U.state(status: 500, data: json("{}")) == nil && U.state(status: 200, data: json("<html>")) == nil, "no state from a refusal or a page that is not JSON")
let bare = U.state(status: 200, data: json(#"{"version":"0.8.21"}"#))!
check(bare.offer == nil && bare.look == nil && bare.platform == nil && bare.cloud == false && bare.attempt == nil, "an older board's status (no update fields) reads as nothing known")
let manualCmd = U.state(status: 200, data: json(#"{"version":"0.8.21","updateManual":{"version":"0.8.22","command":"curl x | bash"}}"#))!
check(manualCmd.manualVersion == "0.8.22" && manualCmd.manualCommand == "curl x | bash" && manualCmd.manualDownload == nil, "the manual offer (Linux's command)")

section("a check's answer, as the page paints it")
let after = U.checked(bare, status: 200, data: json(#"{"running":"0.8.21","offer":null,"reached":true,"readable":true,"manual":null,"channel":"prod"}"#))
check(after?.look == U.Look(looked: true, reached: true, readable: true) && after?.offer == nil && after?.channel == "prod", "the look has looked; the channel is the answer's")
check(U.checked(bare, status: 403, data: json("{}")) == nil, "no answer, no state")
let stepSaid = "From a remote session this needs a sign-in with your second step. Do this at the computer itself."
check(U.checkFailed(status: 403, data: json(#"{"code":"remote_step_up","error":"\#(stepSaid)"}"#), version: "0.8.21") == stepSaid, "the step-up's own sentence, as is")
check(U.checkFailed(status: 403, data: json(#"{"code":"remote_step_up_clock","error":"Clock."}"#), version: nil) == "Clock.", "any remote_step_up code")
check(U.checkFailed(status: 403, data: json(#"{"code":"other","error":"Nope."}"#), version: "0.8.21") == "Kosmos 0.8.21. Could not check just now.", "another refusal: the page's own sentence, not the refusal's")
check(U.checkFailed(status: 0, data: nil, version: nil) == "Kosmos. Could not check just now.", "no answer and no version")

section("the card's arms, in paintUpdateCard's order")
func st(_ j: String) -> Updates.State { U.state(status: 200, data: json(j))! }
let offer = U.card(st(#"{"version":"0.8.21","update":{"version":"0.8.22"},"updateManual":{"version":"0.8.23","command":"x"}}"#), asked: false)
check(offer == U.Card(line: "Version 0.8.22 is ready.", button: "Update", act: .update, disabled: false), "an offer wins: its version is ready, with Update")
check(U.card(manualCmd, asked: false) == U.Card(line: "Version 0.8.22 is ready. " + W.commandRemote, button: nil, act: .none, disabled: false), "Linux's command: the page's remote sentence, no button")
let dl = U.card(st(#"{"updateManual":{"version":"0.8.22","download":"https://x/k.zip"}}"#), asked: true)
check(dl.line == "Version 0.8.22 is ready. " + W.downloadRemote && dl.button == nil, "Windows' download: done at the computer, no button")
check(U.card(st(#"{"updateLook":{"looked":false}}"#), asked: true) == U.Card(line: "Checking.", button: "Check for Update", act: .check, disabled: true), "a look under way: Checking., the button disabled")
let fine = #"{"updateLook":{"looked":true,"reached":true,"readable":true},"updateChannel":"#
check(U.card(st(fine + #""prod"}"#), asked: false).line == "" && U.card(st(fine + #""prod"}"#), asked: false).button == "Check for Update", "up to date and not asked: no sentence, just Check for Update")
check(U.card(st(fine + #""prod"}"#), asked: true).line == "Up to date on the release channel.", "asked, on release")
check(U.card(st(fine + #""staging"}"#), asked: true).line == "Up to date on the staging channel.", "asked, on staging")
check(U.card(st(fine + #"null}"#), asked: true).line == "Up to date.", "asked, channel unknown: the bare sentence")
check(U.card(st(#"{"updateLook":{"looked":true,"reached":true,"readable":false}}"#), asked: false) == U.Card(line: W.unreadable, button: "Try again", act: .check, disabled: false), "an unreadable answer")
check(U.card(st(#"{"updateLook":{"looked":true,"reached":false}}"#), asked: false) == U.Card(line: W.unreachable, button: "Try again", act: .check, disabled: false), "unreachable")
check(U.card(bare, asked: false) == U.Card(line: "Checking.", button: "Check for Update", act: .check, disabled: true), "nothing known: the page's last arm")

section("where the switch shows, and its words")
check(U.autoShown(st(#"{"platform":"darwin"}"#)) && !U.autoShown(st(#"{"platform":"win32"}"#)), "a Mac shows it, Windows does not (data-win-hide)")
check(!U.autoShown(st(#"{"platform":"linux"}"#)) && U.autoShown(st(#"{"platform":"linux","cloudMachine":true}"#)), "Linux only on a cloud computer (data-linux-hide-unless-cloud)")
check(U.autoShown(bare), "an older board that does not say its platform: shown, as on a Mac (the PUT refuses anywhere it does not apply)")
check(U.autoHint(st(#"{"cloudMachine":true}"#)) == W.autoHintCloud && U.autoHint(bare) == W.autoHint, "the cloud computer's hint, as data-cloud-copy")
check(U.auto(status: 200, data: json(#"{"on":true}"#), cloud: false) == .on && U.auto(status: 200, data: json(#"{"on":false}"#), cloud: false) == .off, "on and off")
check(U.auto(status: 200, data: json(#"{"ok":false,"on":false}"#), cloud: false) == .unreadOff(W.autoUnreadOff), "a saved setting it could not read counts as off")
check(U.auto(status: 200, data: json(#"{"ok":false}"#), cloud: true) == .unreadOff(W.autoUnreadOffCloud), "the cloud computer's sentence")
check(U.auto(status: 500, data: json("{}"), cloud: false) == .noAnswer(W.autoUnread) && U.auto(status: 0, data: nil, cloud: false) == .noAnswer(W.autoUnread),
      "no answer is its own case (no switch, never a false Off), not an unread Off")
check(!Updates.Auto.noAnswer("x").isOn && !Updates.Auto.unreadOff("x").isOn && Updates.Auto.on.isOn && Updates.Auto.off.said == nil && Updates.Auto.noAnswer("x").said == "x", "isOn and said")
check(page.contains("paintSwitch('auto-toggle', unread ? null : r.on === true);"), "the page shows no switch (null) when unread, a real Off otherwise")
check(U.autoRefused(status: 403, data: json(#"{"error":"\#(stepSaid)"}"#)) == stepSaid && U.autoRefused(status: 400, data: json("x")) == W.autoSaveFailed, "a refused save: the computer's sentence, else the page's")

section("installing")
check(U.started(status: 200, data: json(#"{"ok":true,"startedAt":"S9"}"#), version: "0.8.22") == .started(myStart: "S9"), "started, with the attempt's start")
check(U.started(status: 202, data: json("{}"), version: nil) == .started(myStart: nil), "started with no start time")
check(U.started(status: 409, data: json(#"{"error":"there is no update to install"}"#), version: "0.8.22") == .refused("Kosmos is already on 0.8.22."), "nothing to install: it already has it")
check(U.started(status: 403, data: json(#"{"code":"remote_step_up","error":"\#(stepSaid)"}"#), version: nil) == .refused(stepSaid), "the step-up refusal, as is")
check(U.started(status: 500, data: json("{}"), version: nil) == .refused("Kosmos could not start the update (it answered 500 with no reason). Try again in a minute."), "no reason: the page's sentence")
check(U.started(status: 0, data: nil, version: "0.8.21") == .unanswered, "no answer at all is not a refusal (#7207): the screen waits")

section("an unanswered press, as unansweredPressVerdict")
func un(_ e: TimeInterval, reached: Bool = true, now: String? = "0.8.21", boot: String? = "B1") -> Updates.Unanswered {
    U.unanswered(elapsed: e, reached: reached, before: "0.8.21", now: now, bootBefore: "B1", bootNow: boot)
}
check(un(4, now: "0.8.22") == .done && un(4, boot: "B2") == .restarted && un(4) == .answering, "done, restarted, answering")
check(un(4, reached: false, now: nil, boot: nil) == .waiting && un(180, reached: false, now: nil, boot: nil) == .deadline && un(180) == .answering, "no answer waits up to three minutes; an answer is never the deadline")
check(U.unanswered(elapsed: 4, reached: true, before: "0.8.21", now: "0.8.21", bootBefore: nil, bootNow: "B2") == .answering, "no boot seen before the press: answering, not restarted")
check(U.unansweredSays(.restarted, now: "0.8.21") == "Kosmos restarted and is still on 0.8.21. Press Update to update it now.", "restarted, the page's words")
check(U.unansweredSays(.answering, now: nil) == "Kosmos is answering again. Press Update to try again. If the update already started, this joins it.", "answering, the page's words")
check(U.unansweredSays(.done, now: nil) == nil && U.unansweredSays(.waiting, now: nil) == nil, "done and waiting say nothing here")
check(page.contains("'Kosmos is not answering right now. It may be restarting'") && page.contains("(rollingBack ? '' : ', perhaps to install the update') + '. This page will wait for it to answer.'"), "the waiting sentence is the page's, its page said as this screen")
check(page.contains("? 'Kosmos restarted and is still on ' + (now || 'the same version') + '. Press ' + label + ' to ' + did + (rollingBack ? '' : ' it') + ' now.'")
      && page.contains(": 'Kosmos is answering again. Press ' + label + ' to try again. If the ' + did + ' already started, this joins it.';")
      && page.contains("'Kosmos has not answered for three minutes. Reload this page to see where it is.'"), "the three settle sentences are the page's")

section("the wait, as updateVerdict")
func v(_ e: TimeInterval, reached: Bool = true, now: String? = "0.8.21", attempt: Updates.Attempt? = nil, boot: String? = "B1") -> Updates.Verdict {
    U.verdict(elapsed: e, reached: reached, before: "0.8.21", now: now, attempt: attempt, myStart: "S1", bootBefore: "B1", bootNow: boot)
}
let failedAttempt = U.Attempt(startedAt: "S1", endedAt: "E", code: 2, log: nil, refusedWhy: nil, refusedAt: nil, refusedPaths: [])
check(v(5) == .waiting && v(5, now: "0.8.22") == .done && v(5, reached: false, now: nil, boot: nil) == .waiting, "waiting; a new version is done; no answer is not evidence")
check(v(5, attempt: failedAttempt) == .failed, "the installer said it stopped: failed")
var other = failedAttempt; other.startedAt = "S0"
check(v(5, attempt: other) == .waiting, "another attempt's failure is not this one's")
var ok0 = failedAttempt; ok0.code = 0
check(v(5, attempt: ok0) == .waiting, "an attempt that ended with code 0 is not a failure")
check(v(5, boot: "B2") == .didNotTake, "a new boot on the same version: it did not take")
check(v(89) == .waiting && v(90) == .slow && v(100, boot: "B2") == .didNotTake && v(100, reached: false, now: nil, boot: nil) == .waiting, "slow at 90 s, only while the same boot answers")
check(v(179) == .slow && v(180) == .deadline && v(180, reached: false, now: nil, boot: nil) == .deadline, "three minutes is the deadline")
let page = repoText("web/index.html")
check(page.contains("if (v.elapsedMs >= 3 * 60 * 1000) return 'deadline';") && page.contains("if (v.elapsedMs >= 90 * 1000 && v.reached && !rebooted) return 'slow';"), "the page's limits are still 3 min and 90 s")

section("the settle sentences, as updateSettleText")
check(U.settle(.failed, now: "0.8.21", attempt: failedAttempt, log: "/k/u.log", windows: false)
      == U.Settle(lead: "The update did not take.", rest: "The installer stopped (code 2). Kosmos is still on 0.8.21. The installer's notes are at /k/u.log."), "the Mac's failure: the installer's code, the version, its notes")
check(U.settle(.failed, now: nil, attempt: nil, log: nil, windows: false).rest == "The installer could not be started.", "no code: could not be started")
check(U.settle(.didNotTake, now: "0.8.21", attempt: nil, log: nil, windows: false).rest == "Kosmos is still on 0.8.21." && U.settle(.didNotTake, now: nil, attempt: nil, log: nil, windows: false).rest == "", "did not take, with or without the version")
check(U.settle(.failed, now: "0.8.21", attempt: failedAttempt, log: nil, windows: true).rest == "Kosmos is still on 0.8.21. Nothing else was changed.", "Windows: one honest sentence")
check(U.settle(.deadline, now: "0.8.21", attempt: nil, log: nil, windows: false) == U.Settle(lead: "This is taking longer than expected.", rest: "Kosmos is still on 0.8.21. " + W.slowMac), "the deadline on a Mac")
check(U.settle(.deadline, now: nil, attempt: nil, log: nil, windows: true).rest == W.slowWindows, "on Windows")
let locked = full!.attempt!
let lockedRest = U.settle(.failed, now: nil, attempt: locked, log: nil, windows: false).rest
check(lockedRest.contains(" Part of it is locked: /k/app. Nothing was removed.") && lockedRest.contains("chflags -R nouchg,nouappnd '/k/app' '/k/it'\\''s'"), "a locked install: the line that unlocks it, each path quoted")
var perm = locked; perm.refusedWhy = "permissions"
check(U.refused(perm) == " This account may not change /k/app. Nothing was removed. Give that folder back to this account, then update again.", "permissions")
var imm = locked; imm.refusedWhy = "immutable"; imm.refusedPaths = []
check(U.refused(imm).hasSuffix("sudo chattr -R -i -a '/k/app'"), "immutable, the one path when no list")
var odd = locked; odd.refusedWhy = "other"
check(U.refused(odd) == "" && U.refused(nil) == "", "anything else says nothing more")

section("the words are the board page's own")
let unescaped = page.replacingOccurrences(of: "\\'", with: "'")
for w in [W.staging, W.check, W.update, W.tryAgain, W.checking, W.unreadable, W.unreachable, W.upToDate, W.upToDateStaging, W.upToDateRelease,
          W.commandRemote, W.confirmTitle, W.confirmNo, W.updating, W.stillUpdating, W.didNotTake, W.slowLead, W.nothingChanged, W.slowMac,
          W.slowWindows, W.autoLabel, W.autoHint, W.autoHintCloud, W.autoUnread, W.autoUnreadOff, W.autoUnreadOffCloud, W.autoSaveFailed] {
    check(unescaped.contains(w), "on the page: \(w.prefix(56))")
}
let strip = { (s: String) in s.replacingOccurrences(of: "<b>", with: "").replacingOccurrences(of: "</b>", with: "").replacingOccurrences(of: "\n", with: " ") }
let squash = { (s: String) in s.split(whereSeparator: { $0 == " " }).joined(separator: " ") }
check(squash(strip(page)).contains(W.confirmMac), "the Mac's confirm body, its bold taken out")
check(page.contains("updateConfirmBody: '" + "Kosmos downloads the update, then closes for a few seconds while it swaps it in. <b>Your agents keep working the whole time.</b>'"), "Windows' confirm body")
check(page.contains("'Kosmos could not start the ' + did + ' (it answered ' + res.status + ' with no reason). Try again in a minute.'"), "the no-reason sentence")
check(page.contains("'Kosmos is already on ' + (SERVED_VERSION || 'the latest version') + '. Reload to see it.'"), "the already sentence (the phone has no Reload)")
check(page.contains("? 'To update, open Settings, Updates on your Kosmos computer and run the command it shows there.'"), "the remote command sentence")
check(page.contains("'Could not check just now.'"), "the check's failure")
check(page.contains("<button class=\"btn uprime\" type=\"button\" id=\"uc-go\">Update</button>"), "the confirm's Update")

section("the board: what the phone reads and what it may write")
let server = repoText("server.js")
check(server.contains("platform: process.platform, cloudMachine: cloudMachine.isCloudMachine(),"), "/api/status says the platform and whether it is a cloud computer")
let stepUp = server.range(of: "const REMOTE_STEP_UP_EXACT = new Set([").flatMap { s in
    server.range(of: "]);", range: s.upperBound..<server.endIndex).map { String(server[s.upperBound..<$0.lowerBound]) } } ?? ""
for w in ["'POST /api/update'", "'POST /api/update/check'", "'PUT /api/autoupdate'"] {
    check(stepUp.contains(w), "\(w) needs the remote step-up, so a refusal is expected and shown as is")
}
check(!stepUp.contains("/api/status") && !stepUp.contains("'GET /api/autoupdate'"), "the reads do not (control: the list was found)")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
