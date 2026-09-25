import SwiftUI
import Network
import UIKit

// The shell's page-level state (kosmos#718): the failure being shown, if any, and
// a retry request the WebView acts on. Owned by ContentView.
final class ShellState: ObservableObject {
    @Published var failure: Shell.LoadFailure?
    // The system's own wording for a failure that is neither offline nor unreachable.
    @Published var failureDetail: String = ""
    // Bumped to ask the WebView to reload; the WebView remembers the last value it acted on.
    @Published var retryCount = 0
    // True from Try again until the page loads or fails again, so the button answers.
    @Published var retrying = false

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

    // Bumped to ask the WebView to leave the failed page.
    @Published var backCount = 0
    func back() { failure = nil; retrying = false; backCount += 1 }
}

// Kosmos navy, the sign-in page's own background (--bg in coordinator signin.html),
// so the first screen and the launch screen are one surface.
extension UIColor {
    static let kosmosNavy = UIColor(red: 0x17 / 255.0, green: 0x23 / 255.0, blue: 0x3D / 255.0, alpha: 1)
}

// Mona's sign-in tokens (coordinator signin.html --gold, --ink, --muted, --accent).
enum KosmosColor {
    static let gold = Color(red: 0xE3 / 255.0, green: 0xB3 / 255.0, blue: 0x41 / 255.0)
    static let ink = Color(red: 0xE6 / 255.0, green: 0xEB / 255.0, blue: 0xF7 / 255.0)
    static let muted = Color(red: 0x8F / 255.0, green: 0xA0 / 255.0, blue: 0xC4 / 255.0)
    static let accent = Color(red: 0x2F / 255.0, green: 0x57 / 255.0, blue: 0xC4 / 255.0)
}

// Shown in place of a blank WebView when a page cannot load.
struct LoadFailureView: View {
    let failure: Shell.LoadFailure
    let detail: String
    let retrying: Bool
    let onRetry: () -> Void
    // Leaves a page that will not load: back to the page before it, or the board home.
    let onBack: () -> Void

    private var title: String {
        switch failure {
        case .offline: return "You're offline"
        case .unreachable: return "Kosmos+ isn't answering"
        case .other: return "This page didn't load"
        }
    }

    private var message: String {
        switch failure {
        case .offline: return "Kosmos opens again as soon as your phone is back online."
        case .unreachable: return "Your phone is online, but Kosmos+ didn't reply. Try again in a moment."
        case .other: return detail.isEmpty ? "Something stopped the page from loading." : detail
        }
    }

    var body: some View {
        ZStack {
            Color(uiColor: .kosmosNavy).ignoresSafeArea()
            VStack(spacing: 16) {
                Image(systemName: failure == .offline ? "wifi.slash" : "exclamationmark.icloud")
                    .font(.system(size: 44, weight: .regular))
                    .foregroundColor(KosmosColor.gold)
                    .accessibilityHidden(true)
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundColor(KosmosColor.ink)
                Text(message)
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .foregroundColor(KosmosColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Button(action: onRetry) {
                    HStack(spacing: 8) {
                        if retrying { ProgressView().tint(.white) }
                        Text(retrying ? "Trying" : "Try again")
                            .font(.body.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                }
                .disabled(retrying)
                .foregroundColor(.white)
                .background(KosmosColor.accent)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.top, 8)
                Button("Back to Kosmos", action: onBack)
                    .font(.body)
                    .foregroundColor(KosmosColor.ink)
                    .frame(minHeight: 44)
            }
            .padding(.horizontal, 32)
            .frame(maxWidth: 420)
        }
    }
}
