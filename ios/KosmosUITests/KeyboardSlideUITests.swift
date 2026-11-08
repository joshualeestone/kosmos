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
    // KOSMOS_SAMPLE_REBUILD runs that recovery 3 s after opening (its marker carries how many rebuilds there were); the cause
    // (rows not drawn within the content, on a phone) is not reproduced here. After it, the chat still opens at its newest
    // message above the box, and keeps it there when the keyboard comes up.
    func testRebuiltListShowsTheNewestMessage() throws {
        if UIKitListArm.on { throw XCTSkip("the UIKit list never rebuilds (kosmos#8221); the rebuild belongs to the lazy list") }
        let app = Self.launch(["KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_REBUILD": "1", "KOSMOS_SAMPLE_TRACE": "1"])
        let box = Self.box(app)
        let rebuilt = app.descendants(matching: .any).matching(identifier: "sample-rebuilt").firstMatch
        Self.assertRebuiltOnce(rebuilt, "the list")
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
        if UIKitListArm.on { throw XCTSkip("the UIKit list never rebuilds (kosmos#8221); the rebuild belongs to the lazy list") }
        let app = Self.launch(["KOSMOS_SAMPLE_REBUILD": "1", "KOSMOS_SAMPLE_TRACE": "1"])
        let box = Self.box(app)
        let rebuilt = app.descendants(matching: .any).matching(identifier: "sample-rebuilt").firstMatch
        Self.assertRebuiltOnce(rebuilt, "the short chat")
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Pages 9 to 12 need the new photos'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 10) && newest.isHittable, "the rebuilt short chat did not show its newest message")
        Self.settle(newest)
        XCTAssertLessThanOrEqual(newest.frame.maxY, box.frame.minY, "the newest message was not above the box after the rebuild")
        try Self.keyboardUp(app, box, newest, shot: "rebuilt-short-keyboard-up", test: self)
        Self.assertAbove(newest, box, app.keyboards.firstMatch)
    }

    // kosmos#7420 (build 24, Josh's third report): empty right after the keyboard came DOWN. The keyboard goes up and then
    // down at the newest message, then the recovery runs (KOSMOS_SAMPLE_REBUILD=afterhide, once the keyboard is down): one rebuild,
    // and the newest message on screen above the box.
    func testRebuiltAfterTheKeyboardWentDown() throws {
        if UIKitListArm.on { throw XCTSkip("the UIKit list never rebuilds (kosmos#8221); the rebuild belongs to the lazy list") }
        // kosmos#7688 (4): the rebuild runs 1 s after the keyboard is down (keyboardDidHide), not on a 14 s clock.
        let app = Self.launch(["KOSMOS_SAMPLE_REBUILD": "afterhide", "KOSMOS_SAMPLE_TRACE": "1"])
        let box = Self.box(app)
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Pages 9 to 12 need the new photos'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 10), "Dana's newest message did not show")
        Self.settle(newest)
        try Self.keyboardUp(app, box, newest, shot: "rebuild-down-keyboard-up", test: self)
        // Down, as a person's drag down the conversation does (the chat dismisses the keyboard interactively): from the
        // middle of the conversation to the bottom of the screen.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
            .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.97)))
        let down = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        XCTAssertEqual(XCTWaiter().wait(for: [down], timeout: 5), .completed, "the keyboard did not go down")
        let rebuilt = app.descendants(matching: .any).matching(identifier: "sample-rebuilt").firstMatch
        XCTAssertFalse(rebuilt.exists, "the rebuild marker showed before the keyboard was down (a keyboard-did-hide came early, before this drag)")
        Self.assertRebuiltOnce(rebuilt, "the chat after the keyboard went down")
        XCTAssertTrue(newest.waitForExistence(timeout: 10) && newest.isHittable, "the rebuilt chat did not show its newest message")
        Self.settle(newest)
        XCTAssertLessThanOrEqual(newest.frame.maxY, box.frame.minY, "the newest message was not above the box after the rebuild")
    }

    // kosmos#7420 (build 24, Josh's fourth report): empty after the message box grew a line at a time as he typed (the
    // shown height 412 -> 390 -> 368 -> 346, no keyboard event). No debug hook: the box grows to about four lines at the
    // newest message of the long chat, and a message must still be drawn, whether it never went empty or the chat's own
    // recovery (the empty check and its rebuild) brought it back. (Measured 10-31: the newest message itself can end up
    // behind the grown box; that is the box's growth not followed, #7817, checked by testNewestStaysJustAboveTheBoxAsItGrowsAndShrinks.)
    // kosmos#7688 (5): a REGRESSION GUARD ONLY. It passes with or without the rebuild (the simulator does not reproduce the
    // empty list), and it counts message rows the accessibility tree holds, so the newest can be behind the box and it
    // still passes. Never cite it as evidence that the composer-growth report is fixed.
    func testComposerGrowingKeepsMessagesDrawn() throws {
        let app = Self.launch(["KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_TRACE": "1"])
        let box = Self.box(app)
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 15), "the long chat did not open at its newest message")
        Self.settle(newest)
        try Self.keyboardUp(app, box, newest, shot: "composer-grow-keyboard-up", test: self)
        let h0 = box.frame.height
        // Typed in pieces, so the box grows one line at a time as it did for Josh.
        for _ in 0..<4 {
            box.typeText("the catalogue pages need the new photos before Monday and the captions checked again ")
            Thread.sleep(forTimeInterval: 0.8)
        }
        XCTAssertGreaterThan(box.frame.height, h0 + 40, "the message box did not grow by at least two lines")
        let rows = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message ' AND label ENDSWITH ' of 260.'"))
        let drawn = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count > 0"), object: rows)
        XCTAssertEqual(XCTWaiter().wait(for: [drawn], timeout: 6), .completed, "no message drawn after the message box grew")
    }

    // The other half of the spec: a chat read higher up is not pulled to the newest message. KOSMOS_SAMPLE_SCROLLUP moves
    // the reader up the thread 3 s after opening, as a reader's own scroll does.
    // On the UIKit list (kosmos#8221) a regression guard only: it passed there without slice 3's place-keeping too (11-08),
    // as the keyboard takes room from the bottom and the list keeps its offset. Rows leaving the top: NewMessagesUITests.
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

    // kosmos#7817 (Josh 11-02, his phone): typing a long message at the newest message, every new line of the box moved
    // the conversation behind it somewhere else (3 lines: the newest message above the box; 6 lines: it behind the box and
    // older messages in view). The newest message must stay the same distance above the box as it grows a line at a time,
    // and again as it shrinks. Measured to the box itself (its top moves up a line at a time), within 4 pt.
    func testNewestStaysJustAboveTheBoxAsItGrowsAndShrinks() throws {
        // kosmos#7817 (11-03): the follow is off in release builds (ChatView.followsBox); this turns it on to keep checking it.
        let app = Self.launch(["KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_BOXFOLLOW": "1"])
        let box = Self.box(app)
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        XCTAssertTrue(newest.waitForExistence(timeout: 15), "the long chat did not open at its newest message")
        Self.settle(newest)
        try Self.keyboardUp(app, box, newest, shot: "grow-keyboard-up", test: self)
        Self.assertAbove(newest, box, app.keyboards.firstMatch)
        let gap0 = box.frame.minY - newest.frame.maxY
        let h0 = box.frame.height
        func checkGap(_ when: String) {
            Self.settle(box)
            Self.settle(newest)
            XCTAssertTrue(newest.exists, "\(when): the newest message is no longer drawn")
            let gap = box.frame.minY - newest.frame.maxY
            XCTAssertEqual(gap, gap0, accuracy: 4, "\(when) (box \(Int(box.frame.height)) pt tall): the newest message ends \(Int(gap)) pt above the box, not \(Int(gap0))")
        }
        // A line or so at a time, as a person types.
        for i in 1...5 {
            box.typeText("the catalogue pages need the new photos before Monday ")
            checkGap("after piece \(i)")
        }
        XCTAssertGreaterThan(box.frame.height, h0 + 60, "the box did not grow by at least three lines")
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = "grown"; a.lifetime = .keepAlways; add(a)
        // And back down: deleting the last four pieces (54 characters each) takes the box under its line limit and lines off it.
        let grown = box.frame.height
        box.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 4 * 54))
        // CI, 11-02: the box had not shrunk when it was measured (130 to 130 pt). Wait, up to 10 s, until the deletes have
        // stopped landing, then let it settle and measure.
        // kosmos#7767: not until exactly 54 characters: on CI the box ended on 53 and on 30, and a wait for 54 then never ended.
        // Why it falls short is not measured (a burst of deletes taking more than one, or typing that dropped some).
        var held = 0, waited = 0, seen = -1
        while held < 3 && waited < 20 {
            Thread.sleep(forTimeInterval: 0.5); waited += 1
            let now = ((box.value as? String) ?? "").count
            if now == seen { held += 1 } else { held = 0; seen = now }
        }
        XCTAssertLessThanOrEqual(seen, 2 * 54, "the deletes stopped short: \(seen) characters left, about 54 expected")
        Self.settle(box)
        XCTAssertLessThan(box.frame.height, grown - 15, "the box did not shrink by a line (\(Int(grown)) to \(Int(box.frame.height)) pt)")
        checkGap("after deleting four pieces")
    }

    // kosmos#7817: a reader higher up is not pulled to the newest message as the box grows (only one at the newest is).
    // A regression guard for the follow's own condition (it passes with the follow off too), and on the UIKit list
    // (kosmos#8221) it passed without slice 3's place-keeping as well (11-08).
    func testReadHigherUpStaysWhileTheBoxGrows() throws {
        let app = Self.launch(["KOSMOS_SAMPLE_LONG": "1", "KOSMOS_SAMPLE_SCROLLUP": "40", "KOSMOS_SAMPLE_BOXFOLLOW": "1"])
        let box = Self.box(app)
        let rows = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message ' AND label ENDSWITH ' of 260.'"))
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 15), "no sample rows")
        let rested = app.descendants(matching: .any).matching(identifier: "sample-scroll-rested").firstMatch
        XCTAssertTrue(rested.waitForExistence(timeout: 30), "the sample scroll-up never came to rest")
        Self.settle(rows.firstMatch)
        let newest = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Message 260 of 260'")).firstMatch
        let header = app.navigationBars.firstMatch.frame.maxY
        guard let top = rows.allElementsBoundByIndex.filter({ $0.isHittable && $0.frame.minY > header }).min(by: { $0.frame.minY < $1.frame.minY }) else {
            XCTFail("no row on screen after the scroll up"); return
        }
        let row = app.staticTexts[top.label]
        try Self.keyboardUp(app, box, row, shot: "higher-grow-keyboard-up", test: self)
        let y0 = row.frame.minY
        let h0 = box.frame.height
        for i in 1...3 {
            box.typeText("the catalogue pages need the new photos before Monday ")
            Self.settle(box)
            Self.settle(row)
            XCTAssertTrue(row.exists && row.isHittable, "after piece \(i): '\(top.label)', read higher up, left the screen as the box grew")
            XCTAssertEqual(row.frame.minY, y0, accuracy: 4, "after piece \(i): '\(top.label)' moved from \(y0) to \(row.frame.minY) as the box grew")
        }
        XCTAssertGreaterThan(box.frame.height, h0 + 30, "the box did not grow")
        XCTAssertFalse(newest.exists && newest.isHittable, "the reader was pulled down to the newest message")
    }

    private static func launch(_ env: [String: String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KOSMOS_SAMPLE_AGENTS"] = "1"
        app.launchEnvironment["KOSMOS_SAMPLE_OPEN"] = "dana"
        for (k, v) in env { app.launchEnvironment[k] = v }
        UIKitListArm.set(app)   // kosmos#8221: the list under test
        app.launch()
        return app
    }

    // The message box by its own label (ChatView's composer), whatever kind of element it is drawn as.
    // kosmos#7420: exactly one rebuild. The marker says how many, so none (the recovery did not run) and two (the rebuild's
    // own gap read as empty) read differently on a CI failure.
    private static func assertRebuiltOnce(_ marker: XCUIElement, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(marker.waitForExistence(timeout: 30), "\(what): the rebuild marker never showed", file: file, line: line)
        XCTAssertEqual(marker.label, "sample rebuilt 1", "\(what): not rebuilt exactly once", file: file, line: line)
    }

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

    static func keyboardUp(_ app: XCUIApplication, _ box: XCUIElement, _ watch: XCUIElement, shot: String, test: XCTestCase,
                           file: StaticString = #filePath, line: UInt = #line) throws {
        box.tap()
        /* kosmos#7872: on a loaded CI runner (iPhone 17e, iOS 26.5) the keyboard was once not up within 10 s and the
           test read it as a hardware keyboard. It gets 20 s. No second tap: one landing while the box slides up would
           move what the "stays where it was" tests measure, or open a message's actions. When it still does not come
           up, a screenshot and the box's state go with the failure, so the next red says a missed tap (not hittable,
           or framed off screen) from a keyboard that is connected or hidden. */
        let wait: TimeInterval = 20
        if !app.keyboards.firstMatch.waitForExistence(timeout: wait) {
            let shotNoKb = XCTAttachment(screenshot: app.screenshot()); shotNoKb.name = shot + "-no-keyboard"; shotNoKb.lifetime = .keepAlways; test.add(shotNoKb)
            // Review 2: read the box only if it is there, so a query on a gone box cannot replace this message.
            let state = box.exists ? "box hittable \(box.isHittable), frame \(box.frame)" : "box gone"
            XCTFail("no on-screen keyboard \(Int(wait)) s after tapping the box (\(state)); a hardware keyboard, a tap that did not land, or a keyboard slower than that",
                    file: file, line: line)
            return
        }
        settle(app.keyboards.firstMatch)
        settle(watch)
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = shot; a.lifetime = .keepAlways; test.add(a)
    }

    static func assertAbove(_ message: XCUIElement, _ box: XCUIElement, _ keyboard: XCUIElement) {
        XCTAssertLessThanOrEqual(message.frame.maxY, min(box.frame.minY, keyboard.frame.minY),
                                 "the newest message is hidden: it ends at \(message.frame.maxY), the box starts at \(box.frame.minY), the keyboard at \(keyboard.frame.minY)")
    }
}
