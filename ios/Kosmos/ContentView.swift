import SwiftUI
import WebKit

// The board, rendered full-screen in a WKWebView, optionally gated behind a
// biometric unlock (KosmosConfig.requireBiometricUnlock).
struct ContentView: View {
    // Receives the session the coordinator sign-in page hands over (#718).
    @ObservedObject var pushManager: PushNotificationManager
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
    // The shell's failure page and retry requests (kosmos#718).
    @StateObject private var shell = ShellState()

    var body: some View {
        Group {
            if isUnlocked {
                ZStack {
                    // Edge to edge: the pages keep clear of the notch and home bar
                    // themselves (viewport-fit=cover and the safe-area insets).
                    WebView(
                        url: KosmosConfig.boardURL,
                        pushManager: pushManager,
                        boardToOpen: pushManager.boardToOpen,
                        shell: shell,
                        retryCount: shell.retryCount,
                        backCount: shell.backCount
                    )
                        .ignoresSafeArea()
                    if let failure = shell.failure {
                        LoadFailureView(failure: failure, detail: shell.failureDetail, retrying: shell.retrying, onRetry: shell.retry, onBack: shell.back)
                    }
                }
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
                // A failure page from before the lock belongs to a WebView that is
                // gone; the new one starts clean.
                shell.failure = nil
                shell.retrying = false
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
                shell.failure = nil
                shell.retrying = false
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
    // kosmosSession bridge accepts a session only from this exact origin, and a
    // tapped notification may open only a Mac under this host's parent domain
    // (PushBridge.boardURL; the "repointing the coordinator origin" test pins it).
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
    // A board a tapped notification asked for (PushNotificationManager.boardToOpen).
    let boardToOpen: PushNotificationManager.BoardRequest?
    // Where the WebView reports a failed load (kosmos#718).
    let shell: ShellState
    // Passed as a value so a retry is a change SwiftUI sees, and updateUIView runs.
    let retryCount: Int
    // Same idea, for "Back to Kosmos" on the failure page.
    let backCount: Int

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
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        // Navy until the first page paints, instead of a white flash.
        webView.isOpaque = false
        webView.backgroundColor = .kosmosNavy
        // The pages pad for the safe area themselves (env(safe-area-inset-*)), so
        // the scroll view must not add the same inset a second time.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // Dragging the page down dismisses the keyboard, as in Messages.
        webView.scrollView.keyboardDismissMode = .interactive
        // Pull to refresh.
        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.pulledToRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
        context.coordinator.webView = webView
        context.coordinator.shell = shell
        context.coordinator.home = url
        context.coordinator.lastRetry = retryCount
        context.coordinator.lastBack = backCount
        // A cold launch from a tapped notification opens that board straight away.
        webView.load(URLRequest(url: boardToOpen?.url ?? url))
        if let request = boardToOpen {
            context.coordinator.issued = request.id
            consume(request)
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // A retry from the failure page.
        if backCount != context.coordinator.lastBack {
            context.coordinator.lastBack = backCount
            context.coordinator.failedURL = nil
            if webView.canGoBack { webView.goBack() } else { webView.load(URLRequest(url: context.coordinator.home)) }
        }
        if retryCount != context.coordinator.lastRetry {
            context.coordinator.lastRetry = retryCount
            context.coordinator.reloadOrHome()
        }
        // Each tap is loaded once, however many times SwiftUI updates before the
        // clear lands.
        guard let request = boardToOpen, context.coordinator.issued != request.id else { return }
        context.coordinator.issued = request.id
        webView.load(URLRequest(url: request.url))
        consume(request)
    }

    // Cleared on the next main-queue turn (publishing from inside a SwiftUI view
    // update is not allowed), and only if no newer tap has replaced it meanwhile.
    private func consume(_ request: PushNotificationManager.BoardRequest) {
        let manager = pushManager
        DispatchQueue.main.async {
            if manager.boardToOpen?.id == request.id { manager.boardToOpen = nil }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    // The WebView's navigation and window delegate. The decisions live in
    // ShellLogic.swift (tested); this only carries them out.
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        // The id of the last tap handed to the WebView.
        var issued: UUID?
        weak var webView: WKWebView?
        weak var shell: ShellState?
        var home: URL = KosmosConfig.boardURL
        var lastRetry = 0
        var lastBack = 0
        // The page that failed, so Try again retries IT (say, the agent a tapped
        // notification opened) and not whatever page was showing before.
        var failedURL: URL?

        func reloadOrHome() {
            // No WebView to act on: say so rather than leave Try again stuck on "Trying".
            guard let webView = webView else { shell?.retrying = false; endRefreshing(); return }
            switch Shell.retryAction(failed: failedURL, current: webView.url, home: home) {
            case .load(let url):
                failedURL = nil
                webView.load(URLRequest(url: url))
            case .reload:
                webView.reload()
            }
        }

        @objc func pulledToRefresh(_ sender: UIRefreshControl) {
            reloadOrHome()
        }

        private func endRefreshing() {
            webView?.scrollView.refreshControl?.endRefreshing()
        }

        // Main-frame navigations: Kosmos+ and the person's Macs stay in the app,
        // other sites go to Safari, other schemes are refused.
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            // A new-window request (no target frame) is decided in createWebViewWith.
            // Allowing it here is safe whatever order WebKit asks in: with no frame to
            // load into, nothing loads unless createWebViewWith loads it.
            guard let url = navigationAction.request.url,
                  let frame = navigationAction.targetFrame
            else { decisionHandler(.allow); return }
            // A frame inside the page: https and about: only.
            guard frame.isMainFrame else {
                decisionHandler(Shell.allowsSubframe(url) ? .allow : .cancel)
                return
            }
            let origin: Shell.Origin = navigationAction.navigationType == .linkActivated ? .tapped : .pageFlow
            switch Shell.linkDecision(for: url, coordinator: KosmosConfig.coordinatorOrigin, origin: origin, showing: webView.url) {
            case .inApp: decisionHandler(.allow)
            case .external:
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            case .block: decisionHandler(.cancel)
            }
        }

        // A link that asks for a new window (target=_blank, window.open): WKWebView
        // drops it unless the app decides. Same rules, and never a second WebView.
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard let url = navigationAction.request.url else { return nil }
            switch Shell.linkDecision(for: url, coordinator: KosmosConfig.coordinatorOrigin, origin: .newWindow) {
            case .inApp: webView.load(navigationAction.request)
            case .external: UIApplication.shared.open(url)
            case .block: break
            }
            return nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            endRefreshing()
            shell?.retrying = false
            failedURL = nil
            if shell?.failure != nil { shell?.failure = nil }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            show(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            show(error)
        }

        private func show(_ error: Error) {
            endRefreshing()
            shell?.retrying = false
            let e = error as NSError
            guard let failure = Shell.loadFailure(domain: e.domain, code: e.code) else { return }
            failedURL = e.userInfo[NSURLErrorFailingURLErrorKey] as? URL
            // The host only: a Mac link carries the person's sign-in token in its
            // fragment (#kst=), which must never reach a log.
            NSLog("[Shell] load failed: \(e.domain) \(e.code) host=\(failedURL?.host ?? "?")")
            shell?.failureDetail = e.localizedDescription
            shell?.failure = failure
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
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
