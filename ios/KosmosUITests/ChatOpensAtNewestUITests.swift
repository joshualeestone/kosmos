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
        // kosmos#7609: typed (a bubble reads as one button: it carries the sheet's action), never a search of every element: on a CI runner a query
        // over the whole 260-message tree timed out.
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", ": Message \(n) of 260.")).firstMatch
    }


    /// The chat's composer, a multi-line TextField ("Message <name>"), which XCUITest may type as a text field or a text
    /// view. It exists only while a chat is open (the search field's prompt is "Search").
    private func composer(_ app: XCUIApplication) -> XCUIElement {
        app.textFields.matching(NSPredicate(format: "placeholderValue BEGINSWITH %@", "Message ")).firstMatch
    }

    /// Wholly on screen between the top bar and the composer, not merely loaded somewhere in the list.
    private func onScreen(_ el: XCUIElement, _ app: XCUIApplication) -> (Bool, String) {
        let top = app.navigationBars.firstMatch.frame.maxY
        let box = composer(app)
        XCTAssertTrue(box.exists, "the composer was not found, so the bottom of the visible band is unknown")
        let bottom = box.frame.minY
        return (el.frame.minY >= top - 1 && el.frame.maxY <= bottom + 1, "\(el.frame), visible band \(top) to \(bottom)")
    }

    /// Waits until the list has stopped moving: a bubble's frame reads the same twice, half a second apart.
    private func waitStill(_ app: XCUIApplication) {
        let any = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", ": Message ")).firstMatch
        var last = CGRect.null
        for _ in 0..<12 {
            let now = any.exists ? any.frame : .null
            if now == last && !now.isNull { return }
            last = now
            Thread.sleep(forTimeInterval: 0.5)
        }
    }

    /// Review 2: "opens on" is strict. Once the chat is showing (its composer), the newest message must be on screen
    /// within a moment, not after a late correction.
    private func assertOpensOnNewest(_ app: XCUIApplication, _ when: String) {
        XCTAssertTrue(composer(app).waitForExistence(timeout: 20), "the chat did not open, \(when)")
        let newest = message(260, in: app)
        // 5 s, not 2: a CI runner draws far slower than a phone; a chat that opens mid-way never loads 260 at all.
        XCTAssertTrue(newest.waitForExistence(timeout: 5), "the newest message is not in the chat as it opens, \(when)")
        XCTAssertTrue(newest.label.hasPrefix("You, "), "matched something other than the newest bubble: \(newest.label)")
        waitStill(app)
        let (shown, at) = onScreen(newest, app)
        XCTAssertTrue(shown, "the newest message is not on screen, \(when): \(at)")
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = when; a.lifetime = .keepAlways; add(a)
    }

    func testALongChatOpensOnItsNewestMessageEveryTime() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "varied"]
        UIKitListArm.set(app)   // kosmos#8221: the list under test
        app.launch()
        assertOpensOnNewest(app, "first open")   // the launch opens Dana's chat

        // The control (review 2): a short drag leaves the newest message LOADED but pushed below the composer, and the
        // same check must then say it is not on screen. This is what shows the measurement itself can fail.
        let mid = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
        mid.press(forDuration: 0.1, thenDragTo: mid.withOffset(CGVector(dx: 0, dy: 300)))
        waitStill(app)
        let newest = message(260, in: app)
        XCTAssertTrue(newest.exists, "after a short drag the newest message is not loaded, so the control measures nothing")
        XCTAssertFalse(onScreen(newest, app).0, "dragged below the composer, the newest message still reads as on screen")
        let ctl = XCTAttachment(screenshot: app.screenshot()); ctl.name = "dragged down (control)"; ctl.lifetime = .keepAlways; add(ctl)

        // Then well away from the end, so the reopen below has to bring it back.
        for _ in 0..<2 { app.swipeDown(velocity: .fast) }
        waitStill(app)

        // Every time: back to Agents (the system Back button, by its identifier, not its place in the bar). Review 2: the
        // chat is proven CLOSED by its composer going (it exists only in a chat; the Agents list stays in the tree under
        // a pushed chat, so its presence proves nothing), and Dana's row must be hittable before it is tapped.
        let back = app.navigationBars.buttons.matching(NSPredicate(format: "identifier == 'BackButton' OR label == 'Back'")).firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5), "no Back button in the chat's top bar")
        back.tap()
        expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: composer(app)); waitForExpectations(timeout: 5)
        let list = app.descendants(matching: .any).matching(identifier: "agents-list").firstMatch
        let dana = list.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", "Dana")).firstMatch
        XCTAssertTrue(dana.waitForExistence(timeout: 10) && dana.isHittable, "Dana's row is not showing on the Agents list")
        let shown = XCTAttachment(screenshot: app.screenshot()); shown.name = "Agents, after Back"; shown.lifetime = .keepAlways; add(shown)
        dana.tap()
        assertOpensOnNewest(app, "second open")
    }

    // kosmos#7420 (Josh's phone, build 33, 11-03 18:51): at the newest with the keyboard up, the box grew two lines and the
    // chat went blank (content 27302 estimated against 23470 measured). The varied long chat with the small first page is
    // the sample whose estimate is inflated (measured on the simulator 11-03), so this is the case the uniform chat above
    // cannot reach. Asks what Josh lost: the newest message on screen, above the box, after the box grows two lines.
    // Here, not in KeyboardSlideUITests: the 260-message chat is too big for a CI runner to query (see ui-sample.sh), so it
    // runs on a Mac with this class. The simulator has never shown Josh's blank; it can show the newest left under the box.
    func testComposerGrowingInAVariedLongChatKeepsTheNewestOnScreen() throws {
        guard ProcessInfo.processInfo.environment["KOSMOS_UI_PLUS"] == "1" else { throw XCTSkip("set TEST_RUNNER_KOSMOS_UI_PLUS=1") }
        let app = XCUIApplication()
        app.launchEnvironment = ["KOSMOS_SAMPLE_AGENTS": "1", "KOSMOS_SAMPLE_OPEN": "dana", "KOSMOS_SAMPLE_LONG": "varied",
                                 "KOSMOS_SAMPLE_FIRSTPAGE": "1", "KOSMOS_SAMPLE_TRACE": "1", "KOSMOS_SAMPLE_HEIGHT": "1"]
        UIKitListArm.set(app)   // kosmos#8221: the list under test
        app.launch()
        let box = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 30), "no message box")
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 15), "the long chat did not open at its newest message")
        KeyboardSlideUITests.settle(newest)
        Thread.sleep(forTimeInterval: 2)   // the whole window lands a second after the small first page
        try KeyboardSlideUITests.keyboardUp(app, box, newest, shot: "varied-grow-keyboard-up", test: self)
        let h0 = box.frame.height
        for _ in 0..<4 {
            box.typeText("the catalogue pages need the new photos before Monday and the captions checked again ")
            Thread.sleep(forTimeInterval: 0.8)
        }
        XCTAssertGreaterThan(box.frame.height, h0 + 40, "the message box did not grow by at least two lines")
        Thread.sleep(forTimeInterval: 1.5)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "varied-grow-after"; shot.lifetime = .keepAlways; add(shot)
        XCTAssertTrue(newest.exists, "the newest message is no longer drawn after the box grew (the blank list)")
        let f = newest.frame
        XCTAssertTrue(f.maxY <= box.frame.minY + 2 && f.minY >= app.navigationBars.firstMatch.frame.maxY - 1,
                      "the newest message is not on screen above the box after it grew: message \(Int(f.minY))-\(Int(f.maxY)), box top \(Int(box.frame.minY))")
        // Josh's screenshot (18:52) was taken just after sending: the box back to one empty line, the chat blank. So send
        // (the box shrinks and a new row lands) and ask that the sent message is on screen above the box.
        let send = app.buttons["composer-send"]
        XCTAssertTrue(send.waitForExistence(timeout: 5), "no send button with words in the box")
        send.tap()
        XCTAssertTrue(app.buttons["Dictate a message"].waitForExistence(timeout: 5), "after sending the box did not go back to the microphone")
        Thread.sleep(forTimeInterval: 1.5)
        let after = XCTAttachment(screenshot: app.screenshot()); after.name = "varied-grow-sent"; after.lifetime = .keepAlways; add(after)
        let sent = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "captions checked again")).firstMatch
        XCTAssertTrue(sent.waitForExistence(timeout: 5), "the sent message is not drawn after sending (the blank list)")
        let g = sent.frame
        XCTAssertTrue(g.maxY <= box.frame.minY + 2 && g.minY >= app.navigationBars.firstMatch.frame.maxY - 1,
                      "the sent message is not on screen above the box: message \(Int(g.minY))-\(Int(g.maxY)), box top \(Int(box.frame.minY))")
    }
}
