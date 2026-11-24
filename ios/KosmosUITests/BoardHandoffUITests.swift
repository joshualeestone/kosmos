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
}
