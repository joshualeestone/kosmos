import Foundation

// kosmos#8959 slice D1c2a: the computer's Token usage figures, native on the phone. UIKit-free, so
// ios/LogicTests/run-usage.sh runs it on a Mac.
//
// Every figure is the board page's own arithmetic (web/index.html, Settings > Token usage: usageTotals, usageGrandTotal,
// usageByModel, usageApiCost with USAGE_MODEL_PRICES, usageAgentRows, usageAgentNote, usageHistoryHtml, usageHeroHtml,
// and the formatters usageAbbr, usageBigTokens, usageUsd, usageUsdTileSub1M), read from the same GET /api/usage?days=all,
// which is not gated for a remote session. The four daily charts and the model donut are slice D1c2b.
//
// Numbers are formatted as JavaScript's toFixed does, from the double's exact value with a tie going up (1.25M reads
// 1.3M, 9.95B reads 9.9B because 9.95 is 9.9499... in binary), never as Swift's %.1f, which rounds a tie to even. The
// logic suite pins figures computed by node from the page's own functions.
enum Usage {

    // MARK: The board's words

    enum Words {
        static let title = "Token usage"
        // The page's hint, up to the clause about the daily charts (D1c2b), and without "Nothing here leaves the
        // machine.", which is not so once the counts are shown on a phone (the transcripts stay; the counts travel).
        static let hintPieces = ["What your agents used, per class, since Kosmos was installed on this computer", "Read from the transcripts on this computer, shown in full."]
        static var hint: String { hintPieces[0] + ". " + hintPieces[1] }
        static let reading = "Reading the transcripts. Today has to be counted fresh every time, so on a busy day this takes up to a minute, and the first time after an update it can take a few."
        static let none = "No usage recorded yet on this computer."
        static let noneSince = "No usage recorded since Kosmos was installed on this computer."
        static let failed = "We could not read token usage just now."
        static let activeDays = "Active Days on Kosmos"
        static let totalTokens = "Total Tokens Used"
        static let humanCost = "Approximate Human Cost"
        static let workHours = "Human Work Hours"
        static let workYears = "Years of Human Work"
        static let apiCost = "Equivalent Token API Cost"
        static let model = "Model"
        static let share = "Share"
        static let tokens = "Tokens"
        static let ofTotal = "% total"
        static let byAgent = "By agent"
        static let byAgentHint = "Which agent did the work, from the folder each session started in."
        static let agent = "Agent"
        static let elsewhere = "Sessions outside any agent's folder"
        static let shared = "Folders shared by more than one agent"
        static let history = "Usage history"
        static let historyHint = "Your most recent days, newest first. It scrolls when the history runs long. Value estimates the human work each day represents."
        static let day = "Day"
        static let totalCol = "Total tokens"
        static let value = "Value"
        static let methodLead = "How we estimate the value: each day's tokens, across all four classes, are valued at a blended knowledge-work rate. Framing informed by "
        static let methodLink = "METR's research"
        static let methodTail = " on how long AI can work unattended."
        static let methodURL = URL(string: "https://metr.org/time-horizons/")!
    }

    // MARK: What the computer says

    struct Bucket: Equatable {
        var input = 0.0, output = 0.0, cacheWritten = 0.0, cacheRead = 0.0
        var total: Double { input + output + cacheWritten + cacheRead }   // usageRowTokenTotal / usageGrandTotal
        static func + (a: Bucket, b: Bucket) -> Bucket {
            Bucket(input: a.input + b.input, output: a.output + b.output, cacheWritten: a.cacheWritten + b.cacheWritten, cacheRead: a.cacheRead + b.cacheRead)
        }
    }
    struct AgentUse: Equatable { var name: String, shown: String, use: Bucket }
    struct ByAgent: Equatable {
        var agents: [AgentUse] = []
        var elsewhere = Bucket(), shared = Bucket(), unattributed = Bucket(), overcount = Bucket()
        var rosterRead: Bool?
    }
    struct Data_: Equatable {
        var byDay: [String: [String: Bucket]]
        var byAgent: ByAgent?
        var daysOnKosmos: Double?
        var roots: Int?
    }

    // Number(x) || 0, as the page reads every count.
    private static func num(_ v: Any?) -> Double {
        if let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() { let d = n.doubleValue; return d.isFinite ? d : 0 }
        if let s = v as? String, let d = Double(s.trimmingCharacters(in: .whitespaces)), d.isFinite { return d }
        return 0
    }
    private static func bucket(_ v: Any?) -> Bucket {
        let o = v as? [String: Any] ?? [:]
        return Bucket(input: num(o["input_tokens"]), output: num(o["output_tokens"]),
                      cacheWritten: num(o["cache_creation_input_tokens"]), cacheRead: num(o["cache_read_input_tokens"]))
    }

    static func read(status: Int, data: Data?) -> Data_? {
        guard status == 200, let data, let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        var byDay: [String: [String: Bucket]] = [:]
        for (day, models) in (o["byDay"] as? [String: Any]) ?? [:] {
            var m: [String: Bucket] = [:]
            for (model, b) in (models as? [String: Any]) ?? [:] { m[model] = bucket(b) }
            byDay[day] = m
        }
        var agents: ByAgent?
        if let a = o["byAgent"] as? [String: Any] {
            var b = ByAgent(rosterRead: a["rosterRead"] as? Bool)
            for x in (a["agents"] as? [Any]) ?? [] {
                guard let r = x as? [String: Any] else { continue }
                b.agents.append(AgentUse(name: (r["name"] as? String) ?? "", shown: (r["shown"] as? String) ?? "", use: bucket(r)))
            }
            b.elsewhere = bucket(a["elsewhere"]); b.shared = bucket(a["shared"])
            b.unattributed = bucket(a["unattributed"]); b.overcount = bucket(a["overcount"])
            agents = b
        }
        let days = (o["daysOnKosmos"] as? NSNumber)?.doubleValue
        return Data_(byDay: byDay, byAgent: agents, daysOnKosmos: days, roots: (o["rootsRead"] as? [Any])?.count)
    }

    // MARK: JavaScript's number formatting

    /// Number.prototype.toFixed: the double's exact decimal value, rounded at `digits` with a tie going up.
    static func fixed(_ x: Double, _ digits: Int) -> String {
        if !x.isFinite { return String(x) }
        let neg = x < 0
        let exact = String(format: "%.60f", abs(x))   // Darwin prints a double's exact binary value
        let parts = exact.split(separator: ".", omittingEmptySubsequences: false)
        var whole = Array(parts[0]), frac = Array(parts.count > 1 ? parts[1] : "")
        let next = frac.count > digits ? frac[digits] : "0"
        frac = Array(frac.prefix(digits))
        var digitsOut = whole + frac
        if next >= "5" {
            var i = digitsOut.count - 1
            while i >= 0 {
                if digitsOut[i] == "9" { digitsOut[i] = "0"; i -= 1 } else { digitsOut[i] = Character(String(digitsOut[i].wholeNumberValue! + 1)); break }
            }
            if i < 0 { digitsOut.insert("1", at: 0) }
        }
        whole = Array(digitsOut.prefix(digitsOut.count - digits))
        frac = Array(digitsOut.suffix(digits))
        let body = String(whole) + (digits > 0 ? "." + String(frac) : "")
        return (neg ? "-" : "") + body   // as JavaScript: (-0.004).toFixed(2) is "-0.00"
    }
    /// Math.round: half goes up.
    static func jsRound(_ x: Double) -> Double {
        let r = x.rounded(.down)
        return x - r >= 0.5 ? r + 1 : r   // exact, where (x + 0.5).rounded(.down) is off at 0.49999999999999994 and past 2^52
    }

    /// toLocaleString on a whole number: the person's grouping. `locale` is a seam for the suite.
    static func grouped(_ n: Double, locale: Locale = .current) -> String {
        formattersLock.lock()
        defer { formattersLock.unlock() }   // callable from any thread; a NumberFormatter is used under the lock too
        let f: NumberFormatter
        if let kept = formatters[locale.identifier] { f = kept } else {
            f = NumberFormatter()
            f.locale = locale
            f.numberStyle = .decimal
            f.maximumFractionDigits = 3
            formatters[locale.identifier] = f   // one per locale: the history formats every row twice
        }
        return f.string(from: NSNumber(value: n)) ?? String(n)
    }
    private static var formatters: [String: NumberFormatter] = [:]
    private static let formattersLock = NSLock()

    // usageAbbr
    static func abbr(_ n: Double) -> String {
        let v = n
        if v >= 1e9 || (Double(fixed(v / 1e6, 1)) ?? 0) >= 1000 {
            let d = v >= 1e10 || (Double(fixed(v / 1e9, 1)) ?? 0) >= 10 ? 0 : 1
            return fixed(v / 1e9, d) + "B"
        }
        if v >= 1e6 || (Double(fixed(v / 1e3, 0)) ?? 0) >= 1000 { return fixed(v / 1e6, 1) + "M" }
        if v >= 1e3 { return fixed(v / 1e3, 0) + "K" }
        // A whole count as its digits, never through Int (which stops the app past 9.2e18 on a malformed answer).
        return v == v.rounded() ? String(format: "%.0f", v) : String(v)
    }
    // usageBigTokens: one decimal in the B band, else usageAbbr.
    static func bigTokens(_ v: Double) -> String { v >= 1e9 ? fixed(v / 1e9, 1) + "B" : abbr(v) }
    // usageUsd
    static func usd(_ v: Double, locale: Locale = .current) -> String {
        if v >= 1e9 { return "$" + fixed(v / 1e9, 2) + "B" }
        if v >= 1e6 { return "$" + fixed(v / 1e6, 0) + "M" }
        if v >= 1e3 { return "$" + grouped(jsRound(v), locale: locale) }
        return "$" + fixed(v, v < 10 ? 2 : 0)
    }
    // usageUsdTileSub1M
    static func tileSub1M(_ v: Double, locale: Locale = .current) -> String {
        if v < 1e3 { return usd(v, locale: locale) }
        let k = v / 1e3
        if k >= 999.95 { return "$" + fixed(v / 1e6, 1) + "M" }
        var s = fixed(k, 1)
        if s.hasSuffix(".0") { s.removeLast(2) }
        return "$" + s + "K"
    }
    static let tokensPerHour = 100_000.0   // USAGE_VALUE_TOKENS_PER_HOUR
    static let blendedRate = 90.0          // USAGE_VALUE_BLENDED_RATE
    static let hoursPerYear = 2080.0       // USAGE_VALUE_HOURS_PER_YEAR
    static func rowValue(_ total: Double, locale: Locale = .current) -> String { usd(total / tokensPerHour * blendedRate, locale: locale) }

    // MARK: The page's figures

    static func totals(_ byDay: [String: [String: Bucket]]) -> Bucket {
        byDay.values.flatMap(\.values).reduce(Bucket(), +)
    }
    struct Share: Equatable { var name: String, tok: Double, muted: Bool }
    // usageByModel: most tokens first (the engine's ties keep the page's insertion order, which JSON does not carry;
    // ties are then by name, so the order is at least stable).
    static func byModel(_ byDay: [String: [String: Bucket]]) -> [Share] {
        var acc: [String: Double] = [:]
        for models in byDay.values { for (m, b) in models { acc[m, default: 0] += b.total } }
        return acc.map { Share(name: $0.key, tok: $0.value, muted: false) }.sorted { $0.tok != $1.tok ? $0.tok > $1.tok : $0.name < $1.name }
    }
    // usageShareTableHtml's two numbers: tokens, and the share of the grand total ("<0.1%" under a tenth).
    static func percent(_ tok: Double, of total: Double) -> String {
        let pct = tok / (total > 0 ? total : 1) * 100
        return pct >= 0.1 ? fixed(pct, 1) + "%" : "<0.1%"
    }
    static func barFraction(_ tok: Double, max: Double) -> Double { tok / (max > 0 ? max : 1) }

    // usageAgentRows
    static func agentRows(_ b: ByAgent?) -> [Share] {
        guard let b else { return [] }
        let listed = b.agents.filter { !($0.shown.isEmpty ? $0.name : $0.shown).isEmpty && $0.use.total > 0 }
        var seen: [String: Int] = [:]
        for a in listed { seen[a.shown.isEmpty ? a.name : a.shown, default: 0] += 1 }
        var rows = listed.map { a -> Share in
            let shown = a.shown.isEmpty ? a.name : a.shown
            let name = (seen[shown] ?? 0) > 1 && !a.name.isEmpty && a.name != shown ? shown + " (" + a.name + ")" : shown
            return Share(name: name, tok: a.use.total, muted: false)
        }
        rows.sort { $0.tok != $1.tok ? $0.tok > $1.tok : $0.name.localizedCompare($1.name) == .orderedAscending }
        if b.elsewhere.total > 0 { rows.append(Share(name: Words.elsewhere, tok: b.elsewhere.total, muted: true)) }
        if b.shared.total > 0 { rows.append(Share(name: Words.shared, tok: b.shared.total, muted: true)) }
        return rows
    }
    // usageAgentNote
    static func agentNote(_ b: ByAgent?) -> String {
        guard let b else { return "" }
        var out: [String] = []
        if b.rosterRead == false { out.append("We could not read the list of agents just now, so every session shows as not an agent.") }
        let tokens = { (n: Double) in abbr(n) + (n == 1 ? " token" : " tokens") }
        let gone = b.unattributed.total
        if gone > 0 { out.append(tokens(gone) + " in the totals above come from transcripts that have since been removed or can no longer be read, so they cannot be matched to an agent.") }
        let over = b.overcount.total
        if over > 0 { out.append("On some days the transcripts still here hold " + tokens(over) + " more than the totals saved for those days, so this table can add up to more than the totals above, by up to that much.") }
        return out.joined(separator: " ")
    }

    // USAGE_MODEL_PRICES ($ per million tokens), copied from the page; the logic suite compares the two entry by entry.
    struct Price: Equatable { var input, output, cacheWritten, cacheRead: Double }
    static let prices: [String: Price] = [
        "claude-opus-5-5": Price(input: 4, output: 20, cacheWritten: 5.00, cacheRead: 0.20),
        "claude-opus-5": Price(input: 5, output: 25, cacheWritten: 6.25, cacheRead: 0.50),
        "claude-opus-4-8": Price(input: 5, output: 25, cacheWritten: 6.25, cacheRead: 0.50),
        "claude-sonnet-5-5": Price(input: 2, output: 10, cacheWritten: 2.50, cacheRead: 0.10),
        "claude-sonnet-5": Price(input: 2, output: 10, cacheWritten: 2.50, cacheRead: 0.20),
        "claude-sonnet-4-6": Price(input: 3, output: 15, cacheWritten: 3.75, cacheRead: 0.30),
        "claude-haiku-5-5": Price(input: 0.10, output: 0.50, cacheWritten: 0.125, cacheRead: 0.01),
        "claude-haiku-4-5": Price(input: 1, output: 5, cacheWritten: 1.25, cacheRead: 0.10),
        "claude-fable-5-1": Price(input: 10, output: 50, cacheWritten: 12.50, cacheRead: 0.25),
        "claude-fable-5-2": Price(input: 8, output: 40, cacheWritten: 10, cacheRead: 0.20),
        "claude-fable-5": Price(input: 10, output: 50, cacheWritten: 12.50, cacheRead: 1.00),
        "gpt-5.1": Price(input: 1.25, output: 10, cacheWritten: 1.25, cacheRead: 0.125),
        "gemini-2.5-flash": Price(input: 0.375, output: 1.875, cacheWritten: 0.375, cacheRead: 0.0375),
        "gpt-5.6-sol": Price(input: 4, output: 20, cacheWritten: 5.00, cacheRead: 0.40),
        "gemini-3.8-flash": Price(input: 0.75, output: 3.75, cacheWritten: 0.75, cacheRead: 0.075),
        "grok-4.6": Price(input: 2, output: 6, cacheWritten: 2, cacheRead: 0.50),
    ]
    // usageModelPrice: the id, else the id without its -YYYYMMDD date stamp.
    static func price(_ model: String) -> Price? {
        if let p = prices[model] { return p }
        if let r = model.range(of: #"-\d{8}$"#, options: .regularExpression) { return prices[String(model[..<r.lowerBound])] }
        return nil
    }
    // usageApiCost: nil when nothing was priceable (the hero shows "-"), and the models with no price.
    static func apiCost(_ byDay: [String: [String: Bucket]]) -> (cost: Double?, unpriced: [String]) {
        var cost = 0.0, priced = 0
        var unpriced = Set<String>()
        // In the page's order (days, then models, as the JSON keys run; sorted here), so a fractional sum adds up the same.
        for day in byDay.keys.sorted() {
            let models = byDay[day] ?? [:]
            for m in models.keys.sorted() {
                let b = models[m]!
                guard let p = price(m) else { unpriced.insert(m); continue }
                cost += (b.input * p.input + b.output * p.output + b.cacheWritten * p.cacheWritten + b.cacheRead * p.cacheRead) / 1e6
                priced += 1
            }
        }
        return (priced > 0 ? cost : nil, unpriced.sorted())
    }

    // usageActiveDays: the engine's days on Kosmos, else the days that have any usage.
    static func activeDays(_ d: Data_) -> Int {
        if let n = d.daysOnKosmos, n.isFinite, n >= 1 { return Int(min(n, 1e9).rounded(.down)) }   // clamped: Int traps past 9.2e18
        return d.byDay.values.filter { $0.values.contains { $0.total > 0 } }.count
    }

    // usageHeroHtml's six figures.
    struct Hero: Equatable { var days: Int, tokens: String, value: String, hours: String, years: String, api: String }
    static func hero(_ t: Bucket, days: Int, api: Double?, locale: Locale = .current) -> Hero {
        let total = t.total
        let hours = total / tokensPerHour
        let value = hours * blendedRate
        let years = hours / hoursPerYear
        let valueStr = value >= 1e6 ? "$" + fixed(value / 1e6, 1) + "M" : tileSub1M(value, locale: locale)
        let apiStr = api.map { $0 >= 1e6 ? usd($0, locale: locale) : tileSub1M($0, locale: locale) } ?? "-"
        return Hero(days: max(0, days), tokens: bigTokens(total), value: valueStr, hours: abbr(jsRound(hours)),
                    years: String(format: "%.0f", jsRound(years / 10) * 10), api: apiStr)
    }

    // usageHistoryHtml's rows: newest day first, its models by name.
    struct HistoryRow: Equatable, Identifiable { var day: String, model: String, total: String, full: String, value: String; var id: String { day + "\u{1}" + model } }
    static func history(_ byDay: [String: [String: Bucket]], locale: Locale = .current) -> [HistoryRow] {
        byDay.keys.sorted(by: >).flatMap { day in
            (byDay[day] ?? [:]).keys.sorted().map { m in
                let t = byDay[day]![m]!.total
                return HistoryRow(day: day, model: m, total: abbr(t), full: grouped(t, locale: locale), value: rowValue(t, locale: locale))
            }
        }
    }

    // The counted-from sentence under the hint, with the unpriced models and the 30-day note.
    static let transcriptKeepDays = 30.0   // USAGE_TRANSCRIPT_KEEP_DAYS
    static func counted(roots: Int?, unpriced: [String], daysOnKosmos: Double?) -> String {
        var said = roots.map { "Counted from \($0)" + ($0 == 1 ? " place on this computer that holds" : " places on this computer that hold") + " transcripts." }
            ?? "Counted from the transcripts on this computer."
        if !unpriced.isEmpty {
            said += " The equivalent API cost leaves out \(unpriced.count)" + (unpriced.count == 1 ? " model" : " models")
                + " with no published price (" + unpriced.joined(separator: ", ") + ")."
        }
        if let d = daysOnKosmos, d > transcriptKeepDays {
            said += " Claude removes transcripts after about 30 days, so an older day counts only if Kosmos saved it in time."
        }
        return said
    }

    // MARK: The whole screen

    struct Shown: Equatable {
        var hero: Hero
        var models: [Share]
        var grand: Double
        var agents: [Share]
        var agentNote: String
        var history: [HistoryRow]
        var counted: String
    }
    enum Screen: Equatable { case shown(Shown), empty(String), failed }
    static func screen(status: Int, data: Data?, locale: Locale = .current) -> Screen {
        guard let d = read(status: status, data: data) else { return .failed }
        if d.byDay.isEmpty { return .empty(Words.none) }
        let rows = history(d.byDay, locale: locale)
        if rows.isEmpty { return .empty(Words.noneSince) }
        let t = totals(d.byDay)
        let api = apiCost(d.byDay)
        return .shown(Shown(hero: hero(t, days: activeDays(d), api: api.cost, locale: locale), models: byModel(d.byDay), grand: t.total,
                            agents: agentRows(d.byAgent), agentNote: agentNote(d.byAgent), history: rows,
                            counted: counted(roots: d.roots, unpriced: api.unpriced, daysOnKosmos: d.daysOnKosmos)))
    }

    // USAGE_MODEL_COLORS, by rank; past the palette, the muted "Other". Agents are one neutral ink (the view's).
    static let modelColors: [UInt32] = [0xb88920, 0x4171e3, 0x3fbf87, 0x41c2e3, 0x8a7fe0, 0xd97aa0, 0x8a8f98]
    static func modelColor(rank: Int) -> UInt32 { modelColors[min(rank, modelColors.count - 1)] }

    // MARK: The request

    // Its route on its own line, so server.ios-routes-6838.test.js can read it.
    static func request(_ mac: Settings.Mac) -> URLRequest {
        var r = URLRequest(url: URL(string: "/api/usage?days=all", relativeTo: mac.url)!.absoluteURL)
        r.cachePolicy = .reloadIgnoringLocalCacheData
        // The page's fetch has no limit, and says the first read after an update "can take a few" minutes. The board
        // sends nothing until its count is done, so this is the wait for that one answer.
        r.timeoutInterval = 600
        r.httpShouldHandleCookies = false
        r.setValue("\(Board.macCookieName)=\(mac.cookie)", forHTTPHeaderField: "Cookie")
        r.setValue("same-origin", forHTTPHeaderField: Board.fetchSiteHeader)
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        return r
    }

    // A sample build's computer: two days, two models, two agents.
    static let sample = #"{"daysOnKosmos":45,"rootsRead":["/Users/sam/.claude"],"byDay":{"2026-11-23":{"claude-opus-5-5":{"input_tokens":1200,"output_tokens":250000,"cache_creation_input_tokens":1250000,"cache_read_input_tokens":98000000}},"2026-11-24":{"claude-opus-5-5":{"input_tokens":300,"output_tokens":125000,"cache_creation_input_tokens":600000,"cache_read_input_tokens":41000000},"gpt-5.1":{"input_tokens":1000,"output_tokens":2000,"cache_creation_input_tokens":0,"cache_read_input_tokens":50000}}},"byAgent":{"rosterRead":true,"agents":[{"name":"dana","shown":"Dana","input_tokens":1500,"output_tokens":300000,"cache_creation_input_tokens":1500000,"cache_read_input_tokens":120000000},{"name":"eli","shown":"Eli","input_tokens":1000,"output_tokens":77000,"cache_creation_input_tokens":350000,"cache_read_input_tokens":19050000}]}}"#
}
