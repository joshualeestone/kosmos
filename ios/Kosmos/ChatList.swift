import SwiftUI
import UIKit

// kosmos#8221: the chat's messages in a UIKit list (a UICollectionView whose self-sizing cells host the same SwiftUI rows),
// behind ChatView.uikitListChosen(). Measured on the simulator 11-07 (batch 1 and 2 on #8221): the lazy SwiftUI list drew nothing
// in 15 of 15 box-flip runs and needed a rebuild in 8 of 30; this list showed text in every one of 2,490 samples and never
// rebuilt. Slice 1 (.claude/plans/uikitlist-s1-8221.md): it opens at the newest message and stays there while the reader
// is there, whatever changes (new rows, a row growing, the box or the keyboard taking room). Slice 3
// (.claude/plans/uikitlist-s3-8221.md): a reader the person moved higher up keeps their exact place, the row at the top of
// the screen held at the same height, as rows land or drop off above it and as the box or the keyboard takes room.
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
        var laying = false   // inside layoutSubviews: an offset change here is the list's own, not a scroll
        override func layoutSubviews() {
            laying = true
            super.layoutSubviews()
            laying = false
            onLayout?()
        }
        // A scroll a person makes without a finger on the list: assistive technology (VoiceOver, Switch Control, Voice
        // Control and Full Keyboard Access scroll through accessibilityScroll) and a hardware keyboard's scroll keys. Told to
        // the coordinator as a drag of theirs, so the scroll it starts decides where the reader is (Coordinator.scrolled).
        var personScrolls: (() -> Void)?
        override func accessibilityScroll(_ direction: UIAccessibilityScrollDirection) -> Bool {
            personScrolls?()
            return super.accessibilityScroll(direction)
        }
        override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
            let keys: Set<UIKeyboardHIDUsage> = [.keyboardUpArrow, .keyboardDownArrow, .keyboardPageUp, .keyboardPageDown,
                                                 .keyboardHome, .keyboardEnd, .keyboardSpacebar]
            if presses.contains(where: { $0.key.map { keys.contains($0.keyCode) } ?? false }) { personScrolls?() }
            super.pressesBegan(presses, with: event)
        }
        #if DEBUG
        // kosmos#8221 slice 4: on CI's slow runner an animated scroll nobody asked for moves the list off the newest message as
        // the chat opens. Each animated scroll call is traced, with fixed words for which kind of code asked for it (read from
        // the call stack, never written out), to find what does.
        override func setContentOffset(_ p: CGPoint, animated: Bool) {
            if animated { traceAsker("setContentOffset", up: p.y < contentOffset.y) }
            super.setContentOffset(p, animated: animated)
        }
        override func scrollRectToVisible(_ r: CGRect, animated: Bool) {
            if animated { traceAsker("scrollRectToVisible", up: r.minY < contentOffset.y) }
            super.scrollRectToVisible(r, animated: animated)
        }
        func traceAsker(_ what: String, up: Bool) {
            // Only the frames just above this call: the app's own entry point is in SwiftUI, at the bottom of every stack.
            let stack = Thread.callStackSymbols.dropFirst(2).prefix(12).joined(separator: " ")
            let fromAX = stack.contains("ccessibility"), fromResponder = stack.contains("Responder")
            let fromKeyboard = stack.contains("Keyboard"), fromFocus = stack.contains("Focus"), fromSwiftUI = stack.contains("SwiftUI")
            ChatView.trace("uikit list: animated \(what), up \(up), accessibility \(fromAX), responder \(fromResponder), keyboard \(fromKeyboard), focus \(fromFocus), swiftui \(fromSwiftUI)", ring: false)
        }
        #endif
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
        var atEnd = true { didSet {
            if atEnd { place = nil }
            if atEnd != oldValue { let v = atEnd; DispatchQueue.main.async { [weak self] in self?.told?(v) } }
        } }
        var pinning = false
        // A reader higher up: the highest row on screen and how far below the top of the list it is drawn. Dropped when the
        // offset moves other than by this list's own pin, hold, layout pass or update (scrollViewDidScroll).
        var place: (id: String, dy: CGFloat)?
        // When the offset last moved other than by this list's own doing. Until a scroll ends (scrolled()), or for 0.25 s
        // after such a move, the list is moving: no place is taken and none is held, because a hold sets the offset and
        // would stop an animated scroll there (each frame of one is such a move).
        var movedAt: CFTimeInterval = 0
        func moving() -> Bool { CACurrentMediaTime() - movedAt < 0.25 }

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
        // check does). atEnd is set before the scroll, so the layout the scroll causes cannot pin the list back to the end.
        // Once a launch: a list made while the first one's scroll is waiting schedules its own, and whichever fires second
        // does nothing.
        func sampleScrollUp(_ id: String, rested: (() -> Void)?) {
            guard !ChatList.sampleUpDone else { return }
            guard let list, let source, let ip = source.indexPath(for: id) else {
                ChatView.trace("uikit list: debug scroll-up found no row"); return
            }
            ChatList.sampleUpDone = true
            atEnd = false
            place = nil
            list.scrollToItem(at: ip, at: .top, animated: false)
            ChatView.trace("uikit list: debug scroll-up done")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { rested?() }
            // KOSMOS_SAMPLE_SCROLLBY=<pt>: 5 s after the scroll-up, an animated scroll that far up the thread, made the way
            // iOS makes one for VoiceOver (no finger on the list), so a check can see it is not undone.
            if let by = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_SCROLLBY"].flatMap(Double.init) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                    guard let list = self?.list else { return }
                    let y = max(-list.adjustedContentInset.top, list.contentOffset.y - CGFloat(by))
                    list.setContentOffset(CGPoint(x: 0, y: y), animated: true)
                    ChatView.trace("uikit list: debug scroll-by done")
                }
            }
        }
        #endif

        func maxY(_ sv: UIScrollView) -> CGFloat {
            max(-sv.adjustedContentInset.top, sv.contentSize.height - sv.bounds.height + sv.adjustedContentInset.bottom)
        }

        // Whether the reader is at the newest is read during the person's own scroll and when any scroll ends (scrolled()).
        // For a reader higher up, any move that is not this list's own (pin, hold, a layout pass, an update) drops the place,
        // so a scroll with no finger on the list is followed (NewMessagesUITests' SCROLLBY check).
        // kosmos#8221 slice 4 (CI run 42535962501): the scroll nobody made at a chat's open on a slow device is a deceleration
        // with no drag before it, so a deceleration counts as the person's only after a drag of theirs.
        func scrollViewDidScroll(_ sv: UIScrollView) {
            if sv.isTracking || sv.isDragging || (sv.isDecelerating && dragged) {
                atEnd = sv.contentOffset.y >= maxY(sv) - ChatList.endSlack
                place = nil
            } else if !pinning, !applying, !(list?.laying ?? false) {
                place = nil
                movedAt = CACurrentMediaTime()
            }
        }
        // Whether the person has scrolled the list (a finger, or List.personScrolls) since a scroll last ended.
        var dragged = false
        func scrollViewWillBeginDragging(_ sv: UIScrollView) { dragged = true }
        func scrollViewDidEndDecelerating(_ sv: UIScrollView) { scrolled(sv, how: "deceleration") }
        func scrollViewDidEndDragging(_ sv: UIScrollView, willDecelerate: Bool) { if !willDecelerate { scrolled(sv, how: "drag") } }
        func scrollViewDidEndScrollingAnimation(_ sv: UIScrollView) { scrolled(sv, how: "animation") }
        func scrollViewDidScrollToTop(_ sv: UIScrollView) { scrolled(sv, how: "to top") }
        func scrolled(_ sv: UIScrollView, how: String) {
            movedAt = 0   // a scroll that has ended is at rest: the next layout holds the place taken here
            let byPerson = dragged, wasAtEnd = atEnd
            dragged = false
            // kosmos#8221 slice 4 (CI runs 42533329564 to 42540464401): on a slow device, as a chat opens, an animated scroll
            // nobody asked for moved the list 50 pt up from its end, and the list stopped following the newest message, so the
            // keyboard covered it. A person's scroll comes with a drag, or through List.personScrolls (assistive technology, a
            // keyboard's scroll keys), or is the status-bar tap (its own callback). Any other scroll that ends while the reader
            // is at the newest keeps them there and puts them at the end.
            if atEnd, !byPerson, how != "to top" {
                pin()
                ChatView.trace("uikit list: scroll ended, not the person's, kept at the end after a \(how) (\(geometry(sv)))", ring: false)
                return
            }
            atEnd = sv.contentOffset.y >= maxY(sv) - ChatList.endSlack
            ChatView.trace("uikit list: scroll ended, at end \(atEnd) (was \(wasAtEnd)), by the person \(byPerson), after a \(how) (\(geometry(sv)))", ring: false)
            if !atEnd { place = top() }
        }

        // The highest row on screen (any part of it below the top of the list) and how far its top is below the
        // list's offset, as hold() puts it back, from the rows drawn now. `keep`, when given, skips rows that are not in it: a row about to go cannot hold the place.
        func top(keep: Set<String>? = nil) -> (id: String, dy: CGFloat)? {
            guard let list, let source else { return nil }
            let edge = list.contentOffset.y + list.adjustedContentInset.top
            for ip in list.indexPathsForVisibleItems.sorted() {
                guard let a = list.layoutAttributesForItem(at: ip), a.frame.maxY > edge,
                      let id = source.itemIdentifier(for: ip), keep?.contains(id) ?? true else { continue }
                return (id, a.frame.minY - list.contentOffset.y)
            }
            return nil
        }

        // A reader higher up put back where they were: the held row at its old distance below the list's offset, within the
        // list's own range. A held row that is gone drops the place. Put back as far as the end, they are at the newest.
        func hold() {
            guard let list, let source, let p = place else { return }
            guard let ip = source.indexPath(for: p.id), let a = list.layoutAttributesForItem(at: ip) else { place = nil; return }
            let y = min(max(a.frame.minY - p.dy, -list.adjustedContentInset.top), maxY(list))
            guard abs(list.contentOffset.y - y) > 0.5 else { return }
            pinning = true
            list.contentOffset = CGPoint(x: 0, y: y)
            pinning = false
            if y >= maxY(list) - ChatList.endSlack { atEnd = true }
        }

        // After every layout, never under the person's finger or fling: a reader at the newest message is put back at the end
        // wherever the offset is, and a reader higher up is held at their place (taken here first when there is none).
        // kosmos#8221 slice 4: CI's slow runner leaves the newest message behind the keyboard in one check; each layout at a new
        // height is traced (Debug trace only, not the report's ring) with what laidOut decided, to see why.
        var tracedH: CGFloat = -1
        func geometry(_ sv: UIScrollView) -> String {
            "y \(Int(sv.contentOffset.y)), end \(Int(maxY(sv))), size \(Int(sv.contentSize.height)), height \(Int(sv.bounds.height)), inset \(Int(sv.adjustedContentInset.bottom))"
        }
        func laidOut() {
            guard let list, !pinning else { return }
            if list.bounds.height != tracedH {
                tracedH = list.bounds.height
                let busy = list.isTracking ? "tracking" : list.isDragging ? "dragging" : list.isDecelerating ? "decelerating" : "still"
                ChatView.trace("uikit list: laid out at a new height, at end \(atEnd), \(busy), moving \(moving()) (\(geometry(list)))", ring: false)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                    guard let self, let list = self.list else { return }
                    ChatView.trace("uikit list: 0.5 s later, at end \(self.atEnd) (\(self.geometry(list)))", ring: false)
                }
            }
            guard list.contentSize.height > 0, !(list.isTracking || list.isDragging || list.isDecelerating) else { return }
            if atEnd { pin() } else if !moving() { if place == nil { place = top() } else { hold() } }
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
        // spent: seconds inside apply.
        var applies = 0
        var redrawn = 0
        var spent: CFTimeInterval = 0
        var applying = false   // inside source.apply: an offset change there is the update's own, not a scroll

        func apply(_ now: [String]) {
            guard let source else { return }
            let started = CACurrentMediaTime()
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
            // A reader higher up whose top row is about to go holds the next row on screen that stays, as it is drawn now.
            let heldGoes = place.map { !kept.contains($0.id) } ?? !moving()
            if !atEnd, heldGoes { place = top(keep: kept) }
            let again = shown.filter { kept.contains($0) }
            if !again.isEmpty { s.reconfigureItems(again) }
            applying = true
            source.apply(s, animatingDifferences: false)
            applying = false
            redrawn += again.count
            spent += CACurrentMediaTime() - started
            if applies % 50 == 0 { ChatView.trace("uikit list: \(applies) updates, \(redrawn) cells drawn again, \(Int(spent * 1000)) ms") }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> List {
        var config = UICollectionLayoutListConfiguration(appearance: .plain)
        config.showsSeparators = false
        config.backgroundColor = .clear
        let list = List(frame: .zero, collectionViewLayout: UICollectionViewCompositionalLayout.list(using: config))
        list.backgroundColor = .clear
        // kosmos#8221 slice 5: how a UI check tells which list drew the chat (Settings' "New chat list" switch).
        list.accessibilityIdentifier = "chat-list-uikit"
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
        list.personScrolls = { [weak co] in co?.dragged = true }
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
            // A fling stopped that way never reports its end, so its drag would count for the next scroll nobody made.
            if !(list.isTracking || list.isDragging) { co.dragged = false }
            list.setNeedsLayout()
            if !(list.isTracking || list.isDragging) { co.pin() }
        }
    }
}
