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

extension View {
    // Everything below reads \.twoPanes; it changes on a fold.
    func readsTwoPanes() -> some View { modifier(ReadsTwoPanes()) }
}

// A tab's list and what is open from it. One column: the list, with the open page pushed on it, as always. Two panes: the list
// on the left, the open page on the right. Both are the SAME navigation and the same push: an unfold only moves the list out
// of its root into a pane of its own, so the open chat, its place and the words in its box are never taken down by a fold.
struct ListAndOpen<ListPage: View, Open: View>: View {
    let isOpen: Binding<Bool>
    let nothingOpen: String
    @ViewBuilder let list: () -> ListPage
    @ViewBuilder let open: () -> Open
    @Environment(\.twoPanes) private var twoPanes
    @State private var width: CGFloat = 0

    var body: some View {
        HStack(spacing: 0) {
            if twoPanes {
                NavigationView { list() }
                    .navigationViewStyle(.stack)
                    .frame(width: min(360, max(280, width * 0.4)))
                Divider().ignoresSafeArea()
            }
            NavigationView {
                ZStack {
                    if twoPanes { NothingOpen(words: nothingOpen) } else { list() }
                }
                .background(
                    NavigationLink(isActive: isOpen) {
                        // In two panes there is no list under it to go back to.
                        open().navigationBarBackButtonHidden(twoPanes)
                    } label: { EmptyView() }
                    .hidden()
                )
            }
            .navigationViewStyle(.stack)
        }
        .background(GeometryReader { g in
            Color.clear.onAppear { width = g.size.width }.onChange(of: g.size.width) { width = $0 }
        })
    }
}

private struct TabBarBesideOnly: ViewModifier {
    @Environment(\.twoPanes) private var twoPanes
    func body(content: Content) -> some View { content.toolbar(twoPanes ? .visible : .hidden, for: .tabBar) }
}

extension View {
    // An open chat, room or page has no tab bar on a phone (#7847); beside its list, the tabs stay.
    func hidesTabBarInOneColumn() -> some View { modifier(TabBarBesideOnly()) }
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
