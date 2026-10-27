import SwiftUI
import UIKit
import PhotosUI

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
    // kosmos#7101: the post a reply's header asked to go to, the one flashing, and VoiceOver's place after the jump.
    @State private var jumpTo: String?
    @State private var flashed: String?
    @State private var flashToken = 0
    @AccessibilityFocusState private var focusedPost: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
    // kosmos#7268: the emoji panel (in the keyboard's place while open), the glyph waiting to go in at the cursor, and
    // dictation into the box.
    @State private var emojiOpen = false
    @State private var emojiInsert: String?
    @StateObject private var dictation = Dictation()
    // kosmos#7096: the room's search, as the chat's (#7089, Mona Lisa's design): the magnifier opens the row, it stays
    // while it holds words, and its x or Cancel empties it and puts it away.
    @State private var query = ""
    @State private var searchOpen = false
    @FocusState private var searchFocused: Bool
    // Whether the reader was at the newest post when the row opened (it pushes the room down).
    @State private var openedAtNewest = false
    // Whether this open filtered the room: only then is the reader's place gone, and putting the row away goes to the
    // newest post.
    @State private var filteredInMode = false
    // Counts clears, so a clear's delayed steps act only if no later clear came after it.
    @State private var clears = 0
    // A post went while words filtered: the line under the room says it shows only if it matches (the chat's line).
    @State private var sentWhileSearching = false
    // A reply's header was pressed while the search hides the post it answers: the room says so instead of moving
    // (the board's PJ_HIDDEN_BY_SEARCH), until the search changes or goes.
    @State private var hiddenBySearch = false
    // The empty-result sentence has been spoken for this entry into an empty result (the board's PJ_SEARCH_WAS_EMPTY):
    // not again while it stays empty, whatever is typed or whichever sentence a read shows. Forgotten when results
    // come back or the search goes.
    @State private var spokeEmpty = false
    private var searching: Bool { Board.chatSearching(query) }
    // The row open or words in it: no older pages (the chat's rule, #7089, from the board's earlierNearTop).
    private var searchMode: Bool { searchOpen || searching }

    private var rows: [Board.RoomRow] { store.rows[project.id] ?? [] }
    // The rows the search keeps, before refusals fold (as the board filters before its fold).
    private var shownRows: [Board.RoomRow] {
        guard searching else { return rows }
        let names = store.names   // a dictionary built on each access: built once for the filter, not once per row
        return Board.roomFilter(rows, name: { names[$0] }, query: query)
    }
    private var items: [Board.RoomItem] { Board.roomItems(shownRows, now: Date(), calendar: .current) }

    var body: some View {
        VStack(spacing: 0) {
            needsLine
            if searchMode { searchBar }
            // kosmos#7137: the board's #pj-fed-own-phone, one line above the room: why a shared room does not read here,
            // and where the code to compare is. Callout, the third label colour, plain words, as the board's .ownseal-phone.
            if let seal = store.ownSealLine(project.id) {
                Text(seal).font(.callout).foregroundColor(Palette.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16).padding(.vertical, 8)
            }
            thread
                .background(GeometryReader { g in Color.clear.onAppear { threadHeight = g.size.height }
                    .onChange(of: g.size.height) { threadHeight = $0 } })
            // The board has one line here and the newest write wins: a jump to a hidden post is the newest when it
            // happens (a post clears it), so it shows over the last post's line, as the board's would.
            if hiddenBySearch {
                Text(Board.roomHiddenBySearch).font(.footnote).foregroundColor(Palette.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.top, 4)
            } else if let note = store.notes[project.id] {
                Text(note).font(.footnote).foregroundColor(Palette.secondary).padding(.horizontal, 16).padding(.top, 4)
            } else if sentWhileSearching {
                // Below the post's own line: a post that did not go says so instead.
                Text(Board.chatSentWhileSearching).font(.footnote).foregroundColor(Palette.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.top, 4)
                    // Spoken, as the chat's line is: the search field keeps VoiceOver's focus.
                    .onAppear { Self.say(Board.chatSentWhileSearching) }
            }
            workingLine
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
                Button {
                    // With the row already open it only puts the cursor back in the field.
                    let opening = !searchOpen
                    if opening { openedAtNewest = atBottom }
                    searchOpen = true
                    DispatchQueue.main.async {
                        searchFocused = true
                        if opening && openedAtNewest { NotificationCenter.default.post(name: .roomScrollToEnd, object: project.id) }
                    }
                } label: {
                    Image(systemName: "magnifyingglass").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                .accessibilityLabel("Search this conversation")
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
            store.enterOwnCompare(project.id)   // kosmos#7137: this visit's own-compare read draws the line, never the last one's
            // kosmos#7072: coming back to a room that is held says so, as the board does when it shows a held room.
            if store.held[project.id] != nil { Self.say(Board.heldAnnouncement) }
            // The box as the person left it (RoomStore.drafts), then anything handed back while they were away, and a
            // kept not-confirmed post's words cleared (onChange never sees the value present at appearance).
            if draft.isEmpty, let d = store.drafts[project.id] { draft = d.text; replying = d.replyTo; replyMention = d.mention }
            start(); takeReturned(); applyKept()
            #if DEBUG
            // kosmos#7096, KOSMOS_SAMPLE_ROOM_SEARCH=<words>: the row opened with those words typed, for its screenshots
            // (its own name, so the chat's KOSMOS_SAMPLE_SEARCH shots never open it).
            if let words = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_ROOM_SEARCH"], !Self.sampleSearched {
                Self.sampleSearched = true
                searchOpen = true
                query = words
            }
            #endif
        }
        .onDisappear {
            visible = false; loop?.cancel(); loop = nil
            // A reading posture, not the room's state: coming back (from another tab, or a member's chat opened from here)
            // shows the whole room, as the chat's search goes when it leaves the screen. A search that filtered settles the
            // scroll again, as putting it away does.
            if filteredInMode { settledAtBottom = false }
            clears += 1   // a clear's delayed steps belong to this visit
            filteredInMode = false
            query = ""
            searchOpen = false
            searchFocused = false
            openedAtNewest = false
            sentWhileSearching = false
            hiddenBySearch = false
            spokeEmpty = false
        }
        .onChange(of: searching) { now in if now { filteredInMode = true } }
        .onChange(of: query) { _ in sentWhileSearching = false; hiddenBySearch = false }
        .onChange(of: searching && shownRows.isEmpty) { empty in if !empty { spokeEmpty = false } }
        // A post that did not go says so on its own line; the search's line is not about it.
        .onChange(of: store.notes[project.id] != nil) { now in if now { sentWhileSearching = false; hiddenBySearch = false } }
        // Leaving an empty field puts it away; one with words stays.
        .onChange(of: searchFocused) { now in if !now && !searching && searchOpen { putSearchAway() } }
        // kosmos#7072: a hold that appears while the room is on screen is said aloud, as the board's paint does.
        .onChange(of: store.held[project.id] != nil) { now in
            if now && visible { Self.say(Board.heldAnnouncement) }
        }
        // kosmos#7062: a post's file in the system's Quick Look; closed, it is removed from the phone (the chat's rule).
        .quickLookPreview($previewURL)
        .onChange(of: previewURL) { now in
            if let was = openedFile, was != now { client.closed(was); openedFile = now }
        }
        // Signed out, another account or another Mac: the files this room showed belong to the one before (the chat's
        // reset, review 1).
        .onChange(of: client.chatEpoch) { _ in
            dictation.reset(); emojiOpen = false   // kosmos#7268: another account's room starts clean
            clears += 1   // a clear's delayed steps belong to the account before
            if filteredInMode { settledAtBottom = false }   // the next room settles as on opening, as onDisappear does
            filteredInMode = false
            query = ""
            searchOpen = false
            searchFocused = false
            openedAtNewest = false
            sentWhileSearching = false
            hiddenBySearch = false
            spokeEmpty = false
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
        // Not while searching: a search shortens the room; its top showing is not a reader asking for older posts.
        guard !searchMode else { return }
        // A post's id: a folded refusal line's id can change when older refusals join its run, which would leave
        // nothing to scroll back to.
        let anchor = items.first(where: { if case let .row(r, _, _) = $0.kind { return r.kind == .post } else { return false } })?.id
        Task {
            let before = store.older[project.id]?.cursor
            await store.loadOlder(project.id)
            // kosmos#7101 review 1: a post a reply's header just went to stays centred while it flashes.
            if let jumped = flashed, rows.contains(where: { $0.id == jumped }) { proxy.scrollTo(jumped, anchor: .center) }
            else if let anchor { proxy.scrollTo(anchor, anchor: .top) }
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
        dictation.stop()   // kosmos#7268 review 2: before the draft is kept, so no late result is lost from it
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

    // kosmos#7080: the board's grouped working line (paintRoomBusy), above the composer: dots and names, no faces, the
    // word "working". Drawn from the status the phone last read and the room's member order. Above the held notice, as
    // the board's #pj-busy sits above the composer that #pj-held tops. While the status reads are not landing, no line:
    // a phone loses its connection far more than a desk page does, and an old "is working" is the over-claim the board
    // avoids (review 1; the board only repaints on a good poll, so this under-claims where it would keep the old line).
    // Live and fresh, as the Agents tab decides "not updating" (review 2: fresh alone stays true while unreachable).
    private var statusCurrent: Bool { if case .live = client.phase { return client.fresh } else { return false } }
    private var workingNow: [String] {
        statusCurrent ? Board.workingNames(members: project.members.map(\.session), agents: client.agents, project: project.id,
                                           spokeSinceStatus: store.spokeSince(client.updatedAt, in: project.id)) : []
    }
    @ViewBuilder private var workingLine: some View {
        if let parts = Board.workingLineParts(workingNow) {
            // The dots sit on the first line's baseline when the line wraps, as the board's .act aligns to the text's end.
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                WorkingDots().accessibilityHidden(true)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] }
                parts.reduce(Text("")) { $0 + ($1.name ? Text($1.text).bold() : Text($1.text)) }
                    .font(.footnote).foregroundColor(Palette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.top, 4)
            .accessibilityElement(children: .combine)
        }
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
                    // A short notice takes only its own height; a long one scrolls inside the cap (review 4).
                    ViewThatFits(in: .vertical) {
                        words
                        ScrollView { words.frame(maxWidth: .infinity, alignment: .leading) }.frame(maxHeight: heldTypingMax)
                    }
                    .frame(maxHeight: heldTypingMax)
                } else {
                    words
                }
                Button(Board.reopenButton) { reopen() }
                    // It may wrap at the largest text sizes rather than run past the band (review 3).
                    .font(.footnote.weight(.semibold)).frame(minHeight: 44).fixedSize(horizontal: false, vertical: true).disabled(reopening)
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

    // kosmos#7072 review 3: queued, so it never cuts off what VoiceOver is saying (the focused box, an announcement
    // before it), and the next one waits for it.
    static func say(_ words: String) {
        UIAccessibility.post(notification: .announcement,
                             argument: NSAttributedString(string: words, attributes: [.accessibilitySpeechQueueAnnouncement: true]))
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
                    Self.say(Board.reopenedAnnouncement)
                }
                // Then the re-read, so a hold it finds is announced after "Reopened", as on the board.
                await store.loadRoom(id)
            case .refused(let sentence):
                // Only while this room is still held: a hold lifted while the reopen was on its way takes the notice
                // away, and its refusal must not wait beside the next one (review 2).
                guard store.held[id] != nil, visible else { break }   // nor after the person left (review 4)
                reopenNote = sentence
                Self.say(sentence)   // the board's role=status
            case .dropped:
                break
            }
        }
    }

    // "<Name> needs you on this project." pinned under the header (the board's block, which a phone would put out of
    // reach under the conversation; the spec pins it). kosmos#7106: the board's pjNeedsNotice, counted by the projects
    // route for THIS project; a row per member with its reason, its action (Answer or Open, to that agent's chat) and
    // Dismiss. One member: its row sits under the head, which already names it. Several: the head shows how many, and
    // Show lists them, so the pinned band never takes the room over.
    @State private var needsOpen = false
    @Environment(\.dynamicTypeSize) private var needsTypeSize
    // Rows sit behind Show when there are several, or (review 5) at an accessibility size even for one, so the pinned
    // band can always be made small.
    private func needsFolded(_ notice: Board.NeedsNotice) -> Bool { notice.rows.count > 1 || needsTypeSize.isAccessibilitySize }
    // VoiceOver's place after a dismiss (the board's pjNeedsDismissClick): the next row's Dismiss, else the last one
    // left, else (the notice gone with its last row) the box, which outlives it (review 2).
    @AccessibilityFocusState private var needsFocus: String?
    // Rows with a dismiss in the air: their Dismiss waits, as the board's disabled button (review 2).
    @State private var dismissing: Set<String> = []
    // Rows whose Dismiss VoiceOver left while the row was still there (review 5): a later nil focus is the person moving
    // on, never the row going, so focus is not pulled back.
    @State private var needsLeft: Set<String> = []
    @ViewBuilder private var needsLine: some View {
        if let notice = store.needsNotice(project.id) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(notice.head).font(.footnote.weight(.semibold)).foregroundColor(Palette.primary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    if needsFolded(notice) {
                        Button { needsOpen.toggle() } label: {
                            Text(needsOpen ? "Hide" : "Show").font(.footnote.weight(.semibold))
                                .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                        }
                        .accessibilityLabel(needsOpen ? "Hide who needs you" : "Show who needs you")
                    }
                }
                if !needsFolded(notice) || needsOpen {
                    ForEach(notice.rows) { row in needsRow(row, named: notice.namedInHead == row.session) }
                }
                // Only a dismiss that did not go stays on screen, until the rows change or the room opens again; a
                // dismiss that went is heard (the board's status line is read, not drawn; review 1).
                if let failed = store.needsFailed[project.id] {
                    Text(failed.said).font(.footnote).foregroundColor(Palette.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 10).fill(Palette.banner))
            .padding(.horizontal, 16).padding(.top, 8)
            .onChange(of: notice.rows.map(\.key)) { _ in store.clearNeedsFailed(project.id) }
            .onChange(of: needsFocus) { [was = needsFocus] now in
                if now == nil, let was, store.needsNotice(project.id)?.rows.contains(where: { $0.session == was }) == true { needsLeft.insert(was) }
            }
            .onAppear { store.clearNeedsFailed(project.id) }
        }
    }

    private func dismiss(_ row: Board.NeedsRow) {
        guard !dismissing.contains(row.session) else { return }
        dismissing.insert(row.session)
        needsLeft.remove(row.session)
        let keys = store.needsNotice(project.id)?.rows.map(\.session) ?? []
        Task {
            let said = await store.dismissNeeds(row, in: project.id)
            dismissing.remove(row.session)
            // Focus moves only if VoiceOver was still on this Dismiss, or on nothing because its row went with the
            // re-read (review 4), never if it moved on (the board returns when focus left the notice).
            let stillHere = needsFocus == row.session || (needsFocus == nil && !composerFocused && !needsLeft.contains(row.session))
            // Left the room meanwhile: nothing is said over another screen (the board returns when PJ_CURRENT moved),
            // and a failure line is not left for the next visit.
            guard visible else { store.clearNeedsFailed(project.id); return }
            guard let said else { return }
            Self.say(said)
            guard said == Board.needsDismissed, stillHere else { return }
            let left = store.needsNotice(project.id)?.rows.map(\.session) ?? []
            // A row behind Hide is not drawn, so it cannot take focus: the box then.
            let shown = store.needsNotice(project.id).map { !needsFolded($0) || needsOpen } ?? false   // the view's own rule (review 6)
            if shown, let next = keys.drop(while: { $0 != row.session }).dropFirst().first(where: { left.contains($0) }) ?? left.last {
                needsFocus = next
            } else {
                composerFocused = true
            }
        }
    }

    private func needsRow(_ row: Board.NeedsRow, named: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(named ? row.why : "\(row.name): \(row.why)").font(.footnote).foregroundColor(Palette.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                // An agent the status does not list (rare): the project's page on the computer's board, never a dead button.
                Button { if let a = store.agent(row.session) { chatAgent = a } else { openBoardPage() } } label: {
                    Text(row.act).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                .accessibilityLabel("\(row.act) \(row.name)")
                // "Try again" after a dismiss that did not go, as the board relabels its button (review 4).
                Button { dismiss(row) } label: {
                    Text(store.needsFailed[project.id]?.session == row.session ? "Try again" : "Dismiss")
                        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                .disabled(dismissing.contains(row.session))
                .accessibilityLabel("Dismiss \(row.name)")
                .accessibilityFocused($needsFocus, equals: row.session)
            }
            .font(.footnote.weight(.semibold))
        }
        .accessibilityElement(children: .contain)
    }

    private var thread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    // The top of the room: it leaving the screen after the first layout proves the jump to the newest
                    // row happened, even if the end marker was not reached (estimated row heights; ChatView's rule).
                    Color.clear.frame(height: 1)
                        .onDisappear { if !rows.isEmpty { settledAtBottom = true } }
                    if store.older[project.id]?.cursor != nil && !searchMode {
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
                    // On a read that could not read all of the room, what matches may be in the part it missed: the
                    // board's partial-read line there, not its no-match sentence (paintRoom on body.ok === false).
                    else if searching && shownRows.isEmpty && !rows.isEmpty {
                        if store.roomPartial.contains(project.id) {
                            Text(Board.roomPartialLine)
                                .font(.subheadline).foregroundColor(Palette.secondary).multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity).padding(.top, 60)
                                .onAppear { sayOnce(Board.roomPartialLine) }   // spoken, as the room speaks its no-match sentence
                        } else { noMatch }
                    }
                    ForEach(items) { item in itemView(item).id(item.id).accessibilityFocused($focusedPost, equals: item.id) }
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
                } else if atBottom && !searching {
                    // Not while searching: a new post may not even be among what matched (the board's convPause).
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
            // kosmos#7080 review 4: the working line sits below the thread, so its coming, going or growing changes the
            // thread's height; a reader at the end stays at the end (the board's holdFloorOnResize, #1037). Read before
            // the layout moves the end marker, scrolled once it has. Animated, as the new-row scroll above is: a reply
            // usually lands in the same update that takes its writer off the line (review 5: a plain scroll cut it short).
            .onChange(of: Board.workingLine(workingNow)) { _ in
                if atBottom && settledAtBottom && !searching { DispatchQueue.main.async { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } } }
            }
            // kosmos#7101: a reply's header goes to the post it answers, centred, flashing for the board's 1.8 s, with
            // VoiceOver's focus on it (the board's #3745: row.focus()). Still, with Reduce Motion (the board's
            // prefers-reduced-motion branch).
            .onChange(of: jumpTo) { id in
                guard let id else { return }
                jumpTo = nil
                // kosmos#7096: an original the search hides is not gone to; the room says so (the board's
                // PJ_HIDDEN_BY_SEARCH, said only for a post the room holds: one not loaded keeps the jump's own behaviour).
                if Board.roomJumpHidden(id, shown: shownRows, all: rows, searching: searching) {
                    hiddenBySearch = true
                    sentWhileSearching = false
                    Self.say(Board.roomHiddenBySearch)
                    return
                }
                if reduceMotion { proxy.scrollTo(id, anchor: .center) } else { withAnimation { proxy.scrollTo(id, anchor: .center) } }
                // A repeat jump to the post still flashing starts the flash over, as the board's class removed and added
                // again (review 4): only the latest jump's timer clears it.
                flashToken += 1
                let token = flashToken
                if flashed == id { flashed = nil; DispatchQueue.main.async { if flashToken == token { flashed = id } } } else { flashed = id }
                // VoiceOver's focus once the post exists and has arrived (a lazy row far up is made by the scroll), and
                // cleared first so a second jump to the same post still moves it (review 1).
                focusedPost = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + (reduceMotion ? 0.05 : 0.4)) { focusedPost = id }
                DispatchQueue.main.asyncAfter(deadline: .now() + Board.replyJumpFlash) { if flashToken == token { flashed = nil } }
            }
            // The person's own post always shows: pressing Post is asking to see it.
            .onChange(of: store.pending[project.id]?.count ?? 0) { n in
                if n > pendingCount { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }   // a new post only
                pendingCount = n
            }
            // The first scroll has happened and the top is already showing (a room shorter than the screen).
            .onChange(of: settledAtBottom) { done in if done && olderShowing { loadOlder(proxy) } }
            // The magnifier opened the row over a reader at the newest post: back there once the keyboard is up too (the
            // room has no other keyboard rule; the chat's keepNewestInView does this there).
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                // Once, for the open: a reader who scrolls up afterwards is not pulled back by a later keyboard.
                if visible && searchFocused && openedAtNewest && !searching {
                    openedAtNewest = false
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
            }
            // The magnifier opened the row over a reader at the newest post: back there once the row is in.
            .onReceive(NotificationCenter.default.publisher(for: .roomScrollToEnd)) { note in
                guard visible, note.object as? String == project.id else { return }
                withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            // Putting away a search that filtered is reading at the newest post again. Until that scroll settles, the top
            // the short room left on screen is not a reader asking for older posts (as on opening): the end marker or the
            // top leaving settles it; a room too short to move either settles a second later.
            .onChange(of: searchMode) { now in
                guard !now && filteredInMode else { return }
                filteredInMode = false
                guard visible else { return }
                clears += 1
                let clear = clears
                settledAtBottom = false
                proxy.scrollTo("bottom", anchor: .bottom)
                DispatchQueue.main.async { if !searchMode && visible && clears == clear { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } } }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    if !searchMode && visible && clears == clear && !settledAtBottom && !rows.isEmpty { settledAtBottom = true }
                }
            }
            .onAppear {
                proxy.scrollTo("bottom", anchor: .bottom)
                // A room opened again with its rows already read: the last row will not change, so settle here.
                // (settled by the end of the room appearing, above)
            }
        }
    }

    #if DEBUG
    // Once a launch, so coming back to the room in a screenshot run shows it as a person would.
    static var sampleSearched = false
    #endif

    // kosmos#7096: the search row, as the chat's (#7089).
    private var searchBar: some View {
        HStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").font(.system(size: 15)).foregroundColor(Palette.secondary)
                    .accessibilityHidden(true)
                TextField("", text: $query, prompt: Text("Search").foregroundColor(Palette.secondary))
                    .focused($searchFocused)
                    .accessibilityLabel("Search this conversation")
                    .font(.body)
                    .foregroundColor(Palette.primary)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                if !query.isEmpty {
                    Button { closeSearch() } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 17)).foregroundColor(Palette.secondary)
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear the search")
                }
            }
            .padding(.leading, 12)
            .frame(minHeight: 44)
            .background(Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(Palette.separator, lineWidth: 0.5))
            // The 44 pt frame inside the label, so it is the tap area too (outside it only sized the slot, #7117).
            Button { closeSearch() } label: {
                Text("Cancel").font(.body).fixedSize().foregroundColor(Palette.primary)
                    .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }
    private func sayOnce(_ words: String) {
        guard !spokeEmpty else { return }
        spokeEmpty = true
        Self.say(words)
    }
    private func closeSearch() {
        searchFocused = false
        putSearchAway()
    }
    // The row goes, emptied. A search that filtered then goes to the newest post (onChange(of: searchMode)); one that
    // never did leaves the reader where they are.
    private func putSearchAway() {
        spokeEmpty = false
        // Before the words go: the older-page spinner comes back as the row goes, and it must not take the short room's
        // top for a reader asking for older posts (onChange(of: searchMode) settles it again).
        if filteredInMode { settledAtBottom = false }
        query = ""
        searchOpen = false
        openedAtNewest = false
        UIAccessibility.post(notification: .layoutChanged, argument: nil)
    }
    // Spoken as it appears: the field keeps VoiceOver's focus, so nothing else says the room went empty (the board's
    // room search announces it on the way into no match, not on every key).
    private var noMatch: some View {
        Text(Board.chatNoMatch(query)).font(.subheadline).foregroundColor(Palette.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 60)
            .onAppear { sayOnce(Board.chatNoMatch(query)) }
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
                VStack(spacing: 2) {
                    Text(row.text).font(.footnote).foregroundColor(Palette.secondary).multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                    if Board.addMemberShown(row, members: liveMembers, live: Set(client.agents.map(\.session))) {
                        addMemberButton(row)
                    }
                }
                .frame(maxWidth: .infinity).padding(.horizontal, 24).padding(.vertical, 4)
            } else {
                RoomBubble(row: row, first: first, last: last, name: displayName(row), picture: store.picture(row.from),
                           // A post or an outside message, never a Kosmos line (a reply answers a post; review 1).
                           replied: row.replyTo.flatMap { id in rows.first { $0.id == id && $0.kind != .kosmos } },
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
                           jump: { if let id = row.replyTo { jumpTo = id } }, flashing: flashed == row.id,
                           mentionNames: row.mentioned.compactMap { store.names[$0] },
                           thumbnails: client.thumbnails, fileStates: fileStates, openFile: openFile)
                    .padding(.top, first ? 6 : 0)
                    .task { for f in row.attachments { await client.loadThumbnail(f) } }
            }
        }
    }

    // kosmos#7111: the room's members as the project list now has them (the list follows the status poll while a room is
    // open), so an Add goes away once the agent is a member.
    private var liveMembers: [String] { project.members.map(\.session) }   // `project` reads the live list
    // Rows whose Add is in the air (it waits, as the board's disabled button), and the sentence a refused one earned.
    @State private var adding: Set<String> = []
    @State private var addFailed: [String: String] = [:]
    private func addMemberButton(_ row: Board.RoomRow) -> some View {
        let agent = row.refusal?.key ?? ""
        let name = store.names[agent] ?? row.refusal?.who ?? agent
        return VStack(spacing: 2) {
            // On its own line under the sentence, at the size of the room notice's buttons (the board's pj-refused-act).
            Button {
                guard !adding.contains(row.id) else { return }
                adding.insert(row.id); addFailed[row.id] = nil
                Task {
                    let outcome = await store.addMember(agent, to: project.id)
                    adding.remove(row.id)
                    switch outcome {
                    case .added:
                        // Said and focused only if the room is still on screen (the board's PJ_CURRENT check).
                        guard visible else { return }
                        Self.say(Board.addedMemberLine(name))
                        composerFocused = true
                    case let .refused(why):
                        addFailed[row.id] = why
                        if visible { Self.say(why) }   // heard as well as seen (the board's role=status; review 1)
                    case .dropped: break
                    }
                }
            } label: {
                Text(Board.addMemberLabel(name)).font(.footnote.weight(.semibold)).foregroundColor(Palette.primary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12).frame(minHeight: 44).contentShape(Rectangle())
                    .background(Capsule().fill(Palette.card))
                    .overlay(Capsule().stroke(Palette.separator))
            }
            .buttonStyle(.plain)
            .disabled(adding.contains(row.id))
            if let why = addFailed[row.id] {
                Text(why).font(.footnote).foregroundColor(Palette.secondary).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
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

    // Words to post: not empty, and not only the @name Reply put there. Files alone count, as their names (kosmos#7093,
    // the board's pjPostSend), once none is still on its way, so a post never leaves one behind.
    private var postWords: String { Board.roomPostWords(draft, files: attachedHere, replyMention: replyMention) }
    private var canPost: Bool {
        // Not before the room's first read: with nothing read, an older post with the same words could settle it.
        store.rows[project.id] != nil && !postWords.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !Board.isOnlyMention(postWords, mention: replyMention) && (attachedHere.isEmpty || uploadingHere == 0)
            && attachedHere.count <= Board.maxFiles
    }

    // MARK: Adding files (kosmos#7093: the board's + on the room's composer, through the chat's upload, #7071)

    @State private var photoPicks: [PhotosPickerItem] = []
    @State private var showPhotos = false
    @State private var showFiles = false
    private var attachKey: String { Board.roomAttachKey(project.id) }
    private var attachedHere: [Board.Attached] { client.attached[attachKey] ?? [] }
    private var uploadingHere: Int { client.uploading[attachKey] ?? 0 }
    private var countedFiles: Int {
        Board.roomFilesCounted(waiting: attachedHere.count, uploading: uploadingHere, inAir: store.filesInAir(project.id))
    }
    private var atFileLimit: Bool { countedFiles >= Board.maxFiles }

    private var addButton: some View {
        Menu {
            Button { showPhotos = true } label: { Label("Photo Library", systemImage: "photo.on.rectangle") }
                .disabled(atFileLimit)
            Button { showFiles = true } label: { Label("Files", systemImage: "folder") }
                .disabled(atFileLimit)
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(Palette.primary)
                .frame(width: 34, height: 34)
                .background(Circle().fill(Palette.card))
                .overlay(Circle().stroke(Palette.separator, lineWidth: 0.5))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        // The board's own label for its + (#pj-attach).
        .accessibilityLabel("Add a file to this conversation")
        .accessibilityHint(atFileLimit ? Board.uploadRefusal(size: nil, waiting: Board.maxFiles) ?? "" : "")
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                if uploadingHere > 0 {
                    HStack(spacing: 6) {
                        ProgressView().controlSize(.small)
                        Text(uploadingHere == 1 ? "Adding a file\u{2026}" : "Adding \(uploadingHere) files\u{2026}")
                            .font(.footnote).foregroundColor(Palette.secondary)
                    }
                    .padding(.horizontal, 6)
                    .accessibilityElement(children: .combine)
                }
                ForEach(attachedHere) { a in
                    FileChip(name: a.name, remove: { client.unattach(a.id, for: attachKey) })
                }
            }
            .padding(.horizontal, 2)
            .frame(minHeight: 44)
        }
        .padding(.horizontal, 12)
    }

    // One at a time, in the order picked, as the chat adds them (its comments say why).
    private func addPhotos(_ picks: [PhotosPickerItem]) async {
        let epoch = client.chatEpoch
        let at = Date()
        client.attachLine[attachKey] = nil
        for (i, item) in picks.enumerated() {
            await store.attach(.photo(load: {
                guard let data = try? await item.loadTransferable(type: Data.self) else { return nil }
                let type = item.supportedContentTypes.first { $0.conforms(to: .image) } ?? .jpeg
                return (Board.photoName(at: at, ext: Board.imageExtension(data) ?? type.preferredFilenameExtension ?? "jpg", number: i + 1), data)
            }), epoch: epoch, to: project.id)
        }
    }

    private func addFiles(_ urls: [URL]) async {
        let epoch = client.chatEpoch
        client.attachLine[attachKey] = nil
        for url in urls { await store.attach(.file(url), epoch: epoch, to: project.id) }
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
            if let line = client.attachLine[attachKey] {
                Text(line).font(.footnote).foregroundColor(Palette.secondary)   // as the chat draws it (review 1)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.top, 4)
            }
            if !attachedHere.isEmpty || uploadingHere > 0 { chips }
            HStack(alignment: .bottom, spacing: 8) {
                addButton
                // kosmos#7268: the emoji face and the microphone inside the box, at its trailing end (the board's
                // .emojibtn sits inside its input); the box's text runs up to them.
                HStack(alignment: .bottom, spacing: 0) {
                    CursorField(placeholder: "Write something or @name to message someone…", text: $draft, focus: $typing, insert: $emojiInsert)
                        .lineLimit(1...5)
                        .accessibilityFocused($composerFocused)
                        .accessibilityLabel("Post to everyone on this project")
                        .padding(.vertical, 10).padding(.leading, 14)
                    ComposerEmojiButton(open: emojiOpen) {
                        if emojiOpen { emojiOpen = false; typing = true } else { emojiOpen = true; typing = false }
                    }
                    ComposerMicButton(dictation: dictation) {
                        dictation.toggle(base: draft) { draft = $0 }
                    }
                    .padding(.trailing, 2)
                }
                    .background(RoundedRectangle(cornerRadius: 20).fill(Palette.card))
                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(Palette.separator))
                    .overlay(alignment: .top) { mentionList.alignmentGuide(.top) { $0[.bottom] + 6 } }
                    // VoiceOver hears the list open, once, not on every letter (the board's aria-activedescendant has
                    // no iOS form; review 1), queued behind the key echo (review 2).
                    .onChange(of: mentionOptions == nil) { closed in
                        if closed { mentionRowsHeight = 0 }   // each open starts from its own estimate (review 3)
                        if !closed, let n = mentionOptions?.count { Self.say(Board.mentionOpened(n)) }
                    }
                Button { send() } label: {
                    Image(systemName: "arrow.up").font(.body.weight(.bold)).foregroundColor(Palette.sendGlyph)
                        .frame(width: 44, height: 44).background(Circle().fill(Palette.sendFill))
                }
                .disabled(!canPost)
                .opacity(canPost ? 1 : 0.5)
                .accessibilityLabel("Post")
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            if let line = ComposerExtras.micLine(dictation.state) {
                Text(line).font(.footnote).foregroundColor(Palette.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.bottom, 6)
            }
            // kosmos#7268: the emoji panel in the keyboard's place while open; typing in the box closes it.
            if emojiOpen { EmojiPanel { emojiInsert = $0 } }
        }
        .background(Palette.ground)
        .onChange(of: typing) { focused in if focused { emojiOpen = false } }
        // The panel stands in for the keyboard, which covers the tab bar; so does the panel, or its last rows sit
        // under the bar.
        .toolbar(emojiOpen ? .hidden : .automatic, for: .tabBar)
        #if DEBUG
        // KOSMOS_SAMPLE_EMOJI=open (with the room samples): the panel open, for the design shots.
        .onAppear { if RoomStore.sample, ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_EMOJI"] == "open" { emojiOpen = true } }
        #endif
        // Leaving the room lets go of the microphone and closes the panel (the board's: the panel belongs to the composer
        // being left).
        .onDisappear { dictation.reset(); emojiOpen = false }
        .onChange(of: draft) { dictation.boxChanged(to: $0) }
        // Each picker on a host of its own, as the chat's (two presentations on one view can leave one that never opens).
        .background(Color.clear.photosPicker(isPresented: $showPhotos, selection: $photoPicks,
                                             maxSelectionCount: max(1, Board.maxFiles - countedFiles),
                                             matching: .images, preferredItemEncoding: .compatible))
        .onChange(of: photoPicks) { picks in
            guard !picks.isEmpty else { return }
            photoPicks = []
            Task { await addPhotos(picks) }
        }
        .background(Color.clear.fileImporter(isPresented: $showFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): Task { await addFiles(urls) }
            case .failure: client.attachLine[attachKey] = "We could not open that file."
            }
        })
        // A new pick lands at the end; files a post put back go in front and are not announced as added (review 2).
        .onChange(of: attachedHere.map(\.id)) { [was = attachedHere.map(\.id)] ids in
            if let id = ids.last, !was.contains(id), store.cameBack[project.id]?.contains(id) != true, let name = attachedHere.last?.name {
                Self.say("Added \(name)")
            }
        }
    }

    // kosmos#7085: the board's @ picker (#312), floating just above the box so the thread never moves: the project's
    // members matching what follows the @, and a tap puts "@<key> " in its place (Board.mentionPick, tested). It shows
    // only while the box has focus. Everyone who matches, as on the board, in a list that scrolls once it would cover
    // more than about half of the thread, so at any text size the first rows stay on screen (review 1).
    @State private var threadHeight: CGFloat = 0
    // The rows' own height, measured, so the list is exactly as tall as its rows up to the cap (review 2: a maximum
    // under fixedSize is never offered more than the content, so it capped nothing).
    @State private var mentionRowsHeight: CGFloat = 0
    private var mentionOptions: [Board.ProjectMember]? {
        guard typing, let token = Board.mentionToken(draft) else { return nil }
        return Board.mentionMatches(project.members, typed: token.typed)
    }
    @ViewBuilder private var mentionList: some View {
        if let all = mentionOptions {
            Group {
                if all.isEmpty {
                    Text(Board.mentionNone).font(.footnote).foregroundColor(Palette.secondary)
                        .padding(.horizontal, 14).padding(.vertical, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    let cap = max(88, threadHeight * 0.5)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(all, id: \.session) { m in mentionRow(m) }
                        }
                        .background(GeometryReader { g in Color.clear.onAppear { mentionRowsHeight = g.size.height }
                            .onChange(of: g.size.height) { mentionRowsHeight = $0 } })
                    }
                    // Scrolling the list never takes the keyboard down, which would close it mid-scroll (review 3).
                    .scrollDismissesKeyboard(.never)
                    // Before each open's first measurement, an estimate of one 44pt row each.
                    .frame(height: min(cap, mentionRowsHeight > 0 ? mentionRowsHeight : CGFloat(all.count) * 44))
                }
            }
            .background(RoundedRectangle(cornerRadius: 14).fill(Palette.card).shadow(color: .black.opacity(0.10), radius: 12, y: 4))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Palette.separator))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Agents on this project")
        }
    }
    private func mentionRow(_ m: Board.ProjectMember) -> some View {
        Button {
            if let text = Board.mentionPick(draft, key: m.session) { draft = text }
            // VoiceOver goes back to the box (review 1: the row it was on is gone, and focus fell to the top).
            composerFocused = true
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(m.name).foregroundColor(Palette.primary)
                if m.name != m.session {
                    Text("@" + m.session).font(.footnote.monospaced()).foregroundColor(Palette.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(m.name == m.session ? m.name : m.name + ", @" + m.session)
        .accessibilityHint("Puts @" + m.session + " in your post")
    }

    // The box clears at once, so the person can keep typing. A refused or not-confirmed post's words come back through
    // the store (RoomStore.returned), which keeps them if the person has left the room or typed something since.
    private func send() {
        guard canPost else { return }
        dictation.stop()   // kosmos#7268 review 1: before the box is cleared, so no late result brings the words back
        let text = postWords
        let reply = replying
        let files = attachedHere
        client.attachLine[attachKey] = nil
        draft = ""; replying = nil; replyMention = nil
        if searching { sentWhileSearching = true }
        hiddenBySearch = false   // the post is the newest thing to say
        Task { await store.post(text, to: project.id, replyTo: reply, files: files) }
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
    // kosmos#7101: a reply's header goes to the post it answers (the board's #3745), and that post flashes.
    var jump: () -> Void = {}
    var flashing = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotionHere

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
        // kosmos#7101 review 2: a reply's double-tap goes to the post it answers, as its label says. Only on a reply,
        // so every other post keeps the double-tap it had.
        .modifier(ReplyJumpDefault(on: replied != nil, jump: jump))
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
            if replied != nil {
                Button(Board.replyJumpAction, action: jump)
                // The double-tap goes, as the label says (review 2); the agent's chat, which the avatar gave it, stays.
                if !mine && last && row.kind != .external { Button("Open \(name)'s chat", action: openAgent) }
            }
            // The post is read as one element and its cards are not buttons in it, so each file is an action on it
            // (kosmos#7062), saying what the card would: opening, another file opening, failed, or opens on the board.
            ForEach(Array(row.attachments.enumerated()), id: \.offset) { _, f in
                Button(fileActionName(f)) { openFile(f) }
            }
        }
    }

    // The board's --gold-deep, in both themes, as the board draws it.
    static let flashGold = Palette.pair(Board.replyFlashHex, Board.replyFlashHex)

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
                // kosmos#7101: a button, as the board's .msg-replyto: a tap goes to the post it answers. A 44 pt place to
                // tap, laid out as the header alone.
                let gist = Board.replyGist(replied, shownName: nameOf(replied))
                Button(action: jump) {
                    Text("\(nameOf(replied)): \(gist)")
                        .font(.footnote).foregroundColor(Palette.secondary).lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .padding(.leading, 8).overlay(Rectangle().fill(Palette.separator).frame(width: 2), alignment: .leading)
                        // A real 44 pt minimum (review 2: a hit area hung past the header overlapped the words below).
                        .frame(minHeight: 44, alignment: .leading).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                // Read as the board's label (review 1), as words in the post; the jump is the post's double-tap (below).
                .accessibilityRepresentation { Text(Board.replyJumpLabel(who: nameOf(replied), gist: gist)) }
            } else if row.replyTo != nil && roomComplete {
                Text("Original message unavailable").font(.footnote).foregroundColor(Palette.tertiary)
            }
            if !words.isEmpty || row.attachments.isEmpty {
                Text(row.kind == .external ? AttributedString(words) : Self.withMentions(Board.messageText(words), mentioned: row.mentioned, names: mentionNames))
                    .font(.body).foregroundColor(Palette.primary).tint(Palette.link)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // kosmos#7130: the board's line under an outside row shown while this computer was waiting to be let in, in
            // the room's secondary text (.msg-ext-unv). Read with the post; Copy takes the words only, as the board's.
            if row.kind == .external && row.unverified {
                Text(Board.unverifiedLine).font(.caption).foregroundColor(Palette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, -2)   // the board's margin-top: 2px under the words (the stack's spacing is 4)
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
        // kosmos#7101: the board's .msg-flash, a gold-deep outline on the post a reply's header went to, fading out.
        // A 2 pt ring 2 pt out, as the board's outline-offset, its corners kept parallel to the bubble's (review 5).
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Self.flashGold, lineWidth: 2).padding(-4)
            .opacity(flashing ? 1 : 0).animation(reduceMotionHere ? nil : .easeOut(duration: 0.3), value: flashing))
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

// kosmos#7080: the board's three working dots (.act i), fading in turn 0.16s apart. Grey and fade-only, as the phone's
// chat WorkingLine (the board's are green and also rise 4px). With Reduce Motion they still fade, slower (the board's
// work-fade, #4591: Josh read still dots as frozen; a fade is not movement). Opacity is read from the clock (review 1:
// a repeatForever started on appear can catch layout changes in a pushed view), at 30 frames a second at most.
struct WorkingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    // With the person's text size, as the line beside them (review 4).
    @ScaledMetric(relativeTo: .footnote) private var size: CGFloat = 4
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let period = reduceMotion ? 1.6 : 1.1, low = reduceMotion ? 0.35 : 0.45
            HStack(spacing: size * 0.75) {
                ForEach(0..<3, id: \.self) { i in
                    Circle().fill(Palette.secondary).frame(width: size, height: size)
                        .opacity(low + (1 - low) * (0.5 - 0.5 * cos((t - Double(i) * 0.16) * 2 * .pi / period)))
                }
            }
        }
    }
}

// kosmos#7101: the double-tap of a reply's post is the jump (a modifier, so posts that are not replies are untouched).
private struct ReplyJumpDefault: ViewModifier {
    let on: Bool
    let jump: () -> Void
    func body(content: Content) -> some View {
        if on { content.accessibilityAction(.default, jump) } else { content }
    }
}

extension Notification.Name {
    // kosmos#7096: the room on screen for this project id scrolls to its newest post.
    static let roomScrollToEnd = Notification.Name("kosmos.roomScrollToEnd")
}
