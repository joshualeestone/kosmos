import XCTest

// kosmos#7678 (Josh 10-31): with the keyboard up, a long press on a message opens its actions in the chat (a panel beside
// the message) and the keyboard stays: the pressed message does not move. Sample agents only (a Debug build): Dana's chat,
// pressing Dana's first message (the second of four, not the newest). Opt-in with TEST_RUNNER_KOSMOS_UI_PLUS=1, as the other
// sample-board UI tests are. TEST_RUNNER_KOSMOS_LP_CONTROL=1 launches with KOSMOS_SAMPLE_NOPANEL=1 (the sheet as before,
// lowering the keyboard): testKeyboardStaysAndMessageHolds must then fail, which shows it can.
final class LongPressKeyboardUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func launch() throws -> XCUIApplication {
        let env = ProcessInfo.processInfo.environment
        guard env["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana"]
        if env["KOSMOS_LP_CONTROL"] == "1" { app.launchEnvironment["KOSMOS_SAMPLE_NOPANEL"] = "1" }
        app.launch()
        return app
    }

    private func pressed(_ app: XCUIApplication) -> XCUIElement {
        let m = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", ": Pages 1 to 8 are written")).firstMatch
        XCTAssertTrue(m.waitForExistence(timeout: 20), "Dana's first message is not in the chat")
        return m
    }

    private func box(_ app: XCUIApplication) -> XCUIElement {
        let b = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
        XCTAssertTrue(b.waitForExistence(timeout: 30), "no message box")
        return b
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }

    func testKeyboardStaysAndMessageHolds() throws {
        let app = try launch()
        let message = pressed(app)
        let keyboard = app.keyboards.firstMatch
        try KeyboardSlideUITests.keyboardUp(app, box(app), message, shot: "keyboard up", test: self)
        let before = message.frame
        message.press(forDuration: 0.8)
        XCTAssertTrue(app.buttons["Reply"].waitForExistence(timeout: 5), "the actions did not open")
        KeyboardSlideUITests.settle(message)
        shot(app, "actions open, keyboard up")
        XCTAssertTrue(keyboard.exists, "the long press lowered the keyboard")
        XCTAssertTrue(app.otherElements["messageActionsPanel"].exists, "the actions opened as the sheet, not the in-chat panel")
        XCTAssertEqual(message.frame.minY, before.minY, accuracy: 1, "the pressed message moved: \(before.minY) to \(message.frame.minY)")
        // A tap on the dim, above the panel, closes it: the keyboard and the message still where they were.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
        XCTAssertTrue(app.buttons["Reply"].waitForNonExistence(timeout: 5), "a tap on the dim did not close the actions")
        KeyboardSlideUITests.settle(message)
        shot(app, "closed")
        XCTAssertTrue(keyboard.exists, "closing the actions lowered the keyboard")
        XCTAssertEqual(message.frame.minY, before.minY, accuracy: 1, "closing moved the message: \(before.minY) to \(message.frame.minY)")
    }

    // Copy text from the panel copies and closes it, with the keyboard still up.
    func testCopyFromThePanelKeepsTheKeyboard() throws {
        let app = try launch()
        let message = pressed(app)
        try KeyboardSlideUITests.keyboardUp(app, box(app), message, shot: "keyboard up", test: self)
        message.press(forDuration: 0.8)
        let copy = app.buttons["Copy text"]
        XCTAssertTrue(copy.waitForExistence(timeout: 5), "no Copy text")
        copy.tap()
        XCTAssertTrue(copy.waitForNonExistence(timeout: 5), "Copy text did not close the actions")
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Copy text lowered the keyboard")
    }

    // The control: with the keyboard down, the long press opens the sheet as before (#7419), not the panel.
    func testKeyboardDownStillOpensTheSheet() throws {
        let app = try launch()
        let message = pressed(app)
        message.press(forDuration: 0.8)
        XCTAssertTrue(app.buttons["Reply"].waitForExistence(timeout: 5), "the sheet did not open")
        XCTAssertFalse(app.otherElements["messageActionsPanel"].exists, "the panel opened with the keyboard down")
        shot(app, "keyboard down: the sheet")
    }
}
