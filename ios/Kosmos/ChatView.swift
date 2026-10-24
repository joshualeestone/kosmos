import SwiftUI

// kosmos#7008 (the iPhone plan's slice 3, first part): one agent's conversation, native, built to Mona Lisa's slice 3a
// spec (~/work/workers/monalisa/ios-design-2026-10-19/slice3a/SPEC.md, on the card). Reads and sends through
// BoardClient's own session to the Mac (the routes the board's chat uses). What this part does not draw (a question's
// buttons, a permission card, a file, older messages) is a way-through row that opens the agent's chat on the board,
// as the header's info button does. The layout and sending decisions are in BoardLogic.swift (tested).
struct ChatView: View {
    @ObservedObject var client: BoardClient
    let agent: Board.Agent
    let openOnBoard: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var thread: Board.Thread?
    @State private var lastRead: Date?
    @State private var failedReads = 0
    // The Mac's own reason it gave no conversation (a name it refuses, a history it could not read).
    @State private var refusal: String?
    @State private var loop: Task<Void, Never>?
    @State private var atBottom = true
    @State private var unseenNew = false
    // The words in the box. Kept here while the chat is open (typing redraws only the chat) and given to the client when
    // it goes, so leaving the chat never loses them.
    @State private var draftText = ""
    // Reads are numbered: only one newer than the last shown is shown, so a slow earlier read never undoes a newer one.
    @State private var readsStarted = 0
    @State private var readShown = 0
    // Shown on screen (not just alive in a hidden tab), and the client's forgetting count this chat was opened under.
    @State private var visible = false
    @State private var epoch = 0
    @State private var lastPendingCount = 0
    @State private var keepNewestInView = true

    // The agent as the list shows it now (its word and tone move with the board), or as it was tapped.
    private var shown: Board.Agent { client.agents.first { $0.session == agent.session } ?? agent }
    private var running: Bool { client.isRunning(agent) }
    private var lost: Bool { failedReads >= 3 }
    private var working: Bool { !lost && Board.tone(shown) == .working }
    private var pending: [Board.PendingSend] { client.pending[agent.session] ?? [] }
    private var widthShare: CGFloat { typeSize.isAccessibilitySize ? 0.85 : 0.78 }

    var body: some View {
        VStack(spacing: 0) {
            if thread != nil, let note = bannerText { banner(note) }
            ZStack(alignment: .bottom) {
                conversation
                if unseenNew { newMessagesCapsule }
            }
            composer
        }
        .background(Palette.ground.ignoresSafeArea())
        // Mona Lisa's review: the tab bar would stack under the composer and take about 170pt, so it hides here.
        .toolbar(.hidden, for: .tabBar)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { title }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: openOnBoard) {
                    Image(systemName: "info.circle").font(.system(size: 22)).foregroundColor(Palette.secondary)
                }
                .accessibilityLabel("Open on your computer's board")
            }
        }
        .onAppear {
            visible = true
            epoch = client.chatEpoch
            lastPendingCount = pending.count
            // Only into an empty box: if SwiftUI shows the chat again without having hidden it, the words being typed stay.
            if draftText.isEmpty { draftText = client.drafts[agent.session] ?? "" }
            startReading()
        }
        .onDisappear {
            visible = false
            // Not into another account's chats: a draft from before a sign-out is dropped with the rest.
            if epoch == client.chatEpoch { client.drafts[agent.session] = draftText }
            loop?.cancel()
            loop = nil
        }
        // Signed out, another account or another Mac: what this chat shows belongs to the one before, so it goes.
        .onChange(of: client.chatEpoch) { now in
            epoch = now
            thread = nil
            draftText = ""
            refusal = nil
            failedReads = 0
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background { loop?.cancel(); loop = nil } else if phase == .active, visible, loop == nil { startReading() }
        }
    }

    private var title: some View {
        let tone = Board.tone(shown)
        let strong = tone == .asked || tone == .needsYou
        return VStack(spacing: 1) {
            Text(shown.name).font(.headline).foregroundColor(Palette.primary).lineLimit(1)
            // Lost while open: the word goes quiet, since it is no longer current (spec, state 4).
            Text(Board.statusWord(shown))
                .font(.caption.weight(strong && !lost ? .semibold : .regular))
                .foregroundColor(lost ? Palette.secondary : Palette.word(tone))
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }

    // Above a conversation already shown: the Mac's own reason, or that it stopped answering.
    private var bannerText: String? {
        if let refusal { return refusal }
        guard lost else { return nil }
        let time = lastRead.map { " Last checked \($0.formatted(date: .omitted, time: .shortened))." } ?? ""
        return "Not updating. Your Mac isn't answering." + time
    }

    private func banner(_ text: String) -> some View {
        Text(text)
            .font(.footnote).foregroundColor(Palette.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Palette.banner)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 16)
            .padding(.top, 8)
    }

    // MARK: - The conversation

    @ViewBuilder private var conversation: some View {
        if let thread {
            let items = Board.chatItems(thread.rows, now: Date(), calendar: .current)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if thread.olderCount > 0 {
                            WayThroughRow(text: Text("Earlier messages are on your computer's board \u{203A}"), action: openOnBoard)
                                .frame(maxWidth: .infinity)
                                .padding(.bottom, 10)
                        }
                        if thread.rows.isEmpty && pending.isEmpty { empty }
                        ForEach(items) { item in
                            itemView(item).id(item.id)
                        }
                        pendingBubbles
                        if working { WorkingLine(name: shown.name).padding(.top, 12).id("working") }
                        Color.clear.frame(height: 1).id("end")
                            .onAppear { atBottom = true; unseenNew = false }
                            .onDisappear { atBottom = false }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                }
                .scrollDismissesKeyboard(.interactively)
                .onAppear { proxy.scrollTo("end", anchor: .bottom) }
                .onChange(of: Board.followKey(thread)) { _ in follow(proxy) }
                .onChange(of: working) { now in if now { follow(proxy) } }
                // Only a message just sent scrolls down; one settling into its row does not move the person's place.
                .onChange(of: pending.count) { n in
                    if n > lastPendingCount { withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
                    lastPendingCount = n
                }
                // The keyboard shrinks the thread; one that was at the newest message stays there (the spec).
                // Whether it was at the newest message is read before the keyboard shrinks the thread (which hides the
                // end marker), and acted on once it is up.
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
                    keepNewestInView = atBottom
                }
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                    if keepNewestInView { withAnimation { proxy.scrollTo("end", anchor: .bottom) } }
                }
                .onReceive(NotificationCenter.default.publisher(for: .chatScrollToEnd)) { _ in
                    withAnimation { proxy.scrollTo("end", anchor: .bottom) }
                }
            }
        } else {
            VStack(spacing: 12) {
                Spacer()
                if let refusal {
                    Text(refusal).font(.subheadline).foregroundColor(Palette.primary).multilineTextAlignment(.center)
                    WayThroughRow(text: Text("Open this chat on your computer's board \u{203A}"), action: openOnBoard)
                } else if lost {
                    Text("Your Mac isn't answering").font(.headline).foregroundColor(Palette.primary)
                    WayThroughRow(text: Text("Open this chat on your computer's board \u{203A}"), action: openOnBoard)
                } else {
                    ProgressView()
                    Text("Loading the conversation\u{2026}").font(.footnote).foregroundColor(Palette.secondary)
                }
                Spacer()
                // A message sent before any conversation was read is still shown, with its not-sent line if it fails.
                VStack(spacing: 0) { pendingBubbles }
            }
            .padding(.horizontal, 32)
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder private var pendingBubbles: some View {
        ForEach(pending) { p in
            PendingBubble(item: p, widthShare: widthShare, line: Board.notSentLine(agentRunning: running, name: shown.name),
                          retry: { Task { await client.retry(p.id, to: agent); await read() } },
                          delete: { client.discard(p.id, for: agent.session) })
                .padding(.top, 10)
                .id(p.id)
        }
    }

    // New messages come in at the bottom; if the person has scrolled up, the view stays and the capsule offers a jump.
    private func follow(_ proxy: ScrollViewProxy) {
        if atBottom { withAnimation { proxy.scrollTo("end", anchor: .bottom) } } else { unseenNew = true }
    }

    private var empty: some View {
        VStack(spacing: 6) {
            Text("No messages with \(shown.name) yet").font(.headline).foregroundColor(Palette.primary)
            Text("Say hello, or give \(shown.name) something to do.").font(.subheadline).foregroundColor(Palette.secondary)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    @ViewBuilder private func itemView(_ item: Board.ChatItem) -> some View {
        switch item.kind {
        case .day(let label):
            Text(label).font(.caption.weight(.semibold)).foregroundColor(Palette.secondary)
                .frame(maxWidth: .infinity)
                .padding(.top, 16).padding(.bottom, 8)
                .accessibilityAddTraits(.isHeader)
        case .row(let row, let first, let last):
            if let way = row.wayThrough {
                VStack(alignment: .leading, spacing: 4) {
                    // A file that came with words: the words as a bubble, then the way through for the file.
                    if way == .attachment, !row.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        ChatBubble(row: row, firstOfRun: true, lastOfRun: true, widthShare: widthShare, name: shown.name,
                                   line: nil, sendAgain: {})
                    }
                    WayThroughRow(text: wayText(way), action: openOnBoard)
                }
                .padding(.top, 10)
            } else if row.who == .kosmos {
                Text(row.text).font(.footnote).foregroundColor(Palette.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: UIScreen.main.bounds.width * 0.85)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            } else {
                // Not sent: tap to try again, once (a row already sent again waits for the read that shows the new one).
                ChatBubble(row: row, firstOfRun: first, lastOfRun: last, widthShare: widthShare, name: shown.name,
                           line: row.canSendAgain && !client.wasSentAgain(row, for: agent.session)
                               ? Board.notSentLine(agentRunning: running, name: shown.name) : nil,
                           sendAgain: { Task { await client.sendAgain(row, to: agent); await read() } })
                    .padding(.top, first ? 10 : 2)
            }
        }
    }

    private func wayText(_ way: Board.ChatRow.WayThrough) -> Text {
        let name = Text(shown.name).fontWeight(.semibold).foregroundColor(Palette.askedWord)
        switch way {
        case .question: return name + Text(" asked you something. Answer on your computer's board \u{203A}")
        case .permission: return name + Text(" needs your permission. Answer on your computer's board \u{203A}")
        case .attachment: return Text("A file. Open on your computer's board \u{203A}")
        case .draft: return Text("Words sat unsent in ") + name + Text("'s input box. See them on your computer's board \u{203A}")
        }
    }

    private var newMessagesCapsule: some View {
        Button {
            unseenNew = false
            NotificationCenter.default.post(name: .chatScrollToEnd, object: nil)
        } label: {
            Text("New messages \u{2193}").font(.footnote.weight(.semibold)).foregroundColor(Palette.primary)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(Capsule().fill(Palette.card).shadow(color: .black.opacity(0.15), radius: 6, y: 2))
        }
        .buttonStyle(.plain)
        .padding(.bottom, 8)
    }

    // MARK: - Sending

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("", text: $draftText, prompt: Text("Message \(shown.name)").foregroundColor(Palette.secondary), axis: .vertical)
                .accessibilityLabel("Message \(shown.name)")
                .font(.body)
                .foregroundColor(Palette.primary)
                .lineLimit(1...5)
                .padding(.vertical, 9)
                .padding(.horizontal, 14)
                .background(Palette.card)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(Palette.separator, lineWidth: 0.5))
            Button(action: send) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(Palette.sendGlyph)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Palette.sendFill))
                    .opacity(canSend ? 1 : 0.35)
                    // A 44 pt place to tap (Apple's minimum) around the 34 pt circle, laid out as the circle alone.
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                    .padding(-5)
            }
            .disabled(!canSend)
            .accessibilityLabel("Send")
            .padding(.bottom, 2)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Palette.ground)
        .overlay(Rectangle().fill(Palette.separator).frame(height: 0.5), alignment: .top)
    }

    private var canSend: Bool { Board.fitsBoard(draftText) }

    // The bubble appears at once (60% while it sends) and the field clears (spec, "while it sends").
    private func send() {
        guard canSend else { return }
        let text = draftText
        draftText = ""
        client.drafts[agent.session] = nil
        Task {
            await client.post(text, to: agent)
            await read()
        }
    }

    // MARK: - Reading

    private func startReading() {
        loop?.cancel()
        loop = Task {
            while !Task.isCancelled {
                await read()
                try? await Task.sleep(nanoseconds: 5_000_000_000)   // the web chat's own cadence
            }
        }
    }

    private func read() async {
        readsStarted += 1
        let mine = readsStarted
        let startedIn = client.chatEpoch
        let result = await client.thread(for: agent.session)
        // A read cut short (the chat closed, the app went away) says nothing about the Mac, and an older read than the
        // one shown changes nothing.
        guard !Task.isCancelled, mine > readShown, startedIn == client.chatEpoch else { return }
        readShown = mine
        switch result {
        case .thread(let fresh):
            if fresh != thread { thread = fresh }
            client.settle(fresh, for: agent.session)
            lastRead = Date()
            failedReads = 0
            refusal = nil
        case .refused(let why):
            // The Mac answered, with a reason: said as it is, never as "not answering".
            refusal = why
            failedReads = 0
        case .noAnswer:
            failedReads += 1
        }
    }
}

// A tap action only where there is one to take, so a bubble's links keep their own taps everywhere else.
struct TapWhen: ViewModifier {
    let enabled: Bool
    let action: () -> Void
    @ViewBuilder func body(content: Content) -> some View {
        if enabled { content.onTapGesture(perform: action) } else { content }
    }
}

// The "New messages" capsule asks the open chat's scroll view to go to the end.
extension Notification.Name {
    static let chatScrollToEnd = Notification.Name("kosmos.chatScrollToEnd")
}

// One message as a bubble: the person's on the right, the agent's on the left, in the board's colours; the time (and a
// tail) on the last bubble of a run. A message the Mac kept as not sent gets the not-sent line, and a tap sends it again.
struct ChatBubble: View {
    let row: Board.ChatRow
    let firstOfRun: Bool
    let lastOfRun: Bool
    let widthShare: CGFloat
    let name: String
    let line: (text: String, canRetry: Bool)?
    let sendAgain: () -> Void
    @Environment(\.openURL) private var openURL

    private var mine: Bool { row.who == .person }

    var body: some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
            BubbleText(text: row.text, mine: mine, tail: lastOfRun, widthShare: widthShare, faded: line != nil)
                .modifier(TapWhen(enabled: line?.canRetry == true, action: sendAgain))
                // One long-press menu per bubble, set here (a menu on the shared bubble would hide the pending one's Delete).
                .contextMenu {
                    Button { UIPasteboard.general.string = row.text } label: { Label("Copy", systemImage: "doc.on.doc") }
                }
            if let line {
                NotSentLine(text: line.text, canRetry: line.canRetry, action: sendAgain)
            } else if lastOfRun || row.notSent != nil {
                HStack(spacing: 6) {
                    if lastOfRun, let at = row.at { Text(at, style: .time).foregroundColor(Palette.tertiary) }
                    if let notSent = row.notSent { Text(notSent + (row.because.map { ": " + $0 } ?? "")).foregroundColor(Palette.secondary) }
                }
                .font(.caption2)
                .padding(.horizontal, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.spoken(who: mine ? "You" : name, at: row.at, text: row.text)
            + (line.map { $0.canRetry ? ", not sent, double-tap to try again" : ", not sent" } ?? (row.notSent.map { ", " + $0.lowercased() } ?? "")))
        .accessibilityAction { if line?.canRetry == true { sendAgain() } }
        // The bubble is read as one element, so its links are offered as actions (one per link, named by its site).
        .accessibilityActions {
            ForEach(Array(BubbleText.links(in: row.text).enumerated()), id: \.offset) { _, url in
                Button("Open link to \(url.host ?? url.absoluteString)") { openURL(url) }
            }
        }
    }

    static func spoken(who: String, at: Date?, text: String) -> String {
        who + (at.map { ", " + $0.formatted(date: .omitted, time: .shortened) } ?? "") + ": " + text
    }
}

// A message the person sent from this chat, until the conversation holds the row the Mac kept for it.
struct PendingBubble: View {
    let item: Board.PendingSend
    let widthShare: CGFloat
    // The not-sent line as it reads now (it follows the agent's status, so a retry opens once it runs again).
    let line: (text: String, canRetry: Bool)
    let retry: () -> Void
    let delete: () -> Void

    private var reason: String? { if case .failed(let why) = item.state { return why } else { return nil } }
    // Kept by the Mac but not delivered: the words its row will say, quiet, with nothing to tap (the row takes over).
    private var undelivered: String? {
        if case .keptUndelivered(_, let note) = item.state { return note }
        return item.state == .unconfirmed ? "Not confirmed" : nil
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            BubbleText(text: item.text, mine: true, tail: true, widthShare: widthShare, faded: !item.shownAsSent)
                .modifier(TapWhen(enabled: item.failed && line.canRetry, action: retry))
                .contextMenu {
                    Button { UIPasteboard.general.string = item.text } label: { Label("Copy", systemImage: "doc.on.doc") }
                    if item.deletable { Button(role: .destructive, action: delete) { Label("Delete", systemImage: "trash") } }
                }
            if item.failed {
                NotSentLine(text: line.text, canRetry: line.canRetry, action: retry)
                // The Mac's own words for why, when it gave them.
                if let reason { Text(reason).font(.caption).foregroundColor(Palette.secondary).multilineTextAlignment(.trailing) }
            } else if let undelivered {
                Text(undelivered).font(.caption2).foregroundColor(Palette.secondary).padding(.horizontal, 4)
            } else if item.shownAsSent {
                Text(item.at, style: .time).font(.caption2).foregroundColor(Palette.tertiary).padding(.horizontal, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ChatBubble.spoken(who: "You", at: item.shownAsSent ? item.at : nil, text: item.text)
            + (item.failed ? (line.canRetry ? ", not sent, double-tap to try again" : ", not sent") + (reason.map { ". " + $0 } ?? "") : "")
            + (undelivered.map { ", " + $0.lowercased() } ?? ""))
        .accessibilityAction { if item.failed && line.canRetry { retry() } }
        // Delete only where the long-press menu offers it.
        .accessibilityActions { if item.deletable { Button("Delete", action: delete) } }
    }
}

// "Not sent. Tap to try again." with its glyph, in the danger colour; a tap tries again when it can.
struct NotSentLine: View {
    let text: String
    let canRetry: Bool
    let action: () -> Void

    var body: some View {
        Button(action: { if canRetry { action() } }) {
            HStack(spacing: 4) {
                Image(systemName: "exclamationmark.circle")
                Text(text)
            }
            .font(.footnote)
            .foregroundColor(Palette.dangerWord)
        }
        .buttonStyle(.plain)
        .disabled(!canRetry)
    }
}

// The bubble itself: body text in the board's bubble colours, 18pt corners, a small tail on the last of a run.
struct BubbleText: View {
    let text: String
    let mine: Bool
    let tail: Bool
    let widthShare: CGFloat
    var faded = false

    var body: some View {
        Text(Self.formatted(text))
            .font(.body)
            .foregroundColor(Palette.primary.opacity(faded ? 0.6 : 1))
            .tint(Palette.link)
            .padding(.vertical, 8)
            .padding(.horizontal, 12)
            .background(
                // Two shapes, each filled on its own: one path holding both would cut a hole where they overlap.
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                    if tail { BubbleTail(mine: mine) }
                }
                .foregroundColor(mine ? Palette.personBubble : Palette.agentBubble)
            )
            .frame(maxWidth: UIScreen.main.bounds.width * widthShare, alignment: mine ? .trailing : .leading)
            .fixedSize(horizontal: false, vertical: true)
    }

    // What iOS reads as inline Markdown, with the message's own line breaks kept, and plain web links made tappable
    // (links only: not phone numbers or dates).
    // The links a message's bubble shows, in order (one link split into runs by its styling counts once).
    static func links(in s: String) -> [URL] {
        var out: [URL] = []
        var last: URL?
        for run in formatted(s).runs {
            if let url = run.link, url != last { out.append(url) }
            last = run.link
        }
        return out
    }

    static func formatted(_ s: String) -> AttributedString {
        var out = (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
        // A Markdown link can put any address behind friendly words (a phone call, another app), so only web addresses
        // stay links; the words stay as text.
        let hidden = out.runs.compactMap { run in run.link.flatMap { Board.isWebLink($0) ? nil : run.range } }
        for range in hidden { out[range].link = nil }
        let plain = String(out.characters)
        if let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) {
            for match in detector.matches(in: plain, range: NSRange(plain.startIndex..., in: plain)) {
                guard let url = match.url, Board.isWebLink(url), let range = Range(match.range, in: plain),
                      let lower = AttributedString.Index(range.lowerBound, within: out),
                      let upper = AttributedString.Index(range.upperBound, within: out),
                      out[lower..<upper].link == nil else { continue }
                out[lower..<upper].link = url
            }
        }
        return out
    }
}

// The small tail on the last bubble of a run, at the bottom corner on the speaker's side (Messages' convention).
struct BubbleTail: Shape {
    let mine: Bool

    func path(in rect: CGRect) -> Path {
        // Drawn for the right side and mirrored for the left. It fills the rounded corner and curls out 5pt.
        let w: CGFloat = 20
        let h: CGFloat = 18
        var p = Path()
        p.move(to: CGPoint(x: rect.maxX - w, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.maxX + 5, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.maxY - h * 0.55), control: CGPoint(x: rect.maxX, y: rect.maxY - 1))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - h))
        p.addLine(to: CGPoint(x: rect.maxX - w, y: rect.maxY - h))
        p.closeSubpath()
        guard !mine else { return p }
        return p.applying(CGAffineTransform(scaleX: -1, y: 1).translatedBy(x: -(rect.minX + rect.maxX), y: 0))
    }
}

// "··· <name> is working": the dots pulse gently, and stay still with Reduce Motion on; VoiceOver hears the words only.
struct WorkingLine: View {
    let name: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var bright = false

    var body: some View {
        HStack(spacing: 4) {
            Text("\u{00B7}\u{00B7}\u{00B7}")
                .opacity(reduceMotion ? 1 : (bright ? 1 : 0.35))
                .accessibilityHidden(true)
            Text("\(name) is working")
        }
        .font(.footnote)
        .foregroundColor(Palette.secondary)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) { bright = true }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name) is working")
    }
}

// Mona Lisa's way-through row: a card-colour pill that opens the agent's chat on the board.
struct WayThroughRow: View {
    let text: Text
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            text.font(.footnote).foregroundColor(Palette.secondary)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(RoundedRectangle(cornerRadius: 12).fill(Palette.card))
                // White on the light ground barely shows (Mona Lisa's review): a hairline in light mode only.
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.pillStroke, lineWidth: 0.5))
        }
        .buttonStyle(.plain)
    }
}

extension Palette {
    // The board's own chat colours (Mona Lisa's slice 3a spec: Josh 2026-09-25 and #3340 for night mode).
    static let personBubble = pair(0xe8ebf5, 0x1b1f65)
    static let agentBubble = pair(0xfbf4e4, 0x252529)
    static let sendFill = pair(0xe3b341, 0xe3b341)
    static let sendGlyph = pair(0x14161a, 0x14161a)
    static let link = pair(0x2457c5, 0x9db8ff)
    static let pillStroke = pair(0xe3e1dc, 0x000000, lightAlpha: 1, darkAlpha: 0)
}
