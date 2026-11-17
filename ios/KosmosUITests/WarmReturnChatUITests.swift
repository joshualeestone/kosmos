import XCTest

// kosmos#8055 (Josh 11-17 12:52, real iPhone): coming back to the app from another app, the open chat closed by itself
// about 2 s after the return. An open chat stays open across a return to the front: plainly, and when the connection
// reconnects with no agents yet on the way back (KOSMOS_SAMPLE_RETURN_FLIP). That flip is SYNTHETIC: it proves that
// swapping the page closes an open chat, but no real warm-return path is known to empty the list this way.
final class WarmReturnChatUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func composer(_ app: XCUIApplication) -> XCUIElement {
        // Cleo's own chat (the sample's), so a close followed by another chat opening still fails.
        app.textFields.matching(NSPredicate(format: "placeholderValue == %@", "Message Cleo")).firstMatch
    }

    private func returnKeepsTheChat(flip: Bool) {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "cleo"]
        if flip { app.launchEnvironment["KOSMOS_SAMPLE_RETURN_FLIP"] = "1" }
        app.launch()
        XCTAssertTrue(composer(app).waitForExistence(timeout: 20), "the chat did not open")
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 3)
        app.activate()
        XCTAssertTrue(composer(app).waitForExistence(timeout: 10), "the chat was not there on the return")
        // Josh's chat closed 2 s after the return; the flip ends at 1 s. Watched for 6 s.
        Thread.sleep(forTimeInterval: 6)
        // Review 3: the flip really happened, so the flip test cannot pass by not testing. For the plain return this is only a
        // sanity check (the switch is not set there, so it cannot fire).
        let fired = app.descendants(matching: .any)["sample-flip-fired"].exists
        XCTAssertEqual(fired, flip, flip ? "the reconnect with no agents never happened on the return" : "a flip happened on a plain return")
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = flip ? "after-return-flip" : "after-return"; a.lifetime = .keepAlways; add(a)
        XCTAssertTrue(composer(app).exists, "the open chat closed after the return\(flip ? " (with the brief wait)" : "")")
    }

    // Review 5: opening a chat while the page shows the first connect with no agents yet (KOSMOS_SAMPLE_REACHING) now swaps
    // the page to a list as the chat opens; the chat opens and stays. A guard against the fix's own swap, not proof of the
    // fix (it passes with the fix off too).
    func testAChatOpenedDuringTheFirstConnectStaysOpen() throws {
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "cleo", "KOSMOS_SAMPLE_REACHING": "1"]
        app.launch()
        XCTAssertTrue(composer(app).waitForExistence(timeout: 20), "the chat did not open during the first connect")
        Thread.sleep(forTimeInterval: 4)
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "opened-while-reaching"; a.lifetime = .keepAlways; add(a)
        XCTAssertTrue(composer(app).exists, "the chat opened during the first connect closed again")
    }

    func testAReturnKeepsTheOpenChat() throws { returnKeepsTheChat(flip: false) }
    func testAReturnThroughABriefWaitKeepsTheOpenChat() throws { returnKeepsTheChat(flip: true) }
}
