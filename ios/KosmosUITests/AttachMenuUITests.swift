import XCTest

// kosmos#7596 review 3: the + panel hands each choice on once it has gone, and iOS opens nothing from a presentation still
// on its way out. This taps + and then Photos, and + and then Files, on the sample chat, and checks the picker came up
// over the chat (the + is covered). Skipped unless KOSMOS_UI_PLUS=1 is given to the test runner (TEST_RUNNER_KOSMOS_UI_PLUS).
// Camera cannot run here: a simulator has no camera, so the panel shows it dimmed.
final class AttachMenuUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func launch() throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana"]
        app.launch()
        return app
    }

    private func open(_ choice: String, in app: XCUIApplication) {
        let plus = app.buttons["Add a photo or file"]
        XCTAssertTrue(plus.waitForExistence(timeout: 20), "the chat's + did not show")
        plus.tap()
        let row = app.buttons[choice]
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the panel did not offer \(choice)")
        shot(app, "panel before \(choice)")
        row.tap()
        // Review 5: the panel itself has gone, so a panel stuck open cannot pass for the picker below.
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: row)
        waitForExpectations(timeout: 5)
        // The picker covers the chat: the + can no longer be tapped. A dropped presentation leaves it tappable.
        let covered = NSPredicate(format: "isHittable == false")
        expectation(for: covered, evaluatedWith: plus)
        waitForExpectations(timeout: 8)
        shot(app, "\(choice) opened")
    }

    func testPhotosOpensAfterThePanelCloses() throws {
        let app = try launch()
        open("Photos", in: app)
    }

    func testFilesOpensAfterThePanelCloses() throws {
        let app = try launch()
        open("Files", in: app)
    }

    // The control: the panel dismissed with no choice leaves the + tappable, so "covered" above means a picker opened.
    func testThePanelClosedWithNoChoiceLeavesThePlus() throws {
        let app = try launch()
        let plus = app.buttons["Add a photo or file"]
        XCTAssertTrue(plus.waitForExistence(timeout: 20), "the chat's + did not show")
        plus.tap()
        XCTAssertTrue(app.buttons["Photos"].waitForExistence(timeout: 5), "the panel did not open")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()   // outside the panel
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.buttons["Photos"])
        waitForExpectations(timeout: 5)   // the panel closed
        let open = NSPredicate(format: "isHittable == true")
        expectation(for: open, evaluatedWith: plus)
        waitForExpectations(timeout: 5)
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
}
