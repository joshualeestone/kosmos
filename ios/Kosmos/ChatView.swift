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
    // kosmos#7034 reviews 1-2: the width the chat is laid out in, measured (it already leaves out a landscape notch's
    // margins, and it changes only once a rotation has happened), for the header title's cap.
    @State private var contentWidth: CGFloat = UIScreen.main.bounds.width
    // kosmos#8246: the failed sends already seen here, so only a send that fails while the chat is open buzzes.
    @State private var failedSeen: Set<String> = []
    @State private var failedSeenFor = ""   // the agent `failedSeen` was read for: another agent's set never counts as new
    @State private var infoOpen = false
    #if DEBUG
    static var sampleInfoOpened = false
    #endif
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var thread: Board.Thread?
    @State private var lastRead: Date?
    @State private var failedReads = 0
    // kosmos#7810: whether a read of the whole window has landed since this chat opened (until then the chat shows the
    // kept copy or the first small page, and loads no earlier pages), and that read's ETag for the next poll.
    @State private var fullRead = false
    @State private var threadTag: String?
    // The Mac's own reason it gave no conversation (a name it refuses, a history it could not read).
    @State private var refusal: String?
    @State private var loop: Task<Void, Never>?
    @State private var atBottom = true
    // kosmos#7817: the height of the strip under the list (the message box and its line), which grows a line at a time as
    // a long message is typed. Only the Debug switch follows it (followsBox).
    @State private var stripHeight: CGFloat = 0
    // kosmos#7265 (measured on the simulator, 10-27): the end marker leaving the screen was read as the person scrolling
    // up, but new rows push it off too, and a re-pin can land a row short, so a reader at the newest message was left
    // behind and never followed again. On iOS 18 only the person's own scroll (scroll phase interacting or decelerating)
    // moves atBottom; endVisible is the marker as it is, read when their scroll comes to rest.
    @State private var endVisible = true
    // kosmos#7265 (iOS 17+, idAnchor): the message the list is anchored on; "end" keeps the newest in view.
    @State private var positionId: String?
    // kosmos#7420 (build 24): the list's identity; a new value rebuilds it, opened at its end (recoverEmpty's .rebuild). At
    // most `rebuildsMax` a chat open and Board.rebuildSpacing (2 s) apart, so a list that stays empty cannot rebuild itself in a loop.
    @State private var listEpoch = 0
    @State private var rebuilds: [Date] = []
    // kosmos#7420: a rebuilt list draws its oldest rows for a moment before it reaches the newest (video, 11-07, about two frames at 30 a
    // second: "Message 42 of 260"). So it stays out of sight until the end shows, or for rebuildHideAfterLastAsk after the last
    // ask to go there, when the rows show wherever they are.
    @State private var rebuildHiding = false
    static let rebuildHideAfterLastAsk: Double = 0.35
    #if DEBUG
    static let sampleNoRebuildHide = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOREBUILDHIDE"] == "1"   // the control
    #else
    static let sampleNoRebuildHide = false
    #endif
    static let rebuildsMax = 3
    // kosmos#8221: the chat drawn by the UIKit list (ChatList) instead of the lazy SwiftUI one. Settings' "New chat list"
    // switch chooses it (slice 5), OFF by default until the new list holds every behaviour the old one has (the slices in
    // .claude/plans/uikitlist-s1-8221.md). Kept in an @State, so the switch never swaps the list under an open chat.
    // Debug: KOSMOS_SAMPLE_UIKITLIST, when set, wins over the switch ("1" UIKit, anything else lazy), and a sample run
    // (KOSMOS_SAMPLE_AGENTS=1) reads the switch only with KOSMOS_SAMPLE_UIKITLIST_SWITCH=1, so a switch a check left on
    // never moves another check onto the UIKit list. A Debug run with neither variable (your own phone) reads the switch.
    static let uikitListKey = "kosmos.chat.uikitlist"
    static func uikitListChosen() -> Bool {
        #if DEBUG
        let env = ProcessInfo.processInfo.environment
        if let v = env["KOSMOS_SAMPLE_UIKITLIST"] { return v == "1" }
        if env["KOSMOS_SAMPLE_AGENTS"] == "1", env["KOSMOS_SAMPLE_UIKITLIST_SWITCH"] != "1" { return false }
        #endif
        return UserDefaults.standard.bool(forKey: uikitListKey)
    }
    @State private var uikitList = ChatView.uikitListChosen()
    // kosmos#8221: bumped to send the UIKit list to the newest message (a send, New messages).
    @State private var uikitNewest = 0
    // kosmos#7645: a keyboard put-back let the anchor go; true until a row is named again (keepAnchor keeps a page meanwhile).
    @State private var anchorLetGo = false
    // kosmos#7645: where each drawn row is on the screen (iOS 26 and later), for the keyboard hold.
    @State private var rowTops = RowTops()
    // kosmos#7609 review 2: the moves the chat makes on purpose (to the newest message: a send, New messages, an arrival),
    // so the keyboard hold stands down for them.
    @State private var appMoves = 0
    @State private var personScrolling = false
    #if DEBUG
    // kosmos#7609: set only by the DEBUG sample scroll-up once it has told the chat where the reader is; checks wait on it.
    @State private var sampleScrollRested = false
    @State private var sampleA11yResult: String?   // kosmos#8221 slice 11: KOSMOS_SAMPLE_A11YSCROLL's result, for its check
    @State private var sampleRebuilds: Int?   // kosmos#7420: KOSMOS_SAMPLE_REBUILD's marker: the rebuilds counted once they have settled
    static var sampleRebuildDone = false       // once a launch, so the hook never runs twice whatever the list's appear does
    static var sampleEarlierAsks = 0           // kosmos#8221 slice 16: pages of earlier messages asked for in this launch
    #endif
    // kosmos#8221 slice 16: KOSMOS_SAMPLE_NOTOPFIX=1 (Debug) is the control: a landing page leaves the top showing until the list
    // says otherwise, as before the slice. Release reads false.
    #if DEBUG
    static let sampleNoTopFix = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOTOPFIX"] == "1"
    #else
    static let sampleNoTopFix = false
    #endif
    // kosmos#7420: KOSMOS_SAMPLE_NOREBUILD=1 (Debug) is the control: the recovery never rebuilds. Release reads false.
    #if DEBUG
    static let sampleNoRebuild = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOREBUILD"] == "1"
    #else
    static let sampleNoRebuild = false
    #endif
    // kosmos#8221: KOSMOS_SAMPLE_SCROLLUP for the UIKit list (conversationUIKit), read once. Release reads 0.
    #if DEBUG
    static let sampleScrollUp = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SCROLLUP"].flatMap(Int.init) ?? 0
    #else
    static let sampleScrollUp = 0
    #endif
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
    // kosmos#7354: a mark-read request is out, so the next read of the list does not send a second one.
    @State private var seenInFlight = false
    @State private var epoch = 0
    @State private var lastPendingCount = 0
    @State private var keepNewestInView = true
    @State private var boxAskedAt: Date?   // kosmos#7420: the last did-show or box change that asked the settled looks (nil after will-hide or another chat)
    @State private var kbSettleTick = 0   // kosmos#7817/#7420: the latest settle ask or will-hide; older looks stand down
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
    // kosmos#8221 slice 14: bumped each time loaded earlier pages are dropped and started again (a moved read or gap fill, a delete, Try
    // again after a thread that kept moving), so the UIKit list can put a reader who was up in them at the top of what remains.
    @State private var earlierDropped = 0
    @State private var topVisible = false
    // kosmos#8221 slice 16: a page's rows have landed and the list has not yet said where the top is; no page is asked for
    // meanwhile. landings counts them, so the backstop in loadEarlier lets go only of its own.
    @State private var earlierLanding = false
    @State private var earlierLandings = 0
    // Review 4: an atTop change that came during the hold, kept for the backstop (the list's report says where the top is).
    @State private var topDuringHold: Bool?
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
    // kosmos#7575: this chat open's sideways shifts, sent to the board once when it closes. A reference held in state:
    // a shift is counted in the middle of a layout, possibly every frame, and changing it must never redraw the chat.
    @State private var shifts = Board.ShiftBox()
    @State private var openCount = Board.ChatOpenCount()   // kosmos#7420
    @State private var endPull = EndPullDriver()   // kosmos#8072
    // kosmos#8283: the working line's height at this text size, read from its measuring copy (WorkingStrip), for endRoom.
    @State private var workingLineHeight: CGFloat = 16
    // kosmos#7420: the scroll view the chat sits in (found by SideScrollLock), read only by the empty-list diagnostic.
    @State private var scrollBox = ScrollBox()
    @State private var diagContentWidth: CGFloat = 0
    @State private var diagReport: String?
    // kosmos#7688 (2), review 1: the list was rebuilt, so the line says that rather than "did not draw properly". Words that
    // stay true whatever happens after (rows can "appear" while the list stays black, and can leave again).
    @State private var diagRebuilt = false
    @State private var diagDone = false   // once per open chat, even after the line is dismissed
    @State private var diagRetrying = false   // kosmos#7420 review 5: one look is waiting for a scroll or a finger to end
    @State private var quietFollowKey: String?   // kosmos#7420 review 5: the followKey of a read that moves nothing
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
    // kosmos#7071: the + beside the composer (kosmos#7596: Camera, Photos or Files).
    @State private var photoPicks: [PhotosPickerItem] = []
    @State private var showPhotos = false
    @State private var previewing: OpenPicture?   // kosmos#7944: the waiting picture opened from its chip
    @State private var showFiles = false
    @State private var showCamera = false   // kosmos#7596
    // The account or computer the camera was opened under: a photo taken across a switch is never sent under the new one
    // (client.attach's epoch), however long the camera was open; it is dropped without a line, as a pick would be.
    @State private var cameraEpoch = 0
    // kosmos#7083: the agent's message the next send answers (the board's DM reply strip); the box's focus, taken by
    // Reply; the last reaction refusal shown (only it is cleared by the next reaction that goes); reactions in the air.
    @State private var replying: Board.ChatRow?
    @FocusState private var composerFocused: Bool
    // kosmos#7268: the emoji panel (in the keyboard's place while open), the glyph waiting to go in at the cursor, and
    // dictation into the box, as the project room's (RoomView).
    @State private var emojiOpen = false
    // kosmos#8045: the + tray, in the keyboard's place while open.
    @State private var trayOpen = false
    @State private var trayFromKeyboard = false
    @State private var trayHeight: CGFloat = 0
    @State private var trayModel = PhotoTrayModel()
    @State private var emojiInsert: ComposerExtras.Pick?
    @StateObject private var dictation = Dictation()
    @State private var reactNote: String?
    @State private var deleteNote: String?   // kosmos#7614 review 2: the delete's own line, cleared by a delete that works
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
            .messagesVisibleArea()   // kosmos#7419 review 4: the lit message's hole stays above the composer's strip
            // kosmos#7346 (Josh 10-27, Mona Lisa's design): the message box sits on a solid strip down to the home indicator,
            // with messages fading into it; the inset keeps the newest message above the box.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 0) {
                    if let line = composerNote ?? attachLine ?? pressLine ?? (sentWhileSearching ? Board.chatSentWhileSearching : nil) {
                        Text(line).font(.footnote).foregroundColor(composerNote == nil && attachLine == nil && pressLine != nil ? Palette.dangerWord : Palette.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            // Mona Lisa's spec: 16 pt side margins, 6 pt above the composer.
                            .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 6)
                            .background(Palette.chatGround)
                            .onAppear { UIAccessibility.post(notification: .announcement, argument: line) }
                            .onChange(of: line) { now in UIAccessibility.post(notification: .announcement, argument: now) }
                    }
                    composer
                    photoTray
                }
                // kosmos#7346 (Josh 10-27 19:59): solid behind and below the box, down to the home indicator, as Discord: no
                // message shows through or under it. The inset already ends the list above this strip.
                .background(Palette.chatGround.ignoresSafeArea(edges: .bottom))
                // kosmos#7817: its height, read for the list (stripHeight).
                .background(GeometryReader { g in
                    Color.clear.onAppear { stripHeight = g.size.height }.onChange(of: g.size.height) { stripHeight = $0 }
                })
                // Josh 10-27: "with a slide fade into it so it looks smooth": messages fade into the strip over fadeHeight above it,
                // never a hard edge. Drawn over the list, so it takes no room and no touches.
                .overlay(alignment: .top) {
                    LinearGradient(colors: [Palette.chatGround.opacity(0), Palette.chatGround], startPoint: .top, endPoint: .bottom)
                        .frame(height: ChatView.fadeHeight).offset(y: -ChatView.fadeHeight).allowsHitTesting(false).accessibilityHidden(true)
                }
                // kosmos#8283: on the UIKit list only; the lazy list keeps its working row (see conversationLazy).
                .overlay(alignment: .topLeading) {
                    if uikitList { WorkingStrip(endPull: endPull, working: working, name: shown.name, lineHeight: $workingLineHeight) }
                }
            }
        }
        // kosmos#8045: the tray holds the keyboard's room while it is open (AttachMenu.swift, PhotoTrayFollowsKeyboard).
        .ignoresSafeArea(.keyboard, edges: trayOpen ? .bottom : [])
        .background(Palette.chatGround.ignoresSafeArea())
        // Mona Lisa's review: the tab bar would stack under the composer and take about 170pt, so it hides here.
        .toolbar(.hidden, for: .tabBar)
        .messageActionsHost()   // kosmos#7419: the one long-press sheet of this chat
        .background(GeometryReader { g in
            Color.clear.onAppear { contentWidth = g.size.width }.onChange(of: g.size.width) { contentWidth = $0 }
        })
        // kosmos#7034 build 11 reviews 2 and 4: the header star's stars, asked again on a switch to another computer.
        .task(id: client.chatEpoch) { await client.readStarsIfUnknown() }
        // kosmos#7864: link preview pictures are the large ones; on a memory warning they go, and drawn cards fetch theirs again.
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            client.dropPreviewImages()
        }
        .quickLookPreview($previewURL)
        // Closed: the file it showed is removed from the phone (#7016 review 1).
        .onChange(of: previewURL) { now in
            if let was = openedFile, was != now { client.closed(was); openedFile = now }
        }
        .navigationBarTitleDisplayMode(.inline)
        .kosmosSolidTopBar(fade: false, ground: Palette.chatGround)   // kosmos#7346 (Josh 10-27 20:21): no row shows behind the top bar; its fade is on the conversation
        .toolbar {
            // kosmos#7424 (Josh 10-27 20:49): the name and status open the same page as the info button.
            ToolbarItem(placement: .principal) {
                // Review 3: the whole title is the tap target, at least 44 pt tall, gaps included.
                Button { infoOpen = true } label: { title.frame(minHeight: 44).contentShape(Rectangle()) }.buttonStyle(.plain)
                    .accessibilityHint("Opens \(shown.name)\u{2019}s profile and AI settings")
            }
            // kosmos#7034 (Mona Lisa, build 11): a star you can see, answering Josh's "where do I star them": an outline
            // that turns gold when the agent is starred, the same save as the Agents row's swipe (BoardClient.toggleStar).
            // Review 2-4: no star (and no empty slot) until this computer's stars are known, never a greyed control; the
            // item itself is conditional, so on iOS 16 it is never built at zero width and grown later.
            if client.canStar {
            ToolbarItem(placement: .navigationBarTrailing) {
                let starred = client.isStarred(agent.session)
                Button {
                    Task {
                        await client.toggleStar(agent.session)
                        // Review 1: a save that failed is said here, where it was pressed (the banner above the chat
                        // shows the same words), not only later on the Agents list.
                        if let note = client.starNote { UIAccessibility.post(notification: .announcement, argument: note) }
                    }
                } label: {
                    Group {
                        if starred { StarredStar() } else { Image(systemName: "star").foregroundColor(Palette.secondary) }
                    }
                    .font(.system(size: 20))
                    .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                .disabled(client.starring.contains(agent.session))
                .accessibilityLabel(starred ? "Unstar \(shown.name)" : "Star \(shown.name)")
            }
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
        // kosmos#8246: a message the computer refused, or that got no answer, buzzes once as it fails (a retry that fails
        // again buzzes again); "not confirmed" stays silent. Only the chat on screen buzzes (the same agent can be open
        // under two tabs); the set is kept current either way, seeded as the chat shows, and never compared across agents.
        .onChange(of: Board.failedPendingIDs(pending)) { now in
            if visible, failedSeenFor == agent.session, !now.subtracting(failedSeen).isEmpty { Haptics.failed() }
            failedSeen = now; failedSeenFor = agent.session
        }
        // A chat that changes agent in place starts from the new agent's failures (either order with the watch is safe).
        .onChange(of: agent.session) { s in failedSeen = Board.failedPendingIDs(pending); failedSeenFor = s }
        #if DEBUG
        // KOSMOS_SAMPLE_INFO=profile|ai|files with KOSMOS_SAMPLE_OPEN: the sample agent's page, open, for the design shots.
        .onAppear {
            rowTops.isChat = true   // kosmos#7420: the height lines and the walk measure this chat's list, never a room's
            let env = ProcessInfo.processInfo.environment
            // Once a launch, so Back leaves the page (review 2: it pushed again each time the chat reappeared).
            if env["KOSMOS_SAMPLE_AGENTS"] == "1", env["KOSMOS_SAMPLE_INFO"] != nil, !ChatView.sampleInfoOpened {
                ChatView.sampleInfoOpened = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { infoOpen = true }
            }
        }
        #endif
        .onAppear {
            failedSeen = Board.failedPendingIDs(pending); failedSeenFor = agent.session   // kosmos#8246
            visible = true
            // kosmos#7420 review 1 and 2: the record starts with this chat's first showing (a return from the info page keeps
            // what came before), and a list blank from its first draw is checked too, since no row ever leaves it.
            if !diagShownOnce {
                diagShownOnce = true; Self.diagRing = []; Self.trace("chat shown")
                // kosmos#8221 slice 5: which list this open chose (the chat is drawn by it once its rows have come).
                if uikitList { Self.trace("list chosen: uikit") } else { Self.trace("list chosen: lazy") }
            } else { Self.trace("chat back") }
            rebuilds = []   // kosmos#7420: the rebuild budget is per showing, so a chat kept alive under another tab gets it again
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { diagTick &+= 1 }
            epoch = client.chatEpoch
            // kosmos#7420: this conversation gets no banner while it shows.
            if let host = client.switcherShown { PushNotificationManager.chatOnScreen = PushBridge.OpenChat(host: host, session: agent.session) }
            lastPendingCount = pending.count
            // Only into an empty box: if SwiftUI shows the chat again without having hidden it, the words being typed stay.
            if draftText.isEmpty { draftText = client.drafts[agent.session] ?? "" }
            startReading()
            markDmSeen()
            // kosmos#7575: the sender for this computer. The count is not reset here (review 3: a shift laid out before this
            // ran is kept); a return from the info page goes on with the same count.
            shifts.attach(send: shiftSender())
            openCount.shown(rowsDrawn: !onScreen.isEmpty)
            // kosmos#8072: pull past the newest message for a read. Only with the end marker showing and nobody searching.
            endPull.restsAbove = 14.5   // Mona Lisa's B, set by measuring: 11.5 pt under the working line, 21.5 above the box, clear of its fade
            // kosmos#8283: on the UIKit list the working line's row is gone and the room under the newest message is the end
            // marker's alone: measured 11-09 at the true end of a long chat, at 14.5 the dots touched the newest message's time
            // line (-0.5 pt) with 21.5 pt above the box, so they rest 3 pt lower there.
            if uikitList { endPull.restsAbove = 11.5 }
            endPull.allowed = { endVisible && !searchMode }
            endPull.refresh = { _ = await read() }
            scrollBox.endPull = endPull
            if let shown = scrollBox.view { endPull.attach(to: shown) }
        }
        // kosmos#7354: on every read of the list while the chat is open, unread replies are marked read again, as the board's
        // paintTalk does on each poll; so one that failed is sent again, and replies landing while it is open are read.
        .onReceive(client.$agents) { _ in markDmSeen() }
        .onDisappear {
            visible = false
            // kosmos#8072: the closures hold this chat, so they go with it; coming back sets them again.
            endPull.cancelRead(); endPull.allowed = { false }; endPull.refresh = nil
            if !infoOpen { sendOpenCount() }
            if !infoOpen { sendShiftReport() }   // kosmos#7575 (review 1: the info page pushed over the chat is not a close)
            if !infoOpen { client.releasePreviewImages() }   // kosmos#7864: the pictures do not outlive the chat
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
                if !searchMode && visible && epoch == cleared && clears == clear && !settledAtEnd { settledAtEnd = true; loadEarlier("settled") }
            }
        }
        .onChange(of: earlier) { _ in recomputeHiddenHeads() }
        // Signed out, another account or another Mac: what this chat shows belongs to the one before, so it goes.
        .onChange(of: client.chatEpoch) { now in
            diagDone = false; diagWideDone = false; diagReport = nil; diagRebuilt = false   // kosmos#7420 review 1: another account or computer is a new chat
            diagThreadAt = nil; diagEverDrew = false   // review 4
            boxAskedAt = nil   // kosmos#7420 review 7: a box change in the chat before is not this one's
            // kosmos#7575 review 1: what one computer saw is dropped, never sent to another's board (deliberately lost).
            shifts.reset(); shifts.attach(send: shiftSender())
            openCount.reset(); if visible { openCount.shown(rowsDrawn: false) }
            dictation.reset(); emojiOpen = false; trayOpen = false   // kosmos#7268: another account's conversation starts clean
            epoch = now
            endSeen = false   // kosmos#7265 review 3: a rebuilt thread has not shown its end yet
            positionId = nil; anchorLetGo = false; rowTops.reset(); personScrolling = false; endVisible = true; rebuildHiding = false; rebuilds = []   // kosmos#7265 review: a fresh chat's anchor
            eagerFrom = nil   // kosmos#7265: the next conversation picks its own eager start
            thread = nil
            fullRead = false; threadTag = nil   // kosmos#7810
            quietFollowKey = nil
            replying = nil
            retryNote = nil
            retrySettling = []
            earlier = Board.Earlier()
            earlierLanding = false; topDuringHold = nil; earlierLandings += 1   // kosmos#8221 slice 16: no hold or report carried into another chat
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
            // kosmos#7575 review 2: the report goes and the next count starts at once, so a shift laid out while away is kept.
            if phase == .background { loop?.cancel(); loop = nil; endPull.cancelRead(); sendShiftReport(); if visible { sendOpenCount() } else { openCount.reset() } }
            else if phase == .active, visible, loop == nil { startReading() }
            if phase == .active, visible { openCount.shown(rowsDrawn: !onScreen.isEmpty) }
            if phase == .active { diagBackInFront() }
        }
    }

    private var title: some View {
        let tone = Board.tone(shown)
        let strong = tone == .asked || tone == .needsYou
        return VStack(spacing: 1) {
            Text(shown.name).font(.headline).foregroundColor(Palette.primary).lineLimit(1)
            // Lost while open: the word goes quiet, since it is no longer current (spec, state 4).
            Text(lost ? Board.statusWord(shown) : Board.toneWord(shown))   // kosmos#7342: never a red Idle or Working (keyed on the tone it is drawn in)
                .font(.caption.weight(strong && !lost ? .semibold : .regular))
                .foregroundColor(lost ? Palette.secondary : Palette.word(tone))
                .lineLimit(1)
        }
        // kosmos#7034 (Mona Lisa's long-name check, iPhone SE): with the star the trailing capsule holds three buttons,
        // and a title whose full width does not fit beside it is dropped by the system, not shortened. Capped at what is
        // left between the back button and the capsule, a long name ends in an ellipsis and the capsule keeps its size.
        // Measured (shots run 4): width - 250 fitted on an iPhone 17 (402 pt, "Maximilia...") but not on the SE (375 pt),
        // where the title was still dropped; width - 300 leaves the SE about 75 pt. Review 1: that is the room beside
        // THREE buttons; with no star (two buttons) width - 250 is enough. Review 2: the chat's own measured width, not
        // the screen's, so landscape margins count and a rotation is read after it happens.
        .frame(maxWidth: max(60, contentWidth - (client.canStar ? 300 : 250)))
        .accessibilityElement(children: .combine)
    }

    // Above a conversation already shown: the Mac's own reason, or that it stopped answering.
    private var bannerText: String? {
        if let refusal { return refusal }
        // kosmos#7034 build 11 reviews 1-2: a star of THIS agent that did not save, said here too.
        guard lost else { return client.starNoteAgent == agent.session ? client.starNote : nil }
        // kosmos#7416: when the Mac was last heard from only while the Mac itself is not answering (a chat can stop
        // reading on its own); the chat's own "Last checked" stays unless it says the same minute (Shell.saysLastChecked).
        var heard: Double? = nil
        if case .unreachable = client.phase { heard = client.failingMacLastHeard }   // not phase.isUnreachable: fileprivate to TodayView
        let time = Shell.saysLastChecked(lastRead, lastHeard: heard)
            ? (lastRead.map { " Last checked \($0.formatted(date: .omitted, time: .shortened))." } ?? "") : ""
        return Shell.notUpdatingLine(client.failingMacName, lastHeard: heard) + time   // kosmos#7197: named
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
        let epochAtDraw = listEpoch
        return itemView(item).id(item.id)
            .modifier(RowTop(id: item.id, rows: rowTops))   // kosmos#7645: the keyboard hold reads the reader's row by this
            // Which rows are on screen, so a page landing above keeps the one the reader is on. The eager rows all
            // appear and go together (kosmos#7265), so they count as on screen while any of them shows.
            // kosmos#7420: a row of a list since rebuilt (listEpoch) counts no more: the new list's rows have the same ids, and
            // an old row leaving after its new twin appeared would take the twin out of onScreen.
            .onAppear { if epochAtDraw == listEpoch { onScreen.insert(item.id); openCount.rows(empty: false); if !diagEverDrew { diagEverDrew = true } } }
            .onDisappear {
                guard epochAtDraw == listEpoch else { return }
                onScreen.remove(item.id)
                if onScreen.isEmpty { openCount.rows(empty: true) }
                if onScreen.isEmpty { diagTick &+= 1 }   // kosmos#7420: the diagnostic's check, only when the last row leaves
            }
    }

    // The UIKit list's room under the newest message: the box's fade plus 8 pt (#7346), or the working line drawn over the
    // strip (4 pt above it) with 6 pt clear of the message, whichever is more. 26 pt either way at the default size (the line
    // is 16); at the largest text the line covered 30 pt of the newest message without this (measured 11-09).
    private var endRoom: CGFloat { max(ChatView.fadeHeight + 8, workingLineHeight + 10) }

    @ViewBuilder private var conversation: some View {
        if uikitList, let thread { conversationUIKit(thread) } else { conversationLazy }
    }

    // kosmos#8221 slice 1: the UIKit list. The same rows as the lazy list, in the same order, then the sends on their way and
    // the room at the end (the working line is drawn over the strip above the box, kosmos#8283). Kept at the newest message by
    // the list itself (ChatList); a reader higher up is told of new messages by the capsule. Not here yet (later slices): earlier pages and their loading and failed lines, a
    // reader's place as rows land above, the pull past the end for a read (#8072), the keyboard's settled looks, and the blank
    // checks.
    @ViewBuilder private func conversationUIKit(_ thread: Board.Thread) -> some View {
        let loaded = Board.shownRows(earlier, thread: thread)
        let rows = Board.chatFilter(loaded, agentName: shown.name, query: query)
        let grouped = Board.chatItems(rows, pending: searching ? [] : pending, now: Date(), calendar: .current)
        let items = grouped.items
        let layout = grouped.places
        let byId = Dictionary(items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let sends = pending
        // kosmos#8221 slice 7: a failed earlier page's line is the first cell, as it is the lazy list's first row.
        let failedTop: [String] = earlier.because != nil && !earlier.loading && !searchMode ? ["earlier-failed"] : []
        let top: [String] = failedTop + (thread.rows.isEmpty && pending.isEmpty ? ["empty"]
            : (searching && rows.isEmpty && !loaded.isEmpty ? ["nomatch"] : []))
        // Each id once: a diffable list throws on a repeat, and a row carried into the earlier
        // rows can share its id with one in the new read (parseRows numbers rows per read). The first is kept, as byId keeps it.
        var seen = Set<String>()
        let ids = (top + items.map(\.id) + sends.map(\.id) + ["end"]).filter { seen.insert($0).inserted }   // kosmos#8283: no working row
        // kosmos#8221 slice 2: KOSMOS_SAMPLE_SCROLLUP=<n> on this list too, the n-th row from the end put at the top 3 s
        // after opening (read by the list once, when it is made), with the same marker once it has come to rest.
        #if DEBUG
        let up = Self.sampleScrollUp
        let sampleUp: String? = up > 0 && items.count > up ? items[items.count - up].id : nil
        #else
        let sampleUp: String? = nil
        #endif
        // row() also records each row's place for the keyboard hold (RowTop), read in the lazy list's content space; a hosted
        // cell has no such space, so those readings are not to be used here.
        ChatList(ids: ids, cell: { id in
            if let item = byId[id] { return AnyView(row(item)) }
            if let p = sends.first(where: { $0.id == id }) { return AnyView(pendingBubble(p, layout)) }
            switch id {
            case "empty": return AnyView(empty)
            case "earlier-failed": return AnyView(earlierFailedLine)
            case "nomatch": return AnyView(noMatch)
            case "end": return AnyView(Color.clear.frame(height: endRoom).accessibilityHidden(true))
            default: return AnyView(EmptyView())   // an id with no cell draws nothing, never a gap
            }
        }, newest: uikitNewest, dropped: earlierDropped, landing: earlierLandings, atEnd: { now in
            atBottom = now; endVisible = now
            Self.trace("uikit list: atBottom \(atBottom)")
            if now { unseenNew = false; endSeen = true; settledAtEnd = true }
        }, atTop: { now in
            // kosmos#8221 slice 7: the reader at the top asks for the page before, as the lazy list's top marker does.
            // kosmos#8221 slice 16 review 4: during a landing's hold this change may have been read before the landing (it is
            // queued, not numbered), so it is kept, not acted on: the list's report for the landing says where the top is.
            if earlierLanding { topDuringHold = now; Self.trace("earlier hold kept: top changed", ring: false); return }
            topVisible = now
            if now { loadEarlier("top") }
        }, topRead: { now, seen in
            // kosmos#8221 slice 16: where the top is after the rows changed, and the end of a landing's hold.
            // A reading from before the newest landing describes the rows before it, so it changes nothing (review 3).
            guard seen >= earlierLandings else { return }
            let held = earlierLanding
            earlierLanding = false
            topDuringHold = nil
            topVisible = now
            // Review 4: a reader still at the top after the landing (a chat too short to scroll) is asked for the page before.
            if held { Self.trace("earlier hold off: list read", ring: false); if now { loadEarlier("landed") } }
        }, scroller: { view in
            // kosmos#8221 slice 9: the pull past the newest message (#8072) on this list too. Its guard (allowed: at the
            // newest, not searching) reads endVisible, which this list's atEnd sets.
            endPull.attach(to: view)
        }, sampleUp: sampleUp, sampleRested: {
            #if DEBUG
            sampleScrollRested = true; Self.trace("debug scroll-up rested, atBottom \(atBottom)")
            #endif
        }, sampleA11y: { result in
            #if DEBUG
            sampleA11yResult = result
            #endif
        })
        .kosmosTopFade(ground: Palette.chatGround)
        // While a page loads the line floats over the top and takes no room, as on the lazy list (slice 7).
        .overlay(alignment: .top) { earlierLoadingLine }
        #if DEBUG
        .overlay(alignment: .bottomTrailing) {
            if sampleScrollRested {
                Color.clear.frame(width: 1, height: 1)
                    .allowsHitTesting(false)
                    .accessibilityElement().accessibilityLabel("sample scroll rested").accessibilityIdentifier("sample-scroll-rested")
            }
        }
        .overlay(alignment: .bottomLeading) {
            if let r = sampleA11yResult {
                Color.clear.frame(width: 1, height: 1)
                    .allowsHitTesting(false)
                    .accessibilityElement().accessibilityLabel("sample a11y scroll " + r).accessibilityIdentifier("sample-a11y-scroll")
            }
        }
        #endif
        .onAppear {
            diagThreadAt = Date(); diagEverDrew = !onScreen.isEmpty
            openCount.messagesArrived(rowsDrawn: !onScreen.isEmpty)
        }
        // A reader higher up is not moved by a new message; the capsule offers the jump (not over a search).
        .onChange(of: Board.followKey(thread)) { _ in if !atBottom && !searching { unseenNew = true } }
        // kosmos#8283: the agent starting to work raises no "New messages": its line shows above the box wherever the reader is.
        // Only a message just sent goes to the newest message, as on the lazy list (searching too).
        .onChange(of: pending.count) { n in
            // The same lines as the lazy list's, so a capture from either list reads alike.
            if visible {
                if n > lastPendingCount { Self.trace("send: \(pending.last?.text.count ?? 0) chars, pending \(pending.count) (atBottom \(atBottom), end \(endVisible))") }
                else if n < lastPendingCount { Self.trace("pending down to \(pending.count)") }
            }
            if n > lastPendingCount { uikitNewest &+= 1 }
            lastPendingCount = n
        }
        .onReceive(NotificationCenter.default.publisher(for: .chatScrollToEnd)) { _ in
            guard visible else { return }
            uikitNewest &+= 1
        }
    }

    @ViewBuilder private var conversationLazy: some View {
        if let thread {
            // Day lines run across loaded pages, so a page that ends mid-day does not repeat that day's line.
            // A search shows only the loaded rows it matches, day lines worked out over those (the board repaints the
            // filtered rows the same way).
            let loaded = Board.shownRows(earlier, thread: thread)
            let rows = Board.chatFilter(loaded, agentName: shown.name, query: query)
            // kosmos#7348: pendingBubbles draws each send still on its way as the row it will become.
            let grouped = Board.chatItems(rows, pending: searching ? [] : pending, now: Date(), calendar: .current)
            let items = grouped.items
            let pendingLayout = grouped.places
            // kosmos#7420: the list these markers are drawn in; a list since rebuilt (listEpoch) answers for nothing.
            let drawnEpoch = listEpoch
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        // Earlier messages load by themselves when the person reaches the top (the board's
                        // earlierNearTop); the line says only that a page is loading, or that one failed, with Try again.
                        earlierFailedLine
                        Color.clear.frame(height: 1).id("top")
                            .onAppear { guard drawnEpoch == listEpoch else { return }; Self.trace("top appear"); topVisible = true; loadEarlier("top") }
                            .onDisappear {
                                guard drawnEpoch == listEpoch else { return }
                                topVisible = false
                                if !endSeen { Self.trace("top disappear") }   // only while it can matter to a blank: a reader's scrolling is not traced
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
                        pendingBubbles(pendingLayout)
                        // kosmos#7348: the line always has its room, so its coming and going moves nothing (measured: 27 pt
                        // when an agent picked up a message just sent). Hidden, so VoiceOver does not hear it, and drawn with
                        // still dots, so no animation runs in every chat that is not working.
                        // kosmos#8283: kept on this list. Without the row, a long chat did not open at its newest message on
                        // iOS 26.5 (CI's runner and this Mac, 3 of 10; main 0 of 10; the row's room put back, 0 of 5).
                        ZStack {
                            if working { WorkingLine(name: shown.name) } else { WorkingLine(name: shown.name, animated: false).hidden() }
                        }
                        .padding(.top, 12).id("working")
                        Color.clear.frame(height: ChatView.fadeHeight + 8).id("end")   // the fade plus 8 pt (kosmos#7346): at the end, the newest message sits clear of it
                            .onAppear {
                                guard drawnEpoch == listEpoch else { return }
                                Self.trace("end appear (atBottom was \(atBottom), endSeen was \(endSeen))")
                                endVisible = true
                                rebuildHiding = false
                                atBottom = true; unseenNew = false; endSeen = true
                                // The first scroll has settled when the newest message is really on screen (not after
                                // a time): from then on, reaching the top is the person scrolling up. Checked a turn
                                // later, so the top's own disappearance from the same jump has landed first; a chat too
                                // short to scroll still shows its top then, and loads by itself.
                                if !settledAtEnd { DispatchQueue.main.async { settledAtEnd = true; loadEarlier("settled") } }
                            }
                            .onDisappear {
                                guard drawnEpoch == listEpoch else { return }
                                Self.trace("end disappear (personScrolling \(personScrolling))")
                                endVisible = false
                                if !Self.followsScrollPhase || personScrolling { atBottom = false }
                            }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, ChatView.listPadV)
                    // kosmos#7420 diagnostic: the stack's width (wider than the list is the shift-left Josh saw).
                    .background(GeometryReader { g in
                        Color.clear.onAppear { diagContentWidth = g.size.width }.onChange(of: g.size.width) { diagContentWidth = $0 }
                    })
                    // kosmos#7420 (Josh 10-28, builds 13 to 15): the list only scrolls up and down, so a sideways offset is put
                    // back to its rest and written in the diagnostic's record (see SideScrollLock).
                    .background(SideScrollLock(off: Self.sampleNoLock, box: scrollBox) { x, scrolling, isNew in
                        // kosmos#7575: counted for the report sent when this chat closes (sendShiftReport). The rows are
                        // walked only for a new largest offset, not on every shift (review 1: a cause that fires every frame).
                        shifts.add(offset: Double(x), isNew: isNew, dragging: scrolling) {
                            (Double(diagViewport.width), Double(diagContentWidth), diagKeyboard > 0,
                             Board.chatRowKinds(items, onScreen: onScreen, working: working))
                        }
                    })
                    // kosmos#7609: a reader higher up stays where they were when the keyboard comes up (iOS 26 moved them).
                    // Exactly when the keyboard handler below does not keep the newest message in view.
                    .background(KeyboardHold(hold: visible && !(atBottom || (searchOpen && openedAtNewest && !searching)), above: earlier.rows.count,
                                              moves: "\(appMoves)|\(query)", rows: rowTops) {
                        // kosmos#7645: on CI's runner the list was moved again after each put-back while the id anchor still
                        // held its id, so a reader's place is let go here (Board.letGoAfterPutBack). Until a row is named again
                        // the hold keeps the reader's row for its window; after it nothing holds the place but the offset where it
                        // was left, and a page landing above is kept by keepAnchor. Why: .claude/plans/kbsidelock-7645.md.
                        if Self.idAnchor, Board.letGoAfterPutBack(positionId) {
                            positionId = nil; anchorLetGo = true; Self.trace("keyboard hold: anchor let go")
                            // Whether SwiftUI names a row again by itself (round 2 on CI: it did not); kept so the record keeps saying.
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { Self.trace("keyboard hold: anchor after let go \(Board.anchorKind(positionId))") }
                        }
                        // Review 3: iOS 26's jump may have shown the end (atBottom true) before it was put back; the end's
                        // disappearance clears atBottom only under a person's scroll, so the reader's place is read again.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { if atBottom && !endVisible { atBottom = false; Self.trace("keyboard hold: not at the newest after all") } }
                    } onRowLost: { id, f in
                        // kosmos#7609 (CI, 10-31): the reader's message not drawn at did-show while the rows above were measured
                        // again (content 14008 to 15249 pt): put back by its last reading it landed off the screen. Placed by its id
                        // instead, with the anchor let go first, whatever it holds: the hold runs only for a reader away from the newest,
                        // so an "end" here is stale and would pull the list back under the scroll (after a put-back "end" stays, since
                        // nothing scrolls then).
                        if Self.idAnchor { positionId = nil; anchorLetGo = true; Self.trace("keyboard hold: anchor let go for the placing") }
                        DispatchQueue.main.async { proxy.scrollTo(id, anchor: UnitPoint(x: 0.5, y: f)); Self.trace("keyboard hold: placed by id") }
                    })
                    .modifier(PositionTargets(on: Self.idAnchor))
                    .modifier(ContentSpace())   // kosmos#7645: rows read their place in the content by this (iOS 26 and later)
                }
                .modifier(PositionById(on: Self.idAnchor, id: $positionId))
                .opacity(rebuildHiding ? 0 : 1)
                .allowsHitTesting(!rebuildHiding)
                .accessibilityHidden(rebuildHiding)
                .id(listEpoch)   // kosmos#7420: a new epoch is a new list (recoverEmpty's .rebuild)
                .scrollDismissesKeyboard(.interactively)
                .modifier(PersonScroll(scrolling: $personScrolling) {
                    // Their scroll has come to rest: they are at the newest message exactly when the end shows.
                    atBottom = endVisible
                    if endVisible { unseenNew = false }
                    Self.trace("person scroll rested, atBottom \(endVisible)")
                    // kosmos#7645: whether the reader's own scroll names a row again after a let-go (it ends the let-go) is not measured.
                    if anchorLetGo { Self.trace("anchor after a scroll while let go \(Board.anchorKind(positionId))") }
                })
                // While a page loads the line floats over the thread's top edge and takes no room, so nothing moves
                // (the board's paintOlderLine).
                .kosmosTopFade(ground: Palette.chatGround)   // kosmos#7346: rows fade under the solid top bar; the banner and search above stay clear
                .overlay(alignment: .top) { earlierLoadingLine }
                #if DEBUG
                .overlay(alignment: .bottomTrailing) {
                    if sampleScrollRested {
                        Color.clear.frame(width: 1, height: 1)
                            .allowsHitTesting(false)
                            .accessibilityElement().accessibilityLabel("sample scroll rested").accessibilityIdentifier("sample-scroll-rested")
                    }
                    if let sampleRebuilds {
                        Color.clear.frame(width: 1, height: 1)
                            .allowsHitTesting(false)
                            .accessibilityElement().accessibilityLabel("sample rebuilt \(sampleRebuilds)").accessibilityIdentifier("sample-rebuilt")
                    }
                }
                #endif
                // kosmos#7420 diagnostic: the list's size, and a check whenever no message is on screen.
                .background(GeometryReader { g in
                    Color.clear.onAppear { diagViewport = g.size }
                        .onChange(of: g.size) { now in diagViewport = now; Self.trace("viewport \(Int(now.width))x\(Int(now.height))") }
                })
                // Review 1: driven by a tick bumped only when the last row leaves (row()), never by reading onScreen here,
                // which would redraw the whole chat on every row that scrolls in or out. Checked at 0.5 s and again at 1.5 s.
                .onChange(of: diagTick) { _ in
                    for wait in Board.diagCheckWaits { DispatchQueue.main.asyncAfter(deadline: .now() + wait) { diagCheck(proxy, count: items.count) } }
                }
                // Review 1: a row wider than the list, measured in one pass (diagContentWidth carries the list's width beside it)
                // and still so 0.3 s later, so a rotation or resize between two readers cannot fire it.
                .onChange(of: diagWide) { wide in
                    guard wide else { return }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { if diagWide { diagCapture(proxy, why: "a row wider than the screen", count: items.count, recover: false) } }
                }
                // kosmos#8053: the dots read the state and write none of it; Try again, on a tap, is the one write.
                .modifier(BlankListRing(isBlank: {
                    !personScrolling && !scrollBox.underFinger && Board.listBlank(rows: self.thread?.rows.count ?? 0, drawn: onScreen.count, endShowing: endSeen && endVisible, sending: !pending.isEmpty, visible: visible, searching: searchMode)
                }, tryAgain: {
                    rebuilds = []; atBottom = true
                    recoverEmpty(proxy, forceRebuild: true)   // the person asked, and what else it does has just failed for 10 s
                }))
                // Review 4 and 5: the list first existing (the messages arrived) starts the never-drawn clock, and a check runs
                // once it has passed. Here, not an onChange inside this branch, which never sees its own creation.
                .onAppear {
                    diagThreadAt = Date(); diagEverDrew = !onScreen.isEmpty
                    openCount.messagesArrived(rowsDrawn: !onScreen.isEmpty)
                    DispatchQueue.main.asyncAfter(deadline: .now() + Board.endNeverShownCheck) { diagTick &+= 1 }
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
                        sampleScrollRested = false
                        // Counts as the person's own scroll (nothing in the simulator can drag).
                        // With the id anchor, a person's scroll moves the anchor; a scrollTo alone would not, so move it too.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                            if Self.idAnchor { positionId = target } else { proxy.scrollTo(target, anchor: .top) }
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3.6) { sampleScrollRest(tries: 0) }
                    }
                    // kosmos#7420: KOSMOS_SAMPLE_REBUILD=1 runs the empty-list recovery 3 s after opening, the reader at the newest
                    // (so the real decision gives .rebuild), then shows a marker with the rebuilds counted. The cause (rows not drawn within
                    // the content) is not reproduced here; this checks the chat after a rebuild.
                    // =<seconds> sets the delay ("1" is 3 s), so a check can bring the keyboard up and down first (Josh's third
                    // build-24 report went empty right after the keyboard came down).
                    // kosmos#7688 (4): =afterhide runs it 1 s after the keyboard has gone down (keyboardDidHide), not on a clock,
                    // so a slow runner cannot fire it before the keyboard is down.
                    if let v = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_REBUILD"], !Self.sampleRebuildDone,
                       v == "afterhide" || (Double(v) ?? 0) > 0 {
                        Self.sampleRebuildDone = true
                        if v == "afterhide" {
                            var seen: NSObjectProtocol?
                            // Review 1: then once the finger is off and the drag has stopped (at most 4 s more), or the
                            // recovery would see a scroll under the finger and not rebuild.
                            func whenStill(_ left: Int) {
                                if left > 0 && (personScrolling || scrollBox.underFinger) {
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { whenStill(left - 1) }
                                } else {
                                    if left == 0 { Self.trace("debug rebuild: still scrolling after 4 s, ran anyway") }   // review 2
                                    sampleRebuild(proxy)
                                }
                            }
                            seen = NotificationCenter.default.addObserver(forName: UIResponder.keyboardDidHideNotification, object: nil, queue: .main) { _ in
                                if let s = seen { NotificationCenter.default.removeObserver(s); seen = nil }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1) { whenStill(16) }
                            }
                        } else {
                            let n = Double(v) ?? 1
                            DispatchQueue.main.asyncAfter(deadline: .now() + (n == 1 ? 3 : n)) { sampleRebuild(proxy) }
                        }
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
                .onChange(of: positionId) { id in if id != nil { anchorLetGo = false } }   // kosmos#7645: a row named again ends the let-go
                // The place kept after a page lands above: the row that was first stays at the top.
                .onChange(of: keepAnchor) { id in
                    guard let id else { return }
                    // The id anchor already keeps the reader's message in place as a page lands above (kosmos#7265). Once a
                    // keyboard put-back has let it go (kosmos#7645) there is none, so the row is kept as on iOS 16.
                    if !Board.keepPageByScroll(idAnchor: Self.idAnchor, letGo: anchorLetGo, anchor: positionId) { keepAnchor = nil; return }
                    Self.trace("keepAnchor scrollTo a message")   // kosmos#7420 review 1: no message id in the record
                    proxy.scrollTo(id, anchor: .top)
                    // kosmos#7645: after a let-go on iOS 17+ this scroll runs beside the id anchor; whether SwiftUI then names a row
                    // in the binding (the .bottom anchor taking over) is not measured: the record says.
                    if Self.idAnchor, anchorLetGo { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { Self.trace("keepAnchor: anchor after \(Board.anchorKind(positionId))") } }
                    keepAnchor = nil
                }
                .onChange(of: keepAtEndTick) { _ in
                    // kosmos#7420 review 5: a read that left the same newest row at a drawn end moves nothing. The settled look
                    // stays, so a read that left the list blank or past its end is still put right.
                    // Review 8: self.thread, the chat's state: a bare `thread` here is the previous body's copy, from before this read.
                    if Self.idAnchor, let now = self.thread, quietFollowKey == Board.followKey(now) {
                        Self.trace("keepAtEnd: the newest row unchanged and drawn, not moved")
                        settleAtNewest(proxy, boxMoved: false)
                        return
                    }
                    Self.trace("keepAtEnd scrollTo end")
                    // kosmos#7420 (build 33, 18:59): the whole window replaced the small first page and was measured again
                    // after this; the content shrank under the offset and left it past the end. Settle and look again.
                    if Self.idAnchor { goNewest(proxy); settleAtNewest(proxy, boxMoved: false); return }
                    if !Self.sampleNoKeep {
                        // iOS 16: after the new rows have laid out, and once more a beat later (the else is the debug control).
                        DispatchQueue.main.async { proxy.scrollTo("end", anchor: .bottom) }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { proxy.scrollTo("end", anchor: .bottom) }
                    } else {
                        proxy.scrollTo("end", anchor: .bottom)
                    }
                }
                .onChange(of: Board.followKey(thread)) { key in
                    if Self.idAnchor, quietFollowKey == key { return }   // review 5: older rows landing; the newest is the same
                    follow(proxy)
                }
                .onChange(of: working) { now in if now { follow(proxy) } }
                // Only a message just sent scrolls down; one settling into its row does not move the person's place.
                // While searching too, unlike the board's jumpToOwnSend: the phone keeps the sent bubble on screen below
                // what matched, and it is the send's only feedback.
                .onChange(of: pending.count) { n in
                    // kosmos#8038: a send writes a line, so a capture can say whether a blank came at a send. Its length, never its words.
                    if visible {
                        if n > lastPendingCount { Self.trace("send: \(pending.last?.text.count ?? 0) chars, pending \(pending.count) (atBottom \(atBottom), end \(endVisible))") }
                        else if n < lastPendingCount { Self.trace("pending down to \(pending.count)") }
                    }
                    if n > lastPendingCount { goNewest(proxy, animated: true) }
                    lastPendingCount = n
                }
                // The keyboard shrinks the thread; one that was at the newest message stays there (the spec).
                // Whether it was at the newest message is read before the keyboard shrinks the thread (which hides the
                // end marker), and acted on once it is up.
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { n in
                    // kosmos#7420 review: a keyboard coming up cancels the looks a did-hide left, or one runs mid-animation on a passing
                    // reading and can spend a rebuild; its own did-show asks again once it is up.
                    kbSettleTick &+= 1
                    // kosmos#7609: a chat kept alive under another tab records nothing to keep, so the flag can only ever
                    // say "keep" for the chat on screen, as the handler below that acts on it requires.
                    guard visible else { keepNewestInView = false; return }
                    diagKeyboard = (n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect)?.height ?? 0
                    Self.trace("keyboard up \(Int(diagKeyboard)) (atBottom \(atBottom))")
                    keepNewestInView = atBottom || (searchOpen && openedAtNewest && !searching)
                }
                // kosmos#7817 (Josh 11-02): the box growing or shrinking a line as he typed moved the conversation elsewhere.
                // Anything in the strip counts (a wrap, the line above the box, the emoji panel, a reply or file row). A
                // reader at the newest message is kept there (when followsBox is on); one higher up is left alone.
                // kosmos#7817 (Josh 11-03, build 29): on his phone this follow landed past every drawn row of a long chat (content
                // reported 124690 pt against 19498 rebuilt), a blank list, worse than the jump it fixed. Off until that
                // overshoot is reproduced and fixed (followsBox); the jump comes back meanwhile.
                .onChange(of: stripHeight) { _ in
                    guard visible, atBottom, !searching, !personScrolling, !scrollBox.underFinger else { return }
                    guard Self.followsBox else {
                        // kosmos#7420 (Josh's phone, build 33, 18:51): unfollowed, two lines of growth left the list on a stretch
                        // its estimate had no rows for. Once the layout settles, the settled look rebuilds a blank list or brings the newest
                        // back if its end is gone (settledPutBack).
                        if Self.diagRing.last?.hasSuffix("box height changed, settling at the newest") != true { Self.trace("box height changed, settling at the newest") }
                        settleAtNewest(proxy, boxMoved: true)
                        return
                    }
                    Self.trace("box height changed, to the newest")
                    if Self.idAnchor { appMoves &+= 1; proxy.scrollTo("end", anchor: .bottom); positionId = "end" } else { goNewest(proxy) }
                }
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                    // kosmos#7817 (Josh 11-03 09:27, build 30): did-show came three times in 0.3 s as the keyboard went 380, 608,
                    // 380, and the chat was left past its end, blank. Once did-show has been quiet, a list past its end is put
                    // back (settledPutBack); asked on every did-show of the chat on screen, since past the end is nobody's place.
                    if visible { settleAtNewest(proxy, boxMoved: true) }
                    // Only the chat on screen: another tab can keep a chat alive under it.
                    guard keepNewestInView, visible else { return }
                    // kosmos#7420 (Josh 11-04 08:26, "jumping around ... when I type"): a list already at its end is not moved
                    // again; the keyboard's height flips (345, 380, 608) each sent a did-show and each one scrolled.
                    // Build 43 (Josh 11-04 21:11): shortOfEnd reads 0 past the end too, so a list 387 pt past its end, nothing drawn, was
                    // called "at the newest already" and left blank until a later look. Past the end is never at the newest, unless a finger or a fling is on it: that is a bounce, and is not moved.
                    if scrollBox.reading()?.place != "past the end" || scrollBox.underFinger, let s = scrollBox.shortOfEnd(), s <= Double(Self.listPadV) + 4 { Self.trace("keyboard shown, at the newest already"); return }
                    Self.trace("keyboard shown, to the newest")
                    // kosmos#7344: re-setting an anchor that already reads "end" does not move the thread, so scroll to it.
                    // Not animated under the anchor, as goNewest is (the side lock, #7574, relies on that).
                    if Self.idAnchor { proxy.scrollTo("end", anchor: .bottom); positionId = "end" } else { goNewest(proxy, animated: true) }
                }
                // kosmos#8045: the tray rising with no keyboard takes the list's room as a keyboard would, so a reader at the newest
                // stays there. With a keyboard up the list does not move at all.
                .onChange(of: trayOpen) { open in
                    guard visible else { return }
                    if open {
                        guard !trayFromKeyboard, atBottom, !searchMode else { return }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            guard trayOpen, visible, !personScrolling else { return }   // a reader's finger is never moved
                            if Self.idAnchor { proxy.scrollTo("end", anchor: .bottom); positionId = "end" } else { goNewest(proxy, animated: true) }
                        }
                    } else if !composerFocused {
                        // Going down with no keyboard takes the same room a keyboard going down does: the same look (#7420).
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { if !trayOpen, visible { settleAtNewest(proxy, boxMoved: false) } }
                    }
                }
                // Only the chat on screen: another tab can keep a chat alive under it.
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
                    // kosmos#7817/#7420: a keyboard going down (on screen or not) cancels every settled look still waiting.
                    kbSettleTick &+= 1; boxAskedAt = nil
                    if visible { diagKeyboard = 0; Self.trace("keyboard down") }
                }
                // kosmos#7420 (build 48, Josh 11-05 08:26): the blank came as the keyboard went down, and the will-hide above cancels
                // the looks, so nothing looked at the list afterwards. Its bottom inset falls by the keyboard's height, which can leave
                // it past its end with nothing drawn. The same looks as a did-show: they move only a list past its end or with
                // nothing drawn, never a drawn list (boxMoved false) or one under a finger.
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in
                    if visible { Self.trace("keyboard gone, looking"); settleAtNewest(proxy, boxMoved: false) }
                }
                .onReceive(NotificationCenter.default.publisher(for: .chatScrollToEnd)) { _ in
                    guard visible else { return }
                    goNewest(proxy, animated: true)
                }
                #if DEBUG
                // kosmos#7420, KOSMOS_SAMPLE_WALK=1: the walk's steps count as a reader's scroll, as a drag's do.
                .onReceive(NotificationCenter.default.publisher(for: .sampleWalking)) { n in
                    // Only the walk under this chat's own list: the notice carries that list's RowTops.
                    guard let from = n.object as? RowTops, from === rowTops else { return }
                    let phase = n.userInfo?["phase"] as? String ?? "end"
                    if phase == "newest" { if visible { goNewest(proxy, animated: true) }; return }
                    let walking = phase == "start"
                    guard visible || !walking else { return }
                    personScrolling = walking
                    // A scroll by code leaves the id anchor naming "end", and SwiftUI puts the list back there on its next
                    // update (measured: from 5166 to 28435 on the poll); a finger's scroll moves the anchor, so let it go.
                    if personScrolling { atBottom = false; positionId = nil; anchorLetGo = true; rowTops.walkTaken = true }
                }
                #endif
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
                    SweepDots(scales: false)
                    Text("Loading the conversation\u{2026}").font(.footnote).foregroundColor(Palette.secondary)
                }
                Spacer()
                // A message sent before any conversation was read is still shown, with its not-sent line if it fails.
                VStack(spacing: 0) { pendingBubbles([:]) }
            }
            .padding(.horizontal, 32)
            .frame(maxWidth: .infinity)
        }
    }

    private func dayHeader(_ label: String) -> some View {
        Text(label).font(.caption.weight(.semibold)).foregroundColor(Palette.secondary)
            .frame(maxWidth: .infinity)
            .padding(.top, 16).padding(.bottom, 8)
            .accessibilityAddTraits(.isHeader)
    }

    // A place missing from the layout (no conversation read yet, a search, no row coming) is drawn as before: its own run, last.
    @ViewBuilder private func pendingBubbles(_ layout: [String: Board.PendingPlace]) -> some View {
        ForEach(pending) { p in pendingBubble(p, layout) }
    }

    // One send on its way, with its day line when it starts a day (kosmos#8221: a cell of its own in the UIKit list).
    @ViewBuilder private func pendingBubble(_ p: Board.PendingSend, _ layout: [String: Board.PendingPlace]) -> some View {
        let place = layout[p.id] ?? Board.PendingPlace(day: nil, first: true, last: true)
        if let day = place.day {
            dayHeader(day)
        }
        PendingBubble(item: p, widthShare: widthShare, line: Board.notSentLine(agentRunning: running, name: shown.name),
                      retry: { sendWhenFree { await client.retry(p.id, to: agent) } },
                      delete: { client.discard(p.id, for: agent.session) },
                      head: headFor(replyTo: p.replyTo), headHidden: pendingHeadsHidden.contains(p.id),
                      dropReply: p.replyTo != nil && Board.replyRefusedForGood(failedReason(p))
                          ? { sendWhenFree { await client.retryWithoutReply(p.id, to: agent) } } : nil,
                      lastOfRun: place.last)
            .padding(.top, place.first ? 10 : 2)
            .id(p.id)
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
        appMoves &+= 1
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

    // kosmos#7817 (11-03): the message box's growth is not followed in a release build (the follow blanked a long chat on
    // Josh's phone, build 29). Debug: KOSMOS_SAMPLE_BOXFOLLOW=1 turns it on, so the UI checks keep exercising it.
    // Before turning it back on: no UI check yet asks that a long chat's rows are still drawn while the box grows with
    // the follow on (the case that blanked); add that one first.
    static let followsBox: Bool = {
        #if DEBUG
        return ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_BOXFOLLOW"] == "1"
        #else
        return false
        #endif
    }()

    // kosmos#7817 (11-03): how long the keyboard's did-show must be quiet before a list left past its end is put back.
    static let keyboardSettle: Double = 0.3
    // When it looks, after the last did-show: once settled, and once more after iOS's later moves of the list (KeyboardHold
    // guards 1.5 s for those) and a short fling.
    static let keyboardSettleLooks: [Double] = [keyboardSettle, 1.2]

    // kosmos#7346: how far above the solid strip messages fade into it. The end marker and the New messages button
    // are both set from it, so changing it can never hide the newest message under the fade.
    static let fadeHeight: CGFloat = 18
    // The list's padding above its first row and below the end marker; settledPutBack allows for it at the end (#7420).
    static let listPadV: CGFloat = 12
    // TestFlight 37 review 1: how long a settled look waits to confirm a blank before rebuilding a reader higher up.
    static let blankConfirm: Double = 0.5
    // kosmos#7420 review 6: how long a box change still counts for a later settle ask (past the last look, 1.2 s).
    static let boxAskCarries: Double = 1.5

    // kosmos#7265: iOS 18 reports the scroll phase, which tells the person's scroll from rows moving under them.
    static var followsScrollPhase: Bool { if #available(iOS 18.0, *) { return true } else { return false } }

    // kosmos#7265 debug: KOSMOS_SAMPLE_TRACE=1 appends the chat's scroll state to Documents/trace.txt.
    // kosmos#7420 diagnostic: no message on screen for half a second while the conversation has some (the black list).
    private func diagCheck(_ proxy: ScrollViewProxy, count: Int) {
        // Review 1: only for the chat on screen with the app in front: under the info page, another tab or Quick Look every
        // row leaves too, and that is not a fault.
        // Review 3 and 4: a list whose end never showed never moved the end marker, so that arm needs the messages to have arrived
        // more than 2 s ago (never the moment after an account or computer change, before its rows appear).
        // kosmos#7420 (Josh 11-05 12:57): the top marker can read as showing with nothing drawn, so a list whose end never showed passes that too.
        let neverShown = Board.endNeverShown(endSeen: endSeen, messagesFor: diagThreadAt.map { Date().timeIntervalSince($0) })
        guard visible, scenePhase == .active, !searchMode, onScreen.isEmpty, !endVisible || neverShown, !topVisible || neverShown, count > 0, thread != nil else {
            // A capture can then say what held a blank off.
            if onScreen.isEmpty, visible, count > 0, Self.diagRing.last?.contains("diag: blank, not yet acting") != true {
                Self.trace("diag: blank, not yet acting: end \(endVisible), end seen \(endSeen), top \(topVisible), app active \(scenePhase == .active), search \(searchMode)")
            }
            return
        }
        // kosmos#7420: a list just rebuilt has no rows for a moment while the new one lays out; that is not an empty list
        // (measured on iOS 27: without this the rebuild's own gap read as empty and rebuilt it again, three times).
        if let at = rebuilds.last, Date().timeIntervalSince(at) < Board.rebuildGrace { return }
        // kosmos#7420 review 5: a look under a scroll or a finger neither moves the reader nor uses up the first try. It comes
        // back: nothing else looks again once the scroll ends (a row that never drew never leaves). One waits at a time.
        if personScrolling || scrollBox.underFinger { diagLookAgain(); return }
        // Rows have drawn but no end has shown, so "at the newest" may only be its starting value: a reader higher up is not moved
        // for a list empty for an instant. Still blank a moment on, it is blank.
        if neverShown, diagEverDrew {
            let chatAt = epoch, listAt = listEpoch
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.blankConfirm) {
                guard epoch == chatAt, listEpoch == listAt, visible, onScreen.isEmpty, !endSeen,
                      scenePhase == .active, !searchMode, !(rebuilds.last.map { Date().timeIntervalSince($0) < Board.rebuildGrace } ?? false) else { return }
                if personScrolling || scrollBox.underFinger { diagLookAgain(); return }   // nothing else looks again once a scroll ends
                diagCapture(proxy, why: "no message on screen", count: count)
            }
            return
        }
        diagCapture(proxy, why: "no message on screen", count: count)
    }

    private func diagLookAgain() {
        guard !diagRetrying else { return }
        diagRetrying = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { diagRetrying = false; diagTick &+= 1 }
    }

    // kosmos#7420: back in front with nothing on screen: the time away does not count, since iOS can draw the list by itself on the way
    // back (Josh 11-05 12:57). The never-drew clock starts again, and a check runs once it has passed.
    private func diagBackInFront() {
        guard visible, diagThreadAt != nil, !endSeen, onScreen.isEmpty else { return }
        diagThreadAt = Date()
        DispatchQueue.main.asyncAfter(deadline: .now() + Board.endNeverShownCheck) { diagTick &+= 1 }
    }

    // Once per open chat: the numbers at that moment and the last events, then one try at putting the newest message back,
    // and where the scroll was after it. Later empty lists in the same chat are put right without a report (see below).
    // Nothing leaves the phone unless the person shares it.
    private func diagCapture(_ proxy: ScrollViewProxy, why: String, count: Int, recover: Bool = true) {
        guard visible, scenePhase == .active else { return }
        // kosmos#7420 (build 22, 10-30): reported once per chat. A later empty list (or the same one at the 1.5 s check) is
        // put right only as Board.emptyRecovery says: past the content's end, or (build 24) rebuilt when within the content
        // at the newest. Nobody scrolling either way. The first try, the reported blank, rebuilds whatever the anchor
        // (TestFlight 37), and a later blank for a reader higher up does so once it holds still (below). A later reading reaches here only through
        // diagCheck, which asks for no row counted and nobody scrolling, and, unless the list never drew, the end and the top not showing.
        // The later-blank arm below asks for the end and the top itself.
        // Review 5: a blank that comes after the first try, for a reader higher up, is still a blank: rebuilt if it holds
        // still for blankConfirm, as the settled look does, so a list empty for an instant moves nobody.
        if recover, diagDone, !atBottom, scrollBox.reading()?.place == "within" {
            let chatAt = epoch, listAt = listEpoch
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.blankConfirm) {
                guard epoch == chatAt, listEpoch == listAt, visible, scenePhase == .active, !searchMode, onScreen.isEmpty,
                      !endVisible, !topVisible, !(thread?.rows.isEmpty ?? true)
                else { return }
                // Review 6: a finger that arrived during the wait is the same as one at the look: come back.
                if personScrolling || scrollBox.underFinger { diagLookAgain(); return }
                Self.trace("diag: a later blank, a reader higher up, still blank")
                recoverEmpty(proxy, keepPlace: true)
            }
            return
        }
        if recover, diagDone { recoverEmpty(proxy, later: true); return }
        guard recover || !diagWideDone else { return }
        if recover { diagDone = true } else { diagWideDone = true }
        let info = Bundle.main.infoDictionary
        let anchor = Board.anchorKind(positionId)
        var lines = ["Kosmos iPhone chat diagnostic (kosmos#7420)",
                     "what: \(why)",
                     "app \(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?")), iOS \(UIDevice.current.systemVersion)",
                     "list \(Int(diagViewport.width))x\(Int(diagViewport.height)), stack width \(Int(diagContentWidth)), keyboard \(Int(diagKeyboard))",
                     "messages \(count), on screen \(onScreen.count), end showing \(endVisible), top showing \(topVisible), at newest \(atBottom)",
                     "anchor \(anchor), id anchor \(Self.idAnchor), searching \(searchMode), keyboard focus \(composerFocused)",
                     scrollBox.reading()?.line ?? "scroll: no scroll view found",
                     "recent events:"] + Self.diagRing
        guard recover else { diagRebuilt = false; diagReport = lines.joined(separator: "\n"); announceDiag(); return }   // review 1: a width finding moves nobody
        Self.trace("diag: \(why), trying the newest message")
        let before = rebuilds.count
        recoverEmpty(proxy)
        // kosmos#7688 (2): after a rebuild the new list needs its grace before a reading means anything (0.6 s read the new
        // scroll view half laid out, or none), and the person is told it was rebuilt, not only that it failed.
        let rebuilt = rebuilds.count > before
        let wait = rebuilt ? Board.rebuildGrace + Board.rebuildCheckBump : 0.6
        let chatAt = epoch, clientAt = client.chatEpoch
        DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
            // Review 1: still this chat, on screen (another account, computer or chat in the wait writes nothing).
            guard visible, epoch == chatAt, client.chatEpoch == clientAt else {
                // Review 2: left (the info page, another tab) under the same account: the next empty check may capture again,
                // so this open chat's report is not lost.
                if epoch == chatAt && client.chatEpoch == clientAt { diagDone = false }
                return
            }
            // kosmos#7420 (10-29): onScreen counts rows SwiftUI said appeared, not rows drawn; the scroll's place is measured.
            lines.append("after one try\(rebuilt ? " (list rebuilt)" : ""): " + (scrollBox.reading()?.line ?? "scroll: no scroll view found") + "; rows said to appear \(onScreen.count); " + Board.rowsAgainstScreen(rowTops.y.values.map(\.content), showing: scrollBox.showing(), ends: rowTops.y.values.map(\.end)))
            diagRebuilt = rebuilt
            diagReport = lines.joined(separator: "\n")
            announceDiag()
        }
    }

    #if DEBUG
    // kosmos#7420: KOSMOS_SAMPLE_REBUILD's recovery, once the reader is at the newest: on CI's loaded runner a long chat can
    // still be settling at the delay, and the real decision then rightly gives no rebuild, which is not what this checks.
    private func sampleRebuild(_ proxy: ScrollViewProxy, waited: Double = 0) {
        // All that emptyRecovery asks for: "sample rebuilt 0" on CI (#7708) showed the newest alone was not enough on a loaded
        // runner, where the list can still be moving or outside its content.
        let ready = atBottom && !personScrolling && !scrollBox.underFinger && scrollBox.reading()?.place == "within"
        if !ready, waited < 15 {
            // kosmos#7767: measured on CI: the long list can sit past its end for all 15 s, and the check then saw no rebuild. What the
            // app does for a list past its end brings it back, so the wait can end in the state this hook is for.
            if waited == 5, scrollBox.reading()?.place == "past the end" { Self.trace("debug rebuild: past the end at 5 s"); recoverEmpty(proxy, later: true) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { sampleRebuild(proxy, waited: waited + 0.5) }
            return
        }
        // kosmos#7767: what the rebuild check saw when it stopped waiting; a failure of that check prints these lines.
        let place = scrollBox.reading()?.place ?? "unread"
        Self.trace("debug rebuild: waited \(waited), atBottom \(atBottom), personScrolling \(personScrolling), underFinger \(scrollBox.underFinger), place \(place)")
        recoverEmpty(proxy, later: true)
        // Counted after the last check the rebuild schedules (Board's rebuild timing).
        let after = Board.rebuildGrace + Board.rebuildCheckBump + (Board.diagCheckWaits.max() ?? 0) + 0.9
        DispatchQueue.main.asyncAfter(deadline: .now() + after) { sampleRebuilds = rebuilds.count }
    }
    #endif

    #if DEBUG
    // kosmos#7609 (main run 41700157014): on a slow runner the end still showed 0.6 s after the sample's scroll, so the rest
    // read atBottom true and the check measured a reader at the newest. The rest waits for the end to go: every 0.2 s, 5 s at most.
    private func sampleScrollRest(tries: Int) {
        if endVisible, tries < 25 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { sampleScrollRest(tries: tries + 1) }; return }
        atBottom = endVisible; sampleScrollRested = true; Self.trace("debug scroll-up rested, atBottom \(endVisible)")
    }
    #endif

    // kosmos#7420: the settled looks, after a keyboard did-show (#7817), a change of the box's height at the newest, or a
    // thread read while the chat is kept at the newest (keepAtEndTick). Each new ask replaces the looks still waiting.
    // boxMoved: a did-show or a box change, the asks after which the box can cover the newest message.
    private func settleAtNewest(_ proxy: ScrollViewProxy, boxMoved: Bool) {
        kbSettleTick &+= 1
        // Review 6: a thread read inside a box change's looks replaces them, and keeps that the box moved.
        if boxMoved { boxAskedAt = Date() }
        let moved = boxMoved || (boxAskedAt.map { Date().timeIntervalSince($0) < Self.boxAskCarries } ?? false)
        let tick = kbSettleTick, chatAt = epoch, listAt = listEpoch, boxMoved = moved
        for at in Self.keyboardSettleLooks {
            DispatchQueue.main.asyncAfter(deadline: .now() + at) { settledPutBack(proxy, tick: tick, chatAt: chatAt, listAt: listAt, boxMoved: boxMoved) }
        }
    }

    // kosmos#7817: at a settled look (settleAtNewest), a list read past its end is put back at its end, then at the newest
    // message, unless a search is typed, another ask or a will-hide came, the chat or its list changed, or a finger (or a
    // fling) is on it at that look. kosmos#7420: within the content, see below.
    // again: the one look after this function's own id scroll, which only puts back a landing past the end (review 7).
    private func settledPutBack(_ proxy: ScrollViewProxy, tick: Int, chatAt: Int, listAt: Int, boxMoved: Bool, again: Bool = false) {
        // kosmos#7420 review: not while inactive: backgrounding brings a did-hide, and the past-the-end arm below would write offsets then.
        guard tick == kbSettleTick, epoch == chatAt, listEpoch == listAt, visible, !searching, scenePhase == .active else { return }
        let place = scrollBox.reading()?.place ?? "unread"
        guard place == "past the end" else {
            if again { return }
            // kosmos#7420 (build 33, 18:51): within the content, with nothing drawn (the estimate's stretch with no rows), or at
            // the newest after a keyboard or box change with the end gone. The offset short of the end is only traced.
            // A drawn list is moved only for a reader at the newest (atBottom); a finger or a reader's scroll is never moved.
            // TestFlight 37 (Josh 11-04 08:07): a list with NOTHING drawn is rebuilt whatever the anchor, since a blank
            // screen keeps no place worth holding.
            let short = scrollBox.shortOfEnd() ?? 0
            // kosmos#7420 (Josh 11-04 08:26, jumping on open and while typing): a drawn list is moved only after a keyboard or
            // box change (boxMoved) and only with its end gone; the short-of-end move (a delayed follow of every new line of
            // the box) is gone, so a box that takes the end marker off screen still brings the newest back here, 0.3 s on. This
            // look moves a drawn list for nothing else. A list with nothing drawn is still rebuilt.
            if place == "within", (boxMoved && !endVisible) || onScreen.isEmpty {
                if atBottom || (onScreen.isEmpty && !Self.sampleNoRebuild), !personScrolling, !scrollBox.underFinger {
                    // Review 6: a list just rebuilt is laying out and goes to its newest itself; neither arm acts in its grace.
                    if let at = rebuilds.last, Date().timeIntervalSince(at) < Board.rebuildGrace { return }
                    if onScreen.isEmpty {
                        // kosmos#7420 (build 34, Josh 21:33): going to the newest by id against the inflated estimate landed in
                        // the same undrawn stretch; the rebuild (recoverEmpty) measures the list again and drew rows each time.
                        // Review 1: never for a chat with no rows (nothing to draw is not a blank), and not while a list just
                        // rebuilt is still laying out (its own gap, as diagCheck waits Board.rebuildGrace).
                        // Review 2: nor while a chat is still opening (slow, not blank), for 2 s (Board.endNeverShown).
                        // Review 3: nor with an end that has shown still showing (a pending bubble can fill the list), nor with the app not active,
                        // as diagCheck. It spends recoverEmpty's own per-open budget (rebuildsMax).
                        // Josh 11-05 12:57: review 2 held for as long as the blank did, about 6.6 s through three looks.
                        guard scenePhase == .active, !(thread?.rows.isEmpty ?? true),
                              Board.settledBlankActs(endVisible: endVisible, endSeen: endSeen, everDrew: diagEverDrew, messagesFor: diagThreadAt.map { Date().timeIntervalSince($0) }) else {
                            Self.trace("keyboard settled: within, nothing drawn"); return
                        }
                        if atBottom, diagEverDrew, !endSeen {
                            // As diagCheck: rows drew and no end showed, so "at the newest" may be only its starting value.
                            DispatchQueue.main.asyncAfter(deadline: .now() + Self.blankConfirm) {
                                guard tick == kbSettleTick, epoch == chatAt, listEpoch == listAt, visible, !searching, onScreen.isEmpty, !endSeen,
                                      !personScrolling, !scrollBox.underFinger, scenePhase == .active,
                                      !(thread?.rows.isEmpty ?? true), !(rebuilds.last.map { Date().timeIntervalSince($0) < Board.rebuildGrace } ?? false)
                                else { return }
                                Self.trace("keyboard settled: within, nothing drawn, no end yet, rebuilt")
                                recoverEmpty(proxy)
                            }
                        } else if atBottom {
                            Self.trace("keyboard settled: within, nothing drawn, rebuilt")
                            recoverEmpty(proxy)
                        } else {
                            // Review 1: a reader higher up is rebuilt only if the list is still blank a moment on, so a list
                            // empty for an instant (a row placed by id, a redraw) moves nobody.
                            DispatchQueue.main.asyncAfter(deadline: .now() + Self.blankConfirm) {
                                // Review 2: every guard the immediate arm has, read again.
                                guard tick == kbSettleTick, epoch == chatAt, listEpoch == listAt, visible, !searching, onScreen.isEmpty,
                                      !endVisible, !personScrolling, !scrollBox.underFinger, scenePhase == .active,
                                      !(thread?.rows.isEmpty ?? true), !(rebuilds.last.map { Date().timeIntervalSince($0) < Board.rebuildGrace } ?? false)
                                else { return }
                                Self.trace("keyboard settled: within, nothing drawn, still blank, rebuilt")
                                recoverEmpty(proxy, keepPlace: true)
                            }
                        }
                    } else {
                        Self.trace("keyboard settled: the newest not showing (short \(Int(short)) pt), back to it")
                        // As did-show (#7344): an anchor already reading "end" is scrolled to, not only set again.
                        if Self.idAnchor { proxy.scrollTo("end", anchor: .bottom); positionId = "end" } else { goNewest(proxy) }
                        // Review 7: an id scroll against an estimate can land past the end (build 29's follow); look once more.
                        DispatchQueue.main.asyncAfter(deadline: .now() + Self.keyboardSettle) {
                            settledPutBack(proxy, tick: tick, chatAt: chatAt, listAt: listAt, boxMoved: false, again: true)
                        }
                    }
                } else if onScreen.isEmpty { Self.trace("keyboard settled: within, nothing drawn, left (a scroll, or the no-rebuild control)") }
            } else if place != "within" { Self.trace("keyboard settled: \(place)") }
            else if !again { Self.trace("keyboard settled: within, drawn, left") }   // kosmos#7420: a capture tells "looked, fine" from "did not look"
            return
        }
        if scrollBox.underFinger { Self.trace("keyboard settled: past the end, under a finger"); return }
        let wrote = scrollBox.backInside()
        if wrote { Self.trace("keyboard settled: past the end, put back at its end") }
        goNewest(proxy)
        // As recoverEmpty: a direct offset write may have made SwiftUI name a row in the binding; put the end back after it.
        if wrote, Self.idAnchor { DispatchQueue.main.async { if positionId != "end", !personScrolling, !scrollBox.underFinger { positionId = "end" } } }
    }

    // kosmos#7420: an empty list put right as Board.emptyRecovery decides.
    // keepPlace (TestFlight 37 review 2): a reader higher up, rebuilt by a settled look; when no rebuild is left in the
    // budget it is not sent to the newest by id (that lands in the same undrawn stretch, build 34).
    private func recoverEmpty(_ proxy: ScrollViewProxy, later: Bool = false, keepPlace: Bool = false, forceRebuild: Bool = false) {
        let scrolling = personScrolling || scrollBox.underFinger
        var wrote = false
        let decided = Board.emptyRecovery(later: later, place: scrollBox.reading()?.place, scrolling: scrolling, atNewest: atBottom, canRebuild: !Self.sampleNoRebuild)
        // Review 3: a reader higher up (keepPlace) is acted on only by a rebuild; any other outcome would jump them by id.
        if keepPlace, decided != .rebuild { Self.trace("diag: empty, a reader higher up left (no rebuild)"); return }
        switch forceRebuild ? .rebuild : decided {
        case .none: return
        case .rebuild:
            let now = Date()
            if rebuilds.count >= Self.rebuildsMax || rebuilds.last.map({ now.timeIntervalSince($0) < Board.rebuildSpacing }) == true {
                Self.trace("diag: empty within the content, not rebuilt again (\(rebuilds.count) this chat open)")
                if !later && !keepPlace { goNewest(proxy) }
                return
            }
            rebuilds.append(now)
            openCount.rebuilt()
            diagThreadAt = now   // the new list has its own 2 s
            Self.trace("diag: empty within the content (at newest \(atBottom)), list rebuilt (\(rebuilds.count) this chat open)")
            // As a chat opens (measured 10-31, iOS 26.5 and 27): the new list starts with no anchor, so its first rows are
            // drawn, and the end is asked for once it exists (goNewest), since without that ask it stayed at its top (the
            // chat open's own goNewest did not move it). Created already anchored on "end", a long list on iOS 27 opened on
            // rows it had only estimated and stayed empty. Asked again after its first layout, unless the person has started
            // scrolling or another chat opened. Nothing of the new list is drawn yet: no row counted, the end not shown (so a
            // new list that also stays empty is checked again), and no earlier page asked for by its top (settledAtEnd).
            anchorLetGo = false; rowTops.reset(); endSeen = false; endVisible = false; topVisible = false; onScreen = []; settledAtEnd = false
            earlierLanding = false; topDuringHold = nil; earlierLandings += 1   // kosmos#8221 slice 16: the rebuilt list has not drawn a landing
            positionId = nil
            // TestFlight 37 review 1: the new list is sent to its newest, so the reader is at the newest from here; a rebuilt
            // list that stays blank is then checked and rebuilt again by the later look (within its budget).
            atBottom = true
            listEpoch &+= 1
            let listAt = listEpoch, chatAt = epoch
            rebuildHiding = !Self.sampleNoRebuildHide
            for at in [0.05, 0.4] {
                DispatchQueue.main.asyncAfter(deadline: .now() + at) {
                    guard listEpoch == listAt, epoch == chatAt, !personScrolling, !scrollBox.underFinger else { return }
                    goNewest(proxy)
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {   // queued after the last ask, so a slow layout cannot lift the hide ahead of it
                DispatchQueue.main.asyncAfter(deadline: .now() + Self.rebuildHideAfterLastAsk) {
                    guard listEpoch == listAt else { return }
                    if rebuildHiding { Self.trace("rebuild: the end had not shown, list shown anyway") }
                    rebuildHiding = false
                }
            }
            // A new list that draws no row never has a row leave, so nothing would check it: one check once the grace is over.
            DispatchQueue.main.asyncAfter(deadline: .now() + Board.rebuildGrace + Board.rebuildCheckBump) {
                if listEpoch == listAt, epoch == chatAt { diagTick &+= 1 }
            }
            return
        case .backInsideThenNewest:
            wrote = scrollBox.backInside()
            if wrote { Self.trace("diag: the scroll was outside its content, put back at its end") }
        case .newest: break
        }
        goNewest(proxy)
        // Only after a direct offset write: it may have made SwiftUI name a row in the binding, which goNewest's own put-back
        // (when it had one to make) leaves alone; this runs after it, in main-queue order, and helps only if SwiftUI wrote the
        // binding by then.
        if wrote, Self.idAnchor { DispatchQueue.main.async { if positionId != "end", !personScrolling, !scrollBox.underFinger { positionId = "end" } } }
    }

    // kosmos#7575: when this chat open had a sideways shift, one report to the person's board (numbers and kind words,
    // never text), then nothing more until the chat opens again. One try, nothing kept on the phone.
    private func sendShiftReport() { shifts.flush() }

    // What sends a box's report: only to the computer it was counted on (review 1), with a little background time asked
    // of iOS so a report sent as the app goes away can land (review 2); still one try. Held by the box, so a chat closed
    // under its info page still sends (review 2).
    private func shiftSender() -> (Board.ChatShiftReport, Date) -> Void {
        let client = self.client, epoch = client.chatEpoch
        return { report, openedAt in
            Task { @MainActor in
                guard report.shifts > 0, epoch == client.chatEpoch else { return }
                let info = Bundle.main.infoDictionary
                let app = "\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))"
                let body = report.body(app: app, ios: UIDevice.current.systemVersion, model: Board.deviceModel(),
                                       countSeconds: Date().timeIntervalSince(openedAt))
                ChatView.trace("shift report sent")
                var task = UIBackgroundTaskIdentifier.invalid
                task = UIApplication.shared.beginBackgroundTask(withName: "chat-shift") {   // review 3: ended if time runs out
                    if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
                }
                _ = await client.throughMac { Board.chatShiftRequest(mac: $0, body: body) }
                if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
            }
        }
    }

    // kosmos#7420: as the shift report: one try, with a little background time, only to the computer it was counted on.
    private func sendOpenCount() {
        let info = Bundle.main.infoDictionary
        let app = "\(info?["CFBundleShortVersionString"] as? String ?? "?") (\(info?["CFBundleVersion"] as? String ?? "?"))"
        // The epoch this chat holds, not the client's now: a change not yet seen here means this count is another computer's.
        guard epoch == client.chatEpoch else { openCount.reset(); return }
        // A search with no matches, and unsent messages filling the screen, draw no rows either.
        let excused = searchMode || (endSeen && endVisible && !pending.isEmpty)
        guard let body = openCount.finish(hasRows: !(thread?.rows.isEmpty ?? true), excused: excused, app: app) else { return }
        // kosmos#8221 slice 6: a UIKit-list showing goes to its own path and the board counts it apart from the lazy list's.
        // Its rows report through row() inside reused hosted cells; measured faithful 11-08 (plan uikitlist-s6-8221, step 1).
        let client = self.client, sentAt = epoch, uikit = uikitList
        Task { @MainActor in
            guard sentAt == client.chatEpoch else { return }
            var task = UIBackgroundTaskIdentifier.invalid
            task = UIApplication.shared.beginBackgroundTask(withName: "chat-open") {
                if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
            }
            _ = await client.throughMac { Board.chatOpenRequest(mac: $0, body: body, uikit: uikit) }
            if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
        }
    }

    private var diagWords: String { diagRebuilt ? "This conversation went blank and was rebuilt." : "This conversation did not draw properly." }
    private func announceDiag() { UIAccessibility.post(notification: .announcement, argument: diagWords + " A Share button above the messages sends the details, if you choose.") }

    // The line that offers it: what happened in plain words, and Share. Stacked at the largest text sizes (review 1).
    private func diagLine(_ report: String) -> some View {
        let close = Button { diagReport = nil } label: {
            Image(systemName: "xmark").font(.footnote).frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain).foregroundColor(Palette.secondary).accessibilityLabel("Dismiss")
        let share = ShareLink(item: report, subject: Text("Kosmos chat diagnostic")) { Text("Share what happened").font(.footnote.weight(.semibold)) }
        let words = Text(diagWords).font(.footnote).foregroundColor(Palette.primary)
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
    static func trace(_ line: @autoclosure () -> String, ring: Bool = true) {
        let said = line()
        if ring {   // kosmos#7420: the Debug height lines (twice a second) stay out of the 80-line ring the report reads
            diagRing.append(String(format: "%.2f ", Date().timeIntervalSince(diagStart)) + said)
            if diagRing.count > 80 { diagRing.removeFirst(diagRing.count - 80) }
        }
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

    // kosmos#7354: this agent's unread replies as the last read of the list has them. While the chat is open and any are
    // unread, the board's own read cursor is moved (server.js dmSeen), so the count on its avatar clears everywhere; only
    // then, as the board sends it only when dmUnread is above 0.
    private var unreadHere: Int { client.agents.first { $0.session == agent.session }?.dmUnread ?? 0 }
    private func markDmSeen() {
        // kosmos#8024: a needs-you to acknowledge counts too; a question usually comes with no unread reply.
        let ackDue = client.agents.first { $0.session == agent.session }?.openAckDue ?? false
        guard visible, unreadHere > 0 || ackDue, !seenInFlight else { return }
        seenInFlight = true
        let session = agent.session
        Task {
            _ = await client.throughMac { Board.dmSeenRequest(mac: $0, session: session) }
            seenInFlight = false
        }
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

    // kosmos#7864: the picture's load runs again when its picture is gone (dropped for room, or on a memory warning, while
    // the card is on screen).
    private func previewTaskKey(_ row: Board.ChatRow) -> String? { client.previewTaskKey(row.preview) }

    @ViewBuilder private func itemView(_ item: Board.ChatItem) -> some View {
        switch item.kind {
        case .day(let label):
            dayHeader(label)
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
                                actions: row.answerable(by: agent.session) ? replyActionList(row) : [],
                                sheet: MessageActionTarget(mine: Set(row.reactions.filter(\.mine).map(\.emoji)),
                                                           react: row.answerable(by: agent.session) ? { e in reactTo(e, row) } : nil,
                                                           reply: row.answerable(by: agent.session) ? { startReply(row) } : nil,
                                                           text: Board.wordsShown(row.text, files: row.attachments),
                                                           delete: Board.canDelete(row) ? { deleteMine(row) } : nil))
                        // kosmos#7083: Reply and the reactions on an agent's message with files too, from its bubble; kosmos#7419:
                        // through the long-press sheet, with Copy text for any message.
                        .messageActions(mine: Set(row.reactions.filter(\.mine).map(\.emoji)),
                                        react: row.answerable(by: agent.session) ? { e in reactTo(e, row) } : nil,
                                        reply: row.answerable(by: agent.session) ? { startReply(row) } : nil, text: Board.wordsShown(row.text, files: row.attachments),   // review 1: the words shown, none for files alone
                                        delete: Board.canDelete(row) ? { deleteMine(row) } : nil)
                    if !row.reactions.isEmpty {
                        ReactionPills(pills: row.reactions, toggle: row.answerable(by: agent.session) ? { e in reactTo(e, row) } : nil, trailing: mine)
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
                                   reply: row.answerable(by: agent.session) ? { startReply(row) } : nil,
                                   delete: Board.canDelete(row) ? { deleteMine(row) } : nil,
                                   previewImage: row.preview?.image.flatMap { client.previewImages[$0] })
                            .task(id: previewTaskKey(row)) { if let p = row.preview { await client.loadPreviewImage(p) } }
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
                           reply: row.answerable(by: agent.session) ? { startReply(row) } : nil,
                           delete: Board.canDelete(row) ? { deleteMine(row) } : nil,
                           previewImage: row.preview?.image.flatMap { client.previewImages[$0] })
                    .padding(.top, first ? 10 : 2)
                    .task(id: previewTaskKey(row)) { if let p = row.preview { await client.loadPreviewImage(p) } }
            }
        }
    }

    // MARK: - Earlier messages (kosmos#7016 part 3)

    private var earlierLoadingLine: some View {
        Group {
            if earlier.loading {
                HStack(spacing: 6) {
                    SweepDots(size: 16, framesPerSecond: 15, stillWhenReduced: true)   // kosmos#8058: an overlay on the thread's scroll view, so the orb's rate and stillness
                    Text("Loading earlier messages\u{2026}").font(.footnote).foregroundColor(Palette.secondary)
                }
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(Capsule().fill(Palette.chatGround.opacity(0.92)))
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
                Button("Try again") { restartEarlier(Board.retryEarlier(earlier)); loadEarlier("retry") }
                    .font(.footnote.weight(.semibold)).foregroundColor(Palette.primary)
                    .frame(minHeight: 44)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 10)
        }
    }

    // kosmos#8221 slice 16: `caller` names who asked (settled, top, retry, read, landed) in the sample trace, a fixed word at every call
    // site (a StaticString, so nothing built at run time can be passed).
    // One page before what is loaded, when the person is at the top of it (or the chat is too short to scroll), never
    // while one loads, never after a failure until Try again. Called when the top appears, after every read, and on
    // Try again (the board's earlierNearTop: on scroll, after a paint, and from its button).
    private func loadEarlier(_ caller: StaticString) {
        // A search shortens the thread; its top showing is not a reader at the top (the board's earlierNearTop).
        // kosmos#7810: not from the kept copy or the small first page: their positions are not the window the next read
        // brings, so a page loaded from them could overlap it.
        // kosmos#8221 slice 16: not while a landing page's rows wait for the list to say where the top is.
        guard !earlierLanding else { return }
        guard fullRead, !searchMode, let t = thread, Board.shouldAsk(settled: settledAtEnd, topVisible: topVisible, earlier: earlier, olderCount: t.olderCount)
        else { return }
        let start = Board.startLoad(earlier, olderCount: t.olderCount)
        earlier = start
        #if DEBUG
        sampleDeleteOnAsk()
        #endif
        let askedEpoch = epoch
        Self.trace("earlier ask from \(caller): before \(start.before) opening \(start.opening) epoch \(askedEpoch)/\(client.chatEpoch)", ring: false)
        Task {
            // kosmos#8221 slice 15: each way out named, to find which one leaves the line loading for good.
            guard let read = await client.olderPage(agent.session, before: start.before) else {
                Self.trace("earlier out: nil read, opening \(start.opening) now \(earlier.opening) loading \(earlier.loading)", ring: false); return
            }
            guard askedEpoch == client.chatEpoch else {
                Self.trace("earlier out: epoch \(askedEpoch)/\(client.chatEpoch) loading \(earlier.loading)", ring: false); return
            }
            guard let next = Board.finishLoad(earlier, with: read, opening: start.opening) else {
                Self.trace("earlier out: finishLoad nil, asked \(start.opening) now \(earlier.opening) loading \(earlier.loading) open \(earlier.open)", ring: false); return
            }
            Self.trace("earlier answered \(Board.olderKind(read)): opening \(start.opening) rows \(next.rows.count) before \(next.before)", ring: false)
            // The row kept in place is the topmost one on screen as the page lands, wherever the person has scrolled
            // meanwhile (the board's setThread anchor), so a page landing never pulls them somewhere else.
            let shownNow = thread.map { Board.chatItems(Board.shownRows(earlier, thread: $0), now: Date(), calendar: .current) } ?? []
            let anchor = Board.anchorItem(shownNow, onScreen: onScreen)
            restartEarlier(next)
            // kosmos#7265 review: the newest rows are one eager stack and are all "on screen" while any of it shows, so
            // a reader back at the newest message is kept there rather than at the stack's first row (a stated limit:
            // a reader stopped part way inside the newest rows as a page lands may still move).
            // Review 2: atBottom starts true and clears only after the end marker has shown, so the top showing (the
            // reader is up there) rules it out.
            if atBottom && endSeen && !topVisible && !searching { quietFollowKey = nil; keepAtEndTick += 1 }   // review: not while searching
            // kosmos#8221 slice 7: the UIKit list keeps the reader's place itself (ChatList's hold, slice 3); keepAnchor
            // scrolls the lazy list's proxy, which is not there.
            else if !uikitList, case .page(let rows, _, _) = read, !rows.isEmpty { keepAnchor = anchor }
            // kosmos#8221 slice 16: the rows landed above the reader, who is held where they were. The list says whether the
            // top still shows only on the next turn of the main loop, and a read resuming before that asked for the next page
            // with no swipe (measured: "earlier ask from read" in the same instant as a page landed). So no page is asked for
            // until the list has said where the top is (topRead). Backstop: rows the list never draws
            // (all hidden) bring no report, so the hold lets go after 1 s.
            if uikitList, !Self.sampleNoTopFix, case .page(let rows, _, _) = read, !rows.isEmpty {
                earlierLanding = true
                earlierLandings += 1
                Self.trace("earlier hold on", ring: false)
                let mine = earlierLandings
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    guard earlierLandings == mine, earlierLanding else { return }
                    Self.trace("earlier hold off: backstop", ring: false)
                    earlierLanding = false
                    // Review 4: a top change that came during the hold, acted on now.
                    // Review 6: asks only on a top change read during the hold. topVisible itself may still be from before
                    // the landing, when the reader was at the top and has since been carried down by the new rows.
                    if let top = topDuringHold { topDuringHold = nil; topVisible = top; if top { loadEarlier("landed") } }
                }
            }
            #if DEBUG
            // KOSMOS_SAMPLE_READ_ON_LAND=1: a read's request at the moment a page lands, the race the hold above closes.
            if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_READ_ON_LAND"] == "1" { loadEarlier("read") }
            #endif
        }
    }

    #if DEBUG
    // kosmos#8221 slice 16: KOSMOS_SAMPLE_DELETE_ON_ASK=<k> deletes the person's newest message through deleteMine (the
    // sheet's Delete) 2 s before the k-th page asked for in this launch is due (KOSMOS_SAMPLE_OLDER_DELAY), so a delete
    // drops the loaded earlier pages while a reader is up in them, as slice 14's moved answer does.
    private func sampleDeleteOnAsk() {
        let env = ProcessInfo.processInfo.environment
        guard let k = env["KOSMOS_SAMPLE_DELETE_ON_ASK"].flatMap(Int.init) else { return }
        Self.sampleEarlierAsks += 1
        guard k == Self.sampleEarlierAsks else { return }
        let due = max(0, (env["KOSMOS_SAMPLE_OLDER_DELAY"].flatMap(Double.init) ?? 0) - 2)
        DispatchQueue.main.asyncAfter(deadline: .now() + due) {
            guard let row = thread?.rows.last(where: Board.canDelete) else { return }
            Self.trace("debug delete on ask", ring: false)
            deleteMine(row)
        }
    }
    #endif

    // kosmos#8221 slice 14: the earlier state replaced, counting a replacement that drops loaded rows (earlierDropped).
    private func restartEarlier(_ next: Board.Earlier) {
        if !earlier.rows.isEmpty && next.rows.isEmpty { earlierDropped += 1 }
        Self.trace("earlier restart: opening \(earlier.opening)->\(next.opening) loading \(earlier.loading)->\(next.loading) rows \(earlier.rows.count)->\(next.rows.count)", ring: false)
        earlier = next
    }

    // earlierFillGap: messages that left the latest 200 while the chat was open are fetched into the loaded pages, so
    // nothing falls between them and the latest read. Dropped if a reset came while it ran.
    private func fillGap(_ t: Board.Thread) {
        guard fullRead, earlier.open, !earlier.filling, !earlier.loading, Board.hasGap(end: earlier.end, olderCount: t.olderCount) else { return }
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
                    if read == .moved { restartEarlier(Board.resetEarlier(earlier)) } else { earlier.filling = false }
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
                           widthShare: widthShare, press: { press($0, choices, decided: $0.n == card.allow.n || $0.n == card.deny.n) })
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

    // kosmos#8246: `decided` is an Allow or Deny on a request's card; it taps once the answer goes, not on the arming press.
    private func press(_ option: Board.ChoiceOption, _ choices: Board.Choices, decided: Bool = false) {
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
            case .sent: pressLine = nil; if decided { Haptics.decided() }   // kosmos#8246: once it went, not on the press
            case .notSure(let text): pressLine = text; unsureKey = choices.key
            case .refused(let text): pressLine = text; Haptics.failed()   // kosmos#8246
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
                Haptics.failed()   // kosmos#8246: a row's Try again refused is a message that did not send
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
        // kosmos#7810: the shown window no longer matches the Mac's body, so the next read asks for it whole.
        threadTag = nil
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
        // Above the fade (kosmos#7346); on the UIKit list, above the working line at a large text size too (kosmos#8283).
        .padding(.bottom, uikitList ? endRoom : 8 + ChatView.fadeHeight)
    }

    // MARK: - Sending

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            // kosmos#7346: the strips above the box are the page's solid ground, edge to edge (nothing shows through).
            if let replying { replyStrip(replying).background(Palette.chatGround.padding(.horizontal, -12)) }
            if !attachedHere.isEmpty || uploadingHere > 0 { chips.background(Palette.chatGround.padding(.horizontal, -12)) }
            // kosmos#7346: one floating box, + then the text then emoji and mic; no send arrow (the keyboard's Send sends).
            // Radius 24, at least 48 pt, the card colour with a soft shadow and a hairline edge (Mona Lisa's spec).
            HStack(alignment: .bottom, spacing: 0) {
                addButton
                field
            }
            .frame(minHeight: 48)
            .background(RoundedRectangle(cornerRadius: 24).fill(Palette.card)
                // kosmos#7628 (Josh 10-30, build 21): on the white chat ground the old soft shadow (radius 10) read as a grey
                // band behind the box; a tight one keeps the white box's edge without the band.
                .shadow(color: Color.black.opacity(0.08), radius: 3, x: 0, y: 1))
            .overlay(RoundedRectangle(cornerRadius: 24).stroke(Palette.separator, lineWidth: 0.5))
            if let line = ComposerExtras.micLine(dictation.state) {
                Text(line).font(.footnote).foregroundColor(Palette.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
                    .background(Palette.chatGround.padding(.horizontal, -12))
            }
            // kosmos#7268: the emoji panel in the keyboard's place while open; typing in the box closes it. The tab bar is
            // already hidden in a conversation, so nothing sits under the panel.
            if emojiOpen { EmojiPanel { emojiInsert = ComposerExtras.Pick(glyph: $0) }.padding(.horizontal, -12).background(Palette.chatGround) }
        }
        .padding(.horizontal, 12)
        // 8 pt above the keyboard, or above the home bar when it is down.
        .padding(.top, 6)
        .padding(.bottom, 8)
        .onChange(of: composerFocused) { focused in if focused { emojiOpen = false } }
        // kosmos#8045: the keyboard rises over the tray.
        .modifier(PhotoTrayFollowsKeyboard(open: $trayOpen, focused: composerFocused))
        // Review 8: the search field's keyboard closes the panel too, or it sits on top of it and hides the results.
        .onChange(of: searchFocused) { focused in if focused { emojiOpen = false } }
        .onChange(of: searchFocused) { focused in if focused { trayOpen = false } }
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
        .onDisappear { trayOpen = false }
        .onChange(of: draftText) { [was = draftText] now in
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
        // kosmos#7596: a photo taken with the camera goes up as a picked one does, named the same way.
        .background(Color.clear.fullScreenCover(isPresented: $showCamera) {
            CameraCapture { image in
                showCamera = false
                guard let image else { return }
                let epoch = cameraEpoch
                Task { await addTaken(image, epoch: epoch) }
            }
            .ignoresSafeArea()
        })
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

    // kosmos#8045: the + opens recent photos at once (AttachMenu.swift).
    private var addButton: some View {
        AttachPlusButton(open: trayOpen && !composerFocused, label: "Add a photo or file",
                         hint: atFileLimit ? Board.uploadRefusal(size: nil, waiting: Board.maxFiles) ?? "" : "") {
            if trayOpen && !composerFocused { closeTray() } else { openTray() }
        }
        .padding(.leading, 4)
        .padding(.bottom, 2)
        // kosmos#7944: a waiting picture, tapped. Presented from the + (always there), not from the chips, which go
        // when the last file does (review 3): the sheet and its closing rule must outlive the row.
        .sheet(item: $previewing) { open in
            // The picture as it was when tapped (review 5): Remove takes the file off at once, and the sheet keeps
            // showing it while it slides away rather than going blank.
            AttachedPreview(name: open.name, preview: open.picture.large, remove: {
                client.unattach(open.id, for: agent.session)
                RoomView.say("Removed \(open.name)")
            })
        }
        // It closes if its file leaves the composer while it is open (sent, or another account or computer).
        .onChange(of: previewing.map { client.attachedPreviews[$0.id] != nil } ?? true) { still in
            if !still { previewing = nil }
        }
    }

    // kosmos#8045: with the keyboard up, the tray goes in behind it as it drops, on one update, so the box does not move.
    private func openTray() {
        let overKeyboard = composerFocused || searchFocused
        trayFromKeyboard = composerFocused   // not search's: the X goes back to the box's own keyboard only
        trayHeight = PhotoTrayMotion.height
        PhotoTrayMotion.change(overKeyboard: overKeyboard) { emojiOpen = false; trayOpen = true; composerFocused = false; searchFocused = false }
    }

    // Back to the keyboard if that is where it came from (composerFocused's onChange closes the tray), otherwise down.
    private func closeTray() {
        if trayFromKeyboard { composerFocused = true } else { PhotoTrayMotion.change(overKeyboard: false) { trayOpen = false } }
    }

    @ViewBuilder private var photoTray: some View {
        if trayOpen {
            PhotoTray(model: trayModel, height: trayHeight, atLimit: atFileLimit,
                      limitHint: Board.uploadRefusal(size: nil, waiting: Board.maxFiles) ?? "",
                      attached: { client.attached[agent.session] ?? [] },
                      generation: client.addGeneration[agent.session, default: 0],
                      add: { await addFromTray($0, number: $1) },
                      remove: { client.unattach($0, for: agent.session) },
                      onCameraTapped: { cameraEpoch = client.chatEpoch },
                      onCameraDenied: { if cameraEpoch == client.chatEpoch { client.attachLine[agent.session] = Board.cameraDeniedLine } }) { choice in
                switch choice {
                // Review 11: not after an account or computer switch during iOS's camera prompt (the photo could not be sent).
                case .camera: if cameraEpoch == client.chatEpoch { showCamera = true }
                case .photos: showPhotos = true
                case .files: showFiles = true
                }
            }
            .transition(.move(edge: .bottom))
        }
    }

    // A tile's photo: its data is read here, on its turn, and goes up as a picked one does.
    private func addFromTray(_ photo: TrayPhoto, number: Int) async -> String? {
        let epoch = client.chatEpoch
        let at = Date()
        client.attachLine[agent.session] = nil
        return await client.attach(.photo(load: {
            guard let data = await photo.data() else { return nil }
            return (Board.photoName(at: at, ext: Board.imageExtension(data) ?? "jpg", number: number), data)
        }), epoch: epoch, to: agent)
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            // Bottom-aligned (kosmos#7944 review 4): a picture's square is taller than a name chip, by the room its x needs.
            HStack(alignment: .bottom, spacing: 6) {
                // First, so it is on screen however many files are already waiting.
                if uploadingHere > 0 {
                    HStack(spacing: 6) {
                        HStack(spacing: 6) {
                            SweepDots(size: 16)   // kosmos#8058: a small wait has the simple dots; unlabelled, as the text beside it says what is loading
                            Text(uploadingHere == 1 ? "Adding a file\u{2026}" : "Adding \(uploadingHere) files\u{2026}")
                                .font(.footnote).foregroundColor(Palette.secondary)
                        }
                        .accessibilityElement(children: .combine)
                        // kosmos#7682: a way out of an add that hangs (a photo that never loads, an upload that
                        // stalls). The same x and 44 pt place to tap as a waiting file's chip.
                        Button {
                            client.cancelAdding(for: agent.session)
                            if composerNote == Board.stillAddingLine { composerNote = nil }
                            // Review 1: the line goes from under VoiceOver's focus; say what happened.
                            RoomView.say("Stopped adding")
                        } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundColor(Palette.secondary)
                                .frame(width: 44, height: 44).contentShape(Rectangle()).padding(-12)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(uploadingHere == 1 ? "Stop adding the file" : "Stop adding the files")
                        .accessibilityIdentifier("stopAdding")
                    }
                    .padding(.horizontal, 6)
                }
                ForEach(attachedHere) { a in
                    FileChip(name: a.name, preview: client.attachedPreviews[a.id]?.small, open: { previewing = OpenPicture(a, client.attachedPreviews[a.id]) },
                             remove: { client.unattach(a.id, for: agent.session) })
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
        // kosmos#7682: the client's loop, so the x stops the rest of the pick, not only the one going up.
        await client.attachAll(picks.enumerated().map { i, item in
            .photo(load: {
                guard let data = try? await item.loadTransferable(type: Data.self) else { return nil }
                let type = item.supportedContentTypes.first { $0.conforms(to: .image) } ?? .jpeg
                return (Board.photoName(at: at, ext: Board.imageExtension(data) ?? type.preferredFilenameExtension ?? "jpg", number: i + 1), data)
            })
        }, epoch: epoch, to: agent)
    }

    // Encoded inside the load, off the main thread, as a picked photo is read.
    private func addTaken(_ image: UIImage, epoch: Int) async {
        guard epoch == client.chatEpoch else { return }   // review 7: never clears another account's line
        client.attachLine[agent.session] = nil
        await client.attach(.photo(load: {
            guard let data = await Task.detached(operation: { image.jpegData(compressionQuality: 0.85) }).value else { return nil }
            return (Board.photoName(at: Date(), ext: "jpg", number: 1), data)
        }), epoch: epoch, to: agent)
    }

    private func addFiles(_ urls: [URL]) async {
        let epoch = client.chatEpoch
        client.attachLine[agent.session] = nil
        await client.attachAll(urls.map { .file($0) }, epoch: epoch, to: agent)   // kosmos#7682: stops on the x
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
                // kosmos#7687: the return key puts in a new line; the send button sends. VoiceOver keeps Send on the box too.
                .accessibilityAction(named: "Send") { sendOrSayWhy() }
                .padding(.vertical, 13)
                .padding(.leading, 2)
            ComposerEmojiButton(open: emojiOpen) {
                if emojiOpen { emojiOpen = false; composerFocused = true } else { trayOpen = false; emojiOpen = true; composerFocused = false }
            }
            // kosmos#7687: the send button in the microphone's place once there is something to send (not while dictating).
            if ComposerExtras.showsSend(text: draftText, files: attachedHere.count, dictating: dictation.busy) {
                ComposerSendButton(label: "Send", dictationEnded: dictation.endedAt) { sendOrSayWhy() }
                    .padding(.trailing, 4)
            } else {
                ComposerMicButton(dictation: dictation) {
                    dictation.toggle(base: draftText, current: { draftText }) { draftText = $0 }
                }
                .padding(.trailing, 4)
            }
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
        Haptics.sent()   // kosmos#8246: taps once past this view's guards; a press in the air or nothing to send taps nothing
        if trayOpen { PhotoTrayMotion.change(overKeyboard: false) { trayOpen = false } }   // kosmos#8045: sent, back to reading
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
                Haptics.failed()   // kosmos#8246: the client's own guard kept it back (it never went)
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

    // React and Reply for one of the agent's messages, as VoiceOver actions on a files bubble (the long press opens the sheet).
    // The same choices as a list, for VoiceOver actions on each file card.
    private func replyActionList(_ row: Board.ChatRow) -> [(name: String, run: () -> Void)] {
        var out: [(name: String, run: () -> Void)] = []
        for e in Board.quickReactions where !row.reactions.contains(where: { $0.emoji == e && $0.mine }) { out.append(("React with " + e, { reactTo(e, row) })) }
        for r in row.reactions where r.mine { out.append(("Remove your " + r.emoji, { reactTo(r.emoji, row) })) }
        out.append(("Reply", { startReply(row) }))
        return out
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

    // kosmos#7614: the person's own message deleted for everyone (asked first, in the sheet). The row goes at once; a
    // refusal, or the note that an agent had already read it, is said on the composer line, as a reaction's refusal is.
    private func deleteMine(_ row: Board.ChatRow) {
        guard Board.canDelete(row), let at = row.atRaw else { return }
        let startedIn = client.chatEpoch
        Task {
            let result = await client.deleteMessage(at: at, to: agent)
            guard startedIn == client.chatEpoch else { return }
            switch result {
            case .deleted, .gone:
                // Mona Lisa's routes: `gone` (already deleted elsewhere) takes the row out the same way, and says so.
                var told: [String] = []
                if case .deleted(let t) = result { told = t }
                // Review 3: a read already in the air still holds the message; it is dropped, as an older read is.
                readShown = readsStarted
                if let t = thread { thread = Board.withoutMessage(t, at: at) }
                // Review 1: with earlier messages open, the newest window shifts by one after a delete, so a row the
                // earlier pages already hold would come back as a second copy. Start them again, as on a moved chat.
                // Review 2: whenever they are open, also while their first page is still on its way. A reader scrolled up
                // there jumps, as on a moved chat; the trade is taken over a row drawn twice.
                if earlier.open || !earlier.rows.isEmpty { restartEarlier(Board.resetEarlier(earlier)) }
                // Review 1: only when there is something to say, so a standing line (Try again, a wait) is kept; review 2:
                // but an earlier delete's own refusal still showing is taken away.
                if let note = result == .gone ? Board.deleteGoneNote : Board.deletedNote(told: told, names: [agent.session: shown.name]) {
                    composerNote = note; deleteNote = note
                } else {
                    // Review 4: the earlier delete's line goes if it still shows; either way it is no longer this delete's.
                    if let was = deleteNote, composerNote == was { composerNote = nil }
                    deleteNote = nil
                }
            case .refused(let why):
                composerNote = why
                deleteNote = why
            }
        }
    }

    // MARK: - Reading

    private func startReading() {
        loop?.cancel()
        // kosmos#7810: the conversation this phone last read is drawn at once, offline too; the first read replaces it.
        if thread == nil, let kept = client.keptThread(for: agent.session) {
            thread = kept; recomputeHiddenHeads()
            Self.trace("kept copy drawn")
        }
        loop = Task {
            while !Task.isCancelled {
                let landedSmall = await read()
                // The small first page drawn: the whole window is read straight after it, not 5 s later.
                if landedSmall { continue }
                try? await Task.sleep(nanoseconds: 5_000_000_000)   // the web chat's own cadence
            }
        }
    }

    // kosmos#7810: true when this read was the small first page and it landed (the caller reads the whole window next).
    @discardableResult
    private func read() async -> Bool {
        readsStarted += 1
        let mine = readsStarted
        let startedIn = client.chatEpoch
        // The first read of an open with nothing to show asks for a screenful; later reads ask for the whole window,
        // naming what is shown (its ETag) once a whole window is shown, so an unchanged one costs no body.
        let ask = Board.threadAsk(fullRead: fullRead, showing: thread != nil, tag: threadTag)
        let small = ask.tail != nil
        let (result, tag) = await client.threadRead(for: agent.session, tail: ask.tail, tag: ask.tag)
        // A read cut short (the chat closed, the app went away) says nothing about the Mac, and an older read than the
        // one shown changes nothing.
        guard !Task.isCancelled, mine > readShown, startedIn == client.chatEpoch else { return false }
        // kosmos#7810: a small page asked before a whole window landed is older news than that window: not drawn over it.
        if small, fullRead, case .thread = result { return false }
        readShown = mine
        switch result {
        case .unchanged:
            // Only a read that named the shown window's tag can be answered so: the body is the one already read and
            // settled, so nothing below is run again; the Mac is answering. The retries every read makes still run: a gap
            // fill or an earlier page that failed or waited is asked again here, as after a whole read.
            if let t = thread { fillGap(t) }
            loadEarlier("read")
            lastRead = Date()
            failedReads = 0
            refusal = nil
            return false
        case .thread(let fresh):
            let wasFull = fullRead
            if !small { fullRead = true; threadTag = tag }
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
                // kosmos#7810: only from a whole window read in this open (a kept copy or a small page is not one).
                if !Self.sampleNoKeep, wasFull { earlier = Board.carryDropped(earlier, previous: thread, fresh: fresh) }   // NOKEEP: the control
                // kosmos#7420 review 5: read before the new rows land, as pinned is.
                let quiet = Self.idAnchor && Board.readLeavesDrawnEndAlone(before: thread, after: fresh, pinned: pinned, endVisible: endVisible, endSeen: endSeen,
                                                                            anchorAtEnd: positionId == "end", drawn: !onScreen.isEmpty, settled: settledAtEnd)
                quietFollowKey = quiet ? Board.followKey(fresh) : nil
                thread = fresh; recomputeHiddenHeads()
                if pinned { keepAtEndTick += 1 }
                Self.trace("read \(mine): rows \(fresh.rows.count) older \(fresh.olderCount) pinned \(pinned) atBottom \(atBottom) endSeen \(endSeen) settled \(settledAtEnd) earlierOpen \(earlier.open) earlierRows \(earlier.rows.count) loading \(earlier.loading) filling \(earlier.filling)")
            }
            fillGap(fresh)
            // A moved reset leaves the top in view with nothing loading: the next read asks again.
            loadEarlier("read")
            // A line about a question that is no longer the one up would read as a warning about the next one.
            if pressLine != nil, fresh.choices?.key != pressLineKey { pressLine = nil }
            #if DEBUG
            applySampleChoice(fresh)
            #endif
            client.settle(fresh, for: agent.session)
            lastRead = Date()
            failedReads = 0
            refusal = nil
            return small
        case .refused(let why):
            // The Mac answered, with a reason: said as it is, never as "not answering".
            // kosmos#7810: a kept copy or small page is not left over the reason (the chat draws the reason only with no
            // thread). A whole window read in this open stays, as before.
            if !fullRead { thread = nil }
            refusal = why
            dropChoices()
            failedReads = 0
        case .noAnswer:
            failedReads += 1
            dropChoices()
        }
        return false
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
    var trailing = false   // review 1: under the person's own bubble, each wrapped line flush right
    var body: some View {
        // kosmos#7420: wrapped onto more lines, never one row: a row of many reactions wider than the screen made the whole
        // thread as wide (a lazy stack takes its widest row), which pushed every bubble off its margin.
        // Mona Lisa 10-29: tappable pills' 44 pt tap areas touch line to line (0), so the visible gap is the tap area's
        // own margin, never that plus 6; plain pills (nothing to tap) keep 6.
        FlowLayout(spacing: 6, trailing: trailing, rowSpacing: toggle == nil ? 6 : 0) {
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
                            // Review 1: at the largest text sizes a pill is taller than 44 pt and the lines would touch
                            // with no gap; 3 pt either side keeps one. Under 44 pt the frame decides, so nothing changes.
                            .padding(.vertical, 3)
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
    #if DEBUG
    static let sampleWalking = Notification.Name("kosmos.sampleWalking")   // kosmos#7420, KOSMOS_SAMPLE_WALK=1
    #endif
}

// One message as a bubble: the person's on the right, the agent's on the left, in the board's colours; the time (and a
// tail) on the last bubble of a run. A message the Mac could not deliver gets the board's failed line (kosmos#7136).
/* kosmos#7864: a link's preview under its message, laid out as the board's pjPreviewCard (#357; #761, Josh: the words
   first, then a much larger picture under them at the card's own width): the site, the title, the page's words, then its
   picture. The picture came through the Mac; tapping the card opens the address, as the link in the message does. */
struct LinkPreviewCard: View {
    let preview: Board.LinkPreview
    let image: CGImage?
    let width: CGFloat
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button { openURL(preview.url) } label: {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 3) {
                    // The page's own site name, and the address's real host beside it when they differ: the page names
                    // itself, but where the card goes is the address (it can differ after a redirect).
                    Text(Board.linkPreviewSiteLine(preview)).font(.caption).foregroundColor(Palette.secondary).lineLimit(1)
                    Text(preview.title).font(.subheadline.weight(.semibold)).foregroundColor(Palette.primary).lineLimit(2)
                    if let words = preview.description {
                        Text(words).font(.footnote).foregroundColor(Palette.secondary).lineLimit(3)
                    }
                }
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 10)
                if let image {
                    Image(decorative: image, scale: 1).resizable().scaledToFill()
                        .frame(width: width, height: min(width * 0.52, 220))
                        .clipped()
                        .accessibilityHidden(true)
                }
            }
            .frame(width: width, alignment: .leading)
            .background(Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.separator, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

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
    var delete: (() -> Void)? = nil   // kosmos#7614: the person's own sent message only
    // kosmos#7864: the picture of the row's link preview, once the client has it through the Mac.
    var previewImage: CGImage? = nil
    @Environment(\.openURL) private var openURL

    private var mine: Bool { row.who == .person }

    var body: some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            if let head, !headHidden { ReplyHeadLine(head: head) }
            BubbleText(text: row.text, mine: mine, tail: lastOfRun, widthShare: widthShare)
                // One long-press per bubble, set here (on the shared bubble it would hide the pending one's Delete).
                // kosmos#7419: the sheet (quick reactions, More, Reply, Copy text) in place of the menu.
                .messageActions(mine: Set(row.reactions.filter(\.mine).map(\.emoji)), react: react, reply: reply, text: row.text, delete: delete)
            if let preview = row.preview {
                LinkPreviewCard(preview: preview, image: previewImage, width: UIScreen.main.bounds.width * widthShare)
                    .padding(.top, 2)   // clear of the bubble's tail
            }
            if !row.reactions.isEmpty { ReactionPills(pills: row.reactions, toggle: react, trailing: mine) }
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
        // kosmos#7419 review 3: Message actions on the one element VoiceOver reads (the inner one is dropped by .ignore).
        .messageActionsAccessibility(mine: Set(row.reactions.filter(\.mine).map(\.emoji)), react: react, reply: reply, text: row.text,
                                     delete: delete)   // kosmos#7614 review 1: VoiceOver's sheet has Delete too
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
        if let p = row.preview { said += ". " + Board.linkPreviewSpoken(p) }
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
        // kosmos#7864: the preview card is inside this one element, so its address is an action here too, named from the
        // card, unless one of the message's own links already opens that site.
        let hostKey = { (u: URL) in (u.host ?? "").lowercased().replacingOccurrences(of: #"^www\."#, with: "", options: .regularExpression) }
        let card = row.preview.flatMap { p in links.contains { hostKey($0) == hostKey(p.url) } ? nil : p }
        return Group {
            ForEach(Array(links.enumerated()), id: \.offset) { i, url in
                let number = links.count > 1 ? "\(i + 1) " : ""
                Button("Open link \(number)to \(url.host ?? url.absoluteString)") { openURL(url) }
            }
            // Named from the address it opens, never from the page's own site name, which a page can make up.
            if let card { Button("Open link to \(Board.linkHost(card.url))") { openURL(card.url) } }
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
    // kosmos#7348: as a kept row, only the last of a run of the person's messages carries the tail and the time line.
    var lastOfRun = true

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
                BubbleText(text: words, mine: true, tail: item.files.isEmpty && lastOfRun, widthShare: widthShare, faded: !item.shownAsSent)
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
            } else if !lastOfRun {
                EmptyView()   // kosmos#7348: within a run, no time line, as the kept row will have none
            } else if item.shownAsSent {
                Text(item.at, style: .time).font(.caption2).foregroundColor(Palette.tertiary).padding(.horizontal, 4)
            } else {
                // kosmos#7348 (Josh 10-27: after a send the conversation crept down in steps): while it is still sending,
                // the time line's room is kept, drawn hidden, so the bubble is the same height before and after the post
                // answers. Without it the list, held at its bottom, moved up a line (17 pt) when the time appeared.
                Text(item.at, style: .time).font(.caption2).padding(.horizontal, 4).hidden()
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenLabel)
        .accessibilityIdentifier("pending-send")
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
            .overlay(PressedBubbleMark())   // kosmos#7419 build 11: the bubble itself, before its width frame
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

// kosmos#8283 (Josh 11-09, against Discord's "is typing"), the UIKit list only: "<dots> <name> is working" over the strip
// just above the box, in the room the box's fade keeps clear of the newest message (endRoom), so it takes no row in the list:
// an idle chat has no empty row under its newest message, and the line coming and going moves nothing (#7348). Its bottom
// sits 4 pt above the strip's top, on a ground that fades in from 6 pt above it, so a reader higher up sees messages fade out
// behind it, never its words over theirs. Not while the pull's dots show (#8072): they rest in the same room, centred, and a
// long name would reach them. One line always, so its height is known: a hidden copy with still dots measures it
// (lineHeight, for endRoom).
struct WorkingStrip: View {
    @ObservedObject var endPull: EndPullDriver
    let working: Bool
    let name: String
    @Binding var lineHeight: CGFloat

    // Written only when it changes the room under the newest message (endRoom), so at the default text size the chat's state
    // is never changed by it as a chat opens.
    private func note(_ h: CGFloat) {
        let room = { (line: CGFloat) in max(ChatView.fadeHeight + 8, line + 10) }
        if room(h) != room(lineHeight) { lineHeight = h }
    }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            WorkingLine(name: name, animated: false).lineLimit(1).hidden()
                .background(GeometryReader { g in
                    Color.clear.onAppear { note(g.size.height) }.onChange(of: g.size.height) { note($0) }
                })
                .padding(.horizontal, 16).padding(.bottom, 4)
            if working && !endPull.dotsUp {
                WorkingLine(name: name).lineLimit(1)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 6).padding(.bottom, 4)
                    .background(LinearGradient(stops: [.init(color: Palette.chatGround.opacity(0), location: 0),
                                                       .init(color: Palette.chatGround, location: 0.45)],
                                               startPoint: .top, endPoint: .bottom))
            }
        }
        // A frame of no height at the strip's top, the line standing on it and drawn upward (an alignment guide here moved
        // nothing: measured 11-09, the line sat on the box's edge either way).
        .frame(maxWidth: .infinity, maxHeight: 0, alignment: .bottomLeading)
        .allowsHitTesting(false)
    }
}

// "<dots> <name> is working": the board's wave (LayerWaveDots, kosmos#7427); VoiceOver hears the words only.
struct WorkingLine: View {
    let name: String
    /// kosmos#7348: false for the hidden copy that keeps the line's room: still dots, so no animation runs in every chat.
    var animated = true

    var body: some View {
        // kosmos#7427: the board's wave (LayerWaveDots), not three dots pulsing together.
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            #if DEBUG
            // kosmos#7427 review 2 debug: KOSMOS_SAMPLE_CLOCKDOTS=1 draws the clock-drawn dots here, as the control.
            // kosmos#7427 build 16: KOSMOS_SAMPLE_SWIFTDOTS=1 draws build 15's WaveDots, the control for the layer-drawn ones.
            if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_CLOCKDOTS"] == "1" { WorkingDots() }
            else if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SWIFTDOTS"] == "1" { WaveDots() } else { LayerWaveDots(still: !animated) }
            #else
            LayerWaveDots(still: !animated)   // review 2: inside the thread, never the clock-drawn WorkingDots; build 16: layer-drawn
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
    // kosmos#7420 (10-28): KOSMOS_SAMPLE_NOLOCK=1 leaves a sideways offset where it is, the control for SideScrollLock.
    static let sampleNoLock = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOLOCK"] == "1"
    #else
    static let sampleNoFix = false
    static let sampleNoKeep = false
    static let sampleNoLock = false
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

// kosmos#7609 (10-30, measured on the iOS 26.5 simulator and CI's runner): bringing the keyboard up while reading higher
// up moved the conversation (the reader's row 149 to 186..225, or off the screen), with the side lock and with the id
// anchor each switched off, so it is iOS 26's own keyboard handling; iOS 27 keeps the row where it was. Not caused here,
// so not prevented here: undone. When the keyboard starts to show while the reader is not at the newest message (`hold`),
// the reader's row (Board.readerRow: the highest whose top shows, or the one the reader is inside), its place in the
// content and the scroll offset are kept; once the keyboard is up the offset is put at that offset plus how far the row
// moved in the content, so the row is where it was on the screen, if nobody is scrolling. At the newest message the chat's
// own keep (keepNewestInView) moves it on purpose, so nothing is held then. KOSMOS_SAMPLE_NOKBHOLD=1 (Debug) is the control.
// kosmos#7645 (CI round 4, 10-30): the hold used to keep the scroll OFFSET, and on CI's runner the rows above were measured
// again as the keyboard rose (content 14008 to 15249 pt): the same offset was then another place, and putting it back moved
// the row off the screen. A row's place in the content moves with the heights above it, so following it does not.
struct KeyboardHold: UIViewRepresentable {
    let hold: Bool
    // Review 1: how many rows of earlier pages the chat holds. A change between will-show and the put-back ends the hold.
    let above: Int
    // Review 2: the chat's own moves and its search words; a change means the app moved or refiltered the list itself, so
    // the hold stands down (in the same update, before that scroll is applied). A status-bar tap to the top has no such
    // signal: one inside the 1.5 s window is put back (known, narrow).
    let moves: String
    // kosmos#7645: where each drawn row is on the screen (iOS 26 and later, RowTop), read for the reader's row.
    let rows: RowTops
    // Review 3: told after each put-back, so the chat can read again whether the newest message is on screen.
    var onPutBack: () -> Void = {}
    // kosmos#7609: given, the reader's row not drawn at did-show is placed by its id (a list whose estimated heights move by
    // thousands of points cannot use the last reading) and settled by its place on the screen. Without it, such a row is put
    // back by its last reading. A drawn row is put back by its place in the content either way.
    var onRowLost: ((String, CGFloat) -> Void)? = nil
    func makeUIView(context: Context) -> Probe {
        let p = Probe(); p.hold = hold; p.above = above; p.moves = moves; p.rows = rows; p.onPutBack = onPutBack; p.onRowLost = onRowLost; return p
    }
    func updateUIView(_ view: Probe, context: Context) {
        if view.moves != moves { view.standDown() }
        if view.above != above { view.pageLanded() }
        view.hold = hold; view.above = above; view.moves = moves; view.rows = rows; view.onPutBack = onPutBack; view.onRowLost = onRowLost
    }

    final class Probe: UIView {
        // Review 1: a reading taken while `hold` was true is dropped the moment it turns false (the reader reached the newest).
        var hold = false { didSet { if !hold { standDown() } } }
        var above = 0
        var moves = ""
        var rows: RowTops?
        var onPutBack: () -> Void = {}
        var onRowLost: ((String, CGFloat) -> Void)?
        private var keptScreenTop: CGFloat = 0
        // kosmos#7690: the keyboard's tracking can have SwiftUI move the list to the id anchor up to a moment BEFORE will-show (measured
        // 20 and 50 ms on CI), so will-show would read the moved list as the reader's place. Set by a jump no finger and no app move
        // made, with the keyboard down (so never the hold's own writes), used once.
        private var lastJump: (from: CGFloat, to: CGFloat, at: Date)?
        // Review 1: the app's own move lands after the stand-down, in a later turn (toRow, goNewest), so it is ignored for a moment.
        // Stamped too by a page landing and whenever hold is set false: a jump missed that way is the old behaviour for one keyboard.
        private var appMovedAt: Date?
        private var offsetWatch: NSKeyValueObservation?
        // A settle waiting its 0.1 s is dropped by anything that ends the hold's claim on the list: a stand-down (the app's
        // own move, the reader at the newest), the keyboard going, the chat leaving the window, or the next keyboard starting
        // to show.
        private var settleToken = 0
        // Between did-show and will-hide: a will-show then is the same keyboard changing, and does not drop a waiting settle
        // (the did-show that follows does, starting its own hold). A will-hide that never comes changes only that.
        private var keyboardUp = false
        // kosmos#7609: after a row is placed by id, 0.1 s later (and one more main-queue turn), its fresh place on the screen
        // against its will-show top `want`; the offset takes up the difference, inside what can be scrolled to
        // (Board.settleOffset). Not under a finger, and not once earlier messages landed or the width changed since the reading
        // (putBack's own stand-downs). A row not drawn yet is tried again every 0.1 s until `until`, the end of the hold's
        // window; a correction (a first try's or a retry's) is looked at once more (relooked); once settled the hold guards the
        // row again until then (iOS 26 moves the list more than once after did-show), with its own end timer.
        // The chat reads its newest again (onPutBack) after the first try however it ends, dropped
        // included, since the placing itself may have shown the end, and after any try that moved the list.
        // relooked: the one look after a correction has been asked (kosmos#7609: a retry's correction had none).
        private func settleOnScreen(_ id: String, above: Int, width: CGFloat, want: CGFloat, until: Date, retried: Bool = false, relooked: Bool = false) {
            let token = settleToken
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                guard token == self.settleToken, let sv = self.scroll else { if !retried { self.onPutBack() }; return }
                var acted = !retried
                defer { if acted { self.onPutBack() } }
                if sv.isTracking || sv.isDragging || sv.isDecelerating { ChatView.trace("keyboard hold: settle skipped, a finger"); return }
                // kosmos#7654: a reading that does not agree with the list is the stale one the row left behind, as good as not drawn.
                let bandTop = sv.convert(CGPoint(x: 0, y: sv.contentOffset.y + sv.adjustedContentInset.top), to: nil).y
                guard let r = self.rows?.y[id],
                      !Board.readingsHere(["row": (top: r.top, content: r.content)], offset: Double(sv.contentOffset.y + sv.adjustedContentInset.top),
                                          bandTop: Double(bandTop), slack: Board.readingSlack).isEmpty else {
                    ChatView.trace(retried ? "keyboard hold: settle retry, no good reading of the row" : "keyboard hold: settle, no good reading of the row")
                    if Date() >= until { ChatView.trace("keyboard hold: settle gave up") }
                    // A row with no last reading belongs to readings that were cleared (another chat): nothing to settle.
                    if Date() < until, self.rows?.last[id] != nil { self.settleOnScreen(id, above: above, width: width, want: want, until: until, retried: true, relooked: relooked) }
                    return
                }
                if self.above != above || abs(sv.bounds.width - width) > 0.5 { ChatView.trace("keyboard hold: settle skipped, the list changed"); return }
                let moved = CGFloat(r.top) - want
                ChatView.trace("keyboard hold: settle, row off by \(Int(moved)), \(Self.numbers(sv))")
                if abs(moved) > 1 {   // any size: the reading agreed with the list above, so this one is true
                    acted = true
                    let i = sv.adjustedContentInset
                    let target = Board.settleOffset(offset: Double(sv.contentOffset.y), moved: Double(moved), insetTop: Double(i.top),
                                                    insetBottom: Double(i.bottom), contentHeight: Double(sv.contentSize.height),
                                                    viewHeight: Double(sv.bounds.height))
                    sv.contentOffset = CGPoint(x: sv.contentOffset.x, y: CGFloat(target))
                    // kosmos#7654: read once more: on CI's runner a 7 pt correction was undone while the list settled and nothing looked again.
                    // kosmos#7609 (main run 41713564948): also after a retry's correction (27 pt corrected, 20 pt left, no look).
                    if !relooked, Date() < until { self.settleOnScreen(id, above: above, width: width, want: want, until: until, retried: true, relooked: true); return }
                }
                if Date() < until, self.guarding == nil {
                    // The row's place in the content and the offset as they are now, settled: what the watch keeps from here.
                    self.guarding = ((id, CGFloat(r.content), sv.contentOffset.y, above, width, Date()), until)
                    self.watchRow(id, last: CGFloat(r.content))
                    ChatView.trace("keyboard hold: guarding again after the placing")
                    let mine = self.generation
                    DispatchQueue.main.asyncAfter(deadline: .now() + until.timeIntervalSinceNow + 0.05) { [weak self] in
                        guard let self, self.generation == mine, self.guarding != nil else { return }
                        if let sv = self.scroll { ChatView.trace("keyboard hold: window ended \(Self.numbers(sv))") }
                        self.endGuard()
                    }
                }
            } }
        }
        // The reader's row placed by its id and settled by its place on the screen, for a reading that cannot be used. False when
        // there is no way to place it. The same stand-downs as putBack: under a finger, earlier messages landed, or the width changed.
        private func placeById(_ kept: Reading, far: Bool) -> Bool {
            guard let lost = onRowLost, let sv = scroll else { return false }
            if sv.isTracking || sv.isDragging || sv.isDecelerating { ChatView.trace("keyboard hold: skipped, a finger"); endGuard(); return true }
            if above != kept.above { ChatView.trace("keyboard hold: skipped, earlier messages landed"); endGuard(); return true }
            if abs(sv.bounds.width - kept.width) > 0.5 { ChatView.trace("keyboard hold: skipped, the width changed"); endGuard(); return true }
            let top = sv.convert(CGPoint(x: 0, y: sv.contentOffset.y + sv.adjustedContentInset.top), to: nil).y
            let bottom = sv.convert(CGPoint(x: 0, y: sv.contentOffset.y + sv.bounds.height - sv.adjustedContentInset.bottom), to: nil).y
            let f = CGFloat(Board.bandFraction(Double(keptScreenTop), bandTop: Double(top), bandBottom: Double(bottom)))
            ChatView.trace(far ? "keyboard hold: row moved far off, placed by id at \(Int(f * 100))% of the screen" : "keyboard hold: row not drawn at did-show, placed by id at \(Int(f * 100))% of the screen")
            // f is the row's will-show top against the band as it is now (keyboard up), and scrollTo lines up the row's
            // point f, not its top: an approximate place, which the settle then corrects to the will-show top.
            // A will-show top now under the keyboard is held to the band's bottom (f = 1); the settle then aims at the
            // will-show top all the same, its own place on the screen before the keyboard.
            let until = guarding?.until ?? Date().addingTimeInterval(Self.window)
            lost(kept.row, f); endGuard()
            settleOnScreen(kept.row, above: kept.above, width: kept.width, want: keptScreenTop, until: until)
            return true
        }
        // While held, every move of the reader's row is put back (deferred to the next turn of the main queue, so a move made
        // inside a layout pass is answered after it); the row leaving the drawn rows is put back once by its last reading, and
        // the hold ends.
        private func watchRow(_ row: String, last: CGFloat) {
            rows?.watch = (row, { [weak self, weak rows = self.rows] r in
                guard let r else {
                    ChatView.trace("keyboard hold: the row left the drawn rows while held")
                    let at = CGFloat(rows?.last[row] ?? Double(last))
                    DispatchQueue.main.async { self?.putBack(at); self?.endGuard() }; return
                }
                DispatchQueue.main.async { self?.putBack(CGFloat(r.content)) }
            })
        }
        func standDown() { saved = nil; savedKeyboard = nil; lastJump = nil; appMovedAt = Date(); endGuard(); settleToken &+= 1 }
        // Review 2: a page landing above moves the offset by its height with nothing moving on the screen: not the keyboard's jump.
        func pageLanded() { lastJump = nil; appMovedAt = Date() }
        // The reader's row, its place in the content and the scroll offset when the keyboard started to show, the rows above
        // and the width, and when (review 1: a will-show with no did-show, an iPad's floating keyboard say, must not leave a
        // reading for a later one).
        typealias Reading = (row: String, content: CGFloat, offset: CGFloat, above: Int, width: CGFloat, at: Date)
        private var saved: Reading?
        // kosmos#7609 review 1: the keyboard frame that reading's will-show announced.
        private var savedKeyboard: CGRect?
        private var observers: [NSObjectProtocol] = []
        private weak var scroll: UIScrollView?
        // The reading being held after did-show, and until when; the row's moves are answered only meanwhile.
        private var guarding: (kept: Reading, until: Date)?
        private var generation = 0   // review 2: a timer from an earlier keyboard never ends a later guard
        private var replaced = false   // kosmos#7654: the one placing a far put-back may ask for, per keyboard
        // kosmos#7645: 1.5 s, not 0.8: on CI's runner did-show came 1.3 s after will-show, and with the anchor let go nothing
        // fights a longer window (a finger or the app's own move still ends it).
        static let window: TimeInterval = 1.5
        // How old a will-show reading may be at its did-show (kosmos#7609: measured 3.4 s on CI).
        static let staleAfter: TimeInterval = 6
        // kosmos#7690: a move this large with no finger on the list, this soon before will-show, was not the reader's.
        static let jumpSize: CGFloat = 100
        static let jumpWindow: TimeInterval = 0.25
        static let jumpSettle: CGFloat = 20
        static let appMoveQuiet: TimeInterval = 0.3
        private func endGuard() { guarding = nil; rows?.watch = nil }
        #if DEBUG
        private var jumpWatch: NSKeyValueObservation?
        private var heightTimer: Timer?   // kosmos#7420, KOSMOS_SAMPLE_HEIGHT=1
        private var walkTimer: Timer?   // kosmos#7420, KOSMOS_SAMPLE_WALK=1: the walk under way, ended on re-entry
        private var walkStart: DispatchWorkItem?   // its start, 4 s after opening, cancelled on re-entry
        private var walkNewest: DispatchWorkItem?   // its ask for the newest, 2 s after the top, cancelled on re-entry
        private func walkSay(_ phase: String) {
            guard let rows else { return }
            NotificationCenter.default.post(name: .sampleWalking, object: rows, userInfo: ["phase": phase])
        }
        static let walkStepsMax = 400   // 2 minutes of steps
        // kosmos#7420: points and counts only (the allow-list test pins this line): the reported content height, the offset,
        // how many rows have a reading in RowTops, the first and last of those rows' tops in the content, and the content
        // past the last row's top (its own height included).
        static func heightLine(_ sv: UIScrollView, rows: RowTops) -> String {
            let at = rows.y.values.map(\.content), first = at.min() ?? 0, last = at.max() ?? 0, size = sv.contentSize.height
            return "content \(Int(size)), y \(Int(sv.contentOffset.y)), drawn \(at.count), from \(Int(first)) to \(Int(last)), past last \(Int(size - last))"
        }
        #endif
        // kosmos#7690: from, to and the app's own frames on the stack, Debug only.
        static func jumpLine(_ a: CGFloat, _ b: CGFloat) -> String {
            // Every frame past KVO's own: the jump comes from the framework, and a filter on our symbols hid who.
            let frames = Thread.callStackSymbols.dropFirst(3).prefix(28).map { String($0.split(separator: " ").dropFirst(3).first?.prefix(46) ?? "?") }
            return "\(Int(a)) to \(Int(b)) by " + frames.joined(separator: " < ")
        }
        // kosmos#7654: the rows nearest the held one, named, in a Debug run of the sample room or chat only: its ids hold no one's words.
        // Everywhere else the words "not sampled". A held row whose numbers say nothing moved could not be identified without this.
        static func sampleRows(_ rows: RowTops, held: String) -> String {
            #if DEBUG
            guard ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" else { return "not sampled" }
            let at = rows.y[held]?.content ?? 0
            let near = rows.y.sorted { abs($0.value.content - at) < abs($1.value.content - at) }.prefix(10)   // nearest the held row in the content: old rows no longer crowd them out
            return "\(held): " + near.map { "\($0.key) \(Int($0.value.top))/\(Int($0.value.content))" }.joined(separator: ", ")
            #else
            return "not sampled"
            #endif
        }
        // kosmos#7645 round 4: the scroll's numbers for the record (points only).
        static func numbers(_ sv: UIScrollView) -> String {
            "y \(Int(sv.contentOffset.y)), content \(Int(sv.contentSize.height)), showing \(Int(sv.bounds.height - sv.adjustedContentInset.top - sv.adjustedContentInset.bottom))"
        }
        // Review 1: not under a finger (down, or dragging, or flinging), and not when a page of earlier messages landed above
        // meanwhile, nor after a rotation: each ends the hold for this keyboard. The reader's row stays where it was on the
        // screen when the offset is the one at will-show plus how far the row moved in the content (rows above measured again):
        // one SwiftUI number, so answering the same reading twice writes the same value, and if iOS's own move already did
        // that, nothing is written.
        private func putBack(_ content: CGFloat) {
            guard let g = guarding, let sv = scroll else { return }
            guard Date() < g.until else { endGuard(); return }
            if sv.isTracking || sv.isDragging || sv.isDecelerating { ChatView.trace("keyboard hold: skipped, a finger"); endGuard(); return }
            if above != g.kept.above { ChatView.trace("keyboard hold: skipped, earlier messages landed"); endGuard(); return }
            if abs(sv.bounds.width - g.kept.width) > 0.5 { ChatView.trace("keyboard hold: skipped, the width changed"); endGuard(); return }
            let i = sv.adjustedContentInset
            let target = CGFloat(Board.holdTarget(offset: Double(g.kept.offset), content: Double(content), keptContent: Double(g.kept.content),
                                                  insetTop: Double(i.top), insetBottom: Double(i.bottom),
                                                  contentHeight: Double(sv.contentSize.height), viewHeight: Double(sv.bounds.height)))
            let moved = sv.contentOffset.y - target   // how far the row is from its place on the screen, the number the record keeps
            guard abs(moved) > 1 else { return }
            // kosmos#7654: a put-back past a screenful answers a reading that cannot be used (CI, after a good placing: -7336 sent the
            // row away). Placed by id once for this keyboard; a second one leaves the list alone.
            // The whole view, not the band left by the keyboard: in landscape that is nearly nothing.
            if Board.holdReadingFar(moved: Double(moved), showing: Double(sv.bounds.height)) {
                ChatView.trace("keyboard hold: put back \(Int(moved)) refused, past a screenful")
                ChatView.trace("keyboard hold: at \(Self.numbers(sv))")
                if replaced { endGuard(); return }
                replaced = true
                if !placeById(g.kept, far: true) { endGuard() }
                return
            }
            ChatView.trace("keyboard hold: put back \(Int(moved))")
            sv.contentOffset = CGPoint(x: sv.contentOffset.x, y: target)
            ChatView.trace("keyboard hold: now \(Self.numbers(sv))")
            onPutBack()
        }
        // Review 1: only where it was measured (iOS 26, which moves the list; 27 does not, so it is a no-op there). On 16 to
        // 18 the system's own keyboard moves were never measured, and undoing them blind could be the bug.
        #if DEBUG
        static let off: Bool = { if #available(iOS 26.0, *) { return ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOKBHOLD"] == "1" } else { return true } }()
        #else
        static let off: Bool = { if #available(iOS 26.0, *) { return false } else { return true } }()
        #endif
        override init(frame: CGRect) { super.init(frame: frame); isUserInteractionEnabled = false; isHidden = true }
        required init?(coder: NSCoder) { nil }
        deinit { observers.forEach(NotificationCenter.default.removeObserver) }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            observers.forEach(NotificationCenter.default.removeObserver); observers = []; saved = nil; savedKeyboard = nil; endGuard(); settleToken &+= 1
            keyboardUp = false
            #if DEBUG
            heightTimer?.invalidate(); heightTimer = nil
            walkStart?.cancel(); walkStart = nil
            walkNewest?.cancel(); walkNewest = nil
            if walkTimer != nil { walkTimer?.invalidate(); walkTimer = nil; walkSay("end") }
            #endif
            guard window != nil, !Self.off else { return }
            var up = superview
            while let v = up, !(v is UIScrollView) { up = v.superview }
            scroll = up as? UIScrollView
            lastJump = nil
            offsetWatch = scroll?.observe(\.contentOffset, options: [.old, .new]) { [weak self] v, c in
                // kosmos#7609 review 1: the reader's own scroll between will-show and did-show is their new place: the reading goes.
                // A drag, not a resting finger (review 5).
                if let self, self.saved != nil, v.isDragging {
                    self.saved = nil; self.savedKeyboard = nil; ChatView.trace("keyboard hold: the reader scrolled before did-show, dropped"); return
                }
                guard let self, let a = c.oldValue?.y, let b = c.newValue?.y, !self.keyboardUp, self.saved == nil, self.guarding == nil,
                      !v.isTracking, !v.isDragging, !v.isDecelerating else { return }
                let now = Date()
                if let t = self.appMovedAt, now.timeIntervalSince(t) < Self.appMoveQuiet { return }
                // Review 1: a jump in two steps, or a settle after it, is one move from where the list was.
                if let j = self.lastJump, now.timeIntervalSince(j.at) <= Self.jumpWindow, abs(a - j.to) <= Self.jumpSettle { self.lastJump = (j.from, b, j.at); return }
                if abs(b - a) > Self.jumpSize { self.lastJump = (a, b, now) }
            }
            #if DEBUG
            // kosmos#7420: a Debug sample run with KOSMOS_SAMPLE_HEIGHT=1 too: every half second, the content height the list
            // reports against where its drawn rows sit in that content, to see the lazy list's estimate (124690 pt for about
            // 19498 measured on Josh's phone) grow as the window lands.
            if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_TRACE"] == "1", ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_HEIGHT"] == "1" {
                let height = Timer(timeInterval: 0.5, repeats: true) { [weak self] t in
                    guard let self, self.window != nil else { t.invalidate(); return }   // the chat left: no more lines
                    guard let v = self.scroll, let r = self.rows, r.isChat else { return }
                    ChatView.trace("height: \(Self.heightLine(v, rows: r))", ring: false)
                }
                RunLoop.main.add(height, forMode: .common)   // .common: lines keep coming while a finger scrolls too
                heightTimer = height
                // KOSMOS_SAMPLE_WALK=1
                if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_WALK"] == "1" {
                    let start = DispatchWorkItem { [weak self] in
                        guard let self, self.window != nil, let rows = self.rows, rows.isChat else { return }   // a rebuilt or closed list, or a room: no walk
                        rows.walkTaken = false
                        self.walkSay("start")
                        var steps = 0
                        self.walkTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] t in
                            guard let self, self.window != nil, let v = self.scroll else {
                                t.invalidate(); self?.walkTimer = nil; self?.walkSay("end"); return
                            }
                            steps += 1
                            // The chat takes the start only on screen; a walk it did not take (checked a tick later, once the
                            // notice has landed) would scroll a list still holding its "end" anchor, so it does not run.
                            if steps == 1, self.rows?.walkTaken != true {
                                t.invalidate(); self.walkTimer = nil
                                ChatView.trace("height: walk not taken, the chat is not on screen", ring: false); self.walkSay("end"); return
                            }
                            if steps > Self.walkStepsMax {
                                t.invalidate(); self.walkTimer = nil; ChatView.trace("height: walk gave up", ring: false); self.walkSay("end"); return
                            }
                            let top = -v.adjustedContentInset.top
                            if v.contentOffset.y <= top + 1 {
                                t.invalidate(); self.walkTimer = nil; ChatView.trace("height: walk at the top", ring: false)
                                self.walkSay("end")
                                let newest = DispatchWorkItem { [weak self] in
                                    guard let self, self.window != nil else { return }
                                    ChatView.trace("height: walk asks for the newest", ring: false)
                                    self.walkSay("newest")
                                }
                                self.walkNewest = newest
                                DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: newest)
                                return
                            }
                            v.setContentOffset(CGPoint(x: 0, y: max(top, v.contentOffset.y - v.bounds.height)), animated: false)
                        }
                    }
                    walkStart = start
                    DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: start)
                }
            }
            // kosmos#7690: a Debug sample run with a trace: every jump of the list and what made it (the tap on the box moves a room by
            // about 490 pt before will-show, measured on CI).
            jumpWatch = nil
            if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_TRACE"] == "1" {
                jumpWatch = scroll?.observe(\.contentOffset, options: [.old, .new]) { v, c in
                    guard let a = c.oldValue?.y, let b = c.newValue?.y, abs(b - a) > 100 else { return }
                    let tall = Int(v.bounds.height), inset = Int(v.adjustedContentInset.bottom), sized = Int(v.contentSize.height)
                    ChatView.trace("keyboard hold: list \(tall) tall, bottom inset \(inset), content \(sized)")
                    ChatView.trace("keyboard hold: jump \(Self.jumpLine(a, b))")
                }
            }
            #endif
            let nc = NotificationCenter.default
            observers.append(nc.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { [weak self] n in
                guard let self, let sv = self.scroll else { return }
                let jump = self.lastJump; self.lastJump = nil   // used once, whatever happens below
                if !self.keyboardUp { self.settleToken &+= 1; self.replaced = false }   // a new keyboard: a settle still waiting belongs to the one before
                // A will-show while a reading waits for its did-show keeps that reading, unless that reading is past staleAfter:
                // its did-show would refuse it anyway, so this keyboard reads afresh (kosmos#7609 reviews 4 and 5).
                if let k = self.saved, Date().timeIntervalSince(k.at) >= Self.staleAfter {
                    self.saved = nil; self.savedKeyboard = nil; ChatView.trace("keyboard hold: an old reading with no did-show, read again")
                }
                guard self.saved == nil, self.hold, !sv.isTracking, !sv.isDragging, !sv.isDecelerating else { return }
                ChatView.trace("keyboard hold: will-show \(Self.numbers(sv))")
                // The top of what shows, below the top inset (the bar), in window points: the same space as RowTop's .global for
                // a full-screen window (an iPhone). kosmos#7654: since the agreement below, a mismatch here means no hold at all.
                let top = sv.convert(CGPoint(x: 0, y: sv.contentOffset.y + sv.adjustedContentInset.top), to: nil).y
                let bottom = sv.convert(CGPoint(x: 0, y: sv.contentOffset.y + sv.bounds.height - sv.adjustedContentInset.bottom), to: nil).y
                // kosmos#7654: only rows whose reading agrees with where the list is now. A row kept alive off the screen stops being read, so
                // after a fast scroll its old top can sit inside the band: CI held Post 102 for a reader at Post 176, 5000 pt away.
                let rowsNow = self.rows.map { rows in
                    Board.readingsHere(rows.y.mapValues { (top: $0.top, content: $0.content) }, offset: Double(sv.contentOffset.y + sv.adjustedContentInset.top),
                                       bandTop: Double(top), slack: Board.readingSlack)
                } ?? [:]
                let rowsAll = self.rows?.y.count ?? 0
                ChatView.trace("keyboard hold: \(rowsNow.count) of \(rowsAll) rows agree with the list")
                // kosmos#7690: a jump just before will-show is the keyboard's, not the reader's: read the rows where they were before it.
                var back = self.keyboardUp ? 0 : jump.map { Board.jumpBack(from: Double($0.from), to: Double($0.to), now: Double(sv.contentOffset.y), age: Date().timeIntervalSince($0.at), within: Self.jumpWindow, settle: Double(Self.jumpSettle)) } ?? 0
                // kosmos#7645: when the read-back leaves no row to hold, the rows are read where they are now (a held place,
                // rather than none). Most likely what CI's run 41691914906 hit; the trace line below says whether.
                let held = Board.holdRow(rowsNow, back: back, below: Double(top), above: Double(bottom))
                if held.fellBack { ChatView.trace("keyboard hold: a jump of \(Int(back)) left no row to hold, read where they are now") }
                back = held.back
                guard let rows = self.rows, let r = held.row, let reading = rows.y[r.id] else {
                    ChatView.trace("keyboard hold: no row on the screen to hold (jump back \(Int(back)))"); return
                }
                if back != 0 { ChatView.trace("keyboard hold: read before a jump of \(Int(back))") }
                self.saved = (r.id, CGFloat(reading.content), sv.contentOffset.y - CGFloat(back), self.above, sv.bounds.width, Date()); self.keptScreenTop = CGFloat(r.top)
                self.savedKeyboard = n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
                ChatView.trace("keyboard hold: held row at \(Int(reading.content)) in the content, \(Int(r.top)) on the screen, band \(Int(top)) to \(Int(bottom))")
                ChatView.trace("keyboard hold: chose \(Self.sampleRows(rows, held: r.id))")
            })
            observers.append(nc.addObserver(forName: UIResponder.keyboardDidShowNotification, object: nil, queue: .main) { [weak self] n in
                self?.keyboardUp = true
                guard let self, let kept = self.saved else { return }
                let announced = self.savedKeyboard
                self.saved = nil; self.savedKeyboard = nil
                guard let rows = self.rows else { return }
                // kosmos#7609 review 1: a reading whose will-show announced a keyboard of another width is not used. Width only: the
                // height of one keyboard flips (380 and 608 on Josh's phone, #7817) and must not drop its own hold.
                if let a = announced, let f = n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect, abs(a.width - f.width) > 0.5 {
                    ChatView.trace("keyboard hold: skipped, the keyboard's width changed"); return
                }
                // kosmos#7645: 1.3 s on CI's runner once; kosmos#7609 (main run 41780837713, 11-04): 3.4 s on a busy runner, and the
                // 3 s limit then dropped the whole correction. Kept as a backstop, past the frame check above.
                guard Date().timeIntervalSince(kept.at) < Self.staleAfter else { ChatView.trace("keyboard hold: skipped, stale"); return }
                // 10-30 measured: iOS 26 moves it more than once after did-show, so for a short window every move of the
                // reader's row is put back, as long as nothing else is moving the list.
                self.generation &+= 1
                self.settleToken &+= 1
                let mine = self.generation
                self.guarding = (kept, Date().addingTimeInterval(Self.window))
                // The reader's row no longer drawn (iOS moved it far off): put back once by its last known place in the content (it
                // stops being read when it leaves, so rows above measured again after that are not seen), then the hold ends. The same
                // rule when it leaves while held, below.
                guard let r = rows.y[kept.row] else {
                    // A row with no last reading belongs to readings that were cleared (a fresh chat): nothing of this chat to place.
                    if rows.last[kept.row] != nil { self.replaced = true; if self.placeById(kept, far: false) { return } }
                    // No last reading at all means the readings were cleared (a fresh chat opened): nothing of this chat to put back.
                    ChatView.trace("keyboard hold: the row was not drawn at did-show" + (rows.last[kept.row] == nil ? ", nothing put back" : ", put back by its last reading"))
                    if let c = rows.last[kept.row] { self.putBack(CGFloat(c)) }
                    self.endGuard(); return
                }
                ChatView.trace("keyboard hold: did-show, row at \(Int(r.content)) in the content, \(Int(r.top)) on the screen, \(self.scroll.map { Self.numbers($0) } ?? "no scroll")")
                ChatView.trace("keyboard hold: rows \(Self.sampleRows(rows, held: kept.row))")
                self.putBack(CGFloat(r.content))
                self.watchRow(kept.row, last: kept.content)
                DispatchQueue.main.asyncAfter(deadline: .now() + Self.window + 0.05) { [weak self] in
                    if let self, self.generation == mine {
                        if let sv = self.scroll {
                            ChatView.trace("keyboard hold: window ended \(Self.numbers(sv))")
                            // A move the row's readings never reported would leave it off its place: the record says by how much. Only
                            // while still held: a hold that stood down (a finger, the app's own move) left the place on purpose.
                            if self.guarding != nil, let r = rows.y[kept.row] {
                                let i = sv.adjustedContentInset
                                let place = Board.holdTarget(offset: Double(kept.offset), content: r.content, keptContent: Double(kept.content),
                                                             insetTop: Double(i.top), insetBottom: Double(i.bottom),
                                                             contentHeight: Double(sv.contentSize.height), viewHeight: Double(sv.bounds.height))
                                let moved = sv.contentOffset.y - CGFloat(place)
                                if abs(moved) > 1 { ChatView.trace("keyboard hold: window ended off the row's place by \(Int(moved))") }
                            }
                        }
                        self.endGuard()
                    }
                }
            })
            // A keyboard that hides before it finished showing leaves nothing held.
            observers.append(nc.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
                self?.saved = nil; self?.savedKeyboard = nil; self?.lastJump = nil; self?.endGuard(); self?.settleToken &+= 1; self?.keyboardUp = false; self?.replaced = false
            })
        }
    }
}

// kosmos#7645: where each drawn row of the chat is, kept by RowTop on iOS 26 and later (where KeyboardHold runs): its top on the
// screen (window points, to choose the reader's row) and in the content (ContentSpace), which moves only when rows above it
// are measured again. A class, so a reading redraws nothing. `watch` hands one row's fresh readings to the hold, and says
// when that row stops being drawn (nil). Assumed, not measured: no reading arrives after a row's onDisappear; a stray one
// would at worst offer a row outside what shows, which Board.readerRow never picks.
struct RowReading: Equatable {
    let top: Double, content: Double
    let end: Double   // its bottom in the content, for a capture (#7420: did a rebuild come back?)
    // Not in the comparison: a row growing at its bottom must not wake the keyboard hold, which watches these. So end is as of the row's last move.
    static func == (a: RowReading, b: RowReading) -> Bool { a.top == b.top && a.content == b.content }
}
final class RowTops {
    var y: [String: RowReading] = [:]
    var last: [String: Double] = [:]   // each row's last place in the content, kept after it stops being drawn (one per row
                                       // drawn in this chat; a fresh chat clears it)
    var watch: (id: String, seen: (RowReading?) -> Void)?
    #if DEBUG
    var isChat = false   // kosmos#7420: set by ChatView, so the Debug height lines and walk skip a room's list
    var walkTaken = false   // kosmos#7420: the chat took the walk's start (on screen, its anchor let go)
    #endif
    func set(_ id: String, _ r: RowReading?) {
        if KeyboardHold.Probe.off { return }   // the hold is off (below iOS 26, or the Debug control): nothing reads these
        y[id] = r
        if let r { last[id] = r.content }
        if let w = watch, w.id == id { w.seen(r) }
    }
    func tops() -> [String: Double] { y.mapValues(\.top) }
    func reset() { y = [:]; last = [:]; watch = nil }   // a fresh chat
}

struct ContentSpace: ViewModifier {
    static let name = "kosmosChatContent"
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 26.0, *) { content.coordinateSpace(.named(Self.name)) } else { content }
    }
}

struct RowTop: ViewModifier {
    let id: String
    let rows: RowTops
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.onGeometryChange(for: RowReading.self) {
                RowReading(top: Double($0.frame(in: .global).minY), content: Double($0.frame(in: .named(ContentSpace.name)).minY), end: Double($0.frame(in: .named(ContentSpace.name)).maxY))
            } action: { rows.set(id, $0) }
                .onDisappear { rows.set(id, nil) }
        } else { content }
    }
}

// kosmos#7265: rows as scroll targets, and the list anchored on one message id (iOS 17+, ChatView.idAnchor).
struct PositionTargets: ViewModifier {
    let on: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 17.0, *), on { content.scrollTargetLayout() } else { content }
    }
}

// kosmos#7420: the chat's scroll view, for the empty-list diagnostic: its place against the content (Board.scrollPlace),
// and putting an offset outside the content back at its end.
final class ScrollBox {
    weak var view: UIScrollView?
    weak var endPull: EndPullDriver?   // kosmos#8072: follows the list's scroll view, which a rebuild replaces
    // UIKit's own reading, on every iOS (personScrolling is set only on 18 and later).
    var underFinger: Bool { guard let sv = view else { return false }; return sv.isTracking || sv.isDragging || sv.isDecelerating }
    func reading() -> (line: String, place: String, end: Double)? {
        guard let sv = view else { return nil }
        let i = sv.adjustedContentInset
        let p = Board.scrollPlace(offset: Double(sv.contentOffset.y), content: Double(sv.contentSize.height),
                                  view: Double(sv.bounds.height), insetTop: Double(i.top), insetBottom: Double(i.bottom))
        func n(_ x: CGFloat) -> Int { x.isFinite ? Int(x) : -1 }   // no trap on NaN or infinity in the report about a broken scroll
        return ("scroll y \(n(sv.contentOffset.y)), content \(n(sv.contentSize.height)), view \(n(sv.bounds.height)), insets \(n(i.top))/\(n(i.bottom)): \(p.place)",
                p.place, p.end)
    }
    // kosmos#7420: the stretch of the content between the bars, in the same terms as a row's place in the content.
    func showing() -> (top: Double, bottom: Double)? {
        guard let sv = view else { return nil }
        let i = sv.adjustedContentInset
        return (Double(sv.contentOffset.y + i.top), Double(sv.contentOffset.y + sv.bounds.height - i.bottom))
    }
    // kosmos#7420: how far the offset is short of the content's end, in points (0 at the end or past it); nil unread or not finite.
    func shortOfEnd() -> Double? {
        guard let sv = view, let r = reading() else { return nil }
        let y = Double(sv.contentOffset.y)
        guard y.isFinite, r.end.isFinite else { return nil }
        return max(0, r.end - y)
    }
    // Outside either way it goes to the end, since the newest message follows. The end is read from the content's size now,
    // which for lazy rows is an estimate; goNewest then goes to the newest message. Never under a finger. True when it moved it.
    func backInside() -> Bool {
        guard let sv = view, !underFinger, let r = reading(), r.place != "within" else { return false }
        sv.contentOffset = CGPoint(x: -sv.adjustedContentInset.left, y: CGFloat(r.end))
        return true
    }
}

// kosmos#7420 (Josh 10-28, builds 13 to 15): every row of the chat moved left by its 16 pt side margin, the agent's
// bubbles against the screen's edge, and back on a later layout. The chat had been scrolled sideways: the list scrolls only
// up and down, but the scroll view underneath it keeps whatever offset it is given (the hold on the newest message is
// centred across as well, anchor .bottom). Which layout gave it one was never caught (a row made wider than the screen in
// the simulator did not), so the lock does not depend on the cause: it watches the scroll view the chat sits in and puts
// any sideways offset back to its rest, writing it in the diagnostic's record. KOSMOS_SAMPLE_SIDEWAYS=<seconds> (Debug) gives it
// one, as the phone did; KOSMOS_SAMPLE_NOLOCK=1 is the control.
struct SideScrollLock: UIViewRepresentable {
    let off: Bool
    var box: ScrollBox? = nil   // kosmos#7420: told which scroll view it found
    // kosmos#7575: told of each new shift, and of a shift growing past its largest so far (the offset, whether the person
    // was scrolling, whether it is a new shift), for the chat's report.
    var onShift: ((CGFloat, Bool, Bool) -> Void)? = nil
    func makeUIView(context: Context) -> Probe { let p = Probe(off: off); p.onShift = onShift; p.box = box; return p }
    func updateUIView(_ view: Probe, context: Context) { view.onShift = onShift; view.box = box }

    final class Probe: UIView {
        let off: Bool
        var onShift: ((CGFloat, Bool, Bool) -> Void)?
        var box: ScrollBox?
        private weak var found: UIScrollView?   // kosmos#7420: the scroll view this probe gave the box
        private var peak: CGFloat = 0   // kosmos#7575 review 1: this shift's largest offset so far
        private var resumed = false     // kosmos#7575 review 2: the first reading after moving window
        private var wasShifted = false  // review 3: a shift was in place when it left its window
        // Review 5: tried again every 0.35 s while the list is dragged or flinging, so a fling that ends with no further
        // offset change still gets it back.
        private func putBack(_ sv: UIScrollView) {
            let mine = generation
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self, weak sv] in
                guard let self, self.generation == mine else { return }
                guard let sv, self.window != nil else { self.fixing = false; return }
                if sv.isDragging || sv.isDecelerating { self.putBack(sv); return }
                self.fixing = false
                let rest = -sv.adjustedContentInset.left
                if abs(sv.contentOffset.x - rest) > 0.5 { sv.contentOffset.x = rest }
            }
        }
        private var watch: NSKeyValueObservation?
        private var shifted = false
        private var shifts = 0          // review 4: shifts so far; recorded at the 1st, 2nd, 4th, 8th..., so a cause that
                                        // comes back every frame cannot fill the record (kept across windows on purpose)
        private var fixing = false
        private var writing = false     // kosmos#7420 review 1: inside our own immediate write (below), never a second one
        private var quick = 0           // kosmos#7420 review 2: immediate writes in a 0.35 s window from its first; past 4, the delayed put-back
        private var generation = 0      // review 6: a retry from before the probe moved window ends itself
        #if DEBUG
        static var sampleShifted = false   // KOSMOS_SAMPLE_SIDEWAYS gives one shift, not one per window
        #endif
        init(off: Bool) { self.off = off; super.init(frame: .zero); isUserInteractionEnabled = false; isHidden = true }
        required init?(coder: NSCoder) { nil }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window == nil, let mine = found, box?.view === mine { box?.view = nil; box?.endPull?.detach() }   // kosmos#7420: never a stale scroll view
            if window == nil { wasShifted = shifted }   // kosmos#7575 review 3: remembered across the move
            watch = nil; shifted = false; fixing = false; quick = 0; generation &+= 1
            guard window != nil else { return }
            resumed = true
            var up = superview
            while let v = up, !(v is UIScrollView) { up = v.superview }
            guard let scroll = up as? UIScrollView else { ChatView.trace("side lock: no scroll view"); return }
            box?.view = scroll; found = scroll
            box?.endPull?.attach(to: scroll)
            #if DEBUG
            if let at = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SIDEWAYS"].flatMap(Double.init), !Self.sampleShifted {
                Self.sampleShifted = true
                DispatchQueue.main.asyncAfter(deadline: .now() + at) { [weak scroll] in
                    if let scroll { scroll.contentOffset.x = -scroll.adjustedContentInset.left + 16 }
                }
            }
            #endif
            let off = self.off
            // Review 1: at rest the offset is minus the left inset (0 in portrait; landscape can give an inset), so that is
            // where it goes back to, and a difference from it is what is recorded.
            // Review 4: put back 0.35 s after a shift and only while nobody is dragging or flinging, so a scroll in progress
            // (the person's, or the hold on the newest message) finishes first; still shifted after that, it goes back.
            // kosmos#7420 10-29: under the id anchor that wait is now only for the person's drag or fling; with neither
            // (the hold on the newest message included, which is not animated there), it goes back at once (below).
            watch = scroll.observe(\.contentOffset, options: [.initial, .new]) { [weak self] sv, _ in
                guard let self else { return }
                let x = sv.contentOffset.x + sv.adjustedContentInset.left
                let resumed = self.resumed; self.resumed = false
                // kosmos#7575: the decision is Board.sideShiftStep (tested in LogicTests): new, grown, or the same shift
                // still in place after the info page (review 2 and 3).
                let step = Board.sideShiftStep(x: Double(x), shifted: self.shifted, wasShifted: self.wasShifted,
                                               resumed: resumed, peak: Double(self.peak))
                if resumed { self.wasShifted = false }
                let was = self.shifted
                self.shifted = step.shifted; self.peak = CGFloat(step.peak)
                guard step.shifted else { return }
                if step.event == .grew { self.onShift?(x, sv.isDragging || sv.isDecelerating, false) }
                if !was, step.event == .new {
                    self.shifts += 1
                    self.onShift?(x, sv.isDragging || sv.isDecelerating, true)
                    if self.shifts & (self.shifts - 1) == 0 {
                        ChatView.trace("side offset \(Int(x.rounded()))" + (off ? " (left)" : ", put back") + ", shift \(self.shifts)")
                    }
                }
                guard !off else { return }
                // kosmos#7420 (Josh 10-29 11:40, build 16 or 17: "jumping back and forth horizontal ... every few seconds and
                // sometime multiple times a second"): put back 0.35 s later, a cause that keeps shifting the chat was drawn
                // shifted, then back, then shifted again. With nobody scrolling it goes back now, inside this same change, so
                // a shift made by the frame's last layout is not drawn. Only under the id anchor (iOS 17+), where the move to the newest message is not
                // animated: on iOS 16 that move is often animated, and writing the offset under it could stop it partway.
                // Known and accepted: an animated scroll the app starts (a status-bar tap to the top) is neither a drag nor
                // a fling, so a shift landing during one is written at once too, which may end that scroll early.
                // Review 1: one write at a time. If the write does not land at rest (something answers it with another
                // shift inside the same change), the nested call does not write again: it falls to the delayed put-back.
                // Review 2: at most 4 immediate writes per 0.35 s window (8 across a window edge). A cause that shifts it again on every layout would
                // otherwise trade writes with it each pass; past the cap it gets the delayed put-back, the old behaviour.
                if ChatView.idAnchor, !sv.isDragging, !sv.isDecelerating, !self.writing, self.quick < 4 {
                    if self.quick == 0 {
                        let mine = self.generation
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
                            if let self, self.generation == mine { self.quick = 0 }
                        }
                    }
                    self.quick += 1
                    self.writing = true
                    defer { self.writing = false }
                    sv.contentOffset = CGPoint(x: -sv.adjustedContentInset.left, y: sv.contentOffset.y)
                    return
                }
                guard !self.fixing else { return }
                self.fixing = true
                self.putBack(sv)
            }
        }
    }
}

struct PositionById: ViewModifier {
    let on: Bool
    @Binding var id: String?
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 17.0, *), on { content.scrollPosition(id: $id, anchor: .bottom) } else { content }
    }
}

