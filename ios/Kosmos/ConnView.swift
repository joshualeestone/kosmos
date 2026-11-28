import SwiftUI

// kosmos#8959 slice D2b1: the computer's Connections, native and read only (the board's Settings > Connections): one
// row per service in the board's order, its name and what is SAVED on the computer, and one footer saying connecting,
// checking and removing are on the computer. It reads GET /api/connections/held (the disk only), never the live sweep,
// which bills the person's search quota: on open and on a pull only. The logic is ConnLogic.swift; the UI test drives
// only the sample build's path.
struct ConnView: View {
    let mac: Settings.Mac?
    var sample = false
    var finding = false
    var signedOut = false

    private enum Load: Equatable { case reading, got([Conn.Service]), failed(String) }

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
            } else if sample || shownURL == mac?.url {
                accountSections
            } else {
                // Review 2: for the frame between a computer switch and .task starting over, never the old computer's rows.
                Section { Text(Conn.Words.reading).font(.subheadline).foregroundColor(Palette.secondary) }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground.ignoresSafeArea())
        .navigationTitle(Conn.Words.title)
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
                Text(Conn.Words.reading).font(.subheadline).foregroundColor(Palette.secondary)
            }
        case .failed(let why):
            Section {
                Text(why).font(.subheadline).foregroundColor(Palette.secondary)
            } footer: { footer }
        case .got(let rows) where rows.isEmpty:
            Section {
                Text(Conn.Words.empty).font(.subheadline).foregroundColor(Palette.secondary)
            } footer: { footer }
        case .got(let rows):
            Section {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, s in serviceRow(s) }
            } footer: { footer }
        }
    }

    private var footer: some View {
        Text(Conn.Words.footer).font(.footnote).foregroundColor(Palette.secondary)
    }

    private func serviceRow(_ s: Conn.Service) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(s.name).foregroundColor(Palette.primary)
            Text(s.line).font(.footnote).foregroundColor(Palette.secondary)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(s.name + ", " + s.line)
        .accessibilityIdentifier("conn-service")
    }

    // MARK: Reading

    private static let http = URLSession(configuration: .ephemeral, delegate: ConnRefuseRedirects(), delegateQueue: nil)

    @MainActor private func read() async {
        await Task.yield()
        if sample {
            if case .got = load {} else if case .got(let s) = Conn.read(status: 200, data: Data(Conn.sampleList.utf8)) { load = .got(s) }
            return
        }
        guard let mac, mac.url == shownURL else { return }
        generation += 1
        let started = generation
        if case .got = load {} else { load = .reading }
        let answer = try? await Self.http.data(for: Conn.request(mac))
        guard started == generation else { return }
        if Task.isCancelled {
            if case .reading = load { load = .failed(Conn.Words.failed) }
            return
        }
        let status = (answer?.1 as? HTTPURLResponse)?.statusCode ?? 0
        switch Conn.read(status: status, data: answer?.0 ?? Data()) {
        case .got(let rows): load = .got(rows)
        case .failed(let why): load = .failed(why)
        }
    }
}

private final class ConnRefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
