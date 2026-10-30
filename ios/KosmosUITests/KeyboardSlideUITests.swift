import XCTest

// kosmos#7344: with the conversation at its newest message, bringing the keyboard up keeps that message visible above
// the message box. Sample agents (a Debug build): Dana's short chat opens at its newest message by itself.
final class KeyboardSlideUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testNewestStaysAboveTheBoxWhenTheKeyboardComesUp() throws {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        app.launchEnvironment["KOSMOS_SAMPLE_TRACE"] = "1"
        app.launch()
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Pages 9 to 12 need the new photos'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 30), "Dana's newest message did not show")
        let field = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10), "no message box")
        sleep(2)
        // Control: before the keyboard, the newest message ends above the box.
        XCTAssertLessThanOrEqual(newest.frame.maxY, field.frame.minY, "the newest message was not above the box before the keyboard")
        field.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "no on-screen keyboard (is a hardware keyboard connected?)")
        sleep(2)
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "keyboard-up"; a.lifetime = .keepAlways; add(a)
        // The box's own frame: a text view inside a taller capsule, so compare with the keyboard's top too.
        XCTAssertLessThanOrEqual(newest.frame.maxY, min(field.frame.minY, keyboard.frame.minY),
                                 "the newest message is hidden behind the box or keyboard: message ends at \(newest.frame.maxY), box starts at \(field.frame.minY), keyboard at \(keyboard.frame.minY)")
    }

    // A long chat (KOSMOS_SAMPLE_LONG, 260 rows) that the reader has scrolled down to its newest message: the same. Reached
    // by the reader's own swipes, as on the phone; a run that skips them left the bug unseen (10-30 control run).
    func testLongChatNewestStaysAboveTheBox() throws {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        app.launchEnvironment["KOSMOS_SAMPLE_LONG"] = "1"
        app.launch()
        let field = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 30), "no message box")
        sleep(3)
        for _ in 0..<6 { app.swipeUp(velocity: .fast) }
        sleep(3)
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(newest.exists, "the swipes did not reach the newest message")
        // Control: before the keyboard, the newest message ends above the box.
        XCTAssertLessThanOrEqual(newest.frame.maxY, field.frame.minY, "the newest message was not above the box before the keyboard")
        field.tap()
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 10), "no on-screen keyboard")
        sleep(2)
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "long-keyboard-up"; a.lifetime = .keepAlways; add(a)
        XCTAssertLessThanOrEqual(newest.frame.maxY, min(field.frame.minY, keyboard.frame.minY),
                                 "the newest message is hidden: it ends at \(newest.frame.maxY), the box starts at \(field.frame.minY)")
    }

    // The other half of the spec: a chat read higher up stays where it was when the keyboard comes up (it is not pulled
    // to the newest message). KOSMOS_SAMPLE_SCROLLUP puts the 40th row from the end at the top, as a reader's scroll does.
    func testReadHigherUpStaysWhereItWas() throws {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        app.launchEnvironment["KOSMOS_SAMPLE_LONG"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_SCROLLUP"] = "40"
        app.launch()
        let field = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 30), "no message box")
        sleep(6)
        let top = Self.highestMessage(app)
        XCTAssertNotNil(top, "no message on screen")
        let label = top!.label, y0 = top!.frame.minY
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "no on-screen keyboard")
        sleep(2)
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "read-higher-keyboard-up"; a.lifetime = .keepAlways; add(a)
        let after = app.staticTexts[label]
        XCTAssertTrue(after.exists && after.isHittable, "'\(label)', read higher up, left the screen when the keyboard came up")
        XCTAssertEqual(after.frame.minY, y0, accuracy: 4, "'\(label)' moved from \(y0) to \(after.frame.minY)")
    }

    private static func highestMessage(_ app: XCUIApplication) -> XCUIElement? {
        var best: XCUIElement?; var by = CGFloat.greatestFiniteMagnitude
        for t in app.staticTexts.allElementsBoundByIndex where (t.label.hasPrefix("Message ") || t.label.count > 30) && t.isHittable {
            let f = t.frame; if f.minY > 120 && f.minY < by { best = t; by = f.minY }
        }
        return best
    }
}
