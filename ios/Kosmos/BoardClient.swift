import Foundation

// kosmos#6838 slice 1: the native connection to the person's Mac. The decisions
// live in BoardLogic.swift (tested); this file only moves bytes and publishes state
// for AgentsView. It has its own private session (cookies, cache and credentials in
// memory, never the web view's) and follows no redirect, so the Kosmos+ session and
// a handoff token only ever go to the host they were addressed to. The Mac's session
// cookie alone is kept between launches, in the Keychain (Board.SavedMacSession).
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

    @Published private(set) var phase: Phase = .starting
    @Published private(set) var agents: [Board.Agent] = []
    @Published private(set) var updatedAt: Date?

    private let coordinator: URL
    private let sessionStore: SessionStore
    private let macStore: SessionStore
    private let cookies: HTTPCookieStorage
    private let http: URLSession
    private var loop: Task<Void, Never>?
    // Bumped by every start and stop, so a run that was cancelled cannot write the screen afterwards.
    private var generation = 0
    // The Mac this client holds a session for and the Kosmos+ session it was opened under: a sign-out or another
    // account on the Board tab drops it (start()).
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

    init(coordinator: URL = KosmosConfig.coordinatorOrigin,
         sessionStore: SessionStore = SessionKeychain.live,
         macStore: SessionStore = SessionKeychain.macSession) {
        self.coordinator = coordinator
        self.sessionStore = sessionStore
        self.macStore = macStore
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .always
        config.timeoutIntervalForRequest = 15
        // An ephemeral configuration carries its own private, in-memory cookie store; held here so forget() clears
        // the very store the session uses.
        let jar = config.httpCookieStorage ?? HTTPCookieStorage()
        config.httpCookieStorage = jar
        self.cookies = jar
        self.http = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
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
            agents = Board.sorted([
                Board.Agent(session: "cleo", name: "Cleo", role: "Project manager", state: "needs_you", task: nil, askedYou: true, reportedByAgent: true),
                Board.Agent(session: "dana", name: "Dana", role: "Writer", state: "working", task: "Pages 9 to 12", askedYou: false),
                Board.Agent(session: "eli", name: "Eli", role: "Researcher", state: "working", task: nil, askedYou: false),
                Board.Agent(session: "farah", name: "Farah", role: "Bookkeeper", state: "idle", task: nil, askedYou: false),
            ])
            updatedAt = Date()
            phase = .live(mac: Board.Mac(name: "Studio", address: "studio.kosmosplus.com", usable: true))
            return
        }
        #endif
        let session = sessionStore.load()
        // Another account (or a new sign-in) drops everything learned under the old one. No session at all is handled
        // just below, without touching the kept Mac session.
        if let held = admitted, let session, held.session != session { forget() }
        // No Kosmos+ session (signed out, or the Keychain could not be read yet): nothing from the last one is shown.
        // The kept Mac session is deleted by the sign-out itself (PushNotificationManager), not here, so a Keychain
        // that is briefly unreadable does not cost it.
        if session == nil {
            admitted = nil
            agents = []
            updatedAt = nil
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

    func stop() {
        loop?.cancel()
        loop = nil
        generation += 1
    }

    // The tapped agent's chat on the Board tab (the same link a notification tap opens).
    func chatURL(for agent: Board.Agent) -> URL? {
        guard case .live(let mac) = phase else { return nil }
        return PushBridge.boardURL(fromNotification: ["address": mac.address, "session": agent.session], coordinator: coordinator)
    }

    // Everything learned under the previous Kosmos+ session goes, cookies and the kept Mac session included.
    private func forget() {
        admitted = nil
        agents = []
        updatedAt = nil
        UserDefaults.standard.removeObject(forKey: Board.rememberedMacKey)
        cookies.removeCookies(since: .distantPast)
        macStore.delete()
    }

    private func set(_ p: Phase, _ gen: Int) {
        if gen == generation { phase = p }
    }

    private func restoreCookie(_ value: String, for url: URL) {
        guard let host = url.host, let cookie = HTTPCookie(properties: [
            .name: Board.macCookieName, .value: value, .domain: host, .path: "/", .secure: "TRUE",
        ]) else { return }
        cookies.setCookie(cookie)
    }

    private func keepMacSession(_ mac: Board.Mac, url: URL, session: String) {
        guard let value = cookies.cookies(for: url)?.first(where: { $0.name == Board.macCookieName })?.value,
              let record = Board.encode(Board.SavedMacSession(name: mac.name, address: mac.address, cookie: value, owner: Board.owner(of: session)))
        else { return }
        macStore.save(record)
    }

    private func run(_ gen: Int) async {
        if admitted == nil {
            guard let session = sessionStore.load() else { set(.signedOut, gen); return }
            guard let mac = await chooseMac(session: session, gen) else { return }
            guard let url = Board.macURL(address: mac.address, coordinator: coordinator) else { set(.noMac, gen); return }
            guard await openSession(session: session, mac: mac, url: url, gen), gen == generation else { return }
            admitted = (mac, url, session)
            keepMacSession(mac, url: url, session: session)
            UserDefaults.standard.set(mac.address, forKey: Board.rememberedMacKey)
        }
        guard let (mac, url, _) = admitted else { return }
        failedRefreshes = 0
        while !Task.isCancelled && gen == generation {
            guard await refresh(url: url, mac: mac, gen) else { return }
            try? await Task.sleep(nanoseconds: 5_000_000_000)   // the board page polls /api/status every 5 s too
        }
    }

    // An answer from Kosmos+ that is not a success: a 401 is a sign-out, a 403 a refusal of this iPhone, anything
    // else (no answer, a 5xx, a 429) Kosmos+ being unreachable for now.
    private func kosmosPlusFailed(status: Int, _ gen: Int) {
        if status == 401 { set(.signedOut, gen) }
        else if status == 403 { set(.kosmosPlusRefused, gen) }
        else { set(.kosmosPlusDown, gen) }
    }

    private func chooseMac(session: String, _ gen: Int) async -> Board.Mac? {
        let result = try? await http.data(for: Board.macsRequest(coordinator: coordinator, session: session))
        let status = (result?.1 as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status), let data = result?.0, let macs = Board.parseMacs(data) else {
            kosmosPlusFailed(status: status, gen); return nil
        }
        guard let mac = Board.pickMac(Board.reachableMacs(macs, coordinator: coordinator),
                                      remembered: UserDefaults.standard.string(forKey: Board.rememberedMacKey)) else {
            set(.noMac, gen); return nil
        }
        return mac
    }

    // nil when it failed, with the phase already set to say why.
    private func handoff(session: String, mac: Board.Mac, _ gen: Int) async -> String? {
        let result = try? await http.data(for: Board.handoffRequest(coordinator: coordinator, session: session, address: mac.address))
        let status = (result?.1 as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status), let data = result?.0, let token = Board.parseHandoffToken(data) else {
            kosmosPlusFailed(status: status, gen); return nil
        }
        return token
    }

    // A handoff token from Kosmos+, then the Mac's gate. While the Mac shows Allow it asks again every 3 s, rides
    // out a slow network, and fetches a new handoff when the old one is refused (it expires during a long wait, and
    // a Mac that has just started refuses for a while), up to six times (about 30 s) in a row.
    private func openSession(session: String, mac: Board.Mac, url: URL, _ gen: Int) async -> Bool {
        guard var token = await handoff(session: session, mac: mac, gen) else { return false }
        var waiting = false
        var fresh = 0
        var misses = 0
        while !Task.isCancelled && gen == generation {
            let result = try? await http.data(for: Board.sessionRequest(mac: url, handoffToken: token))
            let status = (result?.1 as? HTTPURLResponse)?.statusCode ?? 0
            if status == 0 {
                // No answer at all: while waiting, a few are a slow network; three in a row (as the gate page counts
                // them) say the Mac is not answering, with Try again.
                misses += 1
                if waiting && misses < 3 { try? await Task.sleep(nanoseconds: 3_000_000_000); continue }
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
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            case .retry:
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            case .denied:
                set(.denied(mac: mac.name), gen); return false
            case .refused(let because):
                // Refused handoffs are retried a few times: one expires during a long wait for Allow, and a Mac that
                // has just started refuses until it knows its account again (gate.rs ACCOUNT_NOT_KNOWN_YET).
                guard fresh < Self.freshHandoffs else {
                    // Logged for the first runs on a phone: this is where the plan's weakest premise would show.
                    NSLog("[Board] the Mac's gate refused the sign-in (\(status)): \(String((because ?? "no reason given").prefix(200)))")
                    set(.macRefused(mac: mac.name), gen); return false
                }
                fresh += 1
                if !waiting { set(.connecting(mac: mac.name), gen) }
                try? await Task.sleep(nanoseconds: 5_000_000_000)
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
        let result = try? await http.data(for: Board.statusRequest(mac: url))
        guard gen == generation else { return false }
        let answer = result?.1 as? HTTPURLResponse
        let status = answer?.statusCode ?? 0
        if (200...299).contains(status), let data = result?.0, let rows = Board.parseAgents(data) {
            agents = Board.sorted(rows)
            updatedAt = Date()
            failedRefreshes = 0
            unauthorizedSince = nil
            // The first list in a run (re)keeps the Mac's session, so a kept record dropped while the Mac was away is
            // restored once it answers again.
            if !listedThisRun, let held = admitted { keepMacSession(mac, url: url, session: held.session) }
            listedThisRun = true
            retriedUnreachable = false
            set(.live(mac: mac), gen)
            return true
        }
        if Board.sessionEnded(status: status, contentType: answer?.value(forHTTPHeaderField: "Content-Type")) {
            if status == 401 {
                let since = unauthorizedSince ?? Date()
                unauthorizedSince = since
                if listedThisRun && Date().timeIntervalSince(since) < Self.unauthorizedGrace { return true }
            }
            unauthorizedSince = nil
            admitted = nil
            // The kept record stays until a new session replaces it (keepMacSession), so a Mac that only needs a moment
            // longer is not forgotten if the app is closed meanwhile.
            if let last = lastReconnect, Date().timeIntervalSince(last) < Self.reconnectGap {
                // The Mac ended this iPhone's session twice in 30 s: it answers, but will not keep the sign-in.
                set(.macRefused(mac: mac.name), gen)
                return false
            }
            lastReconnect = Date()
            start()
            return false
        }
        failedRefreshes += 1
        if failedRefreshes >= Self.failuresBeforeNotAnswering {
            // A kept session that never produced a list in this run is not kept: the next launch asks Kosmos+ which
            // Mac to use, rather than restoring one that may be gone.
            if !listedThisRun { macStore.delete() }
            set(.unreachable(mac: mac.name), gen)
            return false
        }
        return true
    }
}

// No redirect is followed: none of these calls expects one, and following it could carry the bearer session or a
// handoff token to another host.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
