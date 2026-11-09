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
    // kosmos#8221 slice 7: whether the reader is at the top of what is loaded (earlier messages load there), told when it
    // changes (never during a layout pass). A chat too short to scroll is at its top.
    var atTop: (Bool) -> Void = { _ in }
    // kosmos#8221 slice 9: the list's scroll view, handed to the chat once it is made, for the pull past the newest message
    // (EndPullDriver watches its offset and its pan, and takes no delegate).
    var scroller: (UIScrollView) -> Void = { _ in }
    // Debug only (KOSMOS_SAMPLE_SCROLLUP): the row put at the top 3 s after the list opens, and what to run once it is there.
    // ChatView passes nil and an empty closure in a release build.
    var sampleUp: String? = nil
    var sampleRested: (() -> Void)? = nil
    // Debug only (KOSMOS_SAMPLE_A11YSCROLL=<seconds>, kosmos#8221 slice 11): that long after the list opens, one scroll up of
    // the kind VoiceOver makes (told through personScrolls, then animated), then what the list did, for a check.
    var sampleA11y: ((String) -> Void)? = nil

    // How close to the end still counts as at the newest message after the person's own scroll.
    static let endSlack: CGFloat = 40
    // kosmos#8221 slice 11: how long after a scroll is asked for without a finger its first move still counts as the person's
    // (UIKit starts an animated scroll on the next frame)...
    static let personScrollAsk: CFTimeInterval = 0.5
    // ...and how long after its last move it still counts as running.
    static let personScrollQuiet: CFTimeInterval = 0.3
    #if DEBUG
    static var sampleUpDone = false   // set once KOSMOS_SAMPLE_SCROLLUP has scrolled; a list made after that does not scroll again
    static var sampleA11yDone = false   // KOSMOS_SAMPLE_A11YSCROLL scrolls once a launch, as sampleUpDone
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
        var toldTop: ((Bool) -> Void)?
        var atTop = false { didSet {
            if atTop != oldValue {
                ChatView.trace("uikit list: atTop \(atTop)", ring: false)
                let v = atTop
                DispatchQueue.main.async { [weak self] in self?.toldTop?(v) }
            }
        } }
        // Within endSlack of the list's top. Read where the offset is the reader's: during their scroll, when any scroll
        // ends, and after a layout once this list has put itself in place (never from the first offset a new list has,
        // which is its top before it is pinned to the end).
        func readTop(_ sv: UIScrollView) {
            guard sv.contentSize.height > 0 else { return }
            atTop = sv.contentOffset.y <= -sv.adjustedContentInset.top + ChatList.endSlack
        }
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
        // kosmos#8221 slice 11: KOSMOS_SAMPLE_A11YSCROLL. Counts the times pin() moved the list (the reader put back at the
        // end) while the scroll ran and a little after, which is how a reader at the newest saw the hold before this slice.
        // KOSMOS_SAMPLE_A11YSCROLL_MODE: "animated" (default) is one page up as VoiceOver's scroll does it, its end reported;
        // "stepped" is 30 moves of 15 pt, 50 ms apart, with no end reported, a scroll slower than the window's quiet time;
        // "still" asks for a scroll and moves nothing, as an arrow key that only moves focus does.
        var debugPinsUntil: CFTimeInterval = 0
        var debugPins = 0
        var debugWindowOpened = false
        func sampleA11yScroll(_ report: ((String) -> Void)?) {
            guard !ChatList.sampleA11yDone, let list else { return }
            ChatList.sampleA11yDone = true
            let mode = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_A11YSCROLL_MODE"] ?? "animated"
            let wasAtEnd = atEnd, y0 = list.contentOffset.y
            let watch: TimeInterval = mode == "stepped" ? 3.0 : 1.5
            debugPins = 0
            debugWindowOpened = false
            debugPinsUntil = CACurrentMediaTime() + watch
            // Not list.accessibilityScroll(.up) itself: on the simulator with VoiceOver off it scrolls nothing (measured 11-09:
            // moved 0 on both arms). This is what that call does with VoiceOver on, through the list's own entry point: the
            // person is scrolling (personScrolls), then the scroll itself.
            list.personScrolls?()
            switch mode {
            case "stepped":
                for i in 1...30 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05 * Double(i)) { [weak list] in
                        guard let list else { return }
                        list.contentOffset = CGPoint(x: 0, y: max(-list.adjustedContentInset.top, list.contentOffset.y - 15))
                    }
                }
            case "still":
                break
            default:
                let y = max(-list.adjustedContentInset.top, list.contentOffset.y - list.bounds.height * 0.8)
                list.setContentOffset(CGPoint(x: 0, y: y), animated: true)
            }
            ChatView.trace("uikit list: debug accessibility scroll up, from the end \(wasAtEnd)", ring: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + watch + 0.1) { [weak self] in
                guard let self, let list = self.list else { return }
                report?("pins \(self.debugPins), at end \(self.atEnd), moved \(Int(y0 - list.contentOffset.y)), window \(self.debugWindowOpened), dragged \(self.dragged), from the end \(wasAtEnd)")
            }
        }

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
            let own = pinning || applying || (list?.laying ?? false)   // the list's own writes are never the person's
            // kosmos#8221 slice 11: the first move of a scroll the person asked for without a finger opens its window, and
            // each later move keeps it open a little longer, so it closes only once the moves stop, however long they take.
            let fingerless = !(sv.isTracking || sv.isDragging || sv.isDecelerating)
            if !own, fingerless, !personScrolling(), CACurrentMediaTime() - personAskedAt < ChatList.personScrollAsk { personScrollOpened() }
            if !own, personScrolling() { personUntil = max(personUntil, CACurrentMediaTime() + ChatList.personScrollQuiet) }
            if sv.isTracking || sv.isDragging || (sv.isDecelerating && dragged) || (personScrolling() && !own) {
                atEnd = sv.contentOffset.y >= maxY(sv) - ChatList.endSlack
                readTop(sv)
                place = nil
            } else if !own {
                place = nil
                movedAt = CACurrentMediaTime()
            }
        }
        // Whether the person has scrolled the list (a finger, or List.personScrolls) since a scroll last ended.
        var dragged = false
        // kosmos#8221 slice 11: a scroll the person makes without a finger (List.personScrolls: VoiceOver, Voice Control, a
        // keyboard's scroll keys) is an animation, so the list is not tracking, dragging or decelerating while it runs, and
        // laidOut used to pin a reader at the newest back to the end on every frame of it (measured: 18 times in one page
        // scroll, which then ended where it began). While it runs, laidOut leaves the list alone and the scroll's own moves
        // decide where the reader is, as a finger's do.
        // It runs from its first move (within personScrollAsk of being asked for: a press that scrolls nothing, such as an
        // arrow key moving focus, opens nothing, and is let go when that time is up) until its end is reported (scrolled) or it has not moved
        // for personScrollQuiet. On that lapse the reader is where its last move put them (at the newest or not, read by
        // scrollViewDidScroll), and the list is put back to that as after any layout.
        var personAskedAt: CFTimeInterval = 0
        var personUntil: CFTimeInterval = 0
        func personScrolling() -> Bool { CACurrentMediaTime() < personUntil }
        func personScrollStarted() {
            dragged = true
            #if DEBUG
            // KOSMOS_SAMPLE_NOPERSONSCROLL=1: the list as before this slice, the control arm of A11yScrollUITests.
            if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOPERSONSCROLL"] == "1" { return }
            #endif
            let asked = CACurrentMediaTime()
            personAskedAt = asked
            // An ask whose scroll never moves (an arrow key that only moves focus) is let go once its time is up, with the drag
            // it counted, so a later scroll nobody asked for is not taken for the person's (slice 4).
            DispatchQueue.main.asyncAfter(deadline: .now() + ChatList.personScrollAsk + 0.05) { [weak self] in
                guard let self, self.personAskedAt == asked, let list = self.list,
                      !(list.isTracking || list.isDragging || list.isDecelerating) else { return }
                self.personAskedAt = 0
                self.dragged = false
            }
        }
        func personScrollOpened() {
            personAskedAt = 0   // one ask opens one window
            personUntil = CACurrentMediaTime() + ChatList.personScrollQuiet
            #if DEBUG
            debugWindowOpened = true
            #endif
            DispatchQueue.main.asyncAfter(deadline: .now() + ChatList.personScrollQuiet + 0.05) { [weak self] in self?.personScrollLapsed() }
        }
        func personScrollLapsed() {
            guard personUntil > 0 else { return }   // closed already by a reported end
            if personScrolling() {   // still moving: look again when it would close
                let wait = personUntil - CACurrentMediaTime() + 0.05
                DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in self?.personScrollLapsed() }
                return
            }
            personUntil = 0
            guard let list, !(list.isTracking || list.isDragging || list.isDecelerating) else { return }   // a finger took over: its end decides
            dragged = false
            ChatView.trace("uikit list: a scroll with no end reported let go, at end \(atEnd) (\(geometry(list)))", ring: false)
            if !atEnd { place = top() }
            laidOut()
        }
        func scrollViewWillBeginDragging(_ sv: UIScrollView) { dragged = true }
        func scrollViewDidEndDecelerating(_ sv: UIScrollView) { scrolled(sv, how: "deceleration") }
        func scrollViewDidEndDragging(_ sv: UIScrollView, willDecelerate: Bool) { if !willDecelerate { scrolled(sv, how: "drag") } }
        func scrollViewDidEndScrollingAnimation(_ sv: UIScrollView) { scrolled(sv, how: "animation") }
        func scrollViewDidScrollToTop(_ sv: UIScrollView) { scrolled(sv, how: "to top") }
        func scrolled(_ sv: UIScrollView, how: String) {
            movedAt = 0   // a scroll that has ended is at rest: the next layout holds the place taken here
            personUntil = 0; personAskedAt = 0   // kosmos#8221 slice 11: its end is reported, so the person's scroll is over
            let byPerson = dragged, wasAtEnd = atEnd
            dragged = false
            // kosmos#8221 slice 4 (CI runs 42533329564 to 42540464401): on a slow device, as a chat opens, an animated scroll
            // nobody asked for moved the list 50 pt up from its end, and the list stopped following the newest message, so the
            // keyboard covered it. A person's scroll comes with a drag, or through List.personScrolls (assistive technology, a
            // keyboard's scroll keys), or is the status-bar tap (its own callback). Any other scroll that ends while the reader
            // is at the newest keeps them there and puts them at the end.
            if atEnd, !byPerson, how != "to top" {
                pin()
                readTop(sv)
                ChatView.trace("uikit list: scroll ended, not the person's, kept at the end after a \(how) (\(geometry(sv)))", ring: false)
                return
            }
            atEnd = sv.contentOffset.y >= maxY(sv) - ChatList.endSlack
            readTop(sv)
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
            guard list.contentSize.height > 0, !(list.isTracking || list.isDragging || list.isDecelerating), !personScrolling() else { return }
            if atEnd { pin() } else if !moving() { if place == nil { place = top() } else { hold() } }
            if !moving() { readTop(list) }
        }

        func pin() {
            guard let list else { return }
            let y = maxY(list)
            guard abs(list.contentOffset.y - y) > 0.5 else { return }
            #if DEBUG
            if CACurrentMediaTime() < debugPinsUntil { debugPins += 1 }
            #endif
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
            // kosmos#8221 slice 7 review 1 (BLOCKER, measured by trace 11-09 01:29 and 01:33): rows landing ABOVE the reader
            // while the list moves (a finger on it, a fling, its bounce) were never held, because the hold runs only at rest
            // (laidOut), and the reader was left at the top of the new rows. So the row at the top of the screen now, if it
            // stays, is put back at its distance in this same update, moving or not; and the top is read again, so a reader
            // carried down by a page is no longer at the top until they reach it again (the next page is asked for then).
            let before = ids
            let anchor = atEnd ? nil : top(keep: Set(now))
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
            // kosmos#8221 slice 9 (measured 11-09 05:53, EndPullUITests with KOSMOS_SAMPLE_GROW): a message landing while the
            // person pulls past the newest grew the content under their finger without moving the offset, so the pull shrank
            // from past the threshold to 23 pt and never counted. The lazy list keeps its bottom where it is; here the pull is
            // kept the same distance past the new end.
            let pulled: CGFloat = {
                guard atEnd, let list, list.isTracking || list.isDragging else { return 0 }
                return max(0, list.contentOffset.y - maxY(list))
            }()
            applying = true
            source.apply(s, animatingDifferences: false)
            applying = false
            if pulled > 0, let list {
                list.layoutIfNeeded()
                let y = maxY(list) + pulled
                if abs(list.contentOffset.y - y) > 0.5 {
                    pinning = true
                    list.contentOffset = CGPoint(x: list.contentOffset.x, y: y)
                    pinning = false
                    ChatView.trace("uikit list: rows landed under a pull, kept \(Int(pulled)) pt past the end (\(geometry(list)))", ring: false)
                }
            }
            // Review 2: on any change in the rows above it, added or removed (Try again takes the failed line away), not
            // only on more of them.
            if let a = anchor, let list, let was = before.firstIndex(of: a.id), let at = now.firstIndex(of: a.id),
               Set(before[..<was]) != Set(now[..<at]) {
                let above = Set(now[..<at]).subtracting(before[..<was])
                if above == ["earlier-failed"], Set(before[..<was]).isSubset(of: Set(now[..<at])), atTop {
                    // Review 1: a failed page's line arriving above a reader at the top shows there (Try again), as on the
                    // lazy list, instead of being held off the screen above them.
                    place = nil
                    pinning = true
                    list.contentOffset = CGPoint(x: 0, y: -list.adjustedContentInset.top)
                    pinning = false
                } else {
                    list.layoutIfNeeded()
                    if let ip = source.indexPath(for: a.id), let attr = list.layoutAttributesForItem(at: ip) {
                        pinning = true
                        list.contentOffset = CGPoint(x: list.contentOffset.x, y: attr.frame.minY - a.dy)
                        pinning = false
                        place = a
                        ChatView.trace("uikit list: rows landed above, place kept (\(geometry(list)))", ring: false)
                    }
                }
                readTop(list)
                // Review 2: writing the offset can end a fling or its bounce without the end being reported, which would
                // leave the person's drag counted for the next scroll nobody made (as the fling stopped in updateUIView).
                if !(list.isTracking || list.isDragging || list.isDecelerating) { dragged = false }
            }
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
        co.toldTop = atTop
        co.environment = context.environment
        co.newest = newest
        let reg = UICollectionView.CellRegistration<UICollectionViewCell, String> { [weak co] c, _, id in co?.configure(c, id) }
        co.source = UICollectionViewDiffableDataSource<Int, String>(collectionView: list) { cv, ip, id in
            cv.dequeueConfiguredReusableCell(using: reg, for: ip, item: id)
        }
        list.delegate = co
        list.onLayout = { [weak co] in co?.laidOut() }
        list.personScrolls = { [weak co] in co?.personScrollStarted() }
        co.apply(ids)
        // A new list opens at the newest message: the chat is told so once, as it is told of every later change.
        let told = atEnd
        // Review 1: and that it is not at the top (a list made again for a new chat or computer must not inherit a top
        // the old one reported, or every read would ask for another page while the reader is at the newest).
        let toldTop = atTop, handed = scroller
        DispatchQueue.main.async { told(true); toldTop(false); handed(list) }
        #if DEBUG
        if let up = sampleUp, !Self.sampleUpDone {
            let rested = sampleRested
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak co] in co?.sampleScrollUp(up, rested: rested) }
        }
        if let after = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_A11YSCROLL"].flatMap(Double.init), !Self.sampleA11yDone {
            let report = sampleA11y
            DispatchQueue.main.asyncAfter(deadline: .now() + after) { [weak co] in co?.sampleA11yScroll(report) }
        }
        #endif
        return list
    }

    func updateUIView(_ list: List, context: Context) {
        let co = context.coordinator
        co.cell = cell
        co.told = atEnd
        co.toldTop = atTop
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
