import XCTest

// kosmos#8955: the agent page's AI Settings restart and remove the agent on the phone, each through its own confirmation,
// instead of sending the person to the board. Opt-in, with TEST_RUNNER_KOSMOS_UI_PLUS=1, as ProjectInfoUITests is; the
// screenshots are kept for design review. The sample board has no computer, so no restart or removal is ever sent: both
// dialogs are answered with their harmless button.
final class AgentActionsUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let s = XCTAttachment(screenshot: app.screenshot()); s.name = name; s.lifetime = .keepAlways; add(s)
    }

    // The popover's own outside region (UIKit names it PopoverDismissRegion), so the tap lands on no control behind it.
    private func dismissPopover(_ app: XCUIApplication) {
        let region = app.otherElements["PopoverDismissRegion"]
        XCTAssertTrue(region.waitForExistence(timeout: 3), "the dialog is not a popover with an outside to tap")
        region.tap()
    }

    func testRestartAndRemoveAskFirstOnThePhone() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_INFO": "ai"]
        app.launch()
        let restart = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Fresh start: Restart: stop and start '")).firstMatch
        // AI Settings opens at its top; the fresh start is below the fold, and the list builds only the rows on screen.
        XCTAssertTrue(app.staticTexts["Runs on"].waitForExistence(timeout: 20), "AI Settings did not open")
        for _ in 0..<4 where !(restart.exists && restart.isHittable) { app.swipeUp() }
        XCTAssertTrue(restart.exists && restart.isHittable, "AI Settings has no Restart")
        // CONTROL: before the tap, no restart dialog is up, so the check after it can tell.
        let restartTitle = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Restart ' AND label ENDSWITH '?'")).firstMatch
        XCTAssertFalse(restartTitle.exists, "a restart dialog showed before Restart was pressed")
        shot(app, "agent-ai-fresh-start")
        restart.tap()
        XCTAssertTrue(restartTitle.waitForExistence(timeout: 5), "Restart did not ask first")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'part way through'")).firstMatch.exists, "the dialog does not say what a restart ends")
        shot(app, "agent-restart-dialog")
        // iOS 26 and later draw this as a popover with no cancel button: a tap outside it is "Leave it running" (the
        // page's other dialogs, Compact and Clear, close the same way).
        XCTAssertTrue(app.buttons["Restart Dana"].exists, "the dialog's answer does not name the agent")
        dismissPopover(app)
        XCTAssertFalse(restartTitle.waitForExistence(timeout: 2), "Leave it running did not close the dialog")

        // Remove, at the foot of the page, below the fresh start.
        let remove = app.buttons["Remove this agent\u{2026}"]
        for _ in 0..<4 where !remove.isHittable { app.swipeUp() }
        XCTAssertTrue(remove.isHittable, "AI Settings has no Remove this agent")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'restart it, or remove it.'")).firstMatch.exists,
                       "the board row still promises restart and remove there")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Opens your computer\u{2019}s board, a web page.'")).firstMatch.exists,
                      "the board row does not say it opens a web page")
        shot(app, "agent-ai-remove")
        let question = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Are you sure you want to remove '")).firstMatch
        XCTAssertFalse(question.exists, "CONTROL: the removal question showed before Remove was pressed")
        remove.tap()
        XCTAssertTrue(question.waitForExistence(timeout: 5), "Remove did not ask first")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Loses: '")).firstMatch.exists, "the dialog does not say what it loses")
        shot(app, "agent-remove-dialog")
        XCTAssertTrue(app.buttons["Remove Dana"].exists, "the removal's answer does not name the agent")
        dismissPopover(app)
        XCTAssertFalse(question.waitForExistence(timeout: 2), "Leave it running did not close the removal dialog")
    }
}
