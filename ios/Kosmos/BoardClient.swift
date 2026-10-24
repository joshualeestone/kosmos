import Foundation

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
        case live(mac: Board.Mac)
    }

    // What the client needs from the world, so ios/LogicTests can drive the loop with a fake Mac, clock and waits.
    struct Environment {
        // nil when no answer came at all (no network, a timeout).
        var send: (URLRequest) async -> (Data, HTTPURLResponse)?
        var sleep: (TimeInterval) async -> Void
        var now: () -> Date
        var defaults: UserDefaults
    }

    @Published private(set) var phase: Phase = .starting
    @Published private(set) var agents: [Board.Agent] = []
    @Published private(set) var updatedAt: Date?
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
    // The Mac the shown list came from.
    private var shownMac: Board.Mac?

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
        self.env = env
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
            let sample = #"{"agents":[{"sessionName":"cleo","name":"Cleo","role":"Project manager","state":"needs_you","stateReportedBy":"agent","cardWord":"Question","cardTone":"asked"},{"sessionName":"dana","name":"Dana","role":"Writer","state":"working","task":"Pages 9 to 12","cardWord":"Working","cardTone":"working"},{"sessionName":"eli","name":"Eli","role":"Researcher","state":"needs_you","cardWord":"Question","cardTone":"asked"},{"sessionName":"farah","name":"Farah","role":"Bookkeeper","state":"idle","cardWord":"Idle","cardTone":"quiet"},{"sessionName":"hana","name":"Hana","role":"Support","state":"auth_failed","cardWord":"Sign-in Issue","cardTone":"needs_you"},{"sessionName":"ivy","name":"Ivy","role":"Editor","state":"restarting","cardWord":"Switching to Opus","cardTone":"quiet"},{"sessionName":"gus","name":"Gus","role":"Social media","state":"stopped","running":false,"cardWord":"Not running","cardTone":"needs_you"}]}"#
            agents = Board.sorted(Board.parseAgents(Data(sample.utf8)) ?? [])
            updatedAt = Date()
            fresh = true
            phase = .live(mac: Board.Mac(name: "Studio", address: "studio.kosmosplus.com", usable: true))
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
            pictures = [:]
            pictureVersions = [:]
            cookies.removeCookies(since: .distantPast)
        }
        let stored = macStore.load()
        // A kept Mac session from another sign-in is never used, so it is not kept either. Not while no session can
        // be read: the sign-out deletes it itself.
        if session != nil, stored != nil, Board.usableSaved(stored, session: session, coordinator: coordinator) == nil { macStore.delete() }
        if admitted == nil, !skipSaved, let session, let saved = Board.usableSaved(stored, session: session, coordinator: coordinator),
           let url = Board.macURL(address: saved.address, coordinator: coordinator) {
            // The Mac's session from an earlier launch: tried first, and dropped by refresh() if the Mac has ended it.
            restoreCookie(saved.cookie, for: url)
            admitted = (Board.Mac(name: saved.name, address: saved.address, usable: true), url, session)
        }
        skipSaved = false
        unauthorizedSince = nil
        listedThisRun = false
        resortNext = true
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
        let before = updatedAt
        _ = await refresh(url: held.url, mac: held.mac, generation)
        // A refresh that read nothing must not leave the next live update to re-sort under the person's thumb.
        if updatedAt == before { resortNext = false }
    }

    func stop() {
        loop?.cancel()
        loop = nil
        generation += 1
    }

    // The tapped agent's chat under Today (the same link a notification tap opens); also from a list shown as not
    // updating, which still names the Mac it came from.
    func chatURL(for agent: Board.Agent) -> URL? {
        guard let mac = shownMac else { return nil }
        return PushBridge.boardURL(fromNotification: ["address": mac.address, "session": agent.session], coordinator: coordinator)
    }

    // MARK: - One agent's conversation (kosmos#7008)

    // Through this client's own session to the Mac it is connected to: the conversation, the Mac's own reason it gave
    // none, or no answer (not connected included).
    func thread(for session: String) async -> Board.ThreadRead {
        #if DEBUG
        if let sample = sampleThreads[session] { return .thread(sample) }
        #endif
        guard let held = admitted, let request = Board.threadRequest(mac: held.url, session: session) else { return .noAnswer }
        let result = await env.send(request)
        return Board.readThread(status: result?.1.statusCode ?? 0, data: result?.0)
    }

    // Messages sent from a chat that its conversation does not hold yet, by agent, and each chat's unsent words. Kept
    // while the app runs, so neither is lost by leaving the chat (Mona Lisa's slice 3a spec).
    @Published private(set) var pending: [String: [Board.PendingSend]] = [:]
    // Not published: the chat keeps the words it is editing itself and puts them here when it goes, so typing redraws
    // only the chat, not the Agents list under it.
    var drafts: [String: String] = [:]
    // Rows of the person's the Mac kept as not sent that were already sent again, so a second tap sends nothing.
    @Published private(set) var resent: Set<String> = []
    // Published: a retry still reading counts as a send in the air, so the question's buttons are drawn off meanwhile.
    @Published private var retrying: Set<String> = []

    func post(_ text: String, to agent: Board.Agent) async {
        let said = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // Not while a press to this agent is in the air: one key and one paste never overlap (dmChoiceBlocksSend).
        guard Board.fitsBoard(said), !pressing.contains(agent.session) else { return }
        let item = Board.PendingSend(id: UUID().uuidString, text: said, at: env.now(), after: newestSeen[agent.session])
        pending[agent.session, default: []].append(item)
        await deliver(item.id, to: agent)
    }

    // Again, for one that was not taken, only while the agent is running (the spec: no retry until the status changes).
    func retry(_ id: String, to agent: Board.Agent) async {
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
        pending[agent.session]?[k].state = .sending
        await deliver(id, to: agent)
    }

    // A message of the person's the Mac kept as not sent: sent again as a new message, once.
    func sendAgain(_ row: Board.ChatRow, to agent: Board.Agent) async {
        let key = agent.session + "|" + row.id
        // Not while a press is in the air: post would refuse it, and the row would read as sent again.
        guard row.canSendAgain, isRunning(agent), !resent.contains(key), Board.fitsBoard(row.text), !pressing.contains(agent.session) else { return }
        resent.insert(key)
        await post(row.text, to: agent)
    }

    func wasSentAgain(_ row: Board.ChatRow, for session: String) -> Bool { resent.contains(session + "|" + row.id) }

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
        guard let held = admitted, let request = Board.pressRequest(mac: held.url, session: session, option: option, asked: choices.asked)
        else { return .refused("Your Mac isn't answering. Try again in a moment.") }
        let answer = await env.send(request)
        return Board.pressResult(status: answer?.1.statusCode ?? 0, body: answer?.0)
    }

    // The answered lock for this question, while it lasts.
    func answeredNow(_ session: String, key: String) -> Answered? {
        guard let a = answered[session], a.key == key, env.now().timeIntervalSince(a.at) < Self.answeredLock else { return nil }
        return a
    }

    // A typed send in the air: one sending, or a retry still reading before it sends.
    func isSending(_ session: String) -> Bool {
        pending[session]?.contains { $0.state == .sending || retrying.contains($0.id) } == true
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
        pending = [:]
        pressing = []
        answered = [:]
        drafts = [:]
        resent = []
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
            result = sampleSend(item.text, to: agent.session)
        } else {
            result = await send(item.text, to: agent.session)
        }
        #else
        result = await send(item.text, to: agent.session)
        #endif
        guard let i = pending[agent.session]?.firstIndex(where: { $0.id == id }) else { return }
        pending[agent.session]?[i].state = Board.pendingState(after: result)
    }

    private func send(_ text: String, to session: String) async -> Board.SendResult {
        guard let held = admitted else { return .noAnswer }
        guard let request = Board.sendRequest(mac: held.url, session: session, text: text) else { return .refused(nil) }
        let result = await env.send(request)
        return Board.sendResult(status: result?.1.statusCode ?? 0, body: result?.0)
    }

    #if DEBUG
    // The sample chats (KOSMOS_SAMPLE_AGENTS=1, a Debug build only): Mona Lisa's 19 October design conversation.
    private var sampleThreads: [String: Board.Thread] = [:]
    private func sampleSend(_ text: String, to session: String) -> Board.SendResult {
        guard let sample = sampleThreads[session] else { return .noAnswer }
        let at = ISO8601DateFormatter().string(from: env.now())
        let row = Board.ChatRow(id: "sample-\(sample.rows.count)", atRaw: at, at: env.now(), text: text, who: .person)
        sampleThreads[session] = Board.Thread(rows: sample.rows + [row], olderCount: sample.olderCount)
        return .kept(at: at)
    }
    // KOSMOS_SAMPLE_CHOICE=answered: the question as just answered, held for an hour so a screenshot can catch it.
    func sampleAnswer(_ session: String, key: String, n: Int) {
        answered[session] = Answered(key: key, at: env.now().addingTimeInterval(3600 - Self.answeredLock), sure: true, n: n)
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
    private func loadSampleThreads() {
        let json = #"{"messages":[{"at":"2026-10-23T13:32:00Z","text":"Morning Dana. How is the catalogue copy coming along?","from":null,"delivery":{"state":"placed"}},{"at":"2026-10-23T13:33:00Z","text":"Pages 1 to 8 are written and checked against the price sheet.","from":"dana"},{"at":"2026-10-23T13:34:00Z","text":"Great. What is left?","from":null,"delivery":{"state":"placed"}},{"at":"2026-10-23T13:35:00Z","text":"Pages 9 to 12 need the new photos before I can caption them. The shoot is on Thursday, so I will have the full draft to you on Friday morning.","from":"dana"}],"olderCount":0,"question":null}"#
        if let t = Board.parseThread(Data(json.utf8)) { sampleThreads["dana"] = t }
        // Cleo's shows the way-through rows: older messages, a file, Kosmos's own line and a question.
        let cleo = #"{"messages":[{"at":"2026-10-22T16:10:00Z","text":"Here is the launch checklist we agreed.","from":"cleo","attachment":{"id":"a1","name":"checklist.pdf"}},{"at":"2026-10-22T16:12:00Z","text":"Thanks, I will read it tonight.","from":null,"delivery":{"state":"placed"}},{"at":"2026-10-23T14:00:00Z","text":"Cleo paused for today's limit. It picks up again at 4:00.","from":null,"kind":"kosmos"},{"at":"2026-10-23T14:05:00Z","text":"Should the launch email go out on Tuesday or Wednesday?","from":"cleo","kind":"question"}],"olderCount":12,"question":{"text":"Should the launch email go out on Tuesday or Wednesday?"},"asking":true,"asked":"Should the launch email go out on Tuesday or Wednesday?","presence":"on","options":[{"n":1,"label":"Tuesday"},{"n":2,"label":"Wednesday"},{"n":3,"label":"Tuesday, and do not ask again for launch emails","lasting":true}]}"#
        if let t = Board.parseThread(Data(cleo.utf8)) { sampleThreads["cleo"] = t }
        // Eli's shows a permission prompt (#7016): a command that deletes files, with a lasting choice under Show details.
        let eli = #"{"messages":[{"at":"2026-10-23T14:20:00Z","text":"The export folder still holds last week's files.","from":"eli"},{"at":null,"text":"Do you want to proceed?","from":"eli","kind":"question","permission":{"kind":"delete","title":"Bash command","says":"Clear last week's export before the new one","target":"rm -rf exports/2026-10-16","detail":"Bash command\n\n  rm -rf exports/2026-10-16\n  Clear last week's export before the new one","reason":"Commands that delete files always ask first.","allow":1,"deny":3}}],"olderCount":0,"question":{"text":"Do you want to proceed?"},"asking":true,"asked":"Do you want to proceed?","presence":"on","options":[{"n":1,"label":"Yes"},{"n":2,"label":"Yes, and don't ask again for rm commands in this folder","lasting":true},{"n":3,"label":"No, and tell Claude what to do differently"}]}"#
        if let t = Board.parseThread(Data(eli.utf8)) { sampleThreads["eli"] = t }
        // KOSMOS_SAMPLE_NOT_SENT=1: one message in Dana's chat that was not taken, for the not-sent screenshot.
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOT_SENT"] == "1" {
            pending["dana"] = [Board.PendingSend(id: "sample-failed", text: "Can you send me pages 1 to 8 now?", at: env.now(),
                                                 state: .failed(reason: nil))]
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

    // Everything learned under the previous Kosmos+ session goes, cookies and the kept Mac session included.
    private func forget() {
        forgetChats()
        chatsOwner = nil
        admitted = nil
        shownMac = nil
        shownOwner = nil
        pictureTask?.cancel()
        pictures = [:]
        pictureVersions = [:]
        agents = []
        updatedAt = nil
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
        guard let (mac, url, _) = admitted else { return }
        // Another Mac: its agents' pictures are its own, even for an agent of the same name.
        // Another Mac: its pictures and the chats (opened on the one before) go now, before any chat call reaches it.
        if let shown = shownMac, shown.address != mac.address { pictures = [:]; pictureVersions = [:]; forgetChats() }
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
            set(.signedOut, gen)
        }
        else if status == 403 { set(.kosmosPlusRefused, gen) }
        else { set(.kosmosPlusDown, gen) }
    }

    private func chooseMac(session: String, _ gen: Int) async -> Board.Mac? {
        let result = await env.send(Board.macsRequest(coordinator: coordinator, session: session))
        let status = result?.1.statusCode ?? 0
        guard (200...299).contains(status), let data = result?.0, let macs = Board.parseMacs(data) else {
            kosmosPlusFailed(status: status, gen); return nil
        }
        guard let mac = Board.pickMac(Board.reachableMacs(macs, coordinator: coordinator),
                                      remembered: env.defaults.string(forKey: Board.rememberedMacKey)) else {
            set(.noMac, gen); return nil
        }
        return mac
    }

    // nil when it failed, with the phase already set to say why.
    private func handoff(session: String, mac: Board.Mac, _ gen: Int) async -> String? {
        let result = await env.send(Board.handoffRequest(coordinator: coordinator, session: session, address: mac.address))
        let status = result?.1.statusCode ?? 0
        guard (200...299).contains(status), let data = result?.0, let token = Board.parseHandoffToken(data) else {
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
        while !Task.isCancelled && gen == generation {
            let result = await env.send(Board.sessionRequest(mac: url, handoffToken: token))
            let status = result?.1.statusCode ?? 0
            if status == 0 {
                // No answer at all: while waiting, a few are a slow network; three in a row (as the gate page counts
                // them) say the Mac is not answering, with Try again.
                misses += 1
                if waiting && misses < 3 { await env.sleep(3); continue }
                set(.unreachable(mac: mac.name), gen); return false
            }
            misses = 0
            switch Board.classifySession(status: status, body: result?.0, waiting: waiting) {
            case .admitted:
                return true
            case .pending(let code):
                waiting = true
                fresh = 0
                set(.waitingForAllow(mac: mac.name, code: code), gen)
                await env.sleep(3)
            case .retry:
                await env.sleep(3)
            case .denied:
                set(.denied(mac: mac.name), gen); return false
            case .refused:
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

    // false ends the loop. 401s for 15 s (at once if no list was read in this run), or the gate's sign-in page in place of the board's answer, mean the Mac's
    // session ended: sign in to it again, at most once every 30 s. Three refreshes in a row with no list (no answer, a 5xx,
    // a redirect, an answer that is not the list) say the Mac is not answering rather than leave an old list up.
    // The list shows as current only after a refresh that read it.
    private func refresh(url: URL, mac: Board.Mac, _ gen: Int) async -> Bool {
        let result = await env.send(Board.statusRequest(mac: url))
        guard gen == generation else { return false }
        // A read that was cancelled (a pull to refresh SwiftUI dropped) says nothing about the Mac.
        if Task.isCancelled { return true }
        let answer = result?.1
        let status = answer?.statusCode ?? 0
        if (200...299).contains(status), let data = result?.0, let rows = Board.parseAgents(data) {
            agents = resortNext ? Board.sorted(rows) : Board.keepingOrder(agents, with: rows)
            resortNext = false
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
