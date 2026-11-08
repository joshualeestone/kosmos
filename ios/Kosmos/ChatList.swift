import SwiftUI
import UIKit

// kosmos#8221: the chat's messages in a UIKit list (a UICollectionView whose self-sizing cells host the same SwiftUI rows),
// behind ChatView.uikitList. Measured on the simulator 11-07 (batch 1 and 2 on #8221): the lazy SwiftUI list drew nothing
// in 15 of 15 box-flip runs and needed a rebuild in 8 of 30; this list showed text in every one of 2,490 samples and never
// rebuilt. Slice 1 (.claude/plans/uikitlist-s1-8221.md): it opens at the newest message and stays there while the reader
// is there, whatever changes (new rows, a row growing, the box or the keyboard taking room). A reader the person moved
// higher up is left where they are; keeping their exact place as rows land above is a later slice.
struct ChatList: UIViewRepresentable {
    // The cells top to bottom: messages, then sends on their way, then the working line, then the room at the end.
    let ids: [String]
    let cell: (String) -> AnyView
    // Bumped by the chat to go to the newest message (a send, New messages): followed even from higher up.
    let newest: Int
    // Whether the reader is at the newest message, told when it changes (never during a layout pass).
    let atEnd: (Bool) -> Void
    // Debug only (KOSMOS_SAMPLE_SCROLLUP): the row put at the top 3 s after the list opens, and what to run once it is there.
    // ChatView passes nil and an empty closure in a release build.
    var sampleUp: String? = nil
    var sampleRested: (() -> Void)? = nil

    // How close to the end still counts as at the newest message after the person's own scroll.
    static let endSlack: CGFloat = 40
    #if DEBUG
    static var sampleUpDone = false   // set once KOSMOS_SAMPLE_SCROLLUP has scrolled; a list made after that does not scroll again
    #endif

    final class List: UICollectionView {
        var onLayout: (() -> Void)?
        override func layoutSubviews() { super.layoutSubviews(); onLayout?() }
    }

    final class Coordinator: NSObject, UICollectionViewDelegate {
        var source: UICollectionViewDiffableDataSource<Int, String>?
        var cell: ((String) -> AnyView)?
        var environment = EnvironmentValues()
        var told: ((Bool) -> Void)?
        weak var list: List?
        var ids: [String] = []
        var newest = 0
        // At the newest message: the list is kept at its end through every change until the person scrolls away.
        var atEnd = true { didSet { if atEnd != oldValue { let v = atEnd; DispatchQueue.main.async { [weak self] in self?.told?(v) } } } }
        var pinning = false

        func configure(_ c: UICollectionViewCell, _ id: String) {
            guard let cell else { return }
            let env = environment
            c.contentConfiguration = UIHostingConfiguration {
                // The long-press sheet's host is the chat's (messageActionsHost); a hosted cell does not inherit SwiftUI's
                // environment, so the two values the bubbles read are carried in.
                // One stack with no spacing: a cell can hold two views (a send that starts a day is its day line and its
                // bubble), which a hosting configuration would otherwise space 8 pt apart (measured 11-07: the list stepped
                // 8 pt as such a send became its two rows). The lazy list's stack has no spacing either.
                VStack(alignment: .leading, spacing: 0) { cell(id) }
                    .environment(\.openMessageActions, env.openMessageActions)
                    .environment(\.shownMessageActions, env.shownMessageActions)
            }
            .margins(.horizontal, 16).margins(.vertical, 0)
            .minSize(height: 0)   // a list cell's default 44 pt would add room under a day line or the working line
            c.backgroundConfiguration = .clear()
        }

        #if DEBUG
        // kosmos#8221 slice 2: KOSMOS_SAMPLE_SCROLLUP on this list, a fixed place to start a check from. It sets atEnd itself
        // and skips the scroll delegate, so it does not test how a person's scroll decides atEnd (NewMessagesUITests' drag
        // check does). atEnd is set before the scroll, so the layout the scroll causes cannot pin the list back to the end;
        // the rested call then needs no wait for the end to leave (unlike the lazy list's sampleScrollRest).
        func sampleScrollUp(_ id: String, rested: (() -> Void)?) {
            guard let list, let source, let ip = source.indexPath(for: id) else {
                ChatView.trace("uikit list: debug scroll-up found no row \(id)"); return
            }
            ChatList.sampleUpDone = true
            atEnd = false
            list.scrollToItem(at: ip, at: .top, animated: false)
            ChatView.trace("uikit list: debug scroll-up to \(id)")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { rested?() }
        }
        #endif

        func maxY(_ sv: UIScrollView) -> CGFloat {
            max(-sv.adjustedContentInset.top, sv.contentSize.height - sv.bounds.height + sv.adjustedContentInset.bottom)
        }

        // The person's own scroll decides where the reader is; a scroll by code never does.
        func scrollViewDidScroll(_ sv: UIScrollView) {
            guard sv.isTracking || sv.isDragging || sv.isDecelerating else { return }
            atEnd = sv.contentOffset.y >= maxY(sv) - ChatList.endSlack
        }
        func scrollViewDidEndDecelerating(_ sv: UIScrollView) { atEnd = sv.contentOffset.y >= maxY(sv) - ChatList.endSlack }
        func scrollViewDidEndDragging(_ sv: UIScrollView, willDecelerate: Bool) {
            if !willDecelerate { atEnd = sv.contentOffset.y >= maxY(sv) - ChatList.endSlack }
        }

        // After every layout: a reader at the newest message is put back at the end wherever the offset is. Never under the
        // person's finger or fling.
        func laidOut() {
            guard let list, !pinning else { return }
            guard atEnd, list.contentSize.height > 0, !(list.isTracking || list.isDragging || list.isDecelerating) else { return }
            pin()
        }

        func pin() {
            guard let list else { return }
            let y = maxY(list)
            guard abs(list.contentOffset.y - y) > 0.5 else { return }
            pinning = true
            list.contentOffset = CGPoint(x: 0, y: y)
            pinning = false
        }

        // The cells on screen are drawn again on every update, in the same apply as any new cells: a cell that stays can
        // still change (a reaction, a send's state, the working line, and a message losing its time when a new one joins
        // its run). Measured 11-07: drawn again only on a later update, the bubble above a send shrank 8 pt as the send
        // settled, and the list stepped.
        // How often the list was updated and how many cells that drew again, for measuring what a keystroke costs.
        var applies = 0
        var redrawn = 0

        func apply(_ now: [String]) {
            guard let source else { return }
            applies += 1
            let shown = list?.indexPathsForVisibleItems.compactMap { source.itemIdentifier(for: $0) } ?? []
            var s: NSDiffableDataSourceSnapshot<Int, String>
            if now != ids {
                ids = now
                s = NSDiffableDataSourceSnapshot<Int, String>()
                s.appendSections([0])
                s.appendItems(now)
            } else {
                s = source.snapshot()
            }
            let kept = Set(now)
            let again = shown.filter { kept.contains($0) }
            if !again.isEmpty { s.reconfigureItems(again) }
            source.apply(s, animatingDifferences: false)
            redrawn += again.count
            if applies % 50 == 0 { ChatView.trace("uikit list: \(applies) updates, \(redrawn) cells drawn again") }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> List {
        var config = UICollectionLayoutListConfiguration(appearance: .plain)
        config.showsSeparators = false
        config.backgroundColor = .clear
        let list = List(frame: .zero, collectionViewLayout: UICollectionViewCompositionalLayout.list(using: config))
        list.backgroundColor = .clear
        list.keyboardDismissMode = .interactive
        list.alwaysBounceHorizontal = false
        list.showsHorizontalScrollIndicator = false
        // A cell is built only as it comes on screen: a cell prepared ahead would keep what it was built with, and only the cells
        // on screen are drawn again on an update (apply).
        list.isPrefetchingEnabled = false
        // The list's own room above its first row and below its last, as the lazy list's padding (ChatView.listPadV).
        list.contentInset = UIEdgeInsets(top: ChatView.listPadV, left: 0, bottom: ChatView.listPadV, right: 0)
        let co = context.coordinator
        co.list = list
        co.cell = cell
        co.told = atEnd
        co.environment = context.environment
        co.newest = newest
        let reg = UICollectionView.CellRegistration<UICollectionViewCell, String> { [weak co] c, _, id in co?.configure(c, id) }
        co.source = UICollectionViewDiffableDataSource<Int, String>(collectionView: list) { cv, ip, id in
            cv.dequeueConfiguredReusableCell(using: reg, for: ip, item: id)
        }
        list.delegate = co
        list.onLayout = { [weak co] in co?.laidOut() }
        co.apply(ids)
        // A new list opens at the newest message: the chat is told so once, as it is told of every later change.
        let told = atEnd
        DispatchQueue.main.async { told(true) }
        #if DEBUG
        if let up = sampleUp, !Self.sampleUpDone {
            let rested = sampleRested
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak co] in co?.sampleScrollUp(up, rested: rested) }
        }
        #endif
        return list
    }

    func updateUIView(_ list: List, context: Context) {
        let co = context.coordinator
        co.cell = cell
        co.told = atEnd
        co.environment = context.environment
        co.apply(ids)
        if newest != co.newest {
            co.newest = newest
            co.atEnd = true
            ChatView.trace("uikit list: to the newest")
            // A fling still running would carry on past the move; stopping it in place first. A finger on the list is never
            // moved; where it lets go decides again, as any scroll of theirs does.
            if list.isDecelerating { list.setContentOffset(list.contentOffset, animated: false) }
            list.setNeedsLayout()
            if !(list.isTracking || list.isDragging) { co.pin() }
        }
    }
}
