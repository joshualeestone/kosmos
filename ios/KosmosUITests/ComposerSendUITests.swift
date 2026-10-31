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
        XCTAssertFalse(app.buttons["composer-send"].exists, "an empty box shows no send button")
        shot(app, "empty box, \(mode)")
        field.typeText("Line one")
        let send = app.buttons["composer-send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5), "words in the box did not bring the send button")
        XCTAssertFalse(app.buttons["Dictate a message"].exists, "the microphone stayed beside the send button")
        field.typeText("\n")
        field.typeText("Line two")
        let value = (field.value as? String) ?? ""
        XCTAssertTrue(value.contains("Line one\nLine two"), "Return did not add a new line (the box reads \(value.debugDescription))")
        shot(app, "two lines, send button, \(mode)")
        send.tap()
        XCTAssertTrue(app.buttons["Dictate a message"].waitForExistence(timeout: 5), "after sending the box did not go back to the microphone")
        let left = (field.value as? String) ?? ""
        XCTAssertFalse(left.contains("Line"), "the box still holds the words after Send (it reads \(left.debugDescription))")
        // Review 2: the bubble has both lines, so the new line went out with the message.
        let bubble = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Line one", "Line two")).firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 5), "the sent message, with both lines, is not in the chat")
        shot(app, "sent, \(mode)")
    }

    // Review 2: the project room's box too (Post), where the reply @name and the room's own send path live.
    func testRoomReturnAddsALineAndPostPosts() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_TAB": "projects", "KOSMOS_SAMPLE_PROJECT": "springcatalogue"]
        app.launch()
        let field = app.textFields.matching(NSPredicate(format: "placeholderValue == 'Message Spring catalogue'")).firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 30), "no room message box")
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "no on-screen keyboard")
        XCTAssertFalse(app.buttons["composer-send"].exists, "an empty room box shows no Post button")
        field.typeText("Room one")
        let post = app.buttons["composer-send"]
        XCTAssertTrue(post.waitForExistence(timeout: 5), "words in the room box did not bring the Post button")
        field.typeText("\n")
        field.typeText("Room two")
        let value = (field.value as? String) ?? ""
        XCTAssertTrue(value.contains("Room one\nRoom two"), "Return did not add a new line in the room (the box reads \(value.debugDescription))")
        shot(app, "room, two lines, Post button")
        post.tap()
        // Review 3: the sample room keeps no post (RoomStore.post drops it in sample mode), so what can be seen is the post
        // being taken: the box empties and the microphone comes back. The chat case checks the sent bubble itself.
        XCTAssertTrue(app.buttons["Dictate a message"].waitForExistence(timeout: 5), "after Post the room box did not go back to the microphone")
        let left = (field.value as? String) ?? ""
        XCTAssertFalse(left.contains("Room"), "the room box still holds the words after Post (it reads \(left.debugDescription))")
        shot(app, "room, posted")
    }

    func testReturnAddsALineAndSendSendsLight() throws { try returnAddsALineAndSendSends(dark: false) }
    func testReturnAddsALineAndSendSendsDark() throws { try returnAddsALineAndSendSends(dark: true) }
}
