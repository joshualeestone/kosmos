import SwiftUI
import UIKit

/// kosmos#8078 (Josh 11-05 18:33: "only use the dots spinner in the mobile app and scrub any other instances"): pull to
/// refresh with the simple dots. iOS's own pull to refresh always draws iOS's spinner and cannot be given another view, so
/// this watches the real scroll view instead, which is also what lets one piece serve a SwiftUI list and the board page's
/// web view alike. PullRefreshLogic decides; this does what it says.
///
/// The dots are a subview of the scroll view, centred in the space the pull opens, as iOS places its own. They exist only
/// during a pull or a refresh, so a resting list has no clock-drawn view in it.
///
/// Not wired into ChatView or RoomView: pulling past a chat's end is the state the #7420 blank fixes act on (kosmos#8072).
@MainActor
final class DotsRefreshDriver: NSObject {
    /// Called when a refresh starts. Whoever owns the work calls `finish()` when it ends.
    var onRefresh: (() -> Void)?

    private(set) weak var scrollView: UIScrollView?
    private var logic = PullRefreshLogic()
    private var offsetWatch: NSKeyValueObservation?
    private var dots: UIHostingController<AnyView>?
    /// What this driver added to the top inset, so it gives back exactly that and nothing someone else set.
    private var addedInset: CGFloat = 0
    private var longestHold: Task<Void, Never>?
    private let tap = UIImpactFeedbackGenerator(style: .light)

    func attach(to view: UIScrollView) {
        guard view !== scrollView else { return }
        detach()
        scrollView = view
        // A short list must still move under a finger, as it does with iOS's own.
        view.alwaysBounceVertical = true
        offsetWatch = view.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.moved() }
        }
        view.panGestureRecognizer.addTarget(self, action: #selector(panned(_:)))
    }

    func detach() {
        offsetWatch?.invalidate()
        offsetWatch = nil
        scrollView?.panGestureRecognizer.removeTarget(self, action: #selector(panned(_:)))
        finish()
        removeDots()
        scrollView = nil
    }

    /// The work ended. Safe to call at any time, and more than once.
    func finish() {
        guard logic.ended() else { return }
        longestHold?.cancel()
        longestHold = nil
        giveBackSpace()
    }

    /// VoiceOver's way to refresh, where a pull is not available.
    func ask() {
        guard logic.asked() else { return }
        begin()
    }

    private func pulled(_ view: UIScrollView) -> Double {
        PullRefreshLogic.pulled(offsetY: Double(view.contentOffset.y), adjustedTop: Double(view.adjustedContentInset.top))
    }

    private func moved() {
        guard let view = scrollView else { return }
        let amount = pulled(view)
        if logic.moved(pulled: amount, dragging: view.isDragging) { tap.impactOccurred() }
        paint(view, pulled: amount)
    }

    @objc private func panned(_ gesture: UIPanGestureRecognizer) {
        guard gesture.state == .ended || gesture.state == .cancelled || gesture.state == .failed else { return }
        if logic.released() { begin() }
    }

    private func begin() {
        guard let view = scrollView else { finish(); return }
        // Added while the list is still past its top, so it settles at the held space rather than jumping to the top first.
        addedInset = CGFloat(PullRefreshLogic.held)
        view.contentInset.top += addedInset
        paint(view, pulled: pulled(view))
        longestHold = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(PullRefreshLogic.longestHold * 1_000_000_000))
            if !Task.isCancelled { self?.finish() }
        }
        onRefresh?()
    }

    private func giveBackSpace() {
        guard let view = scrollView, addedInset != 0 else { removeDots(); return }
        let amount = addedInset
        addedInset = 0
        UIView.animate(withDuration: 0.25, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction], animations: {
            view.contentInset.top -= amount
            // Only when the list is showing the held space: a list scrolled down meanwhile stays where it is.
            let top = -view.adjustedContentInset.top
            if view.contentOffset.y < top && !view.isDragging { view.contentOffset.y = top }
        }, completion: { [weak self] _ in
            guard let self, let view = self.scrollView else { return }
            self.moved()
            if self.pulled(view) <= 0 { self.removeDots() }
        })
    }

    private func paint(_ view: UIScrollView, pulled amount: Double) {
        let refreshing = logic.phase == .refreshing
        // Only a finger's pull, or a refresh and its fading out. A fling bouncing off the top draws nothing.
        let drawn: Bool
        switch logic.phase {
        case .idle: drawn = false
        case .pulling: drawn = amount > 0
        case .refreshing: drawn = true
        case .settling: drawn = amount > 0 && dots != nil
        }
        guard drawn else { removeDots(); return }
        let host = dots ?? addDots(to: view)
        let side: CGFloat = 24
        // Centred in the space above the first row, which is the pull plus whatever is being held open. In the scroll
        // view's own coordinates the first row starts at 0, so the space runs up from there.
        let space = CGFloat(amount) + addedInset
        let y = -space / 2 - side / 2
        host.view.frame = CGRect(x: view.bounds.midX - side / 2, y: y, width: side, height: side)
        host.view.alpha = CGFloat(PullRefreshLogic.shown(pulled: amount, refreshing: refreshing))
    }

    private func addDots(to view: UIScrollView) -> UIHostingController<AnyView> {
        let host = UIHostingController(rootView: AnyView(
            SweepDots(size: 24, label: "Refreshing", scales: false, stillWhenReduced: true)
        ))
        host.view.backgroundColor = .clear
        host.view.isUserInteractionEnabled = false
        view.addSubview(host.view)
        dots = host
        tap.prepare()
        return host
    }

    private func removeDots() {
        dots?.view.removeFromSuperview()
        dots = nil
    }
}

/// Finds the scroll view a SwiftUI list or scroll view is drawn with. There is no API for this before iOS 18, so it walks
/// outward from a view placed behind the list and takes the scroll view that covers it. A list that is never found simply
/// has no pull: it cannot draw the wrong thing, and DotsRefreshUITests fails if a list stops being found.
private struct ScrollViewFinder: UIViewRepresentable {
    let driver: DotsRefreshDriver

    final class Probe: UIView {
        var found: ((UIScrollView) -> Void)?
        private var tries = 0

        override func didMoveToWindow() {
            super.didMoveToWindow()
            tries = 0
            look()
        }

        func look() {
            guard window != nil else { return }
            if let view = nearestScrollView() { found?(view); return }
            // SwiftUI may not have built the list yet.
            tries += 1
            guard tries < 20 else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.look() }
        }

        private func nearestScrollView() -> UIScrollView? {
            let mine = convert(bounds, to: nil)
            let centre = CGPoint(x: mine.midX, y: mine.midY)
            var ancestor = superview
            while let here = ancestor {
                let covering = Self.scrollViews(in: here).filter { candidate in
                    candidate.convert(candidate.bounds, to: nil).contains(centre)
                        && abs(candidate.bounds.width - mine.width) < 1
                }
                // The innermost that covers it, so a list inside another scrolling view is the list.
                if let best = covering.min(by: { $0.bounds.height < $1.bounds.height }) { return best }
                ancestor = here.superview
            }
            return nil
        }

        private static func scrollViews(in view: UIView) -> [UIScrollView] {
            view.subviews.flatMap { sub -> [UIScrollView] in
                (sub as? UIScrollView).map { [$0] } ?? scrollViews(in: sub)
            }
        }
    }

    func makeUIView(context: Context) -> Probe {
        let probe = Probe()
        probe.isHidden = true
        probe.isUserInteractionEnabled = false
        probe.found = { [weak driver] view in driver?.attach(to: view) }
        return probe
    }

    func updateUIView(_ probe: Probe, context: Context) {
        // A list can be replaced under the same view (a wait, then the list), so look again if the one held has gone.
        if driver.scrollView?.window == nil { probe.look() }
    }
}

private struct DotsRefreshModifier: ViewModifier {
    let action: @MainActor () async -> Void
    @State private var driver = DotsRefreshDriver()
    @State private var work: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .background(ScrollViewFinder(driver: driver).allowsHitTesting(false))
            .accessibilityAction(named: Text("Refresh")) { driver.ask() }
            .onAppear {
                driver.onRefresh = { [driver] in
                    work?.cancel()
                    work = Task { @MainActor in
                        await action()
                        #if DEBUG
                        // DotsRefreshUITests: a sample refresh ends too fast for anything to look at it.
                        if let held = Double(ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_PULL_SECONDS"] ?? "") {
                            try? await Task.sleep(nanoseconds: UInt64(held * 1_000_000_000))
                        }
                        #endif
                        driver.finish()
                    }
                }
            }
            .onDisappear {
                work?.cancel()
                work = nil
                driver.finish()
            }
    }
}

extension View {
    /// Pull to refresh with the dots, on the list or scroll view it is applied to. `action` is the refresh.
    func dotsRefresh(_ action: @escaping @MainActor () async -> Void) -> some View {
        modifier(DotsRefreshModifier(action: action))
    }
}
