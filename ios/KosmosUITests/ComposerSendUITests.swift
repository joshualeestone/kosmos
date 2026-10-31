import XCTest

// kosmos#7687 (Josh 10-31): in the message box, Return adds a new line and a send button takes the microphone's place once
// there is something to send. Sample agents only (a Debug build): Dana's chat. Opt-in with TEST_RUNNER_KOSMOS_UI_PLUS=1, as
// the other sample-board UI tests are. Screenshots in light and dark are the design shots.
final class ComposerSendUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    override func tearDown() { XCUIDevice.shared.appearance = .light; super.tearDown() }

    private func launch(dark: Bool) throws -> XCUIApplication {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        XCUIDevice.shared.appearance = dark ? .dark : .light
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana"]
        app.launch()
        return app
    }

    private func box(_ app: XCUIApplication) -> XCUIElement {
        let b = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
        XCTAssertTrue(b.waitForExistence(timeout: 30), "no message box")
        return b
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    private func returnAddsALineAndSendSends(dark: Bool) throws {
        let app = try launch(dark: dark)
        let field = box(app)
        let mode = dark ? "dark" : "light"
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "no on-screen keyboard")
        XCTAssertTrue(app.buttons["Dictate a message"].exists, "an empty box shows the microphone")
        XCTAssertFalse(app.buttons["Send"].exists, "an empty box shows no send button")
        shot(app, "empty box, \(mode)")
        field.typeText("Line one")
        let send = app.buttons["Send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5), "words in the box did not bring the send button")
        XCTAssertFalse(app.buttons["Dictate a message"].exists, "the microphone stayed beside the send button")
        field.typeText("\n")
        field.typeText("Line two")
        let value = (field.value as? String) ?? ""
        XCTAssertTrue(value.contains("Line one\nLine two"), "Return did not add a new line (the box reads \(value.debugDescription))")
        shot(app, "two lines, send button, \(mode)")
        Thread.sleep(forTimeInterval: 0.6)   // past the button's first moment (it takes no tap then)
        send.tap()
        XCTAssertTrue(app.buttons["Dictate a message"].waitForExistence(timeout: 5), "after sending the box did not go back to the microphone")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Line one")).firstMatch.waitForExistence(timeout: 5),
                      "the sent message is not in the chat")
        shot(app, "sent, \(mode)")
    }

    func testReturnAddsALineAndSendSendsLight() throws { try returnAddsALineAndSendSends(dark: false) }
    func testReturnAddsALineAndSendSendsDark() throws { try returnAddsALineAndSendSends(dark: true) }
}
