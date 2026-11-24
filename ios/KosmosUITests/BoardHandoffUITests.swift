import XCTest

/// kosmos#8957: a phone fallback that opens the computer's board says so, and the phone's own tabs no longer offer
/// "Back to Kosmos" (which opened the board) when the computer is not answering. Each screen keeps a screenshot.
final class BoardHandoffUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private func keep(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    private func launch(_ wait: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_WAIT"] = wait
        app.launch()
        return app
    }

    func testNotAnsweringOffersTryAgainAndNoBackToKosmos() {
        let app = launch("unreachable")
        let tryAgain = app.buttons["Try again"]
        XCTAssertTrue(tryAgain.waitForExistence(timeout: 10), "the not-answering screen is not showing")
        keep(app, "unreachable")
        XCTAssertFalse(app.buttons["Back to Kosmos"].exists, "Back to Kosmos still opens the board from the phone's own tab")
    }

    func testSignInFallbacksSayTheyOpenTheBoard() {
        for wait in ["signedout", "refused"] {
            let app = launch(wait)
            let signIn = app.buttons["Sign in"]
            XCTAssertTrue(signIn.waitForExistence(timeout: 10), "\(wait): no Sign in button")
            keep(app, "signin-fallback-" + wait)
            XCTAssertTrue(app.staticTexts["Opens on your computer's board"].exists,
                          "\(wait): nothing says Sign in opens the computer's board")
            app.terminate()
        }
    }

    func testPlusAsksBeforeItOpensTheBoard() {
        // The sample board has no computer address (macURL), so + takes the board path, which now asks first.
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launch()
        let plus = app.buttons["Add agent"]
        XCTAssertTrue(plus.waitForExistence(timeout: 10), "no + on Agents")
        plus.tap()
        let open = app.buttons["Open your computer's board"]
        XCTAssertTrue(open.waitForExistence(timeout: 5), "+ opened the board without asking")
        XCTAssertTrue(app.staticTexts["Add an agent on your computer's board?"].exists, "the question is not shown")
        keep(app, "plus-asks")
        app.buttons["Cancel"].firstMatch.tap()
        XCTAssertTrue(plus.waitForExistence(timeout: 5) && !open.exists, "Cancel did not keep the person on the phone's screen")
    }
}
