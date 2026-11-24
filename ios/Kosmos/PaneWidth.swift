import SwiftUI
import UIKit

// kosmos#9002: the width of the pane a chat or a room is drawn in. On a phone it is the screen's, as it always was. In the
// two panes an unfolded iPhone Duo shows it is the pane's own, so a bubble is sized to what it sits in and never to the whole
// screen behind it. Measured where the pane is, read below it.
private struct PaneWidthKey: EnvironmentKey {
    static let defaultValue: CGFloat? = nil
}

extension EnvironmentValues {
    // The pane's width, or the screen's where nothing measured one.
    var paneWidth: CGFloat {
        get { self[PaneWidthKey.self] ?? UIScreen.main.bounds.width }
        set { self[PaneWidthKey.self] = newValue }
    }
}

private struct MeasuresPaneWidth: ViewModifier {
    @State private var width: CGFloat = UIScreen.main.bounds.width
    func body(content: Content) -> some View {
        content
            .environment(\.paneWidth, width)
            .background(GeometryReader { g in
                Color.clear.onAppear { width = g.size.width }.onChange(of: g.size.width) { width = $0 }
            })
    }
}

extension View {
    // Everything below reads this view's width as \.paneWidth (it changes on a fold, a split or a rotation).
    func measuresPaneWidth() -> some View { modifier(MeasuresPaneWidth()) }
}
