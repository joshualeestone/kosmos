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
/// Not used in ChatView or RoomView, whose newest message is at the bottom: EndPullDriver, below, is the chat's.
@MainActor
final class DotsRefreshDriver: NSObject {
    /// The refresh, read when a pull starts, so a list's latest closure runs and not the one from when it appeared. The
    /// driver ends the refresh when it returns. For work that ends elsewhere, use `onRefresh` and call `finish()`.
    var refreshAction: (@MainActor () async -> Void)?
    /// For a refresh that ends elsewhere: the board page's load, which its navigation delegate sees finish.
    var onRefresh: (() -> Void)?
    /// Whether to hold space open under the top while refreshing. False for a web view: WebKit manages that scroll view's
    /// insets itself, so this never writes them, and the dots rest over the top of the page until it has loaded.
    var holdsSpace = true

    private(set) weak var scrollView: UIScrollView?
    private var logic = PullRefreshLogic()
    private var offsetWatch: NSKeyValueObservation?
    private var dots: UIHostingController<AnyView>?
    /// The top inset this driver set, and what it was before, so it gives back only its own change. If anything has written
    /// the inset since, that write stands: subtracting from it would leave the first rows under the bar.
    private var insetSet: CGFloat?
    private var insetBefore: CGFloat = 0
    private var givingBack = false
    private var work: Task<Void, Never>?
    private var longestHold: Task<Void, Never>?
    private lazy var tap = UIImpactFeedbackGenerator(style: .light)   // lazy: SwiftUI makes and drops many drivers

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

    /// The list went away: its refresh is cancelled, as iOS's own is, and the space is given back.
    func cancel() {
        work?.cancel()
        work = nil
        finish()
    }

    /// VoiceOver's way to refresh, where a pull is not available. It says so, since nothing else would tell them.
    func ask() {
        guard logic.asked() else { return }
        begin()
        // Bring the held space into view: nobody's finger has moved the list there.
        if let view = scrollView, holdsSpace { view.setContentOffset(CGPoint(x: view.contentOffset.x, y: -view.adjustedContentInset.top), animated: true) }
        UIAccessibility.post(notification: .announcement, argument: "Refreshing")
    }

    private func pulled(_ view: UIScrollView) -> Double {
        PullRefreshLogic.pulled(offsetY: Double(view.contentOffset.y), adjustedTop: Double(view.adjustedContentInset.top))
    }

    private func moved() {
        // While the space is being given back, the animation's own moves are not a pull.
        guard let view = scrollView, !givingBack else { return }
        let amount = pulled(view)
        if logic.moved(pulled: amount, dragging: view.isDragging) { tap.impactOccurred() }
        paint(view, pulled: amount)
    }

    @objc private func panned(_ gesture: UIPanGestureRecognizer) {
        guard gesture.state == .ended || gesture.state == .cancelled || gesture.state == .failed else { return }
        if logic.released() { begin() }
    }

    private func begin() {
        guard let view = scrollView else { _ = logic.ended(); return }
        if holdsSpace {
            // Added while the list is still past its top, so it settles at the held space rather than jumping to the top.
            insetBefore = view.contentInset.top
            let top = insetBefore + CGFloat(PullRefreshLogic.held)
            view.contentInset.top = top
            insetSet = top
        }
        paint(view, pulled: pulled(view))
        longestHold = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(PullRefreshLogic.longestHold * 1_000_000_000))
            if !Task.isCancelled { self?.finish() }
        }
        if let onRefresh {
            onRefresh()
        } else if let refreshAction {
            // One the longest hold let go of may still be running: it must not end this one when it returns.
            work?.cancel()
            work = Task { [weak self] in
                await refreshAction()
                #if DEBUG
                // DotsRefreshUITests: a sample refresh ends too fast for anything to look at it.
                if let held = Double(ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_PULL_SECONDS"] ?? "") {
                    try? await Task.sleep(nanoseconds: UInt64(held * 1_000_000_000))
                }
                #endif
                // A cancelled refresh ends nothing: whoever cancelled it has dealt with the space, or a newer refresh holds it.
                if !Task.isCancelled { self?.finish() }
            }
        } else {
            finish()
        }
    }

    private func giveBackSpace() {
        guard let view = scrollView else { removeDots(); return }
        let set = insetSet
        insetSet = nil
        givingBack = true
        UIView.animate(withDuration: 0.25, delay: 0, options: [.beginFromCurrentState, .allowUserInteraction], animations: {
            self.dots?.view.alpha = 0
            if let set, abs(view.contentInset.top - set) < 0.5 { view.contentInset.top = self.insetBefore }
            // Only when the list is showing the held space: a list scrolled down meanwhile stays where it is. And only on
            // screen: off screen a view's safe area reads 0, so this would put the first rows under the bar on the way back.
            let top = -view.adjustedContentInset.top
            if view.window != nil && view.contentOffset.y < top && !view.isDragging { view.contentOffset.y = top }
        }, completion: { [weak self] _ in
            guard let self else { return }
            self.givingBack = false
            self.removeDots()
            self.moved()
        })
    }

    private func paint(_ view: UIScrollView, pulled amount: Double) {
        let refreshing = logic.phase == .refreshing
        let drawn: Bool
        switch logic.phase {
        // Only a finger's pull or a refresh. A fling bouncing off the top draws nothing.
        case .pulling: drawn = amount > 0
        case .refreshing: drawn = true
        case .idle, .settling: drawn = false
        }
        guard drawn else { removeDots(); return }
        let host = dots ?? addDots(to: view)
        let side: CGFloat = 24
        let y: CGFloat
        if refreshing && !holdsSpace {
            // Nothing held open: over the top of the page, wherever the page has gone. Staying where the pull left it until
            // the page comes back to meet it, so it does not jump on release.
            y = max(view.contentOffset.y + view.adjustedContentInset.top + 12, -CGFloat(amount) / 2 - side / 2)
        } else {
            // Centred in the space above the first row, which is the pull plus whatever is held open. In the scroll view's
            // own coordinates the first row starts at 0, so the space runs up from there.
            let space = CGFloat(amount) + (insetSet.map { $0 - insetBefore } ?? 0)
            y = -space / 2 - side / 2
        }
        host.view.frame = CGRect(x: view.bounds.midX - side / 2, y: y, width: side, height: side)
        host.view.alpha = CGFloat(PullRefreshLogic.shown(pulled: amount, refreshing: refreshing))
    }

    private func addDots(to view: UIScrollView) -> UIHostingController<AnyView> {
        let host = refreshDotsHost(in: view)
        dots = host
        tap.prepare()
        return host
    }

    private func removeDots() {
        dots?.view.removeFromSuperview()
        dots = nil
    }
}

@MainActor private func refreshDotsHost(in view: UIScrollView) -> UIHostingController<AnyView> {
    let host = UIHostingController(rootView: AnyView(
        SweepDots(size: 24, label: "Refreshing", scales: false, stillWhenReduced: true)
    ))
    host.view.backgroundColor = .clear
    host.view.isUserInteractionEnabled = false
    view.addSubview(host.view)
    return host
}

/// kosmos#8072 (Josh 11-05 16:49): pulling a chat up past its newest message shows the dots and reads the thread.
///
/// It writes nothing to the scroll view: no inset and no offset, unlike the driver above. In the simulator a bottom inset
/// changing on a list still estimating its height is what makes the list go blank (kosmos#7420), so no space is held and the
/// list bounces back by itself. Armed only while `allowed` says so, which the chat ties to its end marker showing.
@MainActor
final class EndPullDriver: NSObject {
    /// Read on each move: whether a pull can count now.
    var allowed: () -> Bool = { false }
    /// How far above the content's end the dots' centre rests once the list has bounced back.
    var restsAbove: CGFloat = 0
    var refresh: (@MainActor () async -> Void)?

    private(set) weak var scrollView: UIScrollView?
    private var logic = PullRefreshLogic()
    private var offsetWatch: NSKeyValueObservation?
    private var dots: UIHostingController<AnyView>?
    private var work: Task<Void, Never>?
    private var longestHold: Task<Void, Never>?
    private lazy var tap = UIImpactFeedbackGenerator(style: .light)

    func attach(to view: UIScrollView) {
        guard view !== scrollView else { return }
        detach()
        scrollView = view
        offsetWatch = view.observe(\.contentOffset, options: [.new]) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.moved() }
        }
        view.panGestureRecognizer.addTarget(self, action: #selector(panned(_:)))
    }

    func detach() {
        offsetWatch?.invalidate()
        offsetWatch = nil
        scrollView?.panGestureRecognizer.removeTarget(self, action: #selector(panned(_:)))
        work?.cancel()
        work = nil
        finish()
        removeDots()
        scrollView = nil
    }

    private func amount(_ view: UIScrollView) -> Double {
        guard allowed() else { return 0 }
        return PullRefreshLogic.pastEnd(offsetY: Double(view.contentOffset.y), content: Double(view.contentSize.height),
                                        view: Double(view.bounds.height), adjustedTop: Double(view.adjustedContentInset.top),
                                        adjustedBottom: Double(view.adjustedContentInset.bottom))
    }

    private func moved() {
        guard let view = scrollView else { return }
        let pulled = amount(view)
        if logic.moved(pulled: pulled, dragging: view.isDragging) { tap.impactOccurred() }
        paint(view, pulled: pulled)
    }

    @objc private func panned(_ gesture: UIPanGestureRecognizer) {
        guard gesture.state == .ended || gesture.state == .cancelled || gesture.state == .failed else { return }
        guard logic.released() else { return }
        ChatView.trace("end pull: reading")
        moved()
        longestHold = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(PullRefreshLogic.longestHold * 1_000_000_000))
            if !Task.isCancelled { self?.finish() }
        }
        let refresh = self.refresh
        work?.cancel()
        work = Task { [weak self] in
            let started = Date()
            await refresh?()
            #if DEBUG
            // EndPullUITests: a sample read ends too fast for anything to look at it.
            let least = Double(ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_PULL_SECONDS"] ?? "") ?? PullRefreshLogic.leastShow
            #else
            let least = PullRefreshLogic.leastShow
            #endif
            let rest = least - Date().timeIntervalSince(started)
            if rest > 0 { try? await Task.sleep(nanoseconds: UInt64(rest * 1_000_000_000)) }
            if !Task.isCancelled { self?.finish() }
        }
    }

    private func finish() {
        guard logic.ended() else { return }
        longestHold?.cancel()
        longestHold = nil
        ChatView.trace("end pull: done")
        removeDots()
        moved()   // the list may have come back already, and then no move would end the settling
    }

    /// The chat left, or the app did: its read says nothing now, and the next pull starts clean.
    func cancelRead() {
        work?.cancel()
        work = nil
        finish()
    }

    private func paint(_ view: UIScrollView, pulled: Double) {
        let refreshing = logic.phase == .refreshing
        let drawn: Bool
        switch logic.phase {
        case .pulling: drawn = pulled > 0
        case .refreshing: drawn = true
        case .idle, .settling: drawn = false
        }
        guard drawn else { removeDots(); return }
        let host = dots ?? addDots(to: view)
        let side: CGFloat = 24
        // In the content's own coordinates: centred in the space a full pull opens, sliding to its rest as the list comes back.
        let open = CGFloat(min(1, pulled / PullRefreshLogic.threshold))
        let centre = view.contentSize.height + CGFloat(pulled) / 2 - restsAbove * (1 - open)
        host.view.frame = CGRect(x: view.bounds.midX - side / 2, y: centre - side / 2, width: side, height: side)
        host.view.alpha = CGFloat(PullRefreshLogic.shown(pulled: pulled, refreshing: refreshing))
    }

    private func addDots(to view: UIScrollView) -> UIHostingController<AnyView> {
        let host = refreshDotsHost(in: view)
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
/// outward from a view placed behind the list and takes the nearest scroll view that covers it. A list that is not found has
/// no pull. DotsRefreshUITests, run by hand, fails if a tab's list or a pushed screen's stops being found.
private struct ScrollViewFinder: UIViewRepresentable {
    let driver: DotsRefreshDriver

    final class Probe: UIView {
        var found: ((UIScrollView) -> Void)?
        private var tries = 0

        override func didMoveToWindow() {
            super.didMoveToWindow()
            tries = 0
            // Not yet: SwiftUI adds the list beside this view in the same pass, and until it has, the nearest scroll view that
            // covers this spot can be the screen underneath, during a push or a switch between two lists.
            DispatchQueue.main.async { [weak self] in self?.look() }
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
                    !candidate.isHidden && candidate.alpha > 0 && candidate.window != nil
                        && candidate.convert(candidate.bounds, to: nil).contains(centre)
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
        // If SwiftUI updates this and the list held has gone, look again.
        if driver.scrollView?.window == nil { probe.look() }
    }
}

private struct DotsRefreshModifier: ViewModifier {
    let action: @MainActor () async -> Void
    @State private var driver = DotsRefreshDriver()

    func body(content: Content) -> some View {
        // On every render, so a pull runs this render's closure, as iOS's own does: a closure that reads a view's `let` sees
        // the value of the render that made it. Not published state, so setting it here starts no new render.
        let _ = { driver.refreshAction = action }()
        return content
            .background(ScrollViewFinder(driver: driver).allowsHitTesting(false))
            .accessibilityAction(named: Text("Refresh")) { driver.ask() }
            .onDisappear { driver.cancel() }
    }
}

extension View {
    /// Pull to refresh with the dots, on the list or scroll view it is applied to. `action` is the refresh.
    func dotsRefresh(_ action: @escaping @MainActor () async -> Void) -> some View {
        modifier(DotsRefreshModifier(action: action))
    }
}
