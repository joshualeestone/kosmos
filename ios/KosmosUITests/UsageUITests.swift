import XCTest

// kosmos#8959 slice D1c2a: Settings' "Token usage" opens the native figures (UsageView), not the board's page. In a
// sample run (KOSMOS_SAMPLE_AGENTS=1) the screen reads the sample computer's usage and never asks a real one, so this
// check sees the hero's figures, the model table, By agent and the history, in the page's words and arithmetic (the
// logic suite pins the arithmetic against the page's own functions). It drives only the sample build's path.
final class UsageUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testUsageRowOpensTheNativeFigures() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-usage"]
        reveal(app, row, swipes: 10)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Token usage row in Settings")
        row.tap()

        XCTAssertTrue(app.navigationBars["Token usage"].waitForExistence(timeout: 10), "the native Token usage screen did not open")
        let msg = app.staticTexts["usage-msg"]
        XCTAssertTrue(msg.waitForExistence(timeout: 5), "the counted-from line is missing")
        XCTAssertEqual(msg.label, "Counted from 1 place on this computer that holds transcripts. Claude removes transcripts after about 30 days, so an older day counts only if Kosmos saved it in time.")
        // The sample's figures, as the page computes them (141.3M tokens, 45 days).
        // A combined figure is one element whose type SwiftUI picks, so it is found by its identifier alone.
        let tokens = app.descendants(matching: .any)["usage-tokens"]
        XCTAssertTrue(tokens.waitForExistence(timeout: 5), "the total tokens figure is missing")
        XCTAssertTrue(tokens.label.contains("141.3M") && tokens.label.contains("Total Tokens Used"), tokens.label)
        // Each row is one element (its parts combined), found by its identifier.
        let model = app.descendants(matching: .any)["usage-model-0"]
        XCTAssertTrue(model.waitForExistence(timeout: 5), "the model table is missing its first row")
        XCTAssertTrue(model.label.hasPrefix("claude-opus-5-5"), model.label)
        shot(app, "usage-hero")

        let dana = app.descendants(matching: .any)["usage-agent-0"]
        reveal(app, dana)
        XCTAssertTrue(dana.exists, "By agent is missing its first row")
        XCTAssertTrue(dana.label.hasPrefix("Dana"), dana.label)
        let history = app.staticTexts["Usage history"]
        reveal(app, history)
        XCTAssertTrue(history.exists, "the history heading is missing")
        shot(app, "usage-history")
    }

    private func reveal(_ app: XCUIApplication, _ element: XCUIElement, swipes: Int = 8) {
        for _ in 0..<swipes where !(element.exists && element.isHittable) { app.swipeUp() }
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
