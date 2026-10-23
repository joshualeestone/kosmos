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
            let sample = #"{"agents":[{"sessionName":"cleo","name":"Cleo","role":"Project manager","state":"needs_you","stateReportedBy":"agent","cardWord":"Question","cardTone":"asked"},{"sessionName":"dana","name":"Dana","role":"Writer","state":"working","task":"Pages 9 to 12","cardWord":"Working","cardTone":"working"},{"sessionName":"eli","name":"Eli","role":"Researcher","state":"working","cardWord":"Working","cardTone":"working"},{"sessionName":"farah","name":"Farah","role":"Bookkeeper","state":"idle","cardWord":"Idle","cardTone":"quiet"},{"sessionName":"hana","name":"Hana","role":"Support","state":"auth_failed","cardWord":"Sign-in Issue","cardTone":"needs_you"},{"sessionName":"ivy","name":"Ivy","role":"Editor","state":"restarting","cardWord":"Switching to Opus","cardTone":"quiet"},{"sessionName":"gus","name":"Gus","role":"Social media","state":"stopped","running":false,"cardWord":"Not running","cardTone":"needs_you"}]}"#
            agents = Board.sorted(Board.parseAgents(Data(sample.utf8)) ?? [])
            updatedAt = Date()
            fresh = true
            phase = .live(mac: Board.Mac(name: "Studio", address: "studio.kosmosplus.com", usable: true))
            return
        }
        #endif
        let session = sessionStore.load()
        // Another account (or a new sign-in) drops everything learned under the old one. No session at all is handled
        // just below, without touching the kept Mac session.
        if let held = admitted, let session, held.session != session { forget() }
        // The shown list is checked too, since admitted is often unset by then (after a refusal or not answering).
        if let owner = shownOwner, let session, owner != Board.owner(of: session) { forget() }
        fresh = false
        // No Kosmos+ session (signed out, or the Keychain could not be read yet): nothing from the last one is shown.
        // The kept Mac session is deleted by the sign-out itself (PushNotificationManager), not here, so a Keychain
        // that is briefly unreadable does not cost it.
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
        if let shown = shownMac, shown.address != mac.address { pictures = [:]; pictureVersions = [:] }
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
