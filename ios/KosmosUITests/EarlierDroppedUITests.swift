import XCTest

// kosmos#8221 slice 14 (found in slice 7's review, round 3): when a read finds the conversation moved under the loaded earlier
// pages, the pages are dropped and started again. A reader who was up in them had no row left on screen to keep, so the list
// kept its old offset and they landed elsewhere in the chat. Here that is below Message 41, off screen (the
// reader is one drag into the first page); a reader deeper in several pages lands further away.
// The moved page path (slice 14) and a delete of the person's own message (slice 16) are measured; the moved gap fill and Try
// again reach the same list code through restartEarlier and are covered by reasoning. On the UIKit list the reader now goes to
// the top of what remains, "Message 41 of 260", the oldest row still loaded.
// The sample board's long chat (KOSMOS_SAMPLE_LONG, see EarlierPagesUITests) with pages of 30 (KOSMOS_SAMPLE_OLDER_PAGE), so
// a second page is asked for, and the pages dropped while it is on its way: by that ask answered "moved"
// (KOSMOS_SAMPLE_OLDER_MOVED=2), or by a delete 2 s before it is due (Drop). Each page is held back 16 s
// (KOSMOS_SAMPLE_OLDER_DELAY), long enough to step one drag down into the first page (off its top, and with Message 41 below
// the screen) before the drop.
// The control (KOSMOS_SAMPLE_NODROPFIX=1) leaves the reader at the old offset, as before the slice: Message 41 is not on screen
// after the drop, so the check can see the defect. UIKit list only: the lazy list's earlier pages are kosmos#7016's, unchanged.
final class EarlierDroppedUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    // kosmos#8221 (CI flake, 11-12): 16 s, was 8. The ask is stamped when the test SEES "Loading", and on CI's hosted Mac a
    // drag with its wait for idle takes 3 to 4.5 s, so the stamp can trail the real ask by a drag or two. With 8 s the drop
    // (6 s after the real ask) came before the drag back into the first page finished, and the page asked for again after it
    // had landed before the test looked (main run 42940677400: both, in its first try and its retry). Every wait here is
    // measured from this delay, so they scale with it.
    private static let delay: Double = 16

    // kosmos#8221 slice 16: what drops the pages. A moved answer to the second page (slice 14), or the person's newest message
    // deleted 2 s before that page is due (KOSMOS_SAMPLE_DELETE_ON_ASK, through the sheet's own delete), which takes the
    // pages away the same way.
    private enum Drop { case moved, delete }

    private static func launch(control: Bool, drop: Drop = .moved) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        app.launchEnvironment["KOSMOS_SAMPLE_LONG"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OLDER_DELAY"] = String(Int(delay))
        app.launchEnvironment["KOSMOS_SAMPLE_OLDER_PAGE"] = "30"
        switch drop {
        case .moved: app.launchEnvironment["KOSMOS_SAMPLE_OLDER_MOVED"] = "2"
        case .delete: app.launchEnvironment["KOSMOS_SAMPLE_DELETE_ON_ASK"] = "2"
        }
        app.launchEnvironment["KOSMOS_SAMPLE_TRACE"] = "1"
        if control { app.launchEnvironment["KOSMOS_SAMPLE_NODROPFIX"] = "1" }
        UIKitListArm.set(app)
        app.launch()
        return app
    }

    private static func label(_ app: XCUIApplication, _ prefix: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    // A third of the screen up the thread (older), or down it (newer), held at the end so nothing flings on.
    private static func drag(_ app: XCUIApplication, older: Bool) {
        let a = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        let b = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        (older ? a : b).press(forDuration: 0.05, thenDragTo: older ? b : a, withVelocity: .slow, thenHoldForDuration: 0.4)
    }

    private static func onScreen(_ app: XCUIApplication, _ e: XCUIElement) -> Bool {
        e.exists && e.frame.maxY > app.frame.minY && e.frame.minY < app.frame.maxY
    }

    // Up to the first page's top, where the second page is asked for, then one drag down into it. Returns when the second ask
    // went out. Shared by both arms, so the control is the same path with the fix off.
    private func readerUpInTheFirstPage(_ app: XCUIApplication) -> Date {
        XCTAssertTrue(Self.label(app, "Message 260 of 260").waitForExistence(timeout: 20), "the long chat did not open at its newest message")
        UIKitListArm.assertDrawn(app)
        let first = Self.label(app, "Message 41 of 260")
        let loading = Self.label(app, "Loading earlier messages")
        let near = Self.label(app, "Message 6")
        var swipes = 0
        while !near.exists && swipes < 60 { app.swipeDown(); swipes += 1 }
        XCTAssertTrue(near.exists, "never came near the top (\(swipes) swipes)")
        var drags = 0
        while !loading.exists && drags < 25 { Self.drag(app, older: true); drags += 1 }
        XCTAssertTrue(loading.exists, "CONTROL: reaching the top did not ask for the first page (\(drags) drags)")
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: loading)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: Self.delay + 15), .completed, "CONTROL: the first page never landed")
        // On up through the first page to its top: the second page is asked for.
        drags = 0
        while !loading.exists && drags < 30 { Self.drag(app, older: true); drags += 1 }
        XCTAssertTrue(loading.exists, "CONTROL: the first page's top did not ask for the second (\(drags) drags)")
        let asked = Date()
        // One drag back down into the first page: off its top, and every row on screen is in it.
        Self.drag(app, older: false)
        // Rows of the first page are on screen now, so their absence after the drop (waitPastTheDrop) can be seen to change.
        XCTAssertTrue(Self.label(app, "Checking the venue list, item").exists, "CONTROL: no row of the first page is drawn before the drop")
        XCTAssertFalse(Self.onScreen(app, first), "CONTROL: Message 41 is on screen, so the reader still has a row that stays")
        XCTAssertFalse(Self.onScreen(app, Self.label(app, "Message 260 of 260")), "CONTROL: the reader is at the newest message")
        XCTAssertTrue(loading.exists, "CONTROL: the drop came before the reader was in place (raise the delay)")
        return asked
    }

    // The moved answer comes `delay` after the ask (a delete, 2 s before that); this waits until `delay` + 2 s, before the page
    // asked for again (another delay on from the drop) can land.
    private static func waitPastTheDrop(_ app: XCUIApplication, _ asked: Date) {
        let left = delay + 2 - Date().timeIntervalSince(asked)
        if left > 0 { Thread.sleep(forTimeInterval: left) }
        // The drop happened: no row of the first page is left (the page asked for again has not landed yet).
        XCTAssertFalse(label(app, "Checking the venue list, item").exists, "CONTROL: a row of the first page is still drawn, so the pages were not dropped")
    }

    func testAReaderUpInDroppedPagesGoesToTheTopOfWhatRemains() throws {
        if !UIKitListArm.on { throw XCTSkip("the UIKit list's handling of dropped earlier pages (kosmos#8221 slice 14)") }
        try readerGoesToTheTop(.moved)
    }

    // kosmos#8221 slice 16: the same reader, the pages dropped by a delete instead (slice 14 measured only the moved answer).
    func testADeleteUnderAReaderUpInEarlierPagesPutsThemAtTheTopOfWhatRemains() throws {
        if !UIKitListArm.on { throw XCTSkip("the UIKit list's handling of dropped earlier pages (kosmos#8221 slice 16)") }
        try readerGoesToTheTop(.delete)
    }

    func testControlADeleteWithoutTheFixLeavesTheReaderElsewhere() throws {
        if !UIKitListArm.on { throw XCTSkip("the UIKit list's handling of dropped earlier pages (kosmos#8221 slice 16)") }
        try readerLandsElsewhere(.delete)
    }

    // The newest message once the pages drop: the delete takes Message 260 (the person's), so 259 stands for "taken to the
    // newest", or the check would pass whatever the list did.
    private static func newest(_ drop: Drop) -> String { drop == .delete ? "Message 259 of 260" : "Message 260 of 260" }

    private func readerGoesToTheTop(_ drop: Drop) throws {
        let app = Self.launch(control: false, drop: drop)
        let asked = readerUpInTheFirstPage(app)
        Self.waitPastTheDrop(app, asked)
        let first = Self.label(app, "Message 41 of 260")
        XCTAssertTrue(Self.onScreen(app, first), "the reader was not put at the top of what remains: Message 41 is not on screen")
        XCTAssertLessThan(first.frame.minY, app.frame.midY, "Message 41 is on screen but not at the top (y \(Int(first.frame.minY)))")
        XCTAssertFalse(Self.label(app, Self.newest(drop)).exists, "the drop took the reader to the newest message")
        // At the top, the page before is asked for again; it lands above and the reader's row stays where it is.
        let loading = Self.label(app, "Loading earlier messages")
        // kosmos#8221 slice 17: after a drop the page is asked for once a read of the thread as it is now has landed (the
        // delete starts one at once; after a moved answer it is the next 5 s read), so this waits up to one read and its
        // round trip. The reader's place is taken once it is asked for, so nothing in that wait counts as the page moving them.
        XCTAssertTrue(loading.waitForExistence(timeout: 10), "at the top of what remains, the page before was not asked for again")
        let y0 = first.frame.minY
        let landed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: loading)
        XCTAssertEqual(XCTWaiter().wait(for: [landed], timeout: Self.delay + 15), .completed, "the page asked for again never landed")
        Thread.sleep(forTimeInterval: 1)
        XCTAssertTrue(first.exists, "the page asked for again moved the reader off Message 41")
        XCTAssertEqual(first.frame.minY, y0, accuracy: 8, "the page asked for again moved the reader \(Int(first.frame.minY - y0)) pt")
    }

    func testControlWithoutTheFixTheReaderLandsElsewhere() throws {
        if !UIKitListArm.on { throw XCTSkip("the UIKit list's handling of dropped earlier pages (kosmos#8221 slice 14)") }
        try readerLandsElsewhere(.moved)
    }

    private func readerLandsElsewhere(_ drop: Drop) throws {
        let app = Self.launch(control: true, drop: drop)
        let asked = readerUpInTheFirstPage(app)
        Self.waitPastTheDrop(app, asked)
        // And nothing was asked for again: with the fix off the reader is not at the top.
        XCTAssertFalse(Self.label(app, "Loading earlier messages").exists, "CONTROL: the reader was put at the top anyway (a page was asked for again)")
        XCTAssertFalse(Self.onScreen(app, Self.label(app, "Message 41 of 260")),
                       "CONTROL: with the fix off the reader is still at Message 41, so this check cannot see the defect")
        XCTAssertFalse(Self.label(app, Self.newest(drop)).exists, "CONTROL: the drop took the reader to the newest message")
    }
}
