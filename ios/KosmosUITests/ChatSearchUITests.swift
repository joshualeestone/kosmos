import XCTest

// kosmos#8221 slice 2: searching a chat, on both lists (UIKitListArm). A search shows only the loaded messages it matches,
// with the newest match on screen; one with no match says so; clearing it brings the whole conversation back at the newest
// message. KOSMOS_SAMPLE_LONG: Dana's chat is "Message 41 of 260." to "Message 260 of 260.", so "Message 15" matches
// exactly 150 to 159.
// On the lazy list this failed 3 runs in 7 on 11-08 (#8221): the list drew nothing under the search, and its blank recovery
// is off while searching (Board.listBlank). That red is the lazy list's blank, not this check.
final class ChatSearchUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    private static func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        app.launchEnvironment["KOSMOS_SAMPLE_LONG"] = "1"
        UIKitListArm.set(app)   // kosmos#8221: the list under test
        app.launch()
        return app
    }

    private static func message(_ app: XCUIApplication, _ n: Int) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Message \(n) of 260")).firstMatch
    }

    private static func gone(_ e: XCUIElement, _ timeout: TimeInterval = 5) -> Bool {
        let x = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: e)
        return XCTWaiter().wait(for: [x], timeout: timeout) == .completed
    }

    func testASearchShowsItsMatchesAtTheNewestAndClearingBringsTheChatBack() {
        let app = Self.launch()
        let newest = Self.message(app, 260)
        XCTAssertTrue(newest.waitForExistence(timeout: 20), "CONTROL: the long chat did not open at its newest message")
        KeyboardSlideUITests.settle(newest)

        app.buttons["Search this conversation"].firstMatch.tap()
        let field = app.textFields["Search this conversation"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "no search field after the search button")
        // The field is focused a turn after it shows: type only once the keyboard is up.
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "no keyboard for the search field")
        field.typeText("Message 15")
        XCTAssertTrue(Self.gone(newest), "Message 260 still drawn under a search it does not match")
        let last = Self.message(app, 159)
        XCTAssertTrue(last.waitForExistence(timeout: 5), "Message 159, the newest match, is not drawn")
        KeyboardSlideUITests.settle(last)
        XCTAssertTrue(last.isHittable, "Message 159, the newest match, is not on screen")
        XCTAssertFalse(Self.message(app, 160).exists, "Message 160 drawn under a search it does not match")
        XCTAssertFalse(Self.message(app, 149).exists, "Message 149 drawn under a search it does not match")
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "search-matches"; shot.lifetime = .keepAlways; add(shot)

        // No match: the line says so, and nothing else is drawn.
        field.typeText("9x")
        let none = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Nothing here matches'")).firstMatch
        XCTAssertTrue(none.waitForExistence(timeout: 5), "no 'Nothing here matches' line for a search with no match")
        XCTAssertTrue(Self.gone(last), "Message 159 still drawn under a search it no longer matches")

        // Cleared: the whole conversation, at its newest message.
        app.buttons["Clear the search"].firstMatch.tap()
        XCTAssertTrue(newest.waitForExistence(timeout: 8), "Message 260 did not come back after the search was cleared")
        KeyboardSlideUITests.settle(newest)
        XCTAssertTrue(newest.isHittable, "the chat did not come back at its newest message after the search was cleared")
        XCTAssertFalse(none.exists, "the no-match line stayed after the search was cleared")
    }
}
