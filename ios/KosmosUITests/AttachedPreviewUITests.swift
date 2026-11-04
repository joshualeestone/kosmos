import XCTest

// kosmos#7944 (Josh 11-04): tapping a picture waiting on the composer opens it large, with Remove as the only action.
// The sample chat (KOSMOS_SAMPLE_ATTACHED) has a PDF and a photo waiting. Opt-in, with TEST_RUNNER_KOSMOS_UI_PLUS=1, as
// the other composer tests are; screenshots kept for design review.
final class AttachedPreviewUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let s = XCTAttachment(screenshot: app.screenshot()); s.name = name; s.lifetime = .keepAlways; add(s)
    }

    func testTapAWaitingPictureThenRemoveIt() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_ATTACHED": "1"]
        app.launch()
        let photo = "Photo 2026-10-24 at 18.30.05.jpg"
        let open = app.buttons.matching(identifier: "attached-preview-open").firstMatch
        XCTAssertTrue(open.waitForExistence(timeout: 20), "the waiting photo shows no picture to tap")
        // CONTROL: the PDF beside it is a plain chip (only the photo is tappable), and no sheet is open yet.
        XCTAssertEqual(app.buttons.matching(identifier: "attached-preview-open").count, 1, "more than the photo is tappable")
        XCTAssertFalse(app.buttons["attached-preview-remove"].exists, "the preview showed before a tap")
        shot(app, "composer-with-thumbnail")
        open.tap()
        let remove = app.buttons["attached-preview-remove"]
        XCTAssertTrue(remove.waitForExistence(timeout: 5), "the preview did not open")
        XCTAssertTrue(app.staticTexts[photo].exists, "the preview does not name the file")
        sleep(1)   // the sheet's slide up, for the screenshot only
        shot(app, "preview-open")
        remove.tap()
        let gone = NSPredicate(format: "exists == false")
        XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: gone, evaluatedWith: remove)], timeout: 5), .completed, "the preview stayed after Remove")
        XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: gone, evaluatedWith: open)], timeout: 5), .completed, "the photo is still waiting after Remove")
        XCTAssertTrue(app.buttons["Remove Catalogue pages 1-8.pdf"].exists, "CONTROL: Remove took the other file too")
        shot(app, "after-remove")
    }
}
