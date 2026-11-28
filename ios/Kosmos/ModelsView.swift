import SwiftUI

// kosmos#8959 slice D2a: the computer's AI Models, native and read only (the board's Settings > AI Models): one row per
// account, grouped by provider, with the page's pill in its words and colour, and one footer saying that checking,
// signing in and changing an account are on the computer. GET /api/accounts checks each account live, and its rule is
// that every caller is a person pressing something, never a timer: so the screen reads on open and on a pull only.
// The logic is ModelsLogic.swift; the UI test drives only the sample build's path.
struct ModelsView: View {
    let mac: Settings.Mac?
    var sample = false
    var finding = false
    var signedOut = false

    private enum Load: Equatable { case reading, got([Models.Account]), failed(String) }

    @State private var load: Load = .reading
    // Bumped by every read, so an older answer never paints over a newer one; and the computer the list came from,
    // so another computer starts the screen over.
    @State private var generation = 0
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
                accountSections
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground.ignoresSafeArea())
        .navigationTitle(Models.Words.title)
        .navigationBarTitleDisplayMode(.inline)
        .dotsRefresh { await read() }
        .task(id: mac?.url) {
            if shownURL != mac?.url {
                shownURL = mac?.url
                load = .reading
                generation += 1
            }
            await read()
        }
    }

    @ViewBuilder private var accountSections: some View {
        switch load {
        case .reading:
            Section {
                Text(Models.Words.reading).font(.subheadline).foregroundColor(Palette.secondary)
            }
        case .failed(let why):
            Section {
                Text(why).font(.subheadline).foregroundColor(Palette.secondary)   // the page's neutral hint (review 1)
            } footer: { footer }
        case .got(let rows) where rows.isEmpty:
            Section {
                Text(Models.Words.empty).font(.subheadline).foregroundColor(Palette.secondary)
            } footer: { footer }
        case .got(let rows):
            let groups = Models.groups(rows)
            ForEach(Array(groups.enumerated()), id: \.offset) { i, g in
                Section {
                    ForEach(Array(g.rows.enumerated()), id: \.offset) { _, a in accountRow(a) }
                } header: {
                    Text(g.label).textCase(nil)   // the provider's name as written (review 1)
                } footer: {
                    if i == groups.count - 1 { footer }
                }
            }
        }
    }

    private var footer: some View {
        Text(Models.Words.footer).font(.footnote).foregroundColor(Palette.secondary)
    }

    private func accountRow(_ a: Models.Account) -> some View {
        let pill = Models.pill(a)
        let name = Models.name(a)
        return VStack(alignment: .leading, spacing: 4) {
            Text(name).foregroundColor(Palette.primary)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Circle().fill(Self.colour(pill.tone)).frame(width: 7, height: 7).accessibilityHidden(true)
                Text(pill.words).font(.footnote).foregroundColor(Palette.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name + ", " + pill.words)
        .accessibilityIdentifier("models-account")
    }

    // The page's dot colours: green when working, amber when signed in but not confirmed, red when not connected, grey
    // for a login read from the computer's disk and for could-not-check.
    private static func colour(_ tone: Models.Tone) -> Color {
        switch tone {
        case .connected: return Palette.ringOk
        // Review 1: the page draws a login read from disk in the calm grey (ruling C), never the working green (#874).
        case .loginok: return Palette.secondary
        case .unverified: return Palette.ringWarn
        case .none: return Palette.dangerWord
        case .unknown: return Palette.secondary
        }
    }

    // MARK: Reading

    private static let http = URLSession(configuration: .ephemeral, delegate: ModelsRefuseRedirects(), delegateQueue: nil)

    @MainActor private func read() async {
        await Task.yield()
        if sample {
            if case .got = load {} else { load = .got(NewAgentPicker.parseAccounts(Data(Models.sampleList.utf8)) ?? []) }
            return
        }
        guard let mac, mac.url == shownURL else { return }
        generation += 1
        let started = generation
        if case .got = load {} else { load = .reading }
        let answer = try? await Self.http.data(for: Models.request(mac))
        guard started == generation else { return }
        if Task.isCancelled {
            if case .reading = load { load = .failed(Models.Words.failed) }
            return
        }
        let status = (answer?.1 as? HTTPURLResponse)?.statusCode ?? 0
        switch Models.read(status: status, data: answer?.0 ?? Data()) {
        case .got(let rows): load = .got(rows)
        case .failed(let why): load = .failed(why)
        }
    }
}

private final class ModelsRefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
