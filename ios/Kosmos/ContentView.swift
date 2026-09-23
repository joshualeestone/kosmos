import SwiftUI
import WebKit

// The board, rendered full-screen in a WKWebView, optionally gated behind a
// biometric unlock (KosmosConfig.requireBiometricUnlock).
struct ContentView: View {
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
                WebView(url: KosmosConfig.boardURL)
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
                // No biometrics enrolled/available: do not lock the user out of
                // their own board - fall open. A production policy may require a
                // passcode instead; that is a product decision (#718).
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
    // The single fixed front-door origin the store app targets. This is the
    // blocking dependency #2854: a TWA and an iOS shell both need ONE fixed public
    // origin that routes to the user's own Mac, because the relay hands each user a
    // per-user hostname. It is a PLACEHOLDER until that origin is decided; this is
    // the one place to repoint, mirroring the Android skeleton's strings.xml. The
    // build does not depend on the URL resolving.
    static let boardURL = URL(string: "https://app.kosmos.io/")!

    // Require Face ID / Touch ID before the board renders. Off by default so the
    // shell behaves as before; flip to true to demonstrate the biometric-unlock
    // native surface (#718). Whether production requires it is a product decision.
    static let requireBiometricUnlock = false
}

// A minimal WKWebView wrapper that renders the board. Native in-app navigation
// chrome is still future work; APNs registration and biometric unlock now live
// in AppDelegate / PushNotificationManager / BiometricAuth.
struct WebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView(frame: .zero)
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
