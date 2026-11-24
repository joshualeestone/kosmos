import Foundation

// kosmos#8959 slice B1a: the native Kosmos+ account screen (AccountView.swift), which the Settings tab's "Your Kosmos+
// account" row opens instead of the web page. This file is its logic, UIKit-free so LogicTests/run-account.sh compiles it
// for macOS: the computers on the account and the words for each (the web page's macWhen, signin.html), Retire with the
// four characters Kosmos+ shows, Sign out (ended on Kosmos+ too, as the page's signOut does since kosmos-relay#795) and
// Sign out everywhere. The second step (B1b) and passkeys (B1c) have their own files; the plan line (B2) is below.
enum Account {

    // MARK: - The computers

    // One row of GET /v1/account/macs (coordinator second.rs list_macs). Unlike Board.Mac (the computers the app may
    // open), every row is kept: a retired, waiting or refused computer is listed, so the person can see and retire it.
    struct Computer: Equatable, Identifiable {
        let name: String
        var lastSeen: Double? = nil
        var retired = false
        var held = false
        var refused = false
        var updating = false
        var remoteOff = false
        var notConnected = false
        // Its place in the list: a retired computer keeps its name (second.rs splits it at '#'), so a name set up again
        // after the grace day is listed twice, and the name alone is not an identity.
        var position = 0
        var id: Int { position }
    }

    static func parseComputers(_ data: Data?) -> [Computer]? {
        guard let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = obj["macs"] as? [[String: Any]]
        else { return nil }
        return rows.enumerated().compactMap { position, row in
            // A row with no name cannot be retired (the route takes the name), so it is not shown as one that can.
            guard let name = row["name"] as? String, !name.isEmpty else { return nil }
            let seen = (row["last_seen"] as? NSNumber)?.doubleValue
            return Computer(name: name,
                            lastSeen: seen.flatMap { $0 > 0 ? $0 : nil },
                            retired: truthy(row["retired_at"]),
                            held: row["held"] as? Bool ?? false,
                            refused: row["refused"] as? Bool ?? false,
                            updating: truthy(row["updating_until"]),
                            remoteOff: row["remote_off"] as? Bool ?? false,
                            notConnected: row["not_connected"] as? Bool ?? false,
                            position: position)
        }
    }

    // A time the page tests for truth: a number other than 0 (null, missing or 0 is unset).
    static func truthy(_ v: Any?) -> Bool { ((v as? NSNumber)?.doubleValue ?? 0) != 0 }

    // The page's MAC_STALE_SECS: silent this long, a computer "may be off, or gone".
    static let staleSeconds: Double = 14 * 86400

    // The computers that can allow another (neither retired, waiting nor refused), the page's `allowed` count, which is
    // the server's own test for who may allow (approver_live_on). Like the server, it does not ask whether one is on.
    static func canAllow(_ rows: [Computer]) -> Int {
        rows.filter { !$0.retired && !$0.held && !$0.refused }.count
    }

    static func count(_ n: Int, _ unit: String) -> String { "\(n) \(unit)\(n == 1 ? "" : "s")" }

    // The page's macAgo: the one age ladder, so its thresholds match the web page's.
    static func ago(_ secs: Double) -> String {
        if secs < 120 { return "just now" }
        if secs < 3600 { return count(Int((secs / 60).rounded()), "minute") + " ago" }
        if secs < 172800 { return count(Int((secs / 3600).rounded()), "hour") + " ago" }
        return count(Int((secs / 86400).rounded()), "day") + " ago"
    }

    // The page's macAnswering: heard from in the last two minutes, and none of the states that say nobody can get in.
    static func answering(_ c: Computer, now: Double) -> Bool {
        guard !c.retired, !c.refused, !c.held, !c.updating, !c.remoteOff, !c.notConnected, let seen = c.lastSeen
        else { return false }
        return max(0, now - seen) < 120
    }

    // The page's macWhen, word for word, so the iPhone and the web page never describe one computer two ways.
    static func words(_ c: Computer, now: Double, canAllow: Int) -> String {
        if c.retired { return "Retired. Its address is free again." }
        let heard = c.lastSeen.map { " Last heard from " + ago(max(0, now - $0)) + "." } ?? " It has not answered yet."
        if c.refused { return "Not allowed on your account. Retire it, and set it up again if it is yours." + heard }
        if c.held {
            let wait = canAllow > 1 ? "Waiting for approval on one of your other computers."
                : canAllow == 1 ? "Waiting for approval on your other computer."
                : "Waiting to be allowed, but no other computer on your account is left to allow it. Retire it and set it up again."
            return wait + (canAllow > 0 ? " If you did not set it up, do not allow it there." : "") + heard
        }
        if c.updating { return "Applying an update, back in a moment." }
        guard let seen = c.lastSeen else { return "Has not answered yet." }
        let since = max(0, now - seen)
        if c.remoteOff && since < staleSeconds { return "Remote access off, last heard from " + ago(since) }
        if c.notConnected && since < staleSeconds { return "Remote access on, but not connected, last heard from " + ago(since) }
        if answering(c, now: now) { return "Answering now" }
        if since < staleSeconds { return "Answered " + ago(since) }
        return "Has not answered in " + count(Int((since / 86400).rounded()), "day") + ". It may be off, or gone."
    }

    // The page's macStale: shown dimmer when silent, never when retired (its own look), waiting, refused or updating.
    static func stale(_ c: Computer, now: Double) -> Bool {
        if c.retired || c.updating || c.held || c.refused { return false }
        guard let seen = c.lastSeen else { return true }
        return now - seen >= staleSeconds
    }

    // MARK: - Requests

    private static func post(_ path: String, coordinator: URL, session: String, body: [String: Any] = [:]) -> URLRequest {
        // The coordinator's own routes, built as PushBridgeLogic builds them (server.ios-routes-6838 reads this form).
        var r = URLRequest(url: coordinator.appendingPathComponent(String(path.dropFirst())))
        r.httpMethod = "POST"
        r.timeoutInterval = 15
        r.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        r.httpShouldHandleCookies = false
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // The first ask carries no code: Kosmos+ answers 409 with the four characters for THAT computer and the sentence to
    // show. The app never computes the code, so a tap on the wrong row can retire nothing (as on the page).
    static func retireRequest(coordinator: URL, session: String, name: String, confirm: String? = nil) -> URLRequest {
        var body: [String: Any] = ["name": name]
        if let confirm { body["confirm"] = confirm }
        return post("/v1/account/macs/remove", coordinator: coordinator, session: session, body: body)
    }

    static func signOutEverywhereRequest(coordinator: URL, session: String) -> URLRequest {
        post("/v1/account/sign-out-everywhere", coordinator: coordinator, session: session)
    }

    // Header the route requires (websession.rs web_request), as the web account page sends it. A request from URLSession
    // carries no Origin or Sec-Fetch-Site, which that check lets through.
    static let webHeader = "x-kosmos-web"

    // kosmos-relay#795: Sign out ends this device's sessions on Kosmos+ too, so a copy of the token stops working.
    static func forgetRequest(coordinator: URL, session: String) -> URLRequest {
        var r = post("/v1/session/forget", coordinator: coordinator, session: session)
        r.setValue("1", forHTTPHeaderField: webHeader)
        return r
    }

    // MARK: - Answers

    static func errorWords(_ data: Data?) -> String? {
        guard let data, let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let e = obj["error"] as? String, !e.isEmpty else { return nil }
        return sentence(e) + (e.hasSuffix(".") ? "" : ".")
    }

    // Kosmos+ writes its messages in lower case for the page to show inside a line; on their own they start capitalised.
    static func sentence(_ s: String) -> String {
        guard let first = s.first else { return s }
        return first.uppercased() + s.dropFirst()
    }

    static let reach = "Could not reach Kosmos+. Try again in a moment."
    static let tryAgain = "That did not work. Try again."

    enum Retire: Equatable {
        // Type `code` to retire it; `words` is Kosmos+'s own sentence.
        case confirm(code: String, words: String)
        case retired
        case refused(String)
    }

    // `typed` is the code the person typed, nil on the first ask. A wrong code answers 409 again with the same code:
    // that is said, rather than showing the same sentence as if nothing happened (as on the page).
    static func retireAnswer(status: Int?, data: Data?, name: String, typed: String?) -> Retire {
        guard let status else { return .refused(reach) }
        let obj = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        if (200...299).contains(status), obj?["ok"] as? Bool == true { return .retired }
        if let code = obj?["confirm"] as? String, !code.isEmpty {
            if typed != nil { return .refused("That is not the code shown for \(name). Nothing was retired.") }
            // Its sentence is written to sit inside a line on the page, so it has no full stop of its own.
            let words = (obj?["message"] as? String).map { m in sentence(m) + (m.hasSuffix(".") ? "" : ".") }
                ?? "Type \(code) to retire \(name)."
            return .confirm(code: code, words: words)
        }
        return .refused(errorWords(data) ?? tryAgain)
    }

    // What the person typed, as the page reads it: trimmed, upper case.
    static func typedCode(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }

    enum SignOut: Equatable {
        // Ended on Kosmos+ (or already over there): this iPhone signs out now.
        case signOutHere
        // Kosmos+ did not say it ended them: the iPhone stays signed in and says why.
        case stay(String)
    }

    // The page's rule (kosmos#4779): 200, or 401 (this sign-in is already over), signs out here too. Anything else keeps
    // the sign-in, because the other sign-ins may not have been ended. A 401 says only that this one is over, not that the
    // others were ended; like the page, the app signs out here and says nothing more (decided, in the plan).
    static func everywhereAnswer(status: Int?, data: Data?) -> SignOut {
        guard let status else { return .stay(reach) }
        if (200...299).contains(status) || status == 401 { return .signOutHere }
        return .stay(errorWords(data) ?? "That did not work. Try again in a moment.")
    }

    // Sign out on this iPhone: 200 ended it on Kosmos+ (forget answers 200 for a session it already refuses, too). 401 is
    // taken the same way, as nothing left to end. Anything else, or no answer, is said, and the person chooses (AccountView): try again,
    // or sign out on this iPhone only. The page signs out at once and says it afterwards; here the screen it would be
    // said on goes away with the sign-in, so the choice comes first.
    static func forgetAnswer(status: Int?) -> SignOut {
        guard let status else { return .stay(forgetFailed) }
        if (200...299).contains(status) || status == 401 { return .signOutHere }
        return .stay(forgetFailed)
    }

    static let forgetFailed = "Kosmos+ could not end this sign-in on its side. Try again, or sign out on this iPhone only."

    // MARK: - The plan (slice B2)

    // kosmos#8959 slice B2: the plan line the web account page shows inside the app (signin.html #plan-line, #3479), and
    // nothing more. Billing, the subscription and the cloud machine are never on the phone and never linked to from it:
    // the page's ONE SWITCH (CAN_BUY_HERE, kosmos#718) keeps selling out of the apps, and only Josh changes that.
    static let mePath = "/v1/account/me"
    static let planActive = "Kosmos+ \u{00B7} Active"

    static func meRequest(coordinator: URL, session: String) -> URLRequest {
        var r = URLRequest(url: coordinator.appendingPathComponent(String(mePath.dropFirst())))
        r.timeoutInterval = 15
        r.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        r.httpShouldHandleCookies = false
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // The page's test, word for word: `body.kosmos_plus === true && (!body.standing || body.standing === "good")`. Only a
    // real JSON true counts (a 1 or a "true" does not, as BoardLogic.fedGateMode reads it); a standing that is absent,
    // null, false, 0 or empty is JavaScript-falsy and passes, as does "good"; anything else hides the line.
    static func planLine(_ data: Data?) -> String? {
        guard let data, let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        guard let plus = obj["kosmos_plus"] as? NSNumber, CFGetTypeID(plus) == CFBooleanGetTypeID(), plus.boolValue
        else { return nil }
        return standingFalsy(obj["standing"]) || (obj["standing"] as? String) == "good" ? planActive : nil
    }

    // The page's #standing-note (signin.html, kosmos#8022): the server's own sentence when the plan is not good (lapsed,
    // never paid, a company's seats), shown inside the app too, because the relay cannot explain a refusal and the phone
    // is where the sentence has to be (signin.rs standing_note). Shown whenever `standing_note` is a non-empty string, in
    // the calm colour when `standing_note_calm` is truthy, as an error otherwise. The words are the server's, never ours.
    struct StandingNote: Equatable { let words: String; let calm: Bool }

    static func standingNote(_ data: Data?) -> StandingNote? {
        guard let data, let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let words = obj["standing_note"] as? String, !words.isEmpty else { return nil }
        return StandingNote(words: words, calm: truthy(obj["standing_note_calm"]))
    }

    private static func standingFalsy(_ v: Any?) -> Bool {
        switch v {
        case nil, is NSNull: return true
        case let s as String: return s.isEmpty
        case let n as NSNumber: return n.doubleValue == 0 || n.doubleValue.isNaN
        default: return false
        }
    }
}
