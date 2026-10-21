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
        case denied(mac: String)
        case kosmosPlusDown
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
    // KeptSession::Hold), so one 401 is a missed refresh and only a second in a row ends the session.
    private var unauthorizedOnce = false
    private var lastReconnect: Date?
    private static let reconnectGap: TimeInterval = 30
    private static let failuresBeforeNotAnswering = 3
    private static let freshHandoffsWhileWaiting = 3

    init(coordinator: URL = KosmosConfig.coordinatorOrigin,
         sessionStore: SessionStore = SessionKeychain.live,
         macStore: SessionStore = SessionKeychain.macSession) {
        self.coordinator = coordinator
        self.sessionStore = sessionStore
        self.macStore = macStore
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .always
        config.timeoutIntervalForRequest = 15
        self.cookies = config.httpCookieStorage ?? HTTPCookieStorage()
        config.httpCookieStorage = cookies
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
        if let held = admitted, held.session != session { forget() }
        // Signed out: nothing from the last sign-in may outlive it, the kept Mac session included.
        if session == nil { forget() }
        let stored = macStore.load()
        // A kept Mac session from another sign-in is never used, so it is not kept either.
        if stored != nil, Board.usableSaved(stored, session: session, coordinator: coordinator) == nil { macStore.delete() }
        if admitted == nil, !skipSaved, let session, let saved = Board.usableSaved(stored, session: session, coordinator: coordinator),
           let url = Board.macURL(address: saved.address, coordinator: coordinator) {
            // The Mac's session from an earlier launch: tried first, and dropped by refresh() if the Mac has ended it.
            restoreCookie(saved.cookie, for: url)
            admitted = (Board.Mac(name: saved.name, address: saved.address, usable: true), url, session)
        }
        skipSaved = false
        if case .live = phase {} else { set(.starting, gen) }
        loop = Task { await self.run(gen) }
    }

    // Try again after a failure: ask Kosmos+ for the Macs afresh, so a Mac that went away or came online counts.
    func retry() {
        admitted = nil
        skipSaved = true
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
    private func kosmosPlusFailed(status: Int, mac: String?, _ gen: Int) {
        if status == 401 { set(.signedOut, gen) }
        else if status == 403 { set(.denied(mac: mac ?? "Kosmos+"), gen) }
        else { set(.kosmosPlusDown, gen) }
    }

    private func chooseMac(session: String, _ gen: Int) async -> Board.Mac? {
        let result = try? await http.data(for: Board.macsRequest(coordinator: coordinator, session: session))
        let status = (result?.1 as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status), let data = result?.0, let macs = Board.parseMacs(data) else {
            kosmosPlusFailed(status: status, mac: nil, gen); return nil
        }
        guard let mac = Board.pickMac(macs, remembered: UserDefaults.standard.string(forKey: Board.rememberedMacKey)) else {
            set(.noMac, gen); return nil
        }
        return mac
    }

    // nil when it failed, with the phase already set to say why.
    private func handoff(session: String, mac: Board.Mac, _ gen: Int) async -> String? {
        let result = try? await http.data(for: Board.handoffRequest(coordinator: coordinator, session: session, address: mac.address))
        let status = (result?.1 as? HTTPURLResponse)?.statusCode ?? 0
        guard (200...299).contains(status), let data = result?.0, let token = Board.parseHandoffToken(data) else {
            kosmosPlusFailed(status: status, mac: mac.name, gen); return nil
        }
        return token
    }

    // A handoff token from Kosmos+, then the Mac's gate. While the Mac shows Allow it asks again every 3 s, rides
    // out a slow network, and fetches a new handoff when the old one is refused (it expires during a long wait), up
    // to three times in a row.
    private func openSession(session: String, mac: Board.Mac, url: URL, _ gen: Int) async -> Bool {
        guard var token = await handoff(session: session, mac: mac, gen) else { return false }
        var waiting = false
        var fresh = 0
        while !Task.isCancelled && gen == generation {
            let result = try? await http.data(for: Board.sessionRequest(mac: url, handoffToken: token))
            let status = (result?.1 as? HTTPURLResponse)?.statusCode ?? 0
            if status == 0 {
                if waiting { try? await Task.sleep(nanoseconds: 3_000_000_000); continue }
                set(.unreachable(mac: mac.name), gen); return false
            }
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
                guard waiting, fresh < Self.freshHandoffsWhileWaiting else {
                    // Logged for the first runs on a phone: this is where the plan's weakest premise would show.
                    NSLog("[Board] the Mac's gate refused the sign-in (%d): %@", status, because ?? "no reason given")
                    set(.macRefused(mac: mac.name), gen); return false
                }
                fresh += 1
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard let next = await handoff(session: session, mac: mac, gen) else { return false }
                token = next
            }
        }
        return false
    }

    // false ends the loop. A 401, or the gate's sign-in page in place of the board's answer, means the Mac's session
    // ended: sign in to it again, at most once every 30 s. Three refreshes in a row with no list (no answer, a 5xx,
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
            unauthorizedOnce = false
            set(.live(mac: mac), gen)
            return true
        }
        if Board.sessionEnded(status: status, contentType: answer?.value(forHTTPHeaderField: "Content-Type")) {
            if status == 401 && !unauthorizedOnce { unauthorizedOnce = true; return true }
            unauthorizedOnce = false
            admitted = nil
            macStore.delete()
            if let last = lastReconnect, Date().timeIntervalSince(last) < Self.reconnectGap {
                set(.unreachable(mac: mac.name), gen)
                return false
            }
            lastReconnect = Date()
            start()
            return false
        }
        failedRefreshes += 1
        if failedRefreshes >= Self.failuresBeforeNotAnswering {
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
