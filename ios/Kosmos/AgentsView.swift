import SwiftUI
import UIKit

// kosmos#6838 slice 1: the native Agents tab, built to Mona Lisa's slice 1 spec (#6838, 21 Oct): one inset list of
// agents with picture, status dot, name, role and the board's own status word, the board's light and dark colours,
// rows that hold still during live updates, and the states for reaching, no agents and not updating. Tapping an
// agent opens its chat natively (ChatView, kosmos#7008).
struct AgentsView: View {
    @ObservedObject var client: BoardClient
    // kosmos#7222: notification permission is asked here, over a connected Mac's agents, not at launch.
    @ObservedObject var push: PushNotificationManager
    let openChat: (URL) -> Void
    let openBoard: () -> Void
    // kosmos#7266: the + at the top right, the board's own new-agent form (ContentView.openCreate).
    var create: () -> Void = {}
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var wasBackground = false
    // The agent whose chat is open (kosmos#7008), as it was tapped (the chat follows the list for its status).
    @State private var openAgent: Board.Agent?
    #if DEBUG
    private static var sampleOpened = false
    #endif

    // kosmos#7343: the order the list is in, kept on this phone: as the computer orders them (who needs you first), or by
    // name.
    @AppStorage("kosmos.agentSort") private var agentSort = Board.AgentSort.board.rawValue
    private var agentSortMenu: some View {
        Menu {
            Picker("Order", selection: $agentSort) {
                ForEach(Board.AgentSort.allCases, id: \.rawValue) { s in Text(Board.agentSortLabel(s)).tag(s.rawValue) }
            }
        } label: { Image(systemName: "arrow.up.arrow.down") }
        .accessibilityLabel("Order: \(Board.agentSortLabel(Board.AgentSort(rawValue: agentSort) ?? .board))")
    }

    var body: some View {
        NavigationView {
            content
                .navigationTitle("Agents")
                // kosmos#7343 (Josh 10-27, Mona Lisa's design): one bar on Agents, Projects and Tasks, no big title (the
                // tab bar names the screen): the Kosmos mark, the computer switcher, then order and + in one capsule.
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .principal) { ScreenHeading(title: "Agents") }
                    ToolbarItem(placement: .navigationBarLeading) { KosmosMark() }
                    ToolbarItem(placement: .navigationBarLeading) { MacSwitcher(client: client) }
                    ToolbarItemGroup(placement: .navigationBarTrailing) {
                        agentSortMenu
                        Button(action: create) { Image(systemName: "plus").font(.body.weight(.semibold)) }
                            .accessibilityLabel("Add agent")
                    }
                }
                .background(Palette.ground.ignoresSafeArea())
                // The link sits on the page, not on a row: a row (or the whole list) that stops being drawn, as when the
                // Mac asks for Allow again, would otherwise close the chat under the person.
                .background(
                    NavigationLink(isActive: Binding(get: { openAgent != nil }, set: { if !$0 { openAgent = nil } })) {
                        if let agent = openAgent {
                            ChatView(client: client, agent: agent, openOnBoard: {
                                if let url = client.chatURL(for: agent) { openChat(url) }
                            })
                        }
                    } label: { EmptyView() }
                    .hidden()
                )
        }
        .navigationViewStyle(.stack)
        // Signed out, another account or another Mac: the open chat was the previous one's, so it closes.
        .onChange(of: client.chatEpoch) { _ in openAgent = nil }
        .onAppear {
            visible = true
            client.show(BoardClient.agentsViewer)   // kosmos#7030: Today reads the same list
            // kosmos#7222: a change made in iOS Settings is seen here, and a yes given there registers (review 1).
            push.refreshPermission(registerIfAllowed: true)
            #if DEBUG
            // The sample chat's screenshots (a Debug build only): KOSMOS_SAMPLE_OPEN=<agent> opens that chat, once a launch.
            if !Self.sampleOpened, let open = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_OPEN"], !open.isEmpty {
                Self.sampleOpened = true
                openAgent = Board.Agent(session: open, name: open.prefix(1).uppercased() + open.dropFirst(), role: nil, state: "idle", task: nil, needsYou: false)
            }
            #endif
        }
        .onDisappear { visible = false; wasBackground = false; client.hide(BoardClient.agentsViewer) }
        // No polling in the background: stop when the app leaves the screen, resume when it comes back.
        .onChange(of: scenePhase) { phase in
            guard visible else { return }
            // Only a return from the background restarts it, not a passing Face ID prompt or Control Center.
            if phase == .background { wasBackground = true; client.stop() }
            else if phase == .active && wasBackground { wasBackground = false; client.start(); push.refreshPermission(registerIfAllowed: true) }
        }
    }

    // Whether the list is on screen, and if so whether it is marked not updating. Decided once, so the list is drawn
    // from a single place: a list drawn from several switch branches is a new list at every phase change, which throws
    // the person back to the top and cancels a pull in progress.
    private var shownList: Bool? {
        guard !client.agents.isEmpty else { return nil }
        switch client.phase {
        // A list already on screen stays while the app reconnects or the Mac does not answer, marked not updating; the
        // reaching spinner is only for a first connect with nothing to show yet (spec frame 3).
        case .starting, .connecting, .unreachable: return true
        // Back on the tab with a list from an earlier read: shown as not current until the first new read.
        case .live: return !client.fresh
        default: return nil
        }
    }

    // kosmos#7120, a Debug build only: KOSMOS_SAMPLE_STALE=1 shows the list as not updating, for its screenshots.
    #if DEBUG
    private static let sampleStale = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_STALE"] == "1"
        && ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1"   // only over the sample list
    #else
    private static let sampleStale = false
    #endif

    @ViewBuilder private var content: some View {
        if let stale = shownList {
            list(stale: stale || Self.sampleStale)
        } else {
            others
        }
    }

    // kosmos#7030: the connection states, shared with Today (BoardStates below); no agents is this tab's own.
    private var others: some View {
        BoardStates(client: client, openBoard: openBoard) { noAgents }
    }

    // No agents (spec frame 4): no list and no footer line.
    private var noAgents: some View {
        VStack(spacing: 6) {
            Text("No agents yet").font(.headline).foregroundColor(Palette.primary).accessibilityAddTraits(.isHeader)
            Text("Make your first one on your computer.").font(.subheadline).foregroundColor(Palette.secondary)
        }
        .multilineTextAlignment(.center)
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func list(stale: Bool) -> some View {
        List {
            if PushBridge.offersAsk(permission: Self.samplePermission ?? push.permission, agentsCurrent: !stale, dismissed: push.askDismissed) {
                Section {
                    notifyAsk
                        .listRowInsets(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
                        .listRowBackground(Palette.card)
                }
            }
            if stale {
                Section {
                    notUpdating
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            }
            Section(footer: footer) {
                ForEach(Board.agentOrder(client.agents, byName: agentSort == Board.AgentSort.name.rawValue)) { agent in
                    // kosmos#7008: the agent's chat, native; anything it does not draw opens the board's (openChat).
                    Button {
                        openAgent = agent
                    } label: {
                        // A picture the agent no longer has is not shown, whatever was fetched before.
                        AgentRow(agent: agent, picture: agent.hasAvatar ? client.pictures[agent.session].flatMap(UIImage.init(data:)) : nil, stale: stale)
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
                    .listRowBackground(Palette.card)
                    .listRowSeparatorTint(Palette.separator)
                    // The separator starts at the text: 16 + picture + 12 from the card edge (52 or 60 from the inset).
                    .alignmentGuide(.listRowSeparatorLeading) { _ in typeSize.isAccessibilitySize ? 60 : 52 }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Palette.ground)
        .refreshable { await client.refreshNow() }
    }

    // kosmos#7222: the one ask for notification permission, with one line saying why. "Turn on notifications" shows
    // iOS's own box; "Not now" hides this for good (iOS Settings still turns them on).
    private var notifyAsk: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Get a buzz when an agent needs you")
                .font(.headline).foregroundColor(Palette.primary)
                .accessibilityAddTraits(.isHeader)
            Text("Kosmos can tell you when an agent asks you something or needs your permission, even when this app is closed.")
                .font(.subheadline).foregroundColor(Palette.secondary)
                .fixedSize(horizontal: false, vertical: true)
            // Review 1: side by side, or stacked at the accessibility text sizes so neither label is squeezed.
            let buttons = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12)) : AnyLayout(HStackLayout(spacing: 12))
            buttons {
                Button { push.requestAuthorizationAndRegister() } label: {
                    Text("Turn on notifications").foregroundColor(Palette.card)
                }
                .buttonStyle(.borderedProminent)
                Button("Not now") { push.dismissAsk() }
                    .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // kosmos#7222, a Debug build only: over the sample list the ask shows only with KOSMOS_SAMPLE_NOTIFASK=1, for its
    // screenshots; every other sample shot stays as it was (review 1: a fresh simulator reads notDetermined, so without
    // this the card would appear on all of them).
    #if DEBUG
    private static let samplePermission: PushBridge.Permission? = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_AGENTS"] == "1"
        ? (ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOTIFASK"] == "1" ? .notDetermined : .allowed) : nil
    #else
    private static let samplePermission: PushBridge.Permission? = nil
    #endif

    // Lost while open (spec frames 5 and 6): the time of the last good read, in the system's time format.
    private var notUpdating: some View {
        // "Isn't answering" only when that is what happened; while reconnecting or checking it says it is checking.
        Text(notUpdatingWords + (client.updatedAt.map { " Last checked \($0.formatted(date: .omitted, time: .shortened))." } ?? ""))
            .font(.footnote)
            .foregroundColor(Palette.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 10)
            .padding(.horizontal, 14)
            .background(RoundedRectangle(cornerRadius: 10).fill(Palette.banner))
    }

    private var notUpdatingWords: String {
        if case .unreachable = client.phase { return Shell.notUpdatingLine(client.failingMacName) }   // kosmos#7197: named
        return "Checking for updates."
    }

    // kosmos#7266 (Mona Lisa's design review): the + above adds an agent from the phone (the board's own form, over the
    // tabs), so the footer no longer says new agents are set up on the computer.
    private var footer: some View {
        Text("Models and connections are set up on your computer.")
            .font(.footnote)
            .foregroundColor(Palette.tertiary)
    }
}

// The states before a list can be shown, and after a refusal (kosmos#6838 slice 1's frames), for every tab that reads
// the agents list: Agents, and Today (kosmos#7030). `empty` is what a live Mac with nothing to list shows.
struct BoardStates<Empty: View>: View {
    @ObservedObject var client: BoardClient
    let openBoard: () -> Void
    @ViewBuilder let empty: () -> Empty

    var body: some View {
        switch client.phase {
        case .starting:
            reaching
        case .live:
            // The list arrives with the first read; until then (or with an empty earlier list not yet re-read) this is
            // still reaching, not "No agents yet".
            if client.updatedAt == nil || !client.fresh { reaching } else { empty() }
        case .unreachable(let mac):
            // Today's navy page, as it is: no title over it, and Back opens Today, the board. kosmos#7197: naming the Mac.
            LoadFailureView(failure: .macUnreachable, detail: "", retrying: false, onRetry: client.retry, onBack: openBoard, macName: mac)
                .navigationBarHidden(true)
        case .kosmosPlusDown:
            LoadFailureView(failure: .unreachable, detail: "", retrying: false, onRetry: client.retry, onBack: openBoard)
                .navigationBarHidden(true)
        case .signedOut:
            VStack(spacing: 12) {
                message("Sign in to Kosmos+", detail: "Your agents show here once you are signed in.")
                Button { openBoard() } label: { Text("Sign in").foregroundColor(Palette.card) }
                    .buttonStyle(.borderedProminent)
            }
        case .noMac:
            message("No Mac to connect to.", detail: "Turn on remote access in Kosmos on your computer, then try again.", retry: true)
        case .waitingForAllow(let mac, let code):
            VStack(spacing: 12) {
                message("Allow this iPhone on \(mac).",
                        detail: code.map { "Your Mac is showing a code. Check it matches: \($0)" } ?? "Your Mac is asking whether to let this iPhone in.")
                ProgressView().accessibilityLabel("Waiting for your Mac")
            }
            .accessibilityElement(children: .combine)
            // The code is spelled out character by character, as the gate page reads it.
            .accessibilityLabel("Allow this iPhone on \(mac). " + (code.map { "Your Mac is showing a code. Check it matches: \($0.map(String.init).joined(separator: " "))" } ?? "Your Mac is asking whether to let this iPhone in."))
            .accessibilityAddTraits(.updatesFrequently)
        case .connecting(let mac):
            VStack(spacing: 12) {
                message("Connecting to \(mac).", detail: "This can take a moment, for example just after your Mac starts.")
                ProgressView().accessibilityLabel("Waiting for your Mac")
            }
        case .denied(let mac):
            message("\(mac) did not allow this iPhone.", detail: "You can allow it in Kosmos on your computer, under Remote access, then try again.", retry: true)
        case .macRefused(let mac):
            message("\(mac) did not accept this iPhone's sign-in.", detail: "Try again in a moment. If it keeps happening, log out under Settings, Kosmos+, and sign in again.", retry: true)
        case .kosmosPlusRefused:
            // kosmos#7030 review 2: Today is native now, so "on the Today tab" no longer leads to a sign-in; the button does.
            VStack(spacing: 12) {
                message("Kosmos+ did not let this iPhone in.", detail: "If this iPhone was removed from your account, sign in again. Otherwise try again in a moment.", retry: true)
                Button { openBoard() } label: { Text("Sign in") }
            }
        }
    }

    // First connect, nothing shown yet (spec frame 3).
    private var reaching: some View {
        VStack(spacing: 8) {
            ProgressView()
            Text("Reaching your computer\u{2026}").font(.footnote).foregroundColor(Palette.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func message(_ title: String, detail: String, retry: Bool = false) -> some View {
        VStack(spacing: 12) {
            VStack(spacing: 6) {
                Text(title).font(.headline).foregroundColor(Palette.primary).accessibilityAddTraits(.isHeader)
                Text(detail).font(.subheadline).foregroundColor(Palette.secondary).multilineTextAlignment(.center)
            }
            if retry {
                // The app's tint is ink (near-white in dark), so the label takes the card colour to stay readable.
                Button { client.retry() } label: { Text("Try again").foregroundColor(Palette.card) }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct AgentRow: View {
    let agent: Board.Agent
    let picture: UIImage?
    // Not updating: every dot quiet and every word secondary, so nothing old reads as live or urgent.
    let stale: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    private var word: String { Board.statusWord(agent) }
    private var large: Bool { typeSize.isAccessibilitySize }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            avatar
            if large {
                // The largest text sizes: the status goes under the role, and nothing truncates it.
                VStack(alignment: .leading, spacing: 2) { name; role; status }
            } else {
                VStack(alignment: .leading, spacing: 2) { name; role }
                Spacer(minLength: 8)
                status.layoutPriority(1)
            }
        }
        .frame(minHeight: 40)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        // A list shown as not current says so to VoiceOver too, not only by colour.
        .accessibilityLabel(([agent.name, agent.role, word, stale ? nil : Board.presenceWords(Board.presence(agent), word: word),
                              Board.memoryWords(agent.contextPercent, full: agent.contextFull)]
                             + (stale ? ["not updating"] : [])).compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Opens the chat")
    }

    private var size: CGFloat { large ? 48 : 40 }

    private var avatar: some View {
        AgentAvatar(name: agent.name, picture: picture, tone: nil, presence: stale ? .unsure : Board.presence(agent), size: size, memoryPercent: agent.contextPercent,
                    memoryQuiet: stale)
    }

    private var name: some View {
        Text(agent.name).font(.callout.weight(.semibold)).foregroundColor(Palette.primary).lineLimit(large ? nil : 1)
    }

    @ViewBuilder private var role: some View {
        if let role = agent.role {
            Text(role).font(.footnote).foregroundColor(Palette.secondary).lineLimit(large ? nil : 1)
        }
    }

    // The board's own word, never truncated (it wraps at the largest sizes rather than run off the row); a live
    // change crossfades in 0.2s, the animation on the container so the outgoing word fades as the new one comes in.
    // kosmos#7342: a pill only when there is something to see (Board.pill); Idle shows nothing. Not updating: every row
    // keeps its last word in a grey pill, Idle included, so no row reads as current.
    @ViewBuilder private var status: some View {
        ZStack(alignment: large ? .leading : .trailing) {
            if stale || Board.pill(agent) != nil {
                StatusPill(word: word, pill: stale ? .cantTell : Board.pill(agent) ?? .cantTell, wraps: large)
                    .id(word)
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: word)
    }
}

// An agent's picture (or its first letter) with its status dot, as slice 1 draws it; shared with Today (kosmos#7030).
// A nil tone draws no dot (a ready-to-check card marked by the person names no agent).
struct AgentAvatar: View {
    let name: String
    let picture: UIImage?
    let tone: Board.Tone?
    // kosmos#7341: when set, the dot is the agent's presence (green, grey, hollow) rather than its tone. The Agents list
    // sets it; screens that still colour by state pass a tone instead.
    var presence: Board.Presence? = nil
    let size: CGFloat
    // kosmos#7120: the context ring round the picture, as the board's list row draws it (lrowRing); nil draws none.
    var memoryPercent: Double? = nil
    // A list that is not updating draws the arc in the secondary colour its words take then (opaque, so it stays clear of
    // the translucent track).
    var memoryQuiet = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let picture {
                    Image(uiImage: picture).resizable().scaledToFill()
                } else {
                    ZStack {
                        Palette.avatarFill
                        Text(String(name.prefix(1)).uppercased())
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(Palette.avatarLetter)
                    }
                }
            }
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay { memoryRing }
            if let presence {
                // kosmos#7341: hollow is a ring in the quiet grey on the card colour, as the board's pjd-unk.
                Circle()
                    .fill(presence == .unsure ? Palette.card : Palette.presence(presence))
                    .overlay(Circle().inset(by: 1.5).stroke(presence == .unsure ? Palette.presence(.off) : .clear, lineWidth: 1.5))
                    .frame(width: 12, height: 12)
                    .overlay(Circle().stroke(Palette.card, lineWidth: 2))
                    .offset(x: 1, y: 1)
                    .animation(.easeInOut(duration: 0.2), value: presence)
            } else if let tone {
                // The status dot, 12pt with a 2pt ring in the card colour, 1pt outside the picture.
                Circle()
                    .fill(Palette.dot(tone))
                    .frame(width: 12, height: 12)
                    .overlay(Circle().stroke(Palette.card, lineWidth: 2))
                    .offset(x: 1, y: 1)
                    .animation(.easeInOut(duration: 0.2), value: tone)
            }
        }
        .accessibilityHidden(true)
    }

    // A track and an arc of the percent from 12 o'clock, just outside the picture, one weight in every band as the
    // board's small rings keep (the arc's length carries the value, the colour repeats it). It overhangs the picture's
    // layout frame by about 4.75 pt each side (an overlay takes no room), inside the row's 12 pt spacing.
    @ViewBuilder private var memoryRing: some View {
        if let pct = memoryPercent, let band = Board.memBand(pct) {
            ZStack {
                Circle().stroke(Palette.ringTrack, lineWidth: 2.5)
                Circle()
                    .trim(from: 0, to: pct / 100)   // already held to 0...100 (Board.contextPercent)
                    .stroke(memoryQuiet ? Palette.secondary : Palette.ring(band), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            .frame(width: size + 7, height: size + 7)
        }
    }
}

// The board's own light and dark tokens (web/index.html), as Mona Lisa's slice 1 spec lists them.
enum Palette {
    static func pair(_ light: UInt32, _ dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) -> Color {
        func color(_ hex: UInt32, _ alpha: CGFloat) -> UIColor {
            UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
        }
        return Color(UIColor { $0.userInterfaceStyle == .dark ? color(dark, darkAlpha) : color(light, lightAlpha) })
    }
    static let ground = pair(0xfaf9f7, 0x0c0d0f)
    static let card = pair(0xffffff, 0x17191c)
    static let primary = pair(0x14161a, 0xf5f5f4)
    static let secondary = pair(0x4a4f57, 0xa9adb3)
    static let tertiary = pair(0x14161a, 0xf5f5f4, lightAlpha: 0.61, darkAlpha: 0.47)
    static let separator = pair(0xe3e1dc, 0x2a2d31)
    static let avatarFill = pair(0xece7dd, 0x252529)
    static let avatarLetter = pair(0x4a4f57, 0xc7c7cc)
    // kosmos#7120: the board's .gt track and .gf ok, warn, high (high lightens in dark, as the board's does).
    static let ringTrack = pair(0x14161a, 0xf5f5f4, lightAlpha: 0.10, darkAlpha: 0.14)
    static let ringOk = pair(0x2f7d5a, 0x2f7d5a)
    static let ringWarn = pair(0xd97528, 0xd97528)
    static let ringHigh = pair(0xb3261e, 0xff8c82)
    static func ring(_ band: Board.MemBand) -> Color {
        switch band { case .ok: return ringOk; case .warn: return ringWarn; case .high: return ringHigh }
    }
    static let banner = pair(0xf3efe6, 0x1c1f23)
    static let askedWord = pair(0x7a5200, 0xffca55)
    static let dangerWord = pair(0xb3261e, 0xff6b5e)
    // kosmos#7030: the board's built colour (--pj-mention), the dot before a ready-to-check card's "Marked built" line.
    static let built = pair(0x0a58d8, 0x5aa2ff)

    // kosmos#7341: the presence dot, the board's green and grey (unsure is drawn as a ring of the grey).
    static func presence(_ p: Board.Presence) -> Color {
        switch p {
        case .on: return dot(.working)
        case .off, .unsure: return dot(.quiet)
        }
    }

    // kosmos#7342: the pills' ground and words (Mona Lisa's values; each word clears 4.5:1 on its own ground).
    static func pillGround(_ p: Board.Pill) -> Color {
        switch p {
        case .working: return pair(0xe3f1e8, 0x173a26)
        case .asks: return pair(0xe6eefb, 0x1b2c4a)
        case .held: return pair(0xfbefd9, 0x3d2e0f)
        case .problem: return pair(0xfbe3e1, 0x4a1c19)
        case .cantTell: return pair(0xececee, 0x2c2c2e)
        }
    }
    static func pillWord(_ p: Board.Pill) -> Color {
        switch p {
        case .working: return pair(0x2b7149, 0x6fd69a)
        case .asks: return pair(0x2d5fb3, 0x8fb4ff)
        case .held: return pair(0x8a5a00, 0xf2c260)
        case .problem: return pair(0xb3261e, 0xff8a80)
        case .cantTell: return pair(0x5f5f66, 0xa1a1a8)
        }
    }

    static func dot(_ tone: Board.Tone) -> Color {
        switch tone {
        case .working: return pair(0x1f7a4d, 0x4ade80)
        case .asked: return pair(0xd6a62e, 0xe3b341)
        case .needsYou: return pair(0xb3261e, 0xff6b5e)
        case .quiet: return pair(0xa9adb3, 0x6e7278)
        }
    }

    static func word(_ tone: Board.Tone) -> Color {
        switch tone {
        case .asked: return askedWord
        case .needsYou: return dangerWord
        case .working, .quiet: return secondary
        }
    }
}

// kosmos#7343 (Mona Lisa's design): the Kosmos mark at the bar's left, a 44 pt gold circle (the app icon's gold) with
// the icon's dotted K. Decoration only, so VoiceOver skips it.
struct KosmosMark: View {
    var body: some View {
        ZStack {
            Circle().fill(Color(red: 0xe2 / 255, green: 0xac / 255, blue: 0x1e / 255))
            Image("KosmosMark").resizable().scaledToFill().frame(width: 38, height: 38).clipShape(Circle())
        }
        .frame(width: 44, height: 44)
        .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
        .accessibilityHidden(true)
    }
}

// kosmos#7343: no title shows in the bar, but VoiceOver still hears the screen's name as its heading.
struct ScreenHeading: View {
    let title: String
    var body: some View {
        Color.clear.frame(width: 1, height: 1)
            .accessibilityElement()
            .accessibilityLabel(title)
            .accessibilityAddTraits(.isHeader)
    }
}

// kosmos#7266 slice C: the Kosmos switcher, top left of Agents and Projects. It names the computer whose agents and
// projects are shown; with two or more on the account it opens a list of them, online or offline, the shown one
// checked, and choosing one shows that computer (BoardClient.showMac). With one it is the name alone.
struct MacSwitcher: View {
    @ObservedObject var client: BoardClient

    var body: some View {
        let rows = Board.switcherRows(client.macs, shown: client.switcherShown)
        let name = rows.first(where: \.shown)?.name ?? client.shownMacName ?? client.phase.macName
        if let name {
            if rows.count > 1 {
                Menu {
                    Section("Your computers") {
                        ForEach(rows, id: \.address) { row in
                            Button { client.showMac(address: row.address) } label: {
                                if row.shown {
                                    Label { Text(row.name); Text(row.status) } icon: { Image(systemName: "checkmark") }
                                } else {
                                    Text(row.name); Text(row.status)
                                }
                            }
                            .accessibilityLabel("\(row.name), \(row.status)\(row.shown ? ", showing" : "")")
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(name).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                    }
                    .foregroundColor(Palette.primary)
                }
                .accessibilityLabel("Showing \(name)")
                .accessibilityHint("Choose another computer")
            } else {
                Text(name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    .foregroundColor(Palette.secondary)
                    .accessibilityLabel("Showing \(name)")
            }
        }
    }
}

// kosmos#7342: one status pill, 20 pt tall and fully round, 12 pt semibold with 8 pt sides. Working carries the board's
// Sweep: three dots lit one after another (Josh's pick, 09-05); with Reduce Motion they stand still, the first lit.
struct StatusPill: View {
    let word: String
    let pill: Board.Pill
    var wraps = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 5) {
            if pill == .working { sweep }
            Text(word)
                .font(.caption.weight(.semibold))
                .fixedSize(horizontal: !wraps, vertical: true)
        }
        .foregroundColor(Palette.pillWord(pill))
        .padding(.horizontal, 8)
        .frame(minHeight: 20)
        .background(Capsule().fill(Palette.pillGround(pill)))
    }

    @ViewBuilder private var sweep: some View {
        if reduceMotion {
            dots { i in i == 0 ? 1 : 0.25 }
        } else {
            // 30 frames a second is smooth for a 1.2 s fade and costs less than the display's own rate.
            TimelineView(.periodic(from: .now, by: 1.0 / 30)) { context in
                let t = context.date.timeIntervalSinceReferenceDate
                dots { i in Board.sweepOpacity(t - Double(i) * 0.2) }
            }
        }
    }

    private func dots(_ opacity: @escaping (Int) -> Double) -> some View {
        HStack(spacing: 2.5) {
            ForEach(0..<3, id: \.self) { i in
                Circle().frame(width: 4, height: 4).opacity(opacity(i)).scaleEffect(0.7 + 0.4 * (opacity(i) - 0.25) / 0.75)
            }
        }
        .accessibilityHidden(true)
    }

}
