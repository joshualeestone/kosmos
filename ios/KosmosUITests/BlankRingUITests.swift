import XCTest

// kosmos#8053: the ring over a list with messages and none drawn. A simulator cannot blank on demand, so KOSMOS_SAMPLE_BLANKRING=<seconds>
// makes the list read as blank that long; the ring's timing and words are the real ones. A normal open has no switch and stays clean.
final class BlankRingUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func launch(_ hold: String?, room: Bool = false) throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = room
            ? ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"]
            : ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana"]
        if let hold { app.launchEnvironment["KOSMOS_SAMPLE_BLANKRING"] = hold }
        app.launch()
        return app
    }

    private func gone(_ element: XCUIElement, timeout: TimeInterval) {
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        waitForExpectations(timeout: timeout)
    }

    func testANormalOpenNeverShowsIt() throws {
        let app = try launch(nil)
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Pages 9 to 12 need the new photos'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 20), "CONTROL: the chat did not open")
        Thread.sleep(forTimeInterval: 2)
        XCTAssertFalse(app.descendants(matching: .any)["blank-ring-was-shown"].exists, "a ring during a normal open")
    }

    func testANormalRoomOpenNeverShowsIt() throws {
        let app = try launch(nil, room: true)
        XCTAssertTrue(app.descendants(matching: .any)["room-title"].waitForExistence(timeout: 20), "CONTROL: the room did not open")
        Thread.sleep(forTimeInterval: 3)
        XCTAssertFalse(app.descendants(matching: .any)["blank-ring-was-shown"].exists, "a ring during a normal room open")
    }

    func testTheRingComesAndGoes() throws {
        let app = try launch("6")
        let ring = app.descendants(matching: .any)["blank-ring"]
        XCTAssertTrue(ring.waitForExistence(timeout: 20) || app.descendants(matching: .any)["blank-ring-was-shown"].exists, "no ring")   // kosmos#7609: on a slow runner it can come and go before the first look
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "ring"; a.lifetime = .keepAlways; add(a)
        gone(ring, timeout: 15)
        XCTAssertTrue(app.descendants(matching: .any)["blank-ring-was-shown"].exists, "CONTROL: the marker this file's first check reads")
    }

    func testTheRingComesAndGoesInARoom() throws {
        let app = try launch("6", room: true)
        let ring = app.descendants(matching: .any)["blank-ring"]
        XCTAssertTrue(ring.waitForExistence(timeout: 20) || app.descendants(matching: .any)["blank-ring-was-shown"].exists, "no ring in a room")   // kosmos#7609: on a slow runner it can come and go before the first look
        gone(ring, timeout: 15)
    }

    func testItGivesUpAndTryAgainStartsOver() throws {
        let app = try launch("600")
        let again = app.buttons["Try again"]
        XCTAssertTrue(again.waitForExistence(timeout: 30), "it did not stop")
        XCTAssertFalse(app.descendants(matching: .any)["blank-ring"].exists, "still spinning")
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "failed"; a.lifetime = .keepAlways; add(a)
        again.tap()
        XCTAssertTrue(app.descendants(matching: .any)["blank-ring"].waitForExistence(timeout: 10), "Try again did nothing")
    }
}
