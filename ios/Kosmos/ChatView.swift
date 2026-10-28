import SwiftUI
import QuickLook
import PhotosUI
import UniformTypeIdentifiers

// kosmos#7008 (the iPhone plan's slice 3, first part): one agent's conversation, native, built to Mona Lisa's slice 3a
// spec (~/work/workers/monalisa/ios-design-2026-10-19/slice3a/SPEC.md, on the card). Reads and sends through
// BoardClient's own session to the Mac (the routes the board's chat uses). What this part does not draw (a question's
// buttons, a permission card, a file, older messages) is a way-through row that opens the agent's chat on the board,
// as the header's info button does. The layout and sending decisions are in BoardLogic.swift (tested).
struct ChatView: View {
    @ObservedObject var client: BoardClient
    let agent: Board.Agent
    let openOnBoard: () -> Void
    // kosmos#7267: the info button opens the agent's own page (Profile | AI Settings), not the board's copy of this chat.
    @State private var infoOpen = false
    #if DEBUG
    static var sampleInfoOpened = false
    #endif
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var thread: Board.Thread?
    @State private var lastRead: Date?
    @State private var failedReads = 0
    // The Mac's own reason it gave no conversation (a name it refuses, a history it could not read).
    @State private var refusal: String?
    @State private var loop: Task<Void, Never>?
    @State private var atBottom = true
    // kosmos#7265 (measured on the simulator, 10-27): the end marker leaving the screen was read as the person scrolling
    // up, but new rows push it off too, and a re-pin can land a row short, so a reader at the newest message was left
    // behind and never followed again. On iOS 18 only the person's own scroll (scroll phase interacting or decelerating)
    // moves atBottom; endVisible is the marker as it is, read when their scroll comes to rest.
    @State private var endVisible = true
    // kosmos#7265 (iOS 17+, idAnchor): the message the list is anchored on; "end" keeps the newest in view.
    @State private var positionId: String?
    @State private var personScrolling = false
    // kosmos#7265 (Josh 10-27): the id of the first eager row, fixed when the conversation is first drawn (eagerStart).
    @State private var eagerFrom: String?
    @State private var unseenNew = false
    // The words in the box. Kept here while the chat is open (typing redraws only the chat) and given to the client when
    // it goes, so leaving the chat never loses them.
    @State private var draftText = ""
    // kosmos#7348: the text of the last send and when, so the box filling back with it is cleared again.
    @State private var lastSent: (text: String, at: Date)?
    // Reads are numbered: only one newer than the last shown is shown, so a slow earlier read never undoes a newer one.
    @State private var readsStarted = 0
    @State private var readShown = 0
    // Shown on screen (not just alive in a hidden tab), and the client's forgetting count this chat was opened under.
    @State private var visible = false
    @State private var epoch = 0
    @State private var lastPendingCount = 0
    @State private var keepNewestInView = true
    // kosmos#7016: a lasting choice pressed once (armed until a second press, another press, 15 s, or leaving the chat),
    // the line a press left for its question (not sure it went, or the Mac's refusal), and the line over the composer
    // when a typed send waits for a press in the air.
    @State private var armed: Board.Armed?
    // The question a press may have answered (its buttons say so while it is up), and the conversation's line for a
    // press that did not go or may have gone.
    @State private var unsureKey: String?
    @State private var pressLine: String?
    // The question that line is about: it goes when a read shows that question gone.
    @State private var pressLineKey: String?
    @State private var composerNote: String?
    // kosmos#7346 review: the reason a Send could not go, and the box text it was about; any other text clears it.
    @State private var blocked: (text: String, note: String)?
    // kosmos#7136: the refusal a Try again wrote there, so a later one that works clears only its own line (dmRetrySend).
    @State private var retryNote: String?
    // kosmos#7136: rows sent again whose answer is in but whose next read is not: still drawn "sending…", so the stale
    // failed line cannot offer a second Try again before the read shows the row as it now is.
    @State private var retrySettling: Set<String> = []
    // kosmos#7016 part 3: the earlier messages loaded in this chat (the board's EARLIER, per open chat), whether the
    // top of the thread is on screen, and whether the first scroll to the newest message is done.
    @State private var earlier = Board.Earlier()
    @State private var topVisible = false
    @State private var settledAtEnd = false
    // The row to keep at the top once a page has landed above it.
    @State private var keepAnchor: String?
    // kosmos#7265 review 2: a page landed while the reader was at the newest message: keep them there, without animation.
    // A count, not a flag (measured on the simulator, 10-27): a flag set in the same update that first draws the scroll
    // view never reached onChange, stayed true, and every later request was true to true, so nothing re-pinned.
    @State private var keepAtEndTick = 0
    // Review 3: whether the end marker has ever shown (atBottom starts true, so it alone cannot say the reader got there).
    @State private var endSeen = false
    // The conversation's items on screen now.
    @State private var onScreen: Set<String> = []
    // kosmos#7420 diagnostic: the list's size, the keyboard's height, the stack's width, and the report once one is made.
    @State private var diagViewport: CGSize = .zero
    @State private var diagKeyboard: CGFloat = 0
    @State private var diagContentWidth: CGFloat = 0
    @State private var diagReport: String?
    @State private var diagDone = false   // once per open chat, even after the line is dismissed
    @State private var diagWideDone = false   // review 2: a width finding has its own once, so it cannot use up the blank one
    @State private var diagShownOnce = false   // review 2: the record starts at the chat's first showing, not each return
    // Review 4: when this conversation's messages arrived, and whether any row has drawn since, for the never-drawn case.
    @State private var diagThreadAt: Date?
    @State private var diagEverDrew = false
    @State private var diagTick = 0   // bumped when the last row leaves the screen (review 1)
    private var diagWide: Bool { diagViewport.width > 0 && diagContentWidth > diagViewport.width + 1 }
    // kosmos#7016 part 2: each file card's state, and the file open in Quick Look.
    @State private var fileStates: [String: FileCardState] = [:]
    @State private var previewURL: URL?
    // The file Quick Look was given, kept apart so its removal never depends on which value a closure captured.
    @State private var openedFile: URL?
    // Bumped when the arm window or the answered lock ends, so the buttons redraw then.
    @State private var tick = 0
    // kosmos#7071: the + beside the composer (Photo Library or Files).
    @State private var photoPicks: [PhotosPickerItem] = []
    @State private var showPhotos = false
    @State private var showFiles = false
    // kosmos#7083: the agent's message the next send answers (the board's DM reply strip); the box's focus, taken by
    // Reply; the last reaction refusal shown (only it is cleared by the next reaction that goes); reactions in the air.
    @State private var replying: Board.ChatRow?
    @FocusState private var composerFocused: Bool
    // kosmos#7268: the emoji panel (in the keyboard's place while open), the glyph waiting to go in at the cursor, and
    // dictation into the box, as the project room's (RoomView).
    @State private var emojiOpen = false
    @State private var emojiInsert: ComposerExtras.Pick?
    @StateObject private var dictation = Dictation()
    @State private var reactNote: String?
    @State private var reacting: Set<String> = []
    // kosmos#7089: the search field's words. The thread shows only the loaded rows they match (Board.chatFilter).
    @State private var query = ""
    // The field is on screen when the magnifier opened it or while it holds words (Mona Lisa's #7089 design): a search
    // that is on is never out of sight, and an empty one takes no room.
    @State private var searchOpen = false
    // Whether the reader was at the newest message when the magnifier opened the row, which pushes the thread down: it
    // is scrolled back there as the row opens, and the keyboard keeps it there.
    @State private var openedAtNewest = false
    // Counts clears, so a clear's delayed steps act only if no later clear came after it.
    @State private var clears = 0
    @FocusState private var searchFocused: Bool
    // A message went while the search was on: the line under the composer says it shows only if it matches. Last in
    // line, so a refused press or file is never hidden behind it.
    @State private var sentWhileSearching = false
    private var searching: Bool { Board.chatSearching(query) }
    // The row open or a search on: no earlier pages (the board's earlierNearTop), so editing the words, even back to
    // none, never loads one under the reader.
    private var searchMode: Bool { searchOpen || searching }
    // Whether this open of the search filtered the thread at some point: only then is the reader's place gone, and
    // putting the row away takes them to the newest message.
    @State private var filteredInMode = false

    // The agent as the list shows it now (its word and tone move with the board), or as it was tapped.
    private var shown: Board.Agent { client.agents.first { $0.session == agent.session } ?? agent }
    private var running: Bool { client.isRunning(agent) }
    private var lost: Bool { failedReads >= 3 }
    private var working: Bool { !lost && Board.tone(shown) == .working }
    private var pending: [Board.PendingSend] { client.pending[agent.session] ?? [] }
    private var widthShare: CGFloat { typeSize.isAccessibilitySize ? 0.85 : 0.78 }

    var body: some View {
        // Read here so the end of an arm window or an answered lock redraws the buttons (redraw(after:)).
        let _ = tick
        VStack(spacing: 0) {
            if thread != nil, let note = bannerText { banner(note) }
            if let diagReport { diagLine(diagReport) }   // kosmos#7420
            if searchMode { searchBar }
            ZStack(alignment: .bottom) {
                conversation
                // Not over a search: new messages are not followed then (follow), so it would offer a jump in a filtered list.
                if unseenNew && !searching { newMessagesCapsule }
            }
            // kosmos#7346 (Josh 10-27, Mona Lisa's design): the message box sits on a solid strip down to the home indicator,
            // with messages fading into it; the inset keeps the newest message above the box.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    if let line = composerNote ?? attachLine ?? pressLine ?? (sentWhileSearching ? Board.chatSentWhileSearching : nil) {
                        Text(line).font(.footnote).foregroundColor(composerNote == nil && attachLine == nil && pressLine != nil ? Palette.dangerWord : Palette.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            // Mona Lisa's spec: 16 pt side margins, 6 pt above the composer.
                            .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 6)
                            .background(Palette.ground)
                            .onAppear { UIAccessibility.post(notification: .announcement, argument: line) }
                            .onChange(of: line) { now in UIAccessibility.post(notification: .announcement, argument: now) }
                    }
                    composer
                }
                // kosmos#7346 (Josh 10-27 19:59): solid behind and below the box, down to the home indicator, as Discord: no
                // message shows through or under it. The inset already ends the list above this strip.
                .background(Palette.ground.ignoresSafeArea(edges: .bottom))
                // Josh 10-27: "with a slide fade into it so it looks smooth": messages fade into the strip over fadeHeight above it,
                // never a hard edge. Drawn over the list, so it takes no room and no touches.
                .overlay(alignment: .top) {
                    LinearGradient(colors: [Palette.ground.opacity(0), Palette.ground], startPoint: .top, endPoint: .bottom)
                        .frame(height: ChatView.fadeHeight).offset(y: -ChatView.fadeHeight).allowsHitTesting(false).accessibilityHidden(true)
                }
            }
        }
        .background(Palette.ground.ignoresSafeArea())
        // Mona Lisa's review: the tab bar would stack under the composer and take about 170pt, so it hides here.
        .toolbar(.hidden, for: .tabBar)
        .quickLookPreview($previewURL)
        // Closed: the file it showed is removed from the phone (#7016 review 1).
        .onChange(of: previewURL) { now in
            if let was = openedFile, was != now { client.closed(was); openedFile = now }
        }
        .navigationBarTitleDisplayMode(.inline)
        .kosmosSolidTopBar(fade: false)   // kosmos#7346 (Josh 10-27 20:21): no row shows behind the top bar; its fade is on the conversation
        .toolbar {
            // kosmos#7424 (Josh 10-27 20:49): the name and status open the same page as the info button.
            ToolbarItem(placement: .principal) {
                // Review 3: the whole title is the tap target, at least 44 pt tall, gaps included.
                Button { infoOpen = true } label: { title.frame(minHeight: 44).contentShape(Rectangle()) }.buttonStyle(.plain)
                    .accessibilityHint("Opens \(shown.name)\u{2019}s profile and AI settings")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    // With the row already open it only puts the cursor back in the field.
                    let opening = !searchOpen
                    if opening { openedAtNewest = atBottom }
                    searchOpen = true
                    DispatchQueue.main.async {
                        searchFocused = true
                        if opening && openedAtNewest { NotificationCenter.default.post(name: .chatScrollToEnd, object: nil) }
                    }
                } label: {
                    Image(systemName: "magnifyingglass").font(.system(size: 20)).foregroundColor(Palette.secondary)
                        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                .accessibilityLabel("Search this conversation")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { infoOpen = true } label: {
                    Image(systemName: "info.circle").font(.system(size: 22)).foregroundColor(Palette.secondary)
                }
                .accessibilityLabel("\(shown.name)\u{2019}s profile and AI settings")
            }
        }
        // kosmos#7267: on the chat itself, not inside the toolbar item (a link there is outside the navigation and
        // never pushes).
        .background(NavigationLink(isActive: $infoOpen, destination: {
            AgentInfoView(client: client, agent: agent, openOnBoard: openOnBoard)
        }, label: { EmptyView() }).hidden())
        #if DEBUG
        // KOSMOS_SAMPLE_INFO=profile|ai with KOSMOS_SAMPLE_OPEN: the sample agent's page, open, for the design shots.
        .onAppear {
            let env = ProcessInfo.processInfo.environment
            // Once a launch, so Back leaves the page (review 2: it pushed again each time the chat reappeared).
            if env["KOSMOS_SAMPLE_AGENTS"] == "1", env["KOSMOS_SAMPLE_INFO"] != nil, !ChatView.sampleInfoOpened {
                ChatView.sampleInfoOpened = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { infoOpen = true }
            }
        }
        #endif
        .onAppear {
            visible = true
            // kosmos#7420 review 1 and 2: the record starts with this chat's first showing (a return from the info page keeps
            // what came before), and a list blank from its first draw is checked too, since no row ever leaves it.
            if !diagShownOnce { diagShownOnce = true; Self.diagRing = []; Self.trace("chat shown") } else { Self.trace("chat back") }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { diagTick &+= 1 }
            epoch = client.chatEpoch
            // kosmos#7420: this conversation gets no banner while it shows.
            if let host = client.switcherShown { PushNotificationManager.chatOnScreen = PushBridge.OpenChat(host: host, session: agent.session) }
            lastPendingCount = pending.count
            // Only into an empty box: if SwiftUI shows the chat again without having hidden it, the words being typed stay.
            if draftText.isEmpty { draftText = client.drafts[agent.session] ?? "" }
            startReading()
        }
        .onDisappear {
            visible = false
            if PushNotificationManager.chatOnScreen?.session == agent.session { PushNotificationManager.chatOnScreen = nil }   // review 3: by session on purpose: a computer switch while open must never leave a stale value hiding banners; the cost is an extra banner
            armed = nil
            // A reading posture, not the chat's state: coming back shows the whole conversation (the board clears its
            // search on opening another agent). What the search changed goes with it here, not in onChange(of: query),
            // which need not run for a view that is off screen. Coming back, the whole thread lays out where the short one
            // was: settle it again, as clearing does.
            if filteredInMode { settledAtEnd = false }
            filteredInMode = false
            query = ""
            searchOpen = false
            openedAtNewest = false
            sentWhileSearching = false
            dictation.stop()   // kosmos#7268 review 2: before the draft is saved, so no late result is lost from it
            // Not into another account's chats: a draft from before a sign-out is dropped with the rest.
            if epoch == client.chatEpoch { client.drafts[agent.session] = draftText }
            loop?.cancel()
            loop = nil
        }
        .onChange(of: thread) { _ in recomputeHiddenHeads() }
        .onChange(of: query) { _ in sentWhileSearching = false }
        // Leaving an empty field puts it away; one with words stays (searching keeps it drawn).
        .onChange(of: searchFocused) { now in if !now && !searching && searchOpen { putSearchAway() } }
        .onChange(of: searching) { now in if now { filteredInMode = true } }
        // Putting away a search that filtered is reading at the bottom again: what loaded meanwhile is there to see.
        .onChange(of: searchMode) { now in
            guard !now && filteredInMode else { return }
            filteredInMode = false
            // Not when the search went with the conversation (an account reset empties both).
            guard visible && thread != nil else { return }
            let cleared = epoch
            clears += 1
            let clear = clears
            // The whole thread comes back at the place the short one left, usually its top: until the scroll to the
            // newest settles, that top is not a reader asking for earlier messages (as on opening). The end marker or
            // the top leaving settles it; a chat too short to scroll moves neither, so a second settles it then.
            settledAtEnd = false
            NotificationCenter.default.post(name: .chatScrollToEnd, object: nil)
            // Again a turn later, once the whole thread has laid out: the first can land short on estimated heights.
            DispatchQueue.main.async {
                if !searchMode && visible && epoch == cleared && clears == clear { NotificationCenter.default.post(name: .chatScrollToEnd, object: nil) }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                if !searchMode && visible && epoch == cleared && clears == clear && !settledAtEnd { settledAtEnd = true; loadEarlier() }
            }
        }
        .onChange(of: earlier) { _ in recomputeHiddenHeads() }
        // Signed out, another account or another Mac: what this chat shows belongs to the one before, so it goes.
        .onChange(of: client.chatEpoch) { now in
            diagDone = false; diagWideDone = false; diagReport = nil   // kosmos#7420 review 1: another account or computer is a new chat
            diagThreadAt = nil; diagEverDrew = false   // review 4
            dictation.reset(); emojiOpen = false   // kosmos#7268: another account's conversation starts clean
            epoch = now
            endSeen = false   // kosmos#7265 review 3: a rebuilt thread has not shown its end yet
            positionId = nil; personScrolling = false; endVisible = true   // kosmos#7265 review: a fresh chat's anchor
            eagerFrom = nil   // kosmos#7265: the next conversation picks its own eager start
            thread = nil
            replying = nil
            retryNote = nil
            retrySettling = []
            earlier = Board.Earlier()
            settledAtEnd = false
            fileStates = [:]
            previewURL = nil
            openedFile = nil
            armed = nil
            unsureKey = nil
            pressLine = nil
            composerNote = nil
            filteredInMode = false
            query = ""
            searchOpen = false
            openedAtNewest = false
            sentWhileSearching = false
            draftText = ""
            refusal = nil
            failedReads = 0
        }
        .onChange(of: scenePhase) { phase in
            Self.trace("app \(phase == .active ? "active" : phase == .background ? "background" : "inactive")")   // kosmos#7420
            if phase == .background { loop?.cancel(); loop = nil } else if phase == .active, visible, loop == nil { startReading() }
        }
    }

    private var title: some View {
        let tone = Board.tone(shown)
        let strong = tone == .asked || tone == .needsYou
        return VStack(spacing: 1) {
            Text(shown.name).font(.headline).foregroundColor(Palette.primary).lineLimit(1)
            // Lost while open: the word goes quiet, since it is no longer current (spec, state 4).
            Text(Board.statusWord(shown))
                .font(.caption.weight(strong && !lost ? .semibold : .regular))
                .foregroundColor(lost ? Palette.secondary : Palette.word(tone))
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }

    // Above a conversation already shown: the Mac's own reason, or that it stopped answering.
    private var bannerText: String? {
        if let refusal { return refusal }
        guard lost else { return nil }
        let time = lastRead.map { " Last checked \($0.formatted(date: .omitted, time: .shortened))." } ?? ""
        return Shell.notUpdatingLine(client.failingMacName) + time   // kosmos#7197: named
    }

    private func banner(_ text: String) -> some View {
        Text(text)
            .font(.footnote).foregroundColor(Palette.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Palette.banner)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 16)
            .padding(.top, 8)
    }

    // MARK: - The conversation

    // kosmos#7265: how many of the newest rows are drawn eagerly, more than a screen of short messages. Measured on the
    // simulator (a 260-message chat of varied lengths, the newest message read at 4 s and 10 s): 10 of 10 on the newest
    // message (rounds 14, 16, 17); with every row lazy about 1 in 10. 0 in the Debug no-fix arm.
    static var eagerTail: Int { sampleNoFix ? 0 : 40 }

    // One row of the conversation, with what the thread needs to know about it.
    private func row(_ item: Board.ChatItem) -> some View {
        itemView(item).id(item.id)
            // Which rows are on screen, so a page landing above keeps the one the reader is on. The eager rows all
            // appear and go together (kosmos#7265), so they count as on screen while any of them shows.
            .onAppear { onScreen.insert(item.id); if !diagEverDrew { diagEverDrew = true } }
            .onDisappear {
                onScreen.remove(item.id)
                if onScreen.isEmpty { diagTick &+= 1 }   // kosmos#7420: the diagnostic's check, only when the last row leaves
            }
    }

    @ViewBuilder private var conversation: some View {
        if let thread {
            // Day lines run across loaded pages, so a page that ends mid-day does not repeat that day's line.
            // A search shows only the loaded rows it matches, day lines worked out over those (the board repaints the
            // filtered rows the same way).
            let loaded = Board.shownRows(earlier, thread: thread)
            let rows = Board.chatFilter(loaded, agentName: shown.name, query: query)
            let items = Board.chatItems(rows, now: Date(), calendar: .current)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        // Earlier messages load by themselves when the person reaches the top (the board's
                        // earlierNearTop); the line says only that a page is loading, or that one failed, with Try again.
                        earlierFailedLine
                        Color.clear.frame(height: 1).id("top")
                            .onAppear { Self.trace("top appear"); topVisible = true; loadEarlier() }
                            .onDisappear {
                                topVisible = false
                                // The top leaving after the first layout proves the jump to the newest message
                                // happened, even if the end marker was not reached (estimated row heights). Not when
                                // it leaves because a reset took the conversation away (review 4).
                                // self.thread, the chat's state: inside `if let thread` a bare `thread` is the
                                // unwrapped copy and is never nil (review 7).
                                if self.thread != nil { settledAtEnd = true }
                            }
                        if thread.rows.isEmpty && pending.isEmpty { empty }
                        else if searching && rows.isEmpty && !loaded.isEmpty { noMatch }
                        // kosmos#7265: on iOS 16 the newest rows are one eager stack (real heights, so the jump to "end"
                        // lands); on iOS 17+ every row is lazy and the id anchor holds the place (see idAnchor).
                        chatRows(items)
                        pendingBubbles
                        if working { WorkingLine(name: shown.name).padding(.top, 12).id("working") }
                        Color.clear.frame(height: ChatView.fadeHeight + 8).id("end")   // the fade plus 8 pt (kosmos#7346): at the end, the newest message sits clear of it
                            .onAppear {
                                Self.trace("end appear (atBottom was \(atBottom), endSeen was \(endSeen))")
                                endVisible = true
                                atBottom = true; unseenNew = false; endSeen = true
                                // The first scroll has settled when the newest message is really on screen (not after
                                // a time): from then on, reaching the top is the person scrolling up. Checked a turn
                                // later, so the top's own disappearance from the same jump has landed first; a chat too
                                // short to scroll still shows its top then, and loads by itself.
                                if !settledAtEnd { DispatchQueue.main.async { settledAtEnd = true; loadEarlier() } }
                            }
                            .onDisappear {
                                Self.trace("end disappear (personScrolling \(personScrolling))")
                                endVisible = false
                                if !Self.followsScrollPhase || personScrolling { atBottom = false }
                            }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    // kosmos#7420 diagnostic: the stack's width (wider than the list is the shift-left Josh saw).
                    .background(GeometryReader { g in
                        Color.clear.onAppear { diagContentWidth = g.size.width }.onChange(of: g.size.width) { diagContentWidth = $0 }
                    })
                    .modifier(PositionTargets(on: Self.idAnchor))
                }
                .modifier(PositionById(on: Self.idAnchor, id: $positionId))
                .scrollDismissesKeyboard(.interactively)
                .modifier(PersonScroll(scrolling: $personScrolling) {
                    // Their scroll has come to rest: they are at the newest message exactly when the end shows.
                    atBottom = endVisible
                    if endVisible { unseenNew = false }
                    Self.trace("person scroll rested, atBottom \(endVisible)")
                })
                // While a page loads the line floats over the thread's top edge and takes no room, so nothing moves
                // (the board's paintOlderLine).
                .kosmosTopFade()   // kosmos#7346: rows fade under the solid top bar; the banner and search above stay clear
                .overlay(alignment: .top) { earlierLoadingLine }
                // kosmos#7420 diagnostic: the list's size, and a check whenever no message is on screen.
                .background(GeometryReader { g in
                    Color.clear.onAppear { diagViewport = g.size }
                        .onChange(of: g.size) { now in diagViewport = now; Self.trace("viewport \(Int(now.width))x\(Int(now.height))") }
                })
                // Review 1: driven by a tick bumped only when the last row leaves (row()), never by reading onScreen here,
                // which would redraw the whole chat on every row that scrolls in or out. Checked at 0.5 s and again at 1.5 s.
                .onChange(of: diagTick) { _ in
                    for wait in [0.5, 1.5] { DispatchQueue.main.asyncAfter(deadline: .now() + wait) { diagCheck(proxy, count: items.count) } }
                }
                // Review 1: a row wider than the list, measured in one pass (diagContentWidth carries the list's width beside it)
                // and still so 0.3 s later, so a rotation or resize between two readers cannot fire it.
                .onChange(of: diagWide) { wide in
                    guard wide else { return }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { if diagWide { diagCapture(proxy, why: "a row wider than the screen", count: items.count, recover: false) } }
                }
                // Review 4 and 5: the list first existing (the messages arrived) starts the never-drawn clock, and a check runs
                // once it has passed. Here, not an onChange inside this branch, which never sees its own creation.
                .onAppear {
                    diagThreadAt = Date(); diagEverDrew = !onScreen.isEmpty
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) { diagTick &+= 1 }
                }
                .onAppear {
                    // kosmos#7265: the eager stack starts at this row for as long as the chat stays open.
                    let firstEager = Board.eagerStart(items, from: nil, eager: Self.eagerTail)
                    if eagerFrom == nil, firstEager < items.count { eagerFrom = items[firstEager].id }
                    goNewest(proxy)
                    #if DEBUG
                    // Screenshots and checks only: KOSMOS_SAMPLE_SCROLLTOP=1 scrolls to the top 3 s after opening, as a
                    // person would (nothing in the simulator can scroll here).
                    // kosmos#7265: KOSMOS_SAMPLE_SCROLLUP=<n> scrolls 3 s after opening so the n-th row from the end is at the
                    // top, as a reader scrolled up would be, to see whether later reads move it.
                    if let up = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SCROLLUP"].flatMap(Int.init), up > 0, items.count > up {
                        let target = items[items.count - up].id
                        // Counts as the person's own scroll (nothing in the simulator can drag).
                        // With the id anchor, a person's scroll moves the anchor; a scrollTo alone would not, so move it too.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                            if Self.idAnchor { positionId = target } else { proxy.scrollTo(target, anchor: .top) }
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3.6) { atBottom = endVisible; Self.trace("debug scroll-up rested, atBottom \(endVisible)") }
                    }
                    if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SCROLLTOP"] == "1" {
                        // Twice: the first reaches the top and loads a page; the second shows what landed above.
                        for at in [3.0, 6.0] {
                            // With the id anchor a person's scroll moves the anchor, so the hook moves it too.
                            DispatchQueue.main.asyncAfter(deadline: .now() + at) {
                                if Self.idAnchor { positionId = "top"; atBottom = false } else { withAnimation { proxy.scrollTo("top", anchor: .top) } }
                            }
                        }
                    }
                    #endif
                }
                // The place kept after a page lands above: the row that was first stays at the top.
                .onChange(of: keepAnchor) { id in
                    guard let id else { return }
                    // The id anchor already keeps the reader's message in place as a page lands above (kosmos#7265).
                    if Self.idAnchor { keepAnchor = nil; return }
                    Self.trace("keepAnchor scrollTo a message")   // kosmos#7420 review 1: no message id in the record
                    proxy.scrollTo(id, anchor: .top)
                    keepAnchor = nil
                }
                .onChange(of: keepAtEndTick) { _ in
                    Self.trace("keepAtEnd scrollTo end")
                    if Self.idAnchor { goNewest(proxy); return }
                    if !Self.sampleNoKeep {
                        // iOS 16: after the new rows have laid out, and once more a beat later (the else is the debug control).
                        DispatchQueue.main.async { proxy.scrollTo("end", anchor: .bottom) }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { proxy.scrollTo("end", anchor: .bottom) }
                    } else {
                        proxy.scrollTo("end", anchor: .bottom)
                    }
                }
                .onChange(of: Board.followKey(thread)) { _ in follow(proxy) }
                .onChange(of: working) { now in if now { follow(proxy) } }
                // Only a message just sent scrolls down; one settling into its row does not move the person's place.
                // While searching too, unlike the board's jumpToOwnSend: the phone keeps the sent bubble on screen below
                // what matched, and it is the send's only feedback.
                .onChange(of: pending.count) { n in
                    if n > lastPendingCount { goNewest(proxy, animated: true) }
                    lastPendingCount = n
                }
                // The keyboard shrinks the thread; one that was at the newest message stays there (the spec).
                // Whether it was at the newest message is read before the keyboard shrinks the thread (which hides the
                // end marker), and acted on once it is up.
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { n in
                    if visible { diagKeyboard = (n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect)?.height ?? 0; Self.trace("keyboard up \(Int(diagKeyboard)) (atBottom \(atBottom))") }
                    keepNewestInView = atBottom || (searchOpen && openedAtNewest && !searching)
                }
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                    if keepNewestInView { goNewest(proxy, animated: true) }
                }
                // Only the chat on screen: another tab can keep a chat alive under it.
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
                    if visible { diagKeyboard = 0; Self.trace("keyboard down") }
                }
                .onReceive(NotificationCenter.default.publisher(for: .chatScrollToEnd)) { _ in
                    guard visible else { return }
                    goNewest(proxy, animated: true)
                }
            }
        } else {
            VStack(spacing: 12) {
                Spacer()
                if let refusal {
                    Text(refusal).font(.subheadline).foregroundColor(Palette.primary).multilineTextAlignment(.center)
                    WayThroughRow(text: Text("Open this chat on your computer's board \u{203A}"), action: openOnBoard)
                } else if lost {
                    Text(Shell.macUnreachableTitle(client.failingMacName)).font(.headline).foregroundColor(Palette.primary)
                    WayThroughRow(text: Text("Open this chat on your computer's board \u{203A}"), action: openOnBoard)
                } else {
                    ProgressView()
                    Text("Loading the conversation\u{2026}").font(.footnote).foregroundColor(Palette.secondary)
                }
                Spacer()
                // A message sent before any conversation was read is still shown, with its not-sent line if it fails.
                VStack(spacing: 0) { pendingBubbles }
            }
            .padding(.horizontal, 32)
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder private var pendingBubbles: some View {
        ForEach(pending) { p in
            PendingBubble(item: p, widthShare: widthShare, line: Board.notSentLine(agentRunning: running, name: shown.name),
                          retry: { sendWhenFree { await client.retry(p.id, to: agent) } },
                          delete: { client.discard(p.id, for: agent.session) },
                          head: headFor(replyTo: p.replyTo), headHidden: pendingHeadsHidden.contains(p.id),
                          dropReply: p.replyTo != nil && Board.replyRefusedForGood(failedReason(p))
                              ? { sendWhenFree { await client.retryWithoutReply(p.id, to: agent) } } : nil)
                .padding(.top, 10)
                .id(p.id)
        }
    }

    // kosmos#7265 debug: KOSMOS_SAMPLE_EAGERALL=1 draws every row eagerly, to see whether estimated heights move the reader.
    static let sampleEagerAll: Bool = {
        #if DEBUG
        return ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_EAGERALL"] == "1"
        #else
        return false
        #endif
    }()
    // The lazy older rows, then the newest as one eager stack where eagerStartIndex says (kosmos#7265).
    @ViewBuilder private func chatRows(_ items: [Board.ChatItem]) -> some View {
        let tailStart = eagerStartIndex(items)
        ForEach(items[..<tailStart]) { item in row(item) }
        VStack(alignment: .leading, spacing: 0) {
            ForEach(items[tailStart...]) { item in row(item) }
        }
    }

    // kosmos#7265: to the newest message. With the id anchor (idAnchor) the anchor is the end marker, which keeps the
    // end in view as rows land, until the person's own scroll moves the anchor; re-set through nil so a repeat is seen.
    // Under the anchor the move is not animated (`animated` applies to the iOS 16 path only).
    private func goNewest(_ proxy: ScrollViewProxy, animated: Bool = false) {
        if Self.idAnchor {
            // Through nil so a repeat is seen; put back only if nothing (the person's own scroll) moved it meanwhile.
            if positionId == "end" { positionId = nil; DispatchQueue.main.async { if positionId == nil { positionId = "end" } } } else { positionId = "end" }
            return
        }
        if animated { withAnimation { proxy.scrollTo("end", anchor: .bottom) } } else { proxy.scrollTo("end", anchor: .bottom) }
    }

    // Where the eager newest rows begin: none with the id anchor (iOS 17+), all with the debug EAGERALL switch.
    private func eagerStartIndex(_ items: [Board.ChatItem]) -> Int {
        if Self.idAnchor { return items.count }
        if Self.sampleEagerAll { return 0 }
        return Board.eagerStart(items, from: Self.sampleNoKeep ? nil : eagerFrom, eager: Self.eagerTail)
    }

    // kosmos#7265 (measured on the simulator 10-27, sim7265/r12 and r13): on iOS 17 and later the chat is anchored on a
    // message id (SwiftUI's scroll position) instead of on positions. Rows above the reader are drawn lazily with
    // estimated heights, and every read re-estimated them, so the view wandered (226, then 256, then 238 in one run) and
    // rows overlapped; anchored on an id, a scrolled-up reader holds still while messages arrive, and a reader at the
    // newest message (anchored on the end marker) follows each one. iOS 16 keeps the eager newest rows instead.
    // Debug: KOSMOS_SAMPLE_NOPOSID=1 runs the iOS 16 path, as the control.
    static let idAnchor: Bool = {
        guard #available(iOS 17.0, *) else { return false }
        #if DEBUG
        return ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOPOSID"] != "1"
        #else
        return true
        #endif
    }()

    // kosmos#7346: how far above the solid strip messages fade into it. The end marker and the New messages button
    // are both set from it, so changing it can never hide the newest message under the fade.
    static let fadeHeight: CGFloat = 18

    // kosmos#7265: iOS 18 reports the scroll phase, which tells the person's scroll from rows moving under them.
    static var followsScrollPhase: Bool { if #available(iOS 18.0, *) { return true } else { return false } }

    // kosmos#7265 debug: KOSMOS_SAMPLE_TRACE=1 appends the chat's scroll state to Documents/trace.txt.
    // kosmos#7420 diagnostic: no message on screen for half a second while the conversation has some (the black list).
    private func diagCheck(_ proxy: ScrollViewProxy, count: Int) {
        // Review 1: only for the chat on screen with the app in front: under the info page, another tab or Quick Look every
        // row leaves too, and that is not a fault.
        // Review 3 and 4: a list never drawn never moved the end marker, so that arm needs no row drawn since the messages
        // arrived more than 2 s ago (never the moment after an account or computer change, before its rows appear).
        let neverDrew = !endSeen && !diagEverDrew && (diagThreadAt.map { Date().timeIntervalSince($0) > 2 } ?? false)
        guard visible, scenePhase == .active, !searchMode, onScreen.isEmpty, !endVisible || neverDrew, !topVisible, count > 0, thread != nil else { return }
        diagCapture(proxy, why: "no message on screen", count: count)
    }

    // Once per open chat: the numbers at that moment and the last events, then one try at putting the newest message back,
    // and whether that worked. Nothing leaves the phone unless the person shares it.
    private func diagCapture(_ proxy: ScrollViewProxy, why: String, count: Int, recover: Bool = true) {
        guard visible, scenePhase == .active, recover ? !diagDone : !diagWideDone else { return }
        if recover { diagDone = true } else { diagWideDone = true }
        let info = Bundle.main.infoDictionary
        let anchor = positionId == nil ? "none" : positionId == "end" ? "end" : positionId == "top" ? "top" : "a message"
        var lines = ["Kosmos iPhone chat diagnostic (kosmos#7420)",
                     "what: \(why)",
                     "app \(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?")), iOS \(UIDevice.current.systemVersion)",
                     "list \(Int(diagViewport.width))x\(Int(diagViewport.height)), stack width \(Int(diagContentWidth)), keyboard \(Int(diagKeyboard))",
                     "messages \(count), on screen \(onScreen.count), end showing \(endVisible), top showing \(topVisible), at newest \(atBottom)",
                     "anchor \(anchor), id anchor \(Self.idAnchor), searching \(searchMode), keyboard focus \(composerFocused)",
                     "recent events:"] + Self.diagRing
        guard recover else { diagReport = lines.joined(separator: "\n"); announceDiag(); return }   // review 1: a width finding moves nobody
        Self.trace("diag: \(why), trying the newest message")
        goNewest(proxy)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            lines.append("after one try: " + (onScreen.isEmpty ? "still nothing on screen" : "messages on screen again"))
            diagReport = lines.joined(separator: "\n")
            announceDiag()
        }
    }

    private func announceDiag() { UIAccessibility.post(notification: .announcement, argument: "This conversation did not draw properly. A Share button above the messages sends the details, if you choose.") }

    // The line that offers it: what happened in plain words, and Share. Stacked at the largest text sizes (review 1).
    private func diagLine(_ report: String) -> some View {
        let close = Button { diagReport = nil } label: {
            Image(systemName: "xmark").font(.footnote).frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain).foregroundColor(Palette.secondary).accessibilityLabel("Dismiss")
        let share = ShareLink(item: report, subject: Text("Kosmos chat diagnostic")) { Text("Share what happened").font(.footnote.weight(.semibold)) }
        let words = Text("This conversation did not draw properly.").font(.footnote).foregroundColor(Palette.primary)
        return Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 6) { HStack { words; Spacer(minLength: 0); close }; share }
            } else {
                HStack(spacing: 10) { words.frame(maxWidth: .infinity, alignment: .leading); share; close }
            }
        }
        .padding(.leading, 12).padding(.vertical, 2)
        .background(Palette.banner)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 16).padding(.top, 8)
    }

    // kosmos#7420 (Josh 10-27, the list went black on his phone and never on the simulator): the last few dozen scroll
    // events, always kept in memory (numbers and event names only, never message text), for the diagnostic below.
    static var diagRing: [String] = []
    static let diagStart = Date()
    static func trace(_ line: @autoclosure () -> String) {
        let said = line()
        diagRing.append(String(format: "%.2f ", Date().timeIntervalSince(diagStart)) + said)
        if diagRing.count > 80 { diagRing.removeFirst(diagRing.count - 80) }
        #if DEBUG
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_TRACE"] == "1" {
            let text = String(format: "TRACE %.2f ", Date().timeIntervalSince1970.truncatingRemainder(dividingBy: 1000)) + said + "\n"
            // Appended to Documents/trace.txt, pulled out with simctl get_app_container (stderr never reached a file).
            let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("trace.txt")
            if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(Data(text.utf8)); try? h.close() }
            else { try? Data(text.utf8).write(to: url) }
        }
        #endif
    }

    // New messages come in at the bottom; if the person has scrolled up, the view stays and the capsule offers a jump.
    // Not while searching: the person is reading what matched, and a new message may not even be among it (the
    // board's convPause, #5624).
    private func follow(_ proxy: ScrollViewProxy) {
        if searching { return }
        if atBottom { goNewest(proxy, animated: true) } else { unseenNew = true }
    }

    // kosmos#7089: the field under the bar, styled as the composer's box. The x and Cancel both empty it and put it away.
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
    private func closeSearch() {
        searchFocused = false
        putSearchAway()
    }
    // The row goes, emptied (a field of spaces too). A search that filtered then scrolls to the newest message
    // (onChange(of: searchMode)); one that never did leaves the reader where they are.
    private func putSearchAway() {
        query = ""
        searchOpen = false
        openedAtNewest = false
        UIAccessibility.post(notification: .layoutChanged, argument: nil)
    }

    // Spoken as it appears: the search field keeps VoiceOver's focus, so nothing else says the thread went empty
    // (the board's room search announces it on the way into no match, not on every key).
    private var noMatch: some View {
        Text(Board.chatNoMatch(query)).font(.subheadline).foregroundColor(Palette.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 60)
            .onAppear { UIAccessibility.post(notification: .announcement, argument: Board.chatNoMatch(query)) }
    }

    private var empty: some View {
        VStack(spacing: 6) {
            Text("No messages with \(shown.name) yet").font(.headline).foregroundColor(Palette.primary)
            Text("Say hello, or give \(shown.name) something to do.").font(.subheadline).foregroundColor(Palette.secondary)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    @ViewBuilder private func itemView(_ item: Board.ChatItem) -> some View {
        switch item.kind {
        case .day(let label):
            Text(label).font(.caption.weight(.semibold)).foregroundColor(Palette.secondary)
                .frame(maxWidth: .infinity)
                .padding(.top, 16).padding(.bottom, 8)
                .accessibilityAddTraits(.isHeader)
        case .row(let row, let first, let last):
            if let thread, let choices = Board.choices(for: row, in: thread) {
                choicesView(row, choices).padding(.top, 10)
            } else if row.who != .kosmos, row.wayThrough == .attachment, !row.attachments.isEmpty {
                // The person's own files too (kosmos#7071), on the right in their colour, with the not-sent line.
                let mine = row.who == .person
                VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                    // kosmos#7083: what it answers, on a message with files too.
                    let head = headFor(replyTo: row.replyTo)
                    // Heard in the files bubble's own label, so not a second time here.
                    if let head, !headsHidden.contains(row.id) { ReplyHeadLine(head: head).accessibilityHidden(true) }
                    FilesBubble(text: Board.wordsShown(row.text, files: row.attachments), files: row.attachments,
                                thumbnails: client.thumbnails, states: fileStates, widthShare: widthShare, open: openFile, mine: mine,
                                faded: false,
                                spoken: filesSpoken(row, head: head, mine: mine),
                                actions: row.answerable(by: agent.session) ? replyActionList(row) : [])
                        // kosmos#7083: Reply and the reactions on an agent's message with files too, from its bubble.
                        .contextMenu { if row.answerable(by: agent.session) { replyMenu(row) } }
                    if !row.reactions.isEmpty {
                        ReactionPills(pills: row.reactions, toggle: row.answerable(by: agent.session) ? { e in reactTo(e, row) } : nil)
                    }
                    if mine, let failed = failedLine(row) {
                        // kosmos#7136: the time as on any bubble, then the board's failed line under it.
                        if last, let at = row.at {
                            Text(at, style: .time).foregroundColor(Palette.tertiary).font(.caption2).padding(.horizontal, 4)
                                .accessibilityHidden(true)
                        }
                        // The bubble's own label says it and its reason; a message with files is never sent again.
                        FailedLineView(line: failed, action: { tryAgain(row) }).accessibilityHidden(!failed.canRetry)
                    } else if (last && row.at != nil) || row.notSent != nil {
                        // The time on the last of a run, as on every bubble (3a), and the Mac's word for one not sent.
                        HStack(spacing: 6) {
                            if last, let at = row.at { Text(at, style: .time).foregroundColor(Palette.tertiary) }
                            if let notSent = row.notSent { Text(notSent + (row.because.map { ": " + $0 } ?? "")).foregroundColor(Palette.secondary) }
                        }
                        .font(.caption2)
                        .padding(.horizontal, 4)
                        // The bubble's own label says the time and the not-sent word already.
                        .accessibilityHidden(true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
                .padding(.top, first ? 10 : 2)
                .task { for f in row.attachments { await client.loadThumbnail(f) } }
            } else if let way = row.wayThrough {
                VStack(alignment: .leading, spacing: 4) {
                    // A file that came with words: the words as a bubble, then the way through for the file.
                    if way == .attachment, !row.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        ChatBubble(row: row, firstOfRun: true, lastOfRun: true, widthShare: widthShare, name: shown.name,
                                   failed: failedLine(row), sendAgain: { tryAgain(row) },
                                   head: headFor(replyTo: row.replyTo), headHidden: headsHidden.contains(row.id),
                                   react: row.answerable(by: agent.session) ? { e in reactTo(e, row) } : nil,
                                   reply: row.answerable(by: agent.session) ? { startReply(row) } : nil)
                    }
                    WayThroughRow(text: wayText(way), action: openOnBoard)
                }
                .padding(.top, 10)
            } else if row.who == .kosmos {
                Text(row.text).font(.footnote).foregroundColor(Palette.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: UIScreen.main.bounds.width * 0.85)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            } else {
                // kosmos#7136: one the Mac could not deliver gets the board's failed line, with Try again where it offers it.
                ChatBubble(row: row, firstOfRun: first, lastOfRun: last, widthShare: widthShare, name: shown.name,
                           failed: failedLine(row),
                           sendAgain: { tryAgain(row) },
                           head: headFor(replyTo: row.replyTo), headHidden: headsHidden.contains(row.id),
                           react: row.answerable(by: agent.session) ? { e in reactTo(e, row) } : nil,
                           reply: row.answerable(by: agent.session) ? { startReply(row) } : nil)
                    .padding(.top, first ? 10 : 2)
            }
        }
    }

    // MARK: - Earlier messages (kosmos#7016 part 3)

    private var earlierLoadingLine: some View {
        Group {
            if earlier.loading {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("Loading earlier messages\u{2026}").font(.footnote).foregroundColor(Palette.secondary)
                }
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(Capsule().fill(Palette.ground.opacity(0.92)))
                .padding(.top, 6)
                .accessibilityElement(children: .combine)
            }
        }
    }

    // A failure stands until Try again, in a row of its own so it lies over nothing.
    @ViewBuilder private var earlierFailedLine: some View {
        // Not while searching: a search loads no earlier pages (loadEarlier), so Try again would do nothing.
        if let why = earlier.because, !earlier.loading, !searchMode {
            VStack(spacing: 4) {
                Text(why).font(.footnote).foregroundColor(Palette.secondary).multilineTextAlignment(.center)
                Button("Try again") { earlier = Board.retryEarlier(earlier); loadEarlier() }
                    .font(.footnote.weight(.semibold)).foregroundColor(Palette.primary)
                    .frame(minHeight: 44)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 10)
        }
    }

    // One page before what is loaded, when the person is at the top of it (or the chat is too short to scroll), never
    // while one loads, never after a failure until Try again. Called when the top appears, after every read, and on
    // Try again (the board's earlierNearTop: on scroll, after a paint, and from its button).
    private func loadEarlier() {
        // A search shortens the thread; its top showing is not a reader at the top (the board's earlierNearTop).
        guard !searchMode, let t = thread, Board.shouldAsk(settled: settledAtEnd, topVisible: topVisible, earlier: earlier, olderCount: t.olderCount)
        else { return }
        let start = Board.startLoad(earlier, olderCount: t.olderCount)
        earlier = start
        let opened = epoch
        Task {
            guard let read = await client.olderPage(agent.session, before: start.before), opened == client.chatEpoch,
                  let next = Board.finishLoad(earlier, with: read, opening: start.opening) else { return }
            // The row kept in place is the topmost one on screen as the page lands, wherever the person has scrolled
            // meanwhile (the board's setThread anchor), so a page landing never pulls them somewhere else.
            let shownNow = thread.map { Board.chatItems(Board.shownRows(earlier, thread: $0), now: Date(), calendar: .current) } ?? []
            let anchor = Board.anchorItem(shownNow, onScreen: onScreen)
            earlier = next
            // kosmos#7265 review: the newest rows are one eager stack and are all "on screen" while any of it shows, so
            // a reader back at the newest message is kept there rather than at the stack's first row (a stated limit:
            // a reader stopped part way inside the newest rows as a page lands may still move).
            // Review 2: atBottom starts true and clears only after the end marker has shown, so the top showing (the
            // reader is up there) rules it out.
            if atBottom && endSeen && !topVisible && !searching { keepAtEndTick += 1 }   // review: not while searching
            else if case .page(let rows, _, _) = read, !rows.isEmpty { keepAnchor = anchor }
        }
    }

    // earlierFillGap: messages that left the latest 200 while the chat was open are fetched into the loaded pages, so
    // nothing falls between them and the latest read. Dropped if a reset came while it ran.
    private func fillGap(_ t: Board.Thread) {
        guard earlier.open, !earlier.filling, !earlier.loading, Board.hasGap(end: earlier.end, olderCount: t.olderCount) else { return }
        earlier.filling = true
        let end = earlier.end
        let token = earlier.opening
        let opened = epoch
        Task {
            var got: [Board.ChatRow] = []
            var before = t.olderCount
            // Newest page first, each next one ending where the last began (the board's before -= want), so a page
            // size other than 200 never leaves a hole.
            while before > end {
                let read = await client.olderPage(agent.session, before: before)
                guard opened == client.chatEpoch, earlier.opening == token else { return }
                guard case .page(let rows, let positions, let start) = read else {
                    // Moved: start again (as the board does); failed: the next read tries again.
                    if read == .moved { earlier = Board.resetEarlier(earlier) } else { earlier.filling = false }
                    return
                }
                got = Board.gapRows(rows, positions: positions, end: end) + got
                before = start
            }
            // kosmos#7265: a row carried in meanwhile (carryDropped) is not added twice, and the end never moves back.
            let known = Set(earlier.rows.map(\.id))
            earlier.rows += got.filter { !known.contains($0.id) }
            earlier.end = max(earlier.end, t.olderCount)
            earlier.filling = false
        }
    }

    // MARK: - Files (kosmos#7016 part 2)

    // Fetched from the Mac through the kept sign-in, then shown in the system's Quick Look (share, save and print).
    // One file at a time: a second tap while one is on its way does nothing, so a fetched file is never replaced
    // before it is shown (and removed when it closes).
    private func openFile(_ f: Board.Attachment) {
        // A page or markup file goes to the board's chat, where the board opens it.
        if Board.isWebDocument(name: f.name, type: f.type) { openOnBoard(); return }
        guard !fileStates.values.contains(.loading), previewURL == nil else { return }
        fileStates[f.id] = .loading
        let opened = epoch
        Task {
            let file = await client.fetchFile(f)
            guard opened == client.chatEpoch else { if let file { client.closed(file) }; return }
            fileStates[f.id] = file == nil ? .failed : .ready
            guard let file else { return }
            // Left the chat while it came: nothing will show it, so it goes now.
            if visible { openedFile = file; previewURL = file } else { client.closed(file) }
        }
    }

    // MARK: - Answering a question (kosmos#7016)

    @ViewBuilder private func choicesView(_ row: Board.ChatRow, _ choices: Board.Choices) -> some View {
        if let p = row.permission, let card = Board.cardButtons(choices, p) {
            PermissionCard(permission: p, allow: card.allow, deny: card.deny, more: card.more,
                           mainState: choicesState(choices, among: [card.allow, card.deny], .main(allow: p.allow, deny: p.deny)),
                           moreState: choicesState(choices, among: card.more, .more),
                           widthShare: widthShare, press: { press($0, choices) })
        } else {
            QuestionBubble(text: row.text, options: choices.options, state: choicesState(choices, among: choices.options, .plain),
                           widthShare: widthShare, press: { press($0, choices) })
        }
    }

    // What the client and this chat know now, decided by Board.choicesState (tested).
    private func choicesState(_ c: Board.Choices, among shown: [Board.ChoiceOption], _ part: Board.ChoicesPart) -> ChoicesState {
        let answered = client.answeredNow(agent.session, key: c.key).map { (sure: $0.sure, n: $0.n) }
        let armedN = shown.map(\.n).first { Board.isArmed(armed, n: $0, key: c.key, now: Date()) }
        return Board.choicesState(part, pressing: client.pressing.contains(agent.session), typing: client.isSending(agent.session),
                                  answered: answered, armedN: armedN, unsure: unsureKey == c.key)
    }

    private func press(_ option: Board.ChoiceOption, _ choices: Board.Choices) {
        switch Board.armStep(armed, option: option, key: choices.key, now: Date()) {
        case .ignore:
            return
        case .arm(let a):
            armed = a
            redraw(after: Board.armWindow)
            return
        case .send:
            break
        }
        armed = nil
        unsureKey = nil
        pressLine = nil
        // The line about a file goes on a press too, so what the press says next is the line shown (kosmos#7071).
        client.attachLine[agent.session] = nil
        Task {
            let result = await client.press(option, of: choices, to: agent)
            if composerNote == Board.choiceWaitLine { composerNote = nil }
            guard let result else { return }
            // Why it did not go, or that it may have gone, goes on the conversation's own line, which stays when the
            // next read draws another question or none (the board's d-say-msg); a sure press clears it.
            switch result {
            case .sent: pressLine = nil
            case .notSure(let text): pressLine = text; unsureKey = choices.key
            case .refused(let text): pressLine = text
            }
            pressLineKey = choices.key
            if result.mayHaveSent { redraw(after: BoardClient.answeredLock) }
            await read()
        }
    }

    #if DEBUG
    // Screenshots only (a Debug build with KOSMOS_SAMPLE_AGENTS=1): KOSMOS_SAMPLE_CHOICE=armed|unsure|answered sets the
    // question's state once, as a press would (nothing in the simulator can press here).
    @State private var sampleApplied = false
    @State private var sampleFileApplied = false
    @State private var sampleOlderApplied = false
    @State private var sampleReplyApplied = false
    @State private var sampleSearchApplied = false
    private func applySampleChoice(_ t: Board.Thread) {
        // kosmos#7089, KOSMOS_SAMPLE_SEARCH=<words>: the field opened with those words typed, for its screenshots (empty
        // words: the field open and empty).
        if !sampleSearchApplied, let words = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SEARCH"] {
            sampleSearchApplied = true
            searchOpen = true
            query = words
        }
        // kosmos#7083, KOSMOS_SAMPLE_REPLY=1: Reply pressed on Dana's newest message, for the strip's screenshot.
        if !sampleReplyApplied, ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_REPLY"] == "1",
           let last = t.rows.last(where: { $0.who == .agent && $0.atRaw != nil }) {
            sampleReplyApplied = true
            replying = last
        }
        // KOSMOS_SAMPLE_OLDER=loading|failed: the earlier-messages line as a load would leave it.
        if !sampleOlderApplied, let state = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_OLDER"], t.olderCount > 0 {
            sampleOlderApplied = true
            earlier = Board.startLoad(Board.Earlier(), olderCount: t.olderCount)
            if state == "failed", let failed = Board.finishLoad(earlier, with: .failed("We could not read all of the earlier messages just now. Try again in a moment."), opening: earlier.opening) { earlier = failed }
        }
        // KOSMOS_SAMPLE_FILESTATE=loading|failed: the first file card as a tap would leave it.
        if !sampleFileApplied, let state = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_FILESTATE"],
           let first = t.rows.lazy.flatMap(\.attachments).first {
            sampleFileApplied = true
            fileStates[first.id] = state == "failed" ? .failed : .loading
        }
        guard !sampleApplied, let c = t.choices, let which = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_CHOICE"] else { return }
        sampleApplied = true
        switch which {
        case "armed": if let o = c.options.first(where: \.lasting) { armed = Board.Armed(key: c.key, n: o.n, at: Date()) }
        // As a not-sure press leaves it: the answered lock (not sure), the line under the buttons and the composer line.
        case "unsure": unsureKey = c.key; pressLine = Board.choiceUnsure; pressLineKey = c.key
            client.sampleAnswer(agent.session, key: c.key, n: c.options[0].n, sure: false)
        case "answered": client.sampleAnswer(agent.session, key: c.key, n: c.options[0].n, sure: true)
        default: break
        }
    }
    #endif

    // kosmos#7136: the person's newest message over every row on screen, earlier pages included (the board's
    // DM_NEWEST_MINE_AT, over earlierRows and the latest read).
    private var newestMine: String? { thread.flatMap { Board.newestMineAt(Board.shownRows(earlier, thread: $0)) } }

    // What VoiceOver says for a files bubble: what it answers, who, when, its words and files, and (#7136) why it failed.
    // Split out so the compiler type-checks it on its own (CI's Xcode timed out on long expressions in this view).
    private func filesSpoken(_ row: Board.ChatRow, head: Board.ReplyHead?, mine: Bool) -> String {
        let lead = head.map { ReplyHeadLine.words($0) + " " } ?? ""
        let said = Board.filesRowSpoken(who: mine ? "You" : shown.name, at: row.at, text: Board.wordsShown(row.text, files: row.attachments),
                                        count: row.attachments.count, notSent: row.notSent)
        let why = mine ? (failedLine(row).map { ". " + $0.because } ?? "") : ""
        return lead + said + why
    }

    // kosmos#7136: the board's failed line for a row of the person's, as it is on this phone now.
    private func failedLine(_ row: Board.ChatRow) -> Board.FailedLine? {
        // Only the person's failed rows reach the newest-message scan.
        guard row.who == .person, row.notSent == Board.failedWords || row.retrying else { return nil }
        return Board.failedLine(row, newestMineAt: newestMine,
                         flying: client.isSendingAgain(row, for: agent.session) || row.atRaw.map { retrySettling.contains($0) } == true)
    }

    // Try again, as the board's dmRetrySend: what happened is heard; a refusal is also said under the box, and a later
    // one that works clears that line only if a Try again wrote it.
    private func tryAgain(_ row: Board.ChatRow) {
        let newest = newestMine
        if client.pressing.contains(agent.session) { composerNote = Board.choiceWaitLine; return }
        guard let at = row.atRaw else { return }
        // Marked before the request and kept until the next read, so no frame shows the stale line between them.
        retrySettling.insert(at)
        Task {
            let answer = await client.sendAgain(row, newestMineAt: newest, to: agent)
            await read()
            retrySettling.remove(at)
            guard let out = answer else { return }
            if out.refused {
                // The same refusal twice does not change the line, so it would not be heard again: say it.
                if composerNote == out.said { UIAccessibility.post(notification: .announcement, argument: out.said) }
                composerNote = out.said
                retryNote = out.said
            } else {
                if let mine = retryNote, composerNote == mine { composerNote = nil }
                retryNote = nil
                UIAccessibility.post(notification: .announcement, argument: out.said)
            }
        }
    }

    // A send again or a retry while a press is in the air waits, and the line says why (dmChoiceBlocksSend).
    private func sendWhenFree(_ go: @escaping () async -> Void) {
        if client.pressing.contains(agent.session) { composerNote = Board.choiceWaitLine; return }
        Task { await go(); await read() }
    }

    // No thread read, no buttons (the board's rule): a question kept from an earlier read may have moved on to another
    // with the same words (every permission prompt asks "Do you want to proceed?"), so it cannot be pressed.
    private func dropChoices() {
        guard let t = thread, t.choices != nil else { return }
        thread = Board.Thread(rows: t.rows, olderCount: t.olderCount)
    }

    private func redraw(after seconds: TimeInterval) {
        Task {
            try? await Task.sleep(nanoseconds: UInt64((seconds + 0.1) * 1_000_000_000))
            tick += 1
        }
    }

    private func wayText(_ way: Board.ChatRow.WayThrough) -> Text {
        let name = Text(shown.name).fontWeight(.semibold).foregroundColor(Palette.askedWord)
        switch way {
        case .question: return name + Text(" asked you something. Answer on your computer's board \u{203A}")
        case .permission: return name + Text(" needs your permission. Answer on your computer's board \u{203A}")
        case .attachment: return Text("A file. Open on your computer's board \u{203A}")
        case .draft: return Text("Words sat unsent in ") + name + Text("'s input box. See them on your computer's board \u{203A}")
        }
    }

    private var newMessagesCapsule: some View {
        Button {
            unseenNew = false
            NotificationCenter.default.post(name: .chatScrollToEnd, object: nil)
        } label: {
            Text("New messages \u{2193}").font(.footnote.weight(.semibold)).foregroundColor(Palette.primary)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Capsule().fill(Palette.card).shadow(color: .black.opacity(0.15), radius: 6, y: 2))
        }
        .buttonStyle(.plain)
        .padding(.bottom, 8 + ChatView.fadeHeight)   // above the fade (kosmos#7346)
    }

    // MARK: - Sending

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            // kosmos#7346: the strips above the box are the page's solid ground, edge to edge (nothing shows through).
            if let replying { replyStrip(replying).background(Palette.ground.padding(.horizontal, -12)) }
            if !attachedHere.isEmpty || uploadingHere > 0 { chips.background(Palette.ground.padding(.horizontal, -12)) }
            // kosmos#7346: one floating box, + then the text then emoji and mic; no send arrow (the keyboard's Send sends).
            // Radius 24, at least 48 pt, the card colour with a soft shadow and a hairline edge (Mona Lisa's spec).
            HStack(alignment: .bottom, spacing: 0) {
                addButton
                field
            }
            .frame(minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 24).fill(Palette.card)
                .shadow(color: Color.black.opacity(0.10), radius: 10, x: 0, y: 3))
            .overlay(RoundedRectangle(cornerRadius: 24).stroke(Palette.separator, lineWidth: 0.5))
            if let line = ComposerExtras.micLine(dictation.state) {
                Text(line).font(.footnote).foregroundColor(Palette.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
                    .background(Palette.ground.padding(.horizontal, -12))
            }
            // kosmos#7268: the emoji panel in the keyboard's place while open; typing in the box closes it. The tab bar is
            // already hidden in a conversation, so nothing sits under the panel.
            if emojiOpen { EmojiPanel { emojiInsert = ComposerExtras.Pick(glyph: $0) }.padding(.horizontal, -12).background(Palette.ground) }
        }
        .padding(.horizontal, 12)
        // 8 pt above the keyboard, or above the home bar when it is down.
        .padding(.top, 6)
        .padding(.bottom, 8)
        .onChange(of: composerFocused) { focused in if focused { emojiOpen = false } }
        // Review 8: the search field's keyboard closes the panel too, or it sits on top of it and hides the results.
        .onChange(of: searchFocused) { focused in if focused { emojiOpen = false } }
        #if DEBUG
        // KOSMOS_SAMPLE_EMOJI=open (with the agent samples): the panel open, for the design shots.
        .onAppear { if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1", ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_EMOJI"] == "open" { emojiOpen = true } }
        // kosmos#7420: KOSMOS_SAMPLE_DIAG=1 shows the diagnostic line with a sample report, for the design shots.
        .onAppear { if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_DIAG"] == "1" { diagReport = "Kosmos iPhone chat diagnostic (kosmos#7420)\nwhat: sample" } }
        // kosmos#7420: KOSMOS_SAMPLE_FOCUS=<seconds> taps the box that long after opening (the keyboard rises), as a person
        // would (nothing in the simulator can tap here).
        .onAppear {
            if let s = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_FOCUS"].flatMap(Double.init), s > 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + s) { composerFocused = true }
            }
        }
        #endif
        // Leaving the conversation lets go of the microphone and closes the panel (the board's: the panel belongs to the
        // composer being left).
        .onDisappear { dictation.reset(); emojiOpen = false }
        .onChange(of: draftText) { [was = draftText] now in
            // kosmos#7346: the keyboard's Send key arrives as a lone new line: take it out, and send if there is something
            // to send (as the arrow did: not while dictation is finishing, not with a file still on its way).
            if let without = ComposerExtras.typedReturn(was: was, now: now) {
                draftText = without
                sendOrSayWhy()
                return
            }
            // The person changed what Send was refused for: the reason no longer applies to it.
            if let b = blocked, now != b.text {
                if composerNote == b.note { composerNote = nil }
                blocked = nil
            }
            // kosmos#7348: the sent text came back into the box (the keyboard's dictation or Writing Tools finishing late).
            // Kept for the whole window, so a keyboard that puts it back twice is cleared twice (review).
            if Board.refilledWithSent(now, was: was, sent: lastSent?.text, sentAt: lastSent?.at, now: Date()) { draftText = ""; return }
            dictation.boxChanged(to: now)
        }
        // Each picker on a host of its own: two presentations on one view can leave one that never opens (iOS 16).
        .background(Color.clear.photosPicker(isPresented: $showPhotos, selection: $photoPicks,
                                             maxSelectionCount: max(1, Board.maxFiles - attachedHere.count - uploadingHere),
                                             matching: .images, preferredItemEncoding: .compatible))
        .onChange(of: photoPicks) { picks in
            guard !picks.isEmpty else { return }
            photoPicks = []
            Task { await addPhotos(picks) }
        }
        .background(Color.clear.fileImporter(isPresented: $showFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls): Task { await addFiles(urls) }
            case .failure: client.attachLine[agent.session] = "We could not open that file."
            }
        })
        // A file that lands is heard, as the line above the composer is when one does not.
        .onChange(of: attachedHere.count) { [was = attachedHere.count] now in
            if now > was, let name = attachedHere.last?.name { UIAccessibility.post(notification: .announcement, argument: "Added \(name)") }
        }
    }

    // MARK: - Adding files (kosmos#7071, the board's + and attachUpload)

    private var attachedHere: [Board.Attached] { client.attached[agent.session] ?? [] }
    private var uploadingHere: Int { client.uploading[agent.session] ?? 0 }
    private var attachLine: String? { client.attachLine[agent.session] }
    // As many as a message carries are waiting or on their way: nothing more can be picked.
    private var atFileLimit: Bool { attachedHere.count + uploadingHere >= Board.maxFiles }

    private var addButton: some View {
        Menu {
            Button { showPhotos = true } label: { Label("Photo Library", systemImage: "photo.on.rectangle") }
                .disabled(atFileLimit)
            Button { showFiles = true } label: { Label("Files", systemImage: "folder") }
                .disabled(atFileLimit)
        } label: {
            // kosmos#7346: a plain + inside the box, a 44 pt target (Apple's minimum) on its 48 pt row.
            Image(systemName: "plus")
                .font(.system(size: 19, weight: .regular))
                .foregroundColor(Palette.secondary)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .accessibilityLabel("Add a photo or file")
        .accessibilityHint(atFileLimit ? Board.uploadRefusal(size: nil, waiting: Board.maxFiles) ?? "" : "")
        .padding(.leading, 4)
        .padding(.bottom, 2)
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                // First, so it is on screen however many files are already waiting.
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
                    FileChip(name: a.name, remove: { client.unattach(a.id, for: agent.session) })
                }
            }
            .padding(.horizontal, 2)
            // As tall as the x's 44 pt place to tap: a scroll view takes no taps outside itself.
            .frame(minHeight: 44)
        }
    }

    // One at a time, in the order picked, as the board adds them. Each is counted as on its way from the moment its turn
    // comes (before a photo has loaded), and the client copies it (a photo's bytes as Apple's picker gives them, JPEG
    // by default). The picks after it wait their turn uncounted; the count of ten refuses any that would pass it.
    // The line above the composer is cleared once per pick, so a refusal of one file stays while the rest go up.
    // The photos of one pick share one time, numbered after the first, so no two carry the same name.
    private func addPhotos(_ picks: [PhotosPickerItem]) async {
        let epoch = client.chatEpoch
        let at = Date()
        client.attachLine[agent.session] = nil
        for (i, item) in picks.enumerated() {
            await client.attach(.photo(load: {
                guard let data = try? await item.loadTransferable(type: Data.self) else { return nil }
                let type = item.supportedContentTypes.first { $0.conforms(to: .image) } ?? .jpeg
                return (Board.photoName(at: at, ext: Board.imageExtension(data) ?? type.preferredFilenameExtension ?? "jpg", number: i + 1), data)
            }), epoch: epoch, to: agent)
        }
    }

    private func addFiles(_ urls: [URL]) async {
        let epoch = client.chatEpoch
        client.attachLine[agent.session] = nil
        for url in urls { await client.attach(.file(url), epoch: epoch, to: agent) }
    }

    // kosmos#7268: the emoji face and the microphone inside the box, at its trailing end, as the project room's; the
    // box's text runs up to them.
    private var field: some View {
        HStack(alignment: .bottom, spacing: 0) {
            CursorField(placeholder: "Message \(shown.name)", text: $draftText, focus: $composerFocused, insert: $emojiInsert,
                        prompt: Text("Message \(shown.name)").foregroundColor(Palette.secondary))
                // As the board's aria-describedby: the reply is heard whenever the box is reached, not only when chosen.
                .accessibilityHint(replying.map { replyingLine($0) } ?? "")
                .accessibilityLabel("Message \(shown.name)")
                .font(.body)
                .foregroundColor(Palette.primary)
                .lineLimit(1...6)
                // kosmos#7346: the return key reads Send, and a lone new line typed into the box sends (typedReturn).
                .submitLabel(.send)
                // With no arrow on screen, VoiceOver gets Send as an action on the box itself.
                .accessibilityAction(named: "Send") { sendOrSayWhy() }
                .padding(.vertical, 13)
                .padding(.leading, 2)
            ComposerEmojiButton(open: emojiOpen) {
                if emojiOpen { emojiOpen = false; composerFocused = true } else { emojiOpen = true; composerFocused = false }
            }
            ComposerMicButton(dictation: dictation) {
                dictation.toggle(base: draftText, current: { draftText }) { draftText = $0 }
            }
            .padding(.trailing, 4)
        }
    }

    // kosmos#7346 review: with no arrow to grey out, a Send that cannot go says why (the note line announces itself
    // to VoiceOver) until the box changes.
    private func sendOrSayWhy() {
        if canSend { send(); return }
        if let why = sendBlocked {
            composerNote = why
            blocked = (draftText, why)
        }
    }

    // Words, or files with no words (their names go as the words). Not with files while another is still on its way
    // (the message would go without it); words alone go, as on the board.
    // kosmos#7268 review 4: not while dictating or while its last words land; stop first, then send. Read from the same
    // rule that says why (dmSendBlocked), so a Send that cannot go always has a reason to show.
    private var canSend: Bool { Board.fitsBoard(Board.sendWords(draftText, files: attachedHere)) && sendBlocked == nil }
    private var sendBlocked: String? {
        Board.dmSendBlocked(said: Board.sendWords(draftText, files: attachedHere), files: attachedHere.count,
                            uploading: uploadingHere, dictating: dictation.busy, finishing: dictation.finishing)
    }

    // The bubble appears at once (60% while it sends) and the field clears (spec, "while it sends").
    private func send() {
        guard canSend else { return }
        // A press in the air: the words wait in the box, and the line says why (dmChoiceBlocksSend).
        if client.pressing.contains(agent.session) { composerNote = Board.choiceWaitLine; return }
        composerNote = nil
        dictation.stop()   // kosmos#7268 review 1: before the box is cleared, so no late result brings the words back
        // The composer line goes on the next send or press (Mona Lisa's spec, section 1).
        pressLine = nil
        client.attachLine[agent.session] = nil
        let text = draftText
        let files = attachedHere
        let answering = replying
        draftText = ""
        lastSent = (text, Date())
        replying = nil
        client.drafts[agent.session] = nil
        Task {
            // Not sent (a press, or another file started going up meanwhile): the words go back in an empty box, so none
            // are lost, and the line says why; the reply comes back with them.
            if await client.post(text, files: files, replyTo: answering?.atRaw, to: agent) {
                // Once the Mac records it, a message that does not match the search drops out of sight (the board's too).
                if searching { sentWhileSearching = true }
            } else {
                // kosmos#7348: a failed send puts its words back on purpose. Only this send's guard goes: a later send's
                // stays (review).
                if lastSent?.text == text { lastSent = nil }
                if draftText.isEmpty { draftText = text; if replying == nil { replying = answering } }
                if uploadingHere > 0 { composerNote = Board.stillAddingLine }
            }
            await read()
        }
    }

    // MARK: - Replying and reacting (kosmos#7083)

    // dmReplyHead for a row of this conversation (the rows shown, earlier pages included; what is left further back is
    // the earlier pages' count once they are open, else the latest read's).
    private func headFor(replyTo: String?) -> Board.ReplyHead? {
        guard replyTo != nil, let thread else { return nil }
        return Board.replyHead(to: replyTo, in: Board.shownRows(earlier, thread: thread), agentName: shown.name, session: agent.session,
                               olderLeft: earlier.open ? earlier.before : thread.olderCount)
    }
    // The pending messages whose header is left out (dmReplyAdjacency's `next`, carried through them in order).
    private var pendingHeadsHidden: Set<String> {
        guard let thread, !searching else { return [] }
        return Board.pendingRepliesUnderOriginal(pending, after: Board.shownRows(earlier, thread: thread))
    }
    // The rows whose header is left out on screen (dmReplyAdjacency), worked out once when the conversation changes, not
    // once per row (review 4: per row it was quadratic on every redraw).
    @State private var hiddenHeads: Set<String> = []
    private func recomputeHiddenHeads() {
        hiddenHeads = thread.map { Board.repliesUnderOriginal(Board.shownRows(earlier, thread: $0)) } ?? []
    }
    // Not while searching, which hides the rows between (dmReplyAdjacency): every reply draws its header then. Chosen
    // as the rows are drawn, so a keystroke never paints one frame with the other answer.
    private var headsHidden: Set<String> { searching ? [] : hiddenHeads }

    // The strip above the composer: who and what the next send answers, and an x.
    private func replyStrip(_ row: Board.ChatRow) -> some View {
        HStack(spacing: 8) {
            Text(replyingLine(row))
                .font(.footnote).foregroundColor(Palette.secondary).lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button { replying = nil } label: {
                Image(systemName: "xmark.circle.fill").font(.system(size: 17)).foregroundColor(Palette.secondary)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Stop replying")
        }
        .padding(.leading, 10)
        .overlay(Rectangle().fill(Palette.separator).frame(width: 2), alignment: .leading)
    }

    // React and Reply for one of the agent's messages (the menu on a files bubble, and its VoiceOver actions).
    // The same choices as a list, for VoiceOver actions on each file card.
    private func replyActionList(_ row: Board.ChatRow) -> [(name: String, run: () -> Void)] {
        var out: [(name: String, run: () -> Void)] = []
        for e in Board.quickReactions where !row.reactions.contains(where: { $0.emoji == e && $0.mine }) { out.append(("React with " + e, { reactTo(e, row) })) }
        for r in row.reactions where r.mine { out.append(("Remove your " + r.emoji, { reactTo(r.emoji, row) })) }
        out.append(("Reply", { startReply(row) }))
        return out
    }

    @ViewBuilder private func replyMenu(_ row: Board.ChatRow) -> some View {
        ForEach(Board.quickReactions.filter { e in !row.reactions.contains { $0.emoji == e && $0.mine } }, id: \.self) { e in
            Button("React with " + e) { reactTo(e, row) }
        }
        ForEach(row.reactions.filter(\.mine), id: \.emoji) { r in Button("Remove your " + r.emoji) { reactTo(r.emoji, row) } }
        Button("Reply") { startReply(row) }
    }

    private func failedReason(_ p: Board.PendingSend) -> String? {
        if case .failed(let why) = p.state { return why }
        return nil
    }

    // "Replying to Dana: ...", said when Reply is chosen, as the board announces it.
    private func replyingLine(_ row: Board.ChatRow) -> String {
        "Replying to " + shown.name + ": " + Board.replyGist(row, agentName: shown.name, session: agent.session)
    }
    private func startReply(_ row: Board.ChatRow) {
        replying = row
        // As the board and the native room: the box takes the words next.
        composerFocused = true
        UIAccessibility.post(notification: .announcement, argument: replyingLine(row))
    }

    // Toggles a reaction; the answer's pills repaint that one row at once (the next read confirms), and a refusal is said
    // on the composer line.
    private func reactTo(_ emoji: String, _ row: Board.ChatRow) {
        guard let at = row.atRaw else { return }
        // One toggle of a pill at a time: a quick second tap would race the first.
        let key = at + "|" + emoji
        guard !reacting.contains(key) else { return }
        reacting.insert(key)
        let startedIn = client.chatEpoch
        Task {
            let result = await client.react(emoji, at: at, to: agent)
            reacting.remove(key)
            guard startedIn == client.chatEpoch else { return }
            switch result {
            case .reacted(let at, let pills):
                if let t = thread { thread = Board.withReactions(t, at: at, pills: pills) }
                if earlier.rows.contains(where: { $0.atRaw == at }) { earlier.rows = Board.withReactions(earlier.rows, at: at, pills: pills) }
            case .refused(let why):
                composerNote = why
                reactNote = why
            }
            if case .reacted = result, let shownNote = reactNote, composerNote == shownNote { composerNote = nil; reactNote = nil }
        }
    }

    // MARK: - Reading

    private func startReading() {
        loop?.cancel()
        loop = Task {
            while !Task.isCancelled {
                await read()
                try? await Task.sleep(nanoseconds: 5_000_000_000)   // the web chat's own cadence
            }
        }
    }

    private func read() async {
        readsStarted += 1
        let mine = readsStarted
        let startedIn = client.chatEpoch
        let result = await client.thread(for: agent.session)
        // A read cut short (the chat closed, the app went away) says nothing about the Mac, and an older read than the
        // one shown changes nothing.
        guard !Task.isCancelled, mine > readShown, startedIn == client.chatEpoch else { return }
        readShown = mine
        switch result {
        case .thread(let fresh):
            // The hidden headers in the same pass as the rows, so a pending reply's swap to its kept row never draws one
            // frame with the old set (onChange alone runs after that body).
            // kosmos#7265 (Josh 10-27): rows this read slid out of the latest window stay, so nothing above the reader
            // vanishes and the conversation does not jump (carryDropped).
            if fresh != thread {
                // kosmos#7265 (Josh 10-27): whether the reader is at the newest message is read BEFORE the new rows land:
                // a message appended under the end marker pushes it off screen, and its onDisappear cleared atBottom before
                // follow() ran, so a reader at the bottom was left behind with "New messages" (measured on the simulator).
                // Until the open has settled (the end not yet shown) the reader is still being taken there.
                let pinned = !Self.sampleNoKeep && (atBottom || !endSeen) && !searching
                if !Self.sampleNoKeep { earlier = Board.carryDropped(earlier, previous: thread, fresh: fresh) }   // NOKEEP: the control
                thread = fresh; recomputeHiddenHeads()
                if pinned { keepAtEndTick += 1 }
                Self.trace("read \(mine): rows \(fresh.rows.count) older \(fresh.olderCount) pinned \(pinned) atBottom \(atBottom) endSeen \(endSeen) settled \(settledAtEnd) earlierOpen \(earlier.open) earlierRows \(earlier.rows.count) loading \(earlier.loading) filling \(earlier.filling)")
            }
            fillGap(fresh)
            // A moved reset leaves the top in view with nothing loading: the next read asks again.
            loadEarlier()
            // A line about a question that is no longer the one up would read as a warning about the next one.
            if pressLine != nil, fresh.choices?.key != pressLineKey { pressLine = nil }
            #if DEBUG
            applySampleChoice(fresh)
            #endif
            client.settle(fresh, for: agent.session)
            lastRead = Date()
            failedReads = 0
            refusal = nil
        case .refused(let why):
            // The Mac answered, with a reason: said as it is, never as "not answering".
            refusal = why
            dropChoices()
            failedReads = 0
        case .noAnswer:
            failedReads += 1
            dropChoices()
        }
    }
}

// kosmos#7083: the line over a message that answers another (the board's dmReplyHead), and its words for VoiceOver.
struct ReplyHeadLine: View {
    let head: Board.ReplyHead
    static func words(_ head: Board.ReplyHead) -> String {
        switch head {
        case .answers(let who, let gist): return "Answers " + who + ": " + gist + (gist.last.map { ".!?\u{2026}".contains($0) } == true ? "" : ".")
        case .furtherBack: return "Original message is further back."
        case .unavailable: return "Original message unavailable."
        }
    }
    var body: some View {
        Group {
            switch head {
            case .answers(let who, let gist): Text(who + ": " + gist).foregroundColor(Palette.secondary)
            case .furtherBack: Text("Original message is further back").foregroundColor(Palette.secondary)
            case .unavailable: Text("Original message unavailable").foregroundColor(Palette.secondary)
            }
        }
        .font(.footnote).lineLimit(2)
        .padding(.leading, 8)
        .overlay(Rectangle().fill(Palette.separator).frame(width: 2), alignment: .leading)
    }
}

// kosmos#7083: the reaction pills under a message, the person's own marked; a tap toggles it where reacting is offered.
struct ReactionPills: View {
    let pills: [Board.ChatReaction]
    let toggle: ((String) -> Void)?
    var body: some View {
        HStack(spacing: 6) {
            ForEach(pills, id: \.emoji) { p in
                if toggle == nil {
                    // Not toggleable here (not this agent's own message): plain words, never a button that does nothing.
                    Text(p.emoji + (p.count > 1 ? " \(p.count)" : ""))
                        .font(.footnote)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Capsule().fill(p.mine ? Palette.personBubble : Palette.card))
                        .accessibilityLabel(p.emoji + (p.count > 1 ? ", \(p.count)" : "") + (p.mine ? ", yours" : ""))
                } else {
                    Button { toggle?(p.emoji) } label: {
                        Text(p.emoji + (p.count > 1 ? " \(p.count)" : ""))
                            .font(.footnote)
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Capsule().fill(p.mine ? Palette.personBubble : Palette.card))
                            .overlay(Capsule().stroke(p.mine ? Palette.link : Palette.separator, lineWidth: p.mine ? 1 : 0.5))
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(p.emoji + (p.count > 1 ? ", \(p.count)" : "") + (p.mine ? ", yours" : ""))
                    .accessibilityAddTraits(p.mine ? .isSelected : [])
                }
            }
        }
        .padding(.horizontal, 4)
    }
}

// A tap action only where there is one to take, so a bubble's links keep their own taps everywhere else.
struct TapWhen: ViewModifier {
    let enabled: Bool
    let action: () -> Void
    @ViewBuilder func body(content: Content) -> some View {
        if enabled { content.onTapGesture(perform: action) } else { content }
    }
}

// The "New messages" capsule asks the open chat's scroll view to go to the end.
extension Notification.Name {
    static let chatScrollToEnd = Notification.Name("kosmos.chatScrollToEnd")
}

// One message as a bubble: the person's on the right, the agent's on the left, in the board's colours; the time (and a
// tail) on the last bubble of a run. A message the Mac could not deliver gets the board's failed line (kosmos#7136).
struct ChatBubble: View {
    let row: Board.ChatRow
    let firstOfRun: Bool
    let lastOfRun: Bool
    let widthShare: CGFloat
    let name: String
    // kosmos#7136: the board's failed line, for a message the Mac could not deliver.
    let failed: Board.FailedLine?
    let sendAgain: () -> Void
    // kosmos#7083: what this message answers, and React and Reply (on the agent's messages only, as the board's hover
    // bar; nil where they are not offered).
    var head: Board.ReplyHead? = nil
    // Right under the message it answers: the header is heard, not drawn.
    var headHidden = false
    var react: ((String) -> Void)? = nil
    var reply: (() -> Void)? = nil
    @Environment(\.openURL) private var openURL

    private var mine: Bool { row.who == .person }

    var body: some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            if let head, !headHidden { ReplyHeadLine(head: head) }
            BubbleText(text: row.text, mine: mine, tail: lastOfRun, widthShare: widthShare)
                // One long-press menu per bubble, set here (a menu on the shared bubble would hide the pending one's Delete).
                .contextMenu {
                    if let react {
                        // As the files menu and the VoiceOver actions: a reaction already yours is offered as Remove.
                        ForEach(Board.quickReactions.filter { e in !row.reactions.contains { $0.emoji == e && $0.mine } }, id: \.self) { e in
                            Button { react(e) } label: { Text(e) }
                        }
                        ForEach(row.reactions.filter(\.mine), id: \.emoji) { r in Button("Remove your " + r.emoji) { react(r.emoji) } }
                    }
                    if let reply { Button(action: reply) { Label("Reply", systemImage: "arrowshape.turn.up.left") } }
                    Button { UIPasteboard.general.string = row.text } label: { Label("Copy", systemImage: "doc.on.doc") }
                }
            if !row.reactions.isEmpty { ReactionPills(pills: row.reactions, toggle: react) }
            if let failed {
                if lastOfRun, let at = row.at {
                    Text(at, style: .time).foregroundColor(Palette.tertiary).font(.caption2).padding(.horizontal, 4)
                }
                FailedLineView(line: failed, action: sendAgain)
            } else if lastOfRun || row.notSent != nil {
                HStack(spacing: 6) {
                    if lastOfRun, let at = row.at { Text(at, style: .time).foregroundColor(Palette.tertiary) }
                    if let notSent = row.notSent { Text(notSent + (row.because.map { ": " + $0 } ?? "")).foregroundColor(Palette.secondary) }
                }
                .font(.caption2)
                .padding(.horizontal, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenLabel)
        // Always present, doing nothing where there is no retry: without a default action VoiceOver's double-tap would
        // fall through as a tap at the bubble's centre, which can land on a link (#7014).
        .accessibilityAction { if failed?.canRetry == true { sendAgain() } }
        // The board keeps the Mac's reason to the line's tooltip; here it is heard after the message.
        .accessibilityHint(failed?.because ?? "")
        // The bubble is read as one element, so its links are offered as actions (one per link, named by its site, and
        // numbered when there is more than one).
        .accessibilityActions { linkActions }
        .accessibilityActions { replyActions }
    }

    // Reply and each reaction, as VoiceOver actions on the one element the bubble is.
    @ViewBuilder private var replyActions: some View {
        if let reply { Button("Reply", action: reply) }
        if let react {
            ForEach(Board.quickReactions.filter { e in !row.reactions.contains { $0.emoji == e && $0.mine } }, id: \.self) { e in
                Button("React with \(e)") { react(e) }
            }
            ForEach(row.reactions.filter(\.mine), id: \.emoji) { r in Button("Remove your \(r.emoji)") { react(r.emoji) } }
        }
    }

    // Split out of body so the compiler type-checks each part on its own (CI's Xcode timed out on the pending bubble's).
    private var spokenLabel: String {
        var said = Self.spoken(who: mine ? "You" : name, at: row.at, text: row.text)
        if let head { said = ReplyHeadLine.words(head) + " " + said }
        if !row.reactions.isEmpty { said += ". Reactions: " + row.reactions.map { $0.emoji + ($0.count > 1 ? " \($0.count)" : "") }.joined(separator: ", ") }
        if let failed {
            return said + ", " + Board.failedWords.lowercased()
                + (failed.canRetry ? ", double-tap to try again" : failed.button != nil ? ", sending" : "")
        }
        if let notSent = row.notSent { return said + ", " + notSent.lowercased() }
        return said
    }

    private var linkActions: some View {
        let links = Board.messageLinks(row.text)
        return ForEach(Array(links.enumerated()), id: \.offset) { i, url in
            let number = links.count > 1 ? "\(i + 1) " : ""
            Button("Open link \(number)to \(url.host ?? url.absoluteString)") { openURL(url) }
        }
    }

    static func spoken(who: String, at: Date?, text: String) -> String {
        who + (at.map { ", " + $0.formatted(date: .omitted, time: .shortened) } ?? "") + ": " + text
    }
}

// A message the person sent from this chat, until the conversation holds the row the Mac kept for it.
struct PendingBubble: View {
    let item: Board.PendingSend
    let widthShare: CGFloat
    // The not-sent line as it reads now (it follows the agent's status, so a retry opens once it runs again).
    let line: (text: String, canRetry: Bool)
    let retry: () -> Void
    let delete: () -> Void
    // kosmos#7083: what it answers, drawn as the kept row will draw it (left out where the kept row's would be, though
    // VoiceOver still hears it), and "Send as a new message" for a reply.
    var head: Board.ReplyHead? = nil
    var headHidden = false
    var dropReply: (() -> Void)? = nil

    // The Mac's reason; its "Press x" (the board's strip) becomes this bubble's own button where it has one.
    private var reason: String? {
        guard case .failed(let why) = item.state, let why else { return nil }
        return dropReply == nil ? why : Board.withoutStripInstruction(why)
    }
    // Kept by the Mac but not delivered: the words its row will say, quiet, with nothing to tap (the row takes over).
    private var undelivered: String? {
        if case .keptUndelivered(_, let note) = item.state { return note }
        return item.state == .unconfirmed ? "Not confirmed" : nil
    }

    // kosmos#7071: with no words of its own, the names of its files are its words, and only the files are drawn.
    private var words: String { Board.wordsShown(item.text, names: item.files.map(\.name)) }

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            if let head, !headHidden { ReplyHeadLine(head: head) }
            if !words.isEmpty {
                BubbleText(text: words, mine: true, tail: item.files.isEmpty, widthShare: widthShare, faded: !item.shownAsSent)
                    .modifier(TapWhen(enabled: item.failed && line.canRetry, action: retry))
                    .contextMenu { menu }
            }
            ForEach(Array(item.files.enumerated()), id: \.offset) { _, f in
                FileChip(name: f.name, faded: !item.shownAsSent)
                    .modifier(TapWhen(enabled: item.failed && line.canRetry, action: retry))
                    .contextMenu { menu }
            }
            if item.failed {
                NotSentLine(text: line.text, canRetry: line.canRetry, action: retry)
                // The Mac's own words for why, when it gave them.
                if let reason { Text(reason).font(.caption).foregroundColor(Palette.secondary).multilineTextAlignment(.trailing) }
                // kosmos#7083: a reply the Mac would not take (its original gone) can still go, as a new message (the
                // board's x on the reply strip).
                if let dropReply, line.canRetry {
                    Button("Send as a new message", action: dropReply)
                        .font(.caption.weight(.semibold)).foregroundColor(Palette.link)
                        .frame(minHeight: 44).contentShape(Rectangle())
                }
            } else if let undelivered {
                Text(undelivered).font(.caption2).foregroundColor(Palette.secondary).padding(.horizontal, 4)
            } else if item.shownAsSent {
                Text(item.at, style: .time).font(.caption2).foregroundColor(Palette.tertiary).padding(.horizontal, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenLabel)
        .accessibilityAction { if item.failed && line.canRetry { retry() } }
        // Delete only where the long-press menu offers it.
        .accessibilityActions { deleteAction }
        .accessibilityActions { dropReplyAction }
    }

    @ViewBuilder private var menu: some View {
        Button { UIPasteboard.general.string = item.text } label: { Label("Copy", systemImage: "doc.on.doc") }
        if item.deletable { Button(role: .destructive, action: delete) { Label("Delete", systemImage: "trash") } }
    }

    @ViewBuilder private var dropReplyAction: some View {
        if item.failed && line.canRetry, let dropReply { Button("Send as a new message", action: dropReply) }
    }

    // Split out of body so the compiler type-checks each part on its own (CI's Xcode timed out on the whole chain).
    private var spokenLabel: String {
        var said = ChatBubble.spoken(who: "You", at: item.shownAsSent ? item.at : nil, text: words)
        if let head { said = ReplyHeadLine.words(head) + " " + said }
        if !item.files.isEmpty { said += (words.isEmpty ? "" : ", ") + Board.filesSpoken(item.files.map(\.name)) }
        if item.failed {
            said += line.canRetry ? ", not sent, double-tap to try again" : ", not sent"
            if let reason { said += ". " + reason }
        }
        if let undelivered { said += ", " + undelivered.lowercased() }
        return said
    }

    @ViewBuilder private var deleteAction: some View {
        if item.deletable { Button("Delete", action: delete) }
    }
}

// kosmos#7136: the board's dmFailedLine under a message the Mac could not deliver: "Message failed to deliver, try
// again." with "try again" the button, "sending…" while it goes, else "Message failed to deliver."; the reason is heard.
struct FailedLineView: View {
    let line: Board.FailedLine
    let action: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Text(Board.failedWords + (line.button == nil ? "." : ", "))
            if let button = line.button {
                Button(action: { if line.canRetry { action() } }) { Text(button).underline(line.canRetry) }
                    .buttonStyle(.plain)
                    .disabled(!line.canRetry)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                Text(".")
            }
        }
        .font(.footnote)
        .foregroundColor(Palette.secondary)
        .padding(.horizontal, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(line.text)
        .accessibilityHint(line.because)
        .accessibilityAddTraits(line.canRetry ? .isButton : [])
        .accessibilityAction { if line.canRetry { action() } }
    }
}

// "Not sent. Tap to try again." with its glyph, in the danger colour; a tap tries again when it can.
struct NotSentLine: View {
    let text: String
    let canRetry: Bool
    let action: () -> Void

    var body: some View {
        Button(action: { if canRetry { action() } }) {
            HStack(spacing: 4) {
                Image(systemName: "exclamationmark.circle")
                Text(text)
            }
            .font(.footnote)
            .foregroundColor(Palette.dangerWord)
        }
        .buttonStyle(.plain)
        .disabled(!canRetry)
    }
}

// The bubble itself: body text in the board's bubble colours, 18pt corners, a small tail on the last of a run.
struct BubbleText: View {
    let text: String
    let mine: Bool
    let tail: Bool
    let widthShare: CGFloat
    var faded = false

    var body: some View {
        Text(Self.formatted(text))
            .font(.body)
            .foregroundColor(Palette.primary.opacity(faded ? 0.6 : 1))
            .tint(Palette.link)
            // kosmos#7347 (Josh 10-27, Mona Lisa): 10 pt by 14 pt around the words, the Mac board's proportion.
            .padding(.vertical, 10)
            .padding(.horizontal, 14)
            .background(
                // Two shapes, each filled on its own: one path holding both would cut a hole where they overlap.
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                    if tail { BubbleTail(mine: mine) }
                }
                .foregroundColor(mine ? Palette.personBubble : Palette.agentBubble)
            )
            .frame(maxWidth: UIScreen.main.bounds.width * widthShare, alignment: mine ? .trailing : .leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    // The message as drawn (Board.messageText, under ios/LogicTests).
    static func formatted(_ s: String) -> AttributedString { Board.messageText(s) }
}

// The small tail on the last bubble of a run, at the bottom corner on the speaker's side (Messages' convention).
struct BubbleTail: Shape {
    let mine: Bool

    func path(in rect: CGRect) -> Path {
        // Drawn for the right side and mirrored for the left. It fills the rounded corner and curls out 5pt.
        let w: CGFloat = 20
        let h: CGFloat = 18
        var p = Path()
        p.move(to: CGPoint(x: rect.maxX - w, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.maxX + 5, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.maxY - h * 0.55), control: CGPoint(x: rect.maxX, y: rect.maxY - 1))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - h))
        p.addLine(to: CGPoint(x: rect.maxX - w, y: rect.maxY - h))
        p.closeSubpath()
        guard !mine else { return p }
        return p.applying(CGAffineTransform(scaleX: -1, y: 1).translatedBy(x: -(rect.minX + rect.maxX), y: 0))
    }
}

// "<dots> <name> is working": the board's wave (WaveDots, kosmos#7427); VoiceOver hears the words only.
struct WorkingLine: View {
    let name: String

    var body: some View {
        // kosmos#7427: the board's wave (WaveDots), not three dots pulsing together.
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            #if DEBUG
            // kosmos#7427 review 2 debug: KOSMOS_SAMPLE_CLOCKDOTS=1 draws the clock-drawn dots here, as the control.
            if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_CLOCKDOTS"] == "1" { WorkingDots() } else { WaveDots() }
            #else
            WaveDots()   // review 2: inside the thread, never the clock-drawn WorkingDots
            #endif
            Text("\(name) is working")
        }
        .font(.footnote)
        .foregroundColor(Palette.secondary)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name) is working")
    }
}

// Mona Lisa's way-through row: a card-colour pill that opens the agent's chat on the board.
struct WayThroughRow: View {
    let text: Text
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            text.font(.footnote).foregroundColor(Palette.secondary)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(RoundedRectangle(cornerRadius: 12).fill(Palette.card))
                // White on the light ground barely shows (Mona Lisa's review): a hairline in light mode only.
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.pillStroke, lineWidth: 0.5))
        }
        .buttonStyle(.plain)
    }
}

extension Palette {
    // The board's own chat colours (Mona Lisa's slice 3a spec: Josh 2026-09-25 and #3340 for night mode).
    static let personBubble = pair(0xe8ebf5, 0x1b1f65)
    static let agentBubble = pair(0xfbf4e4, 0x252529)
    static let link = pair(0x2457c5, 0x9db8ff)
    static let pillStroke = pair(0xe3e1dc, 0x000000, lightAlpha: 1, darkAlpha: 0)
}

extension ChatView {
    // kosmos#7265, a Debug build only: KOSMOS_SAMPLE_NOFIX=1 draws every row lazily, as before the fix, so one build shows
    // both arms.
    #if DEBUG
    static let sampleNoFix = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOFIX"] == "1"
    // kosmos#7265 (10-27): KOSMOS_SAMPLE_NOKEEP=1 turns off only carryDropped and the kept eager start, the control for them.
    static let sampleNoKeep = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOKEEP"] == "1"
    #else
    static let sampleNoFix = false
    static let sampleNoKeep = false
    #endif
}

// kosmos#7265: whether the person is scrolling the chat (iOS 18 scroll phases), and a call when their scroll comes to
// rest. Before iOS 18 nothing is reported and the chat reads the end marker as before.
struct PersonScroll: ViewModifier {
    @Binding var scrolling: Bool
    let rested: () -> Void
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollPhaseChange { _, phase in
                let now = phase == .interacting || phase == .decelerating || phase == .tracking
                // Every scroll that comes to rest re-reads where the reader is (review: a status-bar tap scrolls in the
                // animating phase, which is not counted as the person's, and would otherwise leave atBottom true).
                if now { scrolling = true } else if phase == .idle { scrolling = false; rested() }
            }
        } else {
            content
        }
    }
}

// kosmos#7265: rows as scroll targets, and the list anchored on one message id (iOS 17+, ChatView.idAnchor).
struct PositionTargets: ViewModifier {
    let on: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 17.0, *), on { content.scrollTargetLayout() } else { content }
    }
}
struct PositionById: ViewModifier {
    let on: Bool
    @Binding var id: String?
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 17.0, *), on { content.scrollPosition(id: $id, anchor: .bottom) } else { content }
    }
}
