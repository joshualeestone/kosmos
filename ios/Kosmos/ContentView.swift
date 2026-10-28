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
    // kosmos#7032: a room the Projects tab should open (a tapped room notification), cleared once it is open. Outside the
    // screenshot switch: both builds read it.
    @State private var roomRequest: PushBridge.RoomTarget?
    // kosmos#7489: the native New project form (+ on Projects), in place of the board's slow web page.
    @State private var newProjectOpen = false
    @State private var newAgentOpen = false   // kosmos#7488
    // kosmos#7488: new agents' projects to tell once the board's list shows them (the desktop's tell after create), kept
    // here so closing New Agent early drops none.
    @State private var pendingTells: [String: (host: String, projects: [String])] = [:]   // by session
    // kosmos#7418: an agent's chat a tapped notification asked for, handed to the Agents tab to open.
    @State private var agentRequest: PushBridge.AgentTarget?
    // kosmos#7030: a signed-in launch opens on Today, native (Mona Lisa's slice 4 ruling settles #6846's open question).
    // The App Store screenshot build
    // (ios/store/shoot-app.sh) photographs board screens in the web view, opened by address, so it lights the tab
    // the bar gives that page (kosmos#7032: Projects is native now, so a project room's page shows under Today).
    #if KOSMOS_STORE_SHOTS
    @State private var tab = AppTabs.barTab(forPage: AppTabs.tab(forBoardURL: KosmosConfig.shotsOrigin),
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
            // kosmos#7030: KOSMOS_SAMPLE_TAB=today opens the native Today's samples.
            // kosmos#7031: KOSMOS_SAMPLE_TAB=tasks opens the native Tasks tab's samples.
            switch ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_TAB"] {
            case "settings": return .settings
            case "today": return AppTabs.todayTab ? .today : .agents   // kosmos#7252: no Today tab to open on
            // kosmos#7032: KOSMOS_SAMPLE_TAB=projects opens the native Projects tab's samples.
            case "projects": return .projects
            case "tasks": return .tasks   // kosmos#7031 (launch with -kosmos.app.tasksTab YES so the bar offers it)
            default: return .agents
            }
        }
        #endif
        // kosmos#7252: with Today off, a launch opens on Agents (signed out, the native sign-in shows first anyway).
        return AppTabs.todayTab ? .today : .agents
    }()
    @State private var tab = ContentView.startTab
    #endif
    // kosmos#7030: Today is native, and the board view still shows under it whatever the app sends there (a tapped
    // notification, Check it, the board's own Settings, the sign-in): true while it does. A person's press on Today
    // brings back the native screen. Not signed in yet: the board, where the sign-in is. The App Store screenshot
    // build photographs board screens, so it starts on the board too.
    #if KOSMOS_STORE_SHOTS
    @State private var todayBoard = true
    #else
    @State private var todayBoard = ContentView.startsOnBoard
    private static var startsOnBoard: Bool {
        #if DEBUG
        // The sample screenshots (a Debug build only) show the native Today, signed in or not.
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" { return false }
        #endif
        return SessionKeychain.live.load() == nil
    }
    #endif
    typealias Tab = AppTabs.Tab

    // kosmos#7042: not signed in, the native sign-in shows instead of the board's sign-in page. "Use the sign-in page"
    // (what the native screens cannot do, such as a company sign-in before iOS 17.4) turns it off for this launch.
    @State private var nativeSignIn = ContentView.startsSignedOut
    @StateObject private var signIn = SignInModel(client: SignInClient())
    private static var startsSignedOut: Bool {
        #if KOSMOS_STORE_SHOTS
        return false
        #else
        #if DEBUG
        // The sign-in's sample screens (KOSMOS_SAMPLE_SIGNIN, a Debug build only) show it signed in or not; the other
        // samples never do.
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SIGNIN"] != nil { return true }
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" { return false }
        #endif
        return SessionKeychain.live.load() == nil
        #endif
    }

    // A person's press on the bar: it also asks the board to open that tab's section. A tab the app selects itself (an
    // agent tap, a notification) does not press, so the page it was sent to stays. Where SwiftUI reports a press on
    // the tab already selected (not verified here: a device check), it presses again, which takes the section back to
    // its top, as the board's own tab does. kosmos#7030: a press on Today shows the native Today, from a page sent
    // under it too (where SwiftUI reports that press: the same device check).
    private var pressing: Binding<Tab> {
        Binding(get: { tab }, set: { new in
            if new == .today { todayBoard = false }
            tab = new
            // A native tab (Agents, Settings #7010) runs nothing on the hidden page, so an agent's chat there keeps its
            // place, and it ends any press still waiting (PressTracker.press).
            web.press(new)
        })
    }


    // kosmos#7266 slice B: the Settings tab's letter disc is drawn for the scheme in use (it is an image, not tinted).
    @Environment(\.colorScheme) private var colorScheme

    // kosmos#7266 slice B: the person's picture, the board's (BoardClient.youPicture), or in a Debug sample with
    // KOSMOS_SAMPLE_YOUPIC=1 a drawn one, so no real face is ever in a screenshot.
    // The person's name, the board's; in a Debug sample the sample's, so a shot that opens straight on Settings (before
    // any agents read) shows it.
    private var youName: String? {
        #if DEBUG
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1" { return board.youName ?? "Sam Carter" }
        #endif
        return board.youName
    }
    private var youPicture: Data? {
        #if DEBUG
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_YOUPIC"] == "1" { return YouFace.sample }
        #endif
        return board.youPicture
    }
    var body: some View {
        Group {
            if isUnlocked && nativeSignIn {
                // The sign-in page itself, freshly loaded, whatever the tabs showed before (review round 6).
                SignInView(model: signIn, useWeb: { nativeSignIn = false; showBoardToday() })
                    // Mona Lisa's spec: the app's tint is the board's ink, here as on the tabs.
                    .tint(Palette.primary)
            } else if isUnlocked {
                TabView(selection: pressing) {
                    // In Mona Lisa's order. Tasks is earned, as on the computer (#3559): the bar takes it from the
                    // board page once per launch (the first read that answers, retried for 20 s after a load, which is
                    // later than launch when the first web tab is opened late) and otherwise only on a return to the
                    // front, never on each poll.
                    ForEach(AppTabs.visible(tasksTab: web.tasksTab), id: \.self) { which in
                        tabPage(which)
                            .tabItem {
                                // kosmos#7266: Agents draws its own icon (Font Awesome Free's user-tie, a template image).
                                if which == .settings, let face = YouFace.tabImage(youPicture, letter: Board.youLetter(youName), dark: colorScheme == .dark) {
                                    // kosmos#7266 slice B: Settings shows the person's picture when the computer has one.
                                    Label { Text(which.title) } icon: { Image(uiImage: face) }
                                } else if let asset = which.asset { Label(which.title, image: asset) } else { Label(which.title, systemImage: which.symbol) }
                            }
                            // kosmos#7030: Today's badge is the board's one number, the Dock's (counts.waiting); none at 0 or off.
                            // kosmos#7032: Projects' is the board's unread room posts (counts.projectsUnread).
                            // kosmos#7252: with Today off, its number (agents waiting on you) is on Agents.
                            // kosmos#7342 (Mona Lisa's rule: every tab's number is the sum of what its own list shows): Agents
                            // shows its rows' bubbles added up; Today, like the Dock, keeps the full total.
                            .badge(which == .today && AppTabs.todayTab ? (board.waitingCount ?? 0)
                                   : which == .agents && !AppTabs.todayTab ? Board.agentsTabBadge(waiting: board.waitingCount, agents: board.agents, stale: board.agentsListStale)
                                   : which == .projects ? (board.projectsUnread ?? 0) : 0)
                            .tag(which)
                    }
                }
                // Mona Lisa's spec: the app's tint is the board's ink, so the selected tab is not system blue.
                .tint(Palette.primary)
                // kosmos#7266 (Josh 10-28): the tab bar shrinks while a list scrolls down and comes back on scrolling up,
                // the system's own behaviour on iOS 26 (Instagram-style). Earlier systems keep the bar as it is.
                .modifier(TabBarMinimizesOnScroll())
                // kosmos#7252: with Today off, a board page (a tapped notification, an agent's info button, the board's
                // own Settings or sign-in) opens over the tabs, with Close back to the tab underneath.
                .overlay { if !AppTabs.todayTab && todayBoard { boardPage } }
            } else {
                LockView(onUnlock: unlock)
            }
        }
        // A tapped notification, or an agent tapped on the Agents tab, opens on Today (the chat shows there until it is
        // native).
        .onChange(of: pushManager.boardToOpen) { request in
            if request != nil { showBoardPage() }
        }
        // kosmos#7032: a room notification from the computer this app keeps opens the room natively; from any other
        // computer it opens the board's room page under Today, as a tap always did.
        .onChange(of: pushManager.roomToOpen) { target in if let target { openRoom(target) } }
        // kosmos#7418: an agent's notification opens its chat natively, as from the Agents list.
        .onChange(of: pushManager.agentToOpen) { target in if let target { openAgentChat(target) } }
        // kosmos#7008: a sign-out or another account drops the chats now, not at the next visit to the tab.
        .onChange(of: pushManager.accountChanges) { _ in
            board.accountChanged(); web.sessionChanged()
            // kosmos#7418 review 1: a chat or room a notice asked for belonged to the account that was signed in.
            agentRequest = nil; roomRequest = nil
            pendingTells = [:]   // kosmos#7488: a tell names a project on the computer of the account that made it
            newAgentOpen = false   // kosmos#7488: the sheet sits above the tabs, so it never outlives the account
            // kosmos#7042 review round 5: signed out later in the launch (on the account page, a session that ended),
            // the next sign-in is the native one too, or the web page's own device key would make this iPhone a second
            // device on the Mac. Recorded gap: the Mac's "fresh sign-in" link then lands here, not on the page.
            #if !KOSMOS_STORE_SHOTS
            if !nativeSignIn && pushManager.lastChangeSignedOut { signIn.restart(); nativeSignIn = true }
            #endif
        }
        // kosmos#7042: Kosmos+ issued a session: the app takes it as it takes the sign-in page's, and the web view is
        // signed in with it too. The screen stays for the Mac's Allow, then opens on the native Today.
        .onChange(of: signIn.issued) { token in
            guard let token = token else { return }
            pushManager.signedInNatively(token)
            web.signedInNatively()
        }
        // The person backed out of a session already issued (Use a different email, Sign in again): it is signed out,
        // so neither the app nor the web page keeps it (review round 2).
        .onChange(of: signIn.abandoned) { _ in
            pushManager.signedOutNatively()
            if let token = signIn.lastAbandoned { web.forget(token) }
        }
        .onChange(of: signIn.step) { step in
            if step == .done { nativeSignIn = false; todayBoard = false; tab = AppTabs.todayTab ? .today : .agents }
        }
        // A press was answered: opened, the bar is on the tab pressed; refused (a box was up), it goes to the tab the
        // page really shows, so pressing the same tab again later is a real press.
        .onChange(of: web.answeredTab) { back in
            guard let back = back else { return }
            web.answeredTab = nil
            // The board can be on a Tasks section the bar does not offer (a project's View all): it lights Today
            // (Projects is native, kosmos#7032), and the page stays.
            let shown = AppTabs.barTab(forPage: back, tasksTab: web.tasksTab)
            // kosmos#7030: a board page that lights Today shows under it, not behind the native screen.
            if shown == .today { showBoardPage() } else { tab = shown }
        }
        // The page moved section by itself (a link in it, a swipe back): the bar follows, without pressing.
        .onChange(of: web.pageMove) { move in
            guard let move = move else { return }
            // kosmos#7030 review 1: the native Today is not the board, so the hidden page moving (it boots after Check it
            // was pressed and the person went back to Today) does not move the bar off it.
            if tab == .today && !todayBoard { return }
            if let next = AppTabs.follow(from: move.from, to: move.to, selected: tab, barHeld: web.barHeld, tasksTab: web.tasksTab) {
                if next == .today { showBoardPage() } else { tab = next }   // kosmos#7030, as above; #7252
            }
        }
        // Tasks left the bar (another Mac, not yet earned there) while it was the tab showing. Only a real change of tab
        // moves anything (review 1: Tasks coming or going while the native Today shows must not swap it for the board).
        // kosmos#7032: with Projects native, no tab hosts the board page until Tasks is earned, so the bar also learns
        // it from the native status poll (the engine's flag; once shown it stays, so this only ever adds the tab).
        .onChange(of: board.tasksTab) { earned in if earned == true { web.earnTasks() } }
        // A sheet shown from a tab goes with it; a tab change must not leave it set to come back by itself.
        .onChange(of: tab) { _ in newProjectOpen = false }
        // kosmos#7488: New Agent is shown from here, above the tabs, so a tab change (a notification's room, say) never
        // takes it away in the middle of making a team.
        .sheet(isPresented: $newAgentOpen) {
            NewAgentView(client: board, opened: { session, shown in
                // Say hello: the new agent's chat, natively, as a notification's agent opens (kosmos#7418).
                // On Agents, as a notification's agent opens, since the tab under the sheet may have changed meanwhile.
                if let host = board.macURL?.host {
                    agentRequest = PushBridge.AgentTarget(host: host, session: session, name: shown)
                    tab = .agents; todayBoard = false; web.press(.agents)
                }
            }, tell: { session, projects in
                // Kept with the computer that made it: a tell names a project there, never on another Mac.
                guard let host = board.macURL?.host else { return }
                pendingTells[session] = (host, projects)
                sendTells(board.agents)
            })
        }
        .onChange(of: board.agents) { rows in sendTells(rows) }
        .onChange(of: web.tasksTab) { shown in
            let kept = AppTabs.keep(tab, tasksTab: shown)
            guard kept != tab else { return }
            if kept == .today { showBoardToday() } else { select(kept) }
        }
        .onAppear {
            // A notification tapped on a cold launch can set boardToOpen before the first draw, which onChange misses.
            if pushManager.boardToOpen != nil { showBoardPage() }
            if let target = pushManager.roomToOpen { openRoom(target) }
            if let target = pushManager.agentToOpen { openAgentChat(target) }
            // Cold launch: onChange does not fire for scenePhase's initial value,
            // so prompt here when we start locked.
            if !isUnlocked { unlock() }
        }
        .onChange(of: scenePhase) { newPhase in
            // Back at the front after a real background: the bar may take Tasks now. Mona Lisa: the bar changes at
            // launch or on a return, not on each poll (a launch's first read can still land while it is on screen).
            if newPhase == .background { tabsBackgrounded = true }
            // kosmos#7050 slice C: here, not on the sign-in screen, so it runs even when the lock takes the screen away.
            if newPhase == .background { signIn.appLeft() }
            // kosmos#7416 review 3: a not-answering screen left up overnight says this morning's time on the return.
            if newPhase == .active, shell.failure == .macUnreachable { board.refreshLastSeen() }
            // kosmos#7042 review round 2: a launch before the phone's first unlock reads no session, so the sign-in may
            // be showing to someone signed in. Still on its first step, it goes once the session can be read.
            if newPhase == .active, nativeSignIn, signIn.step == .email, signIn.issued == nil,
               SessionKeychain.live.load() != nil { nativeSignIn = false }
            // kosmos#7050 slice C: only while the native sign-in is on (after the line above may have turned it off for
            // someone signed in), so a signed-in launch never asks Kosmos+ about passkeys.
            if newPhase == .active, nativeSignIn { signIn.appReturned() }
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
                newAgentOpen = false   // kosmos#7488: never left over the lock (the sheet sits above it)
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
        web.press(new)
    }

    // kosmos#7030 review 1: the app sending the person to the board under Today (the sign-in, a Mac that did not answer,
    // Tasks leaving the bar), even when Today is already showing. Its home, as the old press took it there: a press on
    // Today no longer drives the board (Today is native), so the section is asked for directly.
    private func openRoom(_ target: PushBridge.RoomTarget) {
        let kept = Board.usableSaved(SessionKeychain.macSession.load(), session: SessionKeychain.live.load(), coordinator: KosmosConfig.coordinatorOrigin)
        switch PushBridge.roomOpening(target, keptAddress: kept?.address) {
        // kosmos#7252 review 2: the room shows, not under a board page left open over the tabs. Review 3: and, as Close
        // does, the native press ends a board press still waiting, so its late answer cannot reopen the page over the room.
        case .native(let t)?: roomRequest = t; tab = .projects; todayBoard = false; web.press(.projects)
        case .board(let url)?: pushManager.boardToOpen = PushNotificationManager.BoardRequest(url: url)
        case nil: break
        }
        pushManager.roomToOpen = nil
    }

    // kosmos#7418: the chat in the Agents tab when the notice came from the computer the app shows, else the board's page
    // for that agent, as a tap always did. As for a room, the native open ends a board press still waiting.
    private func openAgentChat(_ target: PushBridge.AgentTarget) {
        // Review 1: on a cold launch nothing is shown yet (the client starts with the first tab, and the Face ID lock
        // draws no tab), so the computer this app keeps decides then, as for a room.
        let kept = Board.usableSaved(SessionKeychain.macSession.load(), session: SessionKeychain.live.load(), coordinator: KosmosConfig.coordinatorOrigin)
        switch PushBridge.agentOpening(target, shownAddress: board.switcherShown ?? kept?.address, coordinator: KosmosConfig.coordinatorOrigin) {
        case .native(let t)?: agentRequest = t; tab = .agents; todayBoard = false; web.press(.agents)
        case .board(let url)?: pushManager.boardToOpen = PushNotificationManager.BoardRequest(url: url)
        case nil: break
        }
        pushManager.agentToOpen = nil
    }

    private func showBoardToday() {
        showBoardPage()
        web.pressBoardSection(.today)
    }

    // Fire-and-forget, as the desktop, once the board can see the agent running (a tell before that is stored as
    // could not): a failed tell is recoverable from the project's own screen.
    private func sendTells(_ rows: [Board.Agent]) {
        let on = Set(rows.filter(\.boardSeesIt).map(\.session))
        guard let host = board.macURL?.host else { return }
        for (session, pending) in pendingTells where on.contains(session) && pending.host == host {
            pendingTells[session] = nil
            for id in pending.projects { Task { _ = await board.throughMac { NewAgent.tellRequest(mac: $0, project: id, session: session) } } }
        }
    }

    // kosmos#7266: a + button: the board's own create form, over the tabs, opened through the board's door.
    private func openCreate(_ what: AppTabs.Create) {
        showBoardPage()
        // Review 3: on the computer the switcher shows, loading its board first when the page is elsewhere. Review 4:
        // board.switcherURL, not the admitted session, which is unset until that computer lets the phone in.
        web.pressBoardSection(what == .agent ? .agents : .projects, door: what.rawValue, on: board.switcherURL)
    }

    // kosmos#7252: the board page, under the Today tab while it is on, or over the tabs while it is off.
    private func showBoardPage() {
        todayBoard = true
        if AppTabs.todayTab { tab = .today }
    }

    // kosmos#7252: the board page over the tabs, with Close back to the tab underneath. The same shared web view, drawn
    // here only, since no Today tab draws it while Today is off.
    private var boardPage: some View {
        VStack(spacing: 0) {
            HStack {
                // Review 1: closing also presses the tab underneath, which ends a section press still waiting for the
                // page to load (PressTracker), so a late answer cannot put the page back over the tabs.
                Button { todayBoard = false; web.press(tab) } label: {
                    Label("Close", systemImage: "chevron.down").labelStyle(.titleAndIcon)
                        .padding(.horizontal, 16).frame(minHeight: 44)
                        .contentShape(Rectangle())   // the whole 44pt row is the target, not only the words
                }
                .foregroundColor(.white)
                .accessibilityLabel("Close this page")
                Spacer()
            }
            .background(Color(UIColor.kosmosNavy).ignoresSafeArea(edges: .top))
            webBoard(.today, active: true)
        }
        .background(Color(UIColor.kosmosNavy).ignoresSafeArea())
        // Review 1: VoiceOver stays on the page, not the tabs drawn underneath it.
        .accessibilityAddTraits(.isModal)
    }

    // Agents, Projects (kosmos#7032), Tasks (kosmos#7031) and Settings are native, and Today when nothing was sent
    // under it (kosmos#7030); the rest show the board.
    @ViewBuilder private func tabPage(_ which: Tab) -> some View {
        // kosmos#7266: Today is removed from the bar (Josh, 10-26: "kill the today section altogether"); TodayView stays
        // in the target unused until the project file drops it.
        if which == .agents {
            AgentsView(client: board, push: pushManager, agentRequest: $agentRequest, openChat: { url in
                pushManager.boardToOpen = PushNotificationManager.BoardRequest(url: url)
            }, openBoard: { showBoardToday() }, create: {
                // kosmos#7488: the native New Agent flow posts to the computer this phone is connected to; before that
                // computer has let the phone in there is none, so the board page is used, as New project does.
                if board.macURL != nil { newAgentOpen = true } else { openCreate(.agent) }
            })
            #if DEBUG
            // Design shots only: KOSMOS_SAMPLE_NEWAGENT (any screen name) opens New Agent, since a simulator run cannot tap +.
            .onAppear { if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NEWAGENT"].map({ !$0.isEmpty }) == true { newAgentOpen = true } }
            #endif
        } else if which == .projects {
            // kosmos#7032: the native Projects list and a project's room; the board's own project page (the room's info
            // button) opens under Today, as an agent's chat does from Agents.
            ProjectsView(client: board, roomRequest: $roomRequest, openPage: { url in
                pushManager.boardToOpen = PushNotificationManager.BoardRequest(url: url)
            }, create: {
                // Review 2: the form posts to the computer this phone is connected to; before that computer has let the
                // phone in there is none, so the board page (which waits for it) is used, as before.
                if board.macURL != nil { newProjectOpen = true } else { openCreate(.project) }
            })
            #if DEBUG
            // Design shots only: KOSMOS_SAMPLE_NEWPROJECT=1 opens the New project form, since a simulator run cannot tap +.
            .onAppear { if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NEWPROJECT"] == "1" { newProjectOpen = true } }
            #endif
            .sheet(isPresented: $newProjectOpen) {
                NewProjectView(client: board) { id in
                    // The new project's room, on the computer the list shows.
                    // Review 2: the computer the request went to (macURL), not the switcher's, which can differ.
                    if let host = board.macURL?.host { roomRequest = PushBridge.RoomTarget(host: host, project: id) }
                }
            }
        } else if which == .tasks {
            // kosmos#7031: native Tasks. A task's page is native too (kosmos#7074, TaskPageView); its info button opens
            // the board's page under Today in the board view; a press on Tasks brings the list back.
            TasksTab(client: board, openPage: { url in
                pushManager.boardToOpen = PushNotificationManager.BoardRequest(url: url)
            })
        } else if which == .settings {
            // kosmos#7010: a Kosmos+ page (the account, the delete flow) opens under Today in the shared web view, as an
            // agent's chat does, and so does the board's own Settings.
            SettingsView(coordinator: KosmosConfig.coordinatorOrigin, openPage: { url in
                pushManager.boardToOpen = PushNotificationManager.BoardRequest(url: url)
            }, openBoardSettings: {
                // The board's own Settings, under Today (AppTabs.barTab: its Settings section lights Today).
                showBoardPage()
                web.pressBoardSection(.settings)
            }, youName: youName, youPicture: youPicture)
        } else {
            webBoard(which)
        }
    }

    private func webBoard(_ which: Tab, active: Bool? = nil) -> some View {
        ZStack {
            // Navy behind the tab bar too, so the space below the page is the page's own colour, not a white band.
            Color(UIColor.kosmosNavy).ignoresSafeArea()
            // Under the status bar as before; the tab bar keeps its own space below. How each page keeps clear
            // of the notch is set in makeWebView (safe areas). The keyboard is left to the web view, as before.
            WebView(
                web: web,
                active: active ?? (tab == which),
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
                LoadFailureView(failure: failure, detail: shell.failureDetail, retrying: shell.retrying, onRetry: shell.retry, onBack: shell.back, onOtherComputer: shell.otherComputer, macName: shell.failureMac,
                                lastHeard: board.lastHeard(address: shell.failureAddress, name: shell.failureMac))
                    // kosmos#7416 review 3 and 4: keyed on the failure, the computer and each Try again, not on the view
                    // appearing: this screen stays up across all three (a failed Try again shows the same failure), so
                    // onAppear would miss them. The return to the app is below, in onChange(of: scenePhase).
                    .task(id: "\(failure)|\(shell.failureAddress ?? "")|\(shell.retryCount)") {
                        if failure == .macUnreachable { board.refreshLastSeen() }
                    }
            }
            // kosmos#7389 (Mona Lisa): a file that takes more than a second says so, with Cancel, so a big file never looks like
            // a tap that did nothing.
            if let d = shell.downloading {
                VStack { Spacer(); DownloadLine(name: d.name, cancel: d.cancel) }
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

    // kosmos#7042: the sign-in page keeps its own copy of the session (localStorage), read by its restore() as the
    // page starts. Every document's start scripts carry the app's session for that page (SignIn.sessionScript), so it
    // opens signed in as the app is: after a native sign-in, after a restart, and over a dead session left from before.
    // Rebuilt whenever the app's session changes; a page already showing keeps what it has, and the next page the web
    // view opens has the new one. Main frame only, and the script checks the page's origin itself.
    static func userScripts(session: String?, forget: [String] = []) -> [WKUserScript] {
        var scripts = [WKUserScript(source: AppTabs.markScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)]
        if let origin = SignIn.pageOrigin(KosmosConfig.coordinatorOrigin),
           let source = SignIn.sessionScript(token: session, forget: forget, origin: origin) {
            scripts.append(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        return scripts
    }

    /// The app's session changed (a native sign-in, the page's own sign-in or sign-out, another account).
    func sessionChanged() {
        guard let controller = webView?.configuration.userContentController else { return }
        controller.removeAllUserScripts()
        Self.userScripts(session: SessionKeychain.live.load(), forget: forgotten).forEach(controller.addUserScript)
    }

    /// kosmos#7042 review round 7: sessions the app dropped (backed out of, or ended) this launch. The page may hold one
    /// (it was stored there), and its restore() would hand it back; each document's start removes it, and the page
    /// showing now is cleared at once.
    private(set) var forgotten: [String] = []

    /// A dropped session also lives in the page's own memory (its `session`, its Allow watch, which can open the Mac
    /// signed in as it), which no script reaches, so the hidden web view starts a fresh document on the sign-in page,
    /// whose start removes it (review round 8). Only ever from the native sign-in, which covers the screen, so no page
    /// the person is using is lost.
    func forget(_ token: String) {
        forgotten.append(token)
        sessionChanged()
        webView?.load(URLRequest(url: KosmosConfig.boardURL))
    }

    /// A NATIVE sign-in just finished while the page left showing is the sign-in page (signed out on it earlier in the
    /// launch): that page holds no session, so it is loaded again and starts with the app's (review round 6). Only
    /// from the native path: after the page's own sign-in the page is mid-flow and is left alone.
    func signedInNatively() {
        sessionChanged()
        if let webView, webView.url?.host == AppTabs.signInHost { webView.load(URLRequest(url: KosmosConfig.boardURL)) }
    }

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
    func press(_ tab: AppTabs.Tab, ready: Bool = false, section: Bool = false, door: String? = nil, host: String? = nil) {
        // The tracker decides from what the page is (PressTracker.Page); a press with no web view yet waits.
        let page: PressTracker.Page = webView.map { ready || !$0.isLoading ? .ready : .loading } ?? .noView
        guard let run = tracker.press(tab, page: page, section: section, door: door, host: host), let webView = webView else { return }
        webView.evaluateJavaScript(run.script) { [weak self] result, error in
            guard let self = self else { return }
            let answer = AppTabs.answer(result, error: error)
            let current = self.tracker.isCurrent(run.serial)
            if answer == .refused { NSLog("[Tabs] the board refused \(tab)") }
            if let back = self.tracker.answered(serial: run.serial, answer, pageURL: webView.url) { self.answeredTab = back }
            // kosmos#7266 review 1: a + the board turned down falls back to its section or its create page. Review 3: only
            // for the newest press, so a late answer never loads over what the person opened since.
            switch current ? AppTabs.createFallback(door: door, answer, pageURL: webView.url) : nil {
            case .projects: self.press(.projects, ready: true, section: true)
            case .load(let url): webView.load(URLRequest(url: url))
            case nil: break
            }
        }
    }

    func loadingOwnPage() { tracker.loadingOwnPage() }
    func loadFailed(host: String?) { tracker.loadFailed(host: host) }

    // kosmos#7010: the board's own section for a native tab, pressed on purpose (the Settings screen's row). When the
    // shared page is a Kosmos+ page (the account page that screen opens), there is no board to press, so the board is
    // loaded first and the press waits for it (it waits on the sign-in host, then runs once the board has loaded).
    // kosmos#7266: `door`, a create name the board's door takes instead of the section's (the + buttons).
    func pressBoardSection(_ tab: AppTabs.Tab, door: String? = nil, on computer: URL? = nil) {
        // kosmos#7266 review 3: a press meant for another computer's board loads that board first and waits for it.
        if let webView = webView, let target = AppTabs.createTarget(pageURL: webView.url, shown: computer) {
            webView.load(URLRequest(url: target))
            _ = tracker.press(tab, page: .loading, section: true, door: door, host: target.host)
            return
        }
        if let webView = webView, webView.url?.host == AppTabs.signInHost {
            webView.load(URLRequest(url: KosmosConfig.boardURL))
            _ = tracker.press(tab, page: .loading, section: true, door: door)
            return
        }
        press(tab, section: true, door: door)
    }


    // A page finished loading: run a press that waited for it, and start a launch round of Tasks reads if no read has
    // answered this launch (PressTracker.launchReads). A later load replaces the round.
    func loaded() {
        // What waits is a web tab or a section pressed on purpose (a native tab's press leaves nothing waiting), so it
        // replays as a section press.
        // kosmos#7266 review 5: a create meant for another computer replays only once that computer's board has loaded.
        if let replay = tracker.replay(host: webView?.url?.host) { press(replay.tab, ready: true, section: true, door: replay.door, host: replay.host) }
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

    // The status poll says Tasks is earned (BoardClient.tasksTab): shown and remembered, as a page read would.
    func earnTasks() {
        UserDefaults.standard.set(true, forKey: AppTabs.rememberedTasksKey)
        if !tasksTab { tasksTab = true }
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
        // kosmos#7389: nothing of a download outlives the lock: no file offered over the lock screen, no line left behind.
        coordinator.tearDownDownloads()
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
        // Every page knows it is inside the app's tab bar, so the board hides its own (#6846 part c). kosmos#7042: and the
        // sign-in page starts with the app's session (BoardWeb.userScripts).
        BoardWeb.userScripts(session: SessionKeychain.live.load(), forget: web.forgotten).forEach(config.userContentController.addUserScript)
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
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
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
            // kosmos#7389: a download the page asked for (`<a download>`) is saved only from a board's own origin
            // (Download.decideAction); anything else is refused and said, never loaded in the window instead.
            if navigationAction.shouldPerformDownload {
                switch Download.decideAction(target: url, page: pageURL, coordinator: KosmosConfig.coordinatorOrigin) {
                case .save: decisionHandler(.download)
                case .refuse(let sentence):
                    NSLog("[Download] refused a download the page asked for")
                    if frame.isMainFrame { say(sentence, refusal: true) }
                    decisionHandler(.cancel)
                }
                return
            }
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

        // MARK: kosmos#7389, a board download (the Mac's #5167 rules, Mona Lisa's design)

        // The page on screen as of its last main-frame commit: what a download is judged against (webView.url moves to
        // the new address while a navigation is still provisional). `commits` counts them, so a reload is a new page.
        var pageURL: URL?
        private var commits = 0
        // A message on screen, when the last refusal was said, and how often each refusal was said on this page.
        private var refusalLastAt: Date?
        private var refusalsShown: (commit: Int, by: [String: Int]) = (0, [:])
        // Each download's own folder and name, the one-second timer before "Getting <name>" shows, and the downloads the
        // person cancelled (their Cancel says nothing).
        private var downloadFolders: [ObjectIdentifier: URL] = [:]
        private var downloadNames: [ObjectIdentifier: String] = [:]
        private var lineTimers: [ObjectIdentifier: DispatchWorkItem] = [:]
        // The lines of downloads still on their way, newest last: the newest is shown, and when it ends the one before it is.
        private var lines: [ShellState.Downloading] = []
        // Weak, so an entry goes with its download and a later one at the same address can never inherit it.
        private let cancelledByPerson = NSHashTable<WKDownload>.weakObjects()
        // The downloads on their way, so a lock can stop them (WebKit keeps a download only as long as someone holds it).
        private var active: [ObjectIdentifier: WKDownload] = [:]

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            pageURL = webView.url
            commits += 1
        }

        // A main-frame answer: shown, saved, or refused (Download.decideResponse). A frame inside the page cannot save a
        // file just by loading.
        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                     decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            guard navigationResponse.isForMainFrame else {
                decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
                return
            }
            let http = navigationResponse.response as? HTTPURLResponse
            switch Download.decideResponse(status: http?.statusCode ?? 200, attachment: Self.isAttachment(http),
                                           canShow: navigationResponse.canShowMIMEType, target: navigationResponse.response.url,
                                           page: pageURL, coordinator: KosmosConfig.coordinatorOrigin) {
            case .show: decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
            case .save: decisionHandler(.download)
            case .refuse(let sentence):
                NSLog("[Download] refused a response the window would have saved")
                if let sentence { say(sentence, refusal: true) }
                decisionHandler(.cancel)
            }
        }

        private static func isAttachment(_ http: HTTPURLResponse?) -> Bool {
            let disposition = http?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
            return String(disposition[..<(disposition.firstIndex(of: ";") ?? disposition.endIndex)])
                .trimmingCharacters(in: .whitespaces).lowercased() == "attachment"
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
            active[ObjectIdentifier(download)] = download
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
            download.delegate = self
            active[ObjectIdentifier(download)] = download
        }

        // On lock (BoardWeb.drop): every download stops, every line goes, what is on screen is dismissed and every file
        // this kept is removed, so nothing of the board is offered over the lock or left in tmp.
        func tearDownDownloads() {
            for d in active.values { cancelledByPerson.add(d); d.cancel { _ in } }
            for id in Array(active.keys) { cleanUp(id) }
            active.removeAll()
            lines.removeAll()
            shell?.downloading = nil
            for item in waiting { if case .sheet(_, let folder) = item { try? FileManager.default.removeItem(at: folder) } }
            waiting.removeAll()
            if let folder = currentFolder { try? FileManager.default.removeItem(at: folder) }
            current?.dismiss(animated: false)
            showing = false
            current = nil
            currentFolder = nil
        }

        // A download's redirect stays on the page's own origin; anywhere else is refused (iOS has no other check there).
        func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                      decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
            // Judged against where the download started (the Mac's rule), not whichever page is on screen by now.
            if let url = request.url, Download.isSameOrigin(url, page: download.originalRequest?.url) { decisionHandler(.allow); return }
            NSLog("[Download] refused a download redirected to another address")
            cancelledByPerson.add(download)   // said here: the cancel that follows is not said again
            say(Download.redirectedElsewhere, refusal: true)
            decisionHandler(.cancel)
        }

        // What arrived, judged before anything is kept (Download.decideDestination): every board download comes here.
        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                      completionHandler: @escaping (URL?) -> Void) {
            let http = response as? HTTPURLResponse
            switch Download.decideDestination(status: http?.statusCode, mimeType: response.mimeType,
                                              attachment: Self.isAttachment(http), url: response.url ?? download.originalRequest?.url) {
            case .drop(let sentence):
                NSLog("[Download] what arrived was not the file, so nothing was kept")
                if let sentence { say(sentence, refusal: false) }
                cancelledByPerson.add(download)   // said here (or by the page): the cancel that follows is not
                completionHandler(nil)
                return
            case .keep: break
            }
            Self.sweepOnce()
            let id = ObjectIdentifier(download)
            let name = Download.fileName(suggestedFilename)
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("kosmos-download-" + UUID().uuidString, isDirectory: true)
            do { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) } catch {
                say(Download.failed(error.localizedDescription), refusal: false)
                cancelledByPerson.add(download)
                completionHandler(nil)
                return
            }
            downloadFolders[id] = folder
            downloadNames[id] = name
            // "Getting <name>" only for a file that takes more than a second (Mona Lisa).
            let show = DispatchWorkItem { [weak self, weak download] in
                guard let self, let download else { return }
                let line = ShellState.Downloading(id: id, name: name, cancel: { [weak self, weak download] in
                    guard let self, let download else { return }
                    // The person's Cancel: quiet, and cleaned up now (WebKit need not report a cancel it was asked for).
                    self.cancelledByPerson.add(download)
                    download.cancel { _ in }
                    self.cleanUp(id)
                })
                self.lines.append(line)
                self.shell?.downloading = line
            }
            lineTimers[id] = show
            DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: show)
            completionHandler(folder.appendingPathComponent(name))
        }

        func downloadDidFinish(_ download: WKDownload) {
            let id = ObjectIdentifier(download)
            active.removeValue(forKey: id)
            endLine(id)
            cancelledByPerson.remove(download)
            guard let folder = downloadFolders.removeValue(forKey: id), let name = downloadNames.removeValue(forKey: id) else { return }
            share(folder.appendingPathComponent(name), folder: folder)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            let id = ObjectIdentifier(download)
            let hadFolder = downloadFolders[id] != nil
            cleanUp(id)
            let quiet = cancelledByPerson.contains(download)
            cancelledByPerson.remove(download)
            if quiet { return }   // the person's own Cancel, or something already said
            let e = error as NSError
            // WebKit stopped it itself before it had anywhere to go: said, never a tap that did nothing.
            if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled && !hadFolder {
                say(Download.failed(Download.stoppedBeforeItBegan), refusal: false)
                return
            }
            say(Download.failed(e.localizedDescription), refusal: false)
        }

        // Folders a download left behind when the app was stopped mid-way (killed with a sheet up): gone the first time a
        // download starts in this launch. It runs before this launch makes its first folder, so every one it finds
        // belongs to an app that has already exited, and no age check is needed (reading file dates would be a
        // required-reason API the privacy manifest does not declare, kosmos#7352). That holds only while every place
        // that makes a kosmos-download- folder calls sweepOnce() first: a new one that does not could lose a live folder.
        private static var swept = false
        private static func sweepOnce() {
            guard !swept else { return }
            swept = true
            let tmp = FileManager.default.temporaryDirectory
            for url in (try? FileManager.default.contentsOfDirectory(at: tmp, includingPropertiesForKeys: nil)) ?? []
            where url.lastPathComponent.hasPrefix("kosmos-download-") {
                try? FileManager.default.removeItem(at: url)
            }
        }

        // A download that ended without a file: its line, its folder and its name go. Safe to run twice (Cancel runs it,
        // and so does the failure that may follow).
        private func cleanUp(_ id: ObjectIdentifier) {
            active.removeValue(forKey: id)
            endLine(id)
            downloadNames.removeValue(forKey: id)
            if let folder = downloadFolders.removeValue(forKey: id) { try? FileManager.default.removeItem(at: folder) }
        }

        // The line goes with ITS download; another still on its way is shown again, with its own Cancel.
        private func endLine(_ id: ObjectIdentifier) {
            lineTimers.removeValue(forKey: id)?.cancel()
            lines.removeAll { $0.id == id }
            shell?.downloading = lines.last
        }

        // What the person is shown, one at a time and in order: a message, or the share sheet with a file. Nothing is
        // dropped while another is on screen; it waits its turn (a sheet for every file that arrived, every failure).
        private enum Shown { case message(String, refusal: Bool), sheet(URL, folder: URL) }
        private var waiting: [Shown] = []
        private var showing = false
        // What is on screen now, and its file's folder when it is a sheet: if it goes without reporting back (a scene torn
        // down, a dismiss from elsewhere), the queue notices and moves on, and the folder goes.
        private weak var current: UIViewController?
        // Which presentation is current: a late report from one the queue already moved past changes nothing else.
        private var currentToken: UUID?
        private var currentFolder: URL?
        private var retries = 0

        // The share sheet with the file (Save to Files, AirDrop, send on): the sheet is the consent, so nothing is asked
        // first; closing it keeps nothing and says nothing. The file goes when the sheet does.
        private func share(_ file: URL, folder: URL) {
            waiting.append(.sheet(file, folder: folder))
            showNext()
        }

        // A refusal (a rule said no) or a failure (the file did not arrive). A refusal as the Mac's guard allows: not
        // while another message is up or waiting, at most twice per page, not within 10 s of the last. A failure always,
        // in its turn.
        func say(_ sentence: String, refusal: Bool) {
            if refusal {
                if refusalsShown.commit != commits { refusalsShown = (commits, [:]) }
                guard Download.shouldSay(up: showing || !waiting.isEmpty, refusal: true, lastAt: refusalLastAt, now: Date(),
                                         shownThisPage: refusalsShown.by[sentence, default: 0]) else { return }
                refusalsShown.by[sentence, default: 0] += 1
            }
            waiting.append(.message(sentence, refusal: refusal))
            showNext()
        }

        // Shows the next thing waiting, once nothing else is on screen. A presentation that does not happen (another is
        // still animating in or out) is tried again shortly, never lost.
        private func showNext() {
            if showing, current == nil || (current?.presentingViewController == nil && current?.isBeingPresented == false) {
                if let folder = currentFolder { try? FileManager.default.removeItem(at: folder) }
                shownEnded(); return
            }
            guard !showing, let next = waiting.first else { return }
            guard let top = Self.topController(), !top.isBeingDismissed, !top.isBeingPresented else { retryShowing(); return }
            waiting.removeFirst()
            showing = true
            retries = 0
            let token = UUID()
            let shown: UIViewController
            switch next {
            case .message(let sentence, let refusal):
                let alert = UIAlertController(title: refusal ? "Kosmos did not save that file" : "Kosmos could not save that file",
                                              message: sentence, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
                    if refusal { self?.refusalLastAt = Date() }
                    if self?.currentToken == token { self?.shownEnded() }
                })
                shown = alert
            case .sheet(let file, let folder):
                let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                sheet.completionWithItemsHandler = { [weak self] _, _, _, _ in
                    try? FileManager.default.removeItem(at: folder)   // its own file, whichever is current now
                    if self?.currentToken == token { self?.shownEnded() }
                }
                currentFolder = folder
                // An iPad shows it as a popover, which needs somewhere to point.
                sheet.popoverPresentationController?.sourceView = top.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY - 40, width: 1, height: 1)
                shown = sheet
            }
            current = shown
            currentToken = token
            top.present(shown, animated: true)
            DispatchQueue.main.async { [weak self, weak shown] in
                guard let self, shown?.presentingViewController == nil else { return }
                // It did not appear: back to the front of the line, and tried again.
                self.showing = false
                self.waiting.insert(next, at: 0)
                self.retryShowing()
            }
        }

        private func shownEnded() {
            showing = false
            current = nil
            currentToken = nil
            currentFolder = nil
            showNext()
        }

        private var retryScheduled = false
        private func retryShowing() {
            guard !retryScheduled else { return }
            // Bounded: after about ten seconds of nowhere to show it (no scene in front), what waits is given up, and a
            // sheet's file with it, rather than tried for ever.
            retries += 1
            if retries > 20 {
                retries = 0
                for item in waiting { if case .sheet(_, let folder) = item { try? FileManager.default.removeItem(at: folder) } }
                waiting.removeAll()
                NSLog("[Download] nowhere to show the waiting files and messages; given up")
                return
            }
            retryScheduled = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                self?.retryScheduled = false
                self?.showNext()
            }
        }
        private static func topController() -> UIViewController? {
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive } ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController
            while let next = top?.presentedViewController { top = next }
            return top
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
            // kosmos#7266 review 6: a create waiting for this computer's board ends with its failed load.
            web?.loadFailed(host: failingURL?.host)
            // The host only: a Mac link carries the person's sign-in token in its
            // fragment (#kst=), which must never reach a log.
            NSLog("[Shell] load failed: \(e.domain) \(e.code) host=\(failedURL?.host ?? "?")")
            shell?.failureDetail = e.localizedDescription
            // kosmos#7197: name the Mac that did not answer (its address label).
            shell?.failureMac = failure == .macUnreachable ? Shell.macName(fromHost: failingURL?.host) : nil
            shell?.failureAddress = failure == .macUnreachable ? failingURL?.host : nil
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

// kosmos#7266 slice B: the person's picture as the Settings tab draws it: a circle the size of the bar's icons, drawn as
// it is (not tinted). With no picture, their letter on the avatar cream, as an agent with none (Mona Lisa's review: a
// gear for everyone without a photo would bring back the cog Josh asked to replace). nil only while neither is known,
// so the gear shows then and never a wrong letter.
enum YouFace {
    static let tabSide: CGFloat = 26
    // Review 1: ContentView redraws on every 5 s agents read, and a picture can be several MB, so the decoded circle is
    // kept and made again only when the picture's bytes change.
    private static var lastPicture: (data: Data, image: UIImage)?
    // Review 2 nit: the profile page's picture, decoded once per picture too (Settings redraws with the board).
    private static var lastProfile: (data: Data, image: UIImage)?
    static func profileImage(_ data: Data?) -> UIImage? {
        guard let data else { return nil }
        if let last = lastProfile, last.data == data { return last.image }
        guard let picture = UIImage(data: data) else { return nil }
        let image = circle(picture, side: 88 * 3)   // the page draws it at 88 pt
        lastProfile = (data, image)
        return image
    }
    static func tabImage(_ data: Data?, letter: String?, dark: Bool) -> UIImage? {
        if let data {
            if let last = lastPicture, last.data == data { return last.image }
            if let picture = UIImage(data: data) {
                let image = circle(picture, side: tabSide).withRenderingMode(.alwaysOriginal)
                lastPicture = (data, image)
                return image
            }
        }
        guard let letter else { return nil }
        // Palette.avatarFill / avatarLetter, light and dark (AgentsView.swift).
        let fill = dark ? UIColor(red: 0x25 / 255.0, green: 0x25 / 255.0, blue: 0x29 / 255.0, alpha: 1) : UIColor(red: 0xec / 255.0, green: 0xe7 / 255.0, blue: 0xdd / 255.0, alpha: 1)
        let ink = dark ? UIColor(red: 0xc7 / 255.0, green: 0xc7 / 255.0, blue: 0xcc / 255.0, alpha: 1) : UIColor(red: 0x4a / 255.0, green: 0x4f / 255.0, blue: 0x57 / 255.0, alpha: 1)
        return UIGraphicsImageRenderer(size: CGSize(width: tabSide, height: tabSide)).image { _ in
            fill.setFill()
            UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: tabSide, height: tabSide)).fill()
            let words = NSAttributedString(string: letter, attributes: [.font: UIFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: ink])
            let size = words.size()
            words.draw(at: CGPoint(x: (tabSide - size.width) / 2, y: (tabSide - size.height) / 2))
        }.withRenderingMode(.alwaysOriginal)
    }
    static func circle(_ picture: UIImage, side: CGFloat) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { _ in
            let rect = CGRect(x: 0, y: 0, width: side, height: side)
            UIBezierPath(ovalIn: rect).addClip()
            // Fill the circle, cropping the longer side (aspect fill).
            let scale = max(side / picture.size.width, side / picture.size.height)
            let w = picture.size.width * scale, h = picture.size.height * scale
            picture.draw(in: CGRect(x: (side - w) / 2, y: (side - h) / 2, width: w, height: h))
        }
    }
    #if DEBUG
    // A drawn stand-in for a person's photo in screenshots (no real face in a picture): initials on the agents' avatar
    // cream (Palette.avatarFill / avatarLetter, light), so it reads as part of the app's palette (Mona Lisa's review).
    static let sample: Data? = UIGraphicsImageRenderer(size: CGSize(width: 240, height: 240)).image { _ in
        UIColor(red: 0xec / 255.0, green: 0xe7 / 255.0, blue: 0xdd / 255.0, alpha: 1).setFill()
        UIBezierPath(rect: CGRect(x: 0, y: 0, width: 240, height: 240)).fill()
        let words = NSAttributedString(string: "SC", attributes: [.font: UIFont.systemFont(ofSize: 96, weight: .semibold),
                                                                 .foregroundColor: UIColor(red: 0x4a / 255.0, green: 0x4f / 255.0, blue: 0x57 / 255.0, alpha: 1)])
        let size = words.size()
        words.draw(at: CGPoint(x: (240 - size.width) / 2, y: (240 - size.height) / 2))
    }.pngData()
    #endif
}

// kosmos#7266: iOS 26's tab bar minimising on scroll, where the system offers it.
private struct TabBarMinimizesOnScroll: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) { content.tabBarMinimizeBehavior(.onScrollDown) } else { content }
    }
}
