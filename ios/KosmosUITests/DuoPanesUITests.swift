import XCTest

// kosmos#9002: on an unfolded iPhone Duo (both size classes regular) the Agents list and the open chat are side by side, and
// a fold or an unfold keeps the chat and the words typed into it. Sample agents, with KOSMOS_SAMPLE_REGULAR standing in for
// Duo (this Mac's Xcode has no Duo simulator). Sideways, for a width two panes need. Opt-in with TEST_RUNNER_KOSMOS_UI_PLUS=1.
final class DuoPanesUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    override func tearDown() { XCUIDevice.shared.orientation = .portrait; super.tearDown() }

    private func launch(_ regular: String?) throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana"]
        if let regular { app.launchEnvironment["KOSMOS_SAMPLE_REGULAR"] = regular }
        app.launch()
        return app
    }
    private func box(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
    }
    private func row(_ app: XCUIApplication) -> XCUIElement { app.staticTexts["Cleo"].firstMatch }
    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    // Polled, since the size classes change on a timer: true as soon as it holds, false at the end of the wait.
    private func holds(_ seconds: TimeInterval, _ what: () -> Bool) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end { if what() { return true }; usleep(300_000) }
        return what()
    }

    // CONTROL: the same phone, sideways, with no stand-in, keeps its one column.
    func testSidewaysWithoutTheStandInIsOneColumn() throws {
        let app = try launch(nil)
        XCTAssertTrue(box(app).waitForExistence(timeout: 40), "Dana's chat did not open")
        sleep(2)
        shot(app, "control, one column")
        XCTAssertFalse(row(app).exists && row(app).isHittable, "the list is beside the chat without the stand-in")
    }

    func testTheListIsBesideTheChatAndAFoldKeepsTheChatAndTheDraft() throws {
        let app = try launch("fold:40")
        XCTAssertTrue(box(app).waitForExistence(timeout: 30), "Dana's chat did not open")
        shot(app, "unfolded")
        XCTAssertTrue(row(app).waitForExistence(timeout: 5) && row(app).isHittable, "unfolded, the list is not beside the chat")
        box(app).tap()
        box(app).typeText("kept words")
        XCTAssertTrue(((box(app).value as? String) ?? "").contains("kept words"), "CONTROL: the words were not typed")
        XCTAssertTrue(holds(50) { !self.row(app).exists || !self.row(app).isHittable }, "the fold never came: the list is still beside the chat")
        XCTAssertTrue(box(app).waitForExistence(timeout: 10), "folded, Dana's chat is gone")
        shot(app, "folded")
        XCTAssertTrue(((box(app).value as? String) ?? "").contains("kept words"), "folded, the draft is gone (the box reads \((box(app).value as? String ?? "").debugDescription))")
        XCTAssertTrue(holds(60) { self.row(app).exists && self.row(app).isHittable }, "the unfold never came")
        XCTAssertTrue(box(app).waitForExistence(timeout: 10), "unfolded again, Dana's chat is gone")
        XCTAssertTrue(((box(app).value as? String) ?? "").contains("kept words"), "unfolded again, the draft is gone")
        shot(app, "unfolded again")
    }
}
