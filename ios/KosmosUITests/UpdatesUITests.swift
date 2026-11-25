import XCTest

// kosmos#8959 slice D1c1: Settings' "Updates" opens the native card (UpdatesView), not the board's page. In a sample run
// (KOSMOS_SAMPLE_AGENTS=1) the screen shows the sample computer (a Mac on 0.8.21 with 0.8.22 ready, automatic updates
// on) and never asks a real one, so this check sees the version and the offer, that Update asks first in the page's
// words, that the switch is there, and what the screen says once it has updated. It drives only the sample build's
// path; the real requests, the wait and its verdicts are the logic suite's.
final class UpdatesUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testUpdatesRowOpensTheNativeCard() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-updates"]
        reveal(app, row, swipes: 10)
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Updates row in Settings")
        row.tap()

        XCTAssertTrue(app.navigationBars["Updates"].waitForExistence(timeout: 10), "the native Updates screen did not open")
        let version = app.staticTexts["updates-version"]
        XCTAssertTrue(version.waitForExistence(timeout: 5), "the version is missing")
        XCTAssertEqual(version.label, "Kosmos 0.8.21")
        let line = app.staticTexts["updates-line"]
        XCTAssertTrue(line.waitForExistence(timeout: 5), "the card's sentence is missing")
        XCTAssertEqual(line.label, "Version 0.8.22 is ready.", "the offer is not the page's sentence")
        let auto = app.switches["updates-auto"]
        XCTAssertTrue(auto.waitForExistence(timeout: 5), "the automatic-updates switch is missing on a Mac")
        XCTAssertEqual(auto.value as? String, "1", "the sample's automatic updates are on")
        shot(app, "updates-offer")

        let update = app.buttons["updates-button"]
        XCTAssertEqual(update.label, "Update")
        update.tap()
        let ask = app.alerts["Update Kosmos?"]
        XCTAssertTrue(ask.waitForExistence(timeout: 5), "Update did not ask first")
        XCTAssertTrue(ask.staticTexts["Kosmos closes for a few seconds while it updates. Your agents keep working the whole time."].exists,
                      "the confirm's words are not the page's")
        XCTAssertTrue(ask.buttons["Not now"].exists && ask.buttons["Update"].exists, "the confirm's buttons are not the page's")
        shot(app, "updates-confirm")
        ask.buttons["Not now"].tap()
        XCTAssertEqual(app.staticTexts["updates-line"].label, "Version 0.8.22 is ready.", "Not now changed something")

        app.buttons["updates-button"].tap()
        XCTAssertTrue(ask.waitForExistence(timeout: 5))
        ask.buttons["Update"].tap()
        XCTAssertTrue(app.staticTexts["Kosmos is now on 0.8.22."].waitForExistence(timeout: 5), "the screen does not say it updated")
        XCTAssertEqual(app.staticTexts["updates-version"].label, "Kosmos 0.8.22", "the version did not move on")
        XCTAssertEqual(app.buttons["updates-button"].label, "Check for Update", "up to date, the button is Check for Update")
        shot(app, "updates-done")
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
