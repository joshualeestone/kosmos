import SwiftUI
import WebKit

// The board, rendered full-screen in a WKWebView, optionally gated behind a
// biometric unlock (KosmosConfig.requireBiometricUnlock).
struct ContentView: View {
    // Receives the session the coordinator sign-in page hands over (#718).
    let pushManager: PushNotificationManager
    // Starts unlocked when the gate is off, so default behavior is unchanged.
    @State private var isUnlocked = !KosmosConfig.requireBiometricUnlock
    // Set only when the app has actually gone to the background, so returning to
    // the foreground re-prompts after a real background cycle - not after a
    // transient .inactive (Control Center, a call, or the Face ID prompt itself).
    @State private var didBackground = false
    // Bumped on every background re-lock so a biometric completion that resolves
    // after the app backgrounded can be discarded instead of unlocking stale.
    @State private var unlockGeneration = 0
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if isUnlocked {
                WebView(url: KosmosConfig.boardURL, pushManager: pushManager)
                    .ignoresSafeArea()
            } else {
                LockView(onUnlock: unlock)
            }
        }
        .onAppear {
            // Cold launch: onChange does not fire for scenePhase's initial value,
            // so prompt here when we start locked.
            if !isUnlocked { unlock() }
        }
        .onChange(of: scenePhase) { newPhase in
            // iOS 16 single-parameter onChange. No-op when the gate is off.
            guard KosmosConfig.requireBiometricUnlock else { return }
            switch newPhase {
            case .background:
                // Lock only on a real background (home / app switcher), never on
                // .inactive: the Face ID prompt and transient interruptions also
                // make the app .inactive, and re-locking there would fight the
                // prompt. (App-switcher snapshot hardening - an .inactive privacy
                // overlay - is a further enhancement, noted in the plan.)
                isUnlocked = false
                didBackground = true
                unlockGeneration += 1
            case .active:
                // Re-prompt on the return from a real background, driven here
                // rather than from LockView.onAppear (which does not re-fire when
                // LockView is already in the hierarchy).
                if didBackground && !isUnlocked {
                    didBackground = false
                    unlock()
                }
            default:
                break
            }
        }
    }

    private func unlock() {
        let generation = unlockGeneration
        BiometricAuth.authenticate { result in
            // Discard a completion that resolved after a background re-lock bumped
            // the generation (e.g. Home pressed during the Face ID sheet), so a
            // stale success cannot leave the board unlocked past a background cycle.
            guard generation == unlockGeneration else { return }
            switch result {
            case .success:
                isUnlocked = true
            case .failed(let message):
                NSLog("[Biometric] unlock failed: \(message)")
            case .unavailable(let message):
                // Reachable only when the device has NO passcode set at all: with
                // .deviceOwnerAuthentication, a passcode-but-no-biometrics device
                // still gates via passcode. Do not lock a passcode-less user out
                // of their own board - fall open. Whether to hard-gate even that
                // case is a product decision (#718).
                NSLog("[Biometric] unlock unavailable, falling open: \(message)")
                isUnlocked = true
            }
        }
    }
}

// Shown while the board is locked behind biometrics.
struct LockView: View {
    let onUnlock: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "lock.shield")
                .font(.system(size: 56))
            Text("Kosmos is locked")
                .font(.headline)
            Button("Unlock", action: onUnlock)
                .buttonStyle(.borderedProminent)
        }
    }
}

enum KosmosConfig {
    // The coordinator's origin: the sign-in page the app renders AND the API the
    // app registers its APNs token with (the page calls /v1 relative to itself).
    // Decided on #2854 (Liu Kang, 2026-09-24): the app origin is login.kosmosplus.com
    // for both the iOS WebView and the Android TWA. The one place to repoint. The
    // kosmosSession bridge accepts a session only from this exact origin.
    static let coordinatorOrigin = URL(string: "https://login.kosmosplus.com")!

    // What the WebView loads: the coordinator's sign-in page, which after sign-in
    // links the person on to their own Mac's board.
    static let boardURL = URL(string: "/", relativeTo: coordinatorOrigin)!.absoluteURL

    // Require Face ID / Touch ID before the board renders. Off by default so the
    // shell behaves as before; flip to true to demonstrate the biometric-unlock
    // native surface (#718). Whether production requires it is a product decision.
    static let requireBiometricUnlock = false
}

// A minimal WKWebView wrapper that renders the board. It also exposes the
// kosmosSession message handler the coordinator sign-in page posts the session to
// (#718); the origin gate lives in PushNotificationManager.handleSessionMessage.
struct WebView: UIViewRepresentable {
    let url: URL
    let pushManager: PushNotificationManager

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // WKUserContentController retains its handlers strongly; the proxy holds
        // the manager weakly so the handler never keeps anything alive.
        config.userContentController.add(
            SessionMessageProxy(target: pushManager),
            name: PushNotificationManager.sessionHandlerName
        )
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: ()) {
        webView.configuration.userContentController
            .removeScriptMessageHandler(forName: PushNotificationManager.sessionHandlerName)
    }
}

// Forwards kosmosSession posts with the sender's frame facts. The body is never
// logged here or downstream: it carries the person's session.
final class SessionMessageProxy: NSObject, WKScriptMessageHandler {
    private weak var target: PushNotificationManager?

    init(target: PushNotificationManager) {
        self.target = target
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        let origin = message.frameInfo.securityOrigin
        target?.handleSessionMessage(
            body: message.body,
            isMainFrame: message.frameInfo.isMainFrame,
            scheme: origin.protocol,
            host: origin.host,
            port: origin.port
        )
    }
}
