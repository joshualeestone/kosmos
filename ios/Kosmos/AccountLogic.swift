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

    // kosmos#8959 slice B2: the plan line and the standing note the web account page shows inside the app (signin.html
    // #plan-line, #3479, and #standing-note), and nothing more. Billing, the subscription and the cloud machine are never
    // on the phone and never linked to from it: the page's ONE SWITCH (CAN_BUY_HERE, kosmos#718) keeps selling out of the apps, and only Josh changes that.
    static let mePath = "/v1/account/me"
    static let planActive = "Kosmos+ \u{00B7} Active"
    static let planSpoken = "Kosmos+, Active"

    // Whether an answer is a JSON object at all: one that is not is a failed read, not an account with no plan.
    static func isObject(_ data: Data?) -> Bool {
        guard let data else { return false }
        return ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]) != nil
    }

    static func meRequest(coordinator: URL, session: String) -> URLRequest {
        var r = URLRequest(url: coordinator.appendingPathComponent(String(mePath.dropFirst())))
        r.timeoutInterval = 15
        r.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        r.httpShouldHandleCookies = false
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    // The page's test, word for word. Against today's server kosmos_plus is true only when standing is "good", so the
    // "good" arm adds nothing; it is kept so this stays the page's test, not a second reading of it: `body.kosmos_plus === true && (!body.standing || body.standing === "good")`. Only a
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
              // Review 8: only a string is shown. The page would print any truthy value; the server sends a string or
              // nothing (signin.rs session_view), so a number here is not the server's sentence and is not drawn.
              let words = obj["standing_note"] as? String, !words.isEmpty else { return nil }
        // Review 6: the page's !!standing_note_calm, so a string counts as JavaScript does.
        return StandingNote(words: words, calm: !standingFalsy(obj["standing_note_calm"]))
    }

    // What one /v1/account/me answer does to what is shown (review 3). A 2xx with the account's JSON replaces it; a 401
    // (this sign-in is over, or only an enrol token) clears it; anything else (a 503 maintenance page, a 200 that is not
    // JSON, no answer) is a failed read and keeps what is shown, as the page keeps its lines.
    enum PlanAnswer: Equatable {
        case show(line: String?, note: StandingNote?, name: NameState, email: String?)
        case clear
        case keep
    }

    static func planAnswer(status: Int?, data: Data?) -> PlanAnswer {
        guard let status else { return .keep }
        if (200...299).contains(status), isObject(data) { return .show(line: planLine(data), note: standingNote(data), name: nameState(data), email: signedInAs(data)) }
        return status == 401 ? .clear : .keep
    }

    // MARK: - Who is signed in (slice B3)

    // The page's "Signed in as <email>" (#signed-in-as), from the same /me answer's email.
    static func signedInAs(_ data: Data?) -> String? {
        guard let data, let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let e = obj["email"] as? String, !e.isEmpty else { return nil }
        return e
    }

    // MARK: - No computer yet (slice B3 review 2)

    // The page's no-computer home (signin.html #no-addr-head and #no-addr): with the web page's row gone, this is where a
    // person with no computer learns how to connect one. The words are the page's; the download link it adds beside them
    // is not shown in the apps there (CAN_LINK_OUT), and is not here.
    static let noComputerHead = "No computer is connected yet."
    static let noComputerHow = "On the computer you want to reach, open Kosmos, go to Settings, then Kosmos+, "
        + "and sign in with this email. If Kosmos isn't on it yet, install it there first."
    // Review 3: "this email" points at the Signed in as line; with no email shown, the sentence says which one.
    static func noComputerHow(email: String?) -> String {
        email == nil ? noComputerHow.replacingOccurrences(of: "with this email", with: "with the email you signed in with")
                     : noComputerHow
    }

    // Review 3: whether to say there is no computer is the page's decision (noMac, from /me), not the computer list's:
    // /v1/account/macs also lists retired and held computers, and a refused device is shown only its own. Until /me
    // answers, the list stands in for it, counting only a computer that is neither retired nor held.
    // Review 7: the page's #pending-note for a refused device (signin.html, relay#217), so the empty list is explained.
    static let refusedDevice = "Your computer said no to this device last time. It is asking again; if that was you, allow it there."
    enum Computers: Equatable { case zero, live, refused }   // not none or some: as an Optional, those mean nil and wrapped
    static func computers(_ data: Data?) -> Computers? {
        guard let data, let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        if (obj["device_status"] as? String) == "denied" { return .refused }
        return ((obj["addresses"] as? [Any])?.isEmpty ?? true) ? .zero : .live
    }
    static func sayNoComputer(me: Computers?, rows: [Computer]) -> Bool {
        if let me { return me == .zero }
        return !rows.contains { !$0.retired && !$0.held }
    }

    // MARK: - The Kosmos+ address (slice B3)

    // kosmos#8959 slice B3: the web account page's #addr-line and #name-offer (signin.html signedIn, kosmos#7481/#7483),
    // read off the same /v1/account/me answer. With no computer the page says the account's own address; an account with
    // no name at all is offered one. Its rules, ported:
    //   noMac      = addresses is empty and device_status is not "denied" (relay#217: a refused device is told none)
    //   ownAddress = noMac and account_address is a string
    //   offer      = has_name === false and device_status is not "denied" and no ownAddress
    enum NameState: Equatable {
        case none
        case address(String)   // the page's "Your address: <name>"
        case offer             // the page's "Choose your Kosmos+ address"
    }

    static func nameState(_ data: Data?) -> NameState {
        guard let data, let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .none }
        let denied = (obj["device_status"] as? String) == "denied"
        let noMac = computers(data) == .zero   // review 5: one copy of the page's noMac rule
        if noMac, let own = obj["account_address"] as? String, !own.isEmpty { return .address(own) }
        let hasName = obj["has_name"] as? NSNumber
        let nameFalse = hasName.map { CFGetTypeID($0) == CFBooleanGetTypeID() && !$0.boolValue } ?? false
        return nameFalse && !denied ? .offer : .none
    }

    // The page's nameClean (#3791): lowercase; runs of spaces and underscores to one hyphen; nothing but a-z, 0-9 and
    // hyphens; no doubled hyphen; no leading hyphen; at most 32. Step for step, so a name cleans here as it does there.
    static func nameClean(_ v: String) -> String {
        let lower = v.lowercased()
        var spaced = "", inRun = false
        for ch in lower.unicodeScalars {
            if jsSpace(ch) || ch == "_" {
                if !inRun { spaced.unicodeScalars.append("-"); inRun = true }
            } else { spaced.unicodeScalars.append(ch); inRun = false }
        }
        let kept = spaced.unicodeScalars.filter { ("a"..."z").contains($0) || ("0"..."9").contains($0) || $0 == "-" }
        var out = ""
        for ch in kept where !(ch == "-" && out.hasSuffix("-")) { out.unicodeScalars.append(ch) }
        while out.hasPrefix("-") { out.removeFirst() }
        return String(out.prefix(32))
    }

    // JavaScript's \s (ECMAScript WhiteSpace and LineTerminator), which differs from CharacterSet.whitespacesAndNewlines on
    // U+0085, U+200B (Swift only) and U+FEFF (JavaScript only), measured in review 1.
    static func jsSpace(_ c: Unicode.Scalar) -> Bool {
        switch c.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        default: return false
        }
    }

    // The page's nameValid: /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/ (the server's valid_name stays the authority).
    static func nameValid(_ n: String) -> Bool {
        let s = Array(n.unicodeScalars)
        guard (3...32).contains(s.count) else { return false }
        func alnum(_ c: Unicode.Scalar) -> Bool { ("a"..."z").contains(c) || ("0"..."9").contains(c) }
        return alnum(s.first!) && alnum(s.last!) && s.allSatisfy { alnum($0) || $0 == "-" }
    }

    // The page's nameSuggest: eight characters from an alphabet with the look-alikes (0 o 1 l i) left out, drawn without
    // bias (randomElement on the system's secure generator). Save accepts it; typing replaces it.
    static let nameAlphabet = Array("abcdefghjkmnpqrstuvwxyz23456789")
    static func nameSuggest<G: RandomNumberGenerator>(using g: inout G) -> String {
        String((0..<8).map { _ in nameAlphabet.randomElement(using: &g)! })
    }
    static func nameSuggest() -> String { var g = SystemRandomNumberGenerator(); return nameSuggest(using: &g) }

    // The page's words on the name step.
    static let nameTitle = "Set up your Kosmos+ address"
    static let nameIntro = "This will be your permanent private address."
    static let nameHint = "3-32 letters, numbers or hyphens"
    static let nameSuggested = "We picked a private one. Type over it to choose your own."
    static let nameSave = "Save this name"
    static let nameOffer = "Choose your Kosmos+ address"
    static let nameDomain = ".kosmosplus.com"   // the page's own literal (#name-echo)
    static func nameEcho(_ clean: String) -> String { (clean.isEmpty ? "yourname" : clean) + nameDomain }

    static func nameRequest(coordinator: URL, session: String, name: String) -> URLRequest {
        post("/v1/account/name", coordinator: coordinator, session: session, body: ["name": name])
    }

    enum NameAnswer: Equatable {
        case saved(address: String)
        case refused(String)
    }

    // The page takes an answer with an address as saved, and anything else as refused with Kosmos+'s own sentence, or
    // "That name is not available." One refusal is never shown as Kosmos+ words it: address_not_bought (402) tells the
    // person to buy an address at a web page, which is a purchase pointed to from inside the app (kosmos#718), so the
    // phone says plainly that the address cannot be chosen here instead.
    static let nameNotHere = "This account cannot choose an address."
    static let nameUnreachable = "Kosmos could not be reached just now."
    static func nameAnswer(status: Int?, data: Data?) -> NameAnswer {
        guard let status else { return .refused(nameUnreachable) }
        let obj = data.flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
        if (200...299).contains(status), let address = obj?["address"] as? String, !address.isEmpty { return .saved(address: address) }
        if status == 402 || (obj?["code"] as? String) == "address_not_bought" { return .refused(nameNotHere) }
        // Review 1: a server or gateway failure is not a judgement on the name.
        if status >= 500 { return .refused(nameUnreachable) }
        if status == 401 { return .refused("You are signed out.") }   // review 4: not the server's "no such account"
        if status == 403 { return .refused(nameNotHere) }             // review 7: the review account; not its server words
        return .refused(errorWords(data) ?? "That name is not available.")
    }

    private static func standingFalsy(_ v: Any?) -> Bool {
        switch v {
        case nil, is NSNull: return true
        case let s as String: return s.isEmpty
        case let n as NSNumber: return n.doubleValue == 0
        default: return false
        }
    }
}
