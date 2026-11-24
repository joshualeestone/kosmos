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
        // The retired one has no Retire; the three others each have their own. Two rows are named old-mini (one retired,
        // one silent), so exactly one "Retire old-mini" shows the retired row has none.
        XCTAssertTrue(app.buttons["Retire studio"].exists && app.buttons["Retire laptop"].exists, "Retire missing on a computer that answers")
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label == 'Retire old-mini'")).count, 1, "the retired old-mini has a Retire, or the silent one has none")
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
        XCTAssertTrue(app.buttons["account-more"].exists, "no way to the rest of the account")
        shot(app, "account-sign-out")
    }

    // kosmos#8959 slice B1b: with no second step set up (the sample's state), the screen offers one. Setting up an
    // authenticator shows the key, and a six-digit code turns it on: the section then says so, with the reset words.
    func testSecondStepOfferedThenOn() {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "settings", "KOSMOS_SAMPLE_SCROLL": "account"]
        app.launch()
        defer { app.terminate() }
        let row = app.buttons["settings-account"]
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Your Kosmos+ account row in Settings")
        for _ in 0..<6 where !row.isHittable { app.swipeUp() }
        row.tap()
        XCTAssertTrue(app.navigationBars["Kosmos+ account"].waitForExistence(timeout: 10), "the native account screen did not open")

        let appButton = app.buttons["account-second-app"]
        for _ in 0..<4 where !appButton.isHittable { app.swipeUp() }
        XCTAssertTrue(appButton.waitForExistence(timeout: 5), "no offer to set up an authenticator app")
        XCTAssertTrue(app.buttons["account-second-sms"].exists, "texts can be sent in the sample, so they are offered too")
        let on = app.descendants(matching: .any)["account-second-on"]
        XCTAssertFalse(on.exists, "the step reads as on before it is set up")
        shot(app, "account-second-offer")

        appButton.tap()
        XCTAssertTrue(app.navigationBars["Add your key"].waitForExistence(timeout: 5), "the authenticator setup did not open")
        let key = app.staticTexts["account-second-key"]
        XCTAssertTrue(key.exists, "the key is not shown")
        XCTAssertEqual(key.label, "Key: J B S W Y 3 D P E H P K 3 P X P", "the key is not read out letter by letter")
        let field = app.textFields["account-second-code"]
        XCTAssertTrue(field.exists, "no field for the code")
        field.tap(); field.typeText("12345")
        app.buttons["Confirm"].tap()
        XCTAssertTrue(app.staticTexts["The code is six digits."].waitForExistence(timeout: 3), "five digits were not refused")
        shot(app, "account-second-key")
        field.tap(); field.typeText("6")
        app.buttons["Confirm"].tap()

        XCTAssertTrue(on.waitForExistence(timeout: 5), "the section does not say the step is on")
        XCTAssertTrue(on.label.contains("Two-step sign-in is on"), "the on row does not say so: \(on.label)")
        XCTAssertTrue(on.label.contains("From now on, signing in asks for the email code and then a code from your authenticator app."), "the words for an authenticator are missing: \(on.label)")
        XCTAssertFalse(app.buttons["account-second-app"].exists, "the offer is still there once the step is on")
        shot(app, "account-second-on")
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
    }
}
