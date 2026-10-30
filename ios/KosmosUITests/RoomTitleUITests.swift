import XCTest

// kosmos#7489 reviews 1 and 2: the --new-project step's room check (SignInUITests.roomTitle) runs only against a real
// account, so it is checked here on sample rooms. Opt-in, with TEST_RUNNER_KOSMOS_UI_PLUS=1, as AttachMenuUITests is.
final class RoomTitleUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func open(_ project: String) throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": project]
        app.launch()
        XCTAssertTrue(app.buttons["Add a file to this conversation"].waitForExistence(timeout: 20), "the sample room did not open")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = project; shot.lifetime = .keepAlways; add(shot)
        return app
    }

    func testTheRoomTitleCheckFindsTheOpenRoomOnly() throws {
        let app = try open("springcatalogue")
        XCTAssertTrue(SignInUITests.roomTitle(app, "Spring catalogue").waitForExistence(timeout: 5), "the open room's title was not found")
        // Controls: a name the open one only starts with, and the open one's name with a comma part, are refused.
        XCTAssertFalse(SignInUITests.roomTitle(app, "Spring").exists, "matched a shorter name the open one starts with")
        XCTAssertFalse(SignInUITests.roomTitle(app, "Spring catalogue, 3").exists, "matched a name the open one only starts with")
    }

    // With a different room open (Cover shoot, a sub-project of Spring catalogue), the other room's name is refused.
    func testAnotherRoomIsRefused() throws {
        let app = try open("covershoot")
        XCTAssertTrue(SignInUITests.roomTitle(app, "Cover shoot").waitForExistence(timeout: 5), "the open room's title was not found")
        XCTAssertFalse(SignInUITests.roomTitle(app, "Spring catalogue").exists, "matched a room that is not open")
    }
}
