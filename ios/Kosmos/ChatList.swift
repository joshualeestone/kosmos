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
    // kosmos#8221 slice 14: bumped by the chat when the loaded earlier pages are dropped and started again (a read that found
    // the conversation moved under them, a delete, Try again). A reader up in those pages has no row left on screen to keep.
    var dropped: Int = 0
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
    // the kind VoiceOver makes (told through personScrolls, then the scroll; see Coordinator.sampleA11yScroll for its four
    // modes), then what the list did, for a check. KOSMOS_SAMPLE_A11YFOCUS and KOSMOS_SAMPLE_A11YACTIONS report through it too.
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
    // KOSMOS_SAMPLE_A11YSCROLL, _A11YFOCUS and _A11YACTIONS share it: one of them runs once a launch, as sampleUpDone.
    static var sampleA11yDone = false
    // kosmos#8221 slice 13: KOSMOS_SAMPLE_NOCELLACTIONS=1 sets the sheet's opener carried into each cell to nil (configure):
    // the control arm of A11yActionsUITests. Read once a launch.
    static let sampleNoCellActions = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOCELLACTIONS"] == "1"
    // kosmos#8221 slice 14: KOSMOS_SAMPLE_NODROPFIX=1 leaves a reader whose rows were all dropped at the old offset, as before
    // the slice: the control arm of EarlierDroppedUITests.
    static let sampleNoDropFix = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NODROPFIX"] == "1"
    #else
    static let sampleNoCellActions = false
    static let sampleNoDropFix = false
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
        // the coordinator (Coordinator.personScrollStarted), so the scroll it starts decides where the reader is. VoiceOver's
        // one-finger swipe to the element above scrolls it into view by another path, followed by Coordinator.focusFollow.
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
        var dropped = 0
        // At the newest message: the list is kept at its end through every change until the person scrolls away.
        var atEnd = true { didSet {
            if atEnd { place = nil; heldByFocus = false }
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
        // ends, after assistive focus moves the list (focusFollow), and after a layout once this list has put itself in
        // place (never from the first offset a new list has, which is its top before it is pinned to the end).
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
            let open = ChatList.sampleNoCellActions ? nil : env.openMessageActions
            c.contentConfiguration = UIHostingConfiguration {
                // The long-press sheet's host is the chat's (messageActionsHost); a hosted cell does not inherit SwiftUI's
                // environment, so the two values the bubbles read are carried in.
                // One stack with no spacing: a cell can hold two views (a send that starts a day is its day line and its
                // bubble), which a hosting configuration would otherwise space 8 pt apart (measured 11-07: the list stepped
                // 8 pt as such a send became its two rows). The lazy list's stack has no spacing either.
                VStack(alignment: .leading, spacing: 0) { cell(id) }
                    .environment(\.openMessageActions, open)
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
        // "still" asks for a scroll and moves nothing, as an arrow key that only moves focus does; "jump" is the animated page
        // up with a jump to the newest (a send, New messages) 0.2 s into it.
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
            case "jump":
                let y = max(-list.adjustedContentInset.top, list.contentOffset.y - list.bounds.height * 0.8)
                list.setContentOffset(CGPoint(x: 0, y: y), animated: true)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in self?.toNewest() }
            default:
                let y = max(-list.adjustedContentInset.top, list.contentOffset.y - list.bounds.height * 0.8)
                list.setContentOffset(CGPoint(x: 0, y: y), animated: true)
            }
            ChatView.trace("uikit list: debug accessibility scroll up, from the end \(wasAtEnd)", ring: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + watch + 0.1) { [weak self] in
                guard let self, let list = self.list else { return }
                report?("pins \(self.debugPins), at end \(self.atEnd), moved \(Int(y0 - list.contentOffset.y)), window \(self.debugWindowOpened), dragged \(self.dragged), short \(Int(self.maxY(list) - list.contentOffset.y)), from the end \(wasAtEnd)")
            }
        }

        // kosmos#8221 slice 12: KOSMOS_SAMPLE_A11YFOCUS. Assistive focus moved to a message, as VoiceOver's one-finger swipe
        // does, by posting the notification VoiceOver posts (it does not run on a simulator). KOSMOS_SAMPLE_A11YFOCUS_MODE:
        // "visible" focuses a message fully on screen with the element SwiftUI made for it; "above" focuses the 25th row from
        // the end, above the screen, with an element of the list placed by that row's frame (a row with no cell has no SwiftUI
        // element); "after" is VoiceOver's scroll to that row first, then the focus; "first" is the focus, then VoiceOver's
        // scroll; "newest" focuses the newest message with an element taller than the screen (a long reply); "below" puts the
        // reader higher up first, the 25th row from the end below the screen, then focuses it; "clipped" focuses an element
        // cut off by 20 pt at the top while at the newest; "back" is "above", then the newest focused and scrolled to without
        // animation; "refocus" focuses the same row again after an update; "afterjump" focuses 0.3 s after a jump to the
        // newest. Reported through sampleA11y, starting "focus".
        func sampleA11yFocus(_ report: ((String) -> Void)?) {
            guard !ChatList.sampleA11yDone, let list, let source else { return }
            ChatList.sampleA11yDone = true
            let mode = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_A11YFOCUS_MODE"] ?? "above"
            let ids = source.snapshot().itemIdentifiers
            guard ids.count > 30, let newestId = ids.last(where: { !Self.afterNewest.contains($0) }) else { report?("focus too few rows"); return }
            let wasAtEnd = atEnd
            var y0 = list.contentOffset.y
            var target = ids[ids.count - 25]
            var element: Any?
            var kind = "list"
            // Whether the element was traced to its row, read as the focus is posted: a list element's frame is fixed, so once
            // the list moves it names another row.
            var found = false
            func listElement(tall: Bool = false) -> Any? {
                guard let ip = source.indexPath(for: target), let a = list.layoutAttributesForItem(at: ip), let w = list.window else { return nil }
                let e = UIAccessibilityElement(accessibilityContainer: list)
                var r = a.frame
                // A message taller than the screen: twice its height, centred on the row as a real one's element would be.
                if tall { r = CGRect(x: r.minX, y: r.midY - list.bounds.height, width: r.width, height: list.bounds.height * 2) }
                e.accessibilityFrame = list.convert(r, to: w.screen.coordinateSpace)
                return e
            }
            func firstElement(_ v: UIView) -> Any? {
                if v.isAccessibilityElement { return v }
                if let f = v.accessibilityElements?.first { return f }
                for s in v.subviews { if let e = firstElement(s) { return e } }
                return nil
            }
            func focus() {
                debugPins = 0
                debugPinsUntil = CACurrentMediaTime() + 3.0
                guard let element else { kind = "none"; return }
                found = focusedRow(element).flatMap { source.itemIdentifier(for: $0) } == target
                NotificationCenter.default.post(name: UIAccessibility.elementFocusedNotification, object: nil,
                                                userInfo: [UIAccessibility.focusedElementUserInfoKey: element])
            }
            // VoiceOver's own scroll to the row: animated, with no finger and no accessibilityScroll; the row in the middle.
            func voiceOverScroll() {
                guard let ip = source.indexPath(for: target), let a = list.layoutAttributesForItem(at: ip) else { return }
                list.setContentOffset(CGPoint(x: 0, y: min(max(a.frame.midY - list.bounds.height / 2, -list.adjustedContentInset.top), maxY(list))), animated: true)
            }
            switch mode {
            case "visible":
                let inset = list.adjustedContentInset
                let shown = (list.contentOffset.y + inset.top)...(list.contentOffset.y + list.bounds.height - inset.bottom)
                for ip in list.indexPathsForVisibleItems.sorted().reversed() {
                    guard let id = source.itemIdentifier(for: ip), let newestAt = source.indexPath(for: newestId), ip < newestAt,
                          let a = list.layoutAttributesForItem(at: ip), shown.contains(a.frame.minY), shown.contains(a.frame.maxY),
                          let c = list.cellForItem(at: ip), let e = firstElement(c.contentView) else { continue }
                    target = id; element = e; kind = String(describing: type(of: e as AnyObject)).replacingOccurrences(of: " ", with: "")
                    break
                }
                focus()
            case "after":
                voiceOverScroll()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { element = listElement(); focus() }
            case "first":
                element = listElement(); focus(); voiceOverScroll()
            case "newest":
                target = newestId
                element = listElement(tall: true); focus()
            case "below":
                // Higher up, as a reader who scrolled there: the target's top 100 pt under the bottom of what shows.
                if let ip = source.indexPath(for: target), let a = list.layoutAttributesForItem(at: ip) {
                    atEnd = false
                    pinning = true
                    list.contentOffset = CGPoint(x: 0, y: max(-list.adjustedContentInset.top, a.frame.minY + 100 - list.bounds.height + list.adjustedContentInset.bottom))
                    list.layoutIfNeeded()
                    pinning = false
                    place = top()
                }
                // Settled first, as a reader who scrolled there earlier: the chat reacts to the reader leaving the newest (its
                // room under the list) a moment later, and a focus before that would be measured against the old room.
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { y0 = list.contentOffset.y; element = listElement(); focus() }
            case "back":
                // Up to the 25th row from the end, then back down to the newest a moment later: the focus on the newest, then
                // VoiceOver's own scroll to it, made without animation (so no scroll end is reported), its bottom at the bottom.
                element = listElement(); focus()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                    target = newestId
                    element = listElement(); focus()
                    if let ip = source.indexPath(for: newestId), let a = list.layoutAttributesForItem(at: ip) {
                        list.setContentOffset(CGPoint(x: 0, y: min(a.frame.maxY - list.bounds.height + list.adjustedContentInset.bottom, self.maxY(list))), animated: false)
                    }
                }
            case "refocus":
                // The 25th row from the end focused (put on screen), then the reader back at the end with an update between,
                // then the same row focused again: VoiceOver putting its focus back after the cells were redrawn.
                element = listElement(); focus()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    self.atEnd = true
                    self.pin()
                    self.apply(self.ids)
                    list.layoutIfNeeded()
                    y0 = list.contentOffset.y
                    element = listElement(); focus()
                }
            case "afterjump":
                // A jump to the newest (a send, New messages), then 0.3 s later a focus above the screen: VoiceOver's own.
                self.toNewest()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { y0 = list.contentOffset.y; element = listElement(); focus() }
            case "clipped":
                // At the newest, an element whose top is 20 pt under the top bar (VoiceOver stepping up to a message only just
                // cut off): it comes down 20 pt plus the list's 12 pt top padding, 32 pt in all, inside the 40 pt slack at the end.
                let seenTop = list.contentOffset.y + list.adjustedContentInset.top - list.contentInset.top
                if let ip = list.indexPathForItem(at: CGPoint(x: list.bounds.midX, y: seenTop + 10)), let id = source.itemIdentifier(for: ip),
                   let w = list.window {
                    target = id
                    let e = UIAccessibilityElement(accessibilityContainer: list)
                    e.accessibilityFrame = list.convert(CGRect(x: 16, y: seenTop - 20, width: list.bounds.width - 32, height: 60), to: w.screen.coordinateSpace)
                    element = e
                }
                focus()
            default:
                element = listElement(); focus()
            }
            // A layout pass after the focus, as any change in the chat makes: a list that would put the reader back does it here.
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak list] in list?.setNeedsLayout(); list?.layoutIfNeeded() }
            ChatView.trace("uikit list: debug assistive focus, from the end \(wasAtEnd)", ring: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.2) { [weak self] in
                guard let self, let list = self.list, let source = self.source else { return }
                var onScreen = false
                var whereRow = ""
                if let ip = source.indexPath(for: target), let a = list.layoutAttributesForItem(at: ip) {
                    let inset = list.adjustedContentInset
                    onScreen = a.frame.minY >= list.contentOffset.y + inset.top - 0.5
                        && a.frame.maxY <= list.contentOffset.y + list.bounds.height - inset.bottom + 0.5
                    whereRow = ", row \(Int(a.frame.minY)) to \(Int(a.frame.maxY)), shows \(Int(list.contentOffset.y + inset.top)) to \(Int(list.contentOffset.y + list.bounds.height - inset.bottom)), height \(Int(list.bounds.height)), end \(Int(self.maxY(list)))"
                }
                // Whether atEnd agrees with where the list is, as scrolled() and hold() read it.
                let agrees = self.atEnd == self.endReached(list)
                report?("focus found \(found), at end \(self.atEnd), on screen \(onScreen), agrees \(agrees), pins \(self.debugPins), moved \(Int(y0 - list.contentOffset.y)), kind \(kind)\(whereRow), from the end \(wasAtEnd)")
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

        // kosmos#8221 slice 13: KOSMOS_SAMPLE_A11YACTIONS. VoiceOver's "Message actions" (the rotor action that opens the
        // long-press sheet) on a message drawn by this list. VoiceOver does not run on a simulator and a UI test cannot
        // perform a custom action, so the app finds the accessibility element a cell on screen hands out whose label
        // contains KOSMOS_SAMPLE_A11YACTIONS_TEXT, and runs its "Message actions" action as VoiceOver would. Reported through
        // sampleA11y, starting "actions": whether such an element was found, its action names, and whether one ran.
        func sampleA11yActions(_ report: ((String) -> Void)?) {
            guard !ChatList.sampleA11yDone, let list else { return }
            ChatList.sampleA11yDone = true
            let text = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_A11YACTIONS_TEXT"] ?? ": "   // unset: any message
            // Every element under a view: a view that is one, and what a container hands out, containers within it included.
            func elements(_ o: NSObject, _ out: inout [NSObject], depth: Int = 0) {
                guard depth < 40 else { return }
                if o.isAccessibilityElement { out.append(o) }
                for e in o.accessibilityElements ?? [] { if let e = e as? NSObject { elements(e, &out, depth: depth + 1) } }
                if let v = o as? UIView { for s in v.subviews { elements(s, &out, depth: depth + 1) } }
            }
            var all: [NSObject] = []
            // Top to bottom, so the pick does not turn on the order visibleCells comes in.
            for c in list.visibleCells.sorted(by: { $0.frame.minY < $1.frame.minY }) { elements(c.contentView, &all) }
            let picked = all.first { ($0.accessibilityLabel ?? "").contains(text) && !($0.accessibilityCustomActions ?? []).isEmpty }
            let actions = picked?.accessibilityCustomActions ?? []
            let names = actions.map { $0.name.replacingOccurrences(of: " ", with: "_") }
            var ran = false
            if let a = actions.first(where: { $0.name == "Message actions" }) {
                if let h = a.actionHandler { ran = h(a) } else if let t = a.target as? NSObject { t.perform(a.selector, with: a); ran = true }
            }
            report?("actions elements \(all.count), found \(picked != nil), names \(names.isEmpty ? "none" : names.joined(separator: "|")), ran \(ran)")
        }
        #endif

        func maxY(_ sv: UIScrollView) -> CGFloat {
            max(-sv.adjustedContentInset.top, sv.contentSize.height - sv.bounds.height + sv.adjustedContentInset.bottom)
        }

        // Whether the reader is at the newest is read during the person's own scroll, when any scroll ends (scrolled()), when
        // a hold reaches the end (hold()), and on assistive focus (focusFollow, and rereadEnd after a focus back on the newest).
        // For a reader higher up, any move that is not this list's own (pin, hold, a layout pass, an update) drops the place,
        // so a scroll with no finger on the list is followed (NewMessagesUITests' SCROLLBY check).
        // kosmos#8221 slice 4 (CI run 42535962501): the scroll nobody made at a chat's open on a slow device is a deceleration
        // with no drag before it, so a deceleration counts as the person's only after a drag of theirs.
        func scrollViewDidScroll(_ sv: UIScrollView) {
            let own = pinning || applying || (list?.laying ?? false)   // the list's own writes are never the person's
            // kosmos#8221 slice 11: the first move of a scroll the person asked for without a finger opens its window, and
            // each later move keeps it open a little longer, so it closes only once the moves stop, however long they take.
            let fingerless = !(sv.isTracking || sv.isDragging || sv.isDecelerating)
            if !own, fingerless, !fingerlessScrolling(), CACurrentMediaTime() - personAskedAt < ChatList.personScrollAsk { personScrollOpened() }
            if !own, fingerlessScrolling() {
                personUntil = max(personUntil, CACurrentMediaTime() + ChatList.personScrollQuiet)
                movedAt = CACurrentMediaTime()   // so a lapse during a stalled frame does not hold the place and stop the scroll
            }
            if sv.isTracking || sv.isDragging || (sv.isDecelerating && dragged) || (fingerlessScrolling() && !own) {
                heldByFocus = false
                rereadGen += 1
                atEnd = endReached(sv)
                readTop(sv)
                place = nil
            } else if !own {
                place = nil
                movedAt = CACurrentMediaTime()
            }
        }
        // Whether the person has scrolled the list (a finger, or a scroll List.personScrolls asked for, once it moves) since a
        // scroll last ended or a lapsed window was let go (slice 11).
        var dragged = false
        // kosmos#8221 slice 11: a scroll the person makes without a finger (List.personScrolls: VoiceOver, Voice Control, a
        // keyboard's scroll keys) is an animation, so the list is not tracking, dragging or decelerating while it runs, and
        // laidOut used to pin a reader at the newest back to the end on every frame of it (measured: 18 times in one page
        // scroll, which then ended where it began). While it runs, laidOut leaves the list alone and the scroll's own moves
        // decide where the reader is, as a finger's do.
        // It runs from its first move (within personScrollAsk of being asked for: a press that scrolls nothing, such as an
        // arrow key moving focus, opens nothing, and its ask is let go when that time is up) until its end is reported
        // (scrolled) or it has not moved for personScrollQuiet. On that lapse the reader is where its last move put them (at
        // the newest or not, read by scrollViewDidScroll), and the list is put back to that as after any layout.
        var personAskedAt: CFTimeInterval = 0   // 0: no ask (the device's uptime is always far above personScrollAsk)
        var personUntil: CFTimeInterval = 0
        var windowCount = 0   // which window a lapse check belongs to: one from a window since closed does nothing
        func fingerlessScrolling() -> Bool { CACurrentMediaTime() < personUntil }
        func personScrollStarted() {
            #if DEBUG
            // KOSMOS_SAMPLE_NOPERSONSCROLL=1: the list as before this slice, the control arm of A11yScrollUITests: the ask counted
            // as a drag at once, and nothing else.
            if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOPERSONSCROLL"] == "1" { dragged = true; return }
            #endif
            // Recorded even while a window is open (a second key, a second swipe): if that window lapses before the second
            // scroll's first move, the ask is still there to open the next one.
            let asked = CACurrentMediaTime()
            personAskedAt = asked
            // An ask whose scroll never moves (an arrow key that only moves focus) is let go once its time is up. It counts as
            // the person's drag only once its scroll moves (personScrollOpened), so until then a scroll nobody asked for is
            // still not taken for the person's (slice 4).
            DispatchQueue.main.asyncAfter(deadline: .now() + ChatList.personScrollAsk + 0.05) { [weak self] in
                guard let self, self.personAskedAt == asked else { return }
                self.personAskedAt = 0
            }
        }
        func personScrollOpened() {
            personAskedAt = 0   // one ask opens one window
            personUntil = CACurrentMediaTime() + ChatList.personScrollQuiet
            dragged = true      // its end, when reported, is the person's
            windowCount += 1
            #if DEBUG
            debugWindowOpened = true
            #endif
            let window = windowCount
            DispatchQueue.main.asyncAfter(deadline: .now() + ChatList.personScrollQuiet + 0.05) { [weak self] in self?.personScrollLapsed(window) }
        }
        func personScrollLapsed(_ window: Int) {
            guard window == windowCount, personUntil > 0 else { return }   // a later window's, or closed already by a reported end
            if fingerlessScrolling() {   // still moving: look again when it would close
                let wait = personUntil - CACurrentMediaTime() + 0.05
                DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in self?.personScrollLapsed(window) }
                return
            }
            personUntil = 0   // an ask made during the window is left to open the next one (its own timer lets it go)
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
        // kosmos#8221 slice 11: the status-bar tap is a scroll with no finger too, so it is the person's from its first move.
        func scrollViewShouldScrollToTop(_ sv: UIScrollView) -> Bool { personScrollStarted(); return true }
        func scrolled(_ sv: UIScrollView, how: String) {
            movedAt = 0   // a scroll that has ended is at rest: the next layout holds the place taken here
            // kosmos#8221 slice 11: its end is reported, so the person's scroll is over; but an earlier fling's or a drag's end
            // landing while a scroll without a finger is asked for or runs (the scroll it starts stops a fling) is not that
            // scroll's end: its ask and its window (with the drag the window counted) are kept for it.
            let fingerlessAhead = fingerlessScrolling() || CACurrentMediaTime() - personAskedAt < ChatList.personScrollAsk
            let keep = fingerlessAhead && (how == "deceleration" || how == "drag")
            if !keep { personUntil = 0; personAskedAt = 0 }
            let byPerson = dragged, wasAtEnd = atEnd
            dragged = keep && fingerlessScrolling()   // a window still open keeps its drag; a pending ask has none yet
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
            if byPerson { heldByFocus = false }
            atEnd = endReached(sv)
            readTop(sv)
            ChatView.trace("uikit list: scroll ended, at end \(atEnd) (was \(wasAtEnd)), by the person \(byPerson), after a \(how) (\(geometry(sv)))", ring: false)
            if !atEnd { place = focusPlace() ?? top() }
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
            if endReached(list) { atEnd = true }
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
            guard list.contentSize.height > 0, !(list.isTracking || list.isDragging || list.isDecelerating), !fingerlessScrolling() else { return }
            if atEnd { pin() } else if !moving() { if place == nil { place = focusPlace() ?? top() } else { hold() } }
            if !moving() { readTop(list) }
        }

        // To the newest message (a send, New messages), followed even from higher up.
        func toNewest() {
            guard let list else { return }
            toNewestAt = CACurrentMediaTime()
            atEnd = true
            ChatView.trace("uikit list: to the newest")
            // A fling still running would carry on past the move; stopping it in place first. A finger on the list is never
            // moved; where it lets go decides again, as any scroll of theirs does.
            if list.isDecelerating { list.setContentOffset(list.contentOffset, animated: false) }
            // kosmos#8221 slice 11: a scroll the person made without a finger loses its window, so its later moves are not read
            // as theirs: the list pins the reader at the newest through the rest of it, and its end keeps them there. Not
            // stopped in place: writing the offset did not reliably stop such a scroll (measured 11-09, the reader left 135 pt
            // above the newest).
            personUntil = 0; personAskedAt = 0
            // A fling stopped that way never reports its end, so its drag would count for the next scroll nobody made.
            if !(list.isTracking || list.isDragging) { dragged = false }
            list.setNeedsLayout()
            if !(list.isTracking || list.isDragging) { pin() }
        }

        // kosmos#8221 slice 12: VoiceOver's one-finger swipe to the element above moves its focus to a message and scrolls it
        // into view by its own path, which never calls accessibilityScroll, so a reader at the newest was put back at the end
        // on the next layout and the message they moved to went off screen again. When assistive technology focuses
        // something in a row before the newest message and that thing is not fully on screen, it is put on screen and the
        // reader is at the newest or not by where the list then is.
        var focusObserver: NSObjectProtocol?
        // Set when assistive focus moved the list to a message: until the person scrolls or the reader is at the newest again,
        // only the very end counts as the newest, so a message a few points above the end is not pinned back under the top.
        var heldByFocus = false
        var toNewestAt: CFTimeInterval = 0
        func endReached(_ sv: UIScrollView) -> Bool { sv.contentOffset.y >= maxY(sv) - (heldByFocus ? 0.5 : ChatList.endSlack) }
        deinit { if let focusObserver { NotificationCenter.default.removeObserver(focusObserver) } }
        // The rows ChatView puts after the newest message (its working line and the spacer under it).
        static let afterNewest: Set<String> = ["working", "end"]
        func focusFollow(_ element: Any) {
            #if DEBUG
            // KOSMOS_SAMPLE_NOFOCUSFOLLOW=1: the list as before this slice, the control arm of A11yFocusUITests.
            if ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_NOFOCUSFOLLOW"] == "1" { return }
            #endif
            guard let list, (element as AnyObject) !== list, let source, let ip = focusedRow(element) else { return }
            // The newest message and the rows after it are left alone however tall it is: a reader there is at the newest.
            guard let newestId = ids.last(where: { !Self.afterNewest.contains($0) }), let newestAt = source.indexPath(for: newestId),
                  let id = source.itemIdentifier(for: ip), !(list.isTracking || list.isDragging || list.isDecelerating),
                  !fingerlessScrolling() else { return }
            // VoiceOver puts its focus back on the same element after an update redraws the cells (apply reconfigures
            // them); that is not the person moving, so the same element (its row and where it starts within the row) focused
            // again with an update between is left alone. Another part of the same message is followed.
            let rowTop = list.layoutAttributesForItem(at: ip)?.frame.minY
            var part: Int?
            if let e = elementFrame(element)?.minY, let r = rowTop { part = Int((e - r).rounded()) }
            let refocus = id == lastFocusRow && part == lastFocusPart && appliedSinceFocus
            lastFocusRow = id
            lastFocusPart = part
            appliedSinceFocus = false
            if refocus { return }
            if ip >= newestAt {
                // Back on the newest message: at the newest once it is fully shown (the working line and the room under it can
                // keep the list more than its usual slack short of the end), read now and once VoiceOver's own scroll to it
                // has run (a scroll it makes without animation reports no end).
                guard heldByFocus || !atEnd else { return }
                heldByFocus = false
                atEnd = newestShown() || endReached(list)
                rereadGen += 1
                rereadEnd(tries: 4, gen: rereadGen)
                return
            }
            // VoiceOver puts its focus on something on screen after a jump to the newest (a send, New messages, search
            // closing) and when a chat opens; that is not the person moving, so a focus within a second of either is left
            // alone.
            guard CACurrentMediaTime() - toNewestAt > 1.0 else { return }
            // The focused element's own frame, so a part of a tall message is what is put on screen, read before the layout
            // below (which can move the list) so it is in the list's coordinates of the same moment; the row's without one.
            let own = elementFrame(element)
            list.layoutIfNeeded()
            guard let f = own ?? list.layoutAttributesForItem(at: ip)?.frame else { return }
            let inset = list.adjustedContentInset, pad = list.contentInset
            // Off screen means under the bars or the box (the safe area), not in the list's own padding, which shows.
            let seenTop = list.contentOffset.y + inset.top - pad.top, seenBottom = list.contentOffset.y + list.bounds.height - inset.bottom + pad.bottom
            guard f.minY < seenTop - 0.5 || f.maxY > seenBottom + 0.5 else { return }
            // Put on screen with the padding kept, as the list rests.
            let shownTop = list.contentOffset.y + inset.top, shownBottom = list.contentOffset.y + list.bounds.height - inset.bottom
            let y = f.minY < shownTop || f.height > shownBottom - shownTop
                ? f.minY - inset.top : f.maxY - list.bounds.height + inset.bottom
            pinning = true
            list.contentOffset = CGPoint(x: 0, y: min(max(y, -inset.top), maxY(list)))
            // The cells now on screen, for top(); laidOut does nothing while pinning.
            list.layoutIfNeeded()
            // Rows drawn for the first time in that pass come in at their real heights, which can move the row itself. When
            // the element stands for the whole row (none of its own, or the list's own element for a row with no cell), the
            // row is measured again and put right once.
            let wholeRow = own == nil || ((element as? UIAccessibilityElement)?.accessibilityContainer as AnyObject?) === list
            if wholeRow, let b = list.layoutAttributesForItem(at: ip)?.frame {
                let s0 = list.contentOffset.y + inset.top, s1 = list.contentOffset.y + list.bounds.height - inset.bottom
                if b.minY < s0 - 0.5 || b.maxY > s1 + 0.5 {
                    let y2 = b.minY < s0 || b.height > s1 - s0 ? b.minY - inset.top : b.maxY - list.bounds.height + inset.bottom
                    list.contentOffset = CGPoint(x: 0, y: min(max(y2, -inset.top), maxY(list)))
                    list.layoutIfNeeded()
                }
            }
            pinning = false
            heldByFocus = true
            atEnd = endReached(list)
            // Held by the focused row itself, not the highest row on screen: rows not drawn before come in at their real
            // heights after this move, and a hold by a row above would let the focused one slide out at the bottom.
            if !atEnd { place = list.layoutAttributesForItem(at: ip).map { (id, $0.frame.minY - list.contentOffset.y) } ?? top() }
            readTop(list)
            ChatView.trace("uikit list: assistive focus put on screen, at end \(atEnd) (\(geometry(list)))", ring: false)
        }
        // The newest message wholly above the bottom bars (the box), so the reader can see all of it.
        func newestShown() -> Bool {
            guard let list, let source, let newestId = ids.last(where: { !Self.afterNewest.contains($0) }),
                  let ip = source.indexPath(for: newestId), let a = list.layoutAttributesForItem(at: ip) else { return false }
            let seenBottom = list.contentOffset.y + list.bounds.height - list.adjustedContentInset.bottom + list.contentInset.bottom
            return a.frame.maxY <= seenBottom + 0.5 && a.frame.minY < seenBottom
        }
        var lastFocusRow: String?
        var lastFocusPart: Int?
        var appliedSinceFocus = false
        // Back on the newest after a focus: atEnd read again 0.6 s on, once VoiceOver's own scroll to it has run, and again
        // while the list is still moving, a few times at most. A scroll made with animation is also read at its end
        // (scrolled()). A later focus back on the newest, or a scroll of the person's, starts a new count (rereadGen), and
        // the older reads do nothing.
        var rereadGen = 0
        func rereadEnd(tries: Int, gen: Int) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
                guard let self, gen == self.rereadGen, let list = self.list, !self.atEnd, !self.heldByFocus,
                      !(list.isTracking || list.isDragging || list.isDecelerating) else { return }
                if self.moving() { if tries > 1 { self.rereadEnd(tries: tries - 1, gen: gen) }; return }
                self.atEnd = self.newestShown() || self.endReached(list)
            }
        }
        // While a focus holds the reader (heldByFocus), the place is the focused row's, when it is on screen: a scroll that
        // ends then (VoiceOver's own, to that row) keeps holding by it rather than by the highest row on screen.
        func focusPlace() -> (id: String, dy: CGFloat)? {
            guard heldByFocus, let list, let source, let id = lastFocusRow, let ip = source.indexPath(for: id),
                  let a = list.layoutAttributesForItem(at: ip), a.frame.maxY > list.contentOffset.y,
                  a.frame.minY < list.contentOffset.y + list.bounds.height else { return nil }
            return (id, a.frame.minY - list.contentOffset.y)
        }
        func elementFrame(_ element: Any) -> CGRect? {
            guard let list, let screen = list.window?.screen, let f = (element as? NSObject)?.accessibilityFrame,
                  !f.isNull, !f.isEmpty else { return nil }
            return list.convert(f, from: screen.coordinateSpace)
        }
        // The row of this list an accessibility element belongs to: its container chain to the first view, then that view's
        // superviews to a cell of this list. A chain that reaches the list with no cell (the list's own element for a row
        // with no cell) is placed by the element's frame; one that leaves the list (the composer) is not ours.
        func focusedRow(_ element: Any) -> IndexPath? {
            guard let list else { return nil }
            var o: NSObject? = element as? NSObject
            for _ in 0..<40 {
                guard let cur = o else { return nil }
                if let v = cur as? UIView {
                    var w: UIView? = v
                    while let x = w {
                        if let c = x as? UICollectionViewCell, c.superview === list { return list.indexPath(for: c) }
                        // Only an element whose container is the list itself is placed by its frame; one in another view
                        // of the list (not a cell) is not a message.
                        if x === list { return v === list ? rowAt(frame: (element as? NSObject)?.accessibilityFrame) : nil }
                        w = x.superview
                    }
                    return nil
                }
                // Public only on UIAccessibilityElement; SwiftUI's elements answer it too, so it is asked for by name.
                let up = NSSelectorFromString("accessibilityContainer")
                o = cur.responds(to: up) ? cur.perform(up)?.takeUnretainedValue() as? NSObject : nil
            }
            return nil
        }
        func rowAt(frame f: CGRect?) -> IndexPath? {
            guard let list, let f, !f.isNull, !f.isEmpty, let screen = list.window?.screen else { return nil }
            let p = list.convert(CGPoint(x: f.midX, y: f.midY), from: screen.coordinateSpace)
            return list.indexPathForItem(at: CGPoint(x: list.bounds.midX, y: p.y))
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

        func apply(_ now: [String], dropped: Int? = nil) {
            guard let source else { return }
            // kosmos#8221 slice 14: the chat dropped its earlier pages since the last update.
            let pagesDropped = dropped.map { $0 != self.dropped } ?? false
            if let d = dropped { self.dropped = d }
            appliedSinceFocus = true
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
                    // kosmos#8221 slice 11: a scroll with no finger loses its window when rows land above, so its later moves
                    // are not read as the person's. It may still carry on to its old target offset (not stopped: writing the
                    // offset did not reliably stop such a scroll, measured in toNewest); a follow-up on #8221.
                    personUntil = 0; personAskedAt = 0
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
            } else if pagesDropped, !atEnd, !shown.isEmpty, !shown.contains(where: kept.contains), !ChatList.sampleNoDropFix, let list {
                // kosmos#8221 slice 14 (found in slice 7's review, round 3): the earlier pages were dropped with every row on
                // screen in them, so no row is left to hold and the old offset would land the reader in an unrelated part of
                // the chat. They go to the top of what remains, the oldest row still loaded, the nearest to where they were
                // reading; at the top, the page before is asked for again (atTop) and lands above them, held as any page is.
                // A fling still running would carry the reader on from the top; it is stopped in place first, as toNewest
                // does. A focused message was in a dropped row, so focus no longer holds the place.
                if list.isDecelerating { list.setContentOffset(list.contentOffset, animated: false) }
                personUntil = 0; personAskedAt = 0
                heldByFocus = false
                list.layoutIfNeeded()
                place = nil
                pinning = true
                list.contentOffset = CGPoint(x: list.contentOffset.x, y: -list.adjustedContentInset.top)
                pinning = false
                readTop(list)
                if !(list.isTracking || list.isDragging || list.isDecelerating) { dragged = false }
                ChatView.trace("uikit list: earlier pages dropped under the reader, put at the top of what remains (\(geometry(list)))", ring: false)
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
        // The list's own room above its first row, as the lazy list's padding (ChatView.listPadV). None below its last
        // (kosmos#8283): with it the newest message rested 12 pt higher over the box than on the lazy list, although the lazy
        // list pads its end by listPadV too. That the two now match is measured, not derived (11-09, simulator, keyboard up: 62
        // pt from its words to the box on both); ChatGapUITests bounds the gap on each list, it does not compare them.
        list.contentInset = UIEdgeInsets(top: ChatView.listPadV, left: 0, bottom: 0, right: 0)
        let co = context.coordinator
        co.list = list
        co.cell = cell
        co.told = atEnd
        co.toldTop = atTop
        co.environment = context.environment
        co.newest = newest
        co.dropped = dropped
        let reg = UICollectionView.CellRegistration<UICollectionViewCell, String> { [weak co] c, _, id in co?.configure(c, id) }
        co.source = UICollectionViewDiffableDataSource<Int, String>(collectionView: list) { cv, ip, id in
            cv.dequeueConfiguredReusableCell(using: reg, for: ip, item: id)
        }
        list.delegate = co
        list.onLayout = { [weak co] in co?.laidOut() }
        list.personScrolls = { [weak co] in co?.personScrollStarted() }
        if let old = co.focusObserver { NotificationCenter.default.removeObserver(old) }
        co.focusObserver = NotificationCenter.default.addObserver(forName: UIAccessibility.elementFocusedNotification, object: nil, queue: .main) { [weak co] n in
            if let el = n.userInfo?[UIAccessibility.focusedElementUserInfoKey] { co?.focusFollow(el) }
        }
        co.apply(ids)
        // A new list opens at the newest message: the chat is told so once, as it is told of every later change.
        let told = atEnd
        // Review 1: and that it is not at the top (a list made again for a new chat or computer must not inherit a top
        // the old one reported, or every read would ask for another page while the reader is at the newest).
        let toldTop = atTop, handed = scroller
        DispatchQueue.main.async { told(true); toldTop(false); handed(list) }
        // kosmos#8221 slice 12: VoiceOver's own focus as the chat appears is not the person moving (focusFollow).
        co.toNewestAt = CACurrentMediaTime()
        #if DEBUG
        if let up = sampleUp, !Self.sampleUpDone {
            let rested = sampleRested
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak co] in co?.sampleScrollUp(up, rested: rested) }
        }
        if let after = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_A11YSCROLL"].flatMap(Double.init), !Self.sampleA11yDone {
            let report = sampleA11y
            DispatchQueue.main.asyncAfter(deadline: .now() + after) { [weak co] in co?.sampleA11yScroll(report) }
        }
        if let after = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_A11YFOCUS"].flatMap(Double.init), !Self.sampleA11yDone {
            let report = sampleA11y
            DispatchQueue.main.asyncAfter(deadline: .now() + after) { [weak co] in co?.sampleA11yFocus(report) }
        }
        if let after = ProcessInfo.processInfo.environment["KOSMOS_SAMPLE_A11YACTIONS"].flatMap(Double.init), !Self.sampleA11yDone {
            let report = sampleA11y
            DispatchQueue.main.asyncAfter(deadline: .now() + after) { [weak co] in co?.sampleA11yActions(report) }
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
        co.apply(ids, dropped: dropped)
        if newest != co.newest {
            co.newest = newest
            co.toNewest()
        }
    }
}
