import SwiftUI
import Charts

// kosmos#8959 slice D1c2a: the computer's Token usage, native (the board's Settings > Token usage): the hero, the model
// table with its donut, the four daily charts, By agent, Usage history and the method note, every figure the page's own
// (UsageLogic.swift; the charts and donut are slice D1c2b). The UI test drives only the sample build's path.
struct UsageView: View {
    let mac: Settings.Mac?
    var sample = false
    var finding = false
    var signedOut = false

    @State private var screen: Usage.Screen?
    @State private var generation = 0
    @State private var reading = false   // the page's USAGE_BUSY: one count on the computer at a time
    @State private var shownURL: URL?

    var body: some View {
        List {
            if mac == nil && !sample {
                Section {
                    if finding {
                        HStack(spacing: 10) {
                            SweepDots(scales: false)
                            Text("Reaching your computer…").font(.footnote).foregroundColor(Palette.secondary)
                        }
                    } else {
                        Text(signedOut ? "Sign in to Kosmos+ first, then your computer's settings show here."
                             : "Open the Agents tab to connect to your computer, then its settings show here.")
                            .font(.subheadline).foregroundColor(Palette.secondary)
                    }
                }
            } else {
                Section {
                    Text(Usage.Words.hint).font(.footnote).foregroundColor(Palette.secondary)
                    switch screen {
                    case nil:
                        HStack(alignment: .top, spacing: 10) {
                            SweepDots(scales: false)
                            Text(Usage.Words.reading).font(.footnote).foregroundColor(Palette.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    case .failed?:
                        VStack(alignment: .leading, spacing: 8) {
                            Text(Usage.Words.failed).font(.subheadline).foregroundColor(Palette.secondary).accessibilityIdentifier("usage-msg")
                            Button("Try again") { Task { await load() } }
                        }
                    case .empty(let said)?:
                        Text(said).font(.subheadline).foregroundColor(Palette.secondary).accessibilityIdentifier("usage-msg")
                    case .shown(let s)?:
                        Text(s.counted).font(.footnote).foregroundColor(Palette.secondary).accessibilityIdentifier("usage-msg")
                    }
                } header: {
                    Text(Usage.Words.title)
                }
                if case .shown(let s)? = screen {
                    heroSection(s.hero)
                    if !s.charts.isEmpty { chartsSection(s.charts) }
                    shareSection(Usage.Words.model, rows: s.models, grand: s.grand, hint: nil, note: nil) { i, _ in Color(hex: Usage.modelColor(rank: i)) }
                    if let d = s.donut { donutSection(d) }
                    if !s.agents.isEmpty || !s.agentNote.isEmpty {
                        shareSection(Usage.Words.agent, rows: s.agents, grand: s.grand, title: Usage.Words.byAgent, hint: Usage.Words.byAgentHint,
                                     note: s.agentNote.isEmpty ? nil : s.agentNote) { _, r in
                            r.muted ? Color(hex: Usage.modelColors.last!) : Palette.secondary
                        }
                    }
                    historySection(s.history)
                    Section {
                        (Text(Usage.Words.methodLead)
                         + Text(.init("[\(Usage.Words.methodLink)](\(Usage.Words.methodURL.absoluteString))"))
                         + Text(Usage.Words.methodTail))
                            .font(.footnote).foregroundColor(Palette.secondary)
                            .accessibilityIdentifier("usage-method")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground.ignoresSafeArea())
        .navigationTitle(Usage.Words.title)
        .navigationBarTitleDisplayMode(.inline)
        .dotsRefresh { await load() }
        .task(id: mac?.url) {
            if shownURL != mac?.url { shownURL = mac?.url; screen = nil; generation += 1; reading = false }
            await load()
        }
    }

    // MARK: The parts

    private func heroSection(_ h: Usage.Hero) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(String(h.days)).font(.title2.weight(.bold).monospacedDigit()).foregroundColor(Palette.primary)
                    Text(Usage.Words.activeDays).font(.footnote).foregroundColor(Palette.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("usage-days")
                HStack(alignment: .center, spacing: 10) {
                    figure(h.tokens, Usage.Words.totalTokens, id: "usage-tokens")
                    Text("=").font(.title3).foregroundColor(Palette.secondary).accessibilityHidden(true)
                    figure(h.value, Usage.Words.humanCost, id: "usage-value")
                }
                // Side by side while they fit; stacked at the largest text sizes, so no figure is cut short.
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 10) { smallFigures(h) }
                    VStack(alignment: .leading, spacing: 10) { smallFigures(h) }
                }
            }
            .padding(.vertical, 6)
        }
    }

    @ViewBuilder private func smallFigures(_ h: Usage.Hero) -> some View {
        figure(h.hours, Usage.Words.workHours, small: true, id: "usage-hours")
        figure(h.years, Usage.Words.workYears, small: true, id: "usage-years")
        figure(h.api, Usage.Words.apiCost, small: true, id: "usage-api")
    }

    private func figure(_ value: String, _ label: String, small: Bool = false, id: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font((small ? Font.headline : Font.title2).weight(.bold).monospacedDigit()).foregroundColor(Palette.primary)
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.caption).foregroundColor(Palette.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id)
    }

    // usageCharts4Html: one area-and-line chart per class over the last 14 days, its name, tag, total and share.
    private func chartsSection(_ charts: [Usage.ClassChart]) -> some View {
        Section {
            ForEach(charts, id: \.kind) { c in
                let color = Color(hex: Usage.classColor(c.kind))
                VStack(alignment: .leading, spacing: 6) {
                    // One line while it fits; at large text sizes the total and share go under the name.
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            chartName(c)
                            Spacer(minLength: 8)
                            chartFigures(c)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            chartName(c)
                            chartFigures(c)
                        }
                    }
                    Chart {
                        ForEach(Array(c.values.enumerated()), id: \.offset) { i, v in
                            AreaMark(x: .value("Day", i), y: .value(c.name, v))
                                .foregroundStyle(LinearGradient(colors: [color.opacity(0.28), color.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                            LineMark(x: .value("Day", i), y: .value(c.name, v))
                                .foregroundStyle(color)
                                .lineStyle(StrokeStyle(lineWidth: 1.8, lineJoin: .round))
                            // One day draws no line or area: a point, so the box is not empty.
                            if c.values.count == 1 { PointMark(x: .value("Day", i), y: .value(c.name, v)).foregroundStyle(color) }
                        }
                    }
                    .chartXAxis(.hidden)
                    .chartYAxis(.hidden)
                    .chartYScale(domain: 0...max(1, c.values.max() ?? 1))
                    .frame(height: 64)
                    .accessibilityHidden(true)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(c.label + ". " + c.name + ", " + c.tag + ": " + c.total + ", " + c.share + " of all tokens.")
                .accessibilityIdentifier("usage-chart-" + c.kind.rawValue)
            }
        }
    }

    @ViewBuilder private func chartName(_ c: Usage.ClassChart) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(c.name).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary)
            Text(c.tag).font(.caption).foregroundColor(Palette.secondary)
        }
    }
    @ViewBuilder private func chartFigures(_ c: Usage.ClassChart) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(c.total).font(.subheadline.monospacedDigit()).foregroundColor(Palette.primary)
            Text(c.share).font(.caption.monospacedDigit()).foregroundColor(Palette.secondary)
        }
    }

    // usageDonutSvg: each model's share, clockwise from the top, the total in the middle, and its legend.
    private func donutSection(_ d: Usage.Donut) -> some View {
        Section {
            HStack(alignment: .center, spacing: 18) {
                ZStack {
                    ForEach(Array(d.slices.enumerated()), id: \.offset) { _, sl in
                        DonutArc(start: sl.start, end: sl.end)
                            .stroke(Color(hex: sl.color), style: StrokeStyle(lineWidth: DonutArc.ring, lineCap: .butt))
                    }
                    VStack(spacing: 1) {
                        Text(d.centre).font(.headline.weight(.bold).monospacedDigit()).foregroundColor(Palette.primary)
                        Text(Usage.Words.totalTokensSmall).font(.caption2).foregroundColor(Palette.secondary)
                    }
                    // Inside the hole at every text size.
                    .lineLimit(1).minimumScaleFactor(0.4)
                    .frame(width: 132 - 2 * DonutArc.ring - 8)
                }
                .frame(width: 132, height: 132)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(d.slices.enumerated()), id: \.offset) { _, sl in
                        HStack(spacing: 6) {
                            Circle().fill(Color(hex: sl.color)).frame(width: 8, height: 8).accessibilityHidden(true)
                            Text(sl.name).font(.caption).foregroundColor(Palette.primary).lineLimit(1).truncationMode(.middle)
                            Spacer(minLength: 4)
                            Text(sl.share).font(.caption.monospacedDigit()).foregroundColor(Palette.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Token share by model, " + d.centre + " total tokens")
            .accessibilityIdentifier("usage-donut")
        }
    }

    private func shareSection(_ label: String, rows: [Usage.Share], grand: Double, title: String? = nil, hint: String?, note: String?,
                              color: @escaping (Int, Usage.Share) -> Color) -> some View {
        let max = rows.map(\.tok).max() ?? 0
        return Section {
            if let hint { Text(hint).font(.footnote).foregroundColor(Palette.secondary) }
            ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Circle().fill(color(i, r)).frame(width: 9, height: 9).accessibilityHidden(true)
                        Text(r.name).font(.subheadline).foregroundColor(r.muted ? Palette.secondary : Palette.primary).lineLimit(2)
                        Spacer(minLength: 8)
                        Text(Usage.abbr(r.tok)).font(.subheadline.monospacedDigit()).foregroundColor(Palette.primary)
                        Text(Usage.percent(r.tok, of: grand)).font(.subheadline.monospacedDigit()).foregroundColor(Palette.secondary)
                            .frame(minWidth: 52, alignment: .trailing)
                    }
                    GeometryReader { g in
                        Capsule().fill(color(i, r)).frame(width: max > 0 ? g.size.width * Usage.barFraction(r.tok, max: max) : 0, height: 4)
                    }
                    .frame(height: 4)
                    .accessibilityHidden(true)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("usage-" + label.lowercased() + "-\(i)")
            }
            if let note { Text(note).font(.footnote).foregroundColor(Palette.secondary).accessibilityIdentifier("usage-agents-note") }
        } header: {
            Text(title ?? label)
        }
    }

    private func historySection(_ rows: [Usage.HistoryRow]) -> some View {
        Section {
            Text(Usage.Words.historyHint).font(.footnote).foregroundColor(Palette.secondary)
            ForEach(rows) { r in
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(r.day).font(.footnote.monospacedDigit()).foregroundColor(Palette.secondary)
                        Text(r.model).font(.subheadline).foregroundColor(Palette.primary).lineLimit(1).truncationMode(.middle)
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(r.total).font(.subheadline.monospacedDigit()).foregroundColor(Palette.primary)
                            .accessibilityLabel(r.full + " tokens")
                        Text(r.value).font(.footnote.monospacedDigit()).foregroundColor(Palette.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("usage-history-row")
            }
        } header: {
            Text(Usage.Words.history)
        }
    }

    // MARK: Reading

    private static let http = URLSession(configuration: .ephemeral, delegate: RefuseRedirects(), delegateQueue: nil)

    @MainActor private func load() async {
        await Task.yield()
        if sample {
            if screen == nil { screen = Usage.screen(status: 200, data: Data(Usage.sample.utf8)) }
            return
        }
        guard let mac, mac.url == shownURL, !reading else { return }
        reading = true
        generation += 1
        let started = generation
        defer { if started == generation { reading = false } }   // a superseded read leaves the newer one's flag alone
        var status = 0
        var data = Data()
        if let (d, response) = try? await Self.http.data(for: Usage.request(mac)), let answer = response as? HTTPURLResponse {
            status = answer.statusCode; data = d
        }
        guard started == generation, !Task.isCancelled else { return }
        // As the page: a read that fails clears the figures and says so.
        screen = Usage.screen(status: status, data: data)
    }
}

// One slice of the donut: an arc of the circle from `start` to `end` (fractions of a turn), clockwise from the top. A
// sliver is drawn at least 0.01 rad wide, as the page's.
private struct DonutArc: Shape {
    static let ring: CGFloat = 22   // the stroke's width; the arc sits half of it in, so the ring fits its frame
    var start: Double, end: Double
    func path(in rect: CGRect) -> Path {
        let r = min(rect.width, rect.height) / 2 - Self.ring / 2
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let a0 = -Double.pi / 2 + start * 2 * Double.pi
        let a1 = max(-Double.pi / 2 + end * 2 * Double.pi, a0 + 0.01)
        var p = Path()
        if end - start >= 1 { p.addEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)); return p }
        p.addArc(center: c, radius: r, startAngle: .radians(a0), endAngle: .radians(a1), clockwise: false)
        return p
    }
}

private extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }
}

// As Settings' own: a redirect is refused, so the computer's cookie can never be carried to another host.
private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
