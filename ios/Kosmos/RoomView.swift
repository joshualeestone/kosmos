import SwiftUI
import UIKit

// kosmos#7032 (slice 9 of #6838): a project's room, natively. The board's room on a phone (Mona Lisa's slice 9 spec):
// the conversation with a sender on every row, the board's words for Kosmos's lines, reactions, replies, the
// silence line, the grouped working line, and the board's composer (its placeholder, the gold Post, a reply strip).
struct RoomView: View {
    @ObservedObject var store: RoomStore
    // kosmos#7062: the client that fetches a post's files and their pictures (the chat's), watched so a picture shows
    // when it arrives.
    @ObservedObject var client: BoardClient
    // The project as the room opened; `project` reads the list's current row (members change while it is open).
    let opened: Board.ProjectRow
    private var project: Board.ProjectRow { store.list?.projects.first { $0.id == opened.id } ?? opened }
    let openPage: (URL) -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = ""
    @State private var replying: Board.RoomRow?
    // The @name the last Reply put at the front of the box, so the next Reply swaps it and Post refuses it alone.
    @State private var replyMention: String?
    @State private var loop: Task<Void, Never>?
    @State private var chatAgent: Board.Agent?
    // Whether the end of the room is on screen: a new row follows only then, so a reader who scrolled up is never
    // pulled down by the 5-second re-read (the spec, and the board's room).
    @State private var atBottom = true
    // On screen (not covered by a member's chat or another tab): the re-read loop runs only then, so a hidden room is
    // never marked seen.
    @State private var visible = false
    // kosmos#7072: Reopen the room is on its way, and the board's sentence when it was refused.
    @State private var reopening = false
    @State private var reopenNote: String?
    // About four footnote lines at the person's own text size (the board's 4.4em while typing; review 2).
    @ScaledMetric(relativeTo: .footnote) private var heldTypingMax: CGFloat = 72
    // VoiceOver's place after a reopen takes the notice and its button away: the message box, as the board's focus,
    // without raising the keyboard (review 2).
    @AccessibilityFocusState private var composerFocused: Bool
    // kosmos#7062: each file card's state, and the file Quick Look shows (removed from the phone when it closes), as in
    // the chat.
    @State private var fileStates: [String: FileCardState] = [:]
    @State private var previewURL: URL?
    @State private var openedFile: URL?
    // The first scroll to the newest row has happened: only then may the top of the room ask for an older page (a
    // first layout from the top would otherwise load one at once and move the reader off the newest posts).
    @State private var settledAtBottom = false
    // The older-page spinner is on screen: when it stays on screen (a short room, or a page that folds to almost
    // nothing), the next page is asked for without waiting for another appearance.
    @State private var olderShowing = false
    @State private var pendingCount = 0
    @FocusState private var typing: Bool

    private var rows: [Board.RoomRow] { store.rows[project.id] ?? [] }
    private var items: [Board.RoomItem] { Board.roomItems(rows, now: Date(), calendar: .current) }

    var body: some View {
        VStack(spacing: 0) {
            needsLine
            thread
            if let note = store.notes[project.id] {
                Text(note).font(.footnote).foregroundColor(Palette.secondary).padding(.horizontal, 16).padding(.top, 4)
            }
            heldNotice
            composer
        }
        .background(Palette.ground.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text(project.name).font(.headline).foregroundColor(Palette.primary).lineLimit(1)
                    Text(project.members.count == 1 ? "1 agent" : "\(project.members.count) agents").font(.footnote).foregroundColor(Palette.secondary)
                }
                .accessibilityElement(children: .combine)
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { openBoardPage() } label: { Image(systemName: "info.circle") }
                    .accessibilityLabel("Members, files and tasks, on your computer's board")
            }
        }
        .background(
            NavigationLink(isActive: Binding(get: { chatAgent != nil }, set: { if !$0 { chatAgent = nil } })) {
                if let a = chatAgent {
                    ChatView(client: store.clientForChat, agent: a, openOnBoard: {
                        if let url = store.clientForChat.chatURL(for: a) { openPage(url) }
                    })
                }
            } label: { EmptyView() }.hidden()
        )
        .onAppear {
            visible = true
            // The box as the person left it (RoomStore.drafts), then anything handed back while they were away, and a
            // kept not-confirmed post's words cleared (onChange never sees the value present at appearance).
            if draft.isEmpty, let d = store.drafts[project.id] { draft = d.text; replying = d.replyTo; replyMention = d.mention }
            start(); takeReturned(); applyKept()
        }
        .onDisappear { visible = false; loop?.cancel(); loop = nil }
        // kosmos#7072: a hold that appears while the room is on screen is said aloud, as the board's paint does.
        .onChange(of: store.held[project.id] != nil) { now in
            if now && visible { UIAccessibility.post(notification: .announcement, argument: Board.heldAnnouncement) }
        }
        // kosmos#7062: a post's file in the system's Quick Look; closed, it is removed from the phone (the chat's rule).
        .quickLookPreview($previewURL)
        .onChange(of: previewURL) { now in
            if let was = openedFile, was != now { client.closed(was); openedFile = now }
        }
        // Signed out, another account or another Mac: the files this room showed belong to the one before (the chat's
        // reset, review 1).
        .onChange(of: client.chatEpoch) { _ in
            fileStates = [:]
            previewURL = nil
            openedFile = nil
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background { loop?.cancel(); loop = nil } else if phase == .active && visible && loop == nil { start() }
        }
        // Handed-back words go in when they arrive, if the box is empty then (the board's restoreUnsent); otherwise they
        // wait for the room's next opening, never for the box to empty (that is the moment Post is pressed).
        .onChange(of: store.returned[project.id]) { _ in takeReturned() }
        // A not-confirmed post the room now shows kept: a box still holding exactly its words is cleared.
        .onChange(of: store.kept[project.id]) { _ in applyKept() }
        .onChange(of: draft) { _ in keepDraft() }
        .onChange(of: replying?.id) { _ in keepDraft() }
    }

    // Re-read every 5 seconds while on screen, as the board's room does; seen on open and while new rows arrive.
    private func start() {
        loop?.cancel()
        loop = Task {
            var seenOnce = false
            var lastSeen: String?
            while !Task.isCancelled {
                let read = await store.loadRoom(project.id)
                // Seen only after a read that landed, while the room is still open: a failed read (rows kept from an
                // earlier visit included), or one that finished after the person left, is not the person seeing it.
                if Task.isCancelled { break }
                // By the newest row, not the count: a re-read that replaced 50 rows with 50 newer ones is still new.
                if read, let shown = store.rows[project.id], !seenOnce || shown.last?.id != lastSeen {
                    seenOnce = true; lastSeen = shown.last?.id
                    await store.markSeen(project.id)
                }
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    // An older page goes in above; the row that was at the top stays where the reader is looking.
    private func loadOlder(_ proxy: ScrollViewProxy) {
        // A post's id: a folded refusal line's id can change when older refusals join its run, which would leave
        // nothing to scroll back to.
        let anchor = items.first(where: { if case let .row(r, _, _) = $0.kind { return r.kind == .post } else { return false } })?.id
        Task {
            let before = store.older[project.id]?.cursor
            await store.loadOlder(project.id)
            if let anchor { proxy.scrollTo(anchor, anchor: .top) }
            // Still at the top with more to read (the page did not fill the screen): the next one, once per new cursor.
            let after = store.older[project.id]?.cursor
            if olderShowing, after != nil, after != before, !store.olderFailed.contains(project.id) {
                DispatchQueue.main.async { if olderShowing { loadOlder(proxy) } }
            }
        }
    }

    private func applyKept() {
        guard let words = store.kept[project.id] else { return }
        if Board.flatText(draft) == Board.flatText(words) { draft = ""; replying = nil; replyMention = nil }
        store.clearKept(project.id)
    }

    private func keepDraft() {
        if draft.isEmpty && replying == nil { store.drafts[project.id] = nil }
        else { store.drafts[project.id] = RoomStore.Draft(text: draft, replyTo: replying, mention: replyMention) }
    }

    // Words handed back by a post that did not go, taken only into an empty box (never over what the person has
    // typed since); otherwise they wait in the store for the next empty box.
    private func takeReturned() {
        guard draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, replying == nil,
              let back = store.takeReturned(project.id) else { return }
        draft = back.text
        replying = back.replyTo
    }

    // kosmos#7062: a post's file, fetched from the computer and shown in Quick Look, exactly as the chat opens one
    // (ChatView.openFile): a page or markup file opens on the board's room instead, and one file at a time.
    private func openFile(_ f: Board.Attachment) {
        if Board.isWebDocument(name: f.name, type: f.type) { openBoardPage(); return }
        guard !fileStates.values.contains(.loading), previewURL == nil else { return }
        fileStates[f.id] = .loading
        let opened = client.chatEpoch
        Task {
            let file = await client.fetchFile(f)
            // Signed out, another account or another Mac while it came: the file belongs to the one before (review 1,
            // the chat's guard).
            guard opened == client.chatEpoch else { if let file { client.closed(file) }; return }
            fileStates[f.id] = file == nil ? .failed : .ready
            // A failure is said aloud by the card itself while it is on screen (FileCard's own announcement runs while it
            // is hidden from VoiceOver), so nothing more is posted here, as in the chat (review 3: it was said twice).
            guard let file else { return }
            // Left the room while it came: nothing will show it, so it goes now.
            if visible { openedFile = file; previewURL = file } else { client.closed(file) }
        }
    }

    private func openBoardPage() {
        guard let mac = store.macURL, var parts = URLComponents(url: mac, resolvingAgainstBaseURL: false) else { return }
        parts.queryItems = [URLQueryItem(name: "tab", value: "projects"), URLQueryItem(name: "project", value: project.id)]
        if let url = parts.url { openPage(url) }
    }

    // kosmos#7072: a held room (#5800), as the board's notice at the top of its composer (pjHeldNotice): why, how it
    // ends, when it lifts on its own, and Reopen the room. A quiet band, as the board's msg-valve. While the person
    // types, the words keep to about four lines and scroll (the board's kosmos-keyboard-up rule), so the box stays.
    @ViewBuilder private var heldNotice: some View {
        if let until = store.held[project.id] {
            VStack(alignment: .leading, spacing: 6) {
                let words = Text(Board.heldNotice(until: until)).font(.footnote).foregroundColor(Palette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if typing {
                    ScrollView { words.frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: heldTypingMax)
                } else {
                    words
                }
                Button(Board.reopenButton) { reopen() }
                    .font(.footnote.weight(.semibold)).frame(minHeight: 44).fixedSize().disabled(reopening)
                // Under the button, never squeezed beside it (review 2).
                if let reopenNote {
                    Text(reopenNote).font(.footnote).foregroundColor(Palette.dangerWord).fixedSize(horizontal: false, vertical: true)
                        .padding(.bottom, 6)
                }
            }
            .padding(.horizontal, 10).padding(.top, 6)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.separator, lineWidth: 0.5))
            .padding(.horizontal, 16).padding(.top, 6)
            .accessibilityElement(children: .contain)
            // A refusal said for one hold is not carried into the next, nor past a change in it (the board rewrites its
            // notice then).
            .onDisappear { reopenNote = nil }
            // By the words shown, as the board rewrites its notice only when its HTML changes (review 2: until moves a
            // little on every read, which cleared a refusal before it could be read).
            .onChange(of: Board.heldNotice(until: until)) { _ in reopenNote = nil }
        }
    }

    private func reopen() {
        reopening = true
        reopenNote = nil
        let id = project.id
        Task {
            let outcome = await store.reopen(id)
            reopening = false
            // Said only while this room is on screen (the board returns when the room changed, review 1). The keyboard is
            // not raised: on a phone that is more than the desktop board's focus, so the person taps the box themselves.
            switch outcome {
            case .reopened:
                if visible {
                    composerFocused = true
                    UIAccessibility.post(notification: .announcement, argument: Board.reopenedAnnouncement)
                }
                // Then the re-read, so a hold it finds is announced after "Reopened", as on the board.
                await store.loadRoom(id)
            case .refused(let sentence):
                // Only while this room is still held: a hold lifted while the reopen was on its way takes the notice
                // away, and its refusal must not wait beside the next one (review 2).
                guard store.held[id] != nil else { break }
                reopenNote = sentence
                if visible { UIAccessibility.post(notification: .announcement, argument: sentence) }   // the board's role=status
            case .dropped:
                break
            }
        }
    }

    // "<Name> needs you on this project." pinned under the header (the board's block, which a phone would put out of
    // reach under the conversation; the spec pins it). Open goes to that agent's chat.
    @ViewBuilder private var needsLine: some View {
        let waiting = store.waitingMembers(project)
        if !waiting.isEmpty {
            HStack(spacing: 8) {
                Text(waiting.count == 1 ? "\(waiting[0].name) needs you on this project." : "\(waiting.count) agents need you on this project.")
                    .font(.footnote).foregroundColor(Palette.primary)
                Spacer(minLength: 8)
                if waiting.count == 1 {
                    Button("Open") { chatAgent = waiting[0] }.font(.footnote.weight(.semibold)).frame(minHeight: 44)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 10).fill(Palette.banner))
            .padding(.horizontal, 16).padding(.top, 8)
        }
    }

    private var thread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    // The top of the room: it leaving the screen after the first layout proves the jump to the newest
                    // row happened, even if the end marker was not reached (estimated row heights; ChatView's rule).
                    Color.clear.frame(height: 1)
                        .onDisappear { if !rows.isEmpty { settledAtBottom = true } }
                    if store.older[project.id]?.cursor != nil {
                        if store.olderFailed.contains(project.id) {
                            Button("We could not load earlier messages. Try again") { loadOlder(proxy) }
                                .font(.footnote).frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            HStack { Spacer(); ProgressView(); Spacer() }
                                .onAppear { olderShowing = true; if settledAtBottom { loadOlder(proxy) } }
                                .onDisappear { olderShowing = false }
                        }
                    }
                    if store.rows[project.id] != nil && rows.isEmpty { emptyRoom }
                    ForEach(items) { item in itemView(item).id(item.id) }
                    ForEach(store.pending[project.id] ?? []) { p in pendingView(p) }
                    if store.roomFailed.contains(project.id) {
                        Text("We cannot read this room right now. What is shown may be behind.")
                            .font(.footnote).foregroundColor(Palette.secondary).frame(maxWidth: .infinity).padding(.top, 8)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                        .onAppear {
                            atBottom = true
                            // The end of the room is really on screen: only now may the top ask for older pages (the
                            // spinner at the top has had its chance to leave the screen in the same layout).
                            if !settledAtBottom && !rows.isEmpty { DispatchQueue.main.async { settledAtBottom = true } }
                        }
                        .onDisappear { atBottom = false }
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
            }
            .onChange(of: rows.last?.id) { _ in
                if !settledAtBottom {
                    // The first page: straight to the newest row, then the top may ask for older ones. A page that fits
                    // on one screen moves neither marker, so settle here when the end is already showing.
                    proxy.scrollTo("bottom", anchor: .bottom)
                    DispatchQueue.main.async { if atBottom && !rows.isEmpty { settledAtBottom = true } }
                } else if atBottom {
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
            // The person's own post always shows: pressing Post is asking to see it.
            .onChange(of: store.pending[project.id]?.count ?? 0) { n in
                if n > pendingCount { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }   // a new post only
                pendingCount = n
            }
            // The first scroll has happened and the top is already showing (a room shorter than the screen).
            .onChange(of: settledAtBottom) { done in if done && olderShowing { loadOlder(proxy) } }
            .onAppear {
                proxy.scrollTo("bottom", anchor: .bottom)
                // A room opened again with its rows already read: the last row will not change, so settle here.
                // (settled by the end of the room appearing, above)
            }
        }
    }

    private var emptyRoom: some View {
        Text(project.members.isEmpty ? "Put an agent on this project and the room opens."
             : "Nothing here yet. Post below and everyone on this project receives it; use @name to hand someone a request.")
            .font(.footnote).foregroundColor(Palette.secondary).multilineTextAlignment(.center)
            .frame(maxWidth: .infinity).padding(.top, 24).padding(.horizontal, 16)
    }

    @ViewBuilder private func itemView(_ item: Board.RoomItem) -> some View {
        switch item.kind {
        case .day(let label):
            Text(label).font(.caption.weight(.semibold)).foregroundColor(Palette.secondary).frame(maxWidth: .infinity).padding(.vertical, 6)
        case let .row(row, first, last):
            if row.kind == .kosmos {
                Text(row.text).font(.footnote).foregroundColor(Palette.secondary).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity).padding(.horizontal, 24).padding(.vertical, 4)
            } else {
                RoomBubble(row: row, first: first, last: last, name: displayName(row), picture: store.picture(row.from),
                           replied: row.replyTo.flatMap { id in rows.first { $0.id == id } },
                           // Only once the whole room is loaded can an original be said to be gone; before that it may
                           // simply be on an older page.
                           roomComplete: store.older[project.id]?.cursor == nil, nameOf: { displayName($0) },
                           react: { emoji in Task { await store.react(emoji, to: row, in: project.id) } },
                           reply: {
                               replying = row
                               let next = Board.replyMention(draft: draft, from: row.byPerson ? nil : row.from, previous: replyMention)
                               draft = next.text
                               replyMention = next.mention
                               typing = true
                           },
                           openAgent: { if let a = store.agent(row.from) { chatAgent = a } },
                           mentionNames: row.mentioned.compactMap { store.names[$0] },
                           thumbnails: client.thumbnails, fileStates: fileStates, openFile: openFile)
                    .padding(.top, first ? 6 : 0)
                    .task { for f in row.attachments { await client.loadThumbnail(f) } }
            }
        }
    }

    private func displayName(_ row: Board.RoomRow) -> String {
        if row.byPerson { return "You" }
        // An outside sender's own words, never mapped to a local agent's name (the board's pjRoomRow, #3851).
        if row.kind == .external { return row.from.flatMap { $0.isEmpty ? nil : $0 } ?? "Someone outside" }
        return row.from.map { store.names[$0] ?? $0 } ?? "Kosmos"
    }

    private func pendingView(_ p: RoomStore.Pending) -> some View {
        VStack(alignment: .trailing, spacing: 4) {
            BubbleText(text: p.text, mine: true, tail: true, widthShare: 0.78, faded: true)
            Text(p.line ?? "Sending…").font(.caption2).foregroundColor(p.line == nil ? Palette.tertiary : Palette.dangerWord)
            if p.line != nil {
                Button("Delete") { store.discard(p.id, in: project.id) }.font(.caption2).frame(minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    // Words to post: not empty, and not only the @name Reply put there.
    private var canPost: Bool {
        // Not before the room's first read: with nothing read, an older post with the same words could settle it.
        store.rows[project.id] != nil && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !Board.isOnlyMention(draft, mention: replyMention)
    }

    private var composer: some View {
        VStack(spacing: 0) {
            if let r = replying {
                HStack(spacing: 8) {
                    Text("Replying to \(displayName(r)): \(r.text.components(separatedBy: "\n").first ?? "")")
                        .font(.footnote).foregroundColor(Palette.secondary).lineLimit(1)
                    Spacer()
                    Button {
                        // A box holding nothing but the @name Reply put there goes back to empty (the board's
                        // pj-replying-x, #4359); words the person typed stay as they are.
                        if Board.isOnlyMention(draft, mention: replyMention) { draft = "" }
                        replying = nil; replyMention = nil
                    } label: { Image(systemName: "xmark") }.frame(minWidth: 44, minHeight: 44)
                        .accessibilityLabel("Stop replying")
                }
                .padding(.horizontal, 16)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Write something or @name to message someone…", text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($typing)
                    .accessibilityFocused($composerFocused)
                    .accessibilityLabel("Post to everyone on this project")
                    .padding(.vertical, 10).padding(.horizontal, 14)
                    .background(RoundedRectangle(cornerRadius: 20).fill(Palette.card))
                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(Palette.separator))
                Button { send() } label: {
                    Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundColor(Palette.sendGlyph)
                        .frame(width: 44, height: 44).background(Circle().fill(Palette.sendFill))
                }
                .disabled(!canPost)
                .opacity(canPost ? 1 : 0.5)
                .accessibilityLabel("Post")
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
        .background(Palette.ground)
    }

    // The box clears at once, so the person can keep typing. A refused or not-confirmed post's words come back through
    // the store (RoomStore.returned), which keeps them if the person has left the room or typed something since.
    private func send() {
        guard canPost else { return }
        let text = draft
        let reply = replying
        draft = ""; replying = nil; replyMention = nil
        Task { await store.post(text, to: project.id, replyTo: reply) }
    }
}

// One post in a room: the sender's picture and name on the first of a run, the board's bubble colours, a reply header,
// reactions and the silence line under it.
struct RoomBubble: View {
    let row: Board.RoomRow
    let first: Bool
    let last: Bool
    let name: String
    let picture: UIImage?
    let replied: Board.RoomRow?
    let roomComplete: Bool
    let nameOf: (Board.RoomRow) -> String
    let react: (String) -> Void
    let reply: () -> Void
    let openAgent: () -> Void

    private var mine: Bool { row.byPerson }
    // kosmos#7062: the words shown beside the post's files (Board.roomWords, tested).
    private var words: String { Board.roomWords(row) }
    // Reply and reactions only on a post of this room: the board's route takes neither for an outside message.
    private var answerable: Bool { row.kind == .post }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if !mine {
                Group {
                    if last { avatar } else { Color.clear }
                }
                .frame(width: 28, height: 28)
            }
            VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                bubble
                if !row.reactions.isEmpty { reactions }
                if !row.unanswered.isEmpty {
                    // Already shown names (parseRoom maps them), so never mapped a second time here.
                    Text(row.unanswered.map { "\($0) has not answered here yet." }.joined(separator: " "))
                        .font(.footnote).foregroundColor(Palette.tertiary)
                }
                if last, let at = row.at { Text(at, style: .time).font(.caption2).foregroundColor(Palette.tertiary).padding(.horizontal, 4) }
            }
            .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityActions {
            if answerable {
                // React, Reply, Copy (the spec): each reaction pill is merged into the post, so each one is an action.
                Button("React with thumbs up") { react("👍") }
                Button("React with a heart") { react("❤️") }
                Button("React with fire") { react("🔥") }
                ForEach(row.reactions.filter { !["👍", "❤️", "🔥"].contains($0.emoji) }, id: \.emoji) { r in
                    Button("React with \(r.emoji)") { react(r.emoji) }
                }
                Button("Reply", action: reply)
            }
            Button("Copy") { UIPasteboard.general.string = row.text }
            // The post is read as one element and its cards are not buttons in it, so each file is an action on it
            // (kosmos#7062), saying what the card would: opening, another file opening, failed, or opens on the board.
            ForEach(Array(row.attachments.enumerated()), id: \.offset) { _, f in
                Button(fileActionName(f)) { openFile(f) }
            }
        }
    }

    @ViewBuilder private var avatar: some View {
        if row.kind == .external {
            Circle().strokeBorder(Palette.secondary, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                .overlay(Text(String(name.prefix(1)).uppercased()).font(.system(size: 12, weight: .semibold)).foregroundColor(Palette.secondary))
        } else {
            Button(action: openAgent) { AgentAvatar(name: name, picture: picture, tone: nil, size: 28) }
                .buttonStyle(.plain).accessibilityLabel("Open \(name)'s chat")
        }
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 4) {
            if first && !mine {
                HStack(spacing: 6) {
                    Text(name).font(.footnote.weight(.semibold)).foregroundColor(Palette.primary)
                    if row.kind == .external {
                        Text(row.externalAgent ? "External agent" : "External").font(.caption2).foregroundColor(Palette.secondary)
                    }
                }
            }
            if let replied {
                Text("\(nameOf(replied)): \(replied.text.components(separatedBy: "\n").first ?? "")")
                    .font(.footnote).foregroundColor(Palette.secondary).lineLimit(2)
                    .padding(.leading, 8).overlay(Rectangle().fill(Palette.separator).frame(width: 2), alignment: .leading)
            } else if row.replyTo != nil && roomComplete {
                Text("Original message unavailable").font(.footnote).foregroundColor(Palette.tertiary)
            }
            if !words.isEmpty || row.attachments.isEmpty {
                Text(row.kind == .external ? AttributedString(words) : Self.withMentions(Board.messageText(words), mentioned: row.mentioned, names: mentionNames))
                    .font(.body).foregroundColor(Palette.primary).tint(Palette.link)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // One card per file, by position as well as id (a post that names one file twice draws two). While one is
            // on its way the others wait, as in the chat. The post is one VoiceOver element, so the cards are read in it
            // as plain words ("Files: ...", never as buttons, review 2: a files-only post is never an empty element) and
            // each file is offered once, as the post's "Open <name>" action (review 1: never twice).
            if !row.attachments.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(row.attachments.enumerated()), id: \.offset) { _, f in
                        FileCard(file: f, thumbnail: thumbnails[f.id], state: fileStates[f.id] ?? .ready,
                                 waiting: fileStates.values.contains(.loading) && fileStates[f.id] != .loading, open: { openFile(f) })
                    }
                }
                .padding(.top, words.isEmpty ? 0 : 2)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Files: " + row.attachments.map(\.name).joined(separator: ", "))
            }
        }
        .padding(.vertical, 8).padding(.horizontal, 12)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(mine ? Palette.personBubble : Palette.agentBubble))
        .frame(maxWidth: UIScreen.main.bounds.width * 0.78, alignment: mine ? .trailing : .leading)
        .contextMenu {
            if answerable {
                Button { react("👍") } label: { Text("👍") }
                Button { react("❤️") } label: { Text("❤️") }
                Button { react("🔥") } label: { Text("🔥") }
                Button(action: reply) { Label("Reply", systemImage: "arrowshape.turn.up.left") }
            }
            Button { UIPasteboard.general.string = row.text } label: { Label("Copy", systemImage: "doc.on.doc") }
        }
    }

    var mentionNames: [String] = []
    // kosmos#7062: the post's files as the chat's cards (ChatFiles.swift), inside the bubble under its words, as the
    // board draws pjAttachmentCards after the post's body.
    var thumbnails: [String: Data] = [:]
    var fileStates: [String: FileCardState] = [:]
    var openFile: (Board.Attachment) -> Void = { _ in }

    // The VoiceOver action for one file, carrying the state its card shows (review 3).
    private func fileActionName(_ f: Board.Attachment) -> String {
        switch fileStates[f.id] {
        case .loading: return "Opening \(f.name)"
        case .failed: return "Open \(f.name) again (it could not be opened)"
        default:
            // A page or markup file opens on the board at once, even while another file loads (openFile checks it first).
            if Board.isWebDocument(name: f.name, type: f.type) { return "Open \(f.name) on your computer's board" }
            return fileStates.values.contains(.loading) ? "Open \(f.name) (another file is opening)" : "Open \(f.name)"
        }
    }

    // @names in the mention blue, only for agents the post actually addressed (`mentioned`, the board's #4642).
    static func withMentions(_ text: AttributedString, mentioned: [String], names: [String]) -> AttributedString {
        guard !mentioned.isEmpty else { return text }
        var out = text
        let plain = String(out.characters)
        // Whole @names only: @eli is not lit inside @elijah.
        for word in Set(mentioned + names) where !word.isEmpty {
            for r in Board.mentionRanges(plain, word) {
                if let a = AttributedString.Index(r.lowerBound, within: out), let b = AttributedString.Index(r.upperBound, within: out) {
                    out[a..<b].foregroundColor = Palette.link
                }
            }
        }
        return out
    }

    private var reactions: some View {
        HStack(spacing: 6) {
            ForEach(row.reactions, id: \.emoji) { r in
                Button { react(r.emoji) } label: {
                    Text("\(r.emoji) \(r.count)").font(.footnote)
                        .padding(.horizontal, 8).frame(minHeight: 28)
                        .background(Capsule().fill(Palette.card))
                        .overlay(Capsule().stroke(r.mine ? Palette.link : Palette.separator))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(r.emoji), \(r.count)\(r.mine ? ", yours" : "")")
            }
        }
    }
}
