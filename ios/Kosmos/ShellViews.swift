import SwiftUI
import Network
import UIKit

// The shell's page-level state (kosmos#718): the failure being shown, if any, and
// a retry request the WebView acts on. Owned by ContentView.
final class ShellState: ObservableObject {
    @Published var failure: Shell.LoadFailure?
    // The system's own wording for a failure that is neither offline nor unreachable.
    @Published var failureDetail: String = ""
    // kosmos#7197: the failing Mac's name, for a Mac that is not answering (nil otherwise).
    @Published var failureMac: String? = nil
    // kosmos#7416 slice 2: that Mac's address (the failed page's host), to find when it was last heard from.
    @Published var failureAddress: String? = nil
    // Bumped to ask the WebView to reload; the WebView remembers the last value it acted on.
    @Published var retryCount = 0
    // True from Try again until the page loads or fails again, so the button answers.
    @Published var retrying = false
    // Bumped to ask the WebView to leave the failed page.
    @Published var backCount = 0
    // kosmos#7389: a file on its way from the board (shown after a second), and how to stop it.
    struct Downloading { let id: ObjectIdentifier; let name: String; let cancel: () -> Void }
    @Published var downloading: Downloading?
    // Whether this failure has already had its one immediate automatic retry.
    private var autoRetried = false

    private let monitor = NWPathMonitor()

    init() {
        // Back online after an "offline" page: reload by itself, the way an app should.
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            DispatchQueue.main.async {
                if self?.failure == .offline && self?.retrying == false { self?.retry() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "io.kosmos.app.path"))
    }

    deinit { monitor.cancel() }

    func retry() { retrying = true; retryCount += 1 }

    func back() { failure = nil; retrying = false; autoRetried = false; backCount += 1 }
    // kosmos#6850: leave a Mac that is not answering for the list of the person's computers.
    @Published var otherComputerCount = 0
    func otherComputer() { failure = nil; retrying = false; autoRetried = false; otherComputerCount += 1 }

    // A page failed. If it says offline but the phone is already online again, the
    // monitor will report no change, so retry once now (Shell.retriesOnShow).
    func show(_ newFailure: Shell.LoadFailure) {
        failure = newFailure
        let online = monitor.currentPath.status == .satisfied
        if Shell.retriesOnShow(failure: newFailure, online: online, alreadyRetried: autoRetried) {
            autoRetried = true
            retry()
        }
    }

    // The page loaded: the next failure gets its own immediate retry again.
    func loaded() { failure = nil; retrying = false; autoRetried = false }
}

// kosmos#9101: the board's own page ground (web/index.html body's background, var(--k-bg): #faf9f7 light, #0c0d0f in
// the dark scheme; the same values as Palette.ground), painted behind the web view, the tab bar and the Close bar so the
// space around a page is the page's colour, with no flash of another while it loads. It was Kosmos navy (#17233D);
// Josh, 11-25 16:49: no blue background anywhere in the app.
extension UIColor {
    static let boardGround = UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x0C / 255.0, green: 0x0D / 255.0, blue: 0x0F / 255.0, alpha: 1)
            : UIColor(red: 0xFA / 255.0, green: 0xF9 / 255.0, blue: 0xF7 / 255.0, alpha: 1)
    }
}

// Shown in place of a blank WebView when a page cannot load.
struct LoadFailureView: View {
    // kosmos#9095: the words on the gold Try again, dark in both appearances (the bright gold is light in both). The
    // light value of Palette.primary, fixed on purpose: Palette.primary itself turns light in dark mode.
    static let onGold = Color(red: 0x14 / 255.0, green: 0x16 / 255.0, blue: 0x1A / 255.0)
    let failure: Shell.LoadFailure
    let detail: String
    let retrying: Bool
    let onRetry: () -> Void
    // Leaves a page that will not load: back to the page before it, or the board home. kosmos#8957: nil on the phone's
    // own tabs, where "Back to Kosmos" opened the board (which is not answering either); Try again is the way on there.
    let onBack: (() -> Void)?
    // kosmos#6850: shown only for a Mac that is not answering (Shell.offersOtherComputer).
    var onOtherComputer: (() -> Void)? = nil
    // kosmos#7197: the Mac that is not answering, by name, when it is known.
    var macName: String? = nil
    // kosmos#7416 slice 2: when it was last heard from (unix seconds, Board.lastHeard), when known.
    var lastHeard: Double? = nil
    // kosmos#9091: Hop is left off at the accessibility text sizes, where the screen's own words need the room.
    @Environment(\.dynamicTypeSize) private var typeSize

    private var title: String {
        switch failure {
        case .offline: return "You're offline"
        case .unreachable: return "Kosmos+ isn't answering"
        case .macUnreachable: return Shell.macUnreachableTitle(macName)
        case .other: return "This page didn't load"
        }
    }

    private var icon: String {
        switch failure {
        case .offline: return "wifi.slash"
        case .macUnreachable: return "desktopcomputer"
        case .unreachable, .other: return "exclamationmark.icloud"
        }
    }

    private func message(at now: Date) -> String {
        switch failure {
        case .offline: return "Kosmos opens again as soon as your phone is back online."
        case .unreachable: return "Your phone is online, but Kosmos+ didn't reply. Try again in a moment."
        case .macUnreachable: return Shell.macUnreachableMessage(macName, lastSeen: lastHeard, now: now)
        case .other: return detail.isEmpty ? "Something stopped the page from loading." : detail
        }
    }

    var body: some View {
        ZStack {
            // kosmos#9095 (Josh 11-25: no blue background anywhere in the app): the native screens' own ground, cream in
            // light and near-black in dark (Palette.ground), with the app's text colours and the board's gold.
            Palette.ground.ignoresSafeArea()
            // kosmos#9091 review 1: when the words (large text, the other-computer row, Hop) are taller than the screen,
            // the screen scrolls rather than clipping its title and Try again. When it fits it sits centred as before.
            GeometryReader { geo in
            ScrollView {
            VStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.system(size: 44, weight: .regular))
                    .foregroundColor(Palette.starGold)
                    .accessibilityHidden(true)
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundColor(Palette.primary)
                // kosmos#7416 review 1: redrawn each minute, so a screen left up over midnight says "yesterday at".
                TimelineView(.everyMinute) { context in
                    Text(message(at: context.date))
                        .font(.body)
                        .multilineTextAlignment(.center)
                        .foregroundColor(Palette.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button(action: onRetry) {
                    HStack(spacing: 8) {
                        if retrying { SweepDots(colour: Self.onGold, scales: false) }   // "Trying" beside it says what is happening
                        Text(retrying ? "Trying" : "Try again")
                            .font(.body.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                }
                .disabled(retrying)
                .foregroundColor(Self.onGold)
                .background(Palette.starFill)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                // The bright gold is under 3:1 against cream, so in light its edge is drawn in the deep gold (Palette.starGold);
                // in dark starGold is the bright gold itself, and the fill already stands out on near-black.
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.starGold, lineWidth: 1))
                .padding(.top, 8)
                if Shell.offersOtherComputer(failure), let onOtherComputer = onOtherComputer {
                    Button(action: onOtherComputer) {
                        Text("Choose another computer")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 50)
                            // The whole outlined row takes the tap, not only the words: it has no fill of its own,
                            // and a button's hit area is its label's (review 2).
                            .contentShape(Rectangle())
                    }
                    .foregroundColor(Palette.primary)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.secondary, lineWidth: 1))   // its only edge
                }
                if let onBack {
                    Button("Back to Kosmos", action: onBack)
                        .font(.body)
                        .foregroundColor(Palette.primary)
                        .frame(minHeight: 44)
                }
                // kosmos#9091: Hop, a one-tap game, only while the phone is offline. Back online, this screen goes as
                // it always has: the game never holds up the reload.
                if failure == .offline && !typeSize.isAccessibilitySize {
                    HopGameView().padding(.top, 16)
                }
            }
            .padding(.horizontal, 32)
            .frame(maxWidth: 420)
            .padding(.vertical, 24)
            .frame(width: geo.size.width)
            .frame(minHeight: geo.size.height)
            }
            .modifier(BounceOnlyWhenScrolling())
            }
        }
    }
}

// kosmos#9091: a screen that fits does not bounce (iOS 16.4 and later; earlier, it bounces as any scroll view does).
private struct BounceOnlyWhenScrolling: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 16.4, *) { content.scrollBounceBehavior(.basedOnSize) } else { content }
    }
}

// kosmos#8957: under a button whose own word stays (Sign in, Make an agent), the line that says the tap leaves the app's
// screens for the computer's board, with the same icon as every other hand-off.
struct OpensOnBoardNote: View {
    // The words: the board's by default; the Kosmos+ sign-in page for the sign-in fallbacks, which are not the board.
    var words = Board.opensOnBoard
    var foot: CGFloat = 0   // space under it, where a screen puts its button at the foot, above the tab bar
    var body: some View {
        (Text(Image(systemName: Board.boardIcon)) + Text(" ") + Text(words))
            .font(.caption).foregroundColor(Palette.secondary)
            .accessibilityLabel(words)   // read after the button, so the button itself carries no second hint
            .padding(.bottom, foot)
    }
}

// kosmos#7389 (Mona Lisa's design): "Getting report.pdf" with Cancel at the bottom while a board file arrives.
struct DownloadLine: View {
    let name: String
    let cancel: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            SweepDots()   // kosmos#8058: a small wait has the simple dots; unlabelled, as the words beside it say what is coming
            Text(Download.getting(name)).font(.subheadline).lineLimit(1).truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("Cancel", action: cancel).font(.subheadline.weight(.semibold))
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, 12).padding(.bottom, 12)
        // Contain, not combine: Cancel stays a button VoiceOver can reach on its own.
        .accessibilityElement(children: .contain)
    }
}
