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
// the kosmosSession bridge, only at the moment of sign-in or sign-out). Whichever
// arrives second triggers the register.
//
// Threading: every method, and every transport completion, runs on the main
// thread. The URLSession transport in PushNotificationManager hops back to main.
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
    private let transport: Transport
    private let log: (String) -> Void

    private(set) var session: String?
    private(set) var deviceToken: String?
    // The (session, token) pair the coordinator has accepted in this launch, so a
    // repeated token delivery or a repeated sign-in post does not re-send.
    private var registered: (session: String, token: String)?
    // A sign-out that happened before APNs delivered the token: the old session is
    // held in memory (never stored) until the token arrives, so the device can still
    // be unregistered from the account that signed out.
    private var pendingUnregister: String?

    init(
        coordinator: URL,
        bundleID: String,
        environment: PushBridge.Environment,
        store: SessionStore,
        transport: @escaping Transport,
        log: @escaping (String) -> Void = { NSLog("%@", $0) }
    ) {
        self.coordinator = coordinator
        self.bundleID = bundleID
        self.environment = environment
        self.store = store
        self.transport = transport
        self.log = log
        self.session = store.load()
    }

    // APNs handed us this device's token (hex).
    func didReceiveDeviceToken(_ token: String) {
        deviceToken = token
        if let old = pendingUnregister {
            pendingUnregister = nil
            unregister(session: old, token: token)
        }
        registerIfReady()
    }

    // The sign-in page posted to the bridge (already origin-checked by the caller).
    func didReceive(_ message: PushBridge.SessionMessage) {
        switch message {
        case .signedIn(let newSession):
            if !store.save(newSession) {
                // Still usable for this launch; it just will not survive a relaunch.
                log("[Push] could not store the session in the Keychain; using it for this launch only")
            }
            session = newSession
            pendingUnregister = nil
            registerIfReady()
        case .signedOut:
            if let old = session {
                if let token = deviceToken {
                    unregister(session: old, token: token)
                } else {
                    pendingUnregister = old
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
        let req = PushBridge.registerRequest(
            coordinator: coordinator,
            session: session,
            token: token,
            bundleID: bundleID,
            environment: environment
        )
        transport(req) { [weak self] status in
            guard let self = self else { return }
            let outcome = PushBridge.outcome(status: status)
            switch outcome {
            case .ok:
                // Only record it if nothing changed while the request was in flight.
                if self.session == session && self.deviceToken == token {
                    self.registered = (session, token)
                }
                self.log("[Push] APNs token registered with the coordinator (\(self.environment.rawValue))")
            case .sessionRejected:
                self.log("[Push] register refused: the session is no longer valid; forgetting it")
                self.forget(ifStill: session)
            case .deviceRefused:
                self.log("[Push] register refused: this device is not allowed on the account")
            case .failed(let code):
                self.log("[Push] register failed with HTTP \(code)")
            case .unreachable:
                self.log("[Push] register failed: coordinator unreachable; retries next launch")
            }
        }
    }

    private func unregister(session: String, token: String) {
        let req = PushBridge.unregisterRequest(coordinator: coordinator, session: session, token: token)
        transport(req) { [weak self] status in
            // 200 either way on the server. Nothing in local state depends on the answer.
            switch PushBridge.outcome(status: status) {
            case .ok: self?.log("[Push] APNs token unregistered")
            case .unreachable: self?.log("[Push] unregister failed: coordinator unreachable")
            default: self?.log("[Push] unregister answered HTTP \(status ?? 0)")
            }
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
