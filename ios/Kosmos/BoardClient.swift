import Foundation

// kosmos#6838 slice 1: the native connection to the person's Mac. The decisions
// live in BoardLogic.swift (tested); this file only moves bytes and publishes state
// for AgentsView. Its cookies are its own, never the web view's.
@MainActor
final class BoardClient: ObservableObject {

    enum Phase: Equatable {
        case starting
        case signedOut
        case noMac
        case waitingForAllow(mac: String, code: String?)
        case denied(mac: String)
        case unreachable(mac: String, because: String?)
        case live(mac: Board.Mac)
    }

    @Published private(set) var phase: Phase = .starting
    @Published private(set) var agents: [Board.Agent] = []
    @Published private(set) var updatedAt: Date?

    private let coordinator: URL
    private let sessionStore: SessionStore
    private let http: URLSession
    private var macURL: URL?
    private var loop: Task<Void, Never>?
    private static let rememberedKey = "nativeBoardMac"

    init(coordinator: URL = KosmosConfig.coordinatorOrigin, sessionStore: SessionStore = SessionKeychain.live) {
        self.coordinator = coordinator
        self.sessionStore = sessionStore
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage()   // this client's own jar
        config.httpCookieAcceptPolicy = .always
        config.timeoutIntervalForRequest = 15
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.http = URLSession(configuration: config)
    }

    // Starts (or restarts) the connect-then-refresh loop. Stopped when the tab goes away.
    func start() {
        loop?.cancel()
        #if DEBUG
        // Screenshots only (a Debug build; Release has no such switch): KOSMOS_SAMPLE_AGENTS=1 shows invented agents
        // (the names in Mona Lisa's design) without connecting, so no real account is ever in a picture.
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" {
            agents = Board.sorted([
                Board.Agent(session: "cleo", name: "Cleo", role: "Project manager", state: "needs_you", task: nil, askedYou: true),
                Board.Agent(session: "dana", name: "Dana", role: "Writer", state: "working", task: "Pages 9 to 12", askedYou: false),
                Board.Agent(session: "eli", name: "Eli", role: "Researcher", state: "working", task: nil, askedYou: false),
                Board.Agent(session: "farah", name: "Farah", role: "Bookkeeper", state: "idle", task: nil, askedYou: false),
            ])
            updatedAt = Date()
            phase = .live(mac: Board.Mac(name: "Studio", address: "studio.kosmosplus.com", usable: true))
            return
        }
        #endif
        loop = Task { [weak self] in await self?.run() }
    }

    func stop() {
        loop?.cancel()
        loop = nil
    }

    func chatURL(for agent: Board.Agent) -> URL? {
        guard case .live(let mac) = phase else { return nil }
        return PushBridge.boardURL(fromNotification: ["address": mac.address, "session": agent.session], coordinator: coordinator)
    }

    private func run() async {
        guard let session = sessionStore.load() else { phase = .signedOut; return }
        guard let mac = await chooseMac(session: session) else { return }
        guard let url = Board.macURL(address: mac.address, coordinator: coordinator) else { phase = .noMac; return }
        macURL = url
        guard await openSession(session: session, mac: mac, url: url) else { return }
        UserDefaults.standard.set(mac.address, forKey: Self.rememberedKey)
        phase = .live(mac: mac)
        while !Task.isCancelled {
            await refresh(url: url, mac: mac)
            try? await Task.sleep(nanoseconds: 5_000_000_000)   // the board page polls /api/status every 5 s too
        }
    }

    private func chooseMac(session: String) async -> Board.Mac? {
        guard let (data, resp) = try? await http.data(for: Board.macsRequest(coordinator: coordinator, session: session)),
              let status = (resp as? HTTPURLResponse)?.statusCode
        else { phase = .unreachable(mac: "Kosmos+", because: nil); return nil }
        if status == 401 { phase = .signedOut; return nil }
        guard (200...299).contains(status), let macs = Board.parseMacs(data) else {
            phase = .unreachable(mac: "Kosmos+", because: nil); return nil
        }
        guard let mac = Board.pickMac(macs, remembered: UserDefaults.standard.string(forKey: Self.rememberedKey)) else {
            phase = .noMac; return nil
        }
        return mac
    }

    // Handoff token from Kosmos+, then the Mac's gate. Waits while the Mac shows Allow.
    private func openSession(session: String, mac: Board.Mac, url: URL) async -> Bool {
        guard let (hData, hResp) = try? await http.data(for: Board.handoffRequest(coordinator: coordinator, session: session, address: mac.address)),
              let hStatus = (hResp as? HTTPURLResponse)?.statusCode
        else { phase = .unreachable(mac: mac.name, because: nil); return false }
        if hStatus == 401 { phase = .signedOut; return false }
        guard (200...299).contains(hStatus), let token = Board.parseHandoffToken(hData) else {
            phase = .unreachable(mac: mac.name, because: nil); return false
        }
        var waiting = false
        while !Task.isCancelled {
            let result = try? await http.data(for: Board.sessionRequest(mac: url, handoffToken: token))
            let status = (result?.1 as? HTTPURLResponse)?.statusCode ?? 0
            if status == 0 { phase = .unreachable(mac: mac.name, because: nil); return false }
            switch Board.classifySession(status: status, body: result?.0, waiting: waiting) {
            case .admitted:
                return true
            case .pending(let code):
                waiting = true
                phase = .waitingForAllow(mac: mac.name, code: code)
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            case .retry:
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            case .denied:
                phase = .denied(mac: mac.name); return false
            case .refused(let because):
                phase = .unreachable(mac: mac.name, because: because); return false
            }
        }
        return false
    }

    private func refresh(url: URL, mac: Board.Mac) async {
        guard let (data, resp) = try? await http.data(for: Board.statusRequest(mac: url)),
              let status = (resp as? HTTPURLResponse)?.statusCode
        else { return }   // a missed refresh keeps the last list; the next one tries again
        // The Mac's session ended (expired, or this phone was removed on the Mac): connect again.
        if status == 401 { start(); return }
        guard (200...299).contains(status), let rows = Board.parseAgents(data) else { return }
        agents = Board.sorted(rows)
        updatedAt = Date()
    }
}
