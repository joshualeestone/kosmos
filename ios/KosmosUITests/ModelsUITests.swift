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
        // Any element type: a List row with combined children can surface as a cell or an other element (review 2).
        let rows = app.descendants(matching: .any).matching(identifier: "models-account")
        let first = rows.element(boundBy: 0)
        XCTAssertTrue(first.waitForExistence(timeout: 10), "no account rows")
        // At least three: on some iOS versions a cell and its inner element both carry the identifier (review 3).
        XCTAssertGreaterThanOrEqual(rows.count, 3, "the sample's three accounts")
        // By their whole labels, not by position (a duplicated element would shift positions).
        for label in ["dana@example.com, Signed in · active 2 minutes ago", "Team account, Signed in", "API key ending 4f2a, The key was refused."] {
            XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "models-account").matching(NSPredicate(format: "label == %@", label)).firstMatch.exists,
                          "no row reads: " + label)
        }
        XCTAssertTrue(app.staticTexts["Anthropic / Claude"].waitForExistence(timeout: 5) && app.staticTexts["OpenAI / Codex"].waitForExistence(timeout: 5),
                      "one section per provider, its name as written")
        XCTAssertTrue(app.staticTexts["To check, sign in, add or change an account, use Settings on your computer."].waitForExistence(timeout: 5),
                      "the footer that sends changes to the computer")
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
