import XCTest

/// kosmos#8072: pulling a chat up past its newest message shows the dots and ends on its own, and the chat comes back where
/// it was. The dots are held by KOSMOS_SAMPLE_PULL_SECONDS, since a sample read ends before anything could look at it.
/// Not shown here: a new message arriving through a pull, and a real phone. That is the card's Done.
final class EndPullUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func launch(_ extra: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_PULL_SECONDS": "4"]
        for (k, v) in extra { app.launchEnvironment[k] = v }
        app.launch()
        return app
    }

    private func newest(_ app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Pages 9 to 12 need the new photos'")).firstMatch
    }

    private func dots(_ app: XCUIApplication) -> XCUIElement { app.descendants(matching: .any)["Refreshing"] }

    private static func box(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
    }

    private func pullUp(_ app: XCUIApplication, distance: CGFloat) {
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: -distance)), withVelocity: .slow, thenHoldForDuration: 0.1)
    }

    func testAPullPastTheNewestShowsTheDotsEndsAndComesBack() {
        let app = launch()
        let row = newest(app)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "CONTROL: the chat did not open")
        KeyboardSlideUITests.settle(row)
        XCTAssertFalse(dots(app).exists, "dots at rest, before any pull")
        let before = row.frame.minY
        pullUp(app, distance: 420)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3), "no dots after a long pull")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "end-pull-dots"; shot.lifetime = .keepAlways; add(shot)
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: dots(app))
        wait(for: [gone], timeout: 12)
        KeyboardSlideUITests.settle(row)
        XCTAssertTrue(row.exists, "the newest message went away")
        XCTAssertEqual(row.frame.minY, before, accuracy: 4, "the chat did not come back where it was")
    }

    // A chat long enough to fill the screen: the list bounces back under the dots, and stays where it was.
    func testALongChatPullBouncesBackUnderTheDots() {
        let app = launch(["KOSMOS_SAMPLE_LONG": "1"])
        let row = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "CONTROL: the long chat did not open at its newest message")
        KeyboardSlideUITests.settle(row)
        let before = row.frame.minY
        pullUp(app, distance: 420)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3), "no dots after a long pull")
        KeyboardSlideUITests.settle(row)
        XCTAssertTrue(dots(app).exists, "the dots went before the read ended")
        // A chat opens a little short of its true end and any touch settles it there, as with any scroll: up to 20 pt.
        let landed = row.frame.minY
        XCTAssertEqual(landed, before, accuracy: 20, "the list did not bounce back")
        XCTAssertLessThanOrEqual(dots(app).frame.maxY, Self.box(app).frame.minY, "the dots rest under the message box, where nobody can see them")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "end-pull-dots-long"; shot.lifetime = .keepAlways; add(shot)
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: dots(app))
        wait(for: [gone], timeout: 12)
        XCTAssertTrue(row.exists, "the newest message went away")
        XCTAssertEqual(row.frame.minY, landed, accuracy: 4, "the chat moved when the dots went")
    }

    // The next pull counts, even when the first read ended after the list had come back.
    func testASecondPullCountsToo() {
        let app = launch(["KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_PULL_SECONDS": "1"])
        let row = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "CONTROL: the long chat did not open at its newest message")
        KeyboardSlideUITests.settle(row)
        pullUp(app, distance: 420)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3), "no dots after the first pull")
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: dots(app))
        wait(for: [gone], timeout: 12)
        KeyboardSlideUITests.settle(row)
        pullUp(app, distance: 420)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3), "no dots after a second pull")
    }

    // KOSMOS_SAMPLE_GROW: every read brings a message, the 5 s reads too, so this is a message landing around a pull, not
    // proof that the pull fetched it. It must reach the screen, with the list still drawn and at its end.
    func testAMessageLandingAroundAPullShowsAndNothingBlanks() {
        let app = launch(["KOSMOS_SAMPLE_GROW": "1"])
        let grown = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'New message'"))
        XCTAssertTrue(grown.firstMatch.waitForExistence(timeout: 20), "CONTROL: no message arrived")
        pullUp(app, distance: 420)
        XCTAssertTrue(dots(app).waitForExistence(timeout: 3), "no dots after a long pull")
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: dots(app))
        wait(for: [gone], timeout: 12)
        let seen = grown.count
        let more = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count > %d", seen), object: grown)
        XCTAssertEqual(XCTWaiter().wait(for: [more], timeout: 15), .completed, "no later message reached the list")
        let last = grown.element(boundBy: grown.count - 1)
        XCTAssertTrue(last.exists && last.isHittable, "the newest message is not on screen after a pull")
    }

    func testAShortPullDoesNothing() {
        let app = launch()
        let row = newest(app)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "CONTROL: the chat did not open")
        KeyboardSlideUITests.settle(row)
        pullUp(app, distance: 60)
        XCTAssertFalse(dots(app).waitForExistence(timeout: 2), "dots from a pull that never reached the threshold")
    }

    // Not past the end at all. The end-marker gate itself is pinned by a source check in LogicTests/room.
    func testAPullHigherUpDoesNothing() {
        let app = launch(["KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_SCROLLUP": "40"])
        let rested = app.descendants(matching: .any).matching(identifier: "sample-scroll-rested").firstMatch
        XCTAssertTrue(rested.waitForExistence(timeout: 30), "CONTROL: the sample never scrolled up")
        pullUp(app, distance: 420)
        XCTAssertFalse(dots(app).waitForExistence(timeout: 2), "dots from scrolling a list that is not at its end")
    }
}
