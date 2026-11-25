import Foundation

// kosmos#8959 slice D1c1: the computer's Updates, native on the phone. UIKit-free, so ios/LogicTests/run-updates.sh runs
// it on a Mac.
//
// It says what the board's Settings > Updates card says (web/index.html s-sec-updates: paintUpdateCard, the install
// confirm, updateVerdict and updateSettleText, autoPaint), in its words, from the same routes: GET /api/status (the
// version, the offer, the last look, the manual offer, the channel, the last attempt, the boot, and since this slice
// the platform and whether it is a cloud computer, which the page reads from its own <meta> tags), POST
// /api/update/check, POST /api/update, GET and PUT /api/autoupdate.
// Measured on the card: every write here is in server.js's REMOTE_STEP_UP_EXACT, so from a phone the computer may refuse
// it with 403 remote_step_up and its own sentence, which is shown as it is.
// Not here, on purpose: Roll back (Windows only, its own confirm; noted for D2), the "this page is older" arm (the
// phone is not a page the board serves), and the Linux command and Windows download, which are done at the computer.
enum Updates {

    // MARK: The board's words

    enum Words {
        static let title = "Updates"
        static let staging = "Staging channel"
        static let check = "Check for Update"
        static let update = "Update"
        static let tryAgain = "Try again"
        static let checking = "Checking."
        static let unreadable = "Could not read the update server's answer."
        static let unreachable = "Could not reach the update server."
        static let upToDate = "Up to date."
        static let upToDateStaging = "Up to date on the staging channel."
        static let upToDateRelease = "Up to date on the release channel."
        // The page's own sentence for a viewer away from the computer (offlineRemoteView) in the command arm.
        static let commandRemote = "To update, open Settings, Updates on your Kosmos computer and run the command it shows there."
        // The phone's: the Windows offer is a zip the person unpacks over the Kosmos folder, which only the computer can do.
        static let downloadRemote = "To update, open Settings, Updates on your Kosmos computer and follow the steps it shows there."
        // The install confirm (#updconfirm), the Mac's and Windows' bodies (updateConfirmBody).
        static let confirmTitle = "Update Kosmos?"
        static let confirmMac = "Kosmos closes for a few seconds while it updates. Your agents keep working the whole time."
        static let confirmWindows = "Kosmos downloads the update, then closes for a few seconds while it swaps it in. Your agents keep working the whole time."
        static let confirmNo = "Not now"
        static let confirmGo = "Update"
        // While it installs: the overlay's lead, and its relabel once the wait is slow.
        static let updating = "Updating."
        static let stillUpdating = "Still updating."
        // The phone's own: the page reloads into the new version, which the phone cannot do, so it says what happened.
        static func done(_ v: String) -> String { "Kosmos is now on " + v + "." }
        static func noReason(_ status: Int) -> String { "Kosmos could not start the update (it answered \(status) with no reason). Try again in a minute." }
        static func already(_ v: String?) -> String { "Kosmos is already on " + (v ?? "the latest version") + "." }
        // updateSettleText.
        static let didNotTake = "The update did not take."
        static let slowLead = "This is taking longer than expected."
        static let nothingChanged = "Nothing else was changed."
        static let slowMac = "If Kosmos does not come back on its own, open it again from Applications."
        static let slowWindows = "If Kosmos does not come back on its own, open it from the Start menu."
        // The automatic-updates switch (#auto-row, autoPaint, autoToggleClick).
        static let autoLabel = "Update Kosmos automatically"
        static let autoHint = "On by default. New versions install themselves, which takes a few seconds and reloads this board. Agents keep running throughout."
        static let autoHintCloud = "On by default. Once a night, while no agent is working, the newest version installs itself and this board reloads. Turn this off and it stops updating itself."
        static let autoUnread = "We could not read this setting just now."
        static let autoUnreadOff = "We could not read this setting, so updates will wait for you to press Install."
        static let autoUnreadOffCloud = "We could not read this setting, so it counts as off and nothing updates itself."
        static let autoSaveFailed = "We could not save that setting."
        static let listFailed = "We could not reach Kosmos to see its updates."
    }

    // MARK: What the computer says

    struct Look: Equatable {
        var looked: Bool?
        var reached: Bool?
        var readable: Bool?
    }
    struct Attempt: Equatable {
        var startedAt: String?
        var endedAt: String?
        var code: Int?
        var log: String?
        var refusedWhy: String?
        var refusedAt: String?
        var refusedPaths: [String]
    }
    struct State: Equatable {
        var version: String?
        var offer: String?            // update.version: an install this computer can do itself
        var look: Look?
        var manualVersion: String?
        var manualCommand: String?
        var manualDownload: String?
        var channel: String?
        var platform: String?
        var cloud: Bool
        var bootedAt: String?
        var attempt: Attempt?
        var log: String?
    }

    private static func object(_ data: Data?) -> [String: Any]? {
        guard let data, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return o
    }
    private static func text(_ v: Any?) -> String? { (v as? String).flatMap { $0.isEmpty ? nil : $0 } }
    private static func look(_ v: Any?) -> Look? {
        guard let o = v as? [String: Any] else { return nil }
        return Look(looked: o["looked"] as? Bool, reached: o["reached"] as? Bool, readable: o["readable"] as? Bool)
    }
    private static func attempt(_ v: Any?) -> Attempt? {
        guard let o = v as? [String: Any] else { return nil }
        let r = o["refused"] as? [String: Any]
        return Attempt(startedAt: text(o["startedAt"]), endedAt: text(o["endedAt"]), code: (o["code"] as? NSNumber)?.intValue,
                       log: text(o["log"]), refusedWhy: text(r?["why"]), refusedAt: text(r?["at"]),
                       refusedPaths: (r?["paths"] as? [Any])?.compactMap { text($0) } ?? [])
    }
    private static func manual(_ s: inout State, _ v: Any?) {
        let m = v as? [String: Any]
        s.manualVersion = text(m?["version"]); s.manualCommand = text(m?["command"]); s.manualDownload = text(m?["download"])
    }

    // GET /api/status, the fields paintUpdateCard is painted from (the page's call: data.version, data.update, ...).
    static func state(status: Int, data: Data?) -> State? {
        guard status == 200, let o = object(data) else { return nil }
        var s = State(version: text(o["version"]), offer: text((o["update"] as? [String: Any])?["version"]), look: look(o["updateLook"]),
                      channel: text(o["updateChannel"]), platform: text(o["platform"]), cloud: o["cloudMachine"] as? Bool == true,
                      bootedAt: text(o["bootedAt"]), attempt: attempt(o["updateAttempt"]), log: text(o["updateLog"]))
        manual(&s, o["updateManual"])
        return s
    }

    // POST /api/update/check's answer, laid over what was shown (the page's call: out.running, out.offer, a look that
    // has looked, out.manual, out.channel). Nil when it is not the check's answer.
    static func checked(_ shown: State, status: Int, data: Data?) -> State? {
        guard status == 200, let o = object(data) else { return nil }
        var s = shown
        if let v = text(o["running"]) { s.version = v }
        s.offer = text((o["offer"] as? [String: Any])?["version"])
        s.look = Look(looked: true, reached: o["reached"] as? Bool == true, readable: o["readable"] as? Bool == true)
        manual(&s, o["manual"])
        s.channel = text(o["channel"]) ?? s.channel
        return s
    }

    // A check with no answer, as the page: the step-up's own sentence, else "Kosmos X. Could not check just now." (the
    // line stands alone for a screen reader, so it names the version).
    static func checkFailed(status: Int, data: Data?, version: String?) -> String {
        if status == 403, let o = object(data), (o["code"] as? String)?.hasPrefix("remote_step_up") == true, let said = o["error"] as? String {
            return said
        }
        return (version.map { "Kosmos " + $0 + ". " } ?? "Kosmos. ") + "Could not check just now."
    }

    static func onWindows(_ s: State) -> Bool { s.platform == "win32" }

    // MARK: The card (paintUpdateCard's arms, in its order)

    enum Act: Equatable { case update, check, none }
    struct Card: Equatable {
        var line: String
        var button: String?       // nil: no button (the page hides it)
        var act: Act
        var disabled: Bool
    }
    static func card(_ s: State, asked: Bool) -> Card {
        if let v = s.offer { return Card(line: "Version " + v + " is ready.", button: Words.update, act: .update, disabled: false) }
        if let v = s.manualVersion, s.manualCommand != nil {
            return Card(line: "Version " + v + " is ready. " + Words.commandRemote, button: nil, act: .none, disabled: false)
        }
        if let v = s.manualVersion, s.manualDownload != nil {
            return Card(line: "Version " + v + " is ready. " + Words.downloadRemote, button: nil, act: .none, disabled: false)
        }
        if let l = s.look, l.looked == false { return Card(line: Words.checking, button: Words.check, act: .check, disabled: true) }
        if let l = s.look, l.reached == true, l.readable == true {
            let up = s.channel == "staging" ? Words.upToDateStaging : s.channel == "prod" ? Words.upToDateRelease : Words.upToDate
            return Card(line: asked ? up : "", button: Words.check, act: .check, disabled: false)
        }
        if let l = s.look, l.reached == true, l.readable != true { return Card(line: Words.unreadable, button: Words.tryAgain, act: .check, disabled: false) }
        if let l = s.look, l.reached == false, l.looked != false { return Card(line: Words.unreachable, button: Words.tryAgain, act: .check, disabled: false) }
        return Card(line: Words.checking, button: Words.check, act: .check, disabled: true)
    }

    static func confirmBody(_ s: State) -> String { onWindows(s) ? Words.confirmWindows : Words.confirmMac }

    // The switch shows where the page shows #auto-row: not on Windows, and on Linux only on a cloud computer.
    static func autoShown(_ s: State) -> Bool { !onWindows(s) && (s.platform != "linux" || s.cloud) }
    static func autoHint(_ s: State) -> String { s.cloud ? Words.autoHintCloud : Words.autoHint }

    enum Auto: Equatable {
        case on, off
        case unreadOff(String)    // a saved setting that could not be read: it counts as off, and the switch shows off
        case noAnswer(String)     // no answer: the page shows no switch at all (paintSwitch(null), never a false Off)
        var isOn: Bool { self == .on }
        var said: String? {
            switch self {
            case .unreadOff(let w), .noAnswer(let w): return w
            default: return nil
            }
        }
    }
    // GET or PUT /api/autoupdate's answer, as autoPaint.
    static func auto(status: Int, data: Data?, cloud: Bool) -> Auto {
        guard status == 200, let o = object(data) else { return .noAnswer(Words.autoUnread) }
        if o["ok"] as? Bool == false { return .unreadOff(cloud ? Words.autoUnreadOffCloud : Words.autoUnreadOff) }
        return o["on"] as? Bool == true ? .on : .off
    }
    // A refused save says the computer's sentence, or the page's.
    static func autoRefused(status: Int, data: Data?) -> String { text(object(data)?["error"]) ?? Words.autoSaveFailed }

    // MARK: Installing

    enum Started: Equatable { case started(myStart: String?, updating: String?), unanswered, refused(String) }
    // POST /api/update's answer. A refusal is the computer's own sentence (the step-up's too); "no update to install"
    // means it already has it. No answer at all is not a refusal (#7207): it is very often the board restarting to
    // install the update this press started, so the screen waits, as the page's waitForUnansweredPress.
    static func started(status: Int, data: Data?, version: String?) -> Started {
        if status == 0 { return .unanswered }
        let o = object(data)
        if (200..<300).contains(status) { return .started(myStart: o.flatMap { text($0["startedAt"]) }, updating: o.flatMap { text($0["updating"]) }) }
        let said = o.flatMap { text($0["error"]) } ?? Words.noReason(status)
        if status == 409, said.contains("no update to install") { return .refused(Words.already(version)) }
        return .refused(said)
    }

    // updateOverlayLead: on Windows the board downloads first while it still answers, then goes away to swap it in;
    // elsewhere it is "Updating." throughout. (With no version named, "Updating.", where the page would print "Downloading .")
    static func overlayLead(reached: Bool, version: String?, windows: Bool) -> String {
        guard windows, reached, let version else { return Words.updating }
        return "Downloading " + version + "."
    }

    // While an unanswered press waits: the page's words, "this page" said as this screen.
    static let notAnswering = "Kosmos is not answering right now. It may be restarting, perhaps to install the update. This screen will wait for it to answer."
    enum Unanswered: Equatable { case done, restarted, answering, deadline, waiting }
    // unansweredPressVerdict: the version and boot are the ones the press saw before its POST.
    static func unanswered(elapsed: TimeInterval, reached: Bool, before: String?, now: String?, bootBefore: String?, bootNow: String?) -> Unanswered {
        if reached, let before, let now, now != before { return .done }
        if reached, before != nil, let bootBefore, let bootNow, bootNow != bootBefore { return .restarted }
        if reached { return .answering }
        if elapsed >= 3 * 60 { return .deadline }
        return .waiting
    }
    static func unansweredSays(_ v: Unanswered, now: String?) -> String? {
        switch v {
        case .restarted: return "Kosmos restarted and is still on " + (now ?? "the same version") + ". Press Update to update it now."
        case .answering: return "Kosmos is answering again. Press Update to try again. If the update already started, this joins it."
        // The page's, with its Reload said as the phone's pull to refresh.
        case .deadline: return "Kosmos has not answered for three minutes. Pull down to see where it is."
        case .done, .waiting: return nil
        }
    }

    enum Verdict: Equatable { case done, failed, didNotTake, deadline, slow, waiting }
    // updateVerdict, the same order and limits: "it failed" is only ever the installer's word, a new boot on the same
    // version did not take, three minutes is the deadline, ninety seconds with the same boot is slow.
    static func verdict(elapsed: TimeInterval, reached: Bool, before: String?, now: String?, attempt: Attempt?, myStart: String?,
                        bootBefore: String?, bootNow: String?) -> Verdict {
        let mine = attempt != nil && myStart != nil && attempt?.startedAt == myStart
        if mine, attempt?.endedAt != nil, attempt?.code != 0 { return .failed }
        if reached, let before, let now, now != before { return .done }
        let rebooted = reached && bootBefore != nil && bootNow != nil && bootNow != bootBefore
        if rebooted, before != nil, now == before { return .didNotTake }
        if elapsed >= 3 * 60 { return .deadline }
        if elapsed >= 90, reached, !rebooted { return .slow }
        return .waiting
    }

    // updateSettleText, as plain text: its bold lead, then the rest.
    struct Settle: Equatable { var lead: String, rest: String }
    static func settle(_ v: Verdict, now: String?, attempt: Attempt?, log: String?, windows: Bool) -> Settle {
        let still = now.map { " Kosmos is still on " + $0 + "." } ?? ""
        let notes = log.map { " The installer's notes are at " + $0 + "." } ?? ""
        if v == .failed || v == .didNotTake {
            if windows { return Settle(lead: Words.didNotTake, rest: String((still + " " + Words.nothingChanged + notes).drop(while: { $0 == " " }))) }
            if v == .failed {
                let how = attempt?.code.map { "stopped (code \($0))" } ?? "could not be started"
                return Settle(lead: Words.didNotTake, rest: "The installer " + how + "." + still + refused(attempt) + notes)
            }
            return Settle(lead: Words.didNotTake, rest: String((still + notes).drop(while: { $0 == " " })))
        }
        return Settle(lead: Words.slowLead, rest: String((still + " " + (windows ? Words.slowWindows : Words.slowMac) + notes).drop(while: { $0 == " " })))
    }

    // updateRefusedText: the installer's refusal in its own words, with the line that clears it.
    static func refused(_ a: Attempt?) -> String {
        guard let a, let at = a.refusedAt else { return "" }
        let quote = { (p: String) in "'" + p.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let list = (a.refusedPaths.isEmpty ? [at] : a.refusedPaths).map(quote).joined(separator: " ")
        switch a.refusedWhy {
        case "locked":
            return " Part of it is locked: " + at + ". Nothing was removed. Unlock it with this line in Terminal, then update again: "
                + "chflags -R nouchg,nouappnd " + list + ". If it is still refused, the lock was set by an administrator, who can clear it with: "
                + "sudo chflags -R noschg,nosappnd " + list
        case "immutable":
            return " Part of it is marked immutable or append-only: " + at + ". Nothing was removed. Only an administrator can clear that, with this line in a terminal, then update again: "
                + "sudo chattr -R -i -a " + list
        case "permissions":
            return " This account may not change " + at + ". Nothing was removed. Give that folder back to this account, then update again."
        default: return ""
        }
    }

    // MARK: Requests

    private static func sign(_ r: inout URLRequest, _ mac: Settings.Mac) {
        r.cachePolicy = .reloadIgnoringLocalCacheData
        r.timeoutInterval = 30   // a check asks the update server before it answers
        r.httpShouldHandleCookies = false
        r.setValue("\(Board.macCookieName)=\(mac.cookie)", forHTTPHeaderField: "Cookie")
        r.setValue("same-origin", forHTTPHeaderField: Board.fetchSiteHeader)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
    }
    private static func post(_ r: inout URLRequest, _ mac: Settings.Mac, _ body: [String: Any]?) {
        sign(&r, mac)
        if let body, let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) {
            r.httpBody = data
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
    }

    // Each request's route on its own line, so server.ios-routes-6838.test.js can read it.
    static func statusRequest(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/status", relativeTo: mac.url)!.absoluteURL)
        sign(&r, mac)
        r.timeoutInterval = 15
        return r
    }
    static func checkRequest(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/update/check", relativeTo: mac.url)!.absoluteURL); r.httpMethod = "POST"
        post(&r, mac, nil)
        r.timeoutInterval = 10   // the page gives up on a check after 10 s
        return r
    }
    static func installRequest(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/update", relativeTo: mac.url)!.absoluteURL); r.httpMethod = "POST"
        post(&r, mac, [:])
        return r
    }
    static func autoRequest(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/autoupdate", relativeTo: mac.url)!.absoluteURL)
        sign(&r, mac)
        r.timeoutInterval = 15
        return r
    }
    static func autoSaveRequest(_ mac: Settings.Mac, on: Bool) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/autoupdate", relativeTo: mac.url)!.absoluteURL); r.httpMethod = "PUT"
        post(&r, mac, ["on": on])
        return r
    }

    // A sample build's computer: a Mac on the release channel with an update ready, automatic updates on.
    static let sampleStatus = #"{"version":"0.8.21","update":{"version":"0.8.22"},"updateLook":{"looked":true,"reached":true,"readable":true},"updateChannel":"prod","platform":"darwin","cloudMachine":false,"bootedAt":"2026-11-25T06:00:00.000Z"}"#
    static let sampleAuto = #"{"on":true}"#
}
