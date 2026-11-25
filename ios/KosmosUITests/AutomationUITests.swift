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
        // A Toggle's label is part of the switch's own label, not a text of its own (review 4).
        XCTAssertTrue(autoSave.label.hasPrefix("Save your agents' progress"), "Auto-save is not in the board's words (label: \(autoSave.label))")
        XCTAssertTrue(app.buttons["automation-autoSave-level"].exists || app.otherElements["automation-autoSave-level"].exists,
                      "the level shows while Auto-save is on")
        shot(app, "automation-top")

        // kosmos#8959 slice D1d1: the sample's two check-ins under the Prompter box, each a button to its agent. Checked
        // here, near the top where the Prompter box is: reveal() only swipes down, so after the guards below they are gone.
        // Each found top to bottom (the heading, dana, eli), revealed and waited for on its own: the List builds rows
        // lazily, so one reveal for three rows can leave the last unbuilt (review 3).
        let heading = app.staticTexts["Agents that may need you"]
        reveal(app, heading, swipes: 6)
        XCTAssertTrue(heading.waitForExistence(timeout: 5), "the check-ins' heading is missing")
        let quiet = app.buttons["automation-checkin-dana"]
        reveal(app, quiet, swipes: 3)
        XCTAssertTrue(quiet.waitForExistence(timeout: 5), "the Prompter's check-ins are missing")
        XCTAssertTrue(quiet.label.contains("dana") && quiet.label.contains("seems to have gone quiet. Still mid-something, finished, or stopped?"), quiet.label)
        let gone = app.buttons["automation-checkin-eli"]
        reveal(app, gone, swipes: 3)
        XCTAssertTrue(gone.waitForExistence(timeout: 5), "the second check-in is missing")
        XCTAssertTrue(gone.label.contains("lost its connection, and Kosmos stopped trying."), "the gave-up question is not the page's: \(gone.label)")
        shot(app, "automation-checkins")


        // The sample's Daily report is off; one press turns it on, and the switch says so.
        let report = app.switches["automation-dailyReport-on"]
        reveal(app, report)
        XCTAssertEqual(report.value as? String, "0", "the sample's Daily report should start off")
        report.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        XCTAssertTrue(waitFor(report, value: "1"), "pressing the Daily report switch did not turn it on")
        shot(app, "automation-middle")

        // The Recommender is on in the sample, so its three guards show, each in the board's words.
        // Each guard is revealed on its own, as the check-ins are: a lazy List draws a row only near the screen, so the
        // first guard being on screen did not mean the other two were drawn yet (D1d1's light run failed here while its
        // dark run passed on the same head, kosmos#8959).
        // The money guard and the heading above it are read first, before revealing the lower two can scroll them away.
        let money = app.switches["automation-recommender-guard-money"]
        reveal(app, money)
        XCTAssertTrue(money.waitForExistence(timeout: 5), "the Recommender's money guard is missing while it is on")
        XCTAssertTrue(money.label.hasPrefix("Act on anything that spends money"), "a guard is not in the board's words (label: \(money.label))")
        XCTAssertTrue(app.staticTexts["Never let a recommendation:"].exists, "the guards show without the page's heading, so On reads as permission")
        for g in ["public", "delete"] {
            let sw = app.switches["automation-recommender-guard-" + g]
            reveal(app, sw)
            XCTAssertTrue(sw.waitForExistence(timeout: 5), "the Recommender's \(g) guard is missing while it is on")
        }

        // A predicate, not a subscript: XCUI refuses a string query longer than 128 characters (the 02:09 UI run).
        let elsewhere = app.staticTexts.matching(NSPredicate(format: "label == %@", "The Community's posts and kind of business, and the rest of your computer's settings are in Settings on your computer's board.")).firstMatch
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
