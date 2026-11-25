import XCTest

// kosmos#8959 slice D1a: Settings' "Automation" opens the native screen (AutomationView), not the board's page. In a
// sample run (KOSMOS_SAMPLE_AGENTS=1) the screen reads the sample computer's answers and never asks a real one, so this
// check sees each box in the board's words, flips a switch, and takes a screenshot of the top, the middle and the end.
final class AutomationUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testAutomationRowOpensTheNativeScreen() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-automation"]
        reveal(app, row, swipes: 10)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Automation row in Settings")
        XCTAssertTrue(app.buttons["Settings on your computer's board"].exists, "the board row went before the rest is native")
        row.tap()

        XCTAssertTrue(app.navigationBars["Automation"].waitForExistence(timeout: 10), "the native Automation screen did not open")
        let autoSave = app.switches["automation-autoSave-on"]
        XCTAssertTrue(autoSave.waitForExistence(timeout: 10), "no Auto-save switch")
        XCTAssertEqual(autoSave.value as? String, "1", "Auto-save does not read the computer's On")
        XCTAssertTrue(app.staticTexts["Save your agents' progress"].exists, "Auto-save is not in the board's words")
        XCTAssertTrue(app.buttons["automation-autoSave-level"].exists || app.otherElements["automation-autoSave-level"].exists,
                      "the level shows while Auto-save is on")
        shot(app, "automation-top")

        // The sample's Daily report is off; one press turns it on, and the switch says so.
        let report = app.switches["automation-dailyReport-on"]
        reveal(app, report)
        XCTAssertEqual(report.value as? String, "0", "the sample's Daily report should start off")
        report.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        XCTAssertTrue(waitFor(report, value: "1"), "pressing the Daily report switch did not turn it on")
        shot(app, "automation-middle")

        // The Recommender is on in the sample, so its three guards show, each in the board's words.
        let money = app.switches["automation-recommender-guard-money"]
        reveal(app, money)
        XCTAssertTrue(money.exists && app.switches["automation-recommender-guard-public"].exists && app.switches["automation-recommender-guard-delete"].exists,
                      "the Recommender's guards are missing while it is on")
        XCTAssertTrue(app.staticTexts["Act on anything that spends money"].exists, "a guard is not in the board's words")

        let elsewhere = app.staticTexts["Your computer's other settings are still on its board, under Settings on your computer's board."]
        reveal(app, elsewhere, swipes: 12)
        XCTAssertTrue(elsewhere.exists, "the screen does not say where the other settings are")
        shot(app, "automation-end")
    }

    private func waitFor(_ e: XCUIElement, value: String, timeout: TimeInterval = 5) -> Bool {
        let p = NSPredicate(format: "value == %@", value)
        return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: p, object: e)], timeout: timeout) == .completed
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
