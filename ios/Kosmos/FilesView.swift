import SwiftUI
import QuickLook   // review 2: .quickLookPreview, never reached only through another file's import

// kosmos#7679: an agent's or a project's Files, as the board's Files screens show them. An agent's opens at the top of its
// Files folder with its folders first (the board's paintAgentFilesAll, through /files/browse); a project's is one list
// (the board's Documents view, through /documents). A file opens in Quick Look exactly as a chat file does (fetchFile),
// and Quick Look's share button is the share sheet. A page or markup file opens on the board instead, as in the chat.
// The decisions and the words are in FilesLogic.swift (tested).
struct FilesView: View {
    @ObservedObject var client: BoardClient
    let owner: Board.FilesOwner
    // The folder shown (agent only; "" is the top). A folder row pushes another FilesView one level down.
    var dir: String = ""
    let openOnBoard: () -> Void

    @State private var read: Board.FilesRead?
    @StateObject private var opener = FileOpener()
    // Review 3: the account this list was read for, so coming Back to it keeps the page and only another account clears it.
    @State private var readFor: Int?

    var body: some View {
        List {
            if case .agent = owner, !dir.isEmpty {
                Section { crumbs }
            }
            switch read {
            case nil:
                Section { ProgressView() }
            case .noAnswer?:
                Section { Text(Board.filesCannotRead).foregroundColor(Palette.secondary) }
            case .refused(let why)?:
                Section { Text(why).foregroundColor(Palette.secondary) }
            case .page(let page)?:
                if page.dirs.isEmpty && page.files.isEmpty {
                    Section { Text(Board.filesEmpty(owner: owner, dir: dir)).foregroundColor(Palette.secondary) }
                } else {
                    Section {
                        ForEach(page.dirs) { d in
                            NavigationLink {
                                FilesView(client: client, owner: owner, dir: d.name, openOnBoard: openOnBoard)
                            } label: {
                                Label(d.shownName, systemImage: "folder").foregroundColor(Palette.primary)
                            }
                        }
                        ForEach(page.files) { f in FilesRow(file: f, shownName: rowName(f), opening: opener.opening == f.name) { opener.open(f, owner: owner, client: client, openOnBoard: openOnBoard) } }
                    } footer: {
                        // Only when it says something (review 5: an empty footer still takes space).
                        let count: String? = { if case .project = owner { return page.total == 1 ? "1 file" : "\(page.total) files" }; return nil }()
                        let more = Board.filesMore(page, owner: owner)
                        if count != nil || more != nil {
                            VStack(alignment: .leading, spacing: 4) {
                                if let count { Text(count).foregroundColor(Palette.secondary) }
                                if let more { Text(more).foregroundColor(Palette.secondary) }
                            }
                        }
                    }
                }
            }
            if let failed = opener.failed {
                Section { Text(failed).foregroundColor(Palette.secondary) }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .navigationTitle(dir.isEmpty ? Board.filesTitle : (dir.split(separator: "/").last.map(String.init) ?? Board.filesTitle))
        .navigationBarTitleDisplayMode(.inline)
        .kosmosSolidTopBar()
        .refreshable { await load() }
        // Review 2: keyed on the account, so a sign-out, another account or another Mac cancels the old read and starts
        // a new one; load() also drops an answer that lands for the account before.
        .task(id: client.chatEpoch) {
            if readFor != client.chatEpoch { read = nil; opener.failed = nil; readFor = client.chatEpoch }
            await load()
        }
        .filesQuickLook(opener, client: client)
    }

    // A project's list is flat, so a file in a subfolder keeps its path; an agent's folder already names where it is.
    private func rowName(_ f: Board.ListedFile) -> String {
        if case .project = owner { return f.name }
        return f.shownName
    }

    private var crumbs: some View {
        let all = Board.filesCrumbs(dir)
        return Text(all.map(\.name).joined(separator: " \u{203A} "))
            .font(.footnote).foregroundColor(Palette.secondary)
            .accessibilityLabel("In " + all.map(\.name).joined(separator: ", "))
    }

    private func load() async {
        #if DEBUG
        if let sample = FilesView.sample(owner: owner, dir: dir) { read = sample; return }
        #endif
        let epoch = client.chatEpoch
        let res = await client.throughMac { mac in
            switch owner {
            case .agent: return Board.filesRequest(mac: mac, owner: owner, dir: dir)
            case .project: return Board.filesRequest(mac: mac, owner: owner)
            }
        }
        guard epoch == client.chatEpoch else { return }   // the answer belongs to the account before
        // Review 3: no answer (a cancelled read, a dropped connection) keeps a list already shown, as the agent page does.
        let got = Board.filesResult(status: res?.1.statusCode ?? 0, body: res?.0)
        if case .noAnswer = got, case .page = read { return }
        read = got
    }

    #if DEBUG
    // KOSMOS_SAMPLE_FILES=1 (a Debug build): sample Files without a Mac, for the design shots; =empty shows the empty state.
    static func sample(owner: Board.FilesOwner, dir: String) -> Board.FilesRead? {
        guard let v = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_FILES"] else { return nil }
        if v == "empty" { return .page(Board.FilesPage(dir: dir, dirs: [], files: [], missing: false, truncated: false, total: 0)) }
        let now = Date()
        let files = [
            Board.ListedFile(name: "Spring catalogue proof.pdf", size: 2_411_724, modified: now.addingTimeInterval(-3600), changedBy: nil),
            Board.ListedFile(name: "Printer quotes.txt", size: 1_830, modified: now.addingTimeInterval(-86_400), changedBy: nil),
        ]
        if case .project = owner {
            return .page(Board.FilesPage(dir: "", dirs: [], files: files.map {
                Board.ListedFile(name: $0.name, size: $0.size, modified: $0.modified, changedBy: "Maya")
            }, missing: false, truncated: false, total: 2))
        }
        return .page(Board.FilesPage(dir: dir, dirs: dir.isEmpty ? [Board.ListedFolder(name: "Covers")] : [], files: files,
                                     missing: false, truncated: false, total: 2))
    }
    #endif
}

// One file's row: an icon, the name, and the board's small line under it.
struct FilesRow: View {
    let file: Board.ListedFile
    let shownName: String
    let opening: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "doc").foregroundColor(Palette.secondary).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(shownName).foregroundColor(Palette.primary).lineLimit(2)
                    let meta = Board.filesMeta(file) { $0.formatted(date: .abbreviated, time: .omitted) }
                    if !meta.isEmpty { Text(meta).font(.footnote).foregroundColor(Palette.secondary) }
                }
                Spacer(minLength: 8)
                if opening { ProgressView() }
            }
        }
        .accessibilityElement(children: .combine)
        // Review 1: a page or markup file opens on the board instead, so the hint says where it opens.
        .accessibilityHint(Board.isWebDocument(name: file.name, type: "") ? "Opens on your computer\u{2019}s board" : "Opens the file")
    }
}

// The agent page's Files section: the newest few (the board's agent panel), then View All, which opens the browser.
// Review 1: no modifiers of its own. In a List a Section's modifiers land on every row, so a task here ran once per row
// and a row scrolled away could set the opener invisible mid-fetch; AgentInfoView owns the read and the opener and
// applies them once, to its List (FilesView does the same on its own List).
struct FilesSection: View {
    @ObservedObject var client: BoardClient
    let session: String
    let state: Board.FilesSectionState
    @ObservedObject var opener: FileOpener
    let openOnBoard: () -> Void

    var body: some View {
        switch state {
        case .hidden:
            EmptyView()
        case .message(let line):
            Section {
                Text(line).foregroundColor(Palette.secondary)
            } header: { header }
        case .rows(let files):
            Section {
                ForEach(files) { f in
                    FilesRow(file: f, shownName: f.shownName, opening: opener.opening == f.name) {
                        opener.open(f, owner: .agent(session), client: client, openOnBoard: openOnBoard)
                    }
                }
                if let failed = opener.failed { Text(failed).foregroundColor(Palette.secondary) }
                NavigationLink {
                    FilesView(client: client, owner: .agent(session), openOnBoard: openOnBoard)
                } label: {
                    Text(Board.filesAll).foregroundColor(Palette.primary)
                }
                .accessibilityIdentifier("agent-files-all")
            } header: { header }
        }
    }

    private var header: some View {
        Text(Board.filesTitle).font(.footnote.weight(.semibold)).foregroundColor(Palette.secondary).textCase(nil)
    }

    // The section's read (the newest few), for AgentInfoView's load.
    static func read(client: BoardClient, session: String) async -> Board.FilesSectionState {
        #if DEBUG
        if let sample = FilesView.sample(owner: .agent(session), dir: "") {
            if case .page(let p) = sample { return p.files.isEmpty ? .hidden : .rows(p.files) }
            return .hidden
        }
        #endif
        let res = await client.throughMac { Board.filesRequest(mac: $0, owner: .agent(session)) }
        return Board.filesSection(status: res?.1.statusCode ?? 0, body: res?.0)
    }
}

// Opening a listed file, shared by the Files screen and the agent page's section: one file at a time, fetched through
// the chat's fetchFile and shown in Quick Look; a page or markup file opens on the board instead (the chat's rule).
@MainActor
final class FileOpener: ObservableObject {
    @Published var opening: String?
    @Published var failed: String?
    @Published var previewURL: URL?
    var openedFile: URL?
    var visible = false

    func open(_ f: Board.ListedFile, owner: Board.FilesOwner, client: BoardClient, openOnBoard: () -> Void) {
        guard opening == nil, previewURL == nil else { return }
        if Board.isWebDocument(name: f.name, type: "") { openOnBoard(); return }
        if Board.filesTooBigToOpen(f) { say(Board.filesTooBig(owner)); return }   // review 2: never read whole into memory
        guard let a = Board.filesAttachment(owner: owner, file: f, id: UUID().uuidString) else { say(Board.filesDidNotOpen); return }
        failed = nil
        opening = f.name
        let epoch = client.chatEpoch
        Task {
            let file = await client.fetchFile(a)
            opening = nil
            // Signed out, another account or another Mac while it came: the file belongs to the one before.
            guard epoch == client.chatEpoch else { if let file { client.closed(file) }; return }
            guard let file else { say(Board.filesDidNotOpen); return }
            // Left the screen while it came: nothing will show it, so it goes now.
            if visible { openedFile = file; previewURL = file } else { client.closed(file) }
        }
    }

    func reset(client: BoardClient) {
        if let f = openedFile { client.closed(f) }
        openedFile = nil; previewURL = nil; opening = nil; failed = nil
    }

    // Quick Look closed (or moved on): the file it showed is removed from the phone, as the chat does.
    func shown(_ now: URL?, client: BoardClient) {
        if let was = openedFile, was != now { client.closed(was); openedFile = now }
    }

    private func say(_ s: String) {
        failed = s
        UIAccessibility.post(notification: .announcement, argument: s)
    }
}

extension View {
    func filesQuickLook(_ opener: FileOpener, client: BoardClient) -> some View {
        modifier(FilesQuickLook(opener: opener, client: client))
    }
}

private struct FilesQuickLook: ViewModifier {
    @ObservedObject var opener: FileOpener
    let client: BoardClient
    func body(content: Content) -> some View {
        content
            .onAppear { opener.visible = true }
            .onDisappear { opener.visible = false }
            .quickLookPreview($opener.previewURL)
            .onChange(of: opener.previewURL) { opener.shown($0, client: client) }
            // Review 3: another account's file is never left showing, whether or not the screen is popped (the chat's reset).
            .onChange(of: client.chatEpoch) { _ in opener.reset(client: client) }
    }
}
