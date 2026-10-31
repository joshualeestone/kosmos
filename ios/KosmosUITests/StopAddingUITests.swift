import XCTest

// kosmos#7682: an add that hangs ("Adding a file...", Josh's TestFlight build 24) has an x that clears it at once. The
// sample chat (KOSMOS_SAMPLE_ATTACHED=1) has one add counted as going that never ends, which is that stall.
final class StopAddingUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testTheXClearsAnAddThatNeverEnds() throws {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_ATTACHED": "1"]
        app.launch()
        let adding = app.staticTexts["Adding a file\u{2026}"]
        XCTAssertTrue(adding.waitForExistence(timeout: 30), "premise: the sample's add shows as going")
        let stop = app.buttons["stopAdding"]
        XCTAssertTrue(stop.waitForExistence(timeout: 5) && stop.isHittable, "an add going has an x to stop it")
        XCTAssertEqual(stop.label, "Stop adding the file")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "adding, with its x"; shot.lifetime = .keepAlways; add(shot)
        stop.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: adding)
        waitForExpectations(timeout: 5)
        XCTAssertFalse(stop.exists, "the x goes with the line")
        // The files already waiting stay: the x stops adding, it removes nothing that was added.
        XCTAssertTrue(app.staticTexts["Catalogue pages 1-8.pdf"].exists, "a file already waiting stayed")
        let after = XCTAttachment(screenshot: app.screenshot()); after.name = "after the x"; after.lifetime = .keepAlways; add(after)
    }
}
