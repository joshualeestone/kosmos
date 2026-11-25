import Foundation
// Tests for the native Token usage screen's logic (kosmos#8959 slice D1c2a), compiled for macOS with the app files
// run-usage.sh lists. It prints every case and ends with one verdict line; a missing verdict means the run did not finish.
// The expected figures were computed by node from web/index.html's own usage functions on the fixture below
// (2026-11-25), so a figure that drifts from the page's arithmetic or its toFixed rounding fails here.
setvbuf(stdout, nil, _IOLBF, 0)
var passed = 0
var failed = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: Int = #line) {
    if cond() { passed += 1; print("  ok   \(name)") } else { failed += 1; print("  FAIL \(name) (line \(line))") }
}
func section(_ name: String) { print(name) }
let repo = URL(fileURLWithPath: ProcessInfo.processInfo.environment["KOSMOS_REPO"] ?? FileManager.default.currentDirectoryPath)
func repoText(_ path: String) -> String { (try? String(contentsOf: repo.appendingPathComponent(path), encoding: .utf8)) ?? "" }
let page = repoText("web/index.html")
check(page.count > 1_000_000, "the board page was read (\(page.count) characters)")
let U = Usage.self
let us = Locale(identifier: "en_US")
let fixture = #"{"daysOnKosmos":45,"rootsRead":["/a","/b"],"byDay":{"2026-11-23":{"claude-opus-5-5":{"input_tokens":1200,"output_tokens":250000,"cache_creation_input_tokens":1250000,"cache_read_input_tokens":98000000},"claude-haiku-4-5-20251001":{"input_tokens":500,"output_tokens":1500,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"2026-11-24":{"claude-opus-5-5":{"input_tokens":300,"output_tokens":125000,"cache_creation_input_tokens":600000,"cache_read_input_tokens":41000000},"mystery-model":{"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"gpt-5.1":{"input_tokens":1000,"output_tokens":2000,"cache_creation_input_tokens":0,"cache_read_input_tokens":50000}}},"byAgent":{"rosterRead":false,"agents":[{"name":"dana","shown":"Dana","input_tokens":100,"output_tokens":200000,"cache_creation_input_tokens":1000000,"cache_read_input_tokens":90000000},{"name":"dana2","shown":"Dana","input_tokens":0,"output_tokens":50000,"cache_creation_input_tokens":0,"cache_read_input_tokens":9000000},{"name":"eli","shown":"Eli","input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}],"elsewhere":{"input_tokens":1000,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"shared":{"input_tokens":0,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"unattributed":{"input_tokens":0,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"overcount":{"input_tokens":0,"output_tokens":2500,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}"#
let mac = Settings.Mac(name: "Studio Mac", url: URL(string: "https://studio.kosmosplus.com/")!, cookie: "c00kie")

section("the request")
let r = U.request(mac)
check(r.httpMethod == "GET" && r.url?.absoluteString == "https://studio.kosmosplus.com/api/usage?days=all", "GET /api/usage?days=all, as the page")
check(r.value(forHTTPHeaderField: "Cookie") == "__Host-kosmos_tunnel_session=c00kie" && r.httpShouldHandleCookies == false && r.value(forHTTPHeaderField: "Sec-Fetch-Site") == "same-origin", "the kept cookie by hand and the board's header")
check(r.timeoutInterval >= 600, "it waits for the count, as the page's fetch (no limit; \"the first time after an update it can take a few\")")
check(page.contains("const res = await fetch('/api/usage?days=all');"), "the page reads the same route")

section("toFixed and Math.round, as JavaScript")
check(U.fixed(1.25, 1) == "1.3" && U.fixed(9.95, 1) == "9.9" && U.fixed(12.5, 0) == "13" && U.fixed(1.005, 2) == "1.00" && U.fixed(9.995, 2) == "9.99", "ties go up; a binary 9.9499... goes down")
check(U.fixed(0, 2) == "0.00" && U.fixed(999.96, 1) == "1000.0" && U.fixed(0.04, 1) == "0.0" && U.fixed(99.5, 0) == "100", "carries and zeros")
check(U.jsRound(1234.5) == 1235 && U.jsRound(2.4) == 2 && U.jsRound(0) == 0, "Math.round")
check(U.grouped(1234567, locale: us) == "1,234,567" && U.grouped(0, locale: us) == "0", "toLocaleString's grouping (en-US)")

section("the formatters, against node on the page's own functions")
let abbrIn: [Double] = [0, 999, 1000, 1499, 1500, 999499, 999500, 999999, 1000000, 1250000, 1350000, 999949999, 999950000, 1e9, 1.25e9, 9.95e9, 9.94e9, 1e10, 1.5e10]
let abbrOut = ["0","999","1K","1K","2K","999K","1.0M","1.0M","1.0M","1.3M","1.4M","999.9M","1.0B","1.0B","1.3B","9.9B","9.9B","10B","15B"]
check(abbrIn.map(U.abbr) == abbrOut, "usageAbbr: \(abbrIn.map(U.abbr))")
let bigIn: [Double] = [999, 1250000, 1e9, 1.25e9, 1.5e10, 1.55e11]
check(bigIn.map(U.bigTokens) == ["999","1.3M","1.0B","1.3B","15.0B","155.0B"], "usageBigTokens: \(bigIn.map(U.bigTokens))")
let usdIn: [Double] = [0, 1.005, 9.995, 10, 12.5, 999.5, 1000, 1234.5, 999999.4, 1e6, 1.5e6, 2.5e6, 1e9, 1.234e9]
let usdOut = ["$0.00","$1.00","$9.99","$10","$13","$1000","$1,000","$1,235","$999,999","$1M","$2M","$3M","$1.00B","$1.23B"]
check(usdIn.map { U.usd($0, locale: us) } == usdOut, "usageUsd: \(usdIn.map { U.usd($0, locale: us) })")
let tileIn: [Double] = [0, 9.5, 999, 1000, 1152, 45000, 176332, 176450, 999949, 999950]
let tileOut = ["$0.00","$9.50","$999","$1K","$1.2K","$45K","$176.3K","$176.4K","$999.9K","$1.0M"]
check(tileIn.map { U.tileSub1M($0, locale: us) } == tileOut, "usageUsdTileSub1M: \(tileIn.map { U.tileSub1M($0, locale: us) })")
check([0, 100000, 1234567, 55555].map { U.rowValue($0, locale: us) } == ["$0.00","$90","$1,111","$50"], "usageRowValue")

section("the figures, on the fixture")
guard case .shown(let s) = U.screen(status: 200, data: Data(fixture.utf8), locale: us) else { check(false, "the fixture shows"); exit(1) }
let d = U.read(status: 200, data: Data(fixture.utf8))!
let t = U.totals(d.byDay)
check(t == Usage.Bucket(input: 3010, output: 378520, cacheWritten: 1850000, cacheRead: 139050000) && s.grand == 141281530, "usageTotals and usageGrandTotal")
check(abs((U.apiCost(d.byDay).cost ?? 0) - 44.5915) < 1e-9 && U.apiCost(d.byDay).unpriced == ["mystery-model"], "usageApiCost: the dated haiku id priced without its date, the unknown one left out")
check(s.hero == Usage.Hero(days: 45, tokens: "141.3M", value: "$127.2K", hours: "1K", years: "0", api: "$45"), "the hero's figures: \(s.hero)")
check(s.models.map(\.name) == ["claude-opus-5-5", "gpt-5.1", "claude-haiku-4-5-20251001", "mystery-model"] && s.models.map(\.tok) == [141226500, 53000, 2000, 30], "usageByModel, most first")
check(s.models.map { U.abbr($0.tok) } == ["141.2M", "53K", "2K", "30"] && s.models.map { U.percent($0.tok, of: s.grand) } == ["100.0%", "<0.1%", "<0.1%", "<0.1%"], "the model table's tokens and % total")
check(s.agents == [Usage.Share(name: "Dana (dana)", tok: 91200100, muted: false), Usage.Share(name: "Dana (dana2)", tok: 9050000, muted: false),
                   Usage.Share(name: "Sessions outside any agent's folder", tok: 1000, muted: true), Usage.Share(name: "Folders shared by more than one agent", tok: 1, muted: true)],
      "usageAgentRows: a shared shown name told apart, a zero agent left out, the two muted rows last")
check(s.agentNote == "We could not read the list of agents just now, so every session shows as not an agent. 1 token in the totals above come from transcripts that have since been removed or can no longer be read, so they cannot be matched to an agent. On some days the transcripts still here hold 3K tokens more than the totals saved for those days, so this table can add up to more than the totals above, by up to that much.", "usageAgentNote")
check(s.history.map { [$0.day, $0.model, $0.total, $0.value] } == [
    ["2026-11-24", "claude-opus-5-5", "41.7M", "$37,553"], ["2026-11-24", "gpt-5.1", "53K", "$48"], ["2026-11-24", "mystery-model", "30", "$0.03"],
    ["2026-11-23", "claude-haiku-4-5-20251001", "2K", "$1.80"], ["2026-11-23", "claude-opus-5-5", "99.5M", "$89,551"]], "usageHistoryHtml's rows, newest day first, models by name")
check(s.history[0].full == "41,725,300", "each row's full count, as its title")
check(s.counted == "Counted from 2 places on this computer that hold transcripts. The equivalent API cost leaves out 1 model with no published price (mystery-model). Claude removes transcripts after about 30 days, so an older day counts only if Kosmos saved it in time.", "the counted-from sentence")

section("the edges")
check(U.screen(status: 200, data: Data(#"{"byDay":{}}"#.utf8)) == .empty(Usage.Words.none), "no days: no usage yet")
check(U.screen(status: 200, data: Data(#"{"byDay":{"2026-11-24":{}}}"#.utf8)) == .empty(Usage.Words.noneSince), "days with no model rows: none since installed")
check(U.screen(status: 500, data: Data("{}".utf8)) == .failed && U.screen(status: 200, data: Data("<html>".utf8)) == .failed, "a refusal or a page that is not JSON: could not read")
check(U.counted(roots: 1, unpriced: ["a", "b"], daysOnKosmos: 10) == "Counted from 1 place on this computer that holds transcripts. The equivalent API cost leaves out 2 models with no published price (a, b).", "one place, two models, no 30-day note")
check(U.counted(roots: nil, unpriced: [], daysOnKosmos: 30) == "Counted from the transcripts on this computer.", "an older engine with no roots; 30 days exactly is not past 30")
check(U.hero(Usage.Bucket(), days: 3, api: nil, locale: us).api == "-", "nothing priceable: a dash, not a zero")
check(U.activeDays(Usage.Data_(byDay: ["a": ["m": Usage.Bucket(output: 1)], "b": ["m": Usage.Bucket()]], byAgent: nil, daysOnKosmos: nil, roots: nil)) == 1, "no daysOnKosmos: the days with any usage")
check(U.agentRows(nil).isEmpty && U.agentNote(nil) == "", "no byAgent: no block")
check(U.modelColor(rank: 0) == 0xb88920 && U.modelColor(rank: 40) == 0x8a8f98, "colors by rank, past the palette the muted Other")
check(page.contains("const USAGE_MODEL_COLORS = ['#b88920', '#4171e3', '#3fbf87', '#41c2e3', '#8a7fe0', '#d97aa0', '#8a8f98'];"), "the page's palette")

section("the price table is the page's, entry by entry")
let block = page.range(of: "const USAGE_MODEL_PRICES = {").flatMap { a in page.range(of: "};", range: a.upperBound..<page.endIndex).map { String(page[a.upperBound..<$0.lowerBound]) } } ?? ""
let re = try! NSRegularExpression(pattern: #"'([^']+)': \{ in: ([0-9.]+), out: ([0-9.]+), cw: ([0-9.]+), cr: ([0-9.]+) \}"#)
var pagePrices: [String: Usage.Price] = [:]
for m in re.matches(in: block, range: NSRange(block.startIndex..., in: block)) {
    let g = { (i: Int) in String(block[Range(m.range(at: i), in: block)!]) }
    pagePrices[g(1)] = Usage.Price(input: Double(g(2))!, output: Double(g(3))!, cacheWritten: Double(g(4))!, cacheRead: Double(g(5))!)
}
check(pagePrices.count >= 10 && pagePrices.count == block.components(separatedBy: "': { in:").count - 1, "every row of the page's table was read (\(pagePrices.count))")
check(pagePrices == U.prices, "the phone's table equals the page's: missing \(Set(pagePrices.keys).subtracting(U.prices.keys).sorted()), extra \(Set(U.prices.keys).subtracting(pagePrices.keys).sorted())")

section("the words are the board page's own")
let W = Usage.Words.self
for w in W.hintPieces + [W.reading, W.none, W.noneSince, W.failed, W.activeDays, W.totalTokens, W.humanCost, W.workHours, W.workYears, W.apiCost,
          W.byAgentHint, W.elsewhere, W.shared, W.historyHint, W.methodLead.trimmingCharacters(in: .whitespaces), W.methodTail.trimmingCharacters(in: .whitespaces)] {
    check(page.replacingOccurrences(of: "\\'", with: "'").contains(w), "on the page: \(w.prefix(56))")
}
check(page.contains("<h4>By agent</h4>") && page.contains("<h4>Usage history</h4>") && page.contains("<a href=\"https://metr.org/time-horizons/\" target=\"_blank\" rel=\"noopener\">METR's research</a>"), "the headings and the method's link")
check(page.contains("<div>Day</div><div>Model</div><div class=\"uh-n\">Total tokens</div><div class=\"uh-n\">Value</div>") && page.contains("'<div class=\"tv-mrow head\"><div>' + esc(label) + '</div><div>Share</div><div class=\"tv-num\">Tokens</div><div class=\"tv-num\">% total</div></div>'"), "the column heads")
check(page.contains("const USAGE_VALUE_TOKENS_PER_HOUR = 100000;") && page.contains("const USAGE_VALUE_BLENDED_RATE = 90;") && page.contains("const USAGE_VALUE_HOURS_PER_YEAR = 2080;") && page.contains("const USAGE_TRANSCRIPT_KEEP_DAYS = 30;"), "the page's constants")

print("")
print(failed == 0 ? "VERDICT: PASS \(passed)/\(passed + failed)" : "VERDICT: FAIL \(failed) of \(passed + failed)")
exit(failed == 0 ? 0 : 1)
