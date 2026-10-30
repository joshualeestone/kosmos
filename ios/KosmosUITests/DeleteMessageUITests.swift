import XCTest

// kosmos#7614: Delete in the long-press sheet, on the person's own message only, asking first in the board's words.
// Sample agents only (a Debug build): Dana's chat, whose "Great. What is left?" is the person's. Opt-in, with
// TEST_RUNNER_KOSMOS_UI_PLUS=1, as the other sample-board UI tests are (ios/tools/ui-sample.sh runs them).
final class DeleteMessageUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func launch() throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana"]
        app.launch()
        return app
    }

    /// A bubble reads as one button whose label is "<who>, <time>: <text>" (ChatView's spoken label).
    private func bubble(_ text: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", ": " + text)).firstMatch
    }

    private func openSheet(on el: XCUIElement) {
        XCTAssertTrue(el.waitForExistence(timeout: 20), "the message is not in the chat")
        el.press(forDuration: 0.8)
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    // The control: an agent's message has the sheet (Reply is there) but no Delete.
    func testAnAgentsMessageOffersNoDelete() throws {
        let app = try launch()
        // A bubble's label has the colon; the top bar's "Dana, Working" has none.
        let theirs = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@ AND label CONTAINS %@", "Dana, ", ": ")).firstMatch
        openSheet(on: theirs)
        XCTAssertTrue(app.buttons["Reply"].waitForExistence(timeout: 5), "the sheet did not open on Dana's message")
        XCTAssertFalse(app.buttons["Delete message"].exists, "Delete is offered on an agent's message")
        shot(app, "agent's message: no Delete")
    }

    // Keep it: asked, then nothing happens.
    func testKeepItLeavesTheMessage() throws {
        let app = try launch()
        let mine = bubble("Great. What is left?", in: app)
        openSheet(on: mine)
        let delete = app.buttons["Delete message"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5), "no Delete on the person's own message")
        delete.tap()
        XCTAssertTrue(app.staticTexts["Delete this message?"].waitForExistence(timeout: 5), "Delete did not ask first")
        shot(app, "asked")
        XCTAssertTrue(app.buttons["Keep it"].exists, "the question does not offer Keep it")
        app.buttons["Keep it"].tap()
        XCTAssertTrue(mine.waitForExistence(timeout: 5), "Keep it removed the message")
    }

    // Delete: asked, confirmed, and the message is gone from the chat.
    func testDeleteRemovesTheMessage() throws {
        let app = try launch()
        let mine = bubble("Great. What is left?", in: app)
        openSheet(on: mine)
        let delete = app.buttons["Delete message"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5), "no Delete on the person's own message")
        delete.tap()
        XCTAssertTrue(app.staticTexts["Delete this message?"].waitForExistence(timeout: 5), "Delete did not ask first")
        // The dialog's own Delete (destructive), not the sheet's row, which reads "Delete message".
        app.buttons.matching(NSPredicate(format: "label == %@", "Delete")).firstMatch.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: mine)
        waitForExpectations(timeout: 10)
        XCTAssertTrue(bubble("Morning Dana.", in: app).exists, "the person's other message went too")
        shot(app, "deleted")
    }
}
