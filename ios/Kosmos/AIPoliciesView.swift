import SwiftUI

// kosmos#8959 slice D1b2: the computer's AI policies, native (the board's Settings > AI policies): the company's policy
// first and read only, then each policy with Rename, Replace its words and a Remove that asks once, and the add form,
// which a confirm stands in front of, as on the page: handing words to every agent is a fleet-wide act. After every
// change the page's sentence says who was told, and the list is read again. The logic is AIPoliciesLogic.swift. The UI
// test drives only the sample build's path; the real requests and answers are covered by the logic suite.
struct AIPoliciesView: View {
    let mac: Settings.Mac?
    var sample = false
    var finding = false
    var signedOut = false

    @State private var read: AIPolicies.Read?
    @State private var note: (text: String, problem: Bool)?
    @State private var busy = false
    @State private var armed: String?
    // The add form: a new policy, or the words of one being replaced (the page's POL_EDIT).
    @State private var replacing: AIPolicies.Policy?
    @State private var name = ""
    @State private var link = ""
    @State private var words = ""
    @State private var confirm: (title: String, body: [String: String], doing: String)?
    @State private var renaming: AIPolicies.Policy?
    @State private var newName = ""
    @State private var generation = 0
    @State private var shownURL: URL?
    private enum Field: Hashable { case name, link, words }
    @FocusState private var focused: Field?
    @Environment(\.scenePhase) private var scenePhase

    private static let day: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .short
        f.timeStyle = .none
        return f
    }()

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
                listSection
                addSection
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground.ignoresSafeArea())
        .navigationTitle(AIPolicies.Words.title)
        .navigationBarTitleDisplayMode(.inline)
        .dotsRefresh { await load() }
        .task(id: mac?.url) {
            if shownURL != mac?.url {
                shownURL = mac?.url
                read = nil; note = nil; busy = false; armed = nil; replacing = nil; confirm = nil; renaming = nil
                generation += 1
            }
            await load()
        }
        .onDisappear { armed = nil }
        .onChange(of: focused) { f in if f != nil { armed = nil } }
        .onChange(of: scenePhase) { p in if p != .active { armed = nil } }
        .onChange(of: name) { v in armed = nil; if v.utf16.count > AIPolicies.nameMax { name = GlobalSkills.clipped(v, utf16: AIPolicies.nameMax) } }
        .onChange(of: link) { v in armed = nil; if v.utf16.count > AIPolicies.linkMax { link = GlobalSkills.clipped(v, utf16: AIPolicies.linkMax) } }
        .onChange(of: words) { v in armed = nil; if v.utf16.count > AIPolicies.textMax { words = GlobalSkills.clipped(v, utf16: AIPolicies.textMax) } }
        .onChange(of: newName) { v in if v.utf16.count > AIPolicies.nameMax { newName = GlobalSkills.clipped(v, utf16: AIPolicies.nameMax) } }
        .alert(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } })) {
            Button(AIPolicies.Words.confirmNo, role: .cancel) { confirm = nil }
            Button(AIPolicies.Words.confirmGo) {
                if let c = confirm { confirm = nil; Task { await save(c.body, doing: c.doing) } }
            }
        } message: {
            Text(AIPolicies.Words.confirmSmall)
        }
        .alert(AIPolicies.Words.rename, isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField(AIPolicies.Words.namePlaceholder, text: $newName)
                .accessibilityLabel(renaming.map { "New name for " + $0.name } ?? "")
            Button(AIPolicies.Words.leave, role: .cancel) { renaming = nil }
            Button(AIPolicies.Words.keep) {
                if let p = renaming { renaming = nil; Task { await rename(p, to: newName) } }
            }
        }
    }

    // MARK: The list

    @ViewBuilder private var listSection: some View {
        Section {
            switch read {
            case nil:
                HStack(spacing: 10) {
                    SweepDots(scales: false)
                    Text("Reaching your computer…").font(.footnote).foregroundColor(Palette.secondary)
                }
            case .failed(let why)?:
                VStack(alignment: .leading, spacing: 8) {
                    Text(why).font(.subheadline).foregroundColor(Palette.secondary)
                    Button("Try again") { Task { await load() } }
                }
            case let r?:
                if let lead = AIPolicies.lead(r) { Text(lead).font(.subheadline).foregroundColor(Palette.secondary) }
                if let c = company(r) { companyCard(c) }
                if case .saved(let list, _) = r { ForEach(list) { card($0) } }
            }
        } header: {
            Text(AIPolicies.Words.title)
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if let note { Text(note.text).foregroundColor(note.problem ? Palette.dangerWord : Palette.secondary) }
                Text(AIPolicies.Words.hint).foregroundColor(Palette.secondary)
            }
            .font(.footnote)
        }
    }

    private func company(_ r: AIPolicies.Read) -> AIPolicies.Company? {
        switch r {
        case .saved(_, let c), .none(let c), .unread(_, let c): return c
        case .failed: return nil
        }
    }

    private func companyCard(_ c: AIPolicies.Company) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(c.name).font(.body.weight(.semibold)).foregroundColor(Palette.primary)
            Text(AIPolicies.orgWords(AIPolicies.Words.companyFrom, family: c.family)).font(.footnote).foregroundColor(Palette.secondary)
            Text(AIPolicies.opening(c.opening, chars: c.chars)).font(.footnote).foregroundColor(Palette.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func card(_ p: AIPolicies.Policy) -> some View {
        let isArmed = armed == p.id
        return VStack(alignment: .leading, spacing: 6) {
            Text(p.name).font(.body.weight(.semibold)).foregroundColor(Palette.primary)
            Text(AIPolicies.from(p) { Self.day.string(from: $0) }).font(.footnote).foregroundColor(Palette.secondary)
            Text(AIPolicies.opening(p.opening, chars: p.chars)).font(.footnote).foregroundColor(Palette.secondary)
            HStack(spacing: 16) {
                Button(AIPolicies.Words.rename) { armed = nil; newName = p.name; renaming = p }
                    .accessibilityLabel("Rename the policy " + p.name)
                Button(AIPolicies.Words.replace) { armed = nil; startReplacing(p) }
                    .accessibilityLabel("Replace the words of the policy " + p.name)
                Spacer()
                Button {
                    if isArmed { Task { await remove(p) } } else { focused = nil; armed = p.id }
                } label: {
                    Text(isArmed ? AIPolicies.Words.removeArmed : AIPolicies.Words.remove)
                        .fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.trailing)
                        .frame(minHeight: 44).contentShape(Rectangle())
                }
                .foregroundColor(isArmed ? Palette.dangerWord : Palette.primary)
                .accessibilityLabel(isArmed ? AIPolicies.Words.removeArmed : "Remove the policy " + p.name)
                .accessibilityIdentifier("policy-remove-" + p.id)
            }
            // Only each button itself, never the whole row (a list row is otherwise one tap).
            .buttonStyle(.borderless)
            .disabled(busy)
        }
        .padding(.vertical, 4)
    }

    // MARK: Adding and replacing

    private var addSection: some View {
        Section {
            if replacing == nil {
                TextField(AIPolicies.Words.namePlaceholder, text: $name)
                    .focused($focused, equals: .name)
                    .accessibilityIdentifier("policy-name")
                    .accessibilityLabel(AIPolicies.Words.addLabel)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(AIPolicies.Words.linkLabel).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary)
                Text(AIPolicies.Words.linkHint).font(.footnote).foregroundColor(Palette.secondary)
                TextField(AIPolicies.Words.linkPlaceholder, text: $link)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .focused($focused, equals: .link)
                    .accessibilityIdentifier("policy-link")
                    .accessibilityLabel(AIPolicies.Words.linkLabel)
                Button(AIPolicies.Words.fetch) { ask(.link(link), doing: AIPolicies.Words.fetching) }
                    .buttonStyle(.borderless).disabled(busy)
                    .accessibilityIdentifier("policy-fetch")
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(AIPolicies.Words.pasteLabel).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary)
                ZStack(alignment: .topLeading) {
                    if words.isEmpty {
                        Text(AIPolicies.Words.pastePlaceholder).foregroundColor(Palette.tertiary).padding(.top, 8).padding(.leading, 5)
                            .accessibilityHidden(true)
                    }
                    TextEditor(text: $words).frame(minHeight: 120)
                        .scrollContentBackground(.hidden)
                        .focused($focused, equals: .words)
                        .accessibilityIdentifier("policy-words")
                        .accessibilityLabel(AIPolicies.Words.pasteLabel)
                }
                HStack {
                    Button(replacing == nil ? AIPolicies.Words.save : AIPolicies.Words.saveReplace) {
                        ask(.words(words), doing: AIPolicies.Words.saving)
                    }
                    .buttonStyle(.borderless).disabled(busy)
                    .accessibilityIdentifier("policy-save")
                    if replacing != nil {
                        Spacer()
                        Button(AIPolicies.Words.cancelReplace) { stopReplacing() }.buttonStyle(.borderless)
                    }
                }
            }
        } header: {
            Text(replacing.map { "Replace the words of " + $0.name } ?? AIPolicies.Words.addLabel)
        } footer: {
            Text(replacing == nil ? AIPolicies.Words.addHint : AIPolicies.Words.replaceHint).font(.footnote).foregroundColor(Palette.secondary)
        }
    }

    private func startReplacing(_ p: AIPolicies.Policy) {
        replacing = p
        note = nil
        focused = .link
    }
    private func stopReplacing() { replacing = nil }

    // The page refuses an empty name, link or paste in its words before it asks; then the confirm asks.
    private func ask(_ source: AIPolicies.Source, doing: String) {
        armed = nil
        switch AIPolicies.form(replacing: replacing?.id, name: name, source: source) {
        case .refused(let why): note = (why, true)
        case .ready(let body):
            let who = replacing?.name ?? (body["name"] ?? "")
            confirm = (AIPolicies.confirmTitle(name: who, replacing: replacing != nil), body, doing)
        }
    }

    // MARK: Reading and changing

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
            if read == nil { read = AIPolicies.read(status: 200, data: Data(AIPolicies.sampleRead.utf8)) }
            return
        }
        guard let mac, mac.url == shownURL else { return }
        armed = nil
        generation += 1
        let started = generation
        let (status, data) = await send(AIPolicies.listRequest(mac))
        guard started == generation else { return }
        if Task.isCancelled {
            if read == nil { read = .failed(AIPolicies.Words.listFailed) }
            return
        }
        read = AIPolicies.read(status: status, data: data)
        // A policy being replaced that is gone now takes the form back to adding (the page's polEditStop on remove).
        if let r = replacing, case .saved(let list, _)? = read, !list.contains(where: { $0.id == r.id }) { replacing = nil }
    }

    @MainActor private func change(_ request: URLRequest?, did: AIPolicies.Did, doing: String) async -> Bool {
        guard let mac, !busy, let request else { return false }
        busy = true
        note = (doing, false)
        generation += 1
        let sentTo = mac.url
        let (status, data) = await send(request)
        guard sentTo == shownURL else { return false }
        busy = false
        switch AIPolicies.done(did, status: status, data: data) {
        case .done(let said):
            note = (said, false)
            await load()
            return true
        case .refused(let why):
            note = (why, true)
            return false
        }
    }

    @MainActor private func save(_ body: [String: String], doing: String) async {
        if sample { sampleChange(.save(body)); return }
        guard let mac else { return }
        let did: AIPolicies.Did = body["id"] == nil ? .handed : .replaced
        if await change(AIPolicies.saveRequest(mac, body), did: did, doing: doing) {
            name = ""; link = ""; words = ""
            replacing = nil
        }
    }

    @MainActor private func rename(_ p: AIPolicies.Policy, to typed: String) async {
        let n = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        // As the page: no name is refused in its words; the same name changes nothing.
        if n.isEmpty { note = (AIPolicies.Words.nameFirst, true); return }
        if n == p.name { return }
        if sample { sampleChange(.rename(p.id, n)); return }
        guard let mac else { return }
        if await change(AIPolicies.renameRequest(mac, id: p.id, name: n), did: .renamed, doing: AIPolicies.Words.renaming),
           replacing?.id == p.id {
            replacing = AIPolicies.Policy(id: p.id, name: n, source: p.source, savedAt: p.savedAt, chars: p.chars, opening: p.opening)
        }
    }

    @MainActor private func remove(_ p: AIPolicies.Policy) async {
        armed = nil
        if sample { sampleChange(.remove(p.id)); return }
        guard let mac else { return }
        if await change(AIPolicies.removeRequest(mac, id: p.id), did: .removed, doing: AIPolicies.Words.removing), replacing?.id == p.id {
            replacing = nil
        }
    }

    // A sample build changes its own copy, with the page's sentence for a computer with no agents running.
    private enum SampleChange { case save([String: String]), rename(String, String), remove(String) }
    @MainActor private func sampleChange(_ c: SampleChange) {
        guard case .saved(var list, let company)? = read else { return }
        switch c {
        case .save(let body):
            if let id = body["id"], let i = list.firstIndex(where: { $0.id == id }) {
                let old = list[i]
                let text = body["text"] ?? ("Words fetched from " + (body["url"] ?? ""))
                list[i] = AIPolicies.Policy(id: id, name: old.name, source: body["url"] ?? "pasted", savedAt: Date(), chars: text.count, opening: String(text.prefix(240)))
                note = (AIPolicies.said([], did: .replaced), false)
            } else {
                let text = body["text"] ?? ("Words fetched from " + (body["url"] ?? ""))
                list.append(AIPolicies.Policy(id: "s\(list.count + 1)", name: body["name"] ?? "", source: body["url"] ?? "pasted",
                                              savedAt: Date(), chars: text.count, opening: String(text.prefix(240))))
                note = (AIPolicies.said([], did: .handed), false)
            }
            name = ""; link = ""; words = ""; replacing = nil
        case .rename(let id, let n):
            if let i = list.firstIndex(where: { $0.id == id }) {
                let o = list[i]
                list[i] = AIPolicies.Policy(id: id, name: n, source: o.source, savedAt: o.savedAt, chars: o.chars, opening: o.opening)
            }
            note = (AIPolicies.said([], did: .renamed), false)
        case .remove(let id):
            list.removeAll { $0.id == id }
            if replacing?.id == id { replacing = nil }
            note = (AIPolicies.said([], did: .removed), false)
        }
        read = list.isEmpty && company == nil ? .none(company: nil) : .saved(list, company: company)
    }
}

// As Settings' own: a redirect is refused, so the computer's cookie can never be carried to another host.
private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
