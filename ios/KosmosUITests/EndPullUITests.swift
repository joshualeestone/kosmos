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
        XCTAssertEqual(row.frame.minY, before, accuracy: 4, "the list did not bounce back, or moved, while the dots ran")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "end-pull-dots-long"; shot.lifetime = .keepAlways; add(shot)
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: dots(app))
        wait(for: [gone], timeout: 12)
        XCTAssertTrue(row.exists, "the newest message went away")
        XCTAssertEqual(row.frame.minY, before, accuracy: 4, "the chat did not stay where it was")
    }

    func testAShortPullDoesNothing() {
        let app = launch()
        let row = newest(app)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "CONTROL: the chat did not open")
        KeyboardSlideUITests.settle(row)
        pullUp(app, distance: 60)
        XCTAssertFalse(dots(app).waitForExistence(timeout: 2), "dots from a pull that never reached the threshold")
    }

    func testAPullHigherUpDoesNothing() {
        let app = launch(["KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_SCROLLUP": "40"])
        let rested = app.descendants(matching: .any).matching(identifier: "sample-scroll-rested").firstMatch
        XCTAssertTrue(rested.waitForExistence(timeout: 30), "CONTROL: the sample never scrolled up")
        pullUp(app, distance: 420)
        XCTAssertFalse(dots(app).waitForExistence(timeout: 2), "dots from scrolling a list that is not at its end")
    }
}
