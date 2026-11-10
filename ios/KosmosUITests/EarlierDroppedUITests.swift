import XCTest

// kosmos#8221 slice 14 (found in slice 7's review, round 3): when a read finds the conversation moved under the loaded earlier
// pages, the pages are dropped and started again. A reader who was up in them had no row left on screen to keep, so the list
// kept its old offset and they landed elsewhere in the chat. Here that is below Message 41, off screen (the
// reader is one drag into the first page); a reader deeper in several pages lands further away.
// Only the moved page path is measured; the moved gap fill, a delete and Try again reach the same list code through
// restartEarlier and are covered by reasoning. On the UIKit list they now go to the top of what
// remains, "Message 41 of 260", the oldest row still loaded.
// The sample board's long chat (KOSMOS_SAMPLE_LONG, see EarlierPagesUITests) with pages of 30 (KOSMOS_SAMPLE_OLDER_PAGE), so
// a second page is asked for, and that second ask answered "moved" (KOSMOS_SAMPLE_OLDER_MOVED=2), through the app's own
// handling of such an answer. Each page is held back 8 s (KOSMOS_SAMPLE_OLDER_DELAY), long enough to step one drag down into
// the first page (off its top, and with Message 41 below the screen) before the moved answer comes.
// The control (KOSMOS_SAMPLE_NODROPFIX=1) leaves the reader at the old offset, as before the slice: Message 41 is not on screen
// after the drop, so the check can see the defect. UIKit list only: the lazy list's earlier pages are kosmos#7016's, unchanged.
final class EarlierDroppedUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private static let delay: Double = 8

    private static func launch(control: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        app.launchEnvironment["KOSMOS_SAMPLE_LONG"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OLDER_DELAY"] = String(Int(delay))
        app.launchEnvironment["KOSMOS_SAMPLE_OLDER_PAGE"] = "30"
        app.launchEnvironment["KOSMOS_SAMPLE_OLDER_MOVED"] = "2"
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
    private func readerUpInTheFirstPage(_ app: XCUIApplication, stayAtTop: Bool = false) -> Date {
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
        // One drag back down into the first page: off its top, and every row on screen is in it. Or none: the reader waits at
        // the top for the second page, every row on screen still in the first.
        if !stayAtTop { Self.drag(app, older: false) }
        // Rows of the first page are on screen now, so their absence after the drop (waitPastTheDrop) can be seen to change.
        XCTAssertTrue(Self.label(app, "Checking the venue list, item").exists, "CONTROL: no row of the first page is drawn before the drop")
        XCTAssertFalse(Self.onScreen(app, first), "CONTROL: Message 41 is on screen, so the reader still has a row that stays")
        XCTAssertFalse(Self.onScreen(app, Self.label(app, "Message 260 of 260")), "CONTROL: the reader is at the newest message")
        XCTAssertTrue(loading.exists, "CONTROL: the moved answer came before the reader was in place (raise the delay)")
        return asked
    }

    // The moved answer comes `delay` after the ask; this waits until 2 s after it, before the page asked for again (another
    // delay on) can land.
    private static func waitPastTheDrop(_ app: XCUIApplication, _ asked: Date) {
        let left = delay + 2 - Date().timeIntervalSince(asked)
        if left > 0 { Thread.sleep(forTimeInterval: left) }
        // The drop happened: no row of the first page is left (the page asked for again has not landed yet).
        XCTAssertFalse(label(app, "Checking the venue list, item").exists, "CONTROL: a row of the first page is still drawn, so the pages were not dropped")
    }

    func testAReaderUpInDroppedPagesGoesToTheTopOfWhatRemains() throws {
        if !UIKitListArm.on { throw XCTSkip("the UIKit list's handling of dropped earlier pages (kosmos#8221 slice 14)") }
        let app = Self.launch(control: false)
        let asked = readerUpInTheFirstPage(app)
        Self.waitPastTheDrop(app, asked)
        let first = Self.label(app, "Message 41 of 260")
        XCTAssertTrue(Self.onScreen(app, first), "the reader was not put at the top of what remains: Message 41 is not on screen")
        XCTAssertLessThan(first.frame.minY, app.frame.midY, "Message 41 is on screen but not at the top (y \(Int(first.frame.minY)))")
        XCTAssertFalse(Self.label(app, "Message 260 of 260").exists, "the drop took the reader to the newest message")
        // At the top, the page before is asked for again; it lands above and the reader's row stays where it is.
        let y0 = first.frame.minY
        let loading = Self.label(app, "Loading earlier messages")
        XCTAssertTrue(loading.exists, "at the top of what remains, the page before was not asked for again")
        let landed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: loading)
        XCTAssertEqual(XCTWaiter().wait(for: [landed], timeout: Self.delay + 15), .completed, "the page asked for again never landed")
        Thread.sleep(forTimeInterval: 1)
        XCTAssertTrue(first.exists, "the page asked for again moved the reader off Message 41")
        XCTAssertEqual(first.frame.minY, y0, accuracy: 8, "the page asked for again moved the reader \(Int(first.frame.minY - y0)) pt")
    }

    // Review 3: a reader who was already at the top, waiting for the second page, is at the top after the drop too, so the
    // list's top does not change; the list tells the chat again. This checks the outcome (at the top, the page asked for
    // again), not the fix: a fix-off control asked for the page again anyway (measured 11-10, by another path), so it was
    // removed, and Message 41 on screen holds either way for a reader already at the top.
    func testAReaderWaitingAtTheTopIsAskedForThePageAgain() throws {
        if !UIKitListArm.on { throw XCTSkip("the UIKit list's handling of dropped earlier pages (kosmos#8221 slice 14)") }
        let app = Self.launch(control: false)
        let asked = readerUpInTheFirstPage(app, stayAtTop: true)
        Self.waitPastTheDrop(app, asked)
        XCTAssertTrue(Self.onScreen(app, Self.label(app, "Message 41 of 260")), "the reader waiting at the top is not at the top of what remains")
        XCTAssertTrue(Self.label(app, "Loading earlier messages").exists, "the page before was not asked for again for a reader already at the top")
    }

    func testControlWithoutTheFixTheReaderLandsElsewhere() throws {
        if !UIKitListArm.on { throw XCTSkip("the UIKit list's handling of dropped earlier pages (kosmos#8221 slice 14)") }
        let app = Self.launch(control: true)
        let asked = readerUpInTheFirstPage(app)
        Self.waitPastTheDrop(app, asked)
        // And nothing was asked for again: with the fix off the reader is not at the top.
        XCTAssertFalse(Self.label(app, "Loading earlier messages").exists, "CONTROL: the reader was put at the top anyway (a page was asked for again)")
        XCTAssertFalse(Self.onScreen(app, Self.label(app, "Message 41 of 260")),
                       "CONTROL: with the fix off the reader is still at Message 41, so this check cannot see the defect")
        XCTAssertFalse(Self.label(app, "Message 260 of 260").exists, "CONTROL: the drop took the reader to the newest message")
    }
}
