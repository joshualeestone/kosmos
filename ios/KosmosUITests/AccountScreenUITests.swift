import XCTest

// kosmos#8959 slice B1a: Settings' "Your Kosmos+ account" opens the native account screen (AccountView), not the web
// page. In a sample run (KOSMOS_SAMPLE_AGENTS=1) the screen lists sample computers and never asks Kosmos+, so this check
// sees the rows, the Retire sheet with Kosmos+'s sentence and the sign-out buttons, and takes a screenshot of each.
final class AccountScreenUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    func testAccountRowOpensTheNativeScreen() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-account"]
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Your Kosmos+ account row in Settings")
        for _ in 0..<6 where !row.isHittable { app.swipeUp() }
        row.tap()

        XCTAssertTrue(app.navigationBars["Kosmos+ account"].waitForExistence(timeout: 10), "the native account screen did not open")
        XCTAssertTrue(app.staticTexts["Answering now"].waitForExistence(timeout: 5), "the answering computer's words are missing")
        XCTAssertTrue(app.staticTexts["Retired. Its address is free again."].exists, "the retired computer is not listed")
        XCTAssertTrue(app.staticTexts["Has not answered in 20 days. It may be off, or gone."].exists, "the silent computer's words are missing")
        // The retired one has no Retire; the three others do.
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Retire '")).count, 3, "Retire on every computer not retired, and only those")
        shot(app, "account-screen")

        app.buttons["Retire studio"].tap()
        XCTAssertTrue(app.staticTexts["Type K7QX to retire studio; it will stop answering and its name is free again after a day."].waitForExistence(timeout: 5),
                      "the Retire sheet does not show Kosmos+'s sentence")
        XCTAssertTrue(app.textFields["account-retire-code"].exists, "no field for the code")
        shot(app, "account-retire")
        app.buttons["Cancel"].tap()

        for _ in 0..<4 where !app.buttons["account-sign-out-everywhere"].isHittable { app.swipeUp() }
        XCTAssertTrue(app.buttons["account-sign-out"].exists && app.buttons["account-sign-out-everywhere"].exists, "no sign-out buttons")
        XCTAssertTrue(app.buttons["More on Kosmos+"].exists, "no way to the rest of the account")
        shot(app, "account-sign-out")
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
