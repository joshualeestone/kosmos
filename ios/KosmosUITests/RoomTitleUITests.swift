import XCTest

// kosmos#7489 review 1: the --new-project step's room check (SignInUITests.roomTitle) runs only against a real account,
// so it is checked here on a sample room. Opt-in, with TEST_RUNNER_KOSMOS_UI_PLUS=1, as AttachMenuUITests is.
final class RoomTitleUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testTheRoomTitleCheckFindsTheOpenRoomOnly() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"]
        app.launch()
        XCTAssertTrue(app.buttons["Add a file to this conversation"].waitForExistence(timeout: 20), "the sample room did not open")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "sample room"; shot.lifetime = .keepAlways; add(shot)
        XCTAssertTrue(SignInUITests.roomTitle(app, "Spring catalogue").waitForExistence(timeout: 5), "the open room's title was not found")
        // Controls: another sample project's name, and a name the open one only starts with, are both refused.
        XCTAssertFalse(SignInUITests.roomTitle(app, "Cover shoot").exists, "matched a project that is not open")
        XCTAssertFalse(SignInUITests.roomTitle(app, "Spring").exists, "matched a shorter name the open one starts with")
    }
}
