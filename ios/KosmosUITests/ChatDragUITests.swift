import XCTest

// kosmos#8221 slice 2, item 8, on both lists (UIKitListArm). A drag down the conversation takes the keyboard down with it
// (interactive dismissal), leaving the conversation drawn above the box.
// Not here: the side lock (SideScrollLock, kosmos#7420). A sideways-swipe check was tried 11-08 and passed on the lazy list
// with the lock off too (TEST_RUNNER_KOSMOS_SAMPLE_NOLOCK=1), so the simulator cannot show the drift and that check could not
// fail. The UIKit list is a list layout as wide as itself with no sideways bounce; the lock stays on the lazy list.
final class ChatDragUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private static func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        app.launchEnvironment["KOSMOS_SAMPLE_LONG"] = "1"
        UIKitListArm.set(app)   // kosmos#8221: the list under test
        app.launch()
        return app
    }

    private static func box(_ app: XCUIApplication) -> XCUIElement {
        let box = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 30), "no message box")
        return box
    }

    // The drag also scrolls the chat toward older messages (it is a drag down a list), so what is checked after it is that
    // messages are drawn above the box, not which one (measured 11-08: the newest is scrolled off on both lists).
    func testADragDownTakesTheKeyboardDownAndLeavesMessagesDrawnAboveTheBox() throws {
        let app = Self.launch()
        let box = Self.box(app)
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 20), "CONTROL: the long chat did not open at its newest message")
        KeyboardSlideUITests.settle(newest)
        try KeyboardSlideUITests.keyboardUp(app, box, newest, shot: "drag-keyboard-up", test: self)
        // CONTROL: the keyboard is up before the drag, so its going is the drag's doing.
        XCTAssertTrue(app.keyboards.firstMatch.exists, "CONTROL: no keyboard before the drag")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.9)))
        let down = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        XCTAssertEqual(XCTWaiter().wait(for: [down], timeout: 5), .completed, "the keyboard did not go down with a drag down the chat")
        KeyboardSlideUITests.settle(box)
        KeyboardSlideUITests.settle(newest)
        let rows = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message ' AND label CONTAINS ' of 260.'"))
        let header = app.navigationBars.firstMatch.frame.maxY
        let shown = rows.allElementsBoundByIndex.filter { $0.isHittable && $0.frame.minY > header && $0.frame.maxY <= box.frame.minY + 1 }
        XCTAssertFalse(shown.isEmpty, "no message on screen between the top bar and the box after the keyboard went down")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "drag-keyboard-down"; shot.lifetime = .keepAlways; add(shot)
    }
}
