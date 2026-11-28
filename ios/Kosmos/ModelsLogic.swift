import Foundation

/* kosmos#8959 slice D2a: the computer's AI Models, native and read only. The pill on each account row follows the
   page's paintAccounts (web/index.html, the connBadge chain) case for case and in the same order; the page's tooltips
   are not copied, because they point at "Check now", which the phone does not have (the plan on the card). The clock,
   locale and time zone are passed in, so web.models-ios-parity-8959.test.js can pin them against the page's own code. */
enum Models {
    typealias Account = NewAgentPicker.Account

    enum Words {
        static let title = "AI Models"
        static let reading = "Checking your accounts…"                                   // the page's msg while it reads
        static let failed = "We could not read the accounts on this computer."            // the page's catch
        // Not the page's (it shows the add form instead): the phone's own empty line, as the plan says.
        static let empty = "No AI accounts on this computer yet."
        static let footer = "To check, sign in, add or change an account, use Settings on your computer."
    }

    // The computer's cookie by hand and the board's header, as Settings' other screens sign theirs.
    static func request(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/accounts", relativeTo: mac.url)!.absoluteURL)
        r.cachePolicy = .reloadIgnoringLocalCacheData
        r.timeoutInterval = 30   // the route checks each account live before it answers
        r.httpShouldHandleCookies = false
        r.setValue("\(Board.macCookieName)=\(mac.cookie)", forHTTPHeaderField: "Cookie")
        r.setValue("same-origin", forHTTPHeaderField: Board.fetchSiteHeader)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        return r
    }

    enum Read: Equatable { case got([Account]), failed(String) }

    // Anything but a 200 whose body parses is the page's could-not-read sentence (its catch covers a refusal too).
    static func read(status: Int, data: Data) -> Read {
        guard status == 200, let rows = NewAgentPicker.parseAccounts(data) else { return .failed(Words.failed) }
        return .got(rows)
    }

    // The pill's colour, named for the page's classes.
    enum Tone: String, Equatable { case connected, loginok, unverified, none, unknown }

    struct Pill: Equatable {
        let words: String
        let tone: Tone
    }

    struct Clock {
        var now: Date = Date()
        var locale: Locale = .current
        var timeZone: TimeZone = .current
        var calendar: Calendar {
            var c = Calendar(identifier: .gregorian)
            c.locale = locale
            c.timeZone = timeZone
            return c
        }
    }

    // agoWords: the page's relative age, in whole seconds, minutes, hours or days.
    static func agoWords(_ ms: Double?) -> String {
        guard let ms, ms.isFinite, ms >= 0 else { return "" }
        let n = Int((ms / 1000).rounded(.down))
        if n < 5 { return "just now" }
        if n < 90 { return "\(n) seconds ago" }
        let mins = n / 60
        if mins < 90 { return "\(mins)" + (mins == 1 ? " minute ago" : " minutes ago") }
        let hours = n / 3600
        if hours < 36 { return "\(hours)" + (hours == 1 ? " hour ago" : " hours ago") }
        let days = n / 86400
        return "\(days)" + (days == 1 ? " day ago" : " days ago")
    }

    static func format(_ d: Date, _ template: String, _ clock: Clock) -> String {
        let f = DateFormatter()
        f.locale = clock.locale
        f.timeZone = clock.timeZone
        f.calendar = clock.calendar
        f.setLocalizedDateFormatFromTemplate(template)
        // Newer ICU puts a narrow no-break space (U+202F) before AM/PM; the page's toLocaleTimeString does not (V8 kept
        // a plain space), so the phone writes the page's plain space. web.models-ios-parity-8959 pins it.
        return f.string(from: d).replacingOccurrences(of: "\u{202F}", with: " ")
    }

    // { month: 'short', day: 'numeric' }, with the year only when it is not this year (the login and since dates).
    static func shortDate(_ ms: Double, _ clock: Clock, yearWhenOther: Bool) -> String {
        let d = Date(timeIntervalSince1970: ms / 1000)
        let other = clock.calendar.component(.year, from: d) != clock.calendar.component(.year, from: clock.now)
        return format(d, (yearWhenOther && other) ? "MMMdy" : "MMMd", clock)
    }

    // loginAdvWhen: "at about 3:40 PM", "tomorrow at about ...", or "on Friday, Nov 28 at about ...".
    static func loginAdvWhen(_ ms: Double, _ clock: Clock) -> String {
        let d = Date(timeIntervalSince1970: ms / 1000)
        let time = format(d, "jmm", clock)
        let cal = clock.calendar
        if cal.isDate(d, inSameDayAs: clock.now) { return "at about " + time }
        if let tomorrow = cal.date(byAdding: .day, value: 1, to: clock.now), cal.isDate(d, inSameDayAs: tomorrow) {
            return "tomorrow at about " + time
        }
        return "on " + format(d, "EEEEMMMd", clock) + " at about " + time
    }

    // expiresWords: "expires today", "expires in 1 day", "expires in N days". Its own typed function: as one closure
    // expression it is the kind CI's compiler could not type-check in time (UsageView.swift:138, PR #9223).
    static func expiryWords(_ days: Int) -> String {
        if days == 0 { return "expires today" }
        let unit: String = days == 1 ? " day" : " days"
        return "expires in " + String(days) + unit
    }

    // The connBadge chain, in the page's order.
    static func pill(_ a: Account, _ clock: Clock = Clock()) -> Pill {
        let l = a.live
        let badge = a.badge
        let nowMs = clock.now.timeIntervalSince1970 * 1000
        let ageStr = agoWords(l.observedAgeMs)
        let fromCheck = l.observedFrom == "check"
        let noneWhy = l.because ?? "this account is not connected"
        let unknownWhy = l.because ?? "we could not check this account"
        let loginDate = l.loginValidUntil.map { shortDate($0, clock, yearWhenOther: true) } ?? ""
        let loginGreenNoDate = badge == "working" && l.observedFrom == "login" && loginDate.isEmpty
        let stopsAt = l.loginStopsAt.flatMap { $0 > nowMs ? $0 : nil }
        let expiresIn = l.loginExpiresInDays
        let expiresWords: String = expiresIn.map(expiryWords) ?? ""
        let expiresDate = l.loginExpiresAt.map { shortDate($0, clock, yearWhenOther: false) } ?? ""
        let loginEnded = l.loginEnded && stopsAt == nil
        let isOpenai = a.provider == .openai

        if let stopsAt { return Pill(words: "Signed in · stops working " + loginAdvWhen(stopsAt, clock), tone: .unverified) }
        if loginEnded { return Pill(words: "Login expired", tone: .none) }
        if expiresIn != nil {
            return Pill(words: expiresDate.isEmpty ? "Signed in · login " + expiresWords : "Signed in until " + expiresDate, tone: .unverified)
        }
        if badge == "working" && l.observedFrom == "login" && !loginDate.isEmpty {
            return Pill(words: "Signed in · login good until " + loginDate, tone: .connected)
        }
        if badge == "signed_in_unverified" && !loginDate.isEmpty {
            return Pill(words: "Signed in · login good until " + loginDate, tone: .loginok)
        }
        if loginGreenNoDate { return Pill(words: "Signed in", tone: .unverified) }
        if badge == "working" {
            return Pill(words: "Signed in" + (ageStr.isEmpty ? "" : (fromCheck ? " · checked " : " · active ") + ageStr), tone: .connected)
        }
        if badge == "rejected" {
            return Pill(words: "Not connected" + (ageStr.isEmpty ? "" : " · rejected " + ageStr), tone: .none)
        }
        if badge == "signed_in_unverified", let since = l.notConfirmedSince {
            return Pill(words: "Not confirmed since " + shortDate(since, clock, yearWhenOther: true), tone: .unverified)
        }
        if badge == "signed_in_unverified" { return Pill(words: "Signed in", tone: .unverified) }
        if badge == "signed_out" { return Pill(words: noneWhy, tone: .none) }
        if badge == "unchecked" { return Pill(words: unknownWhy, tone: .unknown) }
        if isOpenai && l.authMode == "chatgpt" {
            if a.state == "connected" { return Pill(words: "Signed in", tone: .connected) }
            if a.state == "none" { return Pill(words: "Not connected", tone: .none) }
            return Pill(words: "Signed in", tone: .unverified)
        }
        // The legacy state fallback, for a row with no badge (an OpenAI API-key row, or an older server).
        if a.hasConnection && a.state == "connected" { return Pill(words: "Signed in", tone: .connected) }
        if a.hasConnection && a.state == "none" { return Pill(words: noneWhy, tone: .none) }
        return Pill(words: unknownWhy, tone: .unknown)
    }
}
