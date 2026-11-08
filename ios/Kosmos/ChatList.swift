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

    // How close to the end still counts as at the newest message after the person's own scroll.
    static let endSlack: CGFloat = 40

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
        var lastHeight: CGFloat = 0
        var lastContent: CGFloat = 0
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

        // After every layout: a reader at the newest message stays at the end when the list's height (box, keyboard) or the
        // content's (new rows, a row measured or grown) changed. Never under the person's finger or fling.
        func laidOut() {
            guard let list, !pinning else { return }
            let h = list.bounds.height, c = list.contentSize.height
            defer { lastHeight = h; lastContent = c }
            guard atEnd, !ids.isEmpty, c > 0, !(list.isTracking || list.isDragging || list.isDecelerating) else { return }
            if h != lastHeight || c != lastContent || abs(list.contentOffset.y - maxY(list)) > 0.5 { pin() }
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
        func apply(_ now: [String]) {
            guard let source else { return }
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
            list.setNeedsLayout()
            co.pin()
        }
    }
}
