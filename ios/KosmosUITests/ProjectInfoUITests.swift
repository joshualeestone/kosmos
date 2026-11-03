import XCTest

// kosmos#7838: the room's info button opens the native project page (ProjectInfoView), not the board in a sheet: About
// first, then Files. Opt-in, with TEST_RUNNER_KOSMOS_UI_PLUS=1, as RoomTitleUITests is; screenshots kept for design review.
final class ProjectInfoUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let s = XCTAttachment(screenshot: app.screenshot()); s.name = name; s.lifetime = .keepAlways; add(s)
    }

    func testInfoOpensTheProjectPageAboutThenFiles() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"]
        app.launch()
        XCTAssertTrue(app.buttons["Add a file to this conversation"].waitForExistence(timeout: 20), "the sample room did not open")
        // CONTROL: before the tap, the project page is not on screen.
        XCTAssertFalse(app.staticTexts["What it is for"].exists, "the project page showed before Project info was tapped")
        XCTAssertFalse(app.buttons["Files"].exists, "the room still has a separate Files button")
        app.buttons["room-info"].tap()
        XCTAssertTrue(app.staticTexts["What it is for"].waitForExistence(timeout: 10), "About did not open")
        XCTAssertTrue(app.staticTexts["Members"].exists || app.staticTexts["MEMBERS"].exists, "no Members section")
        shot(app, "project-info-about")
        app.swipeUp()
        shot(app, "project-info-about-lower")
        app.buttons["Files"].tap()
        XCTAssertFalse(app.staticTexts["What it is for"].waitForExistence(timeout: 2), "About stayed after choosing Files")
        sleep(2)
        shot(app, "project-info-files")
    }
}
