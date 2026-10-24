import SwiftUI
import UIKit

// kosmos#7032 (slice 9 of #6838): a project's room, natively. The board's room on a phone (Mona Lisa's slice 9 spec):
// the conversation with a sender on every row, the board's words for Kosmos's lines, reactions, replies, the
// silence line, the grouped working line, and the board's composer (its placeholder, the gold Post, a reply strip).
struct RoomView: View {
    @ObservedObject var store: RoomStore
    let project: Board.ProjectRow
    let openPage: (URL) -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = ""
    @State private var replying: Board.RoomRow?
    @State private var loop: Task<Void, Never>?
    @State private var chatAgent: Board.Agent?
    // Whether the end of the room is on screen: a new row follows only then, so a reader who scrolled up is never
    // pulled down by the 5-second re-read (the spec, and the board's room).
    @State private var atBottom = true
    // On screen (not covered by a member's chat or another tab): the re-read loop runs only then, so a hidden room is
    // never marked seen.
    @State private var visible = false
    // The first scroll to the newest row has happened: only then may the top of the room ask for an older page (a
    // first layout from the top would otherwise load one at once and move the reader off the newest posts).
    @State private var settledAtBottom = false
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
        .onAppear { visible = true; start(); takeReturned() }
        .onDisappear { visible = false; loop?.cancel(); loop = nil }
        .onChange(of: scenePhase) { phase in
            if phase == .background { loop?.cancel(); loop = nil } else if phase == .active && visible && loop == nil { start() }
        }
        .onChange(of: store.returned[project.id]) { _ in takeReturned() }
        // A not-confirmed post the room now shows kept: a box still holding exactly its words is cleared.
        .onChange(of: store.kept[project.id]) { words in
            guard let words else { return }
            if draft.trimmingCharacters(in: .whitespacesAndNewlines) == words { draft = ""; replying = nil }
            store.clearKept(project.id)
        }
    }

    // Re-read every 5 seconds while on screen, as the board's room does; seen on open and while new rows arrive.
    private func start() {
        loop?.cancel()
        loop = Task {
            var lastCount = -1
            while !Task.isCancelled {
                await store.loadRoom(project.id)
                // Seen only once the room has really been read: a failed first read is not the person seeing it.
                if let shown = store.rows[project.id], shown.count != lastCount { lastCount = shown.count; await store.markSeen(project.id) }
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    // An older page goes in above; the row that was at the top stays where the reader is looking.
    private func loadOlder(_ proxy: ScrollViewProxy) {
        let anchor = items.first(where: { if case .row = $0.kind { return true } else { return false } })?.id
        Task {
            await store.loadOlder(project.id)
            if let anchor { proxy.scrollTo(anchor, anchor: .top) }
        }
    }

    // Words handed back by a post that did not go, taken only into an empty box (never over what the person has
    // typed since); otherwise they wait in the store for the next empty box.
    private func takeReturned() {
        guard draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, replying == nil,
              let back = store.takeReturned(project.id) else { return }
        draft = back.text
        replying = back.replyTo
    }

    private func openBoardPage() {
        guard let mac = store.macURL, var parts = URLComponents(url: mac, resolvingAgainstBaseURL: false) else { return }
        parts.queryItems = [URLQueryItem(name: "tab", value: "projects"), URLQueryItem(name: "project", value: project.id)]
        if let url = parts.url { openPage(url) }
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
                    if store.older[project.id]?.cursor != nil {
                        if store.olderFailed.contains(project.id) {
                            Button("We could not load earlier messages. Try again") { loadOlder(proxy) }
                                .font(.footnote).frame(maxWidth: .infinity, minHeight: 44)
                        } else {
                            HStack { Spacer(); ProgressView(); Spacer() }
                                .onAppear { if settledAtBottom { loadOlder(proxy) } }
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
                        .onAppear { atBottom = true }
                        .onDisappear { atBottom = false }
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
            }
            .onChange(of: rows.last?.id) { _ in
                if !settledAtBottom {
                    // The first page: straight to the newest row, then the top may ask for older ones.
                    proxy.scrollTo("bottom", anchor: .bottom)
                    DispatchQueue.main.async { settledAtBottom = true }
                } else if atBottom {
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
            // The person's own post always shows: pressing Post is asking to see it.
            .onChange(of: store.pending[project.id]?.count ?? 0) { n in if n > 0 { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } } }
            .onAppear {
                proxy.scrollTo("bottom", anchor: .bottom)
                // A room opened again with its rows already read: the last row will not change, so settle here.
                if !rows.isEmpty { DispatchQueue.main.async { settledAtBottom = true } }
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
                               if !row.byPerson, let from = row.from { draft = Board.replyMention(draft: draft, from: from) }
                               typing = true
                           },
                           openAgent: { if let a = store.agent(row.from) { chatAgent = a } },
                           mentionNames: row.mentioned.compactMap { store.names[$0] })
                    .padding(.top, first ? 6 : 0)
            }
        }
    }

    private func displayName(_ row: Board.RoomRow) -> String {
        if row.byPerson { return "You" }
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

    private var composer: some View {
        VStack(spacing: 0) {
            if let r = replying {
                HStack(spacing: 8) {
                    Text("Replying to \(displayName(r)): \(r.text.components(separatedBy: "\n").first ?? "")")
                        .font(.footnote).foregroundColor(Palette.secondary).lineLimit(1)
                    Spacer()
                    Button { replying = nil } label: { Image(systemName: "xmark") }.frame(minWidth: 44, minHeight: 44)
                        .accessibilityLabel("Stop replying")
                }
                .padding(.horizontal, 16)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Write something or @name to message someone…", text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($typing)
                    .accessibilityLabel("Post to everyone on this project")
                    .padding(.vertical, 10).padding(.horizontal, 14)
                    .background(RoundedRectangle(cornerRadius: 20).fill(Palette.card))
                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(Palette.separator))
                Button { send() } label: {
                    Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundColor(Palette.sendGlyph)
                        .frame(width: 44, height: 44).background(Circle().fill(Palette.sendFill))
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.5 : 1)
                .accessibilityLabel("Post")
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
        }
        .background(Palette.ground)
    }

    // The box clears at once, so the person can keep typing. A refused or not-confirmed post's words come back through
    // the store (RoomStore.returned), which keeps them if the person has left the room or typed something since.
    private func send() {
        let text = draft
        let reply = replying
        draft = ""; replying = nil
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
            if answerable { Button("Reply", action: reply) }
            Button("Copy") { UIPasteboard.general.string = row.text }
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
            Text(row.kind == .external ? AttributedString(row.text) : Self.withMentions(Board.messageText(row.text), mentioned: row.mentioned, names: mentionNames))
                .font(.body).foregroundColor(Palette.primary).tint(Palette.link)
                .fixedSize(horizontal: false, vertical: true)
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
