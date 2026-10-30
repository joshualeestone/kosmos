import XCTest

// kosmos#7420 (Josh 10-29 21:22, build 19): a long DM went empty after the keyboard was dragged down, the list scrolled up,
// and the keyboard brought back. This walks the same steps on a sample chat (no account, no board), so the simulator can
// show whether the list empties, and the app's own trace (KOSMOS_SAMPLE_TRACE, Documents/trace.txt) records the scroll
// view's numbers at each resize. Skipped unless KOSMOS_UI_BLANK=1 is given to the test runner (TEST_RUNNER_KOSMOS_UI_BLANK).
final class ChatBlankUITests: XCTestCase {
    // Unlike SignInUITests, a failed step does not end the walk: the screenshots after it are the evidence.
    override func setUp() { super.setUp(); continueAfterFailure = true }

    private static let banner = "This conversation did not draw properly."

    private func launch(_ extra: [String: String] = [:]) throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_BLANK"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_BLANK=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "varied",
                                 "KOSMOS_SAMPLE_TRACE": "1"].merging(extra) { $1 }
        app.launch()
        return app
    }

    // The control: the list moved past its content's end (KOSMOS_SAMPLE_BLANK) must raise the banner, so the walk below
    // passing means the check saw no empty list, not that it cannot see one.
    func testAListPastItsEndRaisesTheBanner() throws {
        let app = try launch(["KOSMOS_SAMPLE_BLANK": "4"])
        XCTAssertTrue(app.staticTexts[Self.banner].waitForExistence(timeout: 20), "an empty list did not raise the #7420 banner")
        shot(app, "control: past the end")
    }

    // Only that the walk raises no banner; the screenshots are the evidence of what was drawn.
    func testJoshsStepsRaiseNoBanner() throws {
        let app = try launch()
        // The box is a UIKit field the accessibility tree does not list as a text view here, so it is tapped where it sits
        // (its placeholder, low in the screen), once the chat's search button shows the chat is open.
        XCTAssertTrue(app.buttons["Search this conversation"].waitForExistence(timeout: 20), "the chat did not open")
        let box = app.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.93))
        Thread.sleep(forTimeInterval: 2)
        shot(app, "1 opened")

        // Keyboard up, then dragged down from the list with a finger, slowly (the interactive dismiss Josh's record shows).
        box.tap()
        Thread.sleep(forTimeInterval: 1.5)
        // Without a keyboard the walk below is not Josh's, and passing it would mean nothing.
        XCTAssertTrue(app.keyboards.firstMatch.exists, "the keyboard did not come up")
        shot(app, "2 keyboard up")
        let mid = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
        mid.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.95)),
                  withVelocity: 300, thenHoldForDuration: 0.2)
        Thread.sleep(forTimeInterval: 1.5)
        shot(app, "3 keyboard dragged down")

        // Scrolled up through the history, resting between flicks as a reader does.
        for i in 0..<3 {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75)),
                       withVelocity: 1500, thenHoldForDuration: 0)
            Thread.sleep(forTimeInterval: 2.5)
            shot(app, "4 scrolled up \(i + 1)")
        }

        // Keyboard back up with the reader away from the newest message, then left alone.
        box.tap()
        Thread.sleep(forTimeInterval: 3)
        shot(app, "5 keyboard up again")
        Thread.sleep(forTimeInterval: 3)   // a check takes 1.5 s from its tick, the banner a moment more
        shot(app, "6 left alone")
        XCTAssertFalse(app.staticTexts[Self.banner].exists, "the chat reported itself empty (the #7420 banner)")
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        // Named with whether the banner showed at that moment, so the walk's evidence says where an empty list appeared.
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name + (app.staticTexts[Self.banner].exists ? " (banner)" : ""); a.lifetime = .keepAlways; add(a)
    }
}
