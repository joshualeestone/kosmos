import SwiftUI

// kosmos#6838 slice 1: the native Agents tab (Mona Lisa's design, 2026-10-19): one
// line per agent with name, role and one word of status; the one that asked you
// is marked. Tapping an agent opens its chat on the Board tab until Chat is native.
struct AgentsView: View {
    @ObservedObject var client: BoardClient
    let openChat: (URL) -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    @State private var wasBackground = false

    var body: some View {
        NavigationView {
            content
                .navigationTitle("Agents")
        }
        .navigationViewStyle(.stack)
        .onAppear { visible = true; client.start() }
        .onDisappear { visible = false; client.stop() }
        // No polling in the background: stop when the app leaves the screen, resume when it comes back.
        .onChange(of: scenePhase) { phase in
            guard visible else { return }
            // Only a return from the background restarts it, not a passing Face ID prompt or Control Center.
            if phase == .background { wasBackground = true; client.stop() }
            else if phase == .active && wasBackground { wasBackground = false; client.start() }
        }
    }

    @ViewBuilder private var content: some View {
        switch client.phase {
        case .starting:
            ProgressView("Connecting to your Mac")
        case .signedOut:
            message("Sign in to Kosmos+ on the Board tab.", detail: "Your agents show here once you are signed in. If you already are, sign out there and in again.")
        case .noMac:
            VStack(spacing: 12) {
                message("No Mac to connect to.", detail: "Turn on remote access in Kosmos on your computer, then try again.")
                Button("Try again") { client.retry() }
                    .buttonStyle(.borderedProminent)
            }
        case .waitingForAllow(let mac, let code):
            message("Allow this iPhone on \(mac).",
                    detail: code.map { "Your Mac is showing a code. Check it matches: \($0)" } ?? "Your Mac is asking whether to let this iPhone in.")
        case .denied(let mac):
            VStack(spacing: 12) {
                message("\(mac) did not allow this iPhone.", detail: "You can allow it in Kosmos on your computer, under Remote access, then try again.")
                Button("Try again") { client.retry() }
                    .buttonStyle(.borderedProminent)
            }
        case .kosmosPlusRefused:
            VStack(spacing: 12) {
                message("Kosmos+ did not let this iPhone in.", detail: "Sign out on the Board tab and in again, then try once more.")
                Button("Try again") { client.retry() }
                    .buttonStyle(.borderedProminent)
            }
        case .kosmosPlusDown:
            VStack(spacing: 12) {
                message("Kosmos+ could not be reached.", detail: "Check your connection, then try again.")
                Button("Try again") { client.retry() }
                    .buttonStyle(.borderedProminent)
            }
        case .macRefused(let mac):
            VStack(spacing: 12) {
                message("\(mac) did not accept this iPhone's sign-in.", detail: "Sign out on the Board tab and in again, then try once more.")
                Button("Try again") { client.retry() }
                    .buttonStyle(.borderedProminent)
            }
        case .unreachable(let mac):
            VStack(spacing: 12) {
                message("\(mac) is not answering.", detail: "It may be asleep or offline.")
                Button("Try again") { client.retry() }
                    .buttonStyle(.borderedProminent)
            }
        case .live(let mac):
            list(mac)
        }
    }

    private func list(_ mac: Board.Mac) -> some View {
        List {
            // Which computer these agents are on, for an account with more than one.
            Section(header: Text("On \(mac.name)"), footer: footer) {
                ForEach(client.agents) { agent in
                    Button {
                        if let url = client.chatURL(for: agent) { openChat(url) }
                    } label: {
                        AgentRow(agent: agent)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if client.updatedAt == nil {
                ProgressView().accessibilityLabel("Loading your agents")
            } else if client.agents.isEmpty {
                message("No agents yet.", detail: "Agents you create on your computer show here.")
            }
        }
    }

    // A list more than a minute old says when it was last read, so an old list never reads as current.
    private var footer: some View {
        TimelineView(.periodic(from: .now, by: 15)) { context in
            VStack(alignment: .leading, spacing: 4) {
                if let at = client.updatedAt, context.date.timeIntervalSince(at) > 60 {
                    Text("Last updated \(at.formatted(date: .omitted, time: .shortened)).")
                }
                Text("New agents, models and connections are set up on your computer.")
            }
        }
    }

    private func message(_ title: String, detail: String) -> some View {
        VStack(spacing: 6) {
            Text(title).font(.headline).accessibilityAddTraits(.isHeader)
            Text(detail).font(.subheadline).foregroundColor(.secondary).multilineTextAlignment(.center)
        }
        .padding()
    }
}

struct AgentRow: View {
    let agent: Board.Agent
    @Environment(\.dynamicTypeSize) private var typeSize

    // Amber that keeps AA contrast as body text: #8A5A00 on white is about 6:1, #F5B942 on the dark
    // grouped background about 9:1. System orange on white is under 3:1.
    static let askedColor = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0xF5 / 255, green: 0xB9 / 255, blue: 0x42 / 255, alpha: 1)
            : UIColor(red: 0x8A / 255, green: 0x5A / 255, blue: 0x00 / 255, alpha: 1)
    })

    var body: some View {
        Group {
            if typeSize.isAccessibilitySize {
                // The largest text sizes: the status goes under the name rather than being cut off beside it.
                VStack(alignment: .leading, spacing: 2) { names; status }
            } else {
                HStack(spacing: 12) {
                    ZStack {
                        Circle().fill(Color(.systemGray5)).frame(width: 36, height: 36)
                        Text(String(agent.name.prefix(1)).uppercased()).font(.subheadline.weight(.semibold))
                    }
                    .accessibilityHidden(true)
                    names.layoutPriority(1)
                    Spacer()
                    status
                }
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the chat")
    }

    private var names: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(agent.name).font(.body.weight(.semibold))
            if let role = agent.role {
                Text(role).font(.subheadline).foregroundColor(.secondary)
            }
        }
    }

    // Anything that needs you (Board.needsYou) is in amber, in the board's own words.
    private var status: some View {
        Text(Board.statusWord(agent))
            .font(.subheadline.weight(agent.askedYou ? .semibold : .regular))
            .foregroundColor(agent.askedYou ? AgentRow.askedColor : .secondary)
    }
}
