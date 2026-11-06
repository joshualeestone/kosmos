import Foundation

/// kosmos#8078: what a pull to refresh should do, with no UIKit, so a logic test can run it. DotsRefresh feeds it what the
/// scroll view says and does what it answers.
///
/// A refresh starts only when a finger lets go past the threshold. Not from a fling that bounces off the top, which never
/// has a finger on it, and not from a pull that came back above the threshold before letting go.
struct PullRefreshLogic: Equatable {
    /// How far to pull, in points, for a refresh to start on release. About what iOS's own needs.
    static let threshold: Double = 72
    /// The space held open under the top of the list while the dots run.
    static let held: Double = 56
    /// The longest the space stays open, in seconds. The work may go on, but a person offline gets the list back.
    static let longestHold: Double = 20

    enum Phase: Equatable {
        case idle
        /// A finger is on it and the list is past its top. `armed` means letting go now refreshes.
        case pulling(armed: Bool)
        /// The work is running and the space is held open.
        case refreshing
        /// The space has been given back; nothing starts until the list has come back to its top.
        case settling
    }

    private(set) var phase: Phase = .idle

    /// How far past its top the list is, from the scroll view's own numbers: its offset, and its top inset as adjusted for
    /// the bars. Zero when it is not past its top.
    static func pulled(offsetY: Double, adjustedTop: Double) -> Double {
        max(0, -(offsetY + adjustedTop))
    }

    /// kosmos#8072: how far past its end a list is, from the scroll view's own numbers. Zero when it is not.
    static func pastEnd(offsetY: Double, content: Double, view: Double, adjustedBottom: Double) -> Double {
        max(0, offsetY + view - adjustedBottom - content)
    }

    /// kosmos#8072: the least time the dots stay after letting go, in seconds, so a read that answers at once is still seen.
    static let leastShow: Double = 0.6

    /// How much of the dots to show: none at the start of a pull, all of them by the threshold, and all while refreshing.
    static func shown(pulled: Double, refreshing: Bool) -> Double {
        refreshing ? 1 : min(1, max(0, pulled / threshold))
    }

    /// The list moved. True when this move just armed it, which is the moment for a light tap.
    @discardableResult
    mutating func moved(pulled: Double, dragging: Bool) -> Bool {
        switch phase {
        case .refreshing:
            return false
        case .settling:
            if pulled <= 0 { phase = .idle }
            return false
        case .idle, .pulling:
            guard pulled > 0 else { phase = .idle; return false }
            guard dragging else {
                // UIKit may clear the finger before it tells the gesture's end, with a move in between. An armed pull waits
                // for that end, or the release is lost. Anything else with no finger on it is a fling, and draws nothing.
                if phase != .pulling(armed: true) { phase = .idle }
                return false
            }
            let armed = pulled >= Self.threshold
            let wasArmed = phase == .pulling(armed: true)
            phase = .pulling(armed: armed)
            return armed && !wasArmed
        }
    }

    /// The finger let go. True when the refresh should start now.
    mutating func released() -> Bool {
        guard phase == .pulling(armed: true) else {
            if case .pulling = phase { phase = .idle }
            return false
        }
        phase = .refreshing
        return true
    }

    /// A refresh asked for without a pull: VoiceOver's action. True when it should start now.
    mutating func asked() -> Bool {
        guard phase == .idle else { return false }
        phase = .refreshing
        return true
    }

    /// The work ended, or the longest hold passed. True when the space should be given back now, which happens once.
    mutating func ended() -> Bool {
        guard phase == .refreshing else { return false }
        phase = .settling
        return true
    }
}
