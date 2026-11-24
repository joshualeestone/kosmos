import XCTest

// kosmos#8958 slice A: an unsent draft (text Kosmos took out of the agent's input box) is drawn in the chat itself, with
// the board's "Put in the message box" and "Dismiss", and no longer opens the computer's board. Sample agents only (a
// Debug build): Dana's chat with KOSMOS_SAMPLE_DRAFT=1. Opt-in with TEST_RUNNER_KOSMOS_UI_PLUS=1, as the other
// sample-board UI tests are (ios/tools/ui-sample.sh runs them). Screenshots in light and dark are the design shots.
final class UnsentDraftUITests: XCTestCase {
    private let words = "Also check the shipping weights before you publish"
    private let band = "This text sat unsent in its input box and kept messages from reaching it, so Kosmos took it out and saved it here. It was not sent."

    override func setUp() { super.setUp(); continueAfterFailure = false }
    override func tearDown() { XCUIDevice.shared.appearance = .light; super.tearDown() }

    private func launch(dark: Bool = false) throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        XCUIDevice.shared.appearance = dark ? .dark : .light
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_DRAFT": "1"]
        UIKitListArm.set(app)   // kosmos#8221: runs on either list (TEST_RUNNER_KOSMOS_UIKITLIST)
        app.launch()
        UIKitListArm.assertDrawn(app)
        return app
    }

    // A predicate, not app.staticTexts[band]: XCUITest refuses a subscript identifier over 128 characters, and the band is
    // longer (CI run 45376693324: "Invalid query - string identifier ... exceeds maximum length of 128 characters").
    private func bandText(_ app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label == %@", band)).firstMatch
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    // The row as the board draws it: the band, the words, both actions, and no link to the board.
    func testTheDraftIsDrawnInTheChat() throws {
        for dark in [false, true] {
            let app = try launch(dark: dark)
            XCTAssertTrue(bandText(app).waitForExistence(timeout: 30), "the draft's band is not in the chat")
            XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", words)).firstMatch.exists,
                          "the draft's words are not shown")
            XCTAssertTrue(app.buttons["Put in the message box"].exists, "no Put in the message box")
            XCTAssertTrue(app.buttons["Dismiss"].exists, "no Dismiss")
            XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "on your computer's board")).firstMatch.exists,
                           "the draft still offers the computer's board")
            shot(app, "unsent draft, \(dark ? "dark" : "light")")
            app.terminate()
        }
    }

    // Put in the message box: the words wait in the box, and the draft stays.
    func testPutInTheMessageBoxFillsTheBox() throws {
        let app = try launch()
        let put = app.buttons["Put in the message box"]
        XCTAssertTrue(put.waitForExistence(timeout: 30), "no Put in the message box")
        put.tap()
        let box = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 10), "no message box")
        let filled = NSPredicate(format: "value CONTAINS %@", words)
        expectation(for: filled, evaluatedWith: box)
        waitForExpectations(timeout: 10)
        // Waited for, and either part of the row will do: with the keyboard up the list may have moved the band away.
        XCTAssertTrue(app.buttons["Dismiss"].waitForExistence(timeout: 10) || bandText(app).exists,
                      "putting the words in the box took the draft away")
        shot(app, "draft put in the message box")
    }

    // Dismiss: the row goes, and a fresh read of the chat (closed and opened again, which reads before it draws) does
    // not bring it back, so the dismiss reached what the chat reads, not only what it was showing.
    func testDismissTakesTheDraftAway() throws {
        let app = try launch()
        let dismiss = app.buttons["Dismiss"]
        XCTAssertTrue(dismiss.waitForExistence(timeout: 30), "no Dismiss")
        dismiss.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: bandText(app))
        waitForExpectations(timeout: 10)
        shot(app, "draft dismissed")
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 5), "no way back out of the chat")
        back.tap()
        let row = app.staticTexts["Dana"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20), "no Dana row on Agents")
        row.tap()
        let rest = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", ": Great. What is left?")).firstMatch
        XCTAssertTrue(rest.waitForExistence(timeout: 20), "Dana's chat did not draw again")
        XCTAssertFalse(bandText(app).exists, "the dismissed draft came back on a fresh read")
    }
}
