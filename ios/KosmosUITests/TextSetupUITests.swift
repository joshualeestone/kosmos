import XCTest

// kosmos#8959 slice A: "Use text messages instead" on the second-step setup opens the phone's own number screen, not
// the web sign-in page (the navy Close page). The sample screens (KOSMOS_SAMPLE_SIGNIN) have no client, so nothing is
// sent. The shots take the simulator's own appearance: XCUIDevice.shared.appearance did not change it on an iOS 27.0
// simulator (two runs, both "dark" sets came out light), so dark shots come from `xcrun simctl ui <device> appearance dark`.
final class TextSetupUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func launch(_ sample: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_SIGNIN"] = sample
        app.launch()
        return app
    }

    private func keep(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }

    func testTextsOpenTheNumberScreen() {
        let app = launch("setup")
        let texts = app.buttons["Use text messages instead"]
        XCTAssertTrue(texts.waitForExistence(timeout: 10), "the setup screen does not offer text messages")
        texts.tap()
        let phone = app.textFields["signin-phone"]
        XCTAssertTrue(phone.waitForExistence(timeout: 5), "the number screen did not open")
        XCTAssertFalse(app.buttons["Close this page"].exists, "the board page opened over the sign-in")   // ContentView.swift's label
        XCTAssertTrue(app.buttons["Text me a code"].exists, "the number screen has no send button")
        keep(app, "setup-phone")
        // And back to the choice, where the authenticator app is offered.
        app.buttons["Use an authenticator app instead"].tap()
        XCTAssertTrue(app.buttons["Set up an authenticator app"].waitForExistence(timeout: 5), "the way back to the authenticator did not return")
    }

    func testTheTextScreens() {
        var app = launch("setuptext")
        XCTAssertTrue(app.staticTexts["Type the code"].waitForExistence(timeout: 10), "the texted-code screen is not showing")
        XCTAssertTrue(app.buttons["Use a different number"].exists, "no way to correct the number")
        keep(app, "setup-text")
        app.terminate()
        app = launch("setuptexterror")
        let refusal = "Error: The number needs the country code, like +12145551234."
        XCTAssertTrue(app.descendants(matching: .any)[refusal].waitForExistence(timeout: 10), "Kosmos+'s refusal is not shown under the number")
        keep(app, "setup-text-error")
    }
}
