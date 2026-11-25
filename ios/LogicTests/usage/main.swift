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
let fixture = repoText("ios/LogicTests/usage/fixture.json")
// The figures the page computes for the fixture and the formatters' inputs, checked against the page itself by
// web.usage-ios-parity-8959.test.js: so the phone and the page meet at this one file.
let expected = (try? JSONSerialization.jsonObject(with: Data(repoText("ios/LogicTests/usage/expected.json").utf8))) as? [String: Any] ?? [:]
check(fixture.count > 500 && expected.count >= 9, "the fixture and expected.json were read")
let inputs = expected["inputs"] as? [String: [Double]] ?? [:]
let outs = expected["formatters"] as? [String: [String]] ?? [:]
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

section("the formatters, against the page's own (expected.json)")
for (key, f) in [("abbr", { U.abbr($0) }), ("big", { U.bigTokens($0) }), ("usd", { U.usd($0, locale: us) }), ("tile", { U.tileSub1M($0, locale: us) }),
                 ("rowValue", { U.rowValue($0, locale: us) })] as [(String, (Double) -> String)] {
    let ins = inputs[key] ?? [], want = outs[key] ?? []
    check(!ins.isEmpty && ins.map(f) == want, "\(key): \(ins.map(f)) vs the page's \(want)")
}

section("the figures, on the fixture")
guard case .shown(let s) = U.screen(status: 200, data: Data(fixture.utf8), locale: us) else { check(false, "the fixture shows"); exit(1) }
let d = U.read(status: 200, data: Data(fixture.utf8))!
let t = U.totals(d.byDay)
check(t.total == (expected["grand"] as? NSNumber)?.doubleValue && t.cacheRead > t.output, "usageTotals: the four classes add to the page's grand total")
check(U.price("claude-haiku-4-5-20251001") == U.price("claude-haiku-4-5") && U.price("claude-haiku-4-5") != nil && U.price("mystery-model") == nil, "a dated id is priced without its date; an unknown one is not")
let h = s.hero
check([String(h.days), h.tokens, h.value, h.hours, h.years, h.api] == (expected["hero"] as? [String] ?? []), "the hero's six figures: \(h)")
check(s.models.map { [$0.name, $0.tok] as [AnyHashable] } == ((expected["models"] as? [[Any]]) ?? []).map { [$0[0] as! String, ($0[1] as! NSNumber).doubleValue] as [AnyHashable] }, "usageByModel, most first")
check(s.models.flatMap { [U.abbr($0.tok), U.percent($0.tok, of: s.grand)] } == (expected["modelCells"] as? [String] ?? []), "the model table's tokens and % total")
check(s.grand == (expected["grand"] as? NSNumber)?.doubleValue, "the grand total")
check(abs((U.apiCost(d.byDay).cost ?? -1) - ((expected["apiCost"] as? NSNumber)?.doubleValue ?? 0)) < 1e-9 && U.apiCost(d.byDay).unpriced == (expected["unpriced"] as? [String] ?? ["x"]), "usageApiCost and the unpriced models")
check(s.agents.map { [$0.name, $0.tok, $0.muted] as [AnyHashable] } == ((expected["agents"] as? [[Any]]) ?? []).map { [$0[0] as! String, ($0[1] as! NSNumber).doubleValue, $0[2] as! Bool] as [AnyHashable] },
      "usageAgentRows: \(s.agents.map(\.name))")
check(s.agentNote == expected["agentNote"] as? String, "usageAgentNote")
check(s.history.map { [$0.day, $0.model, $0.total, $0.value] } == (expected["history"] as? [[String]] ?? []), "usageHistoryHtml's rows")
check(s.history[0].full == "41,725,300", "each row's full count, as its title")
check(s.counted == "Counted from 2 places on this computer that hold transcripts. The equivalent API cost leaves out 1 model with no published price (mystery-model). Claude removes transcripts after about 30 days, so an older day counts only if Kosmos saved it in time.", "the counted-from sentence")

check(page.contains("? 'Counted from the transcripts on this computer.'") && page.contains(": 'Counted from ' + roots + (roots === 1 ? ' place on this computer that holds' : ' places on this computer that hold') + ' transcripts.';")
      && page.contains("said += ' The equivalent API cost leaves out '") && page.contains("+ ' with no published price (' + api.unpriced.join(', ') + ').';")
      && page.contains("said += ' Claude removes transcripts after about ' + USAGE_TRANSCRIPT_KEEP_DAYS + ' days, so an older day counts only if Kosmos saved it in time.';"),
      "the counted-from sentence's pieces are still the page's")

section("the charts and the donut (D1c2b), against the page's own (expected.json)")
let series = (expected["chartSeries"] as? [[Any]]) ?? []
check(!series.isEmpty && U.dailySeries(d.byDay).suffix(U.chartDays).map { [$0.day as AnyHashable, $0.use.input, $0.use.output, $0.use.cacheWritten, $0.use.cacheRead] }
      == series.map { [$0[0] as! String as AnyHashable] + $0.dropFirst().map { ($0 as! NSNumber).doubleValue as AnyHashable } }, "usageDailySeries and usageChartDays")
check(s.charts.map { [$0.name, $0.tag, $0.total, $0.share, $0.label] } == ((expected["charts"] as? [[String]]) ?? []), "usageCharts4Html's headers and labels: \(s.charts.map(\.share))")
check(s.charts.map(\.values) == Usage.Class.allCases.map { c in U.dailySeries(d.byDay).suffix(U.chartDays).map { U.value($0.use, c) } } && s.charts.allSatisfy { $0.values.count == series.count }, "each chart plots its class per day")
check([s.donut?.centre ?? "", U.Words.totalTokensSmall] == ((expected["donutCentre"] as? [String]) ?? []), "the donut's centre")
let hex = { (c: UInt32) in String(format: "#%06x", c) }
check((s.donut?.slices ?? []).map { [hex($0.color), $0.name, $0.share] } == ((expected["donut"] as? [[String]]) ?? []), "the donut's legend: \((s.donut?.slices ?? []).map(\.name))")
let sl = s.donut?.slices ?? []
check(sl.first?.start == 0 && abs((sl.last?.end ?? 0) - 1) < 1e-9 && zip(sl, sl.dropFirst()).allSatisfy { $0.end == $1.start }, "the slices run round the whole circle, end to end")
check(U.classShare(1, of: 100) == "1.0%" && U.classShare(0.5, of: 100) == "0.50%" && U.classShare(0.05, of: 100) == "<0.1%" && U.classShare(5, of: 0) == "500.0%", "the class share's three bands (and the page's total || 1)")
check(U.chartDays == 14 && d.byDay.count > 14 && series.count == 14 && s.charts.allSatisfy { $0.values.count == 14 && $0.label.hasSuffix("last 14 days") },
      "the window: the fixture's \(d.byDay.count) days cut to the last 14, as the page's USAGE_CHART_DAYS")
let one = U.donut([Usage.Share(name: "solo", tok: 5, muted: false)], grand: 5)
check(one?.slices.count == 1 && one?.slices.first?.share == "100%" && one?.slices.first?.start == 0 && one?.slices.first?.end == 1 && one?.centre == "5", "a single model is the whole circle, 100%")
check(U.donut([], grand: 0) == nil && U.charts([:], totals: Usage.Bucket(), grand: 0).isEmpty, "nothing to draw: no chart, no donut")
check(page.contains("{ key: 'cacheRead', color: '#d6a62e', label: 'Cache read' }") && page.contains("{ key: 'cacheWritten', color: '#6fd3a0', label: 'Cache written' }")
      && page.contains("{ key: 'input', color: '#8ab4ff', label: 'Input' }") && page.contains("{ key: 'output', color: '#c78cff', label: 'Output' }")
      && Usage.Class.allCases.map { hex(U.classColor($0)) } == ["#d6a62e", "#6fd3a0", "#c78cff", "#8ab4ff"], "USAGE_CLASS_COLORS")
check(page.contains("const USAGE_CHART_DAYS = 14;") && page.contains("'<text x=\"100\" y=\"113\" text-anchor=\"middle\" style=\"font-size:10px;fill:var(--k-ink-2)\">total tokens</text></svg>'"), "14 days, and the centre's words")

section("the edges")
check(U.abbr(-1e19) == "-10000000000000000000" && U.activeDays(Usage.Data_(byDay: [:], byAgent: nil, daysOnKosmos: 1e20, roots: nil)) == 1_000_000_000
      && U.hero(Usage.Bucket(output: 1e30), days: 1, api: nil, locale: us).years.count > 20, "a malformed huge count draws a figure, never stops the app")
check(U.fixed(-0.004, 2) == "-0.00" && U.fixed(-0.0, 2) == "0.00" && U.jsRound(0.49999999999999994) == 0 && U.jsRound(4503599627370497) == 4503599627370497, "JavaScript's negative zero and an exact Math.round")
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
