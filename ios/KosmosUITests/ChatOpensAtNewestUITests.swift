import XCTest

// kosmos#7265: a Direct Message opens on its newest message, every time, however long the chat. Josh's done-line: "a DM
// with 200+ messages opens on its newest message". Measured on the sample board's long chat (KOSMOS_SAMPLE_LONG=varied:
// 220 messages of varied length, 40 more before them), which is what threw a one-time jump short. Opt-in, with
// TEST_RUNNER_KOSMOS_UI_PLUS=1, as AttachMenuUITests is.
final class ChatOpensAtNewestUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func message(_ n: Int, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Message \(n) of 260.")).firstMatch
    }

    /// Wholly on screen between the top bar and the composer, not merely loaded somewhere in the list.
    private func assertShown(_ el: XCUIElement, _ app: XCUIApplication, _ what: String) {
        XCTAssertTrue(el.waitForExistence(timeout: 15), "\(what) is not in the chat at all")
        let top = app.navigationBars.firstMatch.frame.maxY
        let composer = app.textViews.firstMatch
        let bottom = composer.exists ? composer.frame.minY : app.windows.firstMatch.frame.maxY
        // A moment for any settling scroll, then the frame is read where it rests.
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(el.frame.minY >= top - 1 && el.frame.maxY <= bottom + 1,
                      "\(what) is not on screen: \(el.frame), visible band \(top) to \(bottom)")
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    func testALongChatOpensOnItsNewestMessageEveryTime() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "varied"]
        app.launch()

        // First open (the launch opens Dana's chat).
        assertShown(message(260, in: app), app, "the newest message, first open")
        shot(app, "first open")
        // The control: a message well above it is loaded but NOT on screen, so "shown" above means the chat sits at the
        // end, not that the whole chat happens to fit.
        let older = message(250, in: app)
        XCTAssertFalse(older.exists && older.isHittable, "an older message is on screen too, so the check cannot tell the end from the middle")

        // Every time: back to Agents, open Dana again.
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let dana = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Dana")).firstMatch
        XCTAssertTrue(dana.waitForExistence(timeout: 10), "Dana is not on the Agents list")
        dana.tap()
        assertShown(message(260, in: app), app, "the newest message, second open")
        shot(app, "second open")
    }
}
