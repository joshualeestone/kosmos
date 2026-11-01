import XCTest

// kosmos#7678 (Josh 10-31): with the keyboard up, a long press on a message opens its actions in the chat (a panel beside
// the message) and the keyboard stays: the pressed message does not move. Sample agents only (a Debug build): Dana's chat,
// pressing Dana's first message (the second of four, not the newest). Opt-in with TEST_RUNNER_KOSMOS_UI_PLUS=1, as the other
// sample-board UI tests are. TEST_RUNNER_KOSMOS_LP_CONTROL=1 launches with KOSMOS_SAMPLE_NOPANEL=1 (the sheet as before,
// lowering the keyboard): testKeyboardStaysAndMessageHolds must then fail, which shows it can.
final class LongPressKeyboardUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }

    private func launch(_ sample: [String: String] = ["KOSMOS_SAMPLE_OPEN": "dana"]) throws -> XCUIApplication {
        let env = ProcessInfo.processInfo.environment
        guard env["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1"].merging(sample) { _, new in new }
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
        assertAllAboveKeyboard(app, "Copy text")
        XCTAssertLessThan(abs(app.buttons["Reply"].frame.minY - message.frame.maxY), 160, "the panel is not beside the pressed message")
        XCTAssertTrue(app.descendants(matching: .any)["messageActionsPanel"].exists, "the actions opened as the sheet, not the in-chat panel")
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

    // Measures (does not judge) whether the Delete question, a system alert, lowers the keyboard: printed as MEASURE for the
    // run log. Keep it closes the question; the message stays.
    func testDeleteQuestionWithTheKeyboardUp() throws {
        let app = try launch()
        let mine = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", ": Great. What is left?")).firstMatch
        XCTAssertTrue(mine.waitForExistence(timeout: 20), "the person's message is not in the chat")
        try KeyboardSlideUITests.keyboardUp(app, box(app), mine, shot: "keyboard up", test: self)
        mine.press(forDuration: 0.8)
        let delete = app.buttons["Delete message"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5), "no Delete on the person's own message")
        delete.tap()
        XCTAssertTrue(app.buttons["Keep it"].waitForExistence(timeout: 5), "Delete did not ask first")
        shot(app, "delete question, keyboard up")
        print("MEASURE delete-question keyboard-up-while-asking=\(app.keyboards.firstMatch.exists)")
        app.buttons["Keep it"].tap()
        XCTAssertTrue(app.buttons["Keep it"].waitForNonExistence(timeout: 5), "the question did not close")
        Thread.sleep(forTimeInterval: 1)
        print("MEASURE delete-question keyboard-up-after-keep-it=\(app.keyboards.firstMatch.exists)")
        XCTAssertTrue(app.keyboards.firstMatch.exists, "the keyboard did not come back after Keep it")
        XCTAssertTrue(mine.exists, "Keep it removed the message")
    }

    // Review 1: the question is the host's, so its Delete has its own path: it must delete the pressed message.
    func testDeleteConfirmedWithTheKeyboardUp() throws {
        let app = try launch()
        let mine = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", ": Great. What is left?")).firstMatch
        XCTAssertTrue(mine.waitForExistence(timeout: 20), "the person's message is not in the chat")
        try KeyboardSlideUITests.keyboardUp(app, box(app), mine, shot: "keyboard up", test: self)
        mine.press(forDuration: 0.8)
        let delete = app.buttons["Delete message"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5), "no Delete on the person's own message")
        delete.tap()
        let yes = app.alerts.buttons["Delete"].firstMatch
        XCTAssertTrue(yes.waitForExistence(timeout: 5), "Delete did not ask first")
        yes.tap()
        XCTAssertTrue(mine.waitForNonExistence(timeout: 10), "confirming Delete left the message")
    }

    // Review 2: the last row is reachable, not only present: Reply existing behind the keyboard would pass exists.
    private func assertAllAboveKeyboard(_ app: XCUIApplication, _ last: String, line: UInt = #line) {
        let row = app.buttons[last]
        XCTAssertTrue(row.exists, "no \(last)", line: line)
        XCTAssertTrue(row.isHittable, "\(last) cannot be reached", line: line)
        XCTAssertLessThanOrEqual(row.frame.maxY, app.keyboards.firstMatch.frame.minY, "\(last) is behind the keyboard", line: line)
    }

    // Review 2: More closes the panel and lowers the keyboard, or the sheet rises behind it (#7530).
    func testMoreFromThePanelLowersTheKeyboard() throws {
        let app = try launch()
        let message = pressed(app)
        try KeyboardSlideUITests.keyboardUp(app, box(app), message, shot: "keyboard up", test: self)
        message.press(forDuration: 0.8)
        let more = app.buttons["More reactions"]
        XCTAssertTrue(more.waitForExistence(timeout: 5), "no More in the panel")
        XCTAssertTrue(app.descendants(matching: .any)["messageActionsPanel"].exists, "the actions opened as the sheet, not the panel")
        more.tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 5), .completed, "More left the keyboard up")
        XCTAssertTrue(app.staticTexts["Reactions"].waitForExistence(timeout: 5), "the full list did not open")
        XCTAssertFalse(app.descendants(matching: .any)["messageActionsPanel"].exists, "the panel stayed open under the sheet")
    }

    // Review 1: the room has its own list and box, so the panel is checked there too.
    func testRoomKeyboardStaysAndPanelOpens() throws {
        let app = try launch(["KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"])
        let field = app.textFields.matching(NSPredicate(format: "label == 'Post to everyone on this project'")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 30), "no room message box")
        let post = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "start on 9 to 12")).firstMatch   // the person's own post, on screen: the keyboard keeps the newest posts in view
        XCTAssertTrue(post.waitForExistence(timeout: 15), "the person's post is not in the room")
        field.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "no on-screen keyboard")
        KeyboardSlideUITests.settle(post)
        let before = post.frame
        shot(app, "room, keyboard up, before the press")
        print("MEASURE room-press post=\(post.frame) keyboardTop=\(keyboard.frame.minY) hittable=\(post.isHittable) press-at=\(post.frame.midY)")
        XCTAssertLessThanOrEqual(post.frame.midY, keyboard.frame.minY, "the post's middle is behind the keyboard: the press would land on the keyboard")
        post.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)).press(forDuration: 0.8)   // its lower part: on a small phone the top can sit under the banner
        XCTAssertTrue(app.buttons["Reply"].waitForExistence(timeout: 5), "the actions did not open")
        KeyboardSlideUITests.settle(post)
        shot(app, "room, actions open, keyboard up")
        XCTAssertTrue(keyboard.exists, "the long press lowered the keyboard")
        XCTAssertEqual(post.frame.minY, before.minY, accuracy: 1, "the post moved")
        XCTAssertTrue(app.descendants(matching: .any)["messageActionsPanel"].exists, "the room opened the sheet, not the panel")
    }

    // The control: with the keyboard down, the long press opens the sheet as before (#7419), not the panel.
    func testKeyboardDownStillOpensTheSheet() throws {
        let app = try launch()
        let message = pressed(app)
        // Up and down first: a keyboard that has gone must read as gone (review 2: never raising it could not fail).
        try KeyboardSlideUITests.keyboardUp(app, box(app), message, shot: "keyboard up", test: self)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.97)))
        let down = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        XCTAssertEqual(XCTWaiter().wait(for: [down], timeout: 5), .completed, "the keyboard did not go down")
        KeyboardSlideUITests.settle(message)
        message.press(forDuration: 0.8)
        XCTAssertTrue(app.buttons["Reply"].waitForExistence(timeout: 5), "the sheet did not open")
        XCTAssertFalse(app.descendants(matching: .any)["messageActionsPanel"].exists, "the panel opened with the keyboard down")
        shot(app, "keyboard down: the sheet")
    }
}
