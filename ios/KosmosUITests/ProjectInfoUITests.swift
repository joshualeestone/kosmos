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
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue", "KOSMOS_SAMPLE_FILES": "1"]
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
        // Slice B: Settings, the middle segment, with the board's own rename sentence.
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["Renaming is safe. Agents stay on the project, and Kosmos tells them the new name."].waitForExistence(timeout: 5), "Settings did not open")
        shot(app, "project-info-settings")
        app.swipeUp()
        shot(app, "project-info-settings-lower")
        app.buttons["Files"].tap()
        XCTAssertFalse(app.staticTexts["What it is for"].waitForExistence(timeout: 2), "About stayed after choosing Files")
        sleep(2)
        shot(app, "project-info-files")
    }

    // Review 1: tapping a member opens their chat on top of the project page.
    func testAMemberOpensTheirChat() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue", "KOSMOS_SAMPLE_FILES": "1"]
        app.launch()
        XCTAssertTrue(app.buttons["Add a file to this conversation"].waitForExistence(timeout: 20), "the sample room did not open")
        app.buttons["room-info"].tap()
        XCTAssertTrue(app.staticTexts["What it is for"].waitForExistence(timeout: 10), "About did not open")
        let dana = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Dana'")).firstMatch
        XCTAssertTrue(dana.waitForExistence(timeout: 5), "no member row for Dana")
        dana.tap()
        // Only Dana's own chat has this composer (the room's reads "Message Spring catalogue", a name a post also shows).
        let danaComposer = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
        XCTAssertTrue(danaComposer.waitForExistence(timeout: 10), "Dana's chat did not open")
        XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Spring catalogue'")).firstMatch.exists,
                       "the room is on top, not Dana's chat")
        shot(app, "project-info-member-chat")
    }
}
