import UIKit

/// kosmos#8246 (Josh 11-08 07:53, "Let's do 1,3,4,5"): the app's taps for what the person does, in one place, so each
/// action's feel is decided once. Not a tap per incoming message, per streamed line, or while scrolling or typing; the
/// task-done buzz (his pick 2) is not built. A phone with system haptics off in iOS Settings stays silent; Kosmos adds
/// no setting of its own.
@MainActor
enum Haptics {
    /// Pick 4: a very light tap as a message goes.
    static func sent() { UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.6) }
    /// Pick 1: a firm tap once an Allow or Deny answer has gone (a sure send), so the person feels it went through.
    static func decided() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    /// Pick 3: the iPhone's own error pattern when something the person did fails: a message the computer refused or
    /// did not answer, an answer refused, a room post refused, a sign-in refused.
    static func failed() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
    /// Pick 5: a small selection click as a swipe stars or unstars an agent.
    static func snapped() { UISelectionFeedbackGenerator().selectionChanged() }
}
