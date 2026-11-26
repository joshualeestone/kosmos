import SwiftUI
import UIKit

// kosmos#9002: whether the app shows two panes (the list on the left, what is open on the right). Only where the width AND the
// height are regular, which an unfolded iPhone Duo is. The width alone would also take in a large iPhone turned sideways
// (regular width, compact height), which keeps the one column it has.
// Read where it is used, from the size classes UIKit gives each page. A page left under another keeps its old ones until it is
// shown again.
@propertyWrapper struct TwoPanes: DynamicProperty {
    @Environment(\.horizontalSizeClass) private var h
    @Environment(\.verticalSizeClass) private var v
    var wrappedValue: Bool { Self.shows(h, v) }
    // The one rule, also read where a view has the environment but no property wrapper (ChatList).
    static func shows(_ h: UserInterfaceSizeClass?, _ v: UserInterfaceSizeClass?) -> Bool { h == .regular && v == .regular }
}

// A tab's list and what is open from it. One column: the list, with the open page pushed on it, as always. Two panes: the list
// on the left, the open page on the right. Both are the SAME navigation and the same push: an unfold only moves the list out
// of its root into a pane of its own, so the open chat, its place and the words in its box are never taken down by a fold.
struct ListAndOpen<ListPage: View, Open: View>: View {
    let isOpen: Binding<Bool>
    let nothingOpen: String
    // Whether what is open covers the tab bar in one column (a task's page never has).
    var coversTabs = true
    @ViewBuilder let list: () -> ListPage
    @ViewBuilder let open: () -> Open
    @TwoPanes private var twoPanes
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
        // One owner for the bar, outside the navigation, so it follows a fold whatever is stacked on the page.
        .toolbar(isOpen.wrappedValue && coversTabs && !twoPanes ? .hidden : .automatic, for: .tabBar)
        .background(GeometryReader { g in
            Color.clear.onAppear { width = g.size.width }.onChange(of: g.size.width) { width = $0 }
        })
    }
}

private struct TabBarBesideOnly: ViewModifier {
    @TwoPanes private var twoPanes
    // Never .visible: a page left under another after a fold keeps the sizes it was drawn with, and would ask for the bar back
    // over the page on top (measured 11-25). ListAndOpen says whether it shows; this keeps a phone as it was.
    func body(content: Content) -> some View { content.toolbar(twoPanes ? .automatic : .hidden, for: .tabBar) }
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
// regular again, so one run shows a fold and an unfold. =tap: regular, then each tap of the test's own control
// (DuoSampleFoldControl, "duo-sample-fold") folds or unfolds, so a slow runner cannot race a clock.
enum DuoSample {
    @MainActor static func apply() {
        guard let want = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_REGULAR"], #available(iOS 17.0, *) else { return }
        set(true)
        guard want.hasPrefix("fold:"), let s = Double(want.dropFirst(5)) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + s) { set(false) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2 * s) { set(true) }
    }
    @available(iOS 17.0, *) @MainActor static func set(_ regular: Bool) {
        for w in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).flatMap(\.windows) {
            if regular { w.traitOverrides.horizontalSizeClass = .regular; w.traitOverrides.verticalSizeClass = .regular }
            else { w.traitOverrides.remove(UITraitHorizontalSizeClass.self); w.traitOverrides.remove(UITraitVerticalSizeClass.self) }
        }
        NSLog("[Duo] sample size classes: %@", regular ? "regular" : "the device's own")
    }
}
// The test's own fold control (KOSMOS_SAMPLE_REGULAR=tap only): a small target at the top of the window. Its label says
// which state the app is in, so a check waits on the app rather than on a clock.
struct DuoSampleFoldControl: View {
    @State private var folded = false
    var body: some View {
        if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_REGULAR"] == "tap" {
            Color.clear.frame(width: 24, height: 12).contentShape(Rectangle())
                .onTapGesture {
                    folded.toggle()
                    if #available(iOS 17.0, *) { DuoSample.set(!folded) }
                }
                .accessibilityElement()
                .accessibilityLabel(folded ? "sample folded" : "sample unfolded")
                .accessibilityIdentifier("duo-sample-fold")
                .accessibilityAddTraits(.isButton)
        }
    }
}
#endif
