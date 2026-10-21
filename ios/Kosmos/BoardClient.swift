import Foundation

// kosmos#6838 slice 1: the native connection to the person's Mac. The decisions
// live in BoardLogic.swift (tested); this file only moves bytes and publishes state
// for AgentsView. It has its own private session (cookies, cache and credentials in
// memory, never the web view's) and follows no redirect, so the Kosmos+ session and
// a handoff token only ever go to the host they were addressed to.
@MainActor
final class BoardClient: ObservableObject {

    enum Phase: Equatable {
        case starting
        case signedOut
        case noMac
        case waitingForAllow(mac: String, code: String?)
        case denied(mac: String)
        case unreachable(mac: String)
        case live(mac: Board.Mac)
    }

    @Published private(set) var phase: Phase = .starting
    @Published private(set) var agents: [Board.Agent] = []
    @Published private(set) var updatedAt: Date?

    private let coordinator: URL
    private let sessionStore: SessionStore
    private let http: URLSession
    private var loop: Task<Void, Never>?
    // Bumped by every start and stop, so a run that was cancelled cannot write the screen afterwards.
    private var generation = 0
    // The Mac this client holds a session for, kept across tab switches within one launch, and the Kosmos+
    // session it was opened under: a sign-out or another account on the Board tab drops it (start()).
    private var admitted: (mac: Board.Mac, url: URL, session: String)?
    private var failedRefreshes = 0
    private static let failuresBeforeNotAnswering = 3
    private var lastReconnect: Date?
    private static let rememberedKey = "nativeBoardMac"
    private static let reconnectGap: TimeInterval = 30

    init(coordinator: URL = KosmosConfig.coordinatorOrigin, sessionStore: SessionStore = SessionKeychain.live) {
        self.coordinator = coordinator
        self.sessionStore = sessionStore
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieAcceptPolicy = .always
        config.timeoutIntervalForRequest = 15
        self.http = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }

    // Starts (or resumes) the loop when the tab appears. A Mac already admitted in this launch is polled again
    // without a new sign-in to it.
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
        if admitted == nil { set(.starting, gen) }
        loop = Task { await self.run(gen) }
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

    // Everything learned under the previous Kosmos+ session goes, cookies included.
    private func forget() {
        admitted = nil
        agents = []
        updatedAt = nil
        UserDefaults.standard.removeObject(forKey: Self.rememberedKey)
        http.configuration.httpCookieStorage?.removeCookies(since: .distantPast)
    }

    private func set(_ p: Phase, _ gen: Int) {
        if gen == generation { phase = p }
    }

    private func run(_ gen: Int) async {
        if admitted == nil {
            guard let session = sessionStore.load() else { set(.signedOut, gen); return }
            guard let mac = await chooseMac(session: session, gen) else { return }
            guard let url = Board.macURL(address: mac.address, coordinator: coordinator) else { set(.noMac, gen); return }
            guard await openSession(session: session, mac: mac, url: url, gen), gen == generation else { return }
            admitted = (mac, url, session)
            UserDefaults.standard.set(mac.address, forKey: Self.rememberedKey)
        }
        guard let (mac, url, _) = admitted else { return }
        failedRefreshes = 0
        set(.live(mac: mac), gen)
        while !Task.isCancelled && gen == generation {
            guard await refresh(url: url, mac: mac, gen) else { return }
            try? await Task.sleep(nanoseconds: 5_000_000_000)   // the board page polls /api/status every 5 s too
        }
    }

    private func chooseMac(session: String, _ gen: Int) async -> Board.Mac? {
        guard let (data, resp) = try? await http.data(for: Board.macsRequest(coordinator: coordinator, session: session)),
              let status = (resp as? HTTPURLResponse)?.statusCode
        else { set(.unreachable(mac: "Kosmos+"), gen); return nil }
        if status == 401 { set(.signedOut, gen); return nil }
        guard (200...299).contains(status), let macs = Board.parseMacs(data) else {
            set(.unreachable(mac: "Kosmos+"), gen); return nil
        }
        guard let mac = Board.pickMac(macs, remembered: UserDefaults.standard.string(forKey: Self.rememberedKey)) else {
            set(.noMac, gen); return nil
        }
        return mac
    }

    private func handoff(session: String, mac: Board.Mac, _ gen: Int) async -> String? {
        guard let (data, resp) = try? await http.data(for: Board.handoffRequest(coordinator: coordinator, session: session, address: mac.address)),
              let status = (resp as? HTTPURLResponse)?.statusCode
        else { set(.unreachable(mac: mac.name), gen); return nil }
        if status == 401 { set(.signedOut, gen); return nil }
        guard (200...299).contains(status), let token = Board.parseHandoffToken(data) else {
            set(.unreachable(mac: mac.name), gen); return nil
        }
        return token
    }

    // A handoff token from Kosmos+, then the Mac's gate. While the Mac shows Allow it asks again every 3 s, rides
    // out a slow network, and fetches a new handoff when the old one has expired during the wait.
    private func openSession(session: String, mac: Board.Mac, url: URL, _ gen: Int) async -> Bool {
        guard var token = await handoff(session: session, mac: mac, gen) else { return false }
        var waiting = false
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
                set(.waitingForAllow(mac: mac.name, code: code), gen)
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            case .retry:
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            case .denied:
                set(.denied(mac: mac.name), gen); return false
            case .refused:
                if waiting, let fresh = await handoff(session: session, mac: mac, gen) { token = fresh; continue }
                set(.unreachable(mac: mac.name), gen); return false
            }
        }
        return false
    }

    // false ends the loop. A 401, or the gate's sign-in page in place of the board's answer, means the Mac's session
    // ended: sign in to it again, at most once every 30 s. Three refreshes in a row with no list (no answer, a 5xx,
    // a redirect, an answer that is not the list) say the Mac is not answering rather than leave an old list up.
    private func refresh(url: URL, mac: Board.Mac, _ gen: Int) async -> Bool {
        let result = try? await http.data(for: Board.statusRequest(mac: url))
        guard gen == generation else { return false }
        let http = result?.1 as? HTTPURLResponse
        let status = http?.statusCode ?? 0
        if (200...299).contains(status), let data = result?.0, let rows = Board.parseAgents(data) {
            agents = Board.sorted(rows)
            updatedAt = Date()
            failedRefreshes = 0
            return true
        }
        if Board.sessionEnded(status: status, contentType: http?.value(forHTTPHeaderField: "Content-Type")) {
            admitted = nil
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
