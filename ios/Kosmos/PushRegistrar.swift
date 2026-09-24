import Foundation

// Where the coordinator session is kept between launches. The app uses the
// Keychain (SessionKeychain); tests use memory. Never UserDefaults: it is a plain
// file in the app container and lands in backups.
protocol SessionStore {
    func load() -> String?
    @discardableResult func save(_ session: String) -> Bool
    func delete()
}

// Decides when to register and unregister this device's APNs token with the
// coordinator, from the two things that arrive independently: the APNs device
// token (from UIKit, every launch) and the session (from the sign-in page through
// the kosmosSession bridge, at sign-in, on every load of a signed-in page, and as
// null at sign-out). Whichever arrives second triggers the register.
//
// Threading: every method, and every transport completion, runs on the main
// thread (urlSessionTransport below hops back to main).
//
// Logging: status codes and outcomes only. Never the session, never the token.
final class PushRegistrar {

    // Sends one request and reports the HTTP status, or nil when there was no
    // HTTP answer at all.
    typealias Transport = (URLRequest, @escaping (Int?) -> Void) -> Void

    private let coordinator: URL
    private let bundleID: String
    private let environment: PushBridge.Environment
    private let store: SessionStore
    private let pendingStore: SessionStore
    private let transport: Transport
    private let log: (String) -> Void

    private(set) var session: String?
    private(set) var deviceToken: String?
    // The (session, token) pair the coordinator accepted in this launch, and the
    // pair currently being sent, so repeated posts do not re-send.
    private var registered: (session: String, token: String)?
    private var inFlight: (session: String, token: String)?
    // A signed-out session whose unregister could not be sent yet because APNs had
    // not delivered the token. Persisted in pendingStore so a relaunch still sends it.
    private var pendingUnregister: String?

    // store holds the live session; pendingStore holds a signed-out session that
    // still owes an unregister. Two Keychain items in the app, memory in tests.
    init(
        coordinator: URL,
        bundleID: String,
        environment: PushBridge.Environment,
        store: SessionStore,
        pendingStore: SessionStore,
        transport: @escaping Transport,
        log: @escaping (String) -> Void = { NSLog("%@", $0) }
    ) {
        self.coordinator = coordinator
        self.bundleID = bundleID
        self.environment = environment
        self.store = store
        self.pendingStore = pendingStore
        self.transport = transport
        self.log = log
        self.session = store.load()
        self.pendingUnregister = pendingStore.load()
    }

    // APNs handed us this device's token (hex).
    func didReceiveDeviceToken(_ token: String) {
        deviceToken = token
        if let old = pendingUnregister {
            unregister(session: old, token: token) { [weak self] sent in
                guard sent, let self = self, self.pendingUnregister == old else { return }
                self.pendingUnregister = nil
                self.pendingStore.delete()
            }
        }
        registerIfReady()
    }

    // The sign-in page posted to the bridge (already origin-checked by the caller).
    func didReceive(_ message: PushBridge.SessionMessage) {
        switch message {
        case .signedIn(let newSession):
            if newSession != session && !store.save(newSession) {
                // Still usable for this launch; it just will not survive a relaunch.
                log("[Push] could not store the session in the Keychain; using it for this launch only")
            }
            session = newSession
            if pendingUnregister != nil {
                // The new session's register re-owns the token, so the old unregister
                // is moot, and sending both could let the unregister land second.
                pendingUnregister = nil
                pendingStore.delete()
            }
            registerIfReady()
        case .signedOut:
            if let old = session {
                if let token = deviceToken {
                    unregister(session: old, token: token) { _ in }
                } else {
                    pendingUnregister = old
                    pendingStore.save(old)
                }
            }
            store.delete()
            session = nil
            registered = nil
        }
    }

    private func registerIfReady() {
        guard let session = session, let token = deviceToken else { return }
        if let done = registered, done.session == session, done.token == token { return }
        if let busy = inFlight, busy.session == session, busy.token == token { return }
        inFlight = (session, token)
        let req = PushBridge.registerRequest(
            coordinator: coordinator,
            session: session,
            token: token,
            bundleID: bundleID,
            environment: environment
        )
        transport(req) { [weak self] status in
            guard let self = self else { return }
            if let busy = self.inFlight, busy.session == session, busy.token == token {
                self.inFlight = nil
            }
            switch PushBridge.outcome(status: status) {
            case .ok:
                self.log("[Push] APNs token registered with the coordinator (\(self.environment.rawValue))")
                if self.session == session && self.deviceToken == token {
                    self.registered = (session, token)
                } else if self.session == nil {
                    // Signed out while this register was in flight. The sign-out's
                    // unregister may have reached the coordinator first, leaving this
                    // register standing, so unregister again now that it has landed.
                    // Only when nobody is signed in: a newer session's own register
                    // re-owns the token, and an unregister here could race it.
                    self.unregister(session: session, token: token) { _ in }
                }
            case .sessionRejected:
                self.log("[Push] register refused: the session is no longer valid; forgetting it")
                self.forget(ifStill: session)
            case .deviceRefused:
                self.log("[Push] register refused: this device is not allowed on the account")
            case .failed(let code):
                self.log("[Push] register failed with HTTP \(code)")
            case .unreachable:
                self.log("[Push] register failed: coordinator unreachable; retries on the next post or launch")
            }
        }
    }

    // done(true) once the coordinator answered at all: it answers 200 either way,
    // and a 401 means the session is dead, so there is nothing left to retry.
    private func unregister(session: String, token: String, done: @escaping (Bool) -> Void) {
        let req = PushBridge.unregisterRequest(coordinator: coordinator, session: session, token: token)
        transport(req) { [weak self] status in
            switch PushBridge.outcome(status: status) {
            case .ok:
                self?.log("[Push] APNs token unregistered")
            case .unreachable:
                self?.log("[Push] unregister failed: coordinator unreachable")
            case .sessionRejected:
                self?.log("[Push] unregister answered HTTP 401")
            case .deviceRefused:
                self?.log("[Push] unregister answered HTTP 403")
            case .failed(let code):
                self?.log("[Push] unregister answered HTTP \(code)")
            }
            done(status != nil)
        }
    }

    // The real transport. An ephemeral URLSession by default: no cookie jar, no
    // URL cache, nothing about the coordinator session written to disk by the
    // networking stack. The completion always lands on the main thread.
    static func urlSessionTransport(
        _ session: URLSession = URLSession(configuration: .ephemeral)
    ) -> Transport {
        return { request, done in
            session.dataTask(with: request) { _, response, _ in
                let status = (response as? HTTPURLResponse)?.statusCode
                DispatchQueue.main.async { done(status) }
            }.resume()
        }
    }

    // Drop a dead session, unless a newer sign-in already replaced it.
    private func forget(ifStill dead: String) {
        guard session == dead else { return }
        store.delete()
        session = nil
        registered = nil
    }
}
