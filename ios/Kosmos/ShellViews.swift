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

    private let monitor = NWPathMonitor()

    init() {
        // Back online after an "offline" page: reload by itself, the way an app should.
        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            DispatchQueue.main.async {
                if self?.failure == .offline { self?.retry() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "io.kosmos.app.path"))
    }

    deinit { monitor.cancel() }

    func retry() { retryCount += 1 }
}

// Kosmos navy, the sign-in page's own background (--bg in coordinator signin.html),
// so the first screen and the launch screen are one surface.
extension UIColor {
    static let kosmosNavy = UIColor(red: 0x17 / 255.0, green: 0x23 / 255.0, blue: 0x3D / 255.0, alpha: 1)
}

// Shown in place of a blank WebView when a page cannot load.
struct LoadFailureView: View {
    let failure: Shell.LoadFailure
    let detail: String
    let onRetry: () -> Void

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
                    .foregroundColor(Color(red: 0xE3 / 255.0, green: 0xB3 / 255.0, blue: 0x41 / 255.0))
                    .accessibilityHidden(true)
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundColor(Color(red: 0xE6 / 255.0, green: 0xEB / 255.0, blue: 0xF7 / 255.0))
                Text(message)
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .foregroundColor(Color(red: 0x8F / 255.0, green: 0xA0 / 255.0, blue: 0xC4 / 255.0))
                    .fixedSize(horizontal: false, vertical: true)
                Button(action: onRetry) {
                    Text("Try again")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 50)
                }
                .foregroundColor(.white)
                .background(Color(red: 0x2F / 255.0, green: 0x57 / 255.0, blue: 0xC4 / 255.0))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.top, 8)
            }
            .padding(.horizontal, 32)
            .frame(maxWidth: 420)
        }
    }
}
