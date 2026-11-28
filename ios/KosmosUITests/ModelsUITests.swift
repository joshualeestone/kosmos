import XCTest

// kosmos#8959 slice D2a: Settings' "AI Models" opens the native, read-only list (ModelsView), not the board's page. In a
// sample run (KOSMOS_SAMPLE_AGENTS=1) the screen shows the sample computer's three accounts (two Claude, one OpenAI key)
// and never asks a real one, so this check sees each provider's section, each row's pill in the page's words, and the
// footer that sends changes to the computer. It drives only the sample build's path; the request, the read and every
// pill case are the logic suite's (run-models.sh) and the page parity test's.
final class ModelsUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testModelsRowOpensTheNativeList() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-models"]
        reveal(app, row, swipes: 10)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no AI Models row in Settings")
        row.tap()

        XCTAssertTrue(app.navigationBars["AI Models"].waitForExistence(timeout: 10), "the native AI Models screen did not open")
        let rows = app.otherElements.matching(identifier: "models-account")
        let first = rows.element(boundBy: 0)
        XCTAssertTrue(first.waitForExistence(timeout: 10), "no account rows")
        XCTAssertEqual(rows.count, 3, "the sample's three accounts")
        XCTAssertEqual(first.label, "dana@example.com, Signed in · active 2 minutes ago", "the working row is not in the page's words")
        XCTAssertEqual(rows.element(boundBy: 1).label, "Team account, Signed in", "the unverified row")
        XCTAssertEqual(rows.element(boundBy: 2).label, "API key ending 4f2a, The key was refused.", "the refused key row")
        XCTAssertTrue(app.staticTexts["Anthropic / Claude"].waitForExistence(timeout: 5) && app.staticTexts["OpenAI / Codex"].waitForExistence(timeout: 5),
                      "one section per provider, its name as written")
        XCTAssertTrue(app.staticTexts["To check, sign in, add or change an account, use Settings on your computer."].waitForExistence(timeout: 5),
                      "the footer that sends changes to the computer")
        XCTAssertFalse(app.buttons["Check now"].exists, "no button the phone cannot honour")
        shot(app, "models-list")
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
