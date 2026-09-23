import SwiftUI
import WebKit

// The board, rendered full-screen in a WKWebView, optionally gated behind a
// biometric unlock (KosmosConfig.requireBiometricUnlock).
struct ContentView: View {
    // Starts unlocked when the gate is off, so default behavior is unchanged.
    @State private var isUnlocked = !KosmosConfig.requireBiometricUnlock
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if isUnlocked {
                WebView(url: KosmosConfig.boardURL)
                    .ignoresSafeArea()
            } else {
                LockView(onUnlock: unlock)
                    .onAppear(perform: unlock)
            }
        }
        .onChange(of: scenePhase) { newPhase in
            // Re-lock when the app leaves the foreground, so resuming from the
            // app switcher (or a lost/borrowed phone) must authenticate again,
            // and the board is not left rendered in the multitasking snapshot.
            // No-op when the gate is off. (iOS 16 single-parameter onChange.)
            if newPhase != .active && KosmosConfig.requireBiometricUnlock {
                isUnlocked = false
            }
        }
    }

    private func unlock() {
        BiometricAuth.authenticate { result in
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
