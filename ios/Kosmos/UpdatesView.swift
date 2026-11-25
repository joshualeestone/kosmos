import SwiftUI

// kosmos#8959 slice D1c1: the computer's Updates, native (the board's Settings > Updates card): its version and channel,
// the card's sentence and its one button (Check for Update, Try again or Update), the install behind the page's
// confirm, then the wait the page's overlay does (the version read again every 2 s until it changes, or the
// installer's own word, or the deadline), and the automatic-updates switch where the page has it. The logic is
// UpdatesLogic.swift. The UI test drives only the sample build's path; the real requests are covered by the logic suite.
struct UpdatesView: View {
    let mac: Settings.Mac?
    var sample = false
    var finding = false
    var signedOut = false

    @State private var state: Updates.State?
    @State private var failed = false
    @State private var asked = false        // the page's UPD_ASKED: "Up to date" shows only once someone asked
    @State private var busy = false
    @State private var confirming = false
    @State private var note: String?        // a refused install, in the computer's words
    @State private var checkSaid: String?   // a check with no answer: the card's line says so, with Try again
    @State private var waitLead: String?    // while installing: "Updating." then "Still updating."
    @State private var settled: Updates.Settle?
    @State private var doneLine: String?
    @State private var auto: Updates.Auto?
    @State private var autoSaving = false
    @State private var autoPending: Bool?   // the value being saved, shown until the computer answers
    // The install and its wait, cancelled when the screen goes; a wait cut short that way resumes when it comes back.
    @State private var installing: Task<Void, Never>?
    @State private var resume: (before: Updates.State, myStart: String?, updating: String?, t0: Date, unanswered: Bool)?
    @State private var acting: UUID?   // the check or install that set busy; only it clears it
    @State private var autoActing: UUID?   // the switch save that set autoSaving; only it clears it
    @State private var autoEpoch = 0       // the page's AUTO_EPOCH: a read sent before a save never undoes it
    @State private var autoNote: String?
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
                cardSection
                if let s = state, Updates.autoShown(s) { autoSection(s) }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground.ignoresSafeArea())
        .navigationTitle(Updates.Words.title)
        .navigationBarTitleDisplayMode(.inline)
        .dotsRefresh { if waitLead == nil { await load() } }
        .task(id: mac?.url) {
            if shownURL != mac?.url {
                shownURL = mac?.url
                state = nil; failed = false; asked = false; busy = false; confirming = false; note = nil; checkSaid = nil
                waitLead = nil; settled = nil; doneLine = nil; auto = nil; autoSaving = false; autoPending = nil; autoNote = nil
                installing?.cancel(); installing = nil; acting = nil; resume = nil; autoActing = nil
                generation += 1
            }
            await load()
            // Only while this screen is still shown (load can return because the task was cancelled), and never two.
            if !Task.isCancelled, let r = resume, let mac, mac.url == shownURL {
                installing?.cancel()
                installing = Task {
                    if r.unanswered { await waitUnanswered(mac, before: r.before, t0: r.t0) }
                    else { await wait(mac, before: r.before, myStart: r.myStart, updating: r.updating, t0: r.t0) }
                }
            }
            // The page repaints from its 5 s poll; while the computer's first look is under way, ask again. Checked after
            // each sleep, so it never reads during a check, an install or its wait, and starts again after them. It asks
            // nothing while the look is done.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if !Task.isCancelled, resume == nil, waitLead == nil, !busy, state?.look?.looked == false { await load() }
            }
        }
        .onDisappear {
            // A wait that is cancelled takes its sentence with it.
            if waitLead != nil { note = nil }
            installing?.cancel(); installing = nil; waitLead = nil
        }
        .alert(Updates.Words.confirmTitle, isPresented: $confirming) {
            Button(Updates.Words.confirmNo, role: .cancel) {}
            Button(Updates.Words.confirmGo) { installing?.cancel(); installing = Task { await install() } }
        } message: {
            Text(state.map(Updates.confirmBody) ?? Updates.Words.confirmMac)
        }
    }

    // MARK: The card

    @ViewBuilder private var cardSection: some View {
        Section {
            if let s = state {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Kosmos " + (s.version ?? "")).font(.body.weight(.semibold)).foregroundColor(Palette.primary)
                        .accessibilityIdentifier("updates-version")
                    if s.channel == "staging" { Text(Updates.Words.staging).font(.footnote).foregroundColor(Palette.secondary) }
                }
                if let lead = waitLead {
                    HStack(spacing: 10) {
                        SweepDots(scales: false)
                        Text(lead).font(.subheadline).foregroundColor(Palette.primary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("updates-waiting")
                } else if let said = checkSaid {
                    Text(said).font(.subheadline).foregroundColor(Palette.primary).accessibilityIdentifier("updates-line")
                    Button(Updates.Words.tryAgain) { press(.check) }.disabled(busy).accessibilityIdentifier("updates-button")
                } else {
                    // How the last install ended, above the card, whose button stays (the page's Reload leads back
                    // to a fresh card; here the card is already fresh).
                    if let st = settled {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(st.lead).font(.subheadline.weight(.semibold)).foregroundColor(Palette.dangerWord)
                            if !st.rest.isEmpty { Text(st.rest).font(.footnote).foregroundColor(Palette.secondary).textSelection(.enabled) }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("updates-settled")
                    }
                    let c = Updates.card(s, asked: asked)
                    if let line = doneLine ?? (c.line.isEmpty ? nil : c.line) {
                        Text(line).font(.subheadline).foregroundColor(Palette.primary).accessibilityIdentifier("updates-line")
                    }
                    if let b = c.button {
                        Button(b) { press(c.act) }
                            .disabled(c.disabled || busy)
                            .accessibilityIdentifier("updates-button")
                    }
                }
            } else if failed {
                VStack(alignment: .leading, spacing: 8) {
                    Text(Updates.Words.listFailed).font(.subheadline).foregroundColor(Palette.secondary)
                    Button(Updates.Words.tryAgain) { Task { await load() } }
                }
            } else {
                HStack(spacing: 10) {
                    SweepDots(scales: false)
                    Text("Reaching your computer…").font(.footnote).foregroundColor(Palette.secondary)
                }
            }
        } header: {
            Text(Updates.Words.title)
        } footer: {
            if let note { Text(note).font(.footnote).foregroundColor(Palette.dangerWord).accessibilityIdentifier("updates-note") }
        }
    }

    private func autoSection(_ s: Updates.State) -> some View {
        Section {
            // No answer: no switch, as the page (paintSwitch(null) hides it: never a false Off). Only its sentence.
            if case .noAnswer? = auto {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Updates.Words.autoLabel).foregroundColor(Palette.primary)
                    Text(Updates.autoHint(s)).font(.footnote).foregroundColor(Palette.secondary)
                }
                .accessibilityElement(children: .combine)
            } else {
                Toggle(isOn: Binding(
                    get: { autoPending ?? (auto?.isOn ?? false) },
                    set: { on in Task { await saveAuto(on) } }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(Updates.Words.autoLabel).foregroundColor(Palette.primary)
                            if autoSaving || auto == nil { SweepDots(size: 16, label: "Loading", scales: false) }
                        }
                        Text(Updates.autoHint(s)).font(.footnote).foregroundColor(Palette.secondary)
                    }
                }
                .disabled(autoSaving || auto == nil)
                .accessibilityIdentifier("updates-auto")
            }
        } footer: {
            if let said = autoNote ?? auto?.said {
                Text(said).font(.footnote).foregroundColor(Palette.secondary).accessibilityIdentifier("updates-auto-note")
            }
        }
    }

    // MARK: Reading, checking and installing

    private static let http = URLSession(configuration: .ephemeral, delegate: RefuseRedirects(), delegateQueue: nil)

    private func send(_ request: URLRequest?) async -> (Int, Data) {
        guard let request else { return (0, Data()) }
        guard let (data, response) = try? await Self.http.data(for: request), let answer = response as? HTTPURLResponse
        else { return (0, Data()) }
        return (answer.statusCode, data)
    }

    @MainActor private func load() async {
        await Task.yield()
        if sample {
            if state == nil { state = Updates.state(status: 200, data: Data(Updates.sampleStatus.utf8)) }
            if auto == nil { auto = Updates.auto(status: 200, data: Data(Updates.sampleAuto.utf8), cloud: false) }
            return
        }
        guard let mac, mac.url == shownURL else { return }
        generation += 1
        let started = generation
        let (status, data) = await send(Updates.statusRequest(mac))
        guard started == generation, !Task.isCancelled else { return }
        if let s = Updates.state(status: status, data: data) { state = s; failed = false } else if state == nil { failed = true }
        if let s = state, Updates.autoShown(s) {
            autoEpoch += 1
            let mine = autoEpoch
            let (a, d) = await send(Updates.autoRequest(mac))
            guard started == generation, mine == autoEpoch else { return }
            auto = Updates.auto(status: a, data: d, cloud: s.cloud)
        }
    }

    private func press(_ act: Updates.Act) {
        note = nil; doneLine = nil; checkSaid = nil; settled = nil
        switch act {
        case .update: confirming = true
        case .check: Task { await check() }
        case .none: break
        }
    }

    @MainActor private func check() async {
        guard let shown = state, !busy else { return }
        asked = true
        if sample { state?.offer = nil; return }
        guard let mac else { return }
        busy = true
        let me = UUID(); acting = me
        defer { if acting == me { busy = false; acting = nil } }
        let sentTo = mac.url
        // The page's "Checking." while it asks.
        state?.look = Updates.Look(looked: false, reached: nil, readable: nil)
        let (status, data) = await send(Updates.checkRequest(mac))
        guard sentTo == shownURL else { return }
        // Over what is shown now (a pull to refresh may have landed meanwhile), not the snapshot from before.
        if let s = Updates.checked(state ?? shown, status: status, data: data) {
            state = s
        } else {
            if state?.look?.looked == false { state?.look = shown.look }
            checkSaid = Updates.checkFailed(status: status, data: data, version: shown.version)
        }
    }

    @MainActor private func install() async {
        guard let shown = state, !busy else { return }
        if sample { doneLine = Updates.Words.done(shown.offer ?? ""); state?.version = shown.offer; state?.offer = nil; return }
        guard let mac else { return }
        busy = true
        let me = UUID(); acting = me
        defer { if acting == me { busy = false; acting = nil } }
        let sentTo = mac.url
        let (status, data) = await send(Updates.installRequest(mac))
        guard sentTo == shownURL else { return }
        // Cancelled because the screen went: nothing is waited for and nothing is said. Whether the press reached the
        // computer cannot be told from here (round 5: judging it as unanswered on return says "not answering" and then
        // "press Update again" to a computer that answers fine). The screen comes back to a fresh card, and pressing
        // Update again is safe: the route joins an install already under way (the page's own "this joins it").
        if Task.isCancelled { return }
        switch Updates.started(status: status, data: data) {
        case .refused(let said):
            note = said
        case .already:
            await load()
            guard !Task.isCancelled else { return }   // a cut-short read would name the old version
            note = Updates.Words.already(state?.version)
        case .started(let myStart, let updating):
            await wait(mac, before: shown, myStart: myStart, updating: updating, t0: Date())
        case .unanswered:
            await waitUnanswered(mac, before: shown, t0: Date())
        }
    }

    // The page's overlay loop: read the status every 2 s and judge it as updateVerdict does.
    @MainActor private func wait(_ mac: Settings.Mac, before: Updates.State, myStart: String?, updating: String?, t0: Date) async {
        let windows = Updates.onWindows(before)
        waitLead = Updates.overlayLead(reached: true, version: updating, windows: windows)
        settled = nil
        resume = (before, myStart, updating, t0, false)
        var log = before.log
        while !Task.isCancelled, mac.url == shownURL {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled else { return }
            let (status, data) = await send(Updates.statusRequest(mac))
            guard mac.url == shownURL, !Task.isCancelled else { return }
            let now = Updates.state(status: status, data: data)
            if let l = now?.log { log = l }
            // Reached is any answer, as the page's ping.ok, even one whose body does not read.
            if windows { waitLead = Updates.overlayLead(reached: status == 200, version: updating, windows: true) }
            let v = Updates.verdict(elapsed: Date().timeIntervalSince(t0), reached: status == 200, before: before.version, now: now?.version,
                                    attempt: now?.attempt, myStart: myStart, bootBefore: before.bootedAt, bootNow: now?.bootedAt)
            switch v {
            case .waiting: continue
            case .slow: if !windows { waitLead = Updates.Words.stillUpdating }; continue   // Windows keeps its two-state lead
            case .done:
                waitLead = nil; resume = nil
                if let now { state = now; doneLine = Updates.Words.done(now.version ?? "") }
                return
            default:
                waitLead = nil; resume = nil
                if let now { state = now }
                settled = Updates.settle(v, now: now?.version, attempt: now?.attempt, log: now?.attempt?.log ?? log,
                                         windows: Updates.onWindows(before))
                return
            }
        }
        waitLead = nil
    }

    // waitForUnansweredPress: the press got no answer, so wait for the computer to answer rather than call it refused.
    @MainActor private func waitUnanswered(_ mac: Settings.Mac, before: Updates.State, t0: Date) async {
        note = Updates.notAnswering
        waitLead = Updates.Words.updating
        settled = nil
        resume = (before, nil, nil, t0, true)
        defer { if mac.url == shownURL { waitLead = nil } }
        while !Task.isCancelled, mac.url == shownURL {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled else { return }
            let (status, data) = await send(Updates.statusRequest(mac))
            guard mac.url == shownURL, !Task.isCancelled else { return }
            let now = Updates.state(status: status, data: data)
            let v = Updates.unanswered(elapsed: Date().timeIntervalSince(t0), reached: status == 200, before: before.version,
                                       now: now?.version, bootBefore: before.bootedAt, bootNow: now?.bootedAt)
            if v == .waiting { continue }
            resume = nil
            if let now { state = now }
            if v == .done { note = nil; doneLine = Updates.Words.done(now?.version ?? ""); return }
            note = Updates.unansweredSays(v, now: now?.version)
            return
        }
    }

    @MainActor private func saveAuto(_ on: Bool) async {
        guard !autoSaving, let s = state else { return }
        autoNote = nil
        if sample { auto = on ? .on : .off; return }
        guard let mac else { return }
        autoSaving = true
        autoPending = on
        autoEpoch += 1   // a read already out cannot land over this save
        let me = UUID(); autoActing = me
        // On the way out the epoch moves again, so a read that started during the save cannot land over it.
        defer { if autoActing == me { autoSaving = false; autoPending = nil; autoActing = nil; autoEpoch += 1 } }
        let sentTo = mac.url
        let (status, data) = await send(Updates.autoSaveRequest(mac, on: on))
        guard sentTo == shownURL, autoActing == me else { return }
        if status == 200 { auto = Updates.auto(status: status, data: data, cloud: s.cloud) }
        else { autoNote = Updates.autoRefused(status: status, data: data) }
    }
}

// As Settings' own: a redirect is refused, so the computer's cookie can never be carried to another host.
private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
