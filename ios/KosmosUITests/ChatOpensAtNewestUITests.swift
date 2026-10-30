import XCTest

// kosmos#7265: a Direct Message opens on its newest message, every time, however long the chat. Josh's done-line: "a DM
// with 200+ messages opens on its newest message". Measured on the sample board's long chat (KOSMOS_SAMPLE_LONG=varied:
// 220 messages of varied length, 40 more before them), which is what threw a one-time jump short. Opt-in, with
// TEST_RUNNER_KOSMOS_UI_PLUS=1, as AttachMenuUITests is.
final class ChatOpensAtNewestUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    /// The bubble itself: a bubble reads as one element, "<who>, <time>: <text>" (ChatView's spoken label), so its label
    /// is matched after the colon, never a bare text inside it or anything that merely starts with the words.
    private func message(_ n: Int, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", ": Message \(n) of 260.")).firstMatch
    }

    /// Wholly on screen between the top bar and the composer, not merely loaded somewhere in the list.
    private func onScreen(_ el: XCUIElement, _ app: XCUIApplication) -> (Bool, String) {
        let top = app.navigationBars.firstMatch.frame.maxY
        // The composer is a multi-line TextField ("Message <name>"), which XCUITest may type as a text field or a text view.
        let composer = app.descendants(matching: .any)
            .matching(NSPredicate(format: "(elementType == %d OR elementType == %d) AND placeholderValue BEGINSWITH %@",
                                  XCUIElement.ElementType.textField.rawValue, XCUIElement.ElementType.textView.rawValue, "Message ")).firstMatch
        XCTAssertTrue(composer.exists, "the composer was not found, so the bottom of the visible band is unknown")
        let bottom = composer.frame.minY
        return (el.frame.minY >= top - 1 && el.frame.maxY <= bottom + 1, "\(el.frame), visible band \(top) to \(bottom)")
    }

    private func assertNewestShown(_ app: XCUIApplication, _ when: String) {
        let newest = message(260, in: app)
        XCTAssertTrue(newest.waitForExistence(timeout: 15), "the newest message is not in the chat at all, \(when)")
        XCTAssertTrue(newest.label.hasPrefix("You, "), "matched something other than the newest bubble: \(newest.label)")
        Thread.sleep(forTimeInterval: 1.5)   // any settling scroll, then the frame is read where it rests
        let (shown, at) = onScreen(newest, app)
        XCTAssertTrue(shown, "the newest message is not on screen, \(when): \(at)")
        // The control: a message well above it is LOADED but not on screen, so "shown" means the chat sits at its end,
        // not that the whole chat fits.
        let older = message(250, in: app)
        XCTAssertTrue(older.exists, "message 250 is not loaded, so the control cannot tell the end from the middle")
        XCTAssertFalse(onScreen(older, app).0, "message 250 is on screen too, \(when)")
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = when; a.lifetime = .keepAlways; add(a)
    }

    func testALongChatOpensOnItsNewestMessageEveryTime() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "varied"]
        app.launch()
        assertNewestShown(app, "first open")   // the launch opens Dana's chat

        // Every time: back to Agents (the system Back button, found by its identifier, not its place in the bar), the chat
        // gone and the Agents list showing, then Dana's ROW in that list, never one of her bubbles.
        let back = app.navigationBars.buttons.matching(NSPredicate(format: "identifier == 'BackButton' OR label == 'Back'")).firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5), "no Back button in the chat's top bar")
        back.tap()
        let list = app.descendants(matching: .any).matching(identifier: "agents-list").firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 10), "the Agents list did not come back")
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: message(260, in: app)); waitForExpectations(timeout: 5)   // the chat closed
        let dana = list.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Dana")).firstMatch
        XCTAssertTrue(dana.waitForExistence(timeout: 10), "Dana's row is not on the Agents list")
        dana.tap()
        assertNewestShown(app, "second open")
    }
}
