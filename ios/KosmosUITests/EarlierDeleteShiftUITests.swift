import XCTest

// kosmos#8221 slice 17: a delete shifts the Mac's latest window by one (one message fewer, so the newest earlier message moves
// into the window and olderCount drops by one). The chat restarts its earlier pages on a delete, and before this slice the next
// page was asked from the olderCount read before the delete, so it brought the message that had just moved into the window: the
// same message drawn twice, once at the end of the page and once at the start of the window. Now the next page waits for a read
// of the window as it is, which the delete starts at once (as the board's paintTalk does).
// The sample board's long chat (KOSMOS_SAMPLE_LONG) with pages of 30 (KOSMOS_SAMPLE_OLDER_PAGE), each held back `delay`
// (KOSMOS_SAMPLE_OLDER_DELAY). KOSMOS_SAMPLE_DELETE_ON_ASK=2 deletes the person's newest message 2 s before the second page is
// due (through the sheet's own delete), and KOSMOS_SAMPLE_DELETE_SHIFTS=1 shifts the window as the Mac does. Position 39 is the
// message that moves: "Checking the venue list, item 40." The control (KOSMOS_SAMPLE_NOREADFIRST=1) asks as before the slice,
// and the check counts that message twice. UIKit list only (slice 14's place keeping is the UIKit list's).
final class EarlierDeleteShiftUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private static let delay: Double = 6
    private static let moved = "Checking the venue list, item 40."

    private static func launch(control: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        app.launchEnvironment["KOSMOS_SAMPLE_LONG"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OLDER_DELAY"] = String(Int(delay))
        app.launchEnvironment["KOSMOS_SAMPLE_OLDER_PAGE"] = "30"
        app.launchEnvironment["KOSMOS_SAMPLE_DELETE_ON_ASK"] = "2"
        app.launchEnvironment["KOSMOS_SAMPLE_DELETE_SHIFTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_TRACE"] = "1"
        if control { app.launchEnvironment["KOSMOS_SAMPLE_NOREADFIRST"] = "1" }
        UIKitListArm.set(app)
        app.launch()
        return app
    }

    private static func label(_ app: XCUIApplication, _ prefix: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    private static func drag(_ app: XCUIApplication, older: Bool) {
        let a = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        let b = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        (older ? a : b).press(forDuration: 0.05, thenDragTo: older ? b : a, withVelocity: .slow, thenHoldForDuration: 0.4)
    }

    // To the top, the first page landed, on up to its top so the second page is asked for, and then past the delete and the
    // page asked for after it. Leaves the reader where slice 14 puts them, at the top of what remains, scrolled up one step so
    // the end of the new page and the start of the window are both drawn.
    private func deleteUnderTheReader(_ app: XCUIApplication) {
        XCTAssertTrue(Self.label(app, "Message 260 of 260").waitForExistence(timeout: 20), "the long chat did not open at its newest message")
        UIKitListArm.assertDrawn(app)
        let loading = Self.label(app, "Loading earlier messages")
        let near = Self.label(app, "Message 6")   // Message 60 to 69: near the top of the latest messages
        var swipes = 0
        while !near.exists && swipes < 60 { app.swipeDown(); swipes += 1 }
        XCTAssertTrue(near.exists, "never came near the top (\(swipes) swipes)")
        var drags = 0
        while !loading.exists && drags < 25 { Self.drag(app, older: true); drags += 1 }
        XCTAssertTrue(loading.exists, "CONTROL: reaching the top did not ask for the first page")
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: loading)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: Self.delay + 15), .completed, "CONTROL: the first page never landed")
        drags = 0
        while !loading.exists && drags < 30 { Self.drag(app, older: true); drags += 1 }
        XCTAssertTrue(loading.exists, "CONTROL: the first page's top did not ask for the second")
        // The delete comes 2 s before the second page is due; then the page asked for after it lands (up to a read and a delay).
        Thread.sleep(forTimeInterval: Self.delay)
        let landed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: loading)
        _ = XCTWaiter().wait(for: [landed], timeout: Self.delay + 10)
        XCTAssertFalse(loading.exists, "CONTROL: the page asked for after the delete never landed")
        // One step up: the new page's last rows come on screen above the window's first, where a second copy would be.
        Self.drag(app, older: true)
        Thread.sleep(forTimeInterval: 1)
    }

    private static func count(_ app: XCUIApplication, _ text: String) -> Int {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", text)).count
    }

    func testAfterADeleteTheNextPageIsAskedFromTheWindowAsItIs() throws {
        if !UIKitListArm.on { throw XCTSkip("the UIKit list's earlier pages (kosmos#8221 slice 17)") }
        let app = Self.launch(control: false)
        deleteUnderTheReader(app)
        XCTAssertGreaterThan(Self.count(app, Self.moved), 0, "CONTROL: the message that moved into the window is not drawn here, so this check sees nothing")
        XCTAssertEqual(Self.count(app, Self.moved), 1, "the message that moved into the window is drawn twice")
    }

    func testControlWithoutTheFixTheMovedMessageIsDrawnTwice() throws {
        if !UIKitListArm.on { throw XCTSkip("the UIKit list's earlier pages (kosmos#8221 slice 17)") }
        let app = Self.launch(control: true)
        deleteUnderTheReader(app)
        XCTAssertEqual(Self.count(app, Self.moved), 2, "CONTROL: with the fix off the moved message is not drawn twice, so this check cannot see the defect")
    }
}
