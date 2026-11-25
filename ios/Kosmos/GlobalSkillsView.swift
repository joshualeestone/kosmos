import SwiftUI

// kosmos#8959 slice D1b1: the computer's Global skills, native (the board's Settings > Global skills): the list, names
// only, each with a Remove that asks once before it acts, and the add form. The list is read again after every change,
// as the page's: it is the receipt. The logic is GlobalSkillsLogic.swift. The UI test drives only the sample build's
// path; the real reads and changes are covered by the logic suite's requests and answers, not by the UI test.
struct GlobalSkillsView: View {
    let mac: Settings.Mac?
    var sample = false
    var finding = false
    var signedOut = false

    private enum Load: Equatable { case reading, got([Board.Skill]), failed(String) }

    @State private var load: Load = .reading
    @State private var listNote: String?
    // A refused remove's sentence, said by the one read that follows it, then gone (review 1).
    @State private var removeRefusal: (key: String, text: String)?
    // The one Remove asking "for good?" (the page's armed button, which disarms on blur): typing, a read, another
    // press or leaving disarms it.
    @State private var armed: String?
    @State private var removing: String?
    @State private var name = ""
    @State private var words = ""
    @State private var adding = false
    @State private var addNote: (text: String, problem: Bool)?
    // Bumped by every read and every change, so an older answer never paints over a newer one; and the computer the
    // list came from, so another computer starts the screen over.
    @State private var generation = 0
    @State private var shownURL: URL?
    // A field taking focus disarms Remove, as the page's blur does (review 4); so does the app leaving the screen.
    // Review 6: one value per field (a Bool shared by two fields is not defined in SwiftUI).
    private enum Field: Hashable { case name, words }
    @FocusState private var focused: Field?
    @Environment(\.scenePhase) private var scenePhase

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
        .navigationTitle(GlobalSkills.Words.title)
        .navigationBarTitleDisplayMode(.inline)
        .dotsRefresh { await read() }
        .task(id: mac?.url) {
            if shownURL != mac?.url {
                shownURL = mac?.url
                load = .reading; listNote = nil; removeRefusal = nil; armed = nil; removing = nil; adding = false; addNote = nil
                generation += 1
            }
            await read()
        }
        .onDisappear { armed = nil }
        .onChange(of: focused) { f in if f != nil { armed = nil } }
        .onChange(of: scenePhase) { p in if p != .active { armed = nil } }
        // The page's fields stop at their maxlength (UTF-16 units); typing anywhere disarms a Remove, as the page's blur.
        .onChange(of: name) { v in
            armed = nil
            let c = GlobalSkills.clipped(v, utf16: GlobalSkills.nameMax)
            if c != v { name = c }
        }
        .onChange(of: words) { v in
            armed = nil
            let c = GlobalSkills.clipped(v, utf16: GlobalSkills.bodyMax)
            if c != v { words = c }
        }
    }

    // MARK: The list

    private var listSection: some View {
        Section {
            switch load {
            case .reading:
                HStack(spacing: 10) {
                    SweepDots(scales: false)
                    Text("Looking…").font(.footnote).foregroundColor(Palette.secondary)
                }
            case .failed(let why):
                VStack(alignment: .leading, spacing: 8) {
                    Text(why).font(.subheadline).foregroundColor(Palette.secondary)
                    Button("Try again") { Task { await read() } }
                }
            case .got(let skills):
                if skills.isEmpty {
                    Text(GlobalSkills.Words.none).foregroundColor(Palette.secondary)
                }
                ForEach(skills) { skill in row(skill) }
            }
        } header: {
            Text(GlobalSkills.Words.title)
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if let listNote { Text(listNote).foregroundColor(Palette.dangerWord) }
                Text(GlobalSkills.Words.ask).foregroundColor(Palette.secondary)
                Text(GlobalSkills.Words.hint).foregroundColor(Palette.secondary)
            }
            .font(.footnote)
        }
    }

    private func row(_ skill: Board.Skill) -> some View {
        let isArmed = armed == skill.key
        return HStack {
            Text(skill.name).font(.body.weight(.semibold)).foregroundColor(Palette.primary)
                .lineLimit(2).layoutPriority(1)
            Spacer()
            if removing == skill.key {
                SweepDots(size: 16, label: "Removing", scales: false)
            } else {
                Button {
                    // The second press is the consent, as the page's armed button; the first only asks.
                    // Review 5: arming takes the keyboard away, as the page's button takes focus, so any later tap into a
                    // field is a real focus change and disarms it.
                    if isArmed { Task { await remove(skill) } } else { focused = nil; armed = skill.key }
                } label: {
                    // Review 4: borderless, the tap is the label's, so the label is a full 44-point target.
                    Text(isArmed ? GlobalSkills.Words.removeArmed : GlobalSkills.Words.remove)
                        // Review 5: wraps rather than running off the row at the largest text sizes.
                        .fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.trailing)
                        .frame(minHeight: 44).contentShape(Rectangle())
                }
                .foregroundColor(isArmed ? Palette.dangerWord : Palette.primary)
                .accessibilityLabel(isArmed ? GlobalSkills.Words.removeArmed : GlobalSkills.Words.removeLabel + skill.name)
                .accessibilityIdentifier("gskill-remove-" + skill.key)
                // Review 3: only the button itself; a list row otherwise makes the whole row its tap, so a tap on the
                // name would arm Remove and a second would delete the skill.
                .buttonStyle(.borderless)
                .disabled(removing != nil)
            }
        }
        .frame(minHeight: 44)
    }

    // MARK: Adding

    private var addSection: some View {
        Section {
            TextField(GlobalSkills.Words.namePlaceholder, text: $name)
                .focused($focused, equals: .name)
                .accessibilityIdentifier("gskill-name")
                .accessibilityLabel(GlobalSkills.Words.addLabel)
            ZStack(alignment: .topLeading) {
                if words.isEmpty {
                    Text(GlobalSkills.Words.bodyPlaceholder).foregroundColor(Palette.tertiary).padding(.top, 8).padding(.leading, 5)
                        .accessibilityHidden(true)
                }
                TextEditor(text: $words).frame(minHeight: 120)
                    .focused($focused, equals: .words)
                    .scrollContentBackground(.hidden)
                    .accessibilityIdentifier("gskill-body")
                    .accessibilityLabel("What the skill should do")
            }
            Button {
                Task { await add() }
            } label: {
                HStack(spacing: 6) {
                    Text(GlobalSkills.Words.addButton)
                    if adding { SweepDots(size: 16, label: "Adding", scales: false) }
                }
            }
            .disabled(adding)
            .accessibilityIdentifier("gskill-add")
        } header: {
            Text(GlobalSkills.Words.addLabel)
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if let addNote { Text(addNote.text).foregroundColor(addNote.problem ? Palette.dangerWord : Palette.secondary) }
                Text(GlobalSkills.Words.addHint).foregroundColor(Palette.secondary)
            }
            .font(.footnote)
        }
    }

    // MARK: Reading and writing

    private static let http = URLSession(configuration: .ephemeral, delegate: RefuseRedirects(), delegateQueue: nil)

    private func send(_ request: URLRequest?) async -> (Int, Data) {
        guard let request else { return (0, Data()) }
        guard let (data, response) = try? await Self.http.data(for: request), let answer = response as? HTTPURLResponse
        else { return (0, Data()) }
        return (answer.statusCode, data)
    }

    @MainActor private func read() async {
        await Task.yield()
        if sample {
            if case .got = load {} else { load = .got(Board.parseSkills(Data(GlobalSkills.sampleList.utf8)) ?? []) }
            return
        }
        guard let mac, mac.url == shownURL else { return }
        armed = nil
        generation += 1
        let started = generation
        if case .got = load {} else { load = .reading }
        let (status, data) = await send(GlobalSkills.listRequest(mac))
        guard started == generation else { return }
        if Task.isCancelled {
            if case .reading = load { load = .failed(GlobalSkills.Words.listFailed) }
            return
        }
        switch GlobalSkills.list(status: status, data: data) {
        case .got(let skills):
            load = .got(skills)
            // Review 1: a fresh list says nothing old; only a refused remove's sentence is said, once, under it. Review 6:
            // and only while the skill is still listed (a remove with no answer may have landed; the list says so).
            listNote = removeRefusal.flatMap { r in skills.contains { $0.key == r.key } ? r.text : nil }
            removeRefusal = nil
        case .failed(let why):
            // As the page: a failed read empties the list (nothing it cannot vouch for stays pressable) and says why.
            load = .failed(why)
            listNote = nil
            removeRefusal = nil
        }
    }

    @MainActor private func remove(_ skill: Board.Skill) async {
        armed = nil
        if sample {
            if case .got(let s) = load { load = .got(s.filter { $0.key != skill.key }) }
            return
        }
        guard let mac, removing == nil, let request = GlobalSkills.removeRequest(mac, key: skill.key) else { return }
        removing = skill.key
        generation += 1
        let sentTo = mac.url
        let (status, data) = await send(request)
        // Review 1: an answer from a computer no longer shown touches nothing, not even this computer's spinner.
        guard sentTo == shownURL else { return }
        if removing == skill.key { removing = nil }
        switch GlobalSkills.removed(status: status, data: data) {
        case .done:
            // Review 5: the row goes now, so its Remove cannot be pressed again while the list is read.
            removeRefusal = nil
            if case .got(let s) = load { load = .got(s.filter { $0.key != skill.key }) }
        case .refused(let why): removeRefusal = (skill.key, why)
        }
        await read()
    }

    @MainActor private func add() async {
        armed = nil
        if sample {
            // The engine's refusals (engine/skills.js), so the sample never lists what a computer would refuse, nor two
            // rows with one key.
            var taken: [String] = []
            if case .got(let s) = load { taken = s.map(\.key) }
            if let why = GlobalSkills.sampleRefusal(name: name, body: words, taken: taken) {
                addNote = (why, true)
                return
            }
            if case .got(let s) = load {
                load = .got(s + [Board.Skill(key: GlobalSkills.slug(name), name: name.trimmingCharacters(in: .whitespacesAndNewlines))])
            }
            name = ""; words = ""
            addNote = (GlobalSkills.Words.added, false)
            return
        }
        guard let mac, !adding, let request = GlobalSkills.addRequest(mac, name: name, body: words) else { return }
        adding = true
        addNote = nil   // review 2: the last refusal goes while this one is out, as the page's "Adding…"
        let sentTo = mac.url
        let (status, data) = await send(request)
        guard sentTo == shownURL else { return }
        adding = false
        switch GlobalSkills.added(status: status, data: data) {
        case .done:
            // As the page: the fields empty, the sentence said, and the list read again as the receipt.
            name = ""; words = ""
            addNote = (GlobalSkills.Words.added, false)
            generation += 1
            await read()
        case .refused(let why):
            addNote = (why, true)
        }
    }
}

// As Settings' own: a redirect is refused, so the computer's cookie can never be carried to another host.
private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
