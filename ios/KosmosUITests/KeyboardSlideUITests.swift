import XCTest

// kosmos#7344: with the conversation at its newest message, bringing the keyboard up keeps that message visible above
// the message box; a conversation read higher up stays where it was. Sample agents (a Debug build), Dana's chat.
// Run by ios/tools/ui-keyboard.sh on a fresh simulator, and in CI by the ios workflow's "ui tests (sample board)" job (ios/tools/ui-sample.sh, kosmos#7609).
final class KeyboardSlideUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    // Dana's short chat opens at its newest message by itself.
    func testNewestStaysAboveTheBoxWhenTheKeyboardComesUp() throws {
        let app = Self.launch([:])
        let box = Self.box(app)
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Pages 9 to 12 need the new photos'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 10), "Dana's newest message did not show")
        Self.settle(newest)
        // Control: before the keyboard, the newest message ends above the box.
        XCTAssertLessThanOrEqual(newest.frame.maxY, box.frame.minY, "the newest message was not above the box before the keyboard")
        try Self.keyboardUp(app, box, newest, shot: "short-keyboard-up", test: self)
        Self.assertAbove(newest, box, app.keyboards.firstMatch)
    }

    // A long chat (KOSMOS_SAMPLE_LONG, 260 rows) at its newest message, after the reader's own scrolling. The chat opens at
    // its newest message; the swipes past its end are a person's scroll coming to rest there, which is what the chat reads
    // "at the newest message" from. A run without them left the defect unseen (10-30 control run), so keep them.
    func testLongChatNewestStaysAboveTheBox() throws {
        let app = Self.launch(["KOSMOS_SAMPLE_LONG": "1"])
        let box = Self.box(app)
        for _ in 0..<6 { app.swipeUp(velocity: .fast) }
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 10), "the swipes did not reach the newest message")
        Self.settle(newest)
        XCTAssertLessThanOrEqual(newest.frame.maxY, box.frame.minY, "the newest message was not above the box before the keyboard")
        try Self.keyboardUp(app, box, newest, shot: "long-keyboard-up", test: self)
        Self.assertAbove(newest, box, app.keyboards.firstMatch)
    }

    // kosmos#7420 (build 24): a list found empty within its content at the newest message is rebuilt, opened at its end.
    // KOSMOS_SAMPLE_REBUILD runs that recovery 3 s after opening (its marker shows only if the list was rebuilt exactly once); the cause
    // (rows not drawn within the content, on a phone) is not reproduced here. After it, the chat still opens at its newest
    // message above the box, and keeps it there when the keyboard comes up.
    func testRebuiltListShowsTheNewestMessage() throws {
        let app = Self.launch(["KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_REBUILD": "1", "KOSMOS_SAMPLE_TRACE": "1"])
        let box = Self.box(app)
        let rebuilt = app.descendants(matching: .any).matching(identifier: "sample-rebuilt").firstMatch
        XCTAssertTrue(rebuilt.waitForExistence(timeout: 30), "the list was not rebuilt exactly once (never, or its own gap read as empty again)")
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 10) && newest.isHittable, "the rebuilt list did not show the newest message")
        Self.settle(newest)
        XCTAssertLessThanOrEqual(newest.frame.maxY, box.frame.minY, "the newest message was not above the box after the rebuild")
        try Self.keyboardUp(app, box, newest, shot: "rebuilt-keyboard-up", test: self)
        Self.assertAbove(newest, box, app.keyboards.firstMatch)
    }

    // kosmos#7420 (build 24, Josh's second report): the same empty-within failure on a SHORT chat (13 messages), so the
    // rebuild is checked on Dana's short sample chat too: its newest message above the box after one rebuild.
    func testRebuiltShortChatShowsTheNewestMessage() throws {
        let app = Self.launch(["KOSMOS_SAMPLE_REBUILD": "1", "KOSMOS_SAMPLE_TRACE": "1"])
        let box = Self.box(app)
        let rebuilt = app.descendants(matching: .any).matching(identifier: "sample-rebuilt").firstMatch
        XCTAssertTrue(rebuilt.waitForExistence(timeout: 30), "the short chat was not rebuilt exactly once")
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Pages 9 to 12 need the new photos'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 10) && newest.isHittable, "the rebuilt short chat did not show its newest message")
        Self.settle(newest)
        XCTAssertLessThanOrEqual(newest.frame.maxY, box.frame.minY, "the newest message was not above the box after the rebuild")
        try Self.keyboardUp(app, box, newest, shot: "rebuilt-short-keyboard-up", test: self)
        Self.assertAbove(newest, box, app.keyboards.firstMatch)
    }

    // The other half of the spec: a chat read higher up is not pulled to the newest message. KOSMOS_SAMPLE_SCROLLUP moves
    // the reader up the thread 3 s after opening, as a reader's own scroll does.
    func testReadHigherUpStaysWhereItWas() throws {
        let app = Self.launch(["KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_SCROLLUP": "40", "KOSMOS_SAMPLE_TRACE": "1"])
        let box = Self.box(app)
        let rows = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message ' AND label ENDSWITH ' of 260.'"))
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 15), "no sample rows")
        // The chat opens at its newest message; the hook's scroll up has happened once that has left the screen.
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false OR isHittable == false"), object: newest)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 15), .completed, "the scroll up never moved the reader off the newest message")
        // Tap only after the hook has told the chat the reader moved up: its marker shows then (kosmos#7609).
        let rested = app.descendants(matching: .any).matching(identifier: "sample-scroll-rested").firstMatch
        XCTAssertTrue(rested.waitForExistence(timeout: 30), "the sample scroll-up never came to rest")
        Self.settle(rows.firstMatch)
        // The highest row on screen below the header, by its own label so it can be found again after the keyboard.
        let header = app.navigationBars.firstMatch.frame.maxY   // rows under the top bar are not the reader's place
        guard let top = rows.allElementsBoundByIndex.filter({ $0.isHittable && $0.frame.minY > header }).min(by: { $0.frame.minY < $1.frame.minY }) else {
            XCTFail("no row on screen after the scroll up"); return
        }
        let label = top.label, y0 = top.frame.minY
        let row = app.staticTexts[label]
        try Self.keyboardUp(app, box, row, shot: "read-higher-keyboard-up", test: self)
        XCTAssertTrue(row.exists && row.isHittable, "'\(label)', read higher up, left the screen when the keyboard came up")
        XCTAssertEqual(row.frame.minY, y0, accuracy: 4, "'\(label)' moved from \(y0) to \(row.frame.minY)")
        XCTAssertFalse(newest.exists && newest.isHittable, "the reader was pulled down to the newest message")
    }

    private static func launch(_ env: [String: String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        for (k, v) in env { app.launchEnvironment[k] = v }
        app.launch()
        return app
    }

    // The message box by its own label (ChatView's composer), whatever kind of element it is drawn as.
    private static func box(_ app: XCUIApplication) -> XCUIElement {
        let box = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Message Dana'")).firstMatch
        XCTAssertTrue(box.waitForExistence(timeout: 30), "no message box")
        return box
    }

    // Until the element's frame reads the same twice, 0.5 s apart (at most 8 s): a scroll or the keyboard has finished.
    static func settle(_ e: XCUIElement) {
        guard e.exists else { return }   // gone already: the caller's own assertion says what that means
        var last = e.frame
        for _ in 0..<16 {
            Thread.sleep(forTimeInterval: 0.5)
            guard e.exists else { return }
            let now = e.frame
            if now == last { return }
            last = now
        }
    }

    static func keyboardUp(_ app: XCUIApplication, _ box: XCUIElement, _ watch: XCUIElement, shot: String, test: XCTestCase) throws {
        box.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "no on-screen keyboard (is a hardware keyboard connected?)")
        settle(app.keyboards.firstMatch)
        settle(watch)
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = shot; a.lifetime = .keepAlways; test.add(a)
    }

    static func assertAbove(_ message: XCUIElement, _ box: XCUIElement, _ keyboard: XCUIElement) {
        XCTAssertLessThanOrEqual(message.frame.maxY, min(box.frame.minY, keyboard.frame.minY),
                                 "the newest message is hidden: it ends at \(message.frame.maxY), the box starts at \(box.frame.minY), the keyboard at \(keyboard.frame.minY)")
    }
}
