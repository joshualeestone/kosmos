import Foundation
import ImageIO
#if DEBUG && canImport(UIKit)
import UIKit   // the sample chats draw their file pictures (Debug only)
#endif

// kosmos#6838 slice 1: the native connection to the person's Mac. The decisions
// live in BoardLogic.swift (tested); this file only moves bytes and publishes state
// for AgentsView. The app's environment (BoardClient+App.swift) is a private session
// (cookies, cache and credentials in memory, never the web view's) that follows no
// redirect, so the Kosmos+ session and a handoff token only ever go to the host they
// were addressed to. The Mac's session cookie alone is kept between launches, in the
// Keychain (Board.SavedMacSession). ios/LogicTests drives this loop with a fake Mac.
@MainActor
final class BoardClient: ObservableObject {

    enum Phase: Equatable {
        case starting
        case signedOut
        case noMac
        case waitingForAllow(mac: String, code: String?)
        // The Mac's gate refused a sign-in, which it also does for a while after it starts; asked again shortly.
        case connecting(mac: String)
        case denied(mac: String)
        case kosmosPlusDown
        // Kosmos+ itself refused (a 403 on the Mac list or the handoff): not something the Mac's Allow fixes.
        case kosmosPlusRefused
        case unreachable(mac: String)
        // The Mac's gate answered but would not take this iPhone's sign-in (neither waiting for Allow nor denied).
        case macRefused(mac: String)
        // kosmos#4903: a Kosmos cloud machine, which takes only a recent sign-in, and this one is not.
        case signInAgain(mac: String)
        // Review 5: a cloud machine opens only for an iPhone that proved its own key, which only signing in here in the app
        // keeps (relay gate.rs NO_KEY); a sign-in on the web page never does, however recent.
        case signInHere(mac: String)
        // Review 3: the computer is not taking new sign-ins right now; nothing is wrong with this one. `because` is its own
        // sentence when it gave one.
        case macHeld(mac: String, because: String?)
        case live(mac: Board.Mac)
    }

    // What the client needs from the world, so ios/LogicTests can drive the loop with a fake Mac, clock and waits.
    struct Environment {
        // nil when no answer came at all (no network, a timeout).
        var send: (URLRequest) async -> (Data, HTTPURLResponse)?
        var sleep: (TimeInterval) async -> Void
        var now: () -> Date
        var defaults: UserDefaults
        // Where an opened file is saved for Quick Look (#7016): the app's temporary folder, which iOS clears, and a
        // folder of their own in ios/LogicTests so they never touch this Mac's.
        var files: URL = FileManager.default.temporaryDirectory.appendingPathComponent("chat-files", isDirectory: true)
        // kosmos#7071: a request whose body is the file on disk at that address, read as it goes (never held in
        // memory: a file may be 100 MB). nil when no answer came.
        var upload: (URLRequest, URL) async -> (Data, HTTPURLResponse)? = { _, _ in nil }
        // Where picked files are copied before they are sent (a folder of their own per file, removed once sent).
        var uploads: URL = FileManager.default.temporaryDirectory.appendingPathComponent("chat-uploads", isDirectory: true)
        // kosmos#7337: this iPhone's device key (#7042's, from the sign-in), proved at each computer's gate. nil: none,
        // and the session is sent as before.
        var deviceKey: () -> SignIn.DeviceKey? = { nil }
    }

    @Published private(set) var phase: Phase = .starting
    @Published private(set) var agents: [Board.Agent] = []
    @Published private(set) var updatedAt: Date?
    // Counts the re-sorts applied (appear, pull to refresh). Today re-takes its held order on this, never on any
    // update: a live read landing during a pull carries the old order and the old stars.
    @Published private(set) var sortEpoch = 0
    // True once the shown list was read in this run (after the tab appears or the app returns); until then the list
    // is from an earlier read and is drawn as not current.
    @Published private(set) var fresh = false
    // Who the shown list belongs to (a fingerprint of the Kosmos+ session it was read under).
    private var shownOwner: String?
    // Agent pictures by session name, fetched through this client's own session (the board's route needs it).
    @Published private(set) var pictures: [String: Data] = [:]
    private var pictureVersions: [String: String] = [:]
    // The list is re-sorted when it appears and on pull to refresh; live updates keep the order (Mona's spec).
    private var resortNext = true
    // The first read that may apply the re-sort asked for: an older one, still in the air, may not.
    private var resortFrom = 0
    // #7034: the person's starred agents as last read from a Mac, by its address. Read when the list is re-sorted; an
    // answer that cannot be read keeps the last ones, and one Mac's stars never order another's list.
    private var stars: (mac: String, names: Set<String>)?
    // The stars of the Mac the shown list came from (Today orders its Needs you cards by them).
    var shownStars: Set<String>? { stars?.mac == shownMac?.address ? stars?.names : nil }
    // kosmos#7034: starring from the phone. The star shows and the row moves at once, as on the board; the board's answer
    // (the whole saved list) then decides, and a star that did not save goes back, with the board's own words why. One
    // save at a time per agent: a second press while one is out waits for nothing and is ignored.
    @Published private(set) var starNote: String?
    // build 11 review 2: the agent the note is about, so a chat says it only for that agent.
    @Published private(set) var starNoteAgent: String?
    @Published private(set) var starring: Set<String> = []
    // Review 1: every star press is numbered. A re-sort's own stars read that began before a press (or lands while one is
    // out) is not taken, or it would put back the list from before the press; and an answer older than the newest
    // press changes only its own agent, never the whole list.
    private var starWrites = 0
    // Review 2: bumped when a press starts AND when it ends, so a read that began while a press was out is not taken
    // either (the board may have answered it before applying the press).
    private var starEvents = 0
    func isStarred(_ session: String) -> Bool { shownStars?.contains(session) == true }
    // build 11 review 1: a press is offered only once this computer's stars have been read. Before that the star would
    // show an outline for a starred agent, and a press would build on an empty list (a failed save would leave it so).
    var canStar: Bool { shownMac != nil && shownStars != nil }
    // build 11 review 2: a chat opened before the stars were read (from a notification, or after a failed read) asks
    // once, so its star appears instead of waiting for the Agents list's next re-sort. Taken only if no press began or
    // ended meanwhile, as a re-sort's read is.
    private var readingStars = false   // review 3: one such read at a time
    func readStarsIfUnknown() async {
        guard shownStars == nil, !readingStars, let mac = shownMac else { return }
        readingStars = true
        defer { readingStars = false }
        let epoch = chatEpoch, events = starEvents
        let answer = await throughMac { Board.starsRequest(mac: $0) }
        guard epoch == chatEpoch, shownMac?.address == mac.address, shownStars == nil, starsReadStillGood(since: events),
              let answer, (200...299).contains(answer.1.statusCode), let names = Board.parseStars(answer.0) else { return }
        showStars(names, mac: mac.address)
    }
    func toggleStar(_ session: String) async {
        guard canStar, let mac = shownMac, !starring.contains(session) else { return }   // review 2: the swipe too
        let on = !isStarred(session)
        let epoch = chatEpoch
        starWrites += 1
        starEvents += 1
        let mine = starWrites
        starring.insert(session)
        // Review 3: a press from before a computer or account switch leaves nothing behind (forgetChats cleared it).
        defer { if epoch == chatEpoch { starring.remove(session); starEvents += 1 } }
        starNote = nil
        starNoteAgent = nil
        showStars(setting: session, on: on, mac: mac.address)
        let answer = await throughMac { Board.starWriteRequest(mac: $0, name: session, on: on) }
        guard epoch == chatEpoch, shownMac?.address == mac.address else { return }   // another computer or account now
        if let answer, answer.1.statusCode == 200, let names = Board.parseStars(answer.0) {
            // The newest press's answer is the board's whole list; an older one settles only its own agent.
            if mine == starWrites && starring.count == 1 { showStars(names, mac: mac.address) }
            else { showStars(setting: session, on: names.contains(session), mac: mac.address) }
        } else {
            // Only this agent goes back; every other star stays as the phone now shows it (review 1).
            showStars(setting: session, on: !on, mac: mac.address)
            starNote = Board.starFailure(on: on, status: answer?.1.statusCode ?? 0, data: answer?.0)
            starNoteAgent = session
        }
    }
    // Whether a re-sort's stars read may be taken: no press began or ended since it began, and none is out now.
    func starsReadStillGood(since events: Int) -> Bool { events == starEvents && starring.isEmpty }
    private func showStars(setting session: String, on: Bool, mac: String) {
        let now = shownStars ?? []
        showStars(on ? now.union([session]) : now.subtracting([session]), mac: mac)
    }
    private func showStars(_ names: Set<String>, mac: String) {
        stars = (mac, names)
        agents = Board.agentOrder(agents, sort: agentSort, projects: sortProjects, stars: names)
        sortEpoch += 1   // review 1: Today re-takes its order too, so a star moves the agent there as well
    }
    func clearStarNote() { starNote = nil; starNoteAgent = nil }

    // kosmos#7421: the Agents list's order, applied where the list is re-sorted (opening it, a pull), never on a live update,
    // so rows do not move under the person's thumb. `sortProjects` is By project's key (each agent's first project).
    private(set) var agentSort: Board.AgentSort = Board.agentSortDefault
    private(set) var sortProjects: [String: String] = [:]
    // The person picked an order (or By project's names came in): the list takes it now, as on the desktop.
    func setAgentSort(_ sort: Board.AgentSort, projects: [String: String]) {
        guard sort != agentSort || projects != sortProjects else { return }
        agentSort = sort; sortProjects = projects
        agents = Board.agentOrder(agents, sort: sort, projects: projects, stars: shownStars)
    }
    // Status reads by the order they started, and the one the shown list came from.
    private var readsStarted = 0
    private var shownTicket = 0
    private var sortedTicket = 0
    // The Mac the shown list came from.
    private var shownMac: Board.Mac?
    // kosmos#7197: the name of the Mac whose list is shown, for a screen that names it while the phase does not.
    var shownMacName: String? { shownMac?.name }
    // kosmos#7266: the account's computers as Kosmos+ last listed them, for the switcher, and the one the person chose
    // there (it wins over the remembered and the most recently seen one while it is usable, Board.pickMac).
    @Published private(set) var macs: [Board.Mac] = []
    // kosmos#7266 slice B: the person on the shown computer (its "you" record and picture), for the Settings tab's
    // picture and the profile page. nil until read, and when the board has none.
    @Published private(set) var youName: String?
    @Published private(set) var youPicture: Data?
    private var youAt: Date?
    private var youPictureAt: Date?
    private var youTask: Task<Void, Never>?
    // Review 1: only the read that started last clears the handle, as the tasks read's token does.
    private var youTicket = 0
    private var chosenMac: String?
    // The computer the switcher marks: the shown list's, else the one being opened.
    var switcherShown: String? { shownMac?.address ?? admitted?.mac.address ?? chosenMac }
    // The Mac to name when the shown list or chat stops updating: the shown one first (the list and its chat are
    // its), the phase's only when no list was shown (Board.failingMacName).
    var failingMacName: String? { Board.failingMacName(shown: shownMacName, phase: phase.macName) }

    private let coordinator: URL
    private let sessionStore: SessionStore
    private let macStore: SessionStore
    private let cookies: HTTPCookieStorage
    private let env: Environment
    private var loop: Task<Void, Never>?
    // Bumped by every start and stop, so a run that was cancelled cannot write the screen afterwards.
    private var generation = 0
    // The Mac this client holds a session for and the Kosmos+ session it was opened under: a sign-out or another
    // account in the board's web tabs drops it (start()).
    private var admitted: (mac: Board.Mac, url: URL, session: String)?
    private var failedRefreshes = 0
    private var skipSaved = false
    // The Mac answers 401 for a moment after it starts, while keeping the session (kosmos-relay proxy.rs
    // KeptSession::Hold, until its 5 s account poll answers), so 401s end the session only after 15 s of them.
    private var unauthorizedSince: Date?
    // The grace is for a session that worked in this run; a kept one the Mac no longer honours is signed in again at once.
    private var listedThisRun = false
    private var retriedUnreachable = false
    private static let unauthorizedGrace: TimeInterval = 15
    private var lastReconnect: Date?
    private static let reconnectGap: TimeInterval = 30
    private static let failuresBeforeNotAnswering = 3
    // About 30 s of retries for a Mac that refuses while it starts up.
    private static let freshHandoffs = 6

    // `cookies` must be the store `env.send` uses, so forget() clears the very cookies the requests carry.
    init(coordinator: URL, sessionStore: SessionStore, macStore: SessionStore, cookies: HTTPCookieStorage, env: Environment) {
        self.coordinator = coordinator
        self.sessionStore = sessionStore
        self.macStore = macStore
        self.cookies = cookies
        // kosmos#7075: every request this client sends to the Mac says it is the board's own (Board.forMac); here, once,
        // so no call site can forget it.
        var marked = env
        marked.send = { [send = env.send] r in await send(Board.forMac(r, coordinator: coordinator)) }
        marked.upload = { [upload = env.upload] r, file in await upload(Board.forMac(r, coordinator: coordinator), file) }
        self.env = marked
        // Files opened in an earlier run are not kept: whose they were is not known any more. Nor are copies of picked
        // files an earlier run never finished sending (kosmos#7071).
        try? FileManager.default.removeItem(at: env.files)
        try? FileManager.default.removeItem(at: env.uploads)
    }

    // Starts (or resumes) the loop when the tab appears or the app comes back.
    func start() {
        loop?.cancel()
        generation += 1
        let gen = generation
        #if DEBUG
        // Screenshots only (a Debug build; Release has no such switch): KOSMOS_SAMPLE_AGENTS=1 shows invented agents
        // (the names in Mona Lisa's design) without connecting, so no real account is ever in a picture.
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" {
            // Through the real parser, as /api/status rows from a Mac that sends its words ready-made (#7004).
            // kosmos#7030: with Today's fields (the reason, the project's name, when the wait began), times relative to now.
            let iso = { (minutes: Double) in ISO8601DateFormatter().string(from: Date().addingTimeInterval(-minutes * 60)) }
            let tasks = #"{"tasks":[{"projectId":"p-cat","projectName":"Spring catalogue","number":4,"sentence":"Pages 1 to 8","state":"built","builtAt":""# + iso(20) + #"","builtBy":"dana","builtNote":"Ready for a look. The captions on page 6 are placeholders."},{"projectId":"p-site","projectName":"Website","number":11,"sentence":"Shipping page copy","state":"built","builtAt":""# + iso(95) + #"","builtByPerson":true}]}"#
            readyTasks = Board.readyTasks(Data(tasks.utf8))
            // kosmos#7031: the Tasks tab's samples, one or more in every group, through the real parser.
            let all = #"{"rosterUnreadable":false,"tasks":["# + [
                #"{"projectId":"p-cat","projectName":"Spring catalogue","number":7,"sentence":"Choose the cover photo","state":"decision","waitingOn":[{"who":"cleo","reason":"question"}],"waitingSince":""# + iso(3) + #"","createdAt":""# + iso(40) + #""}"#,
                #"{"projectId":"p-cat","projectName":"Spring catalogue","number":8,"sentence":"Pages 9 to 12","state":"working","whoNames":["dana"],"createdAt":""# + iso(30) + #""}"#,
                #"{"projectId":"p-mkt","projectName":"Market study","number":2,"sentence":"Summarise the three competitor price lists","state":"assigned","whoNames":["eli"],"createdAt":""# + iso(300) + #""}"#,
                #"{"projectId":"p-print","projectName":"Print run","projectPath":["Spring catalogue"],"number":1,"sentence":"Get two quotes from printers","state":"nobody","createdAt":""# + iso(600) + #""}"#,
                #"{"projectId":"p-cat","projectName":"Spring catalogue","number":4,"sentence":"Pages 1 to 8","state":"built","builtAt":""# + iso(20) + #"","builtBy":"dana","builtNote":"Ready for a look. The captions on page 6 are placeholders.","createdAt":""# + iso(900) + #""}"#,
                #"{"projectId":"p-site","projectName":"Website","number":12,"sentence":"Check the shop for broken links","state":"scheduled","repeat":{"every":"week"},"repeatWords":"every Monday at 9am","repeatNextWords":"Monday at 9am","lastRunAt":""# + iso(4000) + #"","lastRunBy":"farah","lastRunNote":"none found","createdAt":""# + iso(20000) + #""}"#,
                #"{"projectId":"p-site","projectName":"Website","number":9,"sentence":"New photos for the about page","state":"held","createdAt":""# + iso(30000) + #""}"#,
                #"{"projectId":"p-site","projectName":"Website","number":11,"sentence":"Shipping page copy","state":"closed","createdAt":""# + iso(40000) + #""}"#,
                #"{"projectId":"p-cat","projectName":"Spring catalogue","number":2,"sentence":"Collect last year's sales figures","state":"closed","createdAt":""# + iso(50000) + #""}"#,
            ].joined(separator: ",") + "]}"
            tasksList = Board.parseTasks(Data(all.utf8))
            let sample = #"{"counts":{"waiting":4},"agents":[{"sessionName":"cleo","name":"Cleo","role":"Project manager","state":"needs_you","dmUnread":2,"stateReportedBy":"agent","cardWord":"Question","cardTone":"asked","context":{"percent":45},"needsReason":"question","stateProjectName":"Spring catalogue","waitingSince":""# + iso(3) + #""},{"sessionName":"dana","name":"Dana","role":"Writer","state":"working","dmUnread":1,"stateProject":"springcatalogue","task":"Pages 9 to 12","cardWord":"Working","cardTone":"working","context":{"percent":72}},{"sessionName":"eli","name":"Eli","role":"Researcher","state":"needs_you","awaitingApproval":true,"cardWord":"Needs permission","cardTone":"needs_you","context":{"percent":88},"needsReason":"permission","stateProjectName":"Market study","waitingSince":""# + iso(12) + #""},{"sessionName":"farah","name":"Farah","role":"Bookkeeper","state":"idle","cardWord":"Idle","cardTone":"quiet","context":{"percent":20}},{"sessionName":"hana","name":"Hana","role":"Support","state":"auth_failed","stuckError":{"stuck":true,"state":"auth_failed"},"cardWord":"Sign-in Issue","cardTone":"needs_you","needsReason":"stuck_auth"},{"sessionName":"ivy","name":"Ivy","role":"Editor","state":"restarting","cardWord":"Switching to Opus","cardTone":"quiet"},{"sessionName":"gus","name":"Gus","role":"Social media","state":"stopped","running":false,"cardWord":"Not running","cardTone":"needs_you","needsReason":"other"}]}"#
            agents = Board.sorted(Board.parseAgents(Data(sample.utf8)) ?? [])
            waitingCount = Board.waitingCount(Data(sample.utf8))
            updatedAt = Date()
            fresh = true
            phase = .live(mac: Board.Mac(name: "Studio", address: "studio.kosmosplus.com", usable: true))
            // kosmos#7266: two computers for the switcher's shots, the second offline.
            shownMac = Board.Mac(name: "Studio", address: "studio.kosmosplus.com", usable: true)
            macs = [shownMac!, Board.Mac(name: "Laptop", address: "laptop.kosmosplus.com", usable: true, connected: false)]
            youName = "Sam Carter"   // kosmos#7266 slice B; the picture is drawn by the view (ContentView, KOSMOS_SAMPLE_YOUPIC)
            loadSampleThreads()
            return
        }
        #endif
        let session = sessionStore.load()
        // Another account (or a new sign-in) drops everything learned under the old one. No session at all is handled
        // just below, without touching the kept Mac session. The app knows an account only by its session, so a new
        // session counts as another account here, as it does for the kept Mac session (PushNotificationManager).
        if let held = admitted, let session, held.session != session { forget() }
        // The shown list is checked too, since admitted is often unset by then (after a refusal or not answering).
        if let owner = shownOwner, let session, owner != Board.owner(of: session) { forget() }
        // And the chats, whose owner outlives a read that found no session.
        if let owner = chatsOwner, let session, owner != Board.owner(of: session) { forgetChats() }
        if let session { chatsOwner = Board.owner(of: session) }
        fresh = false
        // No Kosmos+ session (signed out, or the Keychain could not be read yet): nothing from the last one is shown.
        // The kept Mac session is deleted by the sign-out itself (PushNotificationManager), not here, so a Keychain
        // that is briefly unreadable does not cost it. Nor the chats: an open one stays, with its drafts, and a
        // sign-out drops them itself (accountChanged).
        if session == nil {
            admitted = nil
            agents = []
            updatedAt = nil
            shownMac = nil
            shownOwner = nil
            macs = []
            chosenMac = nil
            forgetYou()
            pictures = [:]
            pictureVersions = [:]
            forgetToday()   // kosmos#7030: no count or tasks while signed out
            cookies.removeCookies(since: .distantPast)
        }
        let stored = macStore.load()
        // A kept Mac session from another sign-in is never used, so it is not kept either. Not while no session can
        // be read: the sign-out deletes it itself.
        if session != nil, stored != nil, Board.usableSaved(stored, session: session, coordinator: coordinator) == nil { macStore.delete() }
        // kosmos#7266 review 1: never the kept session of another computer than the one chosen in the switcher, or any later
        // start (Try again, a return to the app, as when the person goes to press Allow) would undo the choice.
        if admitted == nil, !skipSaved, let session, let saved = Board.usableSaved(stored, session: session, coordinator: coordinator),
           chosenMac == nil || saved.address == chosenMac,
           let url = Board.macURL(address: saved.address, coordinator: coordinator) {
            // The Mac's session from an earlier launch: tried first, and dropped by refresh() if the Mac has ended it.
            restoreCookie(saved.cookie, for: url)
            admitted = (Board.Mac(name: saved.name, address: saved.address, usable: true), url, session)
        }
        skipSaved = false
        unauthorizedSince = nil
        listedThisRun = false
        resortNext = true
        resortFrom = readsStarted + 1
        // The list stays up on a return to the tab, but never with nothing in it (after a sign-out or another account).
        if case .live = phase, !agents.isEmpty {} else { set(.starting, gen) }
        loop = Task { await self.run(gen) }
    }

    // Try again after a failure. After "not answering" the kept Mac session is tried again first (the Mac may only
    // have slept); after a refusal the Macs are asked for afresh, so a Mac that went away or came online counts.
    // A second Try again in a row asks Kosmos+ afresh even then, so a Mac that was retired or replaced is never stuck.
    func retry() {
        if case .unreachable = phase, !retriedUnreachable {
            retriedUnreachable = true
        } else {
            retriedUnreachable = false
            admitted = nil
            skipSaved = true
        }
        start()
    }

    // Pull to refresh: read now and re-sort. While a connect is in flight it does nothing (a restart would only begin
    // the sign-in again, and could ask the Mac for another Allow). When nothing is connected (not answering, a
    // refusal), it is a Try again.
    func refreshNow() async {
        switch phase {
        case .starting, .connecting, .waitingForAllow: return
        default: break
        }
        // A reconnect in flight under a list still shown as live (the Mac ended the session) is a connect too.
        if admitted == nil && loop != nil, case .live = phase { return }
        guard case .live = phase, let held = admitted else { retry(); return }
        resortNext = true
        resortFrom = readsStarted + 1
        let before = readsStarted
        _ = await refresh(url: held.url, mac: held.mac, generation)
        // Unless a read that started with this pull re-sorted the list, the next live update must not re-sort it under
        // the person's thumb (a read already in the air may have moved updatedAt without re-sorting).
        if sortedTicket <= before { resortNext = false }
    }

    // kosmos#7266: the switcher. Another computer: the session held for this one (and the kept one) is dropped and the
    // chosen one opened, remembered for the next launch once it lets this iPhone in. The same one again does nothing.
    func showMac(address: String) {
        guard address != switcherShown else { return }
        #if DEBUG
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" { return }
        #endif
        chosenMac = address
        admitted = nil
        skipSaved = true
        // The list before is the other computer's: it goes now, so "not answering" never names it over the chosen one
        // (failingMacName prefers the shown Mac), and its chats, pictures and Today go with it.
        agents = []
        updatedAt = nil
        shownMac = nil
        stars = nil
        pictureTask?.cancel()
        pictures = [:]
        pictureVersions = [:]
        forgetYou()
        forgetChats()
        forgetToday()
        start()
    }

    func stop() {
        loop?.cancel()
        loop = nil
        generation += 1
        // kosmos#7030 review 3: a tasks read in the air would otherwise hold off the next one after start().
        tasksTask?.cancel()
        tasksTask = nil
        // kosmos#7266 slice B review 1: a name and picture read in the air is dropped with the run, so it is not counted
        // as done: the next start reads at once instead of waiting 5 minutes with nothing shown.
        if youTask != nil { youTask?.cancel(); youTask = nil; youAt = nil; youPictureAt = nil }
    }

    // MARK: - Today (kosmos#7030)

    // Two tabs read the same list now (Agents and Today), so the loop runs while either is on screen: it starts with
    // the first and stops with the last. A plain start and stop per tab would let the tab going away stop the loop the
    // tab arriving had just started, whichever order SwiftUI reports them in.
    static let agentsViewer = "agents"
    static let todayViewer = "today"
    // kosmos#7032: the Projects tab and a room keep the connection (and the agents' names and pictures) going too.
    static let projectsViewer = "projects"
    static let tasksViewer = "tasks"   // kosmos#7031: the native Tasks tab reads the same list, every state
    private var viewers: Set<String> = []
    private var readsTasks: Bool { viewers.contains(Self.todayViewer) || viewers.contains(Self.tasksViewer) }
    func show(_ viewer: String) {
        let first = viewers.isEmpty
        viewers.insert(viewer)
        // Review 2: tasks last read longer ago than a tick are not shown as current when Today arrives (Agents can have
        // kept the loop going for a long time without reading them); unknown until the read now answers.
        let tasksTab = viewer == Self.todayViewer || viewer == Self.tasksViewer
        if tasksTab, let at = tasksAt, env.now().timeIntervalSince(at) >= Self.tasksEvery {
            readyTasks = nil; tasksFailed = false; tasksList = nil; tasksListFailed = false
        }
        if first { start() } else if tasksTab, case .live = phase, tasksTask == nil {
            // Today arriving while Agents keeps the loop going: its tasks are read now, not at the next tick.
            startTasksRead()
        }
    }
    func hide(_ viewer: String) {
        guard viewers.remove(viewer) != nil else { return }
        if viewers.isEmpty { stop() }
    }

    // counts.waiting, the board's one number (the Dock badge); nil when the person turned it off, or before a read.
    @Published private(set) var waitingCount: Int?
    // The engine's Tasks flag from the same poll (nil when the Mac does not say).
    @Published private(set) var tasksTab: Bool?
    @Published private(set) var projectsUnread: Int?
    // kosmos#7137: the board's fedShow() from the same poll: the shared-room UI is shown to this person.
    @Published private(set) var fedShown = false
    // The tasks an agent marked built, oldest first; nil until a read answers. tasksFailed: the last read did not
    // answer with tasks, which Today says in place of the section, never as zero.
    @Published private(set) var readyTasks: [Board.ReadyTask]?
    @Published private(set) var tasksFailed = false
    // kosmos#7031: the same read, every state, for the Tasks tab. An answer whose agents could not be read is still a
    // read here (Needs Your Decision says it cannot tell); tasksListFailed only when no list came back.
    @Published private(set) var tasksList: Board.TasksRead?
    @Published private(set) var tasksListFailed = false
    private var tasksAt: Date?
    private var tasksTask: Task<Void, Never>?
    static let tasksEvery: TimeInterval = 30

    // One tasks read at a time. Review 2: a read from before a reset still finishes (its generation guard stops it
    // writing), and it must not clear the handle of the read started after it, or a second read could overlap it.
    private var tasksToken = UUID()
    private func startTasksRead() {
        let token = UUID()
        tasksToken = token
        tasksTask = Task {
            await self.refreshTasks()
            if self.tasksToken == token { self.tasksTask = nil }
        }
    }

    // Another account, another Mac, signed out or refused: the count and the tasks were the old one's (review 1).
    private func forgetToday() {
        tasksTask?.cancel()
        tasksTask = nil
        waitingCount = nil
        tasksTab = nil
        projectsUnread = nil
        fedShown = false
        readyTasks = nil
        tasksFailed = false
        tasksList = nil
        tasksListFailed = false
        tasksAt = nil
    }

    func refreshTasks() async {
        guard let held = admitted else { return }
        let gen = generation
        let result = await env.send(Board.readyTasksRequest(mac: held.url))
        guard gen == generation, !Task.isCancelled else { return }
        tasksAt = env.now()
        let ok = (result?.1).map { (200...299).contains($0.statusCode) } ?? false
        if ok, let data = result?.0, let ready = Board.readyTasks(data) {
            readyTasks = ready
            tasksFailed = false
        } else {
            tasksFailed = true
            readyTasks = nil   // review 1: an old list is never shown as current after a failed read
        }
        if ok, let data = result?.0, let list = Board.parseTasks(data) {
            tasksList = list
            tasksListFailed = false
        } else {
            tasksListFailed = true
            tasksList = nil
        }
    }

    // The task's page in the board (?project=&task=, read at boot by web/index.html), on the Mac the list came from.
    func taskURL(project: String, number: Int) -> URL? {   // kosmos#7074: the native task page's info button too
        guard let mac = shownMac, let base = Board.macURL(address: mac.address, coordinator: coordinator) else { return nil }
        return Tasks.taskPageURL(board: base, project: project, number: number)
    }

    // The tapped agent's chat under Today (the same link a notification tap opens); also from a list shown as not
    // updating, which still names the Mac it came from.
    func chatURL(for agent: Board.Agent) -> URL? { chatURL(session: agent.session) }
    // kosmos#7031: by session, for a task row whose agent the roster does not list yet.
    func chatURL(session: String) -> URL? {
        guard let mac = shownMac else { return nil }
        let url = PushBridge.boardURL(fromNotification: ["address": mac.address, "session": session], coordinator: coordinator)
        return boardSectionOnce.flatMap { sec in url.flatMap { Board.withBoardSection($0, sec) } } ?? url
    }
    // kosmos#7267/#7280: the agent page's "Open on your computer's board" sets this for the one open it starts, so the
    // board lands on that section (?sec=model) instead of the conversation. Set and cleared around a single call.
    var boardSectionOnce: String?

    // MARK: - One agent's conversation (kosmos#7008)

    // Through this client's own session to the Mac it is connected to: the conversation, the Mac's own reason it gave
    // none, or no answer (not connected included).
    func thread(for session: String) async -> Board.ThreadRead {
        #if DEBUG
        if var sample = sampleThreads[session] {
            // kosmos#7265, KOSMOS_SAMPLE_GROW=1: every read of Dana's chat brings one new message and drops the oldest, as a
            // busy chat at the Mac's 200-row window does, to check that an open chat keeps its place.
            if session == "dana", ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_GROW"] == "1", let last = sample.rows.last {
                sampleGrown += 1
                let at = String(format: "2026-10-23T23:%02d:%02dZ", sampleGrown / 60 % 60, sampleGrown % 60)
                let row = Board.ChatRow(id: "grown-\(sampleGrown)", atRaw: at, at: Board.isoDate(at),
                                        text: "New message \(sampleGrown) after the window slid.", who: last.who == .agent ? .person : .agent)
                sample = Board.Thread(rows: Array(sample.rows.dropFirst()) + [row], olderCount: sample.olderCount + 1, choices: sample.choices)
                sampleThreads[session] = sample
            }
            return .thread(sample)
        }
        #endif
        guard let held = admitted, let request = Board.threadRequest(mac: held.url, session: session) else { return .noAnswer }
        let result = await env.send(request)
        return Board.readThread(status: result?.1.statusCode ?? 0, data: result?.0)
    }

    // kosmos#7032: one request through this client's own session to the Mac it is connected to, for the Projects tab and
    // a project's room (RoomStore), so they need no second session of their own. nil when not connected, when the request
    // cannot be made, or when no answer came. The caller reads the answer itself.
    // The Mac this client is connected to, for a link to its board (a room's info button); nil when not connected.
    var macURL: URL? { admitted?.url }
    // kosmos#7266 review 4: the board of the computer the switcher names, connected or not, so a + made before that
    // computer lets the phone in (or while it is offline) still targets it rather than the shared page's computer.
    var switcherURL: URL? { switcherShown.flatMap { Board.macURL(address: $0, coordinator: coordinator) } }

    func throughMac(_ build: (URL) -> URLRequest?) async -> (Data, HTTPURLResponse)? {
        guard let held = admitted, let request = build(held.url) else { return nil }
        return await env.send(request)
    }

    // Messages sent from a chat that its conversation does not hold yet, by agent, and each chat's unsent words. Kept
    // while the app runs, so neither is lost by leaving the chat (Mona Lisa's slice 3a spec).
    @Published private(set) var pending: [String: [Board.PendingSend]] = [:]
    // Not published: the chat keeps the words it is editing itself and puts them here when it goes, so typing redraws
    // only the chat, not the Agents list under it.
    var drafts: [String: String] = [:]
    // kosmos#7136: rows being sent again from this phone now (agent|at), the board's DM_RETRYING: drawn "sending…", and a
    // second tap sends nothing.
    @Published private(set) var resending: Set<String> = []
    // Published: a retry still reading counts as a send in the air, so the question's buttons are drawn off meanwhile.
    @Published private var retrying: Set<String> = []

    // `files` are the ones it carries (kosmos#7071): taken off the composer here, so they ride the bubble and a retry
    // sends them again. With no words, their names are the words, as on the board. false when nothing was sent.
    @discardableResult
    func post(_ text: String, files: [Board.Attached] = [], replyTo: String? = nil, to agent: Board.Agent) async -> Bool {
        let said = Board.sendWords(text, files: files)
        // Not while a press to this agent is in the air: one key and one paste never overlap (dmChoiceBlocksSend).
        // Not with the composer's files while another is still on its way to it: the message would go without it.
        // (Files sent again from a row are already on the Mac, and wait for nothing.)
        let fromComposer = files.contains { f in attached[agent.session]?.contains(f) == true }
        guard Board.fitsBoard(said), files.count <= Board.maxFiles, !pressing.contains(agent.session),
              !fromComposer || uploading[agent.session, default: 0] == 0 else { return false }
        let ids = Set(files.map(\.id))
        if !ids.isEmpty { attached[agent.session]?.removeAll { ids.contains($0.id) } }
        let item = Board.PendingSend(id: UUID().uuidString, text: said, at: env.now(), after: newestSeen[agent.session], files: files,
                                     replyTo: replyTo.flatMap { $0.isEmpty ? nil : $0 })
        pending[agent.session, default: []].append(item)
        await deliver(item.id, to: agent)
        return true
    }

    // MARK: Adding files (kosmos#7071, the board's attachUpload)

    // Files on the Mac waiting to go with the next message, by agent; files still on their way; and the line under the
    // composer about the last one that could not be added. Dropped with the chats (another account or Mac).
    // kosmos#7093: a project's room keeps its own under Board.roomAttachKey(project), which no agent's name can be.
    @Published private(set) var attached: [String: [Board.Attached]] = [:]
    @Published private(set) var uploading: [String: Int] = [:]
    @Published var attachLine: [String: String] = [:]

    // What was picked: a file from Files (the person's own, never removed: the client copies it first), or a photo,
    // whose name and bytes come from the picker when it has loaded them (nil: it could not be read).
    enum Pick {
        case file(URL)
        case photo(load: () async -> (name: String, data: Data)?)
    }

    // Sends one pick to the Mac for this agent's next message, counted as on its way from the moment this is called (a
    // photo can take seconds to load). `epoch` is the chats' forgetting count when it was picked: a pick made under
    // another account or Mac is never sent under this one. The client's copy is removed once sent or refused.
    func attach(_ pick: Pick, epoch: Int, to agent: Board.Agent) async {
        await attach(pick, epoch: epoch, key: agent.session, sample: Self.isSampleThread(agent.session, self)) { mac, name, type in
            Board.uploadRequest(mac: mac, session: agent.session, name: name, type: type)
        }
    }
    private static func isSampleThread(_ session: String, _ client: BoardClient) -> Bool {
        #if DEBUG
        return client.sampleThreads[session] != nil
        #else
        return false
        #endif
    }
    // Shared with a project's room (kosmos#7093, RoomStore.attach): `key` is where the files wait (an agent's name, or
    // Board.roomAttachKey), `request` the upload for the Mac's address, the file's name and type.
    func attach(_ pick: Pick, epoch: Int, key session: String, sample: Bool,
                request: (URL, String, String) -> URLRequest?) async {
        guard epoch == chatEpoch else { return }
        if let refusal = Board.uploadRefusal(size: nil, waiting: (attached[session]?.count ?? 0) + uploading[session, default: 0]) {
            attachLine[session] = refusal
            return
        }
        uploading[session, default: 0] += 1
        let root = env.uploads
        let prepared: Board.Prepared
        switch pick {
        case .file(let url):
            prepared = await Self.offMain { Board.prepareUpload(from: url, root: root) }
        case .photo(let load):
            if let (name, data) = await load() {
                prepared = await Self.offMain { Board.prepareUpload(data: data, name: name, root: root) }
            } else {
                prepared = .refused("We could not read that photo.")
            }
        }
        defer { if case .ready(let file, _, _, _) = prepared { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) } }
        // The chats were forgotten meanwhile (another account or Mac): the pick belongs to the one before.
        guard epoch == chatEpoch else { return }
        let result: Board.UploadResult
        switch prepared {
        case .refused(let why):
            result = .refused(why)
        case .ready(let file, let name, let type, let size):
            if sample {
                // The sample chats (a Debug build only): added at once, so a screenshot never shows a real Mac's file.
                result = .added(Board.Attached(id: String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(24)), name: name))
            } else if let held = admitted, let request = request(held.url, name, type) {
                let answer = await env.upload(request, file)
                result = Board.uploadResult(status: answer?.1.statusCode ?? 0, body: answer?.0, name: name, size: size)
            } else {
                result = Board.uploadResult(status: 0, body: nil, name: name, size: size)
            }
        }
        guard epoch == chatEpoch else { return }
        uploading[session] = max(0, uploading[session, default: 0] - 1)
        switch result {
        case .added(let a):
            if attached[session]?.contains(where: { $0.id == a.id }) != true { attached[session, default: []].append(a) }
        case .refused(let why):
            attachLine[session] = why
        }
    }

    // A copy can wait on Files fetching a file from the cloud for as long as that takes: on a dispatch thread, so it
    // never holds one of the few threads Swift's tasks share.
    nonisolated private static func offMain(_ work: @escaping @Sendable () -> Board.Prepared) async -> Board.Prepared {
        await withCheckedContinuation { done in
            DispatchQueue.global(qos: .userInitiated).async { done.resume(returning: work()) }
        }
    }

    // Taken off the composer. The Mac keeps the file it was sent (nothing there removes a stored one), as with the
    // board's x.
    func unattach(_ id: String, for session: String) {
        attached[session]?.removeAll { $0.id == id }
    }
    // kosmos#7093: files a room post took off the box at the press, back in front of any added since, when it did not
    // go (or may not have). The Mac still holds them, so nothing is uploaded again.
    func reattach(_ files: [Board.Attached], for key: String) {
        let have = Set((attached[key] ?? []).map(\.id))
        let back = files.filter { !have.contains($0.id) }
        if !back.isEmpty { attached[key] = back + (attached[key] ?? []) }
    }

    // Again, for one that was not taken, only while the agent is running (the spec: no retry until the status changes).
    func retry(_ id: String, to agent: Board.Agent, dropReply: Bool = false) async {
        guard !retrying.contains(id), !pressing.contains(agent.session), let i = pending[agent.session]?.firstIndex(where: { $0.id == id }),
              pending[agent.session]?[i].failed == true, isRunning(agent) else { return }
        // A second tap while this one reads or sends does nothing.
        retrying.insert(id)
        defer { retrying.remove(id) }
        // One that got no answer may have arrived: read first, and send only if the conversation does not hold it.
        // (It stays failed while reading: settle matches a failed-without-answer message by its words, never a sending one.)
        // A read that comes back after the chats were forgotten (another account or Mac) settles nothing and sends nothing.
        let epoch = chatEpoch
        if pending[agent.session]?[i].state == .failed(reason: nil) {
            let read = await thread(for: agent.session)
            guard epoch == chatEpoch else { return }
            if case .thread(let t) = read { settle(t, for: agent.session) }
        }
        guard epoch == chatEpoch, let k = pending[agent.session]?.firstIndex(where: { $0.id == id }), pending[agent.session]?[k].failed == true else { return }
        // kosmos#7083: the reply dropped only now that it goes (a refused retry above keeps it).
        if dropReply { pending[agent.session]?[k].replyTo = nil }
        pending[agent.session]?[k].state = .sending
        await deliver(id, to: agent)
    }

    // kosmos#7136: Try again on a message the Mac could not deliver, as the board's dmRetrySend: the same words into the
    // same row (retry_of), so it stays one message, and only where the board offers it (Board.failedLine). What to say
    // after, or nil when nothing was sent (not offered, already going, a press in the air, or the chats forgotten
    // meanwhile). The chat reads the conversation again after, which shows the row as it now is.
    func sendAgain(_ row: Board.ChatRow, newestMineAt: String?, to agent: Board.Agent) async -> Board.RetrySaid? {
        guard let at = row.atRaw, Board.failedLine(row, newestMineAt: newestMineAt, flying: false)?.canRetry == true,
              !pressing.contains(agent.session) else { return nil }
        let key = agent.session + "|" + at
        guard !resending.contains(key) else { return nil }
        let epoch = chatEpoch
        resending.insert(key)
        // Not after the chats were forgotten meanwhile: that emptied the set, and a new chat's mark is not this one's.
        defer { if epoch == chatEpoch { resending.remove(key) } }
        let said: Board.RetrySaid
        #if DEBUG
        if sampleThreads[agent.session] != nil { said = sampleRetry(at, to: agent.session) } else { said = await sendRetry(row.text, at: at, to: agent.session) }
        #else
        said = await sendRetry(row.text, at: at, to: agent.session)
        #endif
        return epoch == chatEpoch ? said : nil
    }

    private func sendRetry(_ text: String, at: String, to session: String) async -> Board.RetrySaid {
        guard let held = admitted, let request = Board.retryRequest(mac: held.url, session: session, text: text, retryOf: at) else {
            // Nothing was sent, so nothing is in doubt.
            return Board.RetrySaid(said: Board.sentence("we could not send it again"), refused: true)
        }
        let answer = await env.send(request)
        return Board.retryResult(status: answer?.1.statusCode ?? 0, body: answer?.0)
    }

    #if DEBUG
    // The sample chats (a Debug build only): the row goes, as the Mac would place it.
    private func sampleRetry(_ at: String, to session: String) -> Board.RetrySaid {
        guard let sample = sampleThreads[session], let i = sample.rows.firstIndex(where: { $0.atRaw == at && $0.who == .person }) else {
            return Board.RetrySaid(said: Board.sentence("there is no message of yours at that time to send again"), refused: true)
        }
        var rows = sample.rows
        rows[i].notSent = nil; rows[i].because = nil; rows[i].resendable = false; rows[i].retryable = false
        sampleThreads[session] = Board.Thread(rows: rows, olderCount: sample.olderCount, choices: sample.choices)
        return Board.RetrySaid(said: "Sent.", refused: false)
    }
    #endif

    func isSendingAgain(_ row: Board.ChatRow, for session: String) -> Bool { row.atRaw.map { resending.contains(session + "|" + $0) } ?? false }

    // A failed reply sent again without its reply (kosmos#7083): the Mac refuses one whose original has gone, and says to
    // send it as a new message.
    func retryWithoutReply(_ id: String, to agent: Board.Agent) async {
        guard let i = pending[agent.session]?.firstIndex(where: { $0.id == id }), pending[agent.session]?[i].failed == true else { return }
        await retry(id, to: agent, dropReply: true)
    }

    // MARK: Reacting (kosmos#7083, the board's DM reactions #3650)

    // Toggles the person's reaction on one of the agent's messages, named by its `at`. The answer carries that message's
    // fresh pills, so the chat repaints the one row; the next read confirms it.
    func react(_ emoji: String, at: String, to agent: Board.Agent) async -> Board.ReactResult {
        #if DEBUG
        if let sample = sampleThreads[agent.session] {
            // The sample chats (a Debug build only): toggled in memory, as the Mac would.
            guard let i = sample.rows.firstIndex(where: { $0.atRaw == at && $0.who == .agent }) else { return .refused("there is no message from this agent at that time to react to") }
            var rows = sample.rows
            let had = rows[i].reactions.contains { $0.emoji == emoji }
            rows[i].reactions = had ? rows[i].reactions.filter { $0.emoji != emoji } : rows[i].reactions + [Board.ChatReaction(emoji: emoji, count: 1, mine: true)]
            sampleThreads[agent.session] = Board.Thread(rows: rows, olderCount: sample.olderCount, choices: sample.choices)
            return .reacted(at: at, pills: rows[i].reactions)
        }
        #endif
        guard let held = admitted, let request = Board.reactRequest(mac: held.url, session: agent.session, at: at, emoji: emoji) else {
            return .refused("We could not react to that just now.")
        }
        let answer = await env.send(request)
        return Board.reactResult(status: answer?.1.statusCode ?? 0, body: answer?.0)
    }

    // MARK: Answering a question (kosmos#7016, the board's dmChoicePress)

    // Agents with a press in the air: their buttons are drawn off, and a typed send waits.
    @Published private(set) var pressing: Set<String> = []
    // The last press that may have gone, per agent: for 6 s (the board's DM_CHOICE_ANSWERED_MS) the same question's
    // buttons stay off, so a quick second press cannot answer twice while the next read still shows the old screen.
    struct Answered: Equatable { let key: String; let at: Date; let sure: Bool; let n: Int }
    @Published private(set) var answered: [String: Answered] = [:]
    static let answeredLock: TimeInterval = 6

    // nil when nothing was pressed (one already in the air, a typed send in the air, or the chats were forgotten meanwhile).
    func press(_ option: Board.ChoiceOption, of choices: Board.Choices, to agent: Board.Agent) async -> Board.PressResult? {
        guard !pressing.contains(agent.session), !isSending(agent.session) else { return nil }
        let epoch = chatEpoch
        pressing.insert(agent.session)
        answered[agent.session] = nil
        let result: Board.PressResult
        #if DEBUG
        if sampleThreads[agent.session] != nil { result = samplePress(option, to: agent.session) } else { result = await sendPress(option, choices, agent.session) }
        #else
        result = await sendPress(option, choices, agent.session)
        #endif
        // A reset meanwhile (another account or Mac) already emptied this; the answer belongs to the chat before.
        guard epoch == chatEpoch else { return nil }
        pressing.remove(agent.session)
        if result.mayHaveSent { answered[agent.session] = Answered(key: choices.key, at: env.now(), sure: result == .sent, n: option.n) }
        return result
    }

    private func sendPress(_ option: Board.ChoiceOption, _ choices: Board.Choices, _ session: String) async -> Board.PressResult {
        // Not connected: nothing was sent, so the buttons come back.
        guard let held = admitted,
              let request = Board.pressRequest(mac: held.url, session: session, option: option, asked: choices.asked, request: choices.request)
        else { return .refused(Shell.macUnreachableTitle(shownMacName) + ". Try again in a moment.") }   // kosmos#7197: named
        let answer = await env.send(request)
        return Board.pressResult(status: answer?.1.statusCode ?? 0, body: answer?.0)
    }

    // MARK: Earlier messages (kosmos#7016 part 3)

    // A page of earlier messages ending before `before`; nil when the chats were forgotten meanwhile (the page belongs
    // to the chat before).
    func olderPage(_ session: String, before: Int) async -> Board.OlderRead? {
        let epoch = chatEpoch
        #if DEBUG
        if let sample = sampleOlder(session, before: before) { return sample }
        #endif
        guard let held = admitted, let request = Board.olderRequest(mac: held.url, session: session, before: before) else {
            return .failed(Board.olderFailed)
        }
        let answer = await env.send(request)
        guard epoch == chatEpoch else { return nil }
        return Board.readOlder(status: answer?.1.statusCode ?? 0, data: answer?.0, before: before)
    }

    // MARK: Files (kosmos#7016 part 2)

    // First-page pictures for file cards, by attachment id: drawn small (192 px) once, never the file itself (an image's
    // preview route answers with the whole image), fetched once per run, nothing kept on disk.
    @Published private(set) var thumbnails: [String: Data] = [:]
    private var thumbnailAsked: Set<String> = []

    func loadThumbnail(_ a: Board.Attachment) async {
        guard Board.hasThumbnail(a), let path = a.preview, !thumbnailAsked.contains(a.id) else { return }
        thumbnailAsked.insert(a.id)
        #if DEBUG && canImport(UIKit)
        if let sample = sampleThumbnail(a) { thumbnails[a.id] = sample; return }
        #endif
        let epoch = chatEpoch
        guard let held = admitted, let request = Board.attachmentRequest(mac: held.url, path: path) else { thumbnailAsked.remove(a.id); return }
        let answer = await env.send(request)
        // After a reset the asked set is the new chat's: leave it alone.
        guard epoch == chatEpoch else { return }
        guard let (data, response) = answer else { thumbnailAsked.remove(a.id); return }
        let isImage = (response.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased().hasPrefix("image/")
        let ok = (200...299).contains(response.statusCode)
        if ok, isImage { if let small = Self.smallPicture(data) { thumbnails[a.id] = small } }
        // A passing failure (a 5xx, or the gate's sign-in page in place of a picture) is asked again on the next draw.
        // A 404, or a picture the phone cannot draw (an SVG, say), is not: it would be downloaded again on every scroll.
        else if response.statusCode >= 500 || (ok && !isImage) { thumbnailAsked.remove(a.id) }
    }

    // A picture drawn at most 192 px on its longer side (a 64 pt square at @3x), as PNG; nil for bytes that are not a picture.
    static func smallPicture(_ data: Data) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 192,
                kCGImageSourceCreateThumbnailWithTransform: true,
              ] as CFDictionary) else { return nil }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, nil)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }

    // The file, fetched from the Mac and saved where Quick Look can open it; nil when it could not be fetched.
    func fetchFile(_ a: Board.Attachment) async -> URL? {
        // A web page or markup document is never fetched to open here (Board.isWebDocument).
        guard !Board.isWebDocument(name: a.name, type: a.type) else { return nil }
        let epoch = chatEpoch
        #if DEBUG
        if let sample = sampleFile(a) { return sample }
        #endif
        guard let held = admitted, let request = Board.attachmentRequest(mac: held.url, path: a.url),
              let (data, answer) = await env.send(request), epoch == chatEpoch,
              (200...299).contains(answer.statusCode) else { return nil }
        // Never a page: the gate's sign-in page can stand in for the file, and a web page in Quick Look could load
        // from elsewhere. An agent's own HTML file is opened on the board.
        let answered = ((answer.value(forHTTPHeaderField: "Content-Type") ?? "").split(separator: ";").first.map(String.init) ?? "")
            .trimmingCharacters(in: .whitespaces)
        if answered.lowercased().hasPrefix("text/html") || Board.isWebDocument(name: "", type: answered) { return nil }
        let folder = env.files.appendingPathComponent(a.id, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            // The name written is savedName's, the same one isWebDocument judged before the fetch.
            let file = folder.appendingPathComponent(Board.savedName(a.name, type: a.type))
            // Encrypted while the phone is locked. macOS refuses the option (ios/LogicTests run there), so iOS only.
            #if os(iOS)
            try data.write(to: file, options: [.atomic, .completeFileProtection])
            #else
            try data.write(to: file, options: [.atomic])
            #endif
            return file
        } catch { return nil }
    }

    // Quick Look closed: the file it showed goes (opened again, it is fetched again).
    func closed(_ file: URL) {
        // Only a file's own folder inside the files folder, never the files folder itself or anything outside it.
        let folder = file.deletingLastPathComponent().standardizedFileURL
        guard folder.deletingLastPathComponent().path == env.files.standardizedFileURL.path else { return }
        try? FileManager.default.removeItem(at: folder)
    }

    // The answered lock for this question, while it lasts.
    func answeredNow(_ session: String, key: String) -> Answered? {
        guard let a = answered[session], a.key == key, env.now().timeIntervalSince(a.at) < Self.answeredLock else { return nil }
        return a
    }

    // A typed send in the air: one sending, or a retry still reading before it sends.
    func isSending(_ session: String) -> Bool {
        // kosmos#7136: a Try again on a kept row is a send in the air too (it types into the same window).
        pending[session]?.contains { $0.state == .sending || retrying.contains($0.id) } == true
            || resending.contains { $0.hasPrefix(session + "|") }
    }

    // What the chats hold belongs to one account on one Mac: dropped when either changes, so nothing typed or failed
    // under one is shown, or sent, under another.
    // A sign-out, or a sign-in as someone else, reported by the web view (PushNotificationManager.accountChanges).
    // The loop is stopped first, so a read in flight under the old account cannot write its list back afterwards, and
    // started again if it was running, under whoever is signed in now.
    func accountChanged() {
        let running = loop != nil
        stop()
        forget()
        if running { start() }
    }

    // Who the chats belong to (a fingerprint of the Kosmos+ session they were made under).
    private var chatsOwner: String?

    // Another Mac keeps chatsOwner (the account has not changed); forget() clears it.
    private func forgetChats() {
        starNote = nil   // kosmos#7034: a star note was about the other computer's list
        starring = []   // kosmos#7034 review 3: a save still out was for the other computer; its answer is dropped
        pending = [:]
        sortProjects = [:]   // kosmos#7421: By project's names were the other computer's or account's
        pressing = []
        answered = [:]
        thumbnails = [:]
        thumbnailAsked = []
        // Files opened under the account or Mac before are not left on the phone.
        try? FileManager.default.removeItem(at: env.files)
        drafts = [:]
        attached = [:]
        uploading = [:]
        attachLine = [:]
        // Picked files still waiting to go are not left on the phone either.
        try? FileManager.default.removeItem(at: env.uploads)
        resending = []
        newestSeen = [:]
        // An open chat is showing what was forgotten: it resets when this moves (ChatView, AgentsView).
        chatEpoch += 1
    }

    func discard(_ id: String, for session: String) {
        pending[session]?.removeAll { $0.id == id }
    }

    // The newest row time each chat has shown, and the count of forgettings (sign-out, another account or Mac).
    private var newestSeen: [String: String] = [:]
    @Published private(set) var chatEpoch = 0
    #if DEBUG
    private var sampleGrown = 0   // kosmos#7265: KOSMOS_SAMPLE_GROW's new messages so far
    #endif

    // A read of the conversation: the pending messages it now holds stop being shown as pending (Board.settled).
    func settle(_ thread: Board.Thread, for session: String) {
        if let newest = thread.rows.compactMap({ r in r.atRaw.flatMap { raw in Board.isoDate(raw).map { (raw, $0) } } }).max(by: { $0.1 < $1.1 }) {
            newestSeen[session] = newest.0
        }
        guard let list = pending[session], !list.isEmpty else { return }
        let left = Board.settled(list, with: thread)
        if left != list { pending[session] = left }
    }

    func isRunning(_ agent: Board.Agent) -> Bool {
        (agents.first { $0.session == agent.session } ?? agent).running
    }

    private func deliver(_ id: String, to agent: Board.Agent) async {
        guard let item = pending[agent.session]?.first(where: { $0.id == id }) else { return }
        let result: Board.SendResult
        #if DEBUG
        if sampleThreads[agent.session] != nil {
            result = sampleSend(item.text, files: item.files, replyTo: item.replyTo, to: agent.session)
        } else {
            result = await send(item.text, files: item.files, replyTo: item.replyTo, to: agent.session)
        }
        #else
        result = await send(item.text, files: item.files, replyTo: item.replyTo, to: agent.session)
        #endif
        guard let i = pending[agent.session]?.firstIndex(where: { $0.id == id }) else { return }
        pending[agent.session]?[i].state = Board.pendingState(after: result)
    }

    private func send(_ text: String, files: [Board.Attached], replyTo: String?, to session: String) async -> Board.SendResult {
        guard let held = admitted else { return .noAnswer }
        guard let request = Board.sendRequest(mac: held.url, session: session, text: text, attachments: files.map(\.id), replyTo: replyTo) else { return .refused(nil) }
        let result = await env.send(request)
        return Board.sendResult(status: result?.1.statusCode ?? 0, body: result?.0)
    }

    #if DEBUG
    // The sample chats (KOSMOS_SAMPLE_AGENTS=1, a Debug build only): Mona Lisa's 19 October design conversation.
    private var sampleThreads: [String: Board.Thread] = [:]
    private func sampleSend(_ text: String, files: [Board.Attached], replyTo: String?, to session: String) -> Board.SendResult {
        guard let sample = sampleThreads[session] else { return .noAnswer }
        let at = ISO8601DateFormatter().string(from: env.now())
        var row = Board.ChatRow(id: "sample-\(sample.rows.count)", atRaw: at, at: env.now(), text: text, who: .person)
        row.replyTo = replyTo
        row.attachments = files.map { Board.Attachment(id: $0.id, name: $0.name, type: "", size: nil, kind: "other",
                                                       url: "/api/attachment/" + $0.id, preview: nil) }
        sampleThreads[session] = Board.Thread(rows: sample.rows + [row], olderCount: sample.olderCount)
        return .kept(at: at)
    }
    // KOSMOS_SAMPLE_CHOICE=answered|unsure: the question as just answered (or maybe answered), held for an hour so a screenshot can catch it.
    func sampleAnswer(_ session: String, key: String, n: Int, sure: Bool) {
        answered[session] = Answered(key: key, at: env.now().addingTimeInterval(3600 - Self.answeredLock), sure: sure, n: n)
    }
    // A press in the sample chats: the question goes, as the Mac's next read would say (KOSMOS_SAMPLE_PRESS=unsure
    // shows the not-sure line instead).
    private func samplePress(_ option: Board.ChoiceOption, to session: String) -> Board.PressResult {
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_PRESS"] == "unsure" { return .notSure(Board.choiceUnsure) }
        if let t = sampleThreads[session] {
            sampleThreads[session] = Board.Thread(rows: t.rows.filter { $0.wayThrough != .question && $0.wayThrough != .permission },
                                                  olderCount: t.olderCount)
        }
        return .sent
    }
    #if DEBUG && canImport(UIKit)
    // The sample chats' files, drawn here so no real file is ever in a picture.
    private func sampleThumbnail(_ a: Board.Attachment) -> Data? {
        guard sampleThreads.values.contains(where: { $0.rows.contains { $0.attachments.contains(a) } }) else { return nil }
        let size = CGSize(width: 128, height: 128)
        return UIGraphicsImageRenderer(size: size).pngData { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(origin: .zero, size: size))
            UIColor(white: 0.2, alpha: 1).setFill(); ctx.fill(CGRect(x: 16, y: 18, width: 70, height: 9))
            UIColor(white: 0.75, alpha: 1).setFill()
            for i in 0..<7 { ctx.fill(CGRect(x: 16, y: 40 + i * 11, width: i % 3 == 2 ? 60 : 96, height: 5)) }
        }
    }
    #endif
    private func sampleFile(_ a: Board.Attachment) -> URL? {
        guard sampleThreads.values.contains(where: { $0.rows.contains { $0.attachments.contains(a) } }) else { return nil }
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_FILE"] == "fail" { return nil }
        let folder = env.files.appendingPathComponent(a.id, isDirectory: true)
        let file = folder.appendingPathComponent("sample-" + Board.savedName(a.name) + ".txt")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? Data("A sample file (Debug build), standing in for \(a.name).".utf8).write(to: file)
        return file
    }
    // Cleo's earlier messages in the sample (ChatView's KOSMOS_SAMPLE_OLDER=loading|failed sets the line for the shots).
    private func sampleOlder(_ session: String, before: Int) -> Board.OlderRead? {
        guard session == "cleo" || session == "dana", sampleThreads[session] != nil else { return nil }
        // Dana's earlier page ends on the same day as her latest messages (a page cut mid-day, review 6). Built in typed
        // steps: CI's Xcode 26.6 cannot type-check this as one dictionary literal.
        let day: String = session == "dana" ? "2026-10-23" : "2026-10-20"
        let firstHour: Int = session == "dana" ? 6 : 8
        var rows: [[String: Any]] = []
        for i in 0..<before {
            let at: String = day + "T" + String(format: "%02d:%02d:00Z", firstHour + i / 60, i % 60)
            let text: String = i % 3 == 0 ? "Checking the venue list, item \(i + 1)." : "Noted."
            let from: Any = i % 2 == 0 ? "cleo" : NSNull()
            rows.append(["at": at, "text": text, "from": from])
        }
        let data = try? JSONSerialization.data(withJSONObject: ["messages": rows, "olderCount": 0])
        return Board.readOlder(status: 200, data: data, before: before)
    }
    private func loadSampleThreads() {
        let json = #"{"messages":[{"at":"2026-10-23T13:32:00Z","text":"Morning Dana. How is the catalogue copy coming along?","from":null,"delivery":{"state":"placed"}},{"at":"2026-10-23T13:33:00Z","text":"Pages 1 to 8 are written and checked against the price sheet.","from":"dana"},{"at":"2026-10-23T13:34:00Z","text":"Great. What is left?","from":null,"delivery":{"state":"placed"}},{"at":"2026-10-23T13:35:00Z","text":"Pages 9 to 12 need the new photos before I can caption them. The shoot is on Thursday, so I will have the full draft to you on Friday morning.","from":"dana"}],"olderCount":0,"question":null}"#
        if var t = Board.parseThread(Data(json.utf8)) {
            // kosmos#7083, KOSMOS_SAMPLE_REPLY=1: a reaction on Dana's first message and the person's reply to it.
            if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_REPLY"] == "1", let i = t.rows.firstIndex(where: { $0.who == .agent }), let at = t.rows[i].atRaw {
                var rows = t.rows
                rows[i].reactions = [Board.ChatReaction(emoji: "\u{1F44D}", count: 1, mine: true)]
                var answer = Board.ChatRow(id: "sample-reply", atRaw: "2026-10-23T13:34:30Z", at: Board.isoDate("2026-10-23T13:34:30Z"),
                                           text: "Perfect. Captions next, please.", who: .person)
                answer.replyTo = at
                rows.insert(answer, at: i + 1)
                t = Board.Thread(rows: rows, olderCount: t.olderCount, choices: t.choices)
            }
            sampleThreads["dana"] = t
        }
        // KOSMOS_SAMPLE_LONG=1: Dana's chat is 220 messages with 40 before them, to check that opening a long chat lands on
        // the newest message and loads nothing until the person scrolls up.
        // kosmos#7265: KOSMOS_SAMPLE_LONG=varied makes the messages' lengths vary as a real chat's do (one line to a long
        // reply), which is what throws a one-time jump to the newest message short.
        if let long = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_LONG"], long == "1" || long == "varied" {
            var rows: [[String: Any]] = []
            let para = "Here is where things stand on the catalogue, with the parts that are done and the parts still waiting on photos and prices."
            for i in 0..<220 {
                let at: String = String(format: "2026-10-23T%02d:%02d:00Z", 8 + i / 60, i % 60)
                let from: Any = i % 2 == 0 ? "dana" : NSNull()
                var text = "Message \(i + 41) of 260."
                if long == "varied" && i % 2 == 0 {
                    let paragraphs = [0, 1, 3, 8, 2, 14][i / 2 % 6]
                    if paragraphs > 0 { text += "\n\n" + Array(repeating: para, count: paragraphs).joined(separator: "\n\n") }
                }
                rows.append(["at": at, "text": text, "from": from])
            }
            if let data = try? JSONSerialization.data(withJSONObject: ["messages": rows, "olderCount": 40]),
               let t = Board.parseThread(data) { sampleThreads["dana"] = t }
        }
        // Cleo's shows the way-through rows: older messages, a file, Kosmos's own line and a question.
        let cleo = #"{"messages":[{"at":"2026-10-22T16:10:00Z","text":"Here is the launch checklist we agreed.","from":"cleo","attachments":[{"id":"5a6d0c1e2f3a4b5c6d7e8f90","name":"Launch checklist.pdf","type":"application/pdf","size":2516582,"kind":"pdf","url":"/api/attachment/5a6d0c1e2f3a4b5c6d7e8f90","preview":"/api/attachment/5a6d0c1e2f3a4b5c6d7e8f90/preview"},{"id":"5a6d0c1e2f3a4b5c6d7e8f91","name":"Press release draft.docx","type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","size":48211,"kind":"other","url":"/api/attachment/5a6d0c1e2f3a4b5c6d7e8f91","preview":null}]},{"at":"2026-10-22T16:12:00Z","text":"Thanks, I will read it tonight.","from":null,"delivery":{"state":"placed"}},{"at":"2026-10-23T14:00:00Z","text":"Cleo paused for today's limit. It picks up again at 4:00.","from":null,"kind":"kosmos"},{"at":"2026-10-23T14:05:00Z","text":"Should the launch email go out on Tuesday or Wednesday?","from":"cleo","kind":"question"}],"olderCount":12,"question":{"text":"Should the launch email go out on Tuesday or Wednesday?"},"asking":true,"asked":"Should the launch email go out on Tuesday or Wednesday?","presence":"on","options":[{"n":1,"label":"Tuesday"},{"n":2,"label":"Wednesday"},{"n":3,"label":"Tuesday, and do not ask again for launch emails","lasting":true}]}"#
        if let t = Board.parseThread(Data(cleo.utf8)) { sampleThreads["cleo"] = t }
        // Eli's shows a permission prompt (#7016): a command that deletes files, with a lasting choice under Show details.
        let eli = #"{"messages":[{"at":"2026-10-23T14:20:00Z","text":"The export folder still holds last week's files.","from":"eli"},{"at":null,"text":"Do you want to proceed?","from":"eli","kind":"question","permission":{"kind":"delete","title":"Bash command","says":"Clear last week's export before the new one","target":"rm -rf exports/2026-10-16","detail":"Bash command\n\n  rm -rf exports/2026-10-16\n  Clear last week's export before the new one","reason":"Commands that delete files always ask first.","allow":1,"deny":3}}],"olderCount":0,"question":{"text":"Do you want to proceed?"},"asking":true,"asked":"Do you want to proceed?","presence":"on","options":[{"n":1,"label":"Yes"},{"n":2,"label":"Yes, and don't ask again for rm commands in this folder","lasting":true},{"n":3,"label":"No, and tell Claude what to do differently"}]}"#
        if let t = Board.parseThread(Data(eli.utf8)) { sampleThreads["eli"] = t }
        // KOSMOS_SAMPLE_NOT_SENT=1: one message in Dana's chat that was not taken, for the not-sent screenshot.
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOT_SENT"] == "1" {
            pending["dana"] = [Board.PendingSend(id: "sample-failed", text: "Can you send me pages 1 to 8 now?", at: env.now(),
                                                 state: .failed(reason: nil))]
        }
        // KOSMOS_SAMPLE_ATTACHED=1 (kosmos#7071): two files waiting on Dana's composer, one on its way, and a message of
        // files only still sending, for the screenshots (nothing on the build Mac can tap the picker).
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_ATTACHED"] == "1" {
            attached["dana"] = [Board.Attached(id: "00000000000000000000000a", name: "Catalogue pages 1-8.pdf"),
                                Board.Attached(id: "00000000000000000000000b", name: "Photo 2026-10-24 at 18.30.05.jpg")]
            uploading["dana"] = 1
            let sent = [Board.Attached(id: "00000000000000000000000c", name: "Cover draft.png")]
            pending["dana", default: []].append(Board.PendingSend(id: "sample-files", text: Board.sendWords("", files: sent), at: env.now(), files: sent))
        }
    }
    #endif

    // Pictures for agents that have one and whose version changed, one at a time. A Mac that has no picture (404) is
    // not asked again until the version changes; the letter shows meanwhile.
    private var pictureTask: Task<Void, Never>?
    private var pictureFailures: [String: Int] = [:]
    private func fetchPictures(url: URL, _ gen: Int) async {
        for agent in agents where agent.hasAvatar && pictureVersions[agent.session] != agent.avatarVer {
            guard let request = Board.avatarRequest(mac: url, session: agent.session) else { continue }
            let result = await env.send(request)
            guard gen == generation, !Task.isCancelled else { return }
            guard let (data, answer) = result else { continue }   // no answer: tried again on the next read
            let isImage = (answer.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased().hasPrefix("image/")
            if (200...299).contains(answer.statusCode) && isImage && !data.isEmpty {
                pictures[agent.session] = data
                pictureVersions[agent.session] = agent.avatarVer
            } else if answer.statusCode == 404 {
                // The Mac has no picture for it: not asked again until the version changes.
                pictureVersions[agent.session] = agent.avatarVer
            } else {
                // Anything else (the gate's sign-in page, a 5xx) is tried again on the next read, three times per
                // version, then left until the version changes, so a failing route is not asked every 5 s.
                let key = agent.session + "#" + agent.avatarVer
                pictureFailures[key, default: 0] += 1
                if pictureFailures[key, default: 0] >= 3 { pictureVersions[agent.session] = agent.avatarVer }
            }
        }
    }

    // kosmos#7266 slice B. A read that fails keeps what was shown (review 4: and is tried again after youRetry).
    private func fetchYou(url: URL, _ gen: Int, name: Bool) async {
        if name { await fetchYouName(url: url, gen) }
        guard gen == generation, !Task.isCancelled else { return }
        // Review 1: the picture on the first read and then every 30 minutes (it is the big one).
        guard youPictureAt.map({ env.now().timeIntervalSince($0) >= Board.youPictureEvery }) ?? true else { return }
        youPictureAt = env.now()
        let pic = await env.send(Board.youPictureRequest(mac: url))
        guard gen == generation, !Task.isCancelled else { return }
        switch Board.youPicture(status: pic?.1.statusCode, contentType: pic?.1.value(forHTTPHeaderField: "Content-Type"), data: pic?.0) {
        case .picture(let data): youPicture = data
        case .none: youPicture = nil
        case .unknown: youPictureAt = env.now().addingTimeInterval(Board.youRetry - Board.youPictureEvery)
        }
    }

    private func fetchYouName(url: URL, _ gen: Int) async {
        let named = await env.send(Board.youRequest(mac: url))
        guard gen == generation, !Task.isCancelled else { return }
        var learned = false
        if let (data, answer) = named, (200...299).contains(answer.statusCode) {
            switch Board.youName(data) {
            case .name(let n): youName = n; learned = true
            case .none: youName = nil; learned = true
            case .unknown: break
            }
        } else if named?.1.statusCode == 404 {
            // Review 5: an older board without the route has no name to give (the picture read reads its 404 as none).
            // Review 6: counted as learned (no 30 s retry), but unlike the picture the name shown is kept, in case something
            // else answered 404 (a computer or account switch clears it anyway).
            learned = true
        }
        // Review 4: nothing learned, so the next read comes after youRetry rather than youEvery.
        if !learned { youAt = env.now().addingTimeInterval(Board.youRetry - Board.youEvery) }
    }

    // Another computer, another account or a sign-out: the person's name and picture are that computer's own.
    private func forgetYou() {
        youTask?.cancel(); youTask = nil
        youAt = nil; youPictureAt = nil; youName = nil; youPicture = nil
    }

    // Everything learned under the previous Kosmos+ session goes, cookies and the kept Mac session included.
    private func forget() {
        forgetChats()
        chatsOwner = nil
        admitted = nil
        shownMac = nil
        macs = []          // kosmos#7266: another account's computers are never offered
        chosenMac = nil
        forgetYou()
        shownOwner = nil
        pictureTask?.cancel()
        pictures = [:]
        pictureVersions = [:]
        agents = []
        stars = nil
        updatedAt = nil
        forgetToday()   // kosmos#7030: another account's count and tasks are never shown
        env.defaults.removeObject(forKey: Board.rememberedMacKey)
        cookies.removeCookies(since: .distantPast)
        macStore.delete()
    }

    private func set(_ p: Phase, _ gen: Int) {
        if gen == generation { phase = p }
    }

    private var restoredCookie: String?

    private func restoreCookie(_ value: String, for url: URL) {
        restoredCookie = value
        guard let host = url.host, let cookie = HTTPCookie(properties: [
            .name: Board.macCookieName, .value: value, .domain: host, .path: "/", .secure: "TRUE",
        ]) else { return }
        cookies.setCookie(cookie)
    }

    // Keeps the Mac's current session cookie. If the gate's own Set-Cookie and a restored one ever sit side by side in
    // the jar, the one that is not the restored (ended) value is kept and the others are removed, so only one is sent.
    private func keepMacSession(_ mac: Board.Mac, url: URL, session: String) {
        // Not after a sign-out or another sign-in meanwhile: the record belongs to the session it was opened under.
        guard sessionStore.load() == session else { return }
        let named = (cookies.cookies(for: url) ?? []).filter { $0.name == Board.macCookieName }
        let current = named.count > 1 ? (named.first { $0.value != restoredCookie } ?? named.last) : named.first
        for other in named where other !== current { cookies.deleteCookie(other) }
        guard let value = current?.value,
              let record = Board.encode(Board.SavedMacSession(name: mac.name, address: mac.address, cookie: value, owner: Board.owner(of: session)))
        else { return }
        macStore.save(record)
    }

    private func run(_ gen: Int) async {
        if admitted == nil {
            guard let session = sessionStore.load() else { set(.signedOut, gen); return }
            guard let mac = await chooseMac(session: session, gen), gen == generation else { return }
            guard let url = Board.macURL(address: mac.address, coordinator: coordinator) else { set(.noMac, gen); return }
            guard await openSession(session: session, mac: mac, url: url, gen), gen == generation else {
                // A list is still on screen marked not answering: keep trying behind it, so it clears by itself.
                if case .unreachable = phase, !agents.isEmpty, gen == generation {
                    await env.sleep(15)
                    if gen == generation { start() }
                }
                return
            }
            admitted = (mac, url, session)
            keepMacSession(mac, url: url, session: session)
            env.defaults.set(mac.address, forKey: Board.rememberedMacKey)
        }
        guard let (mac, url, held) = admitted else { return }
        // kosmos#7266 review 2: a run that restored the kept session never asked Kosmos+ for the Macs, so the switcher
        // had nothing to list on the common launch. Asked here in the background while the list is empty, without
        // touching the session. Known: online and offline in the list are as of the last read (a switch, a Try again
        // that asks afresh, or a new launch reads it again).
        if macs.isEmpty && macsReadGen != gen {
            macsReadGen = gen
            Task { await self.readMacs(session: held, gen) }
        }
        // Another Mac: its agents' pictures are its own, even for an agent of the same name.
        // Another Mac: its pictures and the chats (opened on the one before) go now, before any chat call reaches it.
        if let shown = shownMac, shown.address != mac.address { pictures = [:]; pictureVersions = [:]; forgetYou(); forgetChats(); forgetToday() }
        failedRefreshes = 0
        while !Task.isCancelled && gen == generation {
            guard await refresh(url: url, mac: mac, gen) else { return }
            await env.sleep(5)   // the board page polls /api/status every 5 s too
        }
    }

    // An answer from Kosmos+ that is not a success: a 401 is a sign-out, a 403 a refusal of this iPhone, anything
    // else (no answer, a 5xx, a 429) Kosmos+ being unreachable for now.
    private func kosmosPlusFailed(status: Int, _ gen: Int) {
        guard gen == generation else { return }
        if status == 401 {
            // The Kosmos+ session is dead, so the Mac session kept under it is useless: forgotten with it.
            macStore.delete()
            cookies.removeCookies(since: .distantPast)
            forgetToday()   // kosmos#7030: a dead session's badge and tasks are not shown under "Sign in"
            set(.signedOut, gen)
        }
        else if status == 403 { forgetToday(); set(.kosmosPlusRefused, gen) }
        else { set(.kosmosPlusDown, gen) }
    }

    // The run that last asked for the Macs (chooseMac asks too, when it runs).
    private var macsReadGen = -1
    // The switcher's list only: a failure here changes nothing on screen (the shown computer is already open).
    private func readMacs(session: String, _ gen: Int) async {
        let result = await env.send(Board.macsRequest(coordinator: coordinator, session: session))
        guard gen == generation, let (data, answer) = result, (200...299).contains(answer.statusCode),
              let macs = Board.parseMacs(data) else { return }
        self.macs = Board.reachableMacs(macs, coordinator: coordinator)
    }

    private func chooseMac(session: String, _ gen: Int) async -> Board.Mac? {
        let result = await env.send(Board.macsRequest(coordinator: coordinator, session: session))
        let status = result?.1.statusCode ?? 0
        guard (200...299).contains(status), let data = result?.0, let macs = Board.parseMacs(data) else {
            kosmosPlusFailed(status: status, gen); return nil
        }
        // Review 1: a list that lands after a sign-out or another start is not this run's to show.
        guard gen == generation else { return nil }
        self.macs = Board.reachableMacs(macs, coordinator: coordinator)
        macsReadGen = gen
        guard let mac = Board.pickMac(self.macs, remembered: env.defaults.string(forKey: Board.rememberedMacKey),
                                      chosen: chosenMac) else {
            set(.noMac, gen); return nil
        }
        return mac
    }

    // nil when it failed, with the phase already set to say why.
    private func handoff(session: String, mac: Board.Mac, _ gen: Int) async -> String? {
        let result = await env.send(Board.handoffRequest(coordinator: coordinator, session: session, address: mac.address,
                                                         fresh: mac.hosted))
        let status = result?.1.statusCode ?? 0
        guard (200...299).contains(status), let data = result?.0, let token = Board.parseHandoffToken(data) else {
            if mac.hosted, status == 403, Board.isStepUpRequired(result?.0) {
                if gen == generation { set(.signInAgain(mac: mac.name), gen) }
                return nil
            }
            kosmosPlusFailed(status: status, gen); return nil
        }
        return token
    }

    // A handoff token from Kosmos+, then the Mac's gate. While the Mac shows Allow it asks again every 3 s, rides
    // out a slow network, and fetches a new handoff when the old one is refused (it expires during a long wait, and
    // a Mac that has just started refuses for a while), up to six times (about 30 s) in a row.
    private func openSession(session: String, mac: Board.Mac, url: URL, _ gen: Int) async -> Bool {
        guard gen == generation, var token = await handoff(session: session, mac: mac, gen) else { return false }
        var waiting = false
        var fresh = 0
        var misses = 0
        var resigned = 0
        let key = env.deviceKey()   // read once per connect, not on every 3 s Allow poll
        while !Task.isCancelled && gen == generation {
            var proof: Board.GateProof? = nil
            switch await gateProof(url: url, token: token, key: key) {
            case .proof(let p): proof = p
            case .unproven: break
            case .miss:
                // kosmos#7337: the gate page's miss (no nonce now): counted as a session that got no answer, and no post.
                // A re-sign run it interrupts starts again (as gate.html resets reSigned on any other answer).
                resigned = 0
                guard gen == generation else { return false }
                misses += 1
                if misses < 3 { await env.sleep(3); continue }
                set(.unreachable(mac: mac.name), gen); return false
            }
            guard gen == generation else { return false }
            let result = await env.send(Board.sessionRequest(mac: url, handoffToken: token, proof: proof))
            let status = result?.1.statusCode ?? 0
            if status == 0 {
                // No answer at all: a few are a slow network or a Mac just waking; three in a row (as the gate page counts
                // them) say the Mac is not answering, with Try again. kosmos#7197: before the Mac had said "waiting" too,
                // where ONE miss used to say it (Josh, 10-26 08:29, with that Mac answering minutes later).
                misses += 1
                if misses < 3 { await env.sleep(3); continue }
                set(.unreachable(mac: mac.name), gen); return false
            }
            let answer = Board.classifySession(status: status, body: result?.0, waiting: waiting)
            // A busy gate and a run of re-signs are misses of their own; any other answer means the gate is answering.
            if answer != .busy && answer != .resign { misses = 0 }
            if answer != .resign { resigned = 0 }
            switch answer {
            case .admitted:
                return true
            case .pending(let code):
                waiting = true
                fresh = 0
                set(.waitingForAllow(mac: mac.name, code: code), gen)
                await env.sleep(3)
            case .retry:
                await env.sleep(3)
            case .busy:
                misses += 1
                if misses >= 3 { set(.unreachable(mac: mac.name), gen); return false }
                await env.sleep(3)
            case .resign:
                // kosmos#7337: a spent nonce, or a hosted box that has just allowed this key: sign again with a new nonce
                // shortly, five times in a row at most (as gate.html), then counted as a miss, so a gate that never stops
                // answering it ends at "not answering" rather than "Connecting" for ever.
                resigned += 1
                if resigned <= 5 { await env.sleep(0.3); continue }
                resigned = 0
                misses += 1
                if misses >= 3 { set(.unreachable(mac: mac.name), gen); return false }
                await env.sleep(3)
            case .denied:
                set(.denied(mac: mac.name), gen); return false
            case .held(let because):
                set(.macHeld(mac: mac.name, because: because), gen); return false
            case .refused:
                // Review 4: a cloud machine refuses a sign-in that proved no key (relay gate.rs NO_KEY), and no fresh
                // handoff cures that: only signing in here again, natively, which keeps a key. Said at once, not after
                // six more handoffs.
                if mac.hosted && proof == nil { set(.signInHere(mac: mac.name), gen); return false }
                // Refused handoffs are retried a few times: one expires during a long wait for Allow, and a Mac that
                // has just started refuses until it knows its account again (gate.rs ACCOUNT_NOT_KNOWN_YET).
                guard fresh < Self.freshHandoffs else {
                    // Logged for the first runs on a phone: this is where the plan's weakest premise would show. Only
                    // the status: the Mac's own words are not written to the device log.
                    NSLog("[Board] the Mac's gate refused the sign-in (\(status))")
                    set(.macRefused(mac: mac.name), gen); return false
                }
                fresh += 1
                if !waiting { set(.connecting(mac: mac.name), gen) }
                await env.sleep(5)
                guard gen == generation else { return false }
                guard let next = await handoff(session: session, mac: mac, gen) else { return false }
                token = next
            }
        }
        return false
    }

    // kosmos#7337: what one session request carries. `unproven` sends the token alone, as before: no key, a key that
    // cannot sign, or a gate that has no nonce route (an older tunnel: a 404, or a 200 page that is not a nonce).
    // `miss` is the gate page's miss: no answer, or a gate that would not give a nonce now (busy, full, starting).
    private enum ProofOutcome { case proof(Board.GateProof), unproven, miss }

    private func gateProof(url: URL, token: String, key: SignIn.DeviceKey?) async -> ProofOutcome {
        guard let key, let host = url.host?.lowercased() else { return .unproven }   // the gate signs location.hostname
        guard let (data, answer) = await env.send(Board.nonceRequest(mac: url)) else { return .miss }
        // A gate that would give a nonce but not now (refused for now, too many waiting, busy) is a miss, as gate.html;
        // any other refusal of the route (404, or an older gate's 401 or 405) means it has none: the token alone.
        let status = answer.statusCode
        if status == 400 || status == 403 || status == 429 || status >= 500 { return .miss }   // review 4: 400 (no client address) too
        guard (200...299).contains(status) else { return .unproven }
        guard let nonce = Board.parseNonce(data) else { return .unproven }
        return Board.gateProof(host: host, nonce: nonce, token: token, key: key).map { .proof($0) } ?? .unproven
    }

    // #7034: the person's stars on this Mac, or nil when they cannot be read.
    private func readStars(url: URL, if wanted: Bool) async -> Set<String>? {
        guard wanted, let result = await env.send(Board.starsRequest(mac: url)), (200...299).contains(result.1.statusCode)
        else { return nil }
        return Board.parseStars(result.0)
    }

    // false ends the loop. 401s for 15 s (at once if no list was read in this run), or the gate's sign-in page in place of the board's answer, mean the Mac's
    // session ended: sign in to it again, at most once every 30 s. Three refreshes in a row with no list (no answer, a 5xx,
    // a redirect, an answer that is not the list) say the Mac is not answering rather than leave an old list up.
    // The list shows as current only after a refresh that read it. A re-sort reads the stars beside the list; an answer
    // that cannot be read keeps the last ones from the same Mac.
    private func refresh(url: URL, mac: Board.Mac, _ gen: Int) async -> Bool {
        readsStarted += 1
        let ticket = readsStarted
        // Taken when the read starts: a pull sets it while another read may already be in the air.
        let resort = resortNext
        let starEventsAtStart = starEvents   // kosmos#7034 review 1 and 2
        async let starsRead = readStars(url: url, if: resort)
        let result = await env.send(Board.statusRequest(mac: url))
        let names = await starsRead
        guard gen == generation else { return false }
        // A read that was cancelled (a pull to refresh SwiftUI dropped) says nothing about the Mac.
        if Task.isCancelled { return true }
        let answer = result?.1
        let status = answer?.statusCode ?? 0
        if (200...299).contains(status), let data = result?.0, let rows = Board.parseAgents(data) {
            // A read that started before the list now shown answers older rows: they are not put back over it.
            guard ticket > shownTicket else { return true }
            shownTicket = ticket
            // A read that started wanting a re-sort applies one only while it is still wanted: a pull that ended
            // without one has withdrawn it.
            let sorting = resort && resortNext && ticket >= resortFrom
            // Stars are taken only with the re-sort they were read for, so Today never orders by stars the list is not.
            if sorting, let names, starsReadStillGood(since: starEventsAtStart) { stars = (mac.address, names) }   // kosmos#7034 review 1: never undo a press
            let known = stars?.mac == mac.address ? stars?.names : nil
            agents = sorting ? Board.agentOrder(rows, sort: agentSort, projects: sortProjects, stars: known) : Board.keepingOrder(agents, with: rows, stars: known, sort: agentSort, projects: sortProjects)
            waitingCount = Board.waitingCount(data)   // kosmos#7030: the Today tab's badge, the Dock's number
            tasksTab = AppTabs.tasksTab(fromStatus: data)   // kosmos#7032: Tasks earned, with no board page loaded
            projectsUnread = AppTabs.projectsUnread(fromStatus: data)     // kosmos#7032: the Projects tab's badge
            fedShown = Board.fedShown(fromStatus: data)   // kosmos#7137: the shared-room UI, as the board's fedShow()
            if sorting { resortNext = false; sortedTicket = ticket; sortEpoch += 1 }
            updatedAt = env.now()
            failedRefreshes = 0
            unauthorizedSince = nil
            // The first list in a run (re)keeps the Mac's session, so a kept record dropped while the Mac was away is
            // restored once it answers again.
            if !listedThisRun, let held = admitted { keepMacSession(mac, url: url, session: held.session) }
            listedThisRun = true
            shownMac = mac
            fresh = true
            if let held = admitted { shownOwner = Board.owner(of: held.session) }
            retriedUnreachable = false
            set(.live(mac: mac), gen)
            // Pictures load on their own, never holding up the next status read; one batch at a time, never cancelled
            // by the next read (a cancelled fetch must not count as a failed one).
            if pictureTask == nil {
                pictureTask = Task { await self.fetchPictures(url: url, gen); self.pictureTask = nil }
            }
            // kosmos#7266 slice B: the person's name and picture, on the first list and then every 5 minutes.
            // Review 4: the picture has its own due time, so a picture read that learned nothing is retried on its own.
            let nameDue = youAt.map({ env.now().timeIntervalSince($0) >= Board.youEvery }) ?? true
            let pictureDue = youPictureAt.map({ env.now().timeIntervalSince($0) >= Board.youPictureEvery }) ?? true
            if youTask == nil, nameDue || pictureDue {
                if nameDue { youAt = env.now() }
                youTicket += 1
                let ticket = youTicket
                youTask = Task { await self.fetchYou(url: url, gen, name: nameDue); if self.youTicket == ticket { self.youTask = nil } }
            }
            // kosmos#7030: the tasks Today shows, read only while Today is on screen, at most every 30 s (the board's Tasks
            // view read is not cheap); pull to refresh reads them at once.
            if readsTasks, tasksTask == nil, tasksAt.map({ env.now().timeIntervalSince($0) >= Self.tasksEvery }) ?? true {
                startTasksRead()
            }
            return true
        }
        if Board.sessionEnded(status: status, contentType: answer?.value(forHTTPHeaderField: "Content-Type")) {
            if status == 401 {
                let since = unauthorizedSince ?? env.now()
                unauthorizedSince = since
                if listedThisRun && env.now().timeIntervalSince(since) < Self.unauthorizedGrace { return true }
            }
            unauthorizedSince = nil
            admitted = nil
            // The session has ended, so its kept record is dead and is never restored again (not even by a Try again).
            macStore.delete()
            if let last = lastReconnect, env.now().timeIntervalSince(last) < Self.reconnectGap {
                // The Mac ended this iPhone's session twice in 30 s: it answers, but will not keep the sign-in.
                set(.macRefused(mac: mac.name), gen)
                return false
            }
            lastReconnect = env.now()
            // A fresh sign-in, never the kept record: that is the session that just ended. Its cookie stays in the
            // jar, so the gate forgets the old session when it admits the new one (proxy.rs `replaced`).
            skipSaved = true
            start()
            return false
        }
        failedRefreshes += 1
        if failedRefreshes >= Self.failuresBeforeNotAnswering {
            // A kept session that never produced a list in this run is not kept: the next launch asks Kosmos+ which
            // Mac to use, rather than restoring one that may be gone.
            if !listedThisRun { macStore.delete() }
            // Not answering, said once; the loop keeps reading, so the next good read clears it by itself (a Mac back
            // from sleep needs no Try again).
            set(.unreachable(mac: mac.name), gen)
        }
        return true
    }
}

// kosmos#7197: the Mac a phase is about, by name (its address label, as Kosmos+ lists it), or nil.
extension BoardClient.Phase {
    var macName: String? {
        switch self {
        case .waitingForAllow(let mac, _), .connecting(let mac), .denied(let mac), .unreachable(let mac), .macRefused(let mac),
             .signInAgain(let mac), .signInHere(let mac), .macHeld(let mac, _):
            return mac
        case .live(let mac):
            return mac.name
        case .starting, .signedOut, .noMac, .kosmosPlusDown, .kosmosPlusRefused:
            return nil
        }
    }
}
