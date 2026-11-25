import SwiftUI
import UIKit

// kosmos#9002: whether the app shows two panes (the list on the left, what is open on the right). Only where the width AND the
// height are regular, which an unfolded iPhone Duo is. The width alone would also take in a large iPhone turned sideways
// (regular width, compact height), which keeps the one column it has.
private struct TwoPanesKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    var twoPanes: Bool {
        get { self[TwoPanesKey.self] }
        set { self[TwoPanesKey.self] = newValue }
    }
}

private struct ReadsTwoPanes: ViewModifier {
    @Environment(\.horizontalSizeClass) private var h
    @Environment(\.verticalSizeClass) private var v
    func body(content: Content) -> some View { content.environment(\.twoPanes, h == .regular && v == .regular) }
}

// The same question asked of the window at this moment. A closure in a view being taken down by an unfold still holds the
// environment it was drawn with, so it must ask here.
@MainActor enum TwoPanesNow {
    static var value: Bool {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        guard let t = (windows.first(where: \.isKeyWindow) ?? windows.first)?.traitCollection else { return false }
        return t.horizontalSizeClass == .regular && t.verticalSizeClass == .regular
    }
}

extension View {
    // Everything below reads \.twoPanes; it changes on a fold.
    func readsTwoPanes() -> some View { modifier(ReadsTwoPanes()) }
}

// What the right pane says while nothing is open.
struct NothingOpen: View {
    let words: String
    var body: some View {
        Text(words).font(.body).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Palette.ground.ignoresSafeArea())
    }
}

#if DEBUG
// A stand-in for Duo's unfolded screen, since this Mac's Xcode has no Duo simulator (a Debug build only).
// KOSMOS_SAMPLE_REGULAR=1: both size classes regular. =fold:<seconds>: regular, then as the device is after that long, then
// regular again, so one run shows a fold and an unfold.
enum DuoSample {
    @MainActor static func apply() {
        guard let want = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_REGULAR"], #available(iOS 17.0, *) else { return }
        set(true)
        guard want.hasPrefix("fold:"), let s = Double(want.dropFirst(5)) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + s) { set(false) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2 * s) { set(true) }
    }
    @available(iOS 17.0, *) @MainActor private static func set(_ regular: Bool) {
        for w in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows) {
            if regular { w.traitOverrides.horizontalSizeClass = .regular; w.traitOverrides.verticalSizeClass = .regular }
            else { w.traitOverrides.remove(UITraitHorizontalSizeClass.self); w.traitOverrides.remove(UITraitVerticalSizeClass.self) }
        }
        NSLog("[Duo] sample size classes: %@", regular ? "regular" : "the device's own")
    }
}
#endif
