import SwiftUI
import WebKit

// The app's tab bar (kosmos#6846): Today, Agents, Projects, Tasks, Settings. Agents is the native list (#6838); the
// other four show the board in ONE shared WKWebView, each opening its own section through the board's door.
// Optionally gated behind a biometric unlock (KosmosConfig.requireBiometricUnlock).
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
    // kosmos#6838: the native Agents tab beside the web board, until every screen is native.
    @StateObject private var board = BoardClient()
    // The one web view the four web tabs share (#6846).
    @StateObject private var web = BoardWeb()
    // Whether the app has really been in the background, for the bar's Tasks check on return (tracked apart from the
    // biometric gate's didBackground, which only runs when that gate is on).
    @State private var tabsBackgrounded = false
    // A signed-in launch opens on Agents, as in slice 1, until Mona Lisa rules on opening on Today (#6846 leaves it
    // open). The App Store screenshot build
    // (ios/store/shoot-app.sh) photographs board screens in the web view, opened by address, so it lights the tab
    // that address belongs to (a project room under Projects).
    #if KOSMOS_STORE_SHOTS
    @State private var tab = AppTabs.keep(AppTabs.tab(forBoardURL: KosmosConfig.shotsOrigin),
                                          tasksTab: UserDefaults.standard.bool(forKey: AppTabs.rememberedTasksKey))
    #else
    // Not signed in yet (a first launch): open on Today, the board, where the sign-in is (the spec's "today's sign-in
    // flow"). Read once per launch (a static), not on every redraw. A launch before first unlock reads no session and
    // opens on Today, the safe side.
    private static let startTab: Tab = {
        #if DEBUG
        // The Agents tab's sample screenshots (KOSMOS_SAMPLE_AGENTS=1, a Debug build only) open on Agents, signed in or not.
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" {
            // kosmos#7010: KOSMOS_SAMPLE_TAB=settings opens the native Settings tab's samples instead.
            return ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_TAB"] == "settings" ? .settings : .agents
        }
        #endif
        return SessionKeychain.live.load() == nil ? .today : .agents
    }()
    @State private var tab = ContentView.startTab
    #endif
    typealias Tab = AppTabs.Tab

    // A person's press on the bar: it also asks the board to open that tab's section. A tab the app selects itself (an
    // agent tap, a notification) does not press, so the page it was sent to stays. Where SwiftUI reports a press on
    // the tab already selected (not verified here: a device check), it presses again, which takes the section back to
    // its top, as the board's own tab does: from an agent's chat under Today, pressing Today goes to the board's home.
    private var pressing: Binding<Tab> {
        Binding(get: { tab }, set: { new in
            tab = new
            // kosmos#7010: the native Settings tab presses nothing, so the hidden page (an agent's chat) keeps its place.
            if new != .settings { web.press(new) }
        })
    }

    var body: some View {
        Group {
            if isUnlocked {
                TabView(selection: pressing) {
                    // In Mona Lisa's order. Tasks is earned, as on the computer (#3559): the bar takes it from the
                    // board page once per launch (the first read that answers, retried for 20 s after a load, which is
                    // later than launch when the first web tab is opened late) and otherwise only on a return to the
                    // front, never on each poll.
                    ForEach(AppTabs.visible(tasksTab: web.tasksTab), id: \.self) { which in
                        tabPage(which)
                            .tabItem { Label(which.title, systemImage: which.symbol) }
                            .tag(which)
                    }
                }
                // Mona Lisa's spec: the app's tint is the board's ink, so the selected tab is not system blue.
                .tint(Palette.primary)
            } else {
                LockView(onUnlock: unlock)
            }
        }
        // A tapped notification, or an agent tapped on the Agents tab, opens on Today (the chat shows there until it is
        // native).
        .onChange(of: pushManager.boardToOpen) { request in
            if request != nil { tab = .today }
        }
        // kosmos#7008: a sign-out or another account drops the chats now, not at the next visit to the tab.
        .onChange(of: pushManager.accountChanges) { _ in board.accountChanged() }
        // A press was answered: opened, the bar is on the tab pressed; refused (a box was up), it goes to the tab the
        // page really shows, so pressing the same tab again later is a real press.
        .onChange(of: web.answeredTab) { back in
            guard let back = back else { return }
            web.answeredTab = nil
            // The board can be on a Tasks section the bar does not offer (a project's View all): it lights Projects,
            // and the page stays.
            tab = AppTabs.barTab(forPage: back, tasksTab: web.tasksTab)
        }
        // The page moved section by itself (a link in it, a swipe back): the bar follows, without pressing.
        .onChange(of: web.pageMove) { move in
            guard let move = move else { return }
            if let next = AppTabs.follow(from: move.from, to: move.to, selected: tab, barHeld: web.barHeld, tasksTab: web.tasksTab) {
                tab = next
            }
        }
        // Tasks left the bar (another Mac, not yet earned there) while it was the tab showing.
        .onChange(of: web.tasksTab) { shown in
            select(AppTabs.keep(tab, tasksTab: shown))
        }
        .onAppear {
            // A notification tapped on a cold launch can set boardToOpen before the first draw, which onChange misses.
            if pushManager.boardToOpen != nil { tab = .today }
            // Cold launch: onChange does not fire for scenePhase's initial value,
            // so prompt here when we start locked.
            if !isUnlocked { unlock() }
        }
        .onChange(of: scenePhase) { newPhase in
            // Back at the front after a real background: the bar may take Tasks now. Mona Lisa: the bar changes at
            // launch or on a return, not on each poll (a launch's first read can still land while it is on screen).
            if newPhase == .background { tabsBackgrounded = true }
            if newPhase == .active && tabsBackgrounded {
                tabsBackgrounded = false
                web.returned()
            }
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
                // The locked app keeps no page: an unlock starts a fresh web view, as before the tabs shared one,
                // opening the section of the tab still selected.
                web.drop(selected: tab)
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

    // The app moving the bar itself (not an agent tap, which loads its own page): the board follows it.
    private func select(_ new: Tab) {
        guard new != tab else { return }
        tab = new
        if new != .settings { web.press(new) }
    }

    // Agents and Settings are native; the other three show the shared board.
    @ViewBuilder private func tabPage(_ which: Tab) -> some View {
        if which == .agents {
            AgentsView(client: board, openChat: { url in
                pushManager.boardToOpen = PushNotificationManager.BoardRequest(url: url)
            }, openBoard: { select(.today) })
        } else if which == .settings {
            // kosmos#7010: a Kosmos+ page (the account, the delete flow) opens under Today in the shared web view, as an
            // agent's chat does, and so does the board's own Settings.
            SettingsView(coordinator: KosmosConfig.coordinatorOrigin, openPage: { url in
                pushManager.boardToOpen = PushNotificationManager.BoardRequest(url: url)
            }, openBoardSettings: {
                // The board's own Settings, under Today (AppTabs.barTab: its Settings section lights Today).
                tab = .today
                web.press(.settings)
            })
        } else {
            webBoard(which)
        }
    }

    private func webBoard(_ which: Tab) -> some View {
        ZStack {
            // Navy behind the tab bar too, so the space below the page is the page's own colour, not a white band.
            Color(UIColor.kosmosNavy).ignoresSafeArea()
            // Under the status bar as before; the tab bar keeps its own space below. How each page keeps clear
            // of the notch is set in makeWebView (safe areas). The keyboard is left to the web view, as before.
            WebView(
                web: web,
                active: tab == which,
                url: KosmosConfig.boardURL,
                pushManager: pushManager,
                boardToOpen: pushManager.boardToOpen,
                shell: shell,
                retryCount: shell.retryCount,
                backCount: shell.backCount,
                otherComputerCount: shell.otherComputerCount
            )
                .ignoresSafeArea(edges: .top)
                .ignoresSafeArea(.keyboard)
            if let failure = shell.failure {
                LoadFailureView(failure: failure, detail: shell.failureDetail, retrying: shell.retrying, onRetry: shell.retry, onBack: shell.back, onOtherComputer: shell.otherComputer)
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
    #if KOSMOS_STORE_SHOTS
    // App Store screenshots only (ios/store/shoot-app.sh, #6262): the throwaway board the script serves, so the
    // real app shows an invented team and never a real account. The flag is set on that script's xcodebuild line
    // alone; ios/tools/archive.sh never sets it, and ios/tools/check-no-shots-flag.sh refuses an app built with it. That check finds
    // the switch by the name "KOSMOS_SHOTS_URL" in the executable: keep the name longer than 15 bytes, since Swift
    // stores shorter strings inline where the check cannot see them (iOS CI's control build goes red if it ever can't).
    static let shotsOrigin: URL? = ProcessInfo.processInfo.environment["KOSMOS_SHOTS_URL"].flatMap { URL(string: $0) }
    static let boardURL = shotsOrigin ?? URL(string: "/", relativeTo: coordinatorOrigin)!.absoluteURL
    static func isShotsBoard(_ url: URL) -> Bool {
        guard let o = shotsOrigin else { return false }
        return url.scheme == o.scheme && url.host == o.host && url.port == o.port
    }
    #else
    static let boardURL = URL(string: "/", relativeTo: coordinatorOrigin)!.absoluteURL
    #endif

    // Require Face ID / Touch ID before the board renders. Off by default so the
    // shell behaves as before; flip to true to demonstrate the biometric-unlock
    // native surface (#718). Whether production requires it is a product decision.
    static let requireBiometricUnlock = false
}

// The one WKWebView the four web tabs share (kosmos#6846), made by the first tab that shows and moved into whichever
// tab is showing, so switching tabs never reloads and the sign-in carries across. It also runs the presses on the
// board's door and keeps the bar's Tasks flag.
final class BoardWeb: ObservableObject {
    private(set) var webView: WKWebView?
    private(set) var coordinator = WebView.Coordinator()
    // Whether the bar shows Tasks: the board's own flag, remembered so a launch shows the bar it last had.
    // Remembered for the app, not per computer (the board's own flag is per computer): after a switch, a launch shows
    // the last computer's bar until the first read lands.
    @Published private(set) var tasksTab = UserDefaults.standard.bool(forKey: AppTabs.rememberedTasksKey)
    // Set when a press is answered: the tab to put the bar on.
    @Published var answeredTab: AppTabs.Tab?
    // What to press and read, and which answers still count (ShellLogic.swift, tested).
    private var tracker = PressTracker()

    init() { coordinator.web = self }

    // Each change of the page's address (replaceState too), with the one before, so the bar can follow the page's own
    // moves between sections.
    struct PageMove: Equatable {
        let from: URL?
        let to: URL?
    }
    @Published private(set) var pageMove: PageMove?
    private var urlWatch: NSKeyValueObservation?
    // Whether the bar waits for a press rather than following the page: its script is running, or it waits while a
    // page loads (the sign-in hand-off to the Mac), when the load's own press settles where the bar goes. A press
    // waiting on a page that has loaded (an older board's absent door) does not hold it.
    var barHeld: Bool { tracker.running || (tracker.pending != nil && (webView?.isLoading ?? true)) }

    func adopt(_ webView: WKWebView) {
        self.webView = webView
        urlWatch = webView.observe(\.url, options: [.new]) { [weak self] seen, _ in
            DispatchQueue.main.async {
                guard let self = self, self.webView === seen else { return }
                guard seen.url != self.pageMove?.to else { return }
                self.pageMove = PageMove(from: self.pageMove?.to, to: seen.url)
            }
        }
    }

    // `ready` is given by a finished load (didFinish says the page is ready, whatever isLoading still reads).
    func press(_ tab: AppTabs.Tab, ready: Bool = false) {
        // The tracker decides from what the page is (PressTracker.Page); a press with no web view yet waits.
        let page: PressTracker.Page = webView.map { ready || !$0.isLoading ? .ready : .loading } ?? .noView
        guard let run = tracker.press(tab, page: page), let webView = webView else { return }
        webView.evaluateJavaScript(run.script) { [weak self] result, error in
            guard let self = self else { return }
            let answer = AppTabs.answer(result, error: error)
            if answer == .refused { NSLog("[Tabs] the board refused \(tab)") }
            if let back = self.tracker.answered(serial: run.serial, answer, pageURL: webView.url) { self.answeredTab = back }
        }
    }

    func loadingOwnPage() { tracker.loadingOwnPage() }


    // A page finished loading: run a press that waited for it, and start a launch round of Tasks reads if no read has
    // answered this launch (PressTracker.launchReads). A later load replaces the round.
    func loaded() {
        if let tab = tracker.pending { press(tab, ready: true) }
        if let round = tracker.loaded(host: webView?.url?.host) { schedule(round, at: PressTracker.launchReads) }
    }

    // The app came back to the front: a return round of reads (PressTracker.returnReads).
    func returned() { schedule(tracker.returned(), at: PressTracker.returnReads) }

    private func schedule(_ round: Int, at waits: [Double]) {
        let page = tracker.generation
        for wait in waits {
            DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
                guard let self = self, self.tracker.shouldRead(round: round, generation: page) else { return }
                self.readTasks()
            }
        }
    }

    private func readTasks() {
        let page = tracker.generation
        webView?.evaluateJavaScript(AppTabs.tasksReadScript) { [weak self] result, _ in
            guard let self = self, let shown = self.tracker.read(AppTabs.tasksTab(fromPage: result), generation: page) else { return }
            UserDefaults.standard.set(shown, forKey: AppTabs.rememberedTasksKey)
            if shown != self.tasksTab { self.tasksTab = shown }
        }
    }

    // On lock: the page goes, with its session handler, and the next tab to show makes a fresh one.
    func drop(selected: AppTabs.Tab) {
        // The old page is stopped and cut off, so a late load of it cannot report into the new page's state, and the
        // tracker moves on, so a late answer or read from it is ignored.
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        coordinator.web = nil
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: PushNotificationManager.sessionHandlerName)
        webView?.removeFromSuperview()
        urlWatch = nil
        webView = nil
        pageMove = nil
        // The fresh page opens the selected tab's section and its first read may set the bar, as at launch: it
        // comes right after an unlock, a return.
        tracker.drop(selected: selected)
        coordinator = WebView.Coordinator()
        coordinator.web = self
    }
}

// The board's WKWebView, shown in one tab. It also exposes the
// kosmosSession message handler the coordinator sign-in page posts the session to
// (#718); the origin gate lives in PushNotificationManager.handleSessionMessage.
// Every web tab has one of these; they share BoardWeb's web view and coordinator, so
// each request below is carried out once however many tabs see it.
struct WebView: UIViewRepresentable {
    let web: BoardWeb
    // Whether this tab is the one showing, so it holds the web view.
    let active: Bool
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
    // And for "Choose another computer" (kosmos#6850).
    let otherComputerCount: Int

    func makeUIView(context: Context) -> UIView {
        let host = UIView()
        host.backgroundColor = .kosmosNavy
        if web.webView == nil { web.adopt(makeWebView()) }
        if active, let webView = web.webView { show(webView, in: host) }
        return host
    }

    // The web view moves into the tab showing; the tab it left keeps an empty navy host.
    private func show(_ webView: WKWebView, in host: UIView) {
        guard webView.superview !== host else { return }
        webView.removeFromSuperview()
        webView.frame = host.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.addSubview(webView)
    }

    private func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        // WKUserContentController retains its handlers strongly; the proxy holds
        // the manager weakly so the handler never keeps anything alive.
        config.userContentController.add(
            SessionMessageProxy(target: pushManager),
            name: PushNotificationManager.sessionHandlerName
        )
        // Every page knows it is inside the app's tab bar, so the board hides its own (#6846 part c).
        config.userContentController.addUserScript(
            WKUserScript(source: AppTabs.markScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = web.coordinator
        webView.uiDelegate = web.coordinator
        // Navy until the first page paints, instead of a white flash.
        webView.isOpaque = false
        webView.backgroundColor = .kosmosNavy
        // Safe areas: the scroll view keeps WebKit's default inset behaviour, as in
        // Safari. A page that opts in with viewport-fit=cover (sign-in, the gate)
        // runs under the notch and pads itself with env(safe-area-inset-*); a page
        // that does not (the board today) is kept clear of the notch by WebKit.
        // Setting .never here would push the board's top under the status bar.
        // Dragging the page down dismisses the keyboard, as in Messages.
        webView.scrollView.keyboardDismissMode = .interactive
        // Pull to refresh.
        let refresh = UIRefreshControl()
        refresh.addTarget(web.coordinator, action: #selector(Coordinator.pulledToRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
        web.coordinator.webView = webView
        web.coordinator.shell = shell
        web.coordinator.home = url
        web.coordinator.lastRetry = retryCount
        web.coordinator.lastBack = backCount
        web.coordinator.lastOtherComputer = otherComputerCount
        // A cold launch from a tapped notification opens that board straight away.
        webView.load(URLRequest(url: boardToOpen?.url ?? url))
        if let request = boardToOpen {
            web.loadingOwnPage()
            web.coordinator.issued = request.id
            consume(request)
        }
        return webView
    }

    func updateUIView(_ host: UIView, context: Context) {
        // After a lock dropped the web view, the first tab to update makes a fresh one.
        if web.webView == nil { web.adopt(makeWebView()) }
        guard let webView = web.webView else { return }
        if active { show(webView, in: host) }
        // "Back to Kosmos" from the failure page.
        if backCount != web.coordinator.lastBack {
            web.coordinator.lastBack = backCount
            web.coordinator.failedURL = nil
            switch Shell.backAction(provisional: web.coordinator.failedProvisionally, current: webView.url, canGoBack: webView.canGoBack) {
            case .stay: break
            case .goBack: webView.goBack()
            case .home: webView.load(URLRequest(url: web.coordinator.home))
            }
        }
        // Try again from the failure page (or the automatic retry once back online).
        if retryCount != web.coordinator.lastRetry {
            web.coordinator.lastRetry = retryCount
            web.coordinator.reloadOrHome()
        }
        // kosmos#6850: "Choose another computer" from a Mac that did not answer. After Try again, so that if both
        // ever land in one update the person's choice is the load that stands.
        if otherComputerCount != web.coordinator.lastOtherComputer {
            web.coordinator.lastOtherComputer = otherComputerCount
            web.coordinator.failedURL = nil
            // A page the app chose: no waiting tab press covers it (as for a tapped agent).
            web.loadingOwnPage()
            webView.load(URLRequest(url: Shell.otherComputerURL(coordinator: KosmosConfig.coordinatorOrigin)))
        }
        // Each tap is loaded once, however many times SwiftUI updates before the
        // clear lands.
        guard let request = boardToOpen, web.coordinator.issued != request.id else { return }
        web.coordinator.issued = request.id
        web.loadingOwnPage()
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

    // Shared by every tab (and replaced on lock), so its counters below make each request run once.
    func makeCoordinator() -> Coordinator { web.coordinator }

    // The WebView's navigation and window delegate. The decisions live in
    // ShellLogic.swift (tested); this only carries them out.
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        // The holder, told when a page finishes (a press that waited, the Tasks flag).
        weak var web: BoardWeb?
        // The id of the last tap handed to the WebView.
        var issued: UUID?
        weak var webView: WKWebView?
        weak var shell: ShellState?
        var home: URL = KosmosConfig.boardURL
        var lastRetry = 0
        var lastBack = 0
        var lastOtherComputer = 0
        // The page that failed, so Try again retries IT (say, the agent a tapped
        // notification opened) and not whatever page was showing before.
        var failedURL: URL?
        // Whether that failure came before the new page committed, which decides
        // what "Back to Kosmos" does (Shell.backAction).
        var failedProvisionally = false

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
            #if KOSMOS_STORE_SHOTS
            if KosmosConfig.isShotsBoard(url) { decisionHandler(.allow); return }
            #endif
            // A frame inside the page: https and about: only.
            guard frame.isMainFrame else {
                decisionHandler(Shell.allowsSubframe(url) ? .allow : .cancel)
                return
            }
            let origin: Shell.Origin = navigationAction.navigationType == .linkActivated ? .tapped : .pageFlow
            switch Shell.linkDecision(for: url, coordinator: KosmosConfig.coordinatorOrigin, origin: origin) {
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
            failedURL = nil
            shell?.loaded()
            web?.loaded()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            show(error, provisional: true)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            show(error, provisional: false)
        }

        private func show(_ error: Error, provisional: Bool) {
            endRefreshing()
            shell?.retrying = false
            let e = error as NSError
            let failingURL = e.userInfo[NSURLErrorFailingURLErrorKey] as? URL
            guard let failure = Shell.loadFailure(domain: e.domain, code: e.code,
                                                  failingHost: failingURL?.host,
                                                  coordinator: KosmosConfig.coordinatorOrigin) else { return }
            failedURL = failingURL
            failedProvisionally = provisional
            // The host only: a Mac link carries the person's sign-in token in its
            // fragment (#kst=), which must never reach a log.
            NSLog("[Shell] load failed: \(e.domain) \(e.code) host=\(failedURL?.host ?? "?")")
            shell?.failureDetail = e.localizedDescription
            shell?.show(failure)
        }
    }

    // A tab's host going says nothing about the shared web view: BoardWeb.drop() ends it on lock.
    static func dismantleUIView(_ host: UIView, coordinator: Coordinator) {}
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
